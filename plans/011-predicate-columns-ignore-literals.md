# Plan 011: Predicate column lists contain only columns (no literals, binds or function names)

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**:
> `git diff --stat b5635d8..HEAD -- packages/ora-plan-core/src/metadata/predicateColumns.ts packages/ora-plan-core/src/advisor/rules/sargable.ts src/lib/metadata/__tests__/predicateColumns.test.ts src/lib/advisor/__tests__/selectiveFullScan.test.ts src/lib/advisor/__tests__/statsIssues.test.ts`
> If any in-scope file changed since this plan was written, compare the
> "Current state" excerpts against the live code before proceeding; on a
> mismatch, treat it as a STOP condition. Other plans may have landed first and
> shifted line numbers; match on the quoted code, not the line number.
> `src/lib/advisor/__tests__/selectiveFullScan.test.ts` also gets a new
> `describe` appended by `plans/010-selective-full-scan-per-execution.md`
> (this plan inserts one test inside the existing "actuals fallback path"
> `describe`, so the two do not collide). This plan does not edit
> `packages/ora-plan-core/src/advisor/rules/selectiveFullScan.ts`.

## Status

- **Priority**: P1
- **Effort**: S
- **Risk**: LOW
- **Depends on**: none (run after `plans/010-selective-full-scan-per-execution.md` only to avoid two open branches adding tests to the same test file)
- **Category**: bug
- **Planned at**: commit `b5635d8`, 2026-11-11

## Why this matters

`extractPredicateColumns` is supposed to return the column names a plan line's
access and filter predicates reference. It matches every bare word instead, so
string literals, date format masks, bind variable names and function names come
back as "columns". The advisor prints them: for the filter
`"E"."STATUS"='ACTIVE' AND "E"."HIRED">TO_DATE(' 2024-01-01 00:00:00', 'syyyy-mm-dd hh24:mi:ss') AND "E"."DEPT_ID"=:B1`
the Selective-full-scan finding says "Consider an index on STATUS, ACTIVE,
HIRED, SYYYY, MM, DD, HH24, MI, SS, DEPT_ID, B1". On the repository's own real
captures and bundled examples, 84 of 141 predicates return junk such as `B1`,
`BITAND`, `SYS_CONTEXT`, `USERENV`, `_NEXT_OBJECT`. The same list decides the
"cardinality mismatch, no histogram on predicate column" badge and finding, so
a literal that happens to equal another column's name can hide or distort it,
and it selects which column statistics are sent to an AI provider. The
repository already has a real predicate tokenizer (in the advisor's
`sargable.ts`) that knows literals, binds, numbers, function calls and
keywords; this plan makes the naive extractor delegate to it.

## Current state

Layout rule for this repository: the real code is in
`packages/ora-plan-core/src/...`. Files with the same name under `src/lib/`
(for example `src/lib/metadata/predicateColumns.ts`) are one-line `export *`
shims — **never edit a shim**. Inside the package, sibling imports carry an
explicit `.ts` extension; no React, no DOM. `import type` for type-only imports.

Oracle semantics that must not break (project rules, quoted; this plan does not
touch any of the numbers, the quote is here so nothing is "fixed" by accident):

> E-Rows is per start, A-Rows is cumulative. Compare A-Rows only with
> `estimatedRowsTotal` via `nodeCardinalityRatio(node)`; never
> `actualRows / rows`. Cost is cumulative. Inactive adaptive rows
> (`PlanNode.inactive`) are excluded from totals, hotspots, self numbers and
> every advisor rule. Aliases are normalised without quotes across all parsers.

How Oracle prints predicates (what the parser stores in
`PlanNode.accessPredicates` / `filterPredicates`): every column reference is a
quoted identifier, usually alias-qualified (`"E"."SAL"`); string literals are in
single quotes with `''` for an embedded quote; binds are `:B1`, `:1`,
`:SYS_B_0`; functions and keywords are bare words (`TO_DATE(`, `BITAND(`,
`IS NULL`, `OVER ( PARTITION BY …`).

### The naive extractor (to be replaced)

`packages/ora-plan-core/src/metadata/predicateColumns.ts` — the whole file:

```ts
const SQL_KEYWORDS = new Set([
  'AND', 'OR', 'NOT', 'IS', 'NULL', 'IN', 'BETWEEN', 'LIKE', 'EXISTS',
  'CASE', 'WHEN', 'THEN', 'ELSE', 'END', 'AS', 'ON', 'USING',
  'TRUE', 'FALSE', 'UPPER', 'LOWER', 'SUBSTR', 'TRIM', 'NVL', 'COALESCE',
  'TO_CHAR', 'TO_NUMBER', 'TO_DATE', 'TO_TIMESTAMP', 'CAST', 'DECODE',
  'ROUND', 'FLOOR', 'CEIL', 'ABS', 'MOD', 'LENGTH', 'INSTR',
  'SYSDATE', 'SYSTIMESTAMP', 'CURRENT_DATE', 'CURRENT_TIMESTAMP',
  'ROWNUM', 'ROWID',
]);

const IDENTIFIER_RUN = /(?:"[^"]+"|[A-Za-z_][A-Za-z0-9_$#]*)(?:\.(?:"[^"]+"|[A-Za-z_][A-Za-z0-9_$#]*)){0,2}/g;

function stripQuotes(part: string): string {
  if (part.startsWith('"') && part.endsWith('"')) return part.slice(1, -1);
  return part;
}

export function extractPredicateColumns(
  ...predicates: Array<string | undefined>
): string[] {
  const seen = new Set<string>();
  for (const predicate of predicates) {
    if (!predicate) continue;
    const matches = predicate.match(IDENTIFIER_RUN) ?? [];
    for (const run of matches) {
      const parts = run.split('.').map(stripQuotes);
      const col = parts[parts.length - 1].toUpperCase();
      if (!col) continue;
      if (SQL_KEYWORDS.has(col)) continue;
      if (/^[0-9]/.test(col)) continue;
      seen.add(col);
    }
  }
  return [...seen];
}
```

Contract to keep: variadic `(...predicates: Array<string | undefined>)`,
returns upper-cased bare column names, de-duplicated, first seen first.

Callers (none needs a change): `advisor/rules/selectiveFullScan.ts:101,122`
(suggestion text), `advisor/rules/statsIssues.ts:37-39` (no-histogram badge),
`src/components/NodeDetailPanel.tsx:1184`, `src/components/views/HierarchicalView.tsx:554`,
`src/lib/ai/metadataProjection.ts:20`.

### The tokenizer that already does this right

`packages/ora-plan-core/src/advisor/rules/sargable.ts` (its only import is
`import type { PlanNode } from '../../types.ts';`, so importing it from
`metadata/` creates no cycle). It tokenizes a predicate into string literals,
quoted identifiers (`qid`), binds, numbers, bare identifiers (`id`), operators
and punctuation (`:17-36`), and turns name runs into column references,
skipping function calls and keywords. `:54-79`:

```ts
interface Ref { qualifier?: string; column: string }

/** Column references in a token run; function names and keywords are skipped. */
function columnRefs(toks: Tok[]): Ref[] {
  const refs: Ref[] = [];
  for (let i = 0; i < toks.length; i++) {
    if (!isName(toks[i])) continue;
    const parts = [toks[i]];
    let j = i + 1;
    while (parts.length < 3 && isPunct(toks[j], '.') && isName(toks[j + 1])) {
      parts.push(toks[j + 1]);
      j += 2;
    }
    const isCall = isPunct(toks[j], '(');
    const last = parts[parts.length - 1];
    const keyword = last.t === 'id' && NOT_COLUMNS.has(last.v.toUpperCase());
    if (!isCall && !keyword) {
      refs.push({
        column: unquote(last.v),
        qualifier: parts.length >= 2 ? unquote(parts[parts.length - 2].v) : undefined,
      });
    }
    i = j - 1;
  }
  return refs;
}
```

(`unquote` strips the quotes and upper-cases.) Its existing public function
returns only the columns of one alias, `:234-242`:

```ts
/** Every column of `alias` referenced by the predicates, whatever the form. */
export function referencedColumns(predicates: Array<string | undefined>, alias: string | undefined): string[] {
  const seen = new Set<string>();
  for (const predicate of predicates) {
    if (!predicate) continue;
    for (const ref of columnRefs(tokenize(predicate))) if (owns(ref, alias)) seen.add(ref.column);
  }
  return [...seen];
}
```

followed at `:244` by the doc comment ``/** `E@SEL$1` or `"E"@"SEL$1"` -> `E`. */``
of `aliasFromObjectAlias`.

One gap in the tokenizer for this use: in an analytic clause
(`ROW_NUMBER() OVER ( PARTITION BY "T"."A" ORDER BY "T"."B" DESC NULLS LAST)<=5`)
the bare words `PARTITION`, `BY`, `ORDER`, `DESC`, `NULLS`, `LAST` are not on
its keyword list. Because Oracle quotes every real column, the fix is a rule,
not a longer list: **when a predicate contains at least one quoted column
reference, only quoted references count**; bare identifiers are used only for a
predicate that has no quoted identifier at all (hand-written input).

### Existing tests

`src/lib/metadata/__tests__/predicateColumns.test.ts` — 9 tests in one
`describe('extractPredicateColumns', …)`; header:

```ts
import { describe, it, expect } from 'vitest';
import { extractPredicateColumns } from '../predicateColumns';
```

All 9 must keep passing unchanged (they include the unquoted case
`extractPredicateColumns('EMPNO=:1')` → `['EMPNO']`).

`src/lib/advisor/__tests__/selectiveFullScan.test.ts:98-105` (the test before
which Step 1 inserts one):

```ts
  it('names filter columns in the suggestion', () => {
    const plan = buildPlan({
      id: 0, operation: 'TABLE ACCESS FULL', objectName: 'EMPLOYEES',
      filterPredicates: '"E"."STATUS"=:1', starts: 1, actualRows: 5, logicalReads: 50_000,
    });
    const findings = selectiveFullScanRule.evaluate(ruleCtx(plan, null));
    expect(findings[0].suggestion).toContain('STATUS');
  });
```

`src/lib/advisor/__tests__/statsIssues.test.ts:20-31` is the pattern for the
no-histogram case, and `:33` starts the test before which Step 1 inserts one:

```ts
  it('groups multiple nodes referencing the same table under one finding per badge', () => {
```

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Install (only if `node_modules/` is missing) | `npm ci` | exit 0 |
| Lint | `npm run lint` | exit 0 |
| Typecheck | `npm run typecheck` | exit 0, no errors |
| All tests | `npm test` | builds the core package, then vitest; baseline at `b5635d8`: `Test Files  155 passed (155)` / `Tests  1787 passed (1787)`, about 15 s |
| One test file | `npx vitest run --environment jsdom <path>` | all pass |

## Scope

**In scope** (the only files you should modify):
- `packages/ora-plan-core/src/advisor/rules/sargable.ts`
- `packages/ora-plan-core/src/metadata/predicateColumns.ts`
- `src/lib/metadata/__tests__/predicateColumns.test.ts`
- `src/lib/advisor/__tests__/selectiveFullScan.test.ts` (one new test)
- `src/lib/advisor/__tests__/statsIssues.test.ts` (one new test)
- `plans/README.md` (status row only)

**Out of scope** (do NOT touch, even though they look related):
- `packages/ora-plan-core/src/advisor/predicates.ts` — `extractQuotedColumns`
  and `maskLiterals` there serve other rules and stay as they are. Do not add a
  third extractor anywhere.
- `packages/ora-plan-core/src/advisor/rules/selectiveFullScan.ts`,
  `statsIssues.ts`, `packages/ora-plan-core/src/metadata/badges.ts` and the app
  callers — they keep calling `extractPredicateColumns` unchanged.
- The behaviour of `referencedColumns`, `analyzeColumnUses` and
  `resolveNodeAlias` in `sargable.ts` — only an extra field on an internal
  interface and one new exported function are added.
- Restricting the list to the scanned table's own alias (see Maintenance notes).
- `site/docs.html` — no change: it does not describe how the column list is built.

## Git workflow

- Branch: `fix/predicate-columns-ignore-literals`
- Conventional-commit messages as the repository uses (example from `git log`:
  `fix(lint): satisfy eslint-plugin-react-hooks 7.1 / react-refresh 0.5`).
  Suggested: `fix(advisor): predicate column lists skip literals, binds and function names`.
- Do NOT push or open a PR unless the operator instructed it.

## Steps

### Step 0: Baseline

**Verify**: `npm test` → exit 0; write down the `Test Files` and `Tests` totals.

### Step 1: Add the tests (they must fail first)

**(a)** Append to the end of `src/lib/metadata/__tests__/predicateColumns.test.ts`:

```ts

describe('extractPredicateColumns: only real column references', () => {
  it('ignores string literals, date format masks and named binds', () => {
    expect(extractPredicateColumns(
      `"E"."STATUS"='ACTIVE' AND "E"."HIRED">TO_DATE(' 2024-01-01 00:00:00', 'syyyy-mm-dd hh24:mi:ss') AND "E"."DEPT_ID"=:B1`,
    )).toEqual(['STATUS', 'HIRED', 'DEPT_ID']);
    expect(extractPredicateColumns('"U"."NAME"=:B2')).toEqual(['NAME']);
    expect(extractPredicateColumns('"T"."C"=:SYS_B_0')).toEqual(['C']);
    expect(extractPredicateColumns('"E"."DEPARTMENT_ID"=:dept_id')).toEqual(['DEPARTMENT_ID']);
  });

  it('ignores function names, also ones that are not on a keyword list', () => {
    expect(extractPredicateColumns('BITAND("O"."FLAGS",128)=0')).toEqual(['FLAGS']);
    expect(extractPredicateColumns(
      `"U2"."TYPE#"=2 AND "U2"."SPARE2"=TO_NUMBER(SYS_CONTEXT('userenv','current_edition_id'))`,
    )).toEqual(['TYPE#', 'SPARE2']);
    expect(extractPredicateColumns('"SCOTT"."F"("T"."ID")=1')).toEqual(['ID']);
  });

  it('reads a real 19c dictionary predicate (advanced-allstats-19c.txt, operation 10)', () => {
    expect(extractPredicateColumns(
      `("O"."SPARE3"="U"."USER#" AND "O"."OBJ#">:B1 AND "O"."NAME"<>'_NEXT_OBJECT' AND "O"."NAME"<>'_default_auditing_options_' AND "O"."TYPE#"<>10 AND "O"."LINKNAME" IS NULL AND BITAND("O"."FLAGS",128)=0)`,
    )).toEqual(['SPARE3', 'USER#', 'OBJ#', 'NAME', 'TYPE#', 'LINKNAME', 'FLAGS']);
  });

  it('is not confused by quotes inside a literal', () => {
    expect(extractPredicateColumns(`"O"."NAME"='it''s "QUOTED"'`)).toEqual(['NAME']);
  });

  it('takes only the quoted references when a predicate has any (analytic-clause keywords are not columns)', () => {
    expect(extractPredicateColumns(
      'ROW_NUMBER() OVER ( PARTITION BY "T"."A" ORDER BY "T"."B" DESC NULLS LAST)<=5',
    )).toEqual(['A', 'B']);
  });

  it('still reads a hand-written predicate without quoted identifiers', () => {
    expect(extractPredicateColumns(`status = 'OPEN' and upper(name) like :b1`)).toEqual(['STATUS', 'NAME']);
    expect(extractPredicateColumns('e.sal > 1000 and e.deptno in (10, 20)')).toEqual(['SAL', 'DEPTNO']);
  });
});
```

**(b)** In `src/lib/advisor/__tests__/selectiveFullScan.test.ts`, insert this
test immediately **before** the existing `it('names filter columns in the suggestion', …)`:

```ts
  it('names only real columns in the suggestion (no literals, format masks or binds)', () => {
    const plan = buildPlan({
      id: 0, operation: 'TABLE ACCESS FULL', objectName: 'EMPLOYEES',
      filterPredicates: `"E"."STATUS"='ACTIVE' AND "E"."HIRED">TO_DATE(' 2024-01-01 00:00:00', 'syyyy-mm-dd hh24:mi:ss') AND "E"."DEPT_ID"=:B1`,
      starts: 1, actualRows: 5, logicalReads: 50_000,
    });
    const findings = selectiveFullScanRule.evaluate(ruleCtx(plan, null));
    expect(findings[0].suggestion).toBe(
      'Consider an index on STATUS, HIRED, DEPT_ID to avoid scanning the entire table for this filter.',
    );
  });

```

**(c)** In `src/lib/advisor/__tests__/statsIssues.test.ts`, insert this test
immediately **before** the existing
`it('groups multiple nodes referencing the same table under one finding per badge', …)`:

```ts
  it('does not let a literal that equals another column name hide the no-histogram badge', () => {
    // 'ACTIVE' is a literal here, but the table also has a column called ACTIVE (with a histogram).
    const table = makeTable({}, {
      STATUS: makeColumn({ histogram: { type: 'NONE', buckets: 0 } }),
      ACTIVE: makeColumn({ histogram: { type: 'FREQUENCY', buckets: 2 } }),
    });
    const bundle = makeBundle({ 'HR.EMPLOYEES': table });
    const plan = buildPlan({
      id: 0, operation: 'TABLE ACCESS FULL', objectName: 'EMPLOYEES',
      filterPredicates: `"E"."STATUS"='ACTIVE'`, rows: 100, actualRows: 5000,
    }, { hasActualStats: true });
    const findings = statsIssuesRule.evaluate(ruleCtx(plan, bundle));
    const mismatch = findings.find((f) => f.title.includes('mismatch no histogram'));
    expect(mismatch).toBeDefined();
    expect(mismatch!.explanation).toContain('no histogram on predicate column STATUS.');
  });

```

**Verify**: `npx vitest run --environment jsdom src/lib/metadata/__tests__/predicateColumns.test.ts src/lib/advisor/__tests__/selectiveFullScan.test.ts src/lib/advisor/__tests__/statsIssues.test.ts`
→ exit code 1; the **8 new tests fail** (6 in `predicateColumns.test.ts`, 1 in
each of the other two) and every pre-existing test in the three files passes.
(If plan 010's tests are present but plan 010's code is not, 3 more fail —
that is a sequencing problem: STOP.)

### Step 2: Add `allReferencedColumns` to the tokenizer module

In `packages/ora-plan-core/src/advisor/rules/sargable.ts`:

1. Extend the internal `Ref` interface (line 54):
   ```ts
   interface Ref {
     qualifier?: string;
     column: string;
     /** The column name was a quoted identifier ("SAL"), as Oracle prints every real column reference. */
     quoted: boolean;
   }
   ```
2. In `columnRefs`, add the field to the pushed object:
   ```ts
         refs.push({
           column: unquote(last.v),
           qualifier: parts.length >= 2 ? unquote(parts[parts.length - 2].v) : undefined,
           quoted: last.t === 'qid',
         });
   ```
3. Immediately after `referencedColumns` (before the doc comment of
   `aliasFromObjectAlias`) add:
   ```ts
   /**
    * Every column the predicates reference, whichever alias qualifies it (upper-cased, first seen first).
    * String literals, bind variables, numbers, function names and keywords are not columns. Oracle quotes
    * every column in the predicates it prints, so in a predicate that has quoted references only those
    * count (the bare words left are keywords such as OVER / PARTITION BY); a hand-written predicate with
    * no quoted identifier falls back to its bare identifiers.
    */
   export function allReferencedColumns(predicates: Array<string | undefined>): string[] {
     const seen = new Set<string>();
     for (const predicate of predicates) {
       if (!predicate) continue;
       const refs = columnRefs(tokenize(predicate));
       const quotedOnly = refs.some((ref) => ref.quoted);
       for (const ref of refs) if (!quotedOnly || ref.quoted) seen.add(ref.column);
     }
     return [...seen];
   }
   ```

Nothing else in `sargable.ts` changes (`owns`, `referencedColumns`,
`resolveNodeAlias` and the rest read only `qualifier` and `column`).

**Verify**:
- `npm run typecheck` → exit 0.
- `npx vitest run --environment jsdom src/lib/advisor/__tests__/unusedIndex.test.ts src/lib/advisor/__tests__/partitionPruning.test.ts src/lib/advisor/__tests__/functionOnIndexedColumn.test.ts` → all pass (the existing users of the tokenizer are unaffected).

### Step 3: Make `extractPredicateColumns` delegate

Replace the **whole content** of
`packages/ora-plan-core/src/metadata/predicateColumns.ts` with:

```ts
import { allReferencedColumns } from '../advisor/rules/sargable.ts';

/**
 * Upper-cased names of the columns the given predicates reference (access and filter predicates of
 * one or more plan lines), de-duplicated, first seen first. Literals, binds, function names and
 * keywords are never returned: see `allReferencedColumns`, which does the parsing.
 */
export function extractPredicateColumns(
  ...predicates: Array<string | undefined>
): string[] {
  return allReferencedColumns(predicates);
}
```

(`SQL_KEYWORDS`, `IDENTIFIER_RUN` and `stripQuotes` are deleted with it.)

**Verify**:
- `npm run typecheck` → exit 0.
- `npx vitest run --environment jsdom src/lib/metadata/__tests__/predicateColumns.test.ts src/lib/advisor/__tests__/selectiveFullScan.test.ts src/lib/advisor/__tests__/statsIssues.test.ts` → all pass (15 tests in `predicateColumns.test.ts`).

### Step 4: Full verification

**Verify**:
- `npm run lint` → exit 0.
- `npm run typecheck` → exit 0.
- `npm test` → exit 0; `Test Files` equals the Step 0 number, `Tests` is the Step 0 number **+8**; no snapshot written or obsolete.

## Test plan

Expected results the new tests pin (all verified against the target code;
"before" is what the current code returns):

| Predicate | Before | After |
|---|---|---|
| `"E"."STATUS"='ACTIVE' AND "E"."HIRED">TO_DATE(' 2024-01-01 00:00:00', 'syyyy-mm-dd hh24:mi:ss') AND "E"."DEPT_ID"=:B1` | STATUS, ACTIVE, HIRED, SYYYY, MM, DD, HH24, MI, SS, DEPT_ID, B1 | STATUS, HIRED, DEPT_ID |
| `"U"."NAME"=:B2` | NAME, B2 | NAME |
| `"T"."C"=:SYS_B_0` | C, SYS_B_0 | C |
| `BITAND("O"."FLAGS",128)=0` | BITAND, FLAGS | FLAGS |
| `"U2"."TYPE#"=2 AND "U2"."SPARE2"=TO_NUMBER(SYS_CONTEXT('userenv','current_edition_id'))` | TYPE#, SPARE2, SYS_CONTEXT, USERENV, CURRENT_EDITION_ID | TYPE#, SPARE2 |
| `"SCOTT"."F"("T"."ID")=1` | F, ID | ID |
| `"O"."NAME"='it''s "QUOTED"'` | NAME, IT, S, QUOTED | NAME |
| `ROW_NUMBER() OVER ( PARTITION BY "T"."A" ORDER BY "T"."B" DESC NULLS LAST)<=5` | ROW_NUMBER, OVER, PARTITION, BY, A, ORDER, B, DESC, NULLS, LAST | A, B |
| `status = 'OPEN' and upper(name) like :b1` (hand-written) | STATUS, OPEN, NAME, B1 | STATUS, NAME |
| `EMPNO=:1` (existing test) | EMPNO | EMPNO |

- `predicateColumns.test.ts`: 6 new tests (Step 1a).
- `selectiveFullScan.test.ts`: 1 new test pinning the exact suggestion text.
- `statsIssues.test.ts`: 1 new test — a literal equal to another column's name
  no longer hides the no-histogram finding.
- No existing expectation changes anywhere in the suite. If one does, STOP.
- Structural pattern: the existing tests in the same three files.

## Done criteria

Machine-checkable. ALL must hold:

- [ ] `grep -c "SQL_KEYWORDS\|IDENTIFIER_RUN" packages/ora-plan-core/src/metadata/predicateColumns.ts` prints `0`
- [ ] `grep -n "export function allReferencedColumns" packages/ora-plan-core/src/advisor/rules/sargable.ts` prints one line
- [ ] `npx vitest run --environment jsdom src/lib/metadata/__tests__/predicateColumns.test.ts` → 15 passed
- [ ] `npm run lint` exits 0
- [ ] `npm run typecheck` exits 0
- [ ] `npm test` exits 0 with Step 0 totals +0 files / +8 tests and no snapshot written
- [ ] `git status --porcelain` lists only files from the in-scope list
- [ ] `plans/README.md` status row for 011 updated

## STOP conditions

Stop and report back (do not improvise) if:

- `predicateColumns.ts` or the quoted parts of `sargable.ts` do not match the
  excerpts in "Current state" (other than line-number shifts).
- `sargable.ts` has gained an import from `metadata/` (the new import in
  `predicateColumns.ts` would then be circular).
- Any **pre-existing** test fails after Step 3, or vitest reports a changed
  snapshot. Report the predicate and the old/new column list; do not edit the
  expectation.
- One of the "After" values in the Test plan table cannot be reached with the
  code in Steps 2-3 as written. Do not extend keyword lists or add regexes to
  force it; report the predicate.
- A step's verification fails twice after a reasonable fix attempt.

## Maintenance notes

- There are now two predicate readers: the tokenizer in
  `advisor/rules/sargable.ts` (columns, alias ownership, sargability) and the
  regex helpers in `advisor/predicates.ts` (`extractQuotedColumns`, conversion
  and function-wrap detection). `metadata/predicateColumns.ts` is only a
  variadic wrapper kept so its five callers do not change. New code that needs
  "which columns" should call the tokenizer.
- Deliberately not done here: restricting the list to the scanned table's own
  alias. A join predicate such as `"T"."CUST_ID"="C"."ID"` still yields both
  `CUST_ID` and `ID`, so the full-scan suggestion can name the other table's
  column and the no-histogram check can match a same-named column.
  `referencedColumns(predicates, resolveNodeAlias(node, tableName))` in
  `sargable.ts` already supports that; switching the callers is a behaviour
  change that deserves its own tests.
- Names are upper-cased, as before. A mixed-case quoted column (`"MyCol"`) is
  therefore looked up as `MYCOL` in the metadata bundle and not found — an
  existing limitation, unchanged by this plan.
- `src/lib/ai/metadataProjection.ts` uses this list to choose which column
  statistics go into AI context: after this change it sends fewer (only real
  predicate columns). Reviewer: confirm that is the intent of that function
  ("column stats limited to columns that appear in the plan's predicates").
