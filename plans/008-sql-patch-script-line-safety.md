# Plan 008: The SQL Patch script generator refuses hint lines that SQL*Plus would execute

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**:
> `git diff --stat b5635d8..HEAD -- src/lib/sqlPatchScript.ts src/components/BaselineScriptModal.tsx src/lib/__tests__/sqlPatchScript.test.ts src/components/__tests__/modals.test.tsx site/docs.html`
> If any in-scope file changed since this plan was written, compare the
> "Current state" excerpts against the live code before proceeding; on a
> mismatch, treat it as a STOP condition. Other plans may have landed first
> and shifted line numbers; match on the quoted code, not the line number.

## Status

- **Priority**: P1
- **Effort**: S
- **Risk**: LOW (validation only; the emitted script is unchanged for every valid input)
- **Depends on**: none
- **Category**: security
- **Planned at**: commit `b5635d8`, 2026-11-11

## Why this matters

The "Create SQL patch" dialog generates a SQL*Plus / SQLcl script that a DBA
runs with high privileges. Its hint text is prefilled from the loaded plan's
outline — and the plan may come from an untrusted paste or share link. The
generator writes hint lines at column 0 of the script, inside a multi-line
PL/SQL string literal. SQL*Plus and SQLcl read a script **line by line** and
know nothing about PL/SQL string literals: while a block is being entered, a
line that is only `/` runs the buffer, a line that is only `.` ends block
entry, and a line starting with `#` is executed at once as a SQL*Plus command.
After such a line the rest of the "literal" is read as top-level commands.
So a crafted outline can make the generated script run lines the dialog never
describes. No real optimizer hint has any of those three shapes, so rejecting
them costs nothing. After this plan the dialog shows an error and offers no
script for such input, and the builder itself throws as a backstop.

## Current state

The app never runs the script; it only offers Copy / Download. Relevant files:

- `src/lib/sqlPatchScript.ts` — pure builder (`buildSqlPatchScript`). Lines are
  only trimmed and blank-filtered:
  ```ts
  35	// One hint per line: Oracle treats newlines in hint text as whitespace, and
  36	// keeping the lines short stays clear of the SQL*Plus ~2499-char line limit
  37	// that a full outline on a single line would hit.
  38	function hintLines(hintText: string): string[] {
  39	  return hintText
  40	    .split(/\r?\n/)
  41	    .map((l) => l.trim())
  42	    .filter((l) => l !== '');
  43	}
  ```
  and emitted without indentation (`hintAssignment`, lines 95–124):
  ```ts
  95	// Builds the `l_hint_text := ...` assignment: one RPAD(<literal>, 500) per
  96	// chunk, one hint per literal line (no indentation - it would count toward the
  97	// 500). ...
  ...
  112	    const body = chunk.map(quoting.escape);
  113	    body[0] = quoting.open + body[0];
  114	    body[body.length - 1] += quoting.close;
  ```
  So for hints `FULL(a)`, `INDEX(b)` the script contains:
  ```
      RPAD(q'[FULL(a)
  INDEX(b)]', 500);
  ```
  The second and later lines of each chunk start at column 0 with raw hint
  text. The builder entry point (line 254):
  ```ts
  254	export function buildSqlPatchScript(opts: SqlPatchScriptOptions): string {
  255	  const sqlId = sanitize(opts.sqlId);
  256	  const patchName = sanitize(opts.name ?? `PLANVIZ_PATCH_${opts.sqlId}`);
  ```
- `src/components/BaselineScriptModal.tsx` — the dialog. SQL_ID and patch name
  are regex-gated, hint text is only checked for "not empty":
  ```tsx
  20	const SQL_ID_RE = /^[a-z0-9]{1,13}$/i;
  21	const PLAN_HASH_RE = /^\d+$/;
  22	const PATCH_NAME_RE = /^[A-Za-z0-9_$#]{1,128}$/;
  ...
  66	  const outlinePrefill = useMemo(() => (initialOutlineHints ?? []).join('\n'), [initialOutlineHints]);
  ...
  68	  const [hintText, setHintText] = useState(outlinePrefill);
  ...
  95	  const patchNameValid = PATCH_NAME_RE.test(patchName);
  96	  const hintsEmpty = hintText.trim() === '';
  97	  const hintsValid = !hintsEmpty;
  ...
  104	  const { script, filename } = useMemo<{ script: string | null; filename: string }>(() => {
  105	    if (isPatch) {
  106	      if (!sqlIdValid || !patchNameValid || !hintsValid) return { script: null, filename: '' };
  107	      const opts = { sqlId, hintText, name: patchName };
  108	      return { script: buildSqlPatchScript(opts), filename: sqlPatchScriptFilename(opts) };
  109	    }
  ```
  The builder is called inside `useMemo` during render, so it must never be
  called with input that makes it throw. When `script` is `null` the Copy and
  Download buttons are disabled and no preview is rendered (lines 364–409).
  The existing inline-error style (SQL_ID field, lines 202–206):
  ```tsx
  202	            {sqlId !== '' && !sqlIdValid && (
  203	              <p className="mt-1 text-[11px] text-red-600 dark:text-red-400">
  204	                SQL_ID is up to 13 alphanumeric characters.
  205	              </p>
  206	            )}
  ```
  The hint textarea and its helper texts (lines 267–288):
  ```tsx
  267	              <textarea
  ...
  274	                className={`${inputClass(true)} resize-y whitespace-pre`}
  275	              />
  ...
  286	              {hintsEmpty && (
  287	                <p className="mt-1 text-[11px] text-slate-500 dark:text-slate-400">Enter at least one hint.</p>
  288	              )}
  ```
  `inputClass(ok)` (line 31) draws a red border when `ok` is false.
- Where the prefill comes from (do not edit; context only):
  `src/App.tsx` passes `initialOutlineHints={activeParsedPlan?.outlineHints}`;
  `packages/ora-plan-core/src/parser/advancedSections.ts` `parseOutlineSection`
  turns every non-blank line of a pasted "Outline Data" section into a hint
  (joining lines only while parentheses are unbalanced), and
  `packages/ora-plan-core/src/parser/sqlMonitorXmlExtras.ts` `parseOutlineHints`
  takes the text of each `<hint>` element. Neither filters line shapes.
- `buildSqlPatchScript` has exactly one non-test caller
  (`BaselineScriptModal.tsx` line 108).
- Tests: `src/lib/__tests__/sqlPatchScript.test.ts` (234 lines; pins the
  emitted layout in detail) and the `describe('BaselineScriptModal: SQL Patch mode', …)`
  block in `src/components/__tests__/modals.test.tsx` (starts near line 353).
- Docs: `site/docs.html`, section "SQL Plan Baseline / SQL Patch script", has
  a "Hint text" bullet (near line 765).

Conventions that apply: TypeScript strict; `import type` for type-only
imports; tests are vitest with explicit imports and no Testing Library — the
modal tests use the helpers in `src/components/ui/__tests__/testUtils.tsx`
(`render`, `click`, `buttonByText`, `cleanup`) plus the local `typeInto` and
`renderWithProviders` helpers defined at the top of `modals.test.tsx`. A
user-facing behaviour change updates `site/docs.html` in the same change.

Why validation and not a new script layout: the alternative — emitting each
hint as its own single-line literal joined with `||`, so that no script line
ever starts with hint text — changes the emitted PL/SQL. The current layout
(500-character `RPAD` chunks) was tuned against Oracle 19c, and this
repository's rule is that edited Oracle-facing SQL is re-run on the 19c test
database. Validation leaves the script byte-identical for every valid input,
so no database run is needed. The layout change is recorded under
"Maintenance notes" as the stronger follow-up.

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Install | `npm ci` | exit 0 |
| Lint | `npm run lint` | exit 0 |
| Typecheck | `npm run typecheck` | exit 0, no errors |
| All tests | `npm test` | all files pass (baseline at `b5635d8`: `Test Files 155 passed (155)`, `Tests 1787 passed (1787)`, about 15 s) |
| Builder tests | `npx vitest run --environment jsdom src/lib/__tests__/sqlPatchScript.test.ts` | all pass |
| Modal tests | `npx vitest run --environment jsdom src/components/__tests__/modals.test.tsx` | all pass |
| Dump a script | see Step 1 | prints a SQL script |

## Scope

**In scope** (the only files you should modify):

- `src/lib/sqlPatchScript.ts`
- `src/components/BaselineScriptModal.tsx`
- `src/lib/__tests__/sqlPatchScript.test.ts`
- `src/components/__tests__/modals.test.tsx`
- `site/docs.html` (one sentence in the "Hint text" bullet)

**Out of scope** (do NOT touch, even though they look related):

- `hintAssignment`, `packChunks`, `chooseQuoting` and every string the script
  emits — the output for valid input must not change by a single byte.
- `src/lib/baselineScript.ts` — the baseline script takes no free text.
- The parsers in `packages/ora-plan-core/src/parser/` — the plan viewer must
  keep showing whatever the outline contains; the check belongs where a
  script is generated.
- `scripts/*.sql`.

## Git workflow

- Branch: `fix/sql-patch-hint-line-safety`
- Conventional-commit message, e.g.
  `fix(sql-patch): reject hint lines SQL*Plus would run as commands`
- Do NOT push or open a PR unless the operator instructed it.

## Steps

### Step 1: Record today's output for a valid outline

```bash
mkdir -p /tmp/plan008
npx tsx -e "import('./src/lib/sqlPatchScript.ts').then((m) => process.stdout.write(m.buildSqlPatchScript({ sqlId: 'abc123def4567', hintText: ['FULL(a)', 'INDEX(b)', 'LEADING(a b)'].join('\n') })))" > /tmp/plan008/before.sql
```

**Verify**: `grep -c "RPAD(q'\[FULL(a)" /tmp/plan008/before.sql` → `1`, and
`wc -l < /tmp/plan008/before.sql` prints a number above 80.

### Step 2: Add the failing builder tests

Append to `src/lib/__tests__/sqlPatchScript.test.ts` (and add `unsafeHintLines`
to the existing import from `'../sqlPatchScript'`):

```ts
describe('unsafeHintLines', () => {
  it('flags lines SQL*Plus would act on instead of reading as text', () => {
    expect(unsafeHintLines('FULL(a)\n/\nINDEX(b)')).toEqual(['/']);
    expect(unsafeHintLines('FULL(a)\n  .  \nINDEX(b)')).toEqual(['.']);
    expect(unsafeHintLines('FULL(a)\n# PROMPT x\nINDEX(b)')).toEqual(['# PROMPT x']);
    expect(unsafeHintLines('/\r\n.\r\n#x')).toEqual(['/', '.', '#x']);
  });

  it('accepts real hints, including ones that merely contain those characters', () => {
    expect(unsafeHintLines('FULL(a)\nOPT_PARAM(\'x\' \'a/b\')\nINDEX(t "A#B")\n/*+ FULL(t) */\n.5')).toEqual([]);
    expect(unsafeHintLines(REAL_OUTLINE.join('\n'))).toEqual([]);
    expect(unsafeHintLines('')).toEqual([]);
  });
});

describe('buildSqlPatchScript line safety', () => {
  it.each([['/'], ['.'], ['#PROMPT x']])('throws for a hint line %j', (line) => {
    expect(() => buildSqlPatchScript({ ...base, hintText: `FULL(a)\n${line}\nPROMPT x` })).toThrow(/SQL\*Plus/);
  });

  it('still builds when the first or only hint line is a normal hint', () => {
    expect(() => buildSqlPatchScript({ ...base, hintText: REAL_OUTLINE.join('\n') })).not.toThrow();
  });
});
```

(`base` and `REAL_OUTLINE` are constants already defined in that file. The
test inputs are deliberately harmless: `PROMPT x` only prints text.)

**Verify**: `npx vitest run --environment jsdom src/lib/__tests__/sqlPatchScript.test.ts`
→ fails, the new tests reporting `unsafeHintLines is not a function` (or
"did not throw").

### Step 3: Implement the check in the builder

In `src/lib/sqlPatchScript.ts`:

1. Directly after the `hintLines` function, add:

   ```ts
   /**
    * Hint lines that SQL*Plus / SQLcl would act on instead of reading as text.
    * Both tools read a script line by line and know nothing about PL/SQL string
    * literals: while the block is being entered, a line that is only `/` runs the
    * buffer, a line that is only `.` ends the block, and a line starting with `#`
    * is executed at once as a SQL*Plus command. Hint lines are written at column 0
    * (see hintAssignment), so such a line would cut the block short and the lines
    * after it would run as top-level commands. No real hint has any of these shapes.
    */
   export function unsafeHintLines(hintText: string): string[] {
     return hintLines(hintText).filter((l) => l === '/' || l === '.' || l.startsWith('#'));
   }
   ```

2. Make the first statements of `buildSqlPatchScript`:

   ```ts
   export function buildSqlPatchScript(opts: SqlPatchScriptOptions): string {
     const unsafe = unsafeHintLines(opts.hintText);
     if (unsafe.length > 0) {
       throw new Error(
         `Hint text has ${unsafe.length} line(s) that SQL*Plus would run as a command instead of reading as hint text: ` +
           unsafe.map((l) => JSON.stringify(l.length > 40 ? `${l.slice(0, 37)}...` : l)).join(', '),
       );
     }
     const sqlId = sanitize(opts.sqlId);
   ```

   Change nothing else in the file.

**Verify**:
- `npx vitest run --environment jsdom src/lib/__tests__/sqlPatchScript.test.ts` → all pass (every pre-existing test included).
- Re-run the Step 1 command with output `/tmp/plan008/after.sql`, then
  `diff /tmp/plan008/before.sql /tmp/plan008/after.sql` → no output, exit 0.

### Step 4: Add the failing modal test

In `src/components/__tests__/modals.test.tsx`, inside
`describe('BaselineScriptModal: SQL Patch mode', …)`, add:

```tsx
  it('refuses hint lines that SQL*Plus would run as commands', async () => {
    renderWithProviders(
      <BaselineScriptModal
        initialKind="patch"
        initialSqlId="abc123"
        initialOutlineHints={['FULL(a)', '/', 'PROMPT x']}
        onClose={() => {}}
      />,
    );
    const alert = () => dialog()!.querySelector('[role="alert"]');
    expect(alert()?.textContent).toContain('SQL*Plus would run');
    expect(buttonByText('Copy script').disabled).toBe(true);
    expect(buttonByText('Download .sql').disabled).toBe(true);
    expect(document.querySelector('details pre')).toBeNull();
    await typeInto(hints(), 'FULL(a)\nINDEX(b)');
    expect(alert()).toBeNull();
    expect(buttonByText('Copy script').disabled).toBe(false);
  });
```

(`dialog`, `hints`, `typeInto`, `renderWithProviders` and `buttonByText`
already exist in that file / describe block.)

**Verify**: `npx vitest run --environment jsdom src/components/__tests__/modals.test.tsx`
→ exactly this one test fails. (After Step 3 the failure is an error thrown
during render — that is the crash this step prevents.)

### Step 5: Gate the dialog on the same check

In `src/components/BaselineScriptModal.tsx`:

1. Import the function:
   `import { buildSqlPatchScript, sqlPatchScriptFilename, unsafeHintLines } from '../lib/sqlPatchScript';`
2. Replace `const hintsValid = !hintsEmpty;` with:

   ```tsx
     // Lines SQL*Plus would run as commands (a lone / or ., or a # prefix): never offered as a script
     const unsafeHints = useMemo(() => unsafeHintLines(hintText), [hintText]);
     const hintsValid = !hintsEmpty && unsafeHints.length === 0;
   ```

   (`hintsValid` already guards the `buildSqlPatchScript` call and is already
   in that `useMemo`'s dependency list.)
3. On the hint `<textarea>`, change `inputClass(true)` to
   `inputClass(unsafeHints.length === 0)`.
4. Directly after the `{hintsEmpty && ( … )}` block, add:

   ```tsx
                 {unsafeHints.length > 0 && (
                   <p role="alert" className="mt-1 text-[11px] text-red-600 dark:text-red-400">
                     Remove {unsafeHints.length === 1 ? 'this line' : 'these lines'}: SQL*Plus would run{' '}
                     {unsafeHints.length === 1 ? 'it' : 'them'} as a command, not read {unsafeHints.length === 1 ? 'it' : 'them'} as
                     hint text —{' '}
                     {unsafeHints.slice(0, 3).map((line, i) => (
                       <code key={i} className="mr-1">{line.length > 40 ? `${line.slice(0, 37)}...` : line}</code>
                     ))}
                     {unsafeHints.length > 3 && `and ${unsafeHints.length - 3} more`}
                   </p>
                 )}
   ```

**Verify**: `npx vitest run --environment jsdom src/components/__tests__/modals.test.tsx`
→ all pass, including the pre-existing test
`Copy stays enabled when the hint text contains & …`.

### Step 6: Document it

In `site/docs.html`, in the "Hint text" list item of the SQL Patch section
(it ends with `trim it to the hints you need, or type your own.</li>`), insert
before `</li>`:

` A line that SQL*Plus would run as a command instead of reading as hint text (only <code>/</code> or <code>.</code>, or starting with <code>#</code>) is rejected.`

**Verify**: `grep -c "is rejected.</li>" site/docs.html` → `1`.

### Step 7: Full check

**Verify**: `npm run lint` → exit 0; `npm run typecheck` → exit 0;
`npm test` → all pass (at the planned commit: `Test Files 155 passed (155)`,
`Tests 1794 passed (1794)` — 7 new tests).

## Test plan

- `src/lib/__tests__/sqlPatchScript.test.ts` — new `describe('unsafeHintLines')`
  (2 tests: the three unsafe shapes incl. CRLF and surrounding spaces; real
  hints that merely contain `/`, `.`, `#`) and
  `describe('buildSqlPatchScript line safety')` (3 parameterised throw cases +
  1 no-throw case for the real 24-hint outline).
- `src/components/__tests__/modals.test.tsx` — 1 new test: error shown, Copy
  and Download disabled, no preview; clearing the bad line restores them.
- Regression guard for "valid input is unchanged": every pre-existing test in
  `sqlPatchScript.test.ts` still passes unmodified, and the before/after
  `diff` in Step 3 is empty.
- Pattern to follow: the neighbouring tests in each file.

## Done criteria

- [ ] `npm run lint` exits 0
- [ ] `npm run typecheck` exits 0
- [ ] `npm test` exits 0, with the 7 new tests present and passing
- [ ] `diff /tmp/plan008/before.sql /tmp/plan008/after.sql` prints nothing
- [ ] `git diff b5635d8 -- src/lib/sqlPatchScript.ts` shows only added lines (no `-` lines other than the diff header)
- [ ] `grep -c "unsafeHintLines" src/components/BaselineScriptModal.tsx` prints `2` or more
- [ ] `git status --porcelain` lists only the five in-scope files
- [ ] `plans/README.md` status row updated

## STOP conditions

Stop and report back (do not improvise) if:

- `hintLines`, `hintAssignment` or the modal's `hintsValid` logic does not
  match the excerpts (drift).
- Any pre-existing test in `sqlPatchScript.test.ts` fails after Step 3 — the
  check must not reject anything those tests use (they include lines such as
  `)' !' #'`, which starts with `)` and is fine).
- The before/after `diff` in Step 3 is not empty.
- `grep -rn "buildSqlPatchScript(" src --include=*.ts --include=*.tsx | grep -v __tests__`
  shows a caller other than `BaselineScriptModal.tsx` — a second caller would
  need the same guard before the builder may throw.
- You feel the need to strip or rewrite the offending lines instead of
  rejecting them: do not. Silently altering hint text changes what the patch
  does.

## Maintenance notes

- This closes the three line shapes that SQL*Plus acts on with **default**
  settings. A user who changed `SET BLOCKTERMINATOR` or `SET SQLPREFIX` in
  their `login.sql` has different trigger characters; that is not covered.
- Stronger follow-up, deliberately not done here: emit each hint as its own
  single-line literal joined with `||` inside the `RPAD(…, 500)` call, so no
  script line can ever begin with hint text and the script is safe by
  construction. That changes the emitted layout, so the generated script must
  then be run on the 19c test database (create a patch for a real SQL_ID,
  check `DBA_SQL_PATCHES` and the plan's Note section) before merging.
- Related SQL*Plus quirk to keep in mind for that follow-up: a line ending in
  a hyphen (`-`) is treated as a line continuation by SQL*Plus even inside a
  statement; a hint line ending in `-` would be joined with the next line.
- Reviewers: confirm that the diff of `sqlPatchScript.ts` only adds code, and
  that the modal can no longer reach `buildSqlPatchScript` with rejected text.
- If another UI ever generates a patch script (for example from AI-suggested
  hints), it must call `unsafeHintLines` first; the builder throws otherwise.
