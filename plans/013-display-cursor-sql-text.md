# Plan 013: SQL text read from a DBMS_XPLAN header is complete and unmodified

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**:
> `git diff --stat b5635d8..HEAD -- packages/ora-plan-core/src/parser/dbmsXplanParser.ts src/lib/parser/__tests__/dbmsXplan.test.ts`
> If any in-scope file changed since this plan was written, compare the
> "Current state" excerpts against the live code before proceeding; on a
> mismatch, treat it as a STOP condition. Other plans may have landed first and
> shifted line numbers; match on the quoted code, not the line number.
> `plans/012-plan-table-prefix-and-nbsp.md` (imports, `parse`,
> `extractDbmsXplanSegments`) and `plans/014-validate-sql-id-and-plan-hash.md`
> (one `return` line in `extractSqlHeader`) edit the same file
> `dbmsXplanParser.ts`. Neither changes the two regions this plan replaces. If
> plan 014 already landed, the `return` line quoted below reads
> `sqlId: normalizeSqlId(sqlId)` instead of `sqlId: sqlId || undefined` — that
> is expected; this plan does not touch that line.

## Status

- **Priority**: P2
- **Effort**: S
- **Risk**: LOW
- **Depends on**: `plans/012-plan-table-prefix-and-nbsp.md` (same file — run
  after it to avoid edit conflicts; there is no logical dependency)
- **Category**: bug
- **Planned at**: commit `b5635d8`, 2026-11-11

## Why this matters

`DBMS_XPLAN.DISPLAY_CURSOR` and `DISPLAY_AWR` print the statement under a
`SQL_ID  <id>, child number N` header, wrapped at a fixed width. The parser
stores it as `ParsedPlan.sqlText`, which the app shows in the SQL tab, exports
in reports and share links, and feeds to the hints lens and the agent handoff.
Two defects make that text silently wrong:

1. Collection stops at the **first blank line**, so a statement with a blank
   line inside loses everything after it (`ORDER BY …` gone).
2. Every line has a "SQL*Plus continuation number" stripped
   (`/^\s{0,4}\d+\s{1,4}/`), although DBMS_XPLAN prints no such numbers. A
   wrapped line that happens to start with a literal loses it:

   ```text
   select e.ename from emp e where e.sal >
   1000 and e.deptno in (10, 20,
   30 ) and rownum <=
   50
   ```

   becomes `… where e.sal >` / `and e.deptno in (10, 20,` / `) and rownum <=` /
   `50` — the literals `1000` and `30` are gone, and the SQL shown is not the
   SQL that ran.

The same stripping also damages SQL pasted above a plan, and the trailing `;`
of a PL/SQL block (`BEGIN …; END;`) is removed. After this plan the header
shape is taken verbatim up to the `Plan hash value:` line, and line numbers are
stripped only where SQL*Plus really printed them.

## Current state

### Repository rules that apply

- The real code is in `packages/ora-plan-core/src/...`;
  `src/lib/parser/dbmsXplanParser.ts` is a one-line `export *` shim — **never
  edit a shim**. Tests import through the shim
  (`from '../dbmsXplanParser'`).
- Inside the package, sibling imports carry an explicit `.ts` extension; no
  React, no DOM. TypeScript strict (`noUnusedLocals`, `noUnusedParameters`).
- Parser fixtures in `src/lib/parser/__tests__/fixtures/` are real Oracle
  captures and must never be edited; synthetic input is built inline in the
  test.
- Every fixture and bundled example must keep parsing with no
  `ParsedPlan.warnings`.
- Parsers never throw on odd input.

### The file

`packages/ora-plan-core/src/parser/dbmsXplanParser.ts` — `extractSqlHeader`
reads SQL_ID, child number and SQL text from the preamble of a plan in three
shapes (documented in its own comment):

1. `SQL_ID  <id>, child number N` header (DISPLAY_CURSOR / DISPLAY_AWR), then a
   dash line, then the statement, then a blank line, then `Plan hash value:`;
2. a SQL*Plus prompt with numbered continuation lines
   (`SQL> SELECT *` / `  2    FROM emp` / `  3   WHERE deptno = 10;`);
3. bare SQL text right above the plan.

`cleanSqlLines` post-processes the collected lines for **all three** shapes.
It is called from exactly two places, both inside `extractSqlHeader`.

### Excerpts (commit `b5635d8`)

Shape 1, `dbmsXplanParser.ts:310-327` — **region A**, replaced in Step 2:

```ts
    // Skip the separator dashes line(s) that follow the header.
    let j = i + 1;
    while (j < lines.length && /^\s*[-=]+\s*$/.test(lines[j])) j++;

    const collected: string[] = [];
    for (; j < lines.length; j++) {
      const line = lines[j];
      if (/Plan\s+hash\s+value\s*:/i.test(line)) break;
      if (/^\s*$/.test(line)) {
        if (collected.length === 0) continue; // skip leading blanks
        break;
      }
      collected.push(line);
    }

    const sqlText = cleanSqlLines(collected);
    return { sqlId: sqlId || undefined, childNumber, sqlText: sqlText || undefined };
  }
```

Shapes 2 and 3 end with (`dbmsXplanParser.ts:364-365`) — **not changed**:

```ts
  const sqlText = cleanSqlLines(collected);
  return sqlText ? { sqlText } : {};
```

`dbmsXplanParser.ts:368-379` — **region B**, replaced in Step 3:

```ts
function cleanSqlLines(lines: string[]): string {
  const cleaned = lines.map((line) =>
    line
      .replace(/^\s*SQL>\s?/i, '')
      // SQL*Plus continuation: "  2    FROM ..." — strip leading line number.
      .replace(/^\s{0,4}\d+\s{1,4}/, '')
      .trimEnd(),
  );
  // Drop trailing blank lines.
  while (cleaned.length && cleaned[cleaned.length - 1].trim() === '') cleaned.pop();
  return cleaned.join('\n').replace(/;\s*$/, '').trim();
}
```

### Existing tests to model on

`src/lib/parser/__tests__/dbmsXplan.test.ts`, `describe('SQL text extraction')`
(the last `describe` in the file). It uses a small plan constant `PLAN_A`
defined at the top of the file (starts with `Plan hash value: 111111111`) and
`parseDbmsXplanPlans`:

```ts
  it('extracts SQL text from SQL*Plus prompt with line-number continuation', () => {
    const input = [
      'SQL> SELECT *',
      '  2    FROM emp',
      '  3   WHERE deptno = 10;',
      '',
      PLAN_A,
    ].join('\n');

    const [plan] = parseDbmsXplanPlans(input);
    expect(plan.sqlText).toBe('SELECT *\nFROM emp\nWHERE deptno = 10');
    expect(plan.sqlId).toBeUndefined();
  });
```

That expectation (continuation number **and** up to four spaces after it
stripped; trailing `;` stripped) must keep passing.

### Verified outcome of the design

Applied to a scratch copy: all existing tests pass; `sqlText` (and everything
else) of **every** fixture and bundled example is byte-identical before and
after — none of them has an internal blank line, a number-leading wrapped line
or a trailing `;`. So the characterisation diff in Step 4 must be **empty**.
Of the seven tests in Step 5, five fail on the current code and pass after the
change; two are regression guards that pass on both.

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Install | `npm ci` | exit 0 |
| Lint | `npm run lint` | exit 0 |
| Typecheck | `npm run typecheck` | exit 0, no errors |
| All tests | `npm test` | builds the core package, then vitest; at `b5635d8`: `Test Files 155 passed (155)`, `Tests 1787 passed (1787)`, ~15 s (more if earlier plans landed) |
| One file | `npx vitest run --environment jsdom src/lib/parser/__tests__/dbmsXplan.test.ts` | all pass |

## Scope

**In scope** (the only files you should modify):

- `packages/ora-plan-core/src/parser/dbmsXplanParser.ts` — regions A and B only
- `src/lib/parser/__tests__/dbmsXplan.test.ts` — add tests
- `plans/README.md` (status row only)

**Out of scope** (do NOT touch, even though they look related):

- The `SQL_ID` header regex and the `return { sqlId: … }` line of shape 1
  (`plans/014-validate-sql-id-and-plan-hash.md` owns them).
- The collection loop of shapes 2 and 3 (`dbmsXplanParser.ts:329-362`): which
  lines are collected there stays as it is; only what `cleanSqlLines` does with
  them changes.
- SQL text of other sources (SQL Monitor XML `sql_fulltext`, JSON `sql_text`,
  SQL Monitor text reports) — different code.
- Files under `src/lib/parser/__tests__/fixtures/` and `src/examples/`.
- `src/lib/parser/dbmsXplanParser.ts` (shim).

## Git workflow

- Branch: `fix/display-cursor-sql-text`
- Conventional-commit message in the repo's style (example from history:
  `fix(lint): satisfy eslint-plugin-react-hooks 7.1 / react-refresh 0.5`), e.g.
  `fix(parser): keep DISPLAY_CURSOR SQL text intact (blank lines, leading numbers)`.
- Do NOT push or open a PR unless the operator instructed it.

## Steps

### Step 1: Record what every fixture and example parses to today

Create this script **outside the repository** and run it from the repository
root:

```bash
mkdir -p /tmp/oraplan-013
cat > /tmp/oraplan-013/dump-plans.mts <<'EOF'
// Characterisation dump: parse every real fixture and bundled example, print one JSON document.
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';

const root = process.cwd();
const require = createRequire(join(root, 'package.json'));
// SQL Monitor XML parsing needs a DOMParser; jsdom is a devDependency of the repo.
const { JSDOM } = require('jsdom');
(globalThis as Record<string, unknown>).DOMParser = new JSDOM('').window.DOMParser;

const core = await import(pathToFileURL(join(root, 'packages/ora-plan-core/src/index.ts')).href);

const dirs = ['src/lib/parser/__tests__/fixtures', 'src/examples'];
const out: Record<string, unknown> = {};
for (const dir of dirs) {
  for (const name of readdirSync(join(root, dir)).sort()) {
    if (!/\.(txt|csv)$/.test(name)) continue;
    const plan = core.parsePlan(readFileSync(join(root, dir, name), 'utf-8'));
    out[`${dir}/${name}`] = JSON.parse(
      JSON.stringify(plan, (key, value) => {
        if (key === 'rootNode') return value ? value.id : null;
        if (key === 'children') return (value as { id: number }[]).map((c) => c.id);
        return value;
      }),
    );
  }
}
process.stdout.write(JSON.stringify(out, null, 1) + '\n');
EOF
npx tsx /tmp/oraplan-013/dump-plans.mts > /tmp/oraplan-013/before.json
```

**Verify**: `node -e "const o=require('/tmp/oraplan-013/before.json'); console.log(Object.keys(o).length, Object.values(o).filter(p=>p.sqlText).length)"`
→ `28 18` (28 files parsed, 18 of them with SQL text).

### Step 2: Shape 1 — collect up to "Plan hash value:" (region A)

In `extractSqlHeader`, replace the block that starts with
`const collected: string[] = [];` and ends with
`const sqlText = cleanSqlLines(collected);` (the **first** occurrence of that
line in the file — the one followed by the `return { sqlId: …` line) with:

```ts
    // The statement runs up to this block's "Plan hash value:" line and may hold blank lines.
    // Without such a line (a header-only fragment), fall back to stopping at the first blank line.
    let end = lines.findIndex((line, k) => k >= j && /Plan\s+hash\s+value\s*:/i.test(line));
    if (end === -1) {
      let k = j;
      while (k < lines.length && /^\s*$/.test(lines[k])) k++; // skip leading blanks
      while (k < lines.length && !/^\s*$/.test(lines[k])) k++;
      end = k;
    }

    const sqlText = cleanSqlLines(dropPageBreaks(lines.slice(j, end)), { verbatim: true });
```

Keep the three lines above it (`// Skip the separator dashes…`, `let j = i + 1;`,
the `while`) and the `return { sqlId: …, childNumber, sqlText: sqlText || undefined };`
line below it exactly as they are.

(`dropPageBreaks` and the second parameter of `cleanSqlLines` arrive in Step 3;
the file does not typecheck between Step 2 and Step 3.)

### Step 3: Replace `cleanSqlLines` and add `dropPageBreaks` (region B)

Replace the whole `function cleanSqlLines(lines: string[]): string { … }` with:

```ts
/**
 * SQL*Plus repeats the column heading on every page (SET PAGESIZE): a blank line, the
 * "PLAN_TABLE_OUTPUT" heading and its underline. Drop those from text printed by DBMS_XPLAN.
 */
function dropPageBreaks(lines: string[]): string[] {
  const out: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    if (/^\s*PLAN_TABLE_OUTPUT\s*$/.test(lines[i])) {
      if (out.length > 0 && out[out.length - 1].trim() === '') out.pop();
      if (/^\s*-{5,}\s*$/.test(lines[i + 1] ?? '')) i++;
      continue;
    }
    out.push(lines[i]);
  }
  return out;
}

/**
 * Join the lines of a statement found above a plan.
 *
 * `verbatim` (the DISPLAY_CURSOR / DISPLAY_AWR header shape): DBMS_XPLAN printed the cursor's
 * text itself, so nothing is stripped - a wrapped line may well begin with a number, and a
 * PL/SQL block ends in ";".
 *
 * Otherwise the text was typed at (or pasted next to) a SQL*Plus prompt: the "SQL> " prompt and
 * the statement terminator go, and continuation numbers go only when they really are the
 * sequence 2, 3, 4 ... that SQL*Plus prints.
 */
function cleanSqlLines(lines: string[], options: { verbatim?: boolean } = {}): string {
  let cleaned = lines.map((line) => line.trimEnd());
  if (!options.verbatim) {
    const prompted = /^\s*SQL>/i.test(cleaned[0] ?? '');
    cleaned = cleaned.map((line) => line.replace(/^\s*SQL>\s?/i, ''));
    const numbered =
      prompted &&
      cleaned.length > 1 &&
      cleaned.slice(1).every((line, i) => new RegExp(`^\\s*${i + 2}(?:\\s|$)`).test(line));
    if (numbered) {
      // "  2    FROM ..." - strip the continuation number SQL*Plus put in front.
      cleaned = cleaned.map((line, i) => (i === 0 ? line : line.replace(/^\s*\d+\s{0,4}/, '')));
    }
  }
  // Drop leading and trailing blank lines; blank lines inside the statement stay.
  while (cleaned.length && cleaned[0].trim() === '') cleaned.shift();
  while (cleaned.length && cleaned[cleaned.length - 1].trim() === '') cleaned.pop();
  const text = cleaned.join('\n').trim();
  return options.verbatim ? text : text.replace(/;\s*$/, '').trim();
}
```

Do **not** change the second call, `const sqlText = cleanSqlLines(collected);`
in shapes 2 and 3 — it keeps calling without options.

**Verify**:
- `npm run typecheck` → exit 0
- `npx vitest run --environment jsdom src/lib/parser` → all pass (all existing
  SQL-text tests included)

### Step 4: Nothing changed for real captures

```bash
npx tsx /tmp/oraplan-013/dump-plans.mts > /tmp/oraplan-013/after.json
cmp /tmp/oraplan-013/before.json /tmp/oraplan-013/after.json && echo IDENTICAL
```

**Verify**: prints `IDENTICAL`.

### Step 5: Add the tests

In `src/lib/parser/__tests__/dbmsXplan.test.ts`, inside
`describe('SQL text extraction', () => { … })`, after the last existing test
(`it('returns no SQL text when the preamble has none', …)`) and before the
closing `});` of that describe, add:

```ts
  const CURSOR_HEADER = ['SQL_ID  dvuvg3u3z13bg, child number 0', '-------------------------------------'];
  const sqlTextOf = (lines: string[]): string | undefined => parseDbmsXplanPlans(lines.join('\n'))[0].sqlText;

  it('keeps wrapped lines that start with a number (DISPLAY_CURSOR header)', () => {
    const sql = ['select e.ename from emp e where e.sal >', '1000 and e.deptno in (10, 20,', '30 ) and rownum <=', '50'];
    expect(sqlTextOf([...CURSOR_HEADER, ...sql, '', PLAN_A])).toBe(sql.join('\n'));
  });

  it('keeps the SQL after a blank line inside the statement', () => {
    // DISPLAY_AWR pads the blank line before "Plan hash value" with one space.
    expect(sqlTextOf([...CURSOR_HEADER, 'select e.ename', 'from emp e', '', 'order by e.ename', ' ', PLAN_A])).toBe(
      'select e.ename\nfrom emp e\n\norder by e.ename',
    );
  });

  it('keeps the closing ";" of a PL/SQL block', () => {
    expect(sqlTextOf([...CURSOR_HEADER, 'BEGIN refresh_orders(:1); END;', '', PLAN_A])).toBe('BEGIN refresh_orders(:1); END;');
  });

  it('drops a SQL*Plus page heading printed in the middle of the statement', () => {
    const pageBreak = ['', 'PLAN_TABLE_OUTPUT', '--------------------------------------------------------------------------------'];
    expect(sqlTextOf([...CURSOR_HEADER, 'select e.ename', ...pageBreak, 'from emp e', '', PLAN_A])).toBe(
      'select e.ename\nfrom emp e',
    );
  });

  it('stops at the first blank line when the block has no "Plan hash value" line', () => {
    const tableOnly = PLAN_A.split('\n').slice(2).join('\n');
    expect(sqlTextOf([...CURSOR_HEADER, 'select 1 from dual', '', 'some other text', '', tableOnly])).toBe('select 1 from dual');
  });

  it('does not strip a leading number from bare SQL above the plan', () => {
    expect(sqlTextOf(['select name from emp where sal >', '1000 and deptno = 10', '', PLAN_A])).toBe(
      'select name from emp where sal >\n1000 and deptno = 10',
    );
  });

  it('keeps numbers after a SQL> prompt that are not the 2, 3, 4 ... continuation numbers', () => {
    expect(sqlTextOf(['SQL> select name from emp where sal >', '1000 and deptno = 10;', '', PLAN_A])).toBe(
      'select name from emp where sal >\n1000 and deptno = 10',
    );
  });
```

**Verify**: `npx vitest run --environment jsdom src/lib/parser/__tests__/dbmsXplan.test.ts`
→ all pass, 7 more tests than before (23 in total if the file was unchanged
since `b5635d8`).

### Step 6: Full gates

**Verify**:
- `npm run lint` → exit 0
- `npm run typecheck` → exit 0
- `npm test` → all pass, 7 more tests than before this plan

## Test plan

- Seven new tests in `src/lib/parser/__tests__/dbmsXplan.test.ts`, modelled on
  the four existing tests of `describe('SQL text extraction')`:
  1. wrapped lines starting with a number are kept (the reported bug);
  2. SQL after an internal blank line is kept, trailing whitespace-only line
     (DISPLAY_AWR style) is not part of the text;
  3. the closing `;` of a PL/SQL block is kept in the header shape;
  4. a SQL*Plus page heading (`PLAN_TABLE_OUTPUT` + dashes) in the middle of the
     statement is removed and the statement continues;
  5. regression guard: without a `Plan hash value` line the old
     stop-at-first-blank behaviour applies;
  6. bare SQL above a plan keeps a number-leading line;
  7. after a `SQL>` prompt, numbers that are not the sequence 2, 3, 4 … stay.
- Existing tests that must keep passing unchanged: all four in the same
  describe (in particular the `SQL> SELECT *` / `  2    FROM emp` one),
  `displayCursorBatch.test.ts` (`sqlText` of split plans), `awrPlan.test.ts`,
  `allstats.test.ts`.

## Done criteria

Machine-checkable. ALL must hold:

- [ ] `npm run lint` exits 0
- [ ] `npm run typecheck` exits 0
- [ ] `npm test` exits 0; the 7 new tests exist and pass
- [ ] `cmp /tmp/oraplan-013/before.json /tmp/oraplan-013/after.json` exits 0
- [ ] `grep -c "verbatim: true" packages/ora-plan-core/src/parser/dbmsXplanParser.ts` → `1`
- [ ] `grep -cF '\s{0,4}\d+\s{1,4}' packages/ora-plan-core/src/parser/dbmsXplanParser.ts`
      → `0` (the unconditional number strip is gone; it is `1` before this plan)
- [ ] `git status --porcelain` lists only the in-scope files
- [ ] `plans/README.md` status row updated

## STOP conditions

Stop and report back (do not improvise) if:

- Region A or region B does not match the excerpts (other than the documented
  `normalizeSqlId` variant of the `return` line).
- `cleanSqlLines` has more than two call sites
  (`grep -n "cleanSqlLines(" packages/ora-plan-core/src/parser/dbmsXplanParser.ts`
  should show the definition plus two calls).
- The comparison in Step 4 is not identical. Print the differing `sqlText`
  values and stop: a real capture whose SQL text changes was not expected and
  needs a human decision, even if the new value looks better.
- The existing test "extracts SQL text from SQL*Plus prompt with line-number
  continuation" fails after Step 3.
- Any fixture or example gains a warning.

## Maintenance notes

- `verbatim` is the contract for text DBMS_XPLAN itself printed; anything typed
  by a person at a prompt goes through the non-verbatim path. A future shape
  (e.g. the `EXPLAINED SQL STATEMENT:` block of `DISPLAY_SQLSET`) should pick
  one of the two deliberately.
- `dropPageBreaks` only runs for the header shape. Page headings inside the
  plan table or the predicate section are a separate, known weakness of the
  text parsers and are not addressed here.
- Shapes 2 and 3 still stop at the first blank line; SQL*Plus itself ends
  statement entry at a blank line (SQLBLANKLINES OFF), so that is correct for
  typed statements.
- Reviewer: the continuation-number test is `every` over **all** lines after
  the first. One line that does not carry its expected number disables
  stripping for the whole statement — intended (never guess).
