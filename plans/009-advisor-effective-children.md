# Plan 009: Advisor rules, row flow and selection stats look through inactive adaptive-plan rows

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**:
> `git diff --stat b5635d8..HEAD -- packages/ora-plan-core/src/advisor/rules src/lib/rowFlow.ts src/lib/selectionStats.ts src/lib/advisor/__tests__ src/lib/__tests__/rowFlow.test.ts src/lib/__tests__/selectionStats.test.ts`
> If any in-scope file changed since this plan was written, compare the
> "Current state" excerpts against the live code before proceeding; on a
> mismatch, treat it as a STOP condition. Other plans may have landed first and
> shifted line numbers; match on the quoted code, not the line number.
> `packages/ora-plan-core/src/advisor/rules/cardinalityMismatch.ts` is also
> touched by `plans/015-small-correctness-fixes.md` (the estimate wording near
> the top of the file, not the regions this plan edits). In the same directory,
> `selectiveFullScan.ts` and `sargable.ts` belong to
> `plans/010-selective-full-scan-per-execution.md` and
> `plans/011-predicate-columns-ignore-literals.md`; this plan does not touch
> them.

## Status

- **Priority**: P1
- **Effort**: S
- **Risk**: LOW
- **Depends on**: none (`plans/001-typecheck-tests.md` first is recommended, not required)
- **Category**: bug
- **Planned at**: commit `b5635d8`, 2026-11-11

## Why this matters

Oracle prints an adaptive plan with the rows the optimizer did not use still in
the tree (Id prefixed with `-`; the app marks them `PlanNode.inactive`). An
inactive row can have **active** rows below it: the outer input of an adaptive
join sits under an inactive `STATISTICS COLLECTOR`, and the join that ran sits
under the inactive alternative join. The advisor's helper `liveChildren` drops an
inactive child *together with everything below it*, so a nested loop or hash
join in an adaptive plan appears to have one input and the join rules skip it
without a word. Adaptive plans are the default since Oracle 12c, so the
nested-loop-volume, hash-join-build-side, per-row-reexecution and
cardinality-mismatch rules are blind on a large share of real plans. Two app
helpers have the same gap: the Waterfall view lists rows that never ran, and the
multi-selection "self buffers" sum is overstated. After this plan every one of
these uses `effectiveChildren`, the existing helper that replaces an inactive
child by the active rows below it.

## Current state

Layout rule for this repository: the real code is in
`packages/ora-plan-core/src/...`. Files with the same name under `src/lib/`
(for example `src/lib/analysis.ts`, `src/lib/advisor/rules/shared.ts`) are
one-line `export *` shims — **never edit a shim**. Inside the package, sibling
imports carry an explicit `.ts` extension, and there is no React and no DOM.
App-only code (`src/lib/rowFlow.ts`, `src/lib/selectionStats.ts`) imports
through the shims without an extension (`from './analysis'`).

Oracle semantics this code must keep (project rules, quoted):

> E-Rows is per start, A-Rows is cumulative. Compare A-Rows only with
> `estimatedRowsTotal` via `nodeCardinalityRatio(node)`; never
> `actualRows / rows`. The total is E-Rows × Starts, except: inside a PX slave
> set and not on a NESTED LOOPS/FILTER probe side → E-Rows; under a partition
> iterator → the topmost iterator's Starts; a rowid fetch fed by an NLJ-batching
> / batched-rowid nested loop → the Starts of the index supplying the rowids;
> Starts = 0 or a COUNT STOPKEY cut-off → undefined. Ratios floor both sides
> at 1. Cost is cumulative (`selfCost` = cost − Σ children). Inactive adaptive
> rows (`-` prefix, XML `skp="1"`, `PlanNode.inactive`) are excluded from
> totals, hotspots, self numbers and every advisor rule. Use
> `analysis.effectiveChildren(node)` for self cost/time/buffers. `->` is the SQL
> Monitor "executing" marker, not inactive.

### The helper to use (already exists, do not change it)

`packages/ora-plan-core/src/analysis.ts:11-24`:

```ts
/**
 * The children whose work a node really waits on: each active child as is, and for an
 * inactive child (an adaptive-plan row the optimizer did not use) the effective children
 * below it instead. Cumulative cost/time of an active node under an inactive one still
 * flows to the nearest active ancestor this way.
 */
export function effectiveChildren(node: PlanNode): PlanNode[] {
  const result: PlanNode[] = [];
  for (const child of node.children) {
    if (child.inactive) result.push(...effectiveChildren(child));
    else result.push(child);
  }
  return result;
}
```

### The helper to remove

`packages/ora-plan-core/src/advisor/rules/shared.ts:1-6` and its two users in
the same file (`:25-29`, `:31-42`):

```ts
import type { PlanNode } from '../../types.ts';

/** Children of a node that belong to the executed plan (adaptive-plan rows that were not used are excluded). */
export function liveChildren(node: PlanNode): PlanNode[] {
  return node.children.filter((c) => !c.inactive);
}
```
```ts
export function selfBuffers(node: PlanNode): number | undefined {
  if (node.logicalReads === undefined) return undefined;
  const childGets = liveChildren(node).reduce((sum, c) => sum + (c.logicalReads ?? 0), 0);
  return Math.max(0, node.logicalReads - childGets);
}

/** Descendants of `node` (excluding it), skipping inactive adaptive-plan rows. */
export function liveDescendants(node: PlanNode): PlanNode[] {
  const out: PlanNode[] = [];
  const walk = (n: PlanNode) => {
    for (const c of liveChildren(n)) {
      out.push(c);
      walk(c);
    }
  };
  walk(node);
  return out;
}
```

### Every other use of `liveChildren` (complete list at `b5635d8`)

| File (under `packages/ora-plan-core/src/advisor/rules/`) | Line | Code |
|---|---|---|
| `nestedLoopVolume.ts` | 4 | `import { liveChildren, liveDescendants } from './shared.ts';` |
| `nestedLoopVolume.ts` | 15 | `const children = liveChildren(node);` then `if (children.length < 2) return undefined;` |
| `nestedLoopVolume.ts` | 45 | `const inner = liveChildren(node)[1];` |
| `hashJoinBuildSide.ts` | 4 | `import { liveChildren } from './shared.ts';` |
| `hashJoinBuildSide.ts` | 19 | `const kids = liveChildren(node);` then `if (kids.length < 2) continue;` and `const [build, probe] = kids;` |
| `perRowReexecution.ts` | 4 | `import { liveChildren } from './shared.ts';` |
| `perRowReexecution.ts` | 38 | `const kids = liveChildren(node);` (tree walk `visit`) |
| `perRowReexecution.ts` | 74 | `const rootKids = root ? liveChildren(root) : [];` |
| `perRowReexecution.ts` | 91 | `const kids = liveChildren(node);` (FILTER loop) |
| `indexRowsDiscarded.ts` | 5 | `import { isIndexScan, isTableByRowid, liveChildren } from './shared.ts';` |
| `indexRowsDiscarded.ts` | 24 | `const index = liveChildren(table).find(isIndexScan);` |
| `cardinalityMismatch.ts` | 4 | `import { liveChildren } from './shared.ts';` |
| `cardinalityMismatch.ts` | 41 | `liveChildren(node).some((child) => {` |

### The ancestor walk in the cardinality rule

`packages/ora-plan-core/src/advisor/rules/cardinalityMismatch.ts:37-56` and `:73`:

```ts
    // A node whose own estimate is wrong because a child's was (the error just flows upward)
    // is not a separate problem. Operations without a comparable estimate (never started,
    // cut off early) don't break the chain: look through them to their children.
    const inputsOff = (node: PlanNode): boolean =>
      liveChildren(node).some((child) => {
        if (off.get(child) !== undefined) return true;
        return nodeCardinalityRatio(child) === undefined && inputsOff(child);
      });

    const byId = new Map(ctx.plan.allNodes.map((n) => [n.id, n]));
    const inheritingAncestors = (node: PlanNode): number => {
      let count = 0;
      let parent = node.parentId === undefined ? undefined : byId.get(node.parentId);
      while (parent) {
        if (off.get(parent) !== undefined) count++;
        else if (nodeCardinalityRatio(parent) !== undefined) break; // estimate was right again: error absorbed
        parent = parent.parentId === undefined ? undefined : byId.get(parent.parentId);
      }
      return count;
    };
```
```ts
      const root = node.children.length === 0 ? '' : ' Its inputs were estimated accurately, so the error originates here.';
```

The walk follows `parentId` through `byId`, but the engine hands rules a plan
whose `allNodes` has the inactive rows filtered out
(`packages/ora-plan-core/src/advisor/engine.ts:36-40`), so `byId.get(...)`
returns `undefined` at the first inactive parent and the walk stops early:

```ts
  // Adaptive-plan rows the optimizer did not use never ran: rules must not see them.
  const inactiveIds = new Set(fullPlan.allNodes.filter((n) => n.inactive).map((n) => n.id));
  const plan: ParsedPlan = inactiveIds.size > 0
    ? { ...fullPlan, allNodes: fullPlan.allNodes.filter((n) => !n.inactive) }
    : fullPlan;
```

Do not change `engine.ts`. Node objects keep their full `children` arrays
(inactive rows included), which is what `effectiveChildren` walks.

### The two app helpers

`src/lib/rowFlow.ts:24-45` (feeds `src/components/views/experimental/WaterfallView.tsx`):

```ts
export function computeRowFlow(plan: ParsedPlan): RowFlowResult {
  const entries: RowFlowEntry[] = [];
  let leafRowsRead = 0;

  for (const node of plan.allNodes) {
    const { output, outputIsEstimate } = nodeOutput(node);

    if (node.children.length === 0) {
      entries.push({ node, output, outputIsEstimate, input: 0, factor: undefined, kind: 'source' });
      leafRowsRead += output;
      continue;
    }

    const input = node.children.reduce((sum, child) => sum + nodeOutput(child).output, 0);
```

`src/lib/selectionStats.ts:46-53`:

```ts
/** A node's own value of a cumulative count: node − Σ live children, floored at 0. */
function selfOf(node: PlanNode, pick: (n: PlanNode) => number | undefined, cumulative: boolean): number {
  const own = pick(node);
  if (own === undefined) return 0;
  if (!cumulative) return own;
  const childSum = node.children.filter((c) => !c.inactive).reduce((sum, c) => sum + (pick(c) ?? 0), 0);
  return Math.max(0, own - childSum);
}
```

### The real adaptive capture used by the tests

`src/lib/parser/__tests__/fixtures/allstats-adaptive-19c.txt` is a real 19c
`DISPLAY_CURSOR` capture. Fixtures are real Oracle output: **never edit or
hand-write a fixture**; tests parse it and change numbers on the parsed nodes
in memory. The part of its tree that matters (`-` = inactive):

```
   3  UNION-ALL                      children [4, 27]   effective children [4, 28]
 - 27   HASH JOIN                    children [28, 32]
   28     NESTED LOOPS               children [29, 31]  live [31]  effective [30, 31]
 - 29       STATISTICS COLLECTOR     children [30]
   30         INDEX FULL SCAN        Starts 1, E-Rows 1, A-Rows 1, Buffers 1
   31       INDEX RANGE SCAN         Starts 1, E-Rows 1, A-Rows 1, Buffers 1
 - 32     INDEX FULL SCAN            Starts 0
```
Buffers: node 3 = 17495, node 4 = 17493, node 28 = 2.

### Test conventions

- Tests are vitest. Advisor tests live in `src/lib/advisor/__tests__/`; the
  helper file `src/lib/advisor/__tests__/helpers.ts` exports `buildPlan`,
  `ruleCtx` and `byId(plan, id)`. Tests import through the shims without a
  file extension (`from '../rules/shared'`, `from '../../parser'`).
- Real files are read like this (`src/lib/__tests__/planNumbers.test.ts:300`):
  `readFileSync(join(__dirname, '../parser/__tests__/fixtures', name), 'utf-8')`.
- `import type` for type-only imports; TypeScript strict.

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Install (only if `node_modules/` is missing) | `npm ci` | exit 0 |
| Lint | `npm run lint` | exit 0, no output after the header |
| Typecheck | `npm run typecheck` | exit 0, no errors |
| All tests | `npm test` | builds the core package, then vitest; baseline at `b5635d8`: `Test Files  155 passed (155)` / `Tests  1787 passed (1787)`, about 15 s |
| One test file | `npx vitest run --environment jsdom <path>` | all pass |

## Scope

**In scope** (the only files you should modify or create):
- `packages/ora-plan-core/src/advisor/rules/shared.ts`
- `packages/ora-plan-core/src/advisor/rules/nestedLoopVolume.ts`
- `packages/ora-plan-core/src/advisor/rules/hashJoinBuildSide.ts`
- `packages/ora-plan-core/src/advisor/rules/perRowReexecution.ts`
- `packages/ora-plan-core/src/advisor/rules/indexRowsDiscarded.ts`
- `packages/ora-plan-core/src/advisor/rules/cardinalityMismatch.ts`
- `src/lib/rowFlow.ts`
- `src/lib/selectionStats.ts`
- `src/lib/advisor/__tests__/adaptivePlans.test.ts` (create)
- `src/lib/__tests__/rowFlow.test.ts` (append one `describe`)
- `src/lib/__tests__/selectionStats.test.ts` (append one `describe`)
- `plans/README.md` (status row only)

**Out of scope** (do NOT touch, even though they look related):
- `packages/ora-plan-core/src/analysis.ts` — `effectiveChildren` is correct as is.
- `packages/ora-plan-core/src/advisor/engine.ts` — the inactive-row filter stays.
- `packages/ora-plan-core/src/advisor/rules/mergeJoinCartesian.ts` and
  `partitionPruning.ts` — they read `node.children` directly, but a Cartesian
  merge join and a partition iterator are not adaptive alternatives.
- `src/lib/compare.ts` — it treats a flipped adaptive join as an exact match;
  a separate problem (see Maintenance notes).
- Any file under `src/lib/parser/__tests__/fixtures/` and `src/examples/`.
- The shims under `src/lib/advisor/` and `src/lib/analysis.ts`.
- `site/docs.html` — no change: the documented behaviour of the rules does not
  change, the rules now also work on adaptive plans.

## Git workflow

- Branch: `fix/advisor-effective-children`
- Commit per logical unit; conventional-commit messages as the repository uses
  (example from `git log`: `fix(lint): satisfy eslint-plugin-react-hooks 7.1 / react-refresh 0.5`).
  Suggested: `test(advisor): adaptive-plan cases for join, cardinality and per-row rules`,
  then `fix(advisor): look through inactive adaptive rows with effectiveChildren`.
- Do NOT push or open a PR unless the operator instructed it.

## Steps

### Step 0: Baseline

Run `npm test` and write down the two totals (`Test Files … passed`, `Tests … passed`).

**Verify**: `npm test` → exit 0; at `b5635d8` the totals are 155 files / 1787 tests (more if other plans have landed).

### Step 1: Add the tests (they must fail first)

Create `src/lib/advisor/__tests__/adaptivePlans.test.ts` with exactly this content:

```ts
import { readFileSync } from 'fs';
import { join } from 'path';
import { describe, it, expect } from 'vitest';
import { parsePlan } from '../../parser';
import { runAdvisor } from '../engine';
import { selfBuffers } from '../rules/shared';
import { byId } from './helpers';

// Real 19c capture (DISPLAY_CURSOR ALLSTATS LAST +ADAPTIVE). The adaptive join resolved to nested loops:
//    3 UNION-ALL
//  - 27   HASH JOIN               (inactive)
//    28     NESTED LOOPS
//  - 29       STATISTICS COLLECTOR (inactive)
//    30         INDEX FULL SCAN    <- outer input of 28, under an inactive row
//    31       INDEX RANGE SCAN     <- inner input of 28
//  - 32     INDEX FULL SCAN        (inactive)
// Never edit the fixture file: each test parses it and adjusts numbers on the parsed nodes in memory.
const adaptive = () =>
  parsePlan(readFileSync(join(__dirname, '../../parser/__tests__/fixtures/allstats-adaptive-19c.txt'), 'utf-8'));

const findingsOf = (plan: ReturnType<typeof adaptive>, ruleId: string) =>
  runAdvisor(plan, null).findings.filter((f) => f.ruleId === ruleId);

describe('advisor rules on adaptive plans (inactive rows are looked through)', () => {
  it('has the shape these tests rely on', () => {
    const plan = adaptive();
    expect([27, 29, 32].every((id) => byId(plan, id).inactive === true)).toBe(true);
    expect([3, 28, 30, 31].some((id) => byId(plan, id).inactive === true)).toBe(false);
    expect(byId(plan, 28).children.map((n) => n.id)).toEqual([29, 31]);
  });

  it('nested-loop-volume sees the outer input under the STATISTICS COLLECTOR', () => {
    const plan = adaptive();
    Object.assign(byId(plan, 30), { actualRows: 500_000 });
    Object.assign(byId(plan, 31), { starts: 500_000, actualRows: 5_000_000 });
    const findings = findingsOf(plan, 'nested-loop-volume');
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({ severity: 'critical', nodeIds: [28] });
    expect(findings[0].explanation).toContain('probed 500,000 times');
  });

  it('hash-join-build-side finds build and probe when the join resolved to a hash join', () => {
    const plan = adaptive();
    // The other resolution of the same adaptive join: HASH JOIN 27 ran, NESTED LOOPS 28 and its inner 31 did not.
    byId(plan, 27).inactive = false;
    byId(plan, 28).inactive = true;
    byId(plan, 31).inactive = true;
    byId(plan, 32).inactive = false;
    Object.assign(byId(plan, 30), { actualRows: 5_000_000 });
    Object.assign(byId(plan, 32), { starts: 1, actualRows: 10 });
    const findings = findingsOf(plan, 'hash-join-build-side');
    expect(findings).toHaveLength(1);
    expect(findings[0].nodeIds).toEqual([27]);
    expect(findings[0].explanation).toContain('operation 30');
    expect(findings[0].explanation).toContain('operation 32');
  });

  it('cardinality-mismatch attributes the error to the input under the inactive row, not to the join', () => {
    const plan = adaptive();
    Object.assign(byId(plan, 30), { actualRows: 100_000 }); // estimated 1
    Object.assign(byId(plan, 28), { actualRows: 100_000 }); // estimated 1: inherits the error of 30
    const findings = findingsOf(plan, 'cardinality-mismatch');
    expect(findings.some((f) => f.nodeIds.includes(28))).toBe(false);
    const origin = findings.find((f) => f.nodeIds.includes(30));
    expect(origin).toBeDefined();
    expect(origin!.explanation).toContain('The estimates of 1 operation above it are off because of this error.');
  });

  it('per-row-reexecution reaches a REMOTE inner side below an inactive row', () => {
    const plan = adaptive();
    Object.assign(byId(plan, 31), { operation: 'REMOTE', starts: 5_000, actualRows: 5_000 });
    const findings = findingsOf(plan, 'per-row-reexecution');
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({ severity: 'critical', nodeIds: [31] });
    expect(findings[0].explanation).toContain('the inner side of the NESTED LOOPS at operation 28');
  });

  it('selfBuffers subtracts the active rows below an inactive child', () => {
    const plan = adaptive();
    expect(selfBuffers(byId(plan, 28))).toBe(0); // 2 - 1 (30) - 1 (31); was 1 when 30 was dropped with 29
    expect(selfBuffers(byId(plan, 3))).toBe(0); // 17495 - 17493 (4) - 2 (28); was 2 when 28 was dropped with 27
  });
});
```

Append to the end of `src/lib/__tests__/rowFlow.test.ts` (the file already has
`makeNode`, `computeRowFlow`, `ParsedPlan` in scope):

```ts

describe('computeRowFlow on adaptive plans', () => {
  it('leaves out inactive rows and feeds the rows below them to the nearest active ancestor', () => {
    // NESTED LOOPS (ran) -> [ STATISTICS COLLECTOR (inactive) -> outer scan (ran), inner scan (ran) ],
    // next to the unused alternative: an inactive leaf that only has an estimate.
    const outer = makeNode({ id: 3, operation: 'TABLE ACCESS FULL', actualRows: 40 });
    const collector = makeNode({ id: 2, operation: 'STATISTICS COLLECTOR', inactive: true, rows: 7000, children: [outer] });
    const inner = makeNode({ id: 4, operation: 'INDEX RANGE SCAN', actualRows: 60 });
    const unused = makeNode({ id: 5, operation: 'TABLE ACCESS FULL', inactive: true, rows: 5000 });
    const root = makeNode({ id: 1, operation: 'NESTED LOOPS', actualRows: 50, children: [collector, inner, unused] });
    const plan: ParsedPlan = {
      rootNode: root,
      allNodes: [root, collector, outer, inner, unused],
      totalCost: 0,
      maxRows: 0,
      source: 'sql_monitor_xml',
      hasActualStats: true,
    };

    const flow = computeRowFlow(plan);

    expect(flow.entries.map((e) => e.node.id)).toEqual([1, 3, 4]);
    expect(flow.entries.find((e) => e.node.id === 1)!.input).toBe(100); // 40 + 60, not 7000 + 60 + 5000
    expect(flow.leafRowsRead).toBe(100); // not 5,100: the inactive leaf's estimate is not rows read
  });
});
```

Append to the end of `src/lib/__tests__/selectionStats.test.ts` (the file
already has the `node(id, parentId, extra)` helper and `computeSelectionStats`
in scope):

```ts

describe('computeSelectionStats on adaptive plans', () => {
  it('subtracts the active rows below an inactive child from self buffers', () => {
    // 0 NESTED LOOPS (100) -> [ 1 STATISTICS COLLECTOR (inactive, 70) -> 2 scan (70), 3 scan (20) ]
    const join = node(0, undefined, { logicalReads: 100, physicalReads: 10 });
    const collector = node(1, 0, { inactive: true, logicalReads: 70, physicalReads: 7 });
    const outer = node(2, 1, { logicalReads: 70, physicalReads: 7 });
    const inner = node(3, 0, { logicalReads: 20, physicalReads: 2 });
    join.children = [collector, inner];
    collector.children = [outer];
    const allNodes = [join, collector, outer, inner];

    const stats = computeSelectionStats([join], allNodes, 'dbms_xplan');
    expect(stats.sumSelfBuffers).toBe(10); // 100 - 70 - 20, not 100 - 20
    expect(stats.sumSelfPhysicalReads).toBe(1); // 10 - 7 - 2, not 10 - 2
  });
});
```

**Verify**: `npx vitest run --environment jsdom src/lib/advisor/__tests__/adaptivePlans.test.ts src/lib/__tests__/rowFlow.test.ts src/lib/__tests__/selectionStats.test.ts`
→ exit code 1 with exactly **7 failed**, 10 passed: in `adaptivePlans.test.ts`
every test except "has the shape these tests rely on" fails (5), plus the new
test in each of the other two files. If "has the shape…" fails, STOP (the
fixture is not what this plan assumes).

### Step 2: Use `effectiveChildren` in the five rule files

In each file below, import `effectiveChildren` from `'../../analysis.ts'`
(keep the `.ts` extension) and replace every `liveChildren(` call with
`effectiveChildren(`. Do not change anything else in these files in this step.

- `nestedLoopVolume.ts`: the import line becomes two lines
  ```ts
  import { effectiveChildren } from '../../analysis.ts';
  import { liveDescendants } from './shared.ts';
  ```
  and lines 15 and 45 call `effectiveChildren(node)`.
- `hashJoinBuildSide.ts`: `import { effectiveChildren } from '../../analysis.ts';`
  replaces the `liveChildren` import; line 19 becomes `const kids = effectiveChildren(node);`.
- `perRowReexecution.ts`: same import replacement; the three calls (lines 38, 74, 91).
- `indexRowsDiscarded.ts`: the import becomes
  ```ts
  import { effectiveChildren } from '../../analysis.ts';
  import { isIndexScan, isTableByRowid } from './shared.ts';
  ```
  and line 24 becomes `const index = effectiveChildren(table).find(isIndexScan);`.
- `cardinalityMismatch.ts`: `import { effectiveChildren } from '../../analysis.ts';`
  replaces the `liveChildren` import; line 41 becomes
  `effectiveChildren(node).some((child) => {`.

**Verify**:
- `grep -rn "liveChildren" packages/ora-plan-core/src/advisor/rules/` → matches only in `shared.ts` (3 lines).
- `npm run typecheck` → exit 0.
- `npx vitest run --environment jsdom src/lib/advisor/__tests__/adaptivePlans.test.ts` → **2 failed, 4 passed**; the two still failing are "cardinality-mismatch attributes the error…" and "selfBuffers subtracts…".

### Step 3: Make the cardinality rule's ancestor walk skip inactive rows

In `packages/ora-plan-core/src/advisor/rules/cardinalityMismatch.ts` replace
the `byId` map and `inheritingAncestors` (the second code block quoted under
"The ancestor walk in the cardinality rule") with:

```ts
    // Nearest active ancestor of each active node: inactive adaptive-plan rows in between are skipped
    // (ctx.plan.allNodes may not contain them, so parentId cannot be followed).
    const activeParentOf = new Map<PlanNode, PlanNode>();
    for (const n of ctx.plan.allNodes) {
      if (n.inactive) continue;
      for (const child of effectiveChildren(n)) activeParentOf.set(child, n);
    }
    const inheritingAncestors = (node: PlanNode): number => {
      let count = 0;
      let parent = activeParentOf.get(node);
      while (parent) {
        if (off.get(parent) !== undefined) count++;
        else if (nodeCardinalityRatio(parent) !== undefined) break; // estimate was right again: error absorbed
        parent = activeParentOf.get(parent);
      }
      return count;
    };
```

and change the `root` line to test the effective children:

```ts
      const root = effectiveChildren(node).length === 0 ? '' : ' Its inputs were estimated accurately, so the error originates here.';
```

`byId` must no longer exist in this file (it had no other use).

**Verify**:
- `grep -n "byId" packages/ora-plan-core/src/advisor/rules/cardinalityMismatch.ts` → no matches.
- `npx vitest run --environment jsdom src/lib/advisor/__tests__/adaptivePlans.test.ts src/lib/advisor/__tests__/cardinalityMismatch.test.ts` → only "selfBuffers subtracts…" fails; every test in `cardinalityMismatch.test.ts` passes.

### Step 4: Remove `liveChildren` from `shared.ts`

In `packages/ora-plan-core/src/advisor/rules/shared.ts`:

1. Delete the `liveChildren` function and its doc comment (lines 3-6) and add
   the import, so the file starts:
   ```ts
   import type { PlanNode } from '../../types.ts';
   import { effectiveChildren } from '../../analysis.ts';
   ```
2. In `selfBuffers`: `const childGets = effectiveChildren(node).reduce((sum, c) => sum + (c.logicalReads ?? 0), 0);`
3. In `liveDescendants`: the loop becomes `for (const c of effectiveChildren(n)) {`
   and its doc comment becomes
   `/** Active descendants of \`node\` (excluding it). Inactive adaptive-plan rows are looked through, not returned. */`
   Keep the name `liveDescendants`.

**Verify**:
- `grep -rn "liveChildren" packages/ src/ --include=*.ts --include=*.tsx` → no matches.
- `npm run typecheck` → exit 0.
- `npx vitest run --environment jsdom src/lib/advisor` → all pass (including the 6 tests of `adaptivePlans.test.ts`; no snapshot is rewritten).

### Step 5: Fix the two app helpers

`src/lib/rowFlow.ts`: add `import { effectiveChildren } from './analysis';`
as the first import, and change the loop to:

```ts
  for (const node of plan.allNodes) {
    // Inactive adaptive-plan rows never ran: they are not a step, and the active rows below
    // them feed the nearest active ancestor (effectiveChildren).
    if (node.inactive) continue;
    const { output, outputIsEstimate } = nodeOutput(node);
    const inputs = effectiveChildren(node);

    if (inputs.length === 0) {
      entries.push({ node, output, outputIsEstimate, input: 0, factor: undefined, kind: 'source' });
      leafRowsRead += output;
      continue;
    }

    const input = inputs.reduce((sum, child) => sum + nodeOutput(child).output, 0);
```
(the rest of the loop body is unchanged).

`src/lib/selectionStats.ts`: add `import { effectiveChildren } from './analysis';`
as the first import, and in `selfOf` replace the `childSum` line and the doc
comment:

```ts
/** A node's own value of a cumulative count: node − Σ effective children, floored at 0. */
```
```ts
  const childSum = effectiveChildren(node).reduce((sum, c) => sum + (pick(c) ?? 0), 0);
```

**Verify**: `npx vitest run --environment jsdom src/lib/__tests__/rowFlow.test.ts src/lib/__tests__/selectionStats.test.ts src/components/__tests__/experimentalRows.test.tsx src/components/__tests__/ExperimentalView.test.tsx` → all pass.

### Step 6: Full verification

**Verify**:
- `npm run lint` → exit 0.
- `npm run typecheck` → exit 0.
- `npm test` → exit 0; `Test Files` is the Step 0 number **+1**, `Tests` is the Step 0 number **+8**; no line says a snapshot was written or is obsolete.

## Test plan

- New file `src/lib/advisor/__tests__/adaptivePlans.test.ts` (6 tests, content
  in Step 1), all on the real capture `allstats-adaptive-19c.txt` through
  `runAdvisor` (so the engine's inactive-row filter is part of the test):
  shape guard; nested-loop-volume on node 28; hash-join-build-side on node 27
  with the join flipped to its other resolution in memory; cardinality-mismatch
  origin on node 30 with one inheriting ancestor and no finding on 28;
  per-row-reexecution on a REMOTE inner side; `selfBuffers` of nodes 28 and 3.
- `src/lib/__tests__/rowFlow.test.ts`: one synthetic case (inactive rows are
  not entries; inputs come from the effective children; an inactive leaf's
  estimate is not counted as rows read).
- `src/lib/__tests__/selectionStats.test.ts`: one synthetic case (self buffers
  and self physical reads subtract the active row below an inactive child).
- Existing tests that must keep passing unchanged, in particular
  `src/lib/advisor/__tests__/hashJoinBuildSide.test.ts` "skips inactive
  adaptive-plan children" (an inactive **leaf** child is still skipped) and the
  snapshot in `src/lib/advisor/__tests__/exampleFindings.test.ts`.
- Structural pattern for advisor tests: `src/lib/advisor/__tests__/nestedLoopVolume.test.ts`.

## Done criteria

Machine-checkable. ALL must hold:

- [ ] `grep -rn "liveChildren" packages/ src/ --include=*.ts --include=*.tsx` returns no matches
- [ ] `grep -c "effectiveChildren" packages/ora-plan-core/src/advisor/rules/*.ts` shows a non-zero count for `shared.ts`, `nestedLoopVolume.ts`, `hashJoinBuildSide.ts`, `perRowReexecution.ts`, `indexRowsDiscarded.ts`, `cardinalityMismatch.ts`
- [ ] `npx vitest run --environment jsdom src/lib/advisor/__tests__/adaptivePlans.test.ts` → 6 passed
- [ ] `npm run lint` exits 0
- [ ] `npm run typecheck` exits 0
- [ ] `npm test` exits 0 with Step 0 totals +1 file / +8 tests and no snapshot written
- [ ] `git status --porcelain` lists only files from the in-scope list
- [ ] `git diff --stat b5635d8..HEAD -- src/lib/parser/__tests__/fixtures src/examples` is empty
- [ ] `plans/README.md` status row for 009 updated

## STOP conditions

Stop and report back (do not improvise) if:

- The code at the locations in "Current state" does not match the excerpts
  (other than line-number shifts).
- `grep -rn "liveChildren"` finds a use that is not in the table under
  "Every other use of `liveChildren`" — a new caller needs a decision.
- The Step 1 test "has the shape these tests rely on" fails.
- After Step 4 an **existing** advisor test fails, or vitest reports a changed
  or obsolete snapshot (for example in `exampleFindings.test.ts`): the bundled
  examples then contain an adaptive shape this plan did not anticipate. Report
  the diff; do not update the snapshot.
- A step's verification fails twice after a reasonable fix attempt.
- Making a test pass seems to require editing `analysis.ts`, `engine.ts`, a
  fixture, or any other out-of-scope file.

## Maintenance notes

- New advisor rules must take children through `effectiveChildren` (from
  `analysis.ts`); `node.children` is the raw tree including rows that never
  ran. A reviewer should reject a new `children.filter((c) => !c.inactive)`.
- `effectiveChildren` flattens: an inactive row with two active subtrees
  contributes both, in plan order. Positional rules (`[build, probe]`,
  `[outer, inner]`) rely on Oracle's adaptive shape, where the inactive
  alternative contributes at most one active input per side. If Oracle ever
  prints a shape where that is not true, the join rules need more than this.
- Deferred on purpose: `src/lib/compare.ts` builds its match signature without
  `inactive`, so comparing two executions where the adaptive join flipped
  reports every row as an exact match. Fixing it changes the Compare view's
  output and deserves its own change with two real captures.
- Not changed: `mergeJoinCartesian.ts` and `partitionPruning.ts` read
  `node.children` directly (not adaptive alternatives today).
- Reviewer focus: the cardinality rule's `activeParentOf` map (must skip
  inactive nodes when the rule is called with an unfiltered plan, as the unit
  tests do through `ruleCtx`), and that no snapshot moved.
