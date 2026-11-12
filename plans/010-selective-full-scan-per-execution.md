# Plan 010: The selective-full-scan rule judges a re-executed scan per execution

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**:
> `git diff --stat b5635d8..HEAD -- packages/ora-plan-core/src/advisor/rules/selectiveFullScan.ts src/lib/advisor/__tests__/selectiveFullScan.test.ts packages/ora-plan-core/src/format.ts`
> If any in-scope file changed since this plan was written, compare the
> "Current state" excerpts against the live code before proceeding; on a
> mismatch, treat it as a STOP condition. Other plans may have landed first and
> shifted line numbers; match on the quoted code, not the line number.
> `src/lib/advisor/__tests__/selectiveFullScan.test.ts` also gets one new test
> from `plans/011-predicate-columns-ignore-literals.md` (inserted in the
> "actuals fallback path" `describe`; this plan appends a new `describe` at the
> end, so the two do not collide). `packages/ora-plan-core/src/format.ts` is
> read-only here; `plans/015-small-correctness-fixes.md` and
> `plans/016-formatter-unit-boundaries.md` edit other functions in it.

## Status

- **Priority**: P2
- **Effort**: S
- **Risk**: MED (changes when an advisor finding appears and how severe it is)
- **Depends on**: `plans/009-advisor-effective-children.md` (sequencing only: same rule directory and test helpers; no code dependency)
- **Category**: bug
- **Planned at**: commit `b5635d8`, 2026-11-11

## Why this matters

The "Selective full scan" advisor rule flags a full table scan that returns a
tiny fraction of the rows it reads. With a metadata bundle attached it divides
the scan's A-Rows by the table's row count. A-Rows is **cumulative over all
executions** of the operation, the table size is what **one** execution reads,
so for a scan that runs many times (the inner side of a nested loop, a
correlated subquery) the fraction is inflated by the execution count. Measured
on the current code: a full scan of a 50,000-row table run 2,000 times,
returning 1 row each time and reading 12,000 buffers each time, is reported as
**critical without a bundle and not reported at all with the bundle**
(2,000 / 50,000 = 4% > the 1% threshold). Attaching metadata hides the worst
case. Two related flaws are fixed with it: the measured fallback calls any scan
with Starts > 1 "re-executed" although Starts also counts partitions (one pass
over 12 partitions is escalated to critical), and the fallback is skipped
whenever a table size is known, even if that number said "not selective" while
the buffer gets say otherwise.

## Current state

Layout rule for this repository: the real code is in
`packages/ora-plan-core/src/...`. Files with the same name under `src/lib/`
are one-line `export *` shims — **never edit a shim**. Inside the package,
sibling imports carry an explicit `.ts` extension; no React, no DOM.

Oracle semantics this code must keep (project rules, quoted):

> E-Rows is per start, A-Rows is cumulative. Compare A-Rows only with
> `estimatedRowsTotal` via `nodeCardinalityRatio(node)`; never
> `actualRows / rows`. The total is E-Rows × Starts, except: inside a PX slave
> set and not on a NESTED LOOPS/FILTER probe side → E-Rows; under a partition
> iterator → the topmost iterator's Starts; a rowid fetch fed by an NLJ-batching
> / batched-rowid nested loop → the Starts of the index supplying the rowids;
> Starts = 0 or a COUNT STOPKEY cut-off → undefined. Ratios floor both sides
> at 1. Cost is cumulative. Inactive adaptive rows (`PlanNode.inactive`) are
> excluded from every advisor rule. `->` is the SQL Monitor "executing" marker,
> not inactive.

The exceptions in that rule are why **Starts is not the execution count**:
under a partition iterator Starts counts partitions, in a PX slave set it
counts slaves/granules.

### The rule

`packages/ora-plan-core/src/advisor/rules/selectiveFullScan.ts` — imports at
`:1-4`, then helpers, then the rule. The part this plan changes, `:93-135`:

```ts
      const returned = node.actualRows ?? node.rows;

      let finding: Finding | null = null;

      if (tableRows !== undefined && tableRows >= ftsMinTableRows && returned !== undefined) {
        const selectivity = tableRows > 0 ? returned / tableRows : 0;
        if (selectivity <= ftsSelectivityWarn) {
          const isCritical = selectivity <= ftsSelectivityCritical && tableRows >= ftsCriticalMinTableRows;
          const columns = extractPredicateColumns(node.accessPredicates, node.filterPredicates);
          finding = {
            ruleId: 'selective-full-scan',
            severity: isCritical ? 'critical' : 'warning',
            nodeIds: [node.id],
            title: `Selective full scan on ${node.operation}`,
            explanation: `Full scan of ${partitionNote ? `about ${tableRows.toLocaleString()} rows in the partitions scanned${partitionNote}` : `a table with ${tableRows.toLocaleString()} rows`} returned only ${returned.toLocaleString()} rows (${(selectivity * 100).toFixed(3)}% selectivity).`,
            suggestion: columns.length > 0
              ? `Consider an index on ${columns.join(', ')} to avoid scanning the entire table for this filter.`
              : 'Consider an index on the filtered column(s) to avoid scanning the entire table.',
          };
        }
      } else {
        const starts = node.starts;
        const actualRows = node.actualRows;
        const logicalReads = node.logicalReads;
        if (starts !== undefined && starts >= 1 && actualRows !== undefined && logicalReads !== undefined) {
          const rowsPerStart = actualRows / starts;
          const getsPerStart = logicalReads / starts;
          if (rowsPerStart <= ftsFallbackMaxRowsPerStart && getsPerStart >= ftsFallbackMinGetsPerStart) {
            const isCritical = starts > 1;
            const columns = extractPredicateColumns(node.accessPredicates, node.filterPredicates);
            finding = {
              ruleId: 'selective-full-scan',
              severity: isCritical ? 'critical' : 'warning',
              nodeIds: [node.id],
              title: `Selective full scan on ${node.operation}`,
              explanation: `Full scan averaged ${getsPerStart.toLocaleString()} logical reads per start but returned only ${rowsPerStart.toLocaleString()} rows per start across ${starts.toLocaleString()} start(s).`,
              suggestion: columns.length > 0
                ? `Consider an index on ${columns.join(', ')} to avoid scanning the entire table for this filter.`
                : 'Consider an index on the filtered column(s) to avoid scanning the entire table.',
            };
          }
        }
      }
```

`tableRows` (computed just above, `:76-92`) is the table's `num_rows` from the
bundle, scaled to the partitions scanned for a pruned scan, or `undefined` when
the table or the partition share is unknown. Do not change that part.

Thresholds (`packages/ora-plan-core/src/advisor/config.ts:9-14`), unchanged by
this plan:

```ts
  ftsMinTableRows: 10_000,
  ftsSelectivityWarn: 0.01,
  ftsSelectivityCritical: 0.001,
  ftsCriticalMinTableRows: 1_000_000,
  ftsFallbackMaxRowsPerStart: 1_000,
  ftsFallbackMinGetsPerStart: 10_000,
```

### The execution count that already exists

`packages/ora-plan-core/src/format.ts:79-93` (exported; another rule,
`cardinalityMismatch.ts`, already imports from `'../../format.ts'`):

```ts
/**
 * Effective number of executions behind `estimatedRowsTotal` (total ÷ per-start E-Rows),
 * or undefined when the operation effectively ran once / there is no comparable total.
 * Not necessarily `Starts`: PX slave sets, partition iterators and NLJ-batched rowid
 * fetches derive their total differently (see `computeEstimatedRowTotals`).
 */
export function effectiveExecutions(node: Pick<PlanNode, 'rows' | 'estimatedRowsTotal'>): number | undefined {
  const { rows, estimatedRowsTotal: total } = node;
  if (rows === undefined || total === undefined || rows <= 0 || total <= rows) return undefined;
  const raw = total / rows;
  // Floating noise (e.g. 80000 / 4 computed from a rounded total) — it is an execution count.
  const rounded = Math.round(raw);
  const executions = Math.abs(raw - rounded) < 1e-6 * Math.max(1, raw) ? rounded : raw;
  return executions > 1 ? executions : undefined;
}
```

`node.estimatedRowsTotal` is set after parsing (and by the test helper
`buildPlan`) only when the node has both E-Rows (`rows`) and A-Rows
(`actualRows`), Starts ≠ 0, and it was not cut off by a COUNT STOPKEY. So:

- `estimatedRowsTotal` defined → the execution count is known:
  `effectiveExecutions(node) ?? 1`.
- `estimatedRowsTotal` undefined → the execution count is **unknown**. Each use
  below then keeps today's behaviour (one execution for the selectivity test,
  Starts for the fallback's "re-executed" test).

### Tests and helpers

`src/lib/advisor/__tests__/selectiveFullScan.test.ts` (177 lines, three
`describe` blocks: bundle path, actuals fallback path, partitioned tables).
None of its existing plans sets `rows`, so none has an `estimatedRowsTotal`;
all 20 existing tests must keep passing unchanged. Header of the file:

```ts
import { describe, it, expect } from 'vitest';
import { selectiveFullScanRule } from '../rules/selectiveFullScan';
import { buildPlan, makeBundle, makeTable, ruleCtx, type NodeSpec } from './helpers';
import type { TableObject } from '../../metadata/bundle';
```

`src/lib/advisor/__tests__/helpers.ts`: `buildPlan(spec)` builds a synthetic
plan from `{ id, operation, objectName, filterPredicates, rows, actualRows,
starts, logicalReads, pstart, pstop, children }` and runs
`computeEstimatedRowTotals`; `makeBundle({ 'OWNER.TABLE': makeTable({ num_rows }) })`
builds a bundle; `ruleCtx(plan, bundle | null)` builds the rule context.
Tables are found by name regardless of owner.

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Install (only if `node_modules/` is missing) | `npm ci` | exit 0 |
| Lint | `npm run lint` | exit 0 |
| Typecheck | `npm run typecheck` | exit 0, no errors |
| All tests | `npm test` | builds the core package, then vitest; baseline at `b5635d8`: `Test Files  155 passed (155)` / `Tests  1787 passed (1787)`, about 15 s |
| This rule's tests | `npx vitest run --environment jsdom src/lib/advisor/__tests__/selectiveFullScan.test.ts` | all pass |

## Scope

**In scope** (the only files you should modify):
- `packages/ora-plan-core/src/advisor/rules/selectiveFullScan.ts`
- `src/lib/advisor/__tests__/selectiveFullScan.test.ts`
- `plans/README.md` (status row only)

**Out of scope** (do NOT touch, even though they look related):
- `packages/ora-plan-core/src/format.ts` and `analysis.ts` — `effectiveExecutions`
  and `computeEstimatedRowTotals` are used as they are.
- `packages/ora-plan-core/src/advisor/config.ts` — no threshold changes.
- `packages/ora-plan-core/src/metadata/predicateColumns.ts` — the column list in
  the suggestion text belongs to `plans/011-predicate-columns-ignore-literals.md`.
- The partition logic at the top of `selectiveFullScan.ts` (`scanScope`,
  `partitionIteratorOf`, the `tableRows` / `partitionNote` computation).
- The fallback's explanation text and its per-start averages (still divided by
  Starts; only its critical test changes).
- `site/docs.html` — no change: its rule card ("A full table scan that returns
  a tiny fraction of the rows it read.") stays true.

## Git workflow

- Branch: `fix/selective-full-scan-per-execution`
- Conventional-commit messages as the repository uses (example from `git log`:
  `fix(lint): satisfy eslint-plugin-react-hooks 7.1 / react-refresh 0.5`).
  Suggested: `fix(advisor): judge a re-executed full scan per execution`.
- Do NOT push or open a PR unless the operator instructed it.

## Steps

### Step 0: Baseline

**Verify**: `npm test` → exit 0; write down `Test Files` and `Tests` totals
(155 / 1787 at `b5635d8`).

### Step 1: Add the tests (three must fail first)

Append to the end of `src/lib/advisor/__tests__/selectiveFullScan.test.ts`:

```ts

describe('selectiveFullScanRule (re-executed scans: A-Rows is cumulative, the table is read once per execution)', () => {
  // Full scan of T as the inner side of a nested loop: 2,000 executions, 1 row and 12,000 gets each.
  const nlInnerScan = () => buildPlan({
    id: 0, operation: 'NESTED LOOPS', rows: 2000, actualRows: 2000, starts: 1,
    children: [
      { id: 1, operation: 'TABLE ACCESS FULL', objectName: 'DRIVER', rows: 2000, actualRows: 2000, starts: 1 },
      {
        id: 2, operation: 'TABLE ACCESS FULL', objectName: 'T', filterPredicates: '"T"."ID"="D"."ID"',
        rows: 1, actualRows: 2000, starts: 2000, logicalReads: 24_000_000,
      },
    ],
  });
  const bundleT = (numRows: number) => makeBundle({ 'APP.T': makeTable({ num_rows: numRows }) });

  it('is critical without a bundle (measured fallback)', () => {
    const findings = selectiveFullScanRule.evaluate(ruleCtx(nlInnerScan(), null));
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({ severity: 'critical', nodeIds: [2] });
    expect(findings[0].explanation).toContain('logical reads per start');
  });

  it('stays critical with a bundle: selectivity is per execution, size is rows read over all executions', () => {
    const findings = selectiveFullScanRule.evaluate(ruleCtx(nlInnerScan(), bundleT(50_000)));
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({ severity: 'critical', nodeIds: [2] });
    expect(findings[0].explanation).toContain(`ran ${(2000).toLocaleString()} times`);
    expect(findings[0].explanation).toContain('returned only 1 rows per execution');
    expect(findings[0].explanation).toContain(`${(2000).toLocaleString()} in total`);
    expect(findings[0].explanation).toContain('0.002% selectivity');
  });

  it('keeps the single-execution wording and severity when the scan ran once', () => {
    const plan = buildPlan({
      id: 0, operation: 'TABLE ACCESS FULL', objectName: 'T', filterPredicates: '"T"."STATUS"=:1',
      rows: 400, actualRows: 500, starts: 1,
    });
    const findings = selectiveFullScanRule.evaluate(ruleCtx(plan, bundleT(100_000)));
    expect(findings).toHaveLength(1);
    expect(findings[0].severity).toBe('warning');
    expect(findings[0].explanation).toContain('returned only 500 rows (0.500% selectivity)');
    expect(findings[0].explanation).not.toContain('per execution');
  });

  it('does not treat one pass over several partitions as a re-execution (fallback path)', () => {
    // Starts = 12 on the scan counts partitions; the iterator ran once.
    const plan = buildPlan({
      id: 1, operation: 'PARTITION RANGE ALL', rows: 600, actualRows: 600, starts: 1, pstart: '1', pstop: '12',
      children: [{
        id: 2, operation: 'TABLE ACCESS FULL', objectName: 'SALES', filterPredicates: '"S"."STATUS"=:1',
        rows: 600, actualRows: 600, starts: 12, logicalReads: 240_000, pstart: '1', pstop: '12',
      }],
    });
    const findings = selectiveFullScanRule.evaluate(ruleCtx(plan, null));
    expect(findings).toHaveLength(1);
    expect(findings[0].severity).toBe('warning');
  });

  it('falls back to measured buffer gets when the bundle row count says the scan was not selective', () => {
    // Stale num_rows: 20,000 in the bundle, yet the scan read 500,000 buffers to return 900 rows (4.5%).
    const plan = buildPlan({
      id: 0, operation: 'TABLE ACCESS FULL', objectName: 'T', filterPredicates: '"T"."STATUS"=:1',
      rows: 900, actualRows: 900, starts: 1, logicalReads: 500_000,
    });
    const findings = selectiveFullScanRule.evaluate(ruleCtx(plan, bundleT(20_000)));
    expect(findings).toHaveLength(1);
    expect(findings[0].severity).toBe('warning');
    expect(findings[0].explanation).toContain('logical reads per start');
  });
});
```

**Verify**: `npx vitest run --environment jsdom src/lib/advisor/__tests__/selectiveFullScan.test.ts`
→ exit code 1 with exactly **3 failed**: "stays critical with a bundle…"
(0 findings), "does not treat one pass over several partitions…" (critical
instead of warning) and "falls back to measured buffer gets…" (0 findings).
"is critical without a bundle" and "keeps the single-execution wording" pass
already (they pin behaviour that must not change).

### Step 2: Compare per execution, and let the fallback run when the size test did not fire

Both edits are in `packages/ora-plan-core/src/advisor/rules/selectiveFullScan.ts`
and belong together (the import alone would fail the typecheck as unused).

First add, after the existing `extractPredicateColumns` import (line 4):

```ts
import { effectiveExecutions } from '../../format.ts';
```

Then replace the block quoted in "Current state" (from `const returned = …`
through the closing brace of the `else { … }` branch) with:

```ts
      // How many times the scan really ran, when the plan lets us tell: the multiplier behind
      // estimatedRowsTotal. Starts is not it (it also counts partitions and PX granules).
      // Undefined = unknown; each use below then keeps its conservative reading.
      const executions = node.estimatedRowsTotal !== undefined ? effectiveExecutions(node) ?? 1 : undefined;
      const runs = executions ?? 1;
      // A-Rows is cumulative over all executions, while tableRows is what ONE execution reads:
      // compare per execution. E-Rows (no actual stats) is per execution already.
      const returned = node.actualRows !== undefined ? node.actualRows / runs : node.rows;

      let finding: Finding | null = null;

      if (tableRows !== undefined && tableRows >= ftsMinTableRows && returned !== undefined) {
        const selectivity = tableRows > 0 ? returned / tableRows : 0;
        if (selectivity <= ftsSelectivityWarn) {
          // "Big" is judged on the rows read over all executions, not on the table size alone.
          const isCritical = selectivity <= ftsSelectivityCritical && tableRows * runs >= ftsCriticalMinTableRows;
          const columns = extractPredicateColumns(node.accessPredicates, node.filterPredicates);
          const scanned = partitionNote
            ? `about ${tableRows.toLocaleString()} rows in the partitions scanned${partitionNote}`
            : `a table with ${tableRows.toLocaleString()} rows`;
          const pct = `${(selectivity * 100).toFixed(3)}% selectivity`;
          const outcome = runs > 1 && node.actualRows !== undefined
            ? `ran ${runs.toLocaleString()} times and returned only ${returned.toLocaleString()} rows per execution (${node.actualRows.toLocaleString()} in total; ${pct})`
            : `returned only ${returned.toLocaleString()} rows (${pct})`;
          finding = {
            ruleId: 'selective-full-scan',
            severity: isCritical ? 'critical' : 'warning',
            nodeIds: [node.id],
            title: `Selective full scan on ${node.operation}`,
            explanation: `Full scan of ${scanned} ${outcome}.`,
            suggestion: columns.length > 0
              ? `Consider an index on ${columns.join(', ')} to avoid scanning the entire table for this filter.`
              : 'Consider an index on the filtered column(s) to avoid scanning the entire table.',
          };
        }
      }

      // Measured fallback: also when the table size is known but the selectivity test did not
      // fire (stale num_rows must not hide a scan that demonstrably read far more than it returned).
      if (!finding) {
        const starts = node.starts;
        const actualRows = node.actualRows;
        const logicalReads = node.logicalReads;
        if (starts !== undefined && starts >= 1 && actualRows !== undefined && logicalReads !== undefined) {
          const rowsPerStart = actualRows / starts;
          const getsPerStart = logicalReads / starts;
          if (rowsPerStart <= ftsFallbackMaxRowsPerStart && getsPerStart >= ftsFallbackMinGetsPerStart) {
            // Only a real re-execution is critical: Starts > 1 alone can be one pass over several partitions.
            const isCritical = (executions ?? starts) > 1;
            const columns = extractPredicateColumns(node.accessPredicates, node.filterPredicates);
            finding = {
              ruleId: 'selective-full-scan',
              severity: isCritical ? 'critical' : 'warning',
              nodeIds: [node.id],
              title: `Selective full scan on ${node.operation}`,
              explanation: `Full scan averaged ${getsPerStart.toLocaleString()} logical reads per start but returned only ${rowsPerStart.toLocaleString()} rows per start across ${starts.toLocaleString()} start(s).`,
              suggestion: columns.length > 0
                ? `Consider an index on ${columns.join(', ')} to avoid scanning the entire table for this filter.`
                : 'Consider an index on the filtered column(s) to avoid scanning the entire table.',
            };
          }
        }
      }
```

Which branch produces which text (must hold after the change):

| Situation | Branch | Explanation starts with | Severity |
|---|---|---|---|
| table size known, per-execution selectivity ≤ 1%, ran once (or count unknown) | size test | `Full scan of a table with N rows returned only R rows (P% selectivity).` — byte-for-byte the old text | critical if selectivity ≤ 0.1% and `tableRows` ≥ 1,000,000, else warning (unchanged) |
| same, ran `E` > 1 times | size test | `Full scan of a table with N rows ran E times and returned only R rows per execution (T in total; P% selectivity).` | critical if selectivity ≤ 0.1% and `tableRows × E` ≥ 1,000,000, else warning |
| pruned partition scan | size test | as above with `about N rows in the partitions scanned (…)` instead of `a table with N rows` | as above |
| size test did not fire or no table size; rows/start ≤ 1,000 and gets/start ≥ 10,000 | measured fallback | `Full scan averaged G logical reads per start but returned only R rows per start across S start(s).` (unchanged text) | critical if the scan was re-executed (`executions > 1`; with an unknown count: `starts > 1` as before), else warning |
| anything else | — | no finding | — |

**Verify**:
- `npm run typecheck` → exit 0.
- `npx vitest run --environment jsdom src/lib/advisor/__tests__/selectiveFullScan.test.ts` → all pass (the 20 existing tests unchanged, plus 5 new; 26 if plan 011 has landed).

### Step 3: Full verification

**Verify**:
- `npm run lint` → exit 0.
- `npm run typecheck` → exit 0.
- `npm test` → exit 0; `Test Files` equals the Step 0 number, `Tests` is the Step 0 number **+5**; no snapshot written or obsolete.

## Test plan

- New `describe` at the end of `src/lib/advisor/__tests__/selectiveFullScan.test.ts`
  (content in Step 1), 5 cases:
  1. nested-loop inner full scan, 2,000 executions, no bundle → critical via
     the measured fallback (pins existing behaviour);
  2. the same plan with a 50,000-row table in the bundle → critical, with the
     per-execution wording — **the regression this plan fixes** (was: no finding);
  3. a scan that ran once, 500 rows of 100,000 → the old wording and `warning`
     (pins that single-execution output is unchanged);
  4. one pass over 12 partitions (scan Starts = 12, iterator Starts = 1), no
     bundle → `warning` (was `critical`);
  5. bundle says 20,000 rows, scan returned 900 rows from 500,000 buffer gets →
     `warning` via the measured fallback (was: no finding).
- No existing expectation changes. If one does, that is a STOP condition.
- Structural pattern: the existing `describe` blocks in the same file.

## Done criteria

Machine-checkable. ALL must hold:

- [ ] `grep -n "effectiveExecutions" packages/ora-plan-core/src/advisor/rules/selectiveFullScan.ts` shows the import and one use
- [ ] `grep -n "const isCritical = starts > 1" packages/ora-plan-core/src/advisor/rules/selectiveFullScan.ts` returns no matches
- [ ] `npx vitest run --environment jsdom src/lib/advisor/__tests__/selectiveFullScan.test.ts` → all pass, including the 5 tests of the new `describe`
- [ ] `npm run lint` exits 0
- [ ] `npm run typecheck` exits 0
- [ ] `npm test` exits 0 with Step 0 totals +0 files / +5 tests and no snapshot written
- [ ] `git status --porcelain` lists only files from the in-scope list
- [ ] `plans/README.md` status row for 010 updated

## STOP conditions

Stop and report back (do not improvise) if:

- The code at `selectiveFullScan.ts:93-135` does not match the excerpt in
  "Current state" (other than line-number shifts or a column-list change made
  by plan 011, which does not edit this file).
- `effectiveExecutions` is no longer exported from
  `packages/ora-plan-core/src/format.ts`, or its signature differs from the
  excerpt.
- Any **existing** test in `selectiveFullScan.test.ts` fails after Step 2, or
  another test file starts failing, or vitest reports a changed snapshot
  (bundled examples with attached bundles go through this rule). Report the
  failing test and the old/new finding; do not adjust thresholds or
  expectations to make it pass.
- A step's verification fails twice after a reasonable fix attempt.
- Making a test pass seems to require changing `config.ts`, `format.ts`,
  `analysis.ts` or the partition logic at the top of the rule.

## Maintenance notes

- The size test now uses two execution-aware numbers: per-execution rows for
  selectivity, and `tableRows × executions` for "is this big enough to be
  critical". A 50,000-row table scanned 2,000 times is 100 million rows read,
  which is why it is critical although the table itself is under the
  1,000,000-row critical floor.
- When the execution count is unknown (no E-Rows, or the row was cut off by a
  COUNT STOPKEY) the rule behaves exactly as before this plan. That is
  deliberate: dividing by raw Starts would understate the rows returned by a
  partition-wise or parallel scan and create false positives.
- The measured fallback still averages per **start** (so per partition for a
  partition-wise scan) and still says "per start"; only its severity now
  depends on real re-execution. Unifying the two branches' units is a possible
  follow-up, not part of this fix.
- The fallback now also runs when a table size is known but the size test did
  not fire. A reviewer should look at whether that produces findings they
  consider noise on their own plans: a scan returning ≤ 1,000 rows from
  ≥ 10,000 buffer gets is now reported with or without a bundle (before, a
  bundle that said "more than 1% of the table" suppressed it).
- The suggestion text's column list comes from `extractPredicateColumns`;
  `plans/011-predicate-columns-ignore-literals.md` fixes what that returns.
