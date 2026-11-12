# Plan 014: Only a well-formed SQL_ID and plan hash value leave the parsers and reach the agent-handoff instructions

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**:
> `git diff --stat b5635d8..HEAD -- packages/ora-plan-core/src/parser/values.ts packages/ora-plan-core/src/parser/dbmsXplanParser.ts packages/ora-plan-core/src/parser/jsonPlanParser.ts packages/ora-plan-core/src/parser/xbiParser.ts packages/ora-plan-core/src/parser/sqlMonitorParser.ts src/lib/agentHandoff.ts src/lib/__tests__/agentHandoff.test.ts src/lib/parser/__tests__`
> If any in-scope file changed since this plan was written, compare the
> "Current state" excerpts against the live code before proceeding; on a
> mismatch, treat it as a STOP condition. Other plans may have landed first and
> shifted line numbers; match on the quoted code, not the line number.
> `plans/012-plan-table-prefix-and-nbsp.md` and
> `plans/013-display-cursor-sql-text.md` edit `values.ts`, `dbmsXplanParser.ts`
> and `sqlMonitorParser.ts` in other places (new helpers in `values.ts`, the
> `parse` entry lines, the SQL-text collection); the lines this plan quotes are
> not changed by them. The import lists from `./values.ts` in the two text
> parsers will differ from the excerpt if plan 012 landed — that is expected.
> `plans/015-small-correctness-fixes.md` rewrites `extractSqlId` in
> `sqlMonitorParser.ts` and must run **after** this plan.

## Status

- **Priority**: P2
- **Effort**: S
- **Risk**: LOW
- **Depends on**: `plans/013-display-cursor-sql-text.md` (same file — run after
  it to avoid edit conflicts; no logical dependency)
- **Category**: security
- **Planned at**: commit `b5635d8`, 2026-11-11

## Why this matters

Plan text is untrusted input: it is pasted from tickets and chats, and it
arrives in share links made by other people. Every parser copies whatever
stands where the SQL_ID and plan hash value should be into `ParsedPlan.sqlId` /
`ParsedPlan.planHashValue` without checking it: any run of non-blank characters
after `SQL_ID` in a DBMS_XPLAN header, any string in a JSON/CSV `sql_id` field,
any text content or attribute value in SQL Monitor XML (including line breaks),
any `\w+` word of any length in SQL Monitor text and xbi output.

Those two values are then written, unescaped, into the **instruction part** of
the Agent-handoff prompt — the heading, the task, and the "exact read-only SQL
… ready to paste" lines (`sql_id => '<value>'`, `WHERE sql_id = '<value>'`,
`@gather_plan_metadata.sql <value> <value>`). That prompt is pasted into a
coding agent that the prompt itself encourages to run queries against the
database. A crafted plan can therefore place its own text and SQL fragments
where the agent reads instructions rather than data. One more value, the
highlight colour of an annotation (which can come from a share link without
validation), is printed without being limited to one line.

After this plan a value that is not shaped like a SQL_ID (letters and digits,
at most 13) or a plan hash (digits) is simply dropped at the parser boundary,
so every consumer — handoff, script dialogs, metadata pairing, exports —
inherits the guarantee; the handoff checks once more and prints a highlight
colour only when it is a known one.

## Current state

### Repository rules that apply

- The real code is in `packages/ora-plan-core/src/...`. Same-named files under
  `src/lib/` (`src/lib/parser/values.ts`, `src/lib/parser/index.ts`, …) are
  one-line `export *` shims — **never edit a shim**. App code and tests import
  through the shims (`from './parser/values'`, `from '../values'`).
- Inside the package, sibling imports carry an explicit `.ts` extension; no
  React, no DOM (except `DOMParser` for SQL Monitor XML). `import type` for
  type-only imports. TypeScript strict.
- Fixtures in `src/lib/parser/__tests__/fixtures/` and examples in
  `src/examples/` are real captures: never edit them; tests build odd inputs in
  memory (`text.replace(realId, oddString)`).
- Every fixture and example must keep parsing with no `ParsedPlan.warnings`.
  This plan adds **no** warning: a malformed id is dropped silently.
- `src/lib/agentHandoff.ts` contains a "Reading the numbers" block
  (`readingRules`) and inventory texts with fetch SQL that are kept in sync by
  hand with `skills/oracle-plan-analysis/`. **Their wording must not change.**
  This plan changes only *which value* is interpolated into three of those
  template strings, never the surrounding text.
- In tests, do not use exploit strings. The odd values in this plan are
  harmless stand-ins (`not "an" id`, `not_a_real_sql_id_value`, `12 34`).

### Decision: the shape rule

- SQL_ID: `/^[0-9A-Za-z]{1,13}$/` (trimmed; case kept).
- Plan hash value: `/^\d+$/` (trimmed).

Evidence: the 22 fixtures and examples that carry a SQL_ID (20 distinct ids)
all have exactly 13 characters of `[0-9a-z]`. A strict "exactly 13" rule was tried against a
scratch copy and breaks 6 existing tests in 4 files that feed short synthetic
ids (`abc123`, `parallel123`, …) through the parsers
(`csvImport.test.tsx`, `csvPlan.test.ts`, `jsonPlan.test.ts`,
`sqlMonitorXml.test.ts`); the 1–13 rule breaks none, is the rule the app's own
script dialog already enforces (`SQL_ID_RE = /^[a-z0-9]{1,13}$/i` and
`PLAN_HASH_RE = /^\d+$/` in `src/components/BaselineScriptModal.tsx:20-21`),
and is enough for the purpose: no blanks, quotes, underscores, punctuation or
line breaks, at most 13 characters.

### Excerpts (commit `b5635d8`)

`packages/ora-plan-core/src/parser/dbmsXplanParser.ts:304-307` and `:326`
(inside `extractSqlHeader`):

```ts
    const idMatch = lines[i].match(/^\s*SQL_ID\s+(\S+?)(?:\s*,.*)?\s*$/i);
    if (!idMatch) continue;

    const sqlId = idMatch[1].replace(/[.,;]+$/, '');
```

```ts
    return { sqlId: sqlId || undefined, childNumber, sqlText: sqlText || undefined };
```

(The plan hash of this parser comes from `/Plan\s+hash\s+value\s*:\s*(\d+)/i` —
digits already; no change there.)

`packages/ora-plan-core/src/parser/jsonPlanParser.ts:126-129` (inside
`buildPlanFromRows`, which the CSV parser also uses):

```ts
  // Try to extract plan hash from the data (some scripts include it as metadata)
  const planHashValue = getStr(normalized[0], 'plan_hash_value') ||
    getStr(normalized[0], 'plan_hash') || undefined;
  const sqlId = getStr(normalized[0], 'sql_id') || undefined;
```

`packages/ora-plan-core/src/parser/xbiParser.ts:126-133`:

```ts
function extractSqlId(lines: string[]): string | undefined {
  for (const line of lines) {
    // From banner: "sql_id=czxpthmzk8nnd"
    const match = line.match(/sql_id[=]\s*(\w+)/i);
    if (match) return match[1];
  }
  return undefined;
}
```

`packages/ora-plan-core/src/parser/sqlMonitorParser.ts:222-233` (text report):

```ts
function extractSqlId(lines: string[]): string | undefined {
  for (const line of lines) {
    // Matches both the SQL Monitor header ("SQL ID : 7ch0an9vx5ysp") and the
    // DBMS_XPLAN.DISPLAY_CURSOR header ("SQL_ID  7ch0an9vx5ysp, child number 0"),
    // which this parser also handles via its A-Rows detection.
    const match = line.match(/SQL[\s_]*ID[:\s]+(\w+)/i);
    if (match) {
      return match[1];
    }
  }
  return undefined;
}
```

`sqlMonitorParser.ts:663-671` (real XML format, inside `parseRealOracleXml`):

```ts
  const sqlId =
    reportParams?.querySelector('sql_id')?.textContent?.trim() ||
    target?.getAttribute('sql_id') ||
    undefined;

  const planHashValue =
    target?.getAttribute('sql_plan_hash') ||
    reportParams?.querySelector('plan_hash')?.textContent?.trim() ||
    undefined;
```

`sqlMonitorParser.ts:1417-1418` (legacy XML, inside `parseLegacyXml`):

```ts
  const sqlId = getXmlText(doc, 'sql_id');
  const planHashValue = getXmlText(doc, 'plan_hash');
```

`src/lib/agentHandoff.ts` — the five places that print the two values, plus
the colour:

```ts
// :6-8
import { hasAnnotations } from './annotations';
import { buildAnalyzeSections, buildCompareSections, estimateTokens } from './ai/context';
import { getSourceDisplayName } from './parser';
```

```ts
// :126 (inside renderAnnotations)
    if (highlight) bits.push(` [highlighted ${highlight.color}]`);
```

```ts
// :220-222
function sqlIdLiteral(plan: ParsedPlan): string {
  return plan.sqlId ? `'${plan.sqlId}'` : `'<SQL_ID>'`;
}
```

```ts
// :295 (inside planInventory; one long template string — only the two ${…} parts shown matter)
              : `not attached. To get it: ${APP_NAME}'s gather script (in the app: Metadata, then Gather script; \`@gather_plan_metadata.sql ${plan.sqlId ?? '<SQL_ID>'}${plan.planHashValue ? ` ${plan.planHashValue}` : ''}\`), or targeted queries on DBA_TAB_STATISTICS, DBA_TAB_COL_STATISTICS and DBA_INDEXES`,
```

```ts
// :370-375 (inside headingFor)
  const id = (plan: ParsedPlan) => {
    const bits: string[] = [];
    if (plan.sqlId) bits.push(`SQL_ID \`${plan.sqlId}\``);
    if (plan.planHashValue) bits.push(`plan hash value \`${plan.planHashValue}\``);
    return bits.join(', ');
  };
```

```ts
// :391-392 (inside taskFor)
  const idA = planA.plan.sqlId;
  const idB = planB.plan.sqlId;
```

`src/lib/annotations.ts:181-183` already exports the colour check to use:

```ts
export function isHighlightColor(value: unknown): value is HighlightColor {
  return typeof value === 'string' && VALID_HIGHLIGHT_COLORS.has(value);
}
```

The rest of an annotation line is already limited to one line by the local
`oneLine()` helper (notes, group names, group notes), so the colour is the
only gap.

### Test helpers to reuse

`src/lib/__tests__/agentHandoff.test.ts` has `monitoredPlan()` (a `ParsedPlan`
with `sqlId = 'abc123def4567'`, `planHashValue = '2058068615'`), `analyze(plan)`
and `handoff(source)`. Existing assertions such as
``'# Oracle execution plan review: SQL_ID `abc123def4567`, plan hash value `2058068615`'``
and `` `@gather_plan_metadata\.sql abc123def4567 2058068615` `` must keep
passing unchanged.

### Verified outcome of the design

Applied to a scratch copy: all existing tests pass without any expectation
change, the parsed output of every fixture and example is byte-identical, and
the 28 new tests below pass.

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Install | `npm ci` | exit 0 |
| Lint | `npm run lint` | exit 0 |
| Typecheck | `npm run typecheck` | exit 0, no errors |
| All tests | `npm test` | builds the core package, then vitest; at `b5635d8`: `Test Files 155 passed (155)`, `Tests 1787 passed (1787)`, ~15 s (more if earlier plans landed) |
| One file | `npx vitest run --environment jsdom src/lib/parser/__tests__/planIdentity.test.ts` | all pass |

## Scope

**In scope** (the only files you should modify):

- `packages/ora-plan-core/src/parser/values.ts` — add two functions
- `packages/ora-plan-core/src/parser/dbmsXplanParser.ts` — one line + import
- `packages/ora-plan-core/src/parser/jsonPlanParser.ts` — three lines + import
- `packages/ora-plan-core/src/parser/xbiParser.ts` — one line + import
- `packages/ora-plan-core/src/parser/sqlMonitorParser.ts` — three places + import
- `src/lib/agentHandoff.ts` — the six places quoted above
- `src/lib/parser/__tests__/planIdentity.test.ts` (create)
- `src/lib/__tests__/agentHandoff.test.ts` — add two tests
- `plans/README.md` (status row only)

**Out of scope** (do NOT touch, even though they look related):

- The text of `readingRules`, `ASKING_RULES`, `answerShape` and every inventory
  sentence in `agentHandoff.ts`; and everything under `skills/`.
- `src/lib/baselineScript.ts`, `src/lib/sqlPatchScript.ts`,
  `src/components/BaselineScriptModal.tsx`, `GatherScriptModal.tsx` — their
  dialogs already validate both values before a script is built.
- Validation of annotations that arrive in share links
  (`src/lib/annotations.ts`, `src/hooks/usePlanContext.tsx`) — a larger change.
- Tab labels in the compare heading (`source.planA.label`) — user-typed.
- `agentHandoffFilename` (already strips everything but `[A-Za-z0-9_-]`).
- Adding a parser warning for a dropped id.
- The `src/lib/parser/*.ts` shims.

## Git workflow

- Branch: `fix/validate-sql-id-and-plan-hash`
- Conventional-commit message in the repo's style (example from history:
  `fix(lint): satisfy eslint-plugin-react-hooks 7.1 / react-refresh 0.5`), e.g.
  `fix(parser): drop SQL_ID / plan hash values that are not well-formed`.
- Do NOT push or open a PR unless the operator instructed it.

## Steps

### Step 1: Record what every fixture and example parses to today

Create this script **outside the repository** and run it from the repository
root:

```bash
mkdir -p /tmp/oraplan-014
cat > /tmp/oraplan-014/dump-plans.mts <<'EOF'
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
npx tsx /tmp/oraplan-014/dump-plans.mts > /tmp/oraplan-014/before.json
```

**Verify**: `node -e "const o=require('/tmp/oraplan-014/before.json'); console.log(Object.keys(o).length, Object.values(o).filter(p=>p.sqlId).length)"`
→ `28 22` (28 files parsed, 22 of them with a SQL_ID).

### Step 2: Add the two normalisers to `values.ts`

In `packages/ora-plan-core/src/parser/values.ts`, directly **above**
`function scaled(` add:

```ts
/**
 * A SQL_ID as Oracle prints it: letters and digits only, at most 13 characters (real ones are
 * exactly 13; shorter ones turn up in hand-edited plans). Anything else is not a SQL_ID.
 */
const SQL_ID_SHAPE = /^[0-9A-Za-z]{1,13}$/;
/** A plan hash value: digits only. */
const PLAN_HASH_SHAPE = /^\d+$/;

/**
 * The SQL_ID found in plan input, or undefined when the text does not have the shape of one.
 * Plan input is untrusted (a pasted plan, a share link) and the id is later written into
 * generated SQL and into prompts, so nothing but a well-formed id may get through.
 */
export function normalizeSqlId(value: string | null | undefined): string | undefined {
  const text = value?.trim();
  return text && SQL_ID_SHAPE.test(text) ? text : undefined;
}

/** The plan hash value found in plan input, or undefined when it is not all digits. See `normalizeSqlId`. */
export function normalizePlanHash(value: string | null | undefined): string | undefined {
  const text = value?.trim();
  return text && PLAN_HASH_SHAPE.test(text) ? text : undefined;
}
```

**Verify**: `npm run typecheck` → exit 0.

### Step 3: Apply them at every parser assignment

1. `dbmsXplanParser.ts`
   - add `normalizeSqlId` to the existing import from `./values.ts`;
   - in `extractSqlHeader`, change the `return` line of the SQL_ID shape from
     `sqlId: sqlId || undefined` to `sqlId: normalizeSqlId(sqlId)` (leave
     `childNumber` and `sqlText` in that line as they are).

2. `jsonPlanParser.ts`
   - add a new import line after the existing imports:
     `import { normalizePlanHash, normalizeSqlId } from './values.ts';`
   - replace the three lines quoted in "Current state" with:

     ```ts
       const planHashValue = normalizePlanHash(
         getStr(normalized[0], 'plan_hash_value') || getStr(normalized[0], 'plan_hash'),
       );
       const sqlId = normalizeSqlId(getStr(normalized[0], 'sql_id'));
     ```

     (keep the `// Try to extract plan hash …` comment above them).

3. `xbiParser.ts`
   - add a new import line after the existing imports:
     `import { normalizeSqlId } from './values.ts';`
   - in `extractSqlId`, change `if (match) return match[1];` to
     `if (match) return normalizeSqlId(match[1]);`

4. `sqlMonitorParser.ts`
   - add `normalizePlanHash` and `normalizeSqlId` to the existing import from
     `./values.ts`;
   - text report, `extractSqlId`: change `return match[1];` to
     `return normalizeSqlId(match[1]);` (if `plans/015-small-correctness-fixes.md`
     already rewrote this function, both of its `return match[1]`-style lines
     must be wrapped the same way; normally 015 runs after this plan);
   - real XML, `parseRealOracleXml`: replace the two assignments quoted in
     "Current state" with:

     ```ts
       const sqlId = normalizeSqlId(
         reportParams?.querySelector('sql_id')?.textContent?.trim() || target?.getAttribute('sql_id'),
       );

       const planHashValue = normalizePlanHash(
         target?.getAttribute('sql_plan_hash') || reportParams?.querySelector('plan_hash')?.textContent?.trim(),
       );
     ```

   - legacy XML, `parseLegacyXml`:

     ```ts
       const sqlId = normalizeSqlId(getXmlText(doc, 'sql_id'));
       const planHashValue = normalizePlanHash(getXmlText(doc, 'plan_hash'));
     ```

**Verify**:
- `npm run typecheck` → exit 0
- `npx vitest run --environment jsdom src/lib/parser src/hooks` → all pass
- `npx tsx /tmp/oraplan-014/dump-plans.mts > /tmp/oraplan-014/after.json && cmp /tmp/oraplan-014/before.json /tmp/oraplan-014/after.json && echo IDENTICAL`
  → prints `IDENTICAL`

### Step 4: Re-check in the handoff, and print only known colours

In `src/lib/agentHandoff.ts`:

1. Imports: change `import { hasAnnotations } from './annotations';` to
   `import { hasAnnotations, isHighlightColor } from './annotations';` and add,
   after the `import { getSourceDisplayName } from './parser';` line:
   `import { normalizePlanHash, normalizeSqlId } from './parser/values';`

2. `renderAnnotations`: replace the `if (highlight) bits.push(…)` line with:

   ```ts
       // The colour comes from stored or shared annotations: print it only when it is one of ours.
       if (highlight) bits.push(isHighlightColor(highlight.color) ? ` [highlighted ${highlight.color}]` : ' [highlighted]');
   ```

3. Replace `function sqlIdLiteral` with:

   ```ts
   /**
    * The plan's SQL_ID / plan hash value for the instruction part of the prompt (heading, task,
    * ready-to-paste SQL). The parsers already drop malformed ids; they are checked again here
    * because this text is read by an agent as instructions, not as data.
    */
   function safeSqlId(plan: ParsedPlan): string | undefined {
     return normalizeSqlId(plan.sqlId);
   }

   function safePlanHash(plan: ParsedPlan): string | undefined {
     return normalizePlanHash(plan.planHashValue);
   }

   function sqlIdLiteral(plan: ParsedPlan): string {
     const sqlId = safeSqlId(plan);
     return sqlId ? `'${sqlId}'` : `'<SQL_ID>'`;
   }
   ```

4. In the long gather-script template string inside `planInventory`, change
   **only** the two interpolations:
   `${plan.sqlId ?? '<SQL_ID>'}` → `${safeSqlId(plan) ?? '<SQL_ID>'}` and
   ``${plan.planHashValue ? ` ${plan.planHashValue}` : ''}`` →
   ``${safePlanHash(plan) ? ` ${safePlanHash(plan)}` : ''}``.
   Every other character of that string stays.

5. `headingFor`: replace the body of the inner `id` function with:

   ```ts
       const bits: string[] = [];
       const sqlId = safeSqlId(plan);
       const planHash = safePlanHash(plan);
       if (sqlId) bits.push(`SQL_ID \`${sqlId}\``);
       if (planHash) bits.push(`plan hash value \`${planHash}\``);
       return bits.join(', ');
   ```

6. `taskFor`: `const idA = safeSqlId(planA.plan);` and
   `const idB = safeSqlId(planB.plan);`

**Verify**:
- `npm run typecheck` → exit 0
- `npx vitest run --environment jsdom src/lib/__tests__/agentHandoff.test.ts src/components/__tests__/AgentHandoffDialog.test.tsx`
  → all pass, no expectation edited
- `grep -n "plan\.sqlId\|plan\.planHashValue" src/lib/agentHandoff.ts` → exactly
  three lines: inside `safeSqlId`, inside `safePlanHash`, and the `slug` helper
  of `agentHandoffFilename`

### Step 5: Add the tests

Create `src/lib/parser/__tests__/planIdentity.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { parsePlan } from '../index';
import { normalizePlanHash, normalizeSqlId } from '../values';

const FIXTURES = join(__dirname, 'fixtures');
const EXAMPLES = join(__dirname, '../../../examples');
const fixture = (name: string): string => readFileSync(join(FIXTURES, name), 'utf-8');
const example = (name: string): string => readFileSync(join(EXAMPLES, name), 'utf-8');

/** Harmless stand-ins for text that is not an id: blanks, quotes, a line break, an over-long word. */
const ODD_SQL_ID = 'not "an" id';
const LONG_WORD = 'not_a_real_sql_id_value';

describe('normalizeSqlId / normalizePlanHash', () => {
  it('keeps well-formed values (trimmed)', () => {
    expect(normalizeSqlId('7ch0an9vx5ysp')).toBe('7ch0an9vx5ysp');
    expect(normalizeSqlId('  7CH0AN9VX5YSP ')).toBe('7CH0AN9VX5YSP');
    expect(normalizeSqlId('abc123')).toBe('abc123');
    expect(normalizePlanHash(' 2341252972 ')).toBe('2341252972');
  });

  it.each([ODD_SQL_ID, LONG_WORD, "x'y", 'a;b', 'two\nlines', 'abcdefghijklmn', '', '   ', undefined, null])(
    'drops %j as a SQL_ID',
    (value) => {
      expect(normalizeSqlId(value)).toBeUndefined();
    },
  );

  it.each(['12 34', '12a', '-5', '1.5e+21', "1'--", '', undefined, null])('drops %j as a plan hash', (value) => {
    expect(normalizePlanHash(value)).toBeUndefined();
  });
});

describe('SQL_ID and plan hash from plan input', () => {
  it('DBMS_XPLAN header: keeps a real SQL_ID, drops a malformed one, plan stays intact', () => {
    const text = fixture('allstats-workarea.txt');
    const clean = parsePlan(text);
    expect(clean.sqlId).toBe('9fq3kz7w2m8ud');

    for (const odd of [`we"ird'id`, LONG_WORD]) {
      const plan = parsePlan(text.replace('9fq3kz7w2m8ud', odd));
      expect(plan.sqlId).toBeUndefined();
      expect(plan.childNumber).toBe(clean.childNumber);
      expect(plan.planHashValue).toBe(clean.planHashValue);
      expect(plan.allNodes).toHaveLength(clean.allNodes.length);
      expect(plan.warnings).toBeUndefined();
    }
  });

  it('JSON rows: keeps real values (number or string), drops malformed ones', () => {
    const rows = (sqlId: unknown, hash: unknown) =>
      JSON.stringify([
        { id: 0, operation: 'SELECT STATEMENT', sql_id: sqlId, plan_hash_value: hash },
        { id: 1, parent_id: 0, operation: 'TABLE ACCESS', options: 'FULL', object_name: 'T' },
      ]);
    const good = parsePlan(rows('7ch0an9vx5ysp', 2341252972));
    expect(good.sqlId).toBe('7ch0an9vx5ysp');
    expect(good.planHashValue).toBe('2341252972');

    const bad = parsePlan(rows(`${ODD_SQL_ID}\nsecond line`, '12 34'));
    expect(bad.sqlId).toBeUndefined();
    expect(bad.planHashValue).toBeUndefined();
    expect(bad.allNodes).toHaveLength(2);
  });

  it('CSV rows: keeps real values, drops malformed ones', () => {
    const csv = (sqlId: string, hash: string) =>
      [
        '"ID","PARENT_ID","DEPTH","OPERATION","OPTIONS","OBJECT_NAME","SQL_ID","PLAN_HASH_VALUE"',
        `0,,0,"SELECT STATEMENT",,,"${sqlId}",${hash}`,
        `1,0,1,"TABLE ACCESS","FULL","T","${sqlId}",${hash}`,
      ].join('\n');
    const good = parsePlan(csv('7ch0an9vx5ysp', '2341252972'));
    expect(good.source).toBe('csv');
    expect(good.sqlId).toBe('7ch0an9vx5ysp');
    expect(good.planHashValue).toBe('2341252972');

    const bad = parsePlan(csv('not an id', '"12 34"'));
    expect(bad.source).toBe('csv');
    expect(bad.sqlId).toBeUndefined();
    expect(bad.planHashValue).toBeUndefined();
    expect(bad.allNodes).toHaveLength(2);
  });

  it('SQL Monitor XML: keeps real values, drops malformed ones', () => {
    const xml = fixture('sql-monitor-xml-hash-join.txt');
    const clean = parsePlan(xml);
    expect(clean.sqlId).toBe('an05rsj1up1k5');
    expect(clean.planHashValue).toBe('2341252972');

    const plan = parsePlan(xml.split('an05rsj1up1k5').join('not an id').split('"2341252972"').join('"23x41"'));
    expect(plan.source).toBe('sql_monitor_xml');
    expect(plan.sqlId).toBeUndefined();
    expect(plan.planHashValue).toBeUndefined();
    expect(plan.allNodes).toHaveLength(clean.allNodes.length);
  });

  it('legacy SQL Monitor XML: drops malformed values', () => {
    const xml = (sqlId: string, hash: string) =>
      `<?xml version="1.0"?><report><sql_id>${sqlId}</sql_id><plan_hash>${hash}</plan_hash>` +
      '<operation id="0" name="SELECT STATEMENT" depth="0"/><operation id="1" name="TABLE ACCESS FULL" depth="1"/></report>';
    const good = parsePlan(xml('7ch0an9vx5ysp', '42'));
    expect(good.allNodes).toHaveLength(2);
    expect(good.sqlId).toBe('7ch0an9vx5ysp');
    expect(good.planHashValue).toBe('42');
    const bad = parsePlan(xml('not an id', '4 2'));
    expect(bad.allNodes).toHaveLength(2);
    expect(bad.sqlId).toBeUndefined();
    expect(bad.planHashValue).toBeUndefined();
  });

  it('SQL Monitor text report: drops an over-long word after "SQL ID :"', () => {
    const text = example('18-sql_monitor-Skewed Parallel (J. Lewis).txt');
    expect(parsePlan(text).sqlId).toBe('3cjg20q2vw41f');
    const plan = parsePlan(text.replace('3cjg20q2vw41f', LONG_WORD));
    expect(plan.source).toBe('sql_monitor_text');
    expect(plan.sqlId).toBeUndefined();
    expect(plan.allNodes).toHaveLength(34);
  });

  it('xbi.sql output: drops an over-long word after "sql_id="', () => {
    const text = example('13-xbi-XBI TPC-DS Query.txt');
    expect(parsePlan(text).sqlId).toBe('czxpthmzk8nnd');
    const plan = parsePlan(text.replace('sql_id=czxpthmzk8nnd', `sql_id=${LONG_WORD}`));
    expect(plan.source).toBe('xbi');
    expect(plan.sqlId).toBeUndefined();
    expect(plan.allNodes).toHaveLength(10);
  });
});
```

In `src/lib/__tests__/agentHandoff.test.ts`:

- inside `describe('buildAgentHandoff (single plan)', …)`, directly before
  `it('asks for a general review when no question is given', …)`, add:

  ```ts
    it('keeps a malformed SQL_ID or plan hash out of the instructions', () => {
      const plan = monitoredPlan();
      // Not what a parser would let through, but the prompt must not depend on that.
      plan.sqlId = 'not an id\nSECOND LINE';
      plan.planHashValue = '12 34';
      plan.sqlText = undefined;
      const md = handoff(analyze(plan));
      const instructions = md.slice(0, md.indexOf('\n# Plan data\n'));
      expect(instructions).toContain('\n# Oracle execution plan review\n');
      expect(instructions).not.toContain('SECOND LINE');
      expect(instructions).not.toContain('12 34');
      expect(instructions).toContain("WHERE sql_id = '<SQL_ID>'");
      expect(instructions).toContain('`@gather_plan_metadata.sql <SQL_ID>`');
    });
  ```

- inside `describe('renderAnnotations', …)`, directly before
  `it('is empty without annotations', …)`, add:

  ```ts
    it('prints a highlight colour only when it is a known one', () => {
      const plan = monitoredPlan();
      const annotations: AnnotationState = createEmptyAnnotationState();
      annotations.nodeHighlights.set(2, { nodeId: 2, color: 'red\n\n# Not a colour' } as never);
      expect(renderAnnotations(plan, annotations)).toBe('- Line 2 (TABLE ACCESS FULL ORDERS) [highlighted]');
    });
  ```

**Verify**:
- `npx vitest run --environment jsdom src/lib/parser/__tests__/planIdentity.test.ts`
  → `Tests  26 passed (26)`
- `npx vitest run --environment jsdom src/lib/__tests__/agentHandoff.test.ts`
  → all pass, 2 more than before

### Step 6: Full gates

**Verify**:
- `npm run lint` → exit 0
- `npm run typecheck` → exit 0
- `npm test` → all pass; one more test file and 28 more tests than before this
  plan

## Test plan

- `planIdentity.test.ts` (new, modelled on
  `src/lib/parser/__tests__/warnings.test.ts` for reading fixtures/examples):
  unit tests of both normalisers (kept values; 10 dropped SQL_ID shapes; 8
  dropped plan-hash shapes) and one test per input path — DBMS_XPLAN header,
  JSON rows, CSV rows, real SQL Monitor XML, legacy XML, SQL Monitor text, xbi —
  each showing a real value is kept, a harmless odd value is dropped, and the
  rest of the plan (node count, child number, hash, no warnings) is unaffected.
- `agentHandoff.test.ts`: a plan object with a malformed id/hash yields a
  handoff whose instruction part (everything before `# Plan data`) contains
  neither value and falls back to the `<SQL_ID>` placeholder; an unknown
  highlight colour is not printed.
- Existing tests that must pass **unchanged**: the whole `agentHandoff.test.ts`,
  `AgentHandoffDialog.test.tsx`, `csvPlan.test.ts`, `jsonPlan.test.ts`,
  `sqlMonitorXml.test.ts`, `src/hooks/__tests__/csvImport.test.tsx` (they use
  short synthetic ids such as `abc123`, which the 1–13 rule keeps).

## Done criteria

Machine-checkable. ALL must hold:

- [ ] `npm run lint` exits 0
- [ ] `npm run typecheck` exits 0
- [ ] `npm test` exits 0; `planIdentity.test.ts` exists (26 tests) and the two
      new handoff tests pass
- [ ] `cmp /tmp/oraplan-014/before.json /tmp/oraplan-014/after.json` exits 0
- [ ] `grep -c "normalizeSqlId" packages/ora-plan-core/src/parser/dbmsXplanParser.ts packages/ora-plan-core/src/parser/jsonPlanParser.ts packages/ora-plan-core/src/parser/xbiParser.ts packages/ora-plan-core/src/parser/sqlMonitorParser.ts`
      shows a count ≥ 2 for every file (import + use)
- [ ] `grep -n "plan\.sqlId\|plan\.planHashValue" src/lib/agentHandoff.ts`
      shows exactly 3 lines (`safeSqlId`, `safePlanHash`, `agentHandoffFilename`)
- [ ] `git diff b5635d8 -- skills/` is empty
- [ ] `git status --porcelain` lists only the in-scope files
- [ ] `plans/README.md` status row updated

## STOP conditions

Stop and report back (do not improvise) if:

- An excerpt in "Current state" does not match the live code (other than the
  documented differences caused by plans 012/013).
- The dump comparison in Step 3 is not identical — a real capture would lose
  its SQL_ID or plan hash; the shape rule must not be loosened or tightened
  without a human decision.
- Any existing test needs its expectation changed to pass. In particular, do
  **not** tighten the SQL_ID rule to "exactly 13 characters": it breaks six
  existing tests that use short ids on purpose.
- A grep finds another place in `packages/ora-plan-core/src/parser/` that
  assigns `sqlId` or `planHashValue` from input and is not listed in Step 3
  (`grep -n "sqlId\b\|planHashValue\b" packages/ora-plan-core/src/parser/*.ts`).
- The handoff change seems to require editing the wording of an inventory
  sentence or anything under `skills/`.

## Maintenance notes

- New parser, or new place that reads a SQL_ID / plan hash from input: pass it
  through `normalizeSqlId` / `normalizePlanHash`. The handoff's second check
  (`safeSqlId` / `safePlanHash`) is the backstop, not the gate.
- The dialogs keep their own copies of the two regexes
  (`BaselineScriptModal.tsx:20-21`, `GatherScriptModal.tsx`). They agree with
  the normalisers today; a follow-up could import one shared pattern.
- Deferred on purpose: (1) the script builders `buildBaselineScript` /
  `buildSqlPatchScript` still rely on their only caller's validation and on a
  character-stripping `sanitize()` backstop; (2) annotations from share links
  are not schema-validated (`validateExport` runs only for file imports) — the
  handoff now prints them safely, but other consumers should not assume shape;
  (3) tab labels in the compare heading are printed as typed.
- Reviewer: confirm no text changed in `readingRules`, the inventory sentences
  or the fetch SQL (the diff of `agentHandoff.ts` should touch only imports,
  one line in `renderAnnotations`, `sqlIdLiteral` and its two new helpers, two
  `${…}` expressions, `headingFor` and two lines of `taskFor`).
