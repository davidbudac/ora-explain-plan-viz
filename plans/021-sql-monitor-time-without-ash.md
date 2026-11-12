# Plan 021: SQL Monitor active-window times are not turned into self time or a hotspot

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **DECISION GATE — read before anything else.** This plan changes what users
> see on five bundled examples, the guided tour and the landing page (section
> "What the maintainer accepts with Option A"). Steps 0 and 1 are safe for
> anyone to run. **Do not start Step 2 unless the operator who dispatched you
> wrote explicitly that the maintainer chose "Option A" for plan 021.** If the
> task message does not say so: do Step 0 and Step 1, report the Step 1 result,
> set this plan's row in `plans/README.md` to
> `BLOCKED (waiting for maintainer decision: Option A or B)`, and stop.
>
> **Drift check (run first)**:
> `git diff --stat b5635d8..HEAD -- packages/ora-plan-core/src/analysis.ts packages/ora-plan-core/src/types.ts packages/ora-plan-core/src/parser/sqlMonitorParser.ts src/lib/walkthrough.ts src/components/Walkthrough.tsx src/lib/__tests__/walkthrough.test.ts site/docs.html site/index.html`
> If any in-scope file changed since this plan was written, compare the
> "Current state" excerpts against the live code before proceeding; on a
> mismatch, treat it as a STOP condition. Other plans may have landed first and
> shifted line numbers; match on the quoted code, not the line number.
> `plans/015-small-correctness-fixes.md` and
> `plans/016-formatter-unit-boundaries.md` work nearby
> (`packages/ora-plan-core/src/format.ts`, small fixes in
> `sqlMonitorParser.ts` and around `analysis.ts`); if they have landed, expect
> shifted line numbers in those files, not different code in the functions
> quoted below.

## Status

- **Priority**: P2
- **Effort**: M
- **Risk**: MED (visible behaviour change on bundled examples, tour and landing page)
- **Depends on**: none in code; **requires the maintainer's choice of Option A** (see the decision gate)
- **Category**: bug
- **Planned at**: commit `b5635d8`, 2026-11-11

## Why this matters

For every other source the per-operation time (`PlanNode.actualTime`) is a
measured, cumulative A-Time, and the app derives each operation's own time from
it (`selfTime` = time − Σ children) to rank operations and put the red
"Hotspot" ring on the slowest one. A SQL Monitor report does not carry that
number. Its per-operation time is the **active window**: the whole seconds
between the operation's first and last activity, minimum 1 ("Time Active(s)"
in the text report, the `duration` stat in XML). Windows of a parent and its
children overlap, so "window − Σ children's windows" is not anyone's own time.
The code says so itself (comment at `analysis.ts:237-241`: "derived self time
is meaningless") and uses ASH activity for the ranking when the report has ASH
samples. When it has none — every statement that ran for less than about a
second — it falls back to the meaningless number. Measured on the bundled
examples: in five of them every candidate operation has a "self time" of
exactly 1,000 ms in statements that took 123–400 ms in total, and the hotspot
ring simply lands on the first leaf. Example 17 shows a self-time sum of
13,000 ms for a statement that ran 1,000 ms. The ring, the "Slowest ops" list,
the "Self time" figure and the client report's "Where the Time Went" table
present noise as a finding.

## Current state

Layout rule for this repository: the real code is in
`packages/ora-plan-core/src/...`. Files with the same name under `src/lib/`
(`src/lib/analysis.ts`, `src/lib/types.ts`, `src/lib/parser/…`) are one-line
`export *` shims — **never edit a shim**. Inside the package, sibling imports
carry an explicit `.ts` extension; no React, no DOM. App code under `src/`
imports through the shims without an extension. `import type` for type-only
imports. Tailwind / React conventions do not matter for this plan.

Oracle semantics that must not break (project rules, quoted):

> E-Rows is per start, A-Rows is cumulative. Compare A-Rows only with
> `estimatedRowsTotal` via `nodeCardinalityRatio(node)`; never
> `actualRows / rows`. Cost is cumulative: `totalCost` = root cost; `selfCost`
> = cost − Σ children. Inactive adaptive rows (`-` prefix, XML `skp="1"`;
> `PlanNode.inactive`) are excluded from totals, hotspots, self numbers and
> every advisor rule. Use `analysis.effectiveChildren(node)` for self
> cost/time/buffers. `->` is the SQL Monitor "executing" marker, not inactive.

### Where the active window becomes `actualTime`

Text report — `packages/ora-plan-core/src/parser/sqlMonitorParser.ts:407-408`
maps the time column (in a real report its header is "Time Active(s)"):

```ts
    } else if (segment === 'a-time' || segment === 'actual time' || segment === 'time' || segment === 'time active(s)' || segment === 'time active (s)' || /^time$/.test(segment)) {
      cols.aTime = { start, end };
```

and `:493-497` stores it:

```ts
  if (columns.aTime) {
    const timeStr = line.substring(columns.aTime.start, columns.aTime.end).trim();
    const timeMs = parseTimeToMs(timeStr);
    if (timeMs !== null) row.actualTime = timeMs;
  }
```

XML report — `:1018-1027` (inside `parseMonitorOperation`); real reports have
only `duration` per operation (checked: all bundled XML examples and XML
fixtures have a `duration` stat and no `elapsed_time` stat under
`<plan_monitor>`):

```ts
  const elapsedTimeUs = getStatByName(statsEl, 'elapsed_time');
  const duration = getStatByName(statsEl, 'duration');

  // Elapsed time: prefer elapsed_time (microseconds), fallback to duration (seconds)
  let actualTimeMs: number | undefined;
  if (elapsedTimeUs !== undefined) {
    actualTimeMs = elapsedTimeUs / 1000;
  } else if (duration !== undefined) {
    actualTimeMs = duration * 1000;
  }
```

### Why `plan.source` cannot be the switch

`source: 'sql_monitor_text'` is **also** what a bare A-Rows table gets (a
DBMS_XPLAN `ALLSTATS` table pasted without its "Plan hash value" line), and
there the time column is a true cumulative A-Time. `sqlMonitorParser.ts:35-36`
and `:43-50`:

```ts
/** Header markers that only a SQL Monitor report carries. */
const SQL_MONITOR_MARKERS = /SQL Monitoring Report|SQL Plan Monitoring Details|Global Stats/i;
```
```ts
  canParse(input: string): boolean {
    // SQL Monitor text reports typically contain these markers
    if (SQL_MONITOR_MARKERS.test(input)) return true;
    // A bare table with an A-Rows column (hand-made input). With a "Plan hash value:"
    // line it is DBMS_XPLAN.DISPLAY_CURSOR ALLSTATS output, which the DBMS_XPLAN
    // parser reads faithfully (Buffers, OMem/1Mem/Used-Mem, query blocks, Pstart…).
    return /\|\s*Id\s*\|.*A-Rows/i.test(input) && !/Plan\s+hash\s+value\s*:\s*\d+/i.test(input);
  },
```

The synthetic-plan test helpers (`src/lib/__tests__/fixtures/buildPlan.ts`,
`src/lib/advisor/__tests__/helpers.ts`) also default to
`source: 'sql_monitor_text'`. So the parsers must **say** when the time is an
active window; this plan adds a plan-level flag for that.

The text parser's return value, `:122-137`:

```ts
    return {
      planHashValue,
      sqlId,
      childNumber,
      rootNode,
      allNodes,
      totalCost,
      maxRows: hasActualStats ? maxActualRows : maxRows,
      maxActualRows: hasActualStats ? maxActualRows : undefined,
      maxStarts: hasActualStats ? maxStarts : undefined,
      warnings: warnings.length > 0 ? warnings : undefined,
      source: 'sql_monitor_text',
      hasActualStats,
      totalElapsedTime,
      notes,
    };
```

The XML parser: `const planMonitor = doc.querySelector('plan_monitor');` at
`:690`, then at `:742-743`

```ts
  // Parse activity samples (ASH) and assign per-operation activityPercent
  applyActivitySamples(doc, nodeMap, activityTimeline);
```

and its return value at `:837-856` contains

```ts
    source: 'sql_monitor_xml',
    hasActualStats,
    totalElapsedTime,
    bindVariables: bindVariables.length > 0 ? bindVariables : undefined,
```

(A second, "legacy XML" return near `:1453-1466` also has
`source: 'sql_monitor_xml'`; it reads a per-operation `elapsed_time` attribute.
Leave it alone.)

### Where the time is turned into self time, ranking and hotspot

`packages/ora-plan-core/src/analysis.ts`, end of `computeSelfTimes`, `:79-92`:

```ts
  } else {
    for (const node of plan.allNodes) {
      if (node.actualTime === undefined || node.inactive) {
        node.selfTime = undefined;
        continue;
      }
      const childSum = effectiveChildren(node).reduce(
        (sum, child) => sum + (child.actualTime ?? 0), 0);
      node.selfTime = Math.max(0, node.actualTime - childSum);
    }
  }

  plan.maxSelfTime = Math.max(0, ...plan.allNodes.map((n) => n.selfTime ?? 0));
}
```

`:234-283`:

```ts
const isSqlMonitorSource = (plan: ParsedPlan): boolean =>
  plan.source === 'sql_monitor_text' || plan.source === 'sql_monitor_xml';

/**
 * Whether time ranking should use ASH activity: SQL Monitor sources, where
 * A-Time active windows overlap so derived self time is meaningless, and at
 * least one non-root node has an ASH activity share.
 */
export function usesActivityRanking(plan: ParsedPlan): boolean {
  return isSqlMonitorSource(plan)
    && plan.allNodes.some((n) => n.parentId !== undefined && (n.activityPercent ?? 0) > 0);
}

export function rankNodesByTime(plan: ParsedPlan): PlanNode[] {
  const byActivity = usesActivityRanking(plan);
  const measure = (n: PlanNode): number | undefined =>
    byActivity ? n.activityPercent : (n.selfTime ?? n.actualTime);
  return plan.allNodes
    .filter((n) => n.parentId !== undefined && !n.inactive && measure(n) !== undefined)
    .sort((a, b) => (measure(b) ?? 0) - (measure(a) ?? 0));
}

export function computeHottestNodeId(plan: ParsedPlan | null): number | null {
  if (!plan?.hasActualStats) return null;

  const byActivity = usesActivityRanking(plan);
  let hottestId: number | null = null;
  let hottestTime = 0;
  for (const node of plan.allNodes) {
    if (node.parentId === undefined || node.inactive) continue; // skip root statement nodes and inactive rows
    const time = byActivity ? node.activityPercent : (node.selfTime ?? node.actualTime);
    if (time !== undefined && time > hottestTime) {
      hottestTime = time;
      hottestId = node.id;
    }
  }
  return hottestId;
}
```

(doc comments between the functions omitted here; keep them and extend them as
Step 4 says.) `ParsedPlan` is declared at
`packages/ora-plan-core/src/types.ts:114`; the line this plan adds a field
after is `:132`:

```ts
  totalElapsedTime?: number;  // total execution time in milliseconds
```

### Characterisation of the current behaviour (measured at `b5635d8`)

Bundled SQL Monitor examples in `src/examples/`:

| Example file | Source | ASH activity? | Total elapsed ms | Hotspot today | Its selfTime ms | Σ selfTime, non-root ms |
|---|---|---|---|---|---|---|
| `17-sql_monitor-Exadata Cell Offload (K. Osborne).txt` | text | yes | 1000 | 4 (by activity) | 0 | 13000 |
| `18-sql_monitor-Skewed Parallel (J. Lewis).txt` | text | yes | 0 | 30 (by activity) | 1000 | 1100000 |
| `21-sql_monitor-Star Schema Rollup.txt` | xml | **no** | 399.675 | 3 (first leaf; 4 nodes tied) | 1000 | 4000 |
| `22-sql_monitor-Cardinality Trap (NL).txt` | xml | **no** | 146.466 | 4 (first leaf; 3 tied) | 1000 | 3000 |
| `23-sql_monitor-Window Sort Spill.txt` | xml | yes | 8531.237 | 4 (by activity) | 5000 | 8000 |
| `24-sql_monitor-Recursive BOM.txt` | xml | **no** | 137.51 | 5 (first leaf; 6 tied) | 1000 | 6000 |
| `27-sql_monitor-Partitioned Star Query.txt` | xml | **no** | 325.716 | 8 (first leaf; 3 tied) | 1000 | 3000 |
| `28-sql_monitor-Partition Range Iterator.txt` | xml | **no** | 123.014 | 3 (first leaf; 3 tied) | 1000 | 3000 |

All other bundled examples with runtime statistics (12 JSON, 13 and 14 XBI,
29 DBMS_XPLAN) are not SQL Monitor reports and are not affected.

### Everything that consumes these numbers

| Consumer | Where | With Option A, for a SQL Monitor report |
|---|---|---|
| Self time derivation | `packages/ora-plan-core/src/analysis.ts:43-92`, called from `parser/index.ts:55-59` (`finalizePlan`) | no `selfTime` on any node; `maxSelfTime` 0 |
| Time ranking | `analysis.ts` `rankNodesByTime` → `src/lib/worstNodes.ts:28-29` → "Slowest ops" accordion, `src/components/NodeDetailPanel.tsx:240-262` | by ASH activity as today; **empty (accordion hidden) without ASH** |
| Hotspot id | `analysis.ts` `computeHottestNodeId` → `src/hooks/usePlanContext.tsx:1750-1751` (context `hottestNodeId`), `src/components/views/HierarchicalView.tsx:297-298` and `:1127` (ring), `src/components/views/TabularView.tsx:334-335` and `:947` (row highlight) | by ASH activity as today; **none without ASH** |
| Overview "top things" hotspot item | `src/lib/overview.ts:114-123`, `:154` | item absent without ASH |
| Guided tour, step "details" | `src/components/Walkthrough.tsx:285`, text in `src/lib/walkthrough.ts:46-48`; the tour loads example 22 (`pickWalkthroughSample`, `src/lib/walkthrough.ts:232-244`) | **needs a fallback** (Step 6): example 22 has no hotspot any more |
| Node details "Self time" | `src/components/NodeDetailPanel.tsx:654-657` (shown only when `selfTime` is defined) | not shown; "A-Time (cumul.)" still shows the window |
| Client report | `src/lib/clientReport.ts:127` (hot marker), `:152-153` (A-Time and Self columns), `:246-266` ("Where the Time Went", top 5 by `selfTime`) | Self column blank; "Where the Time Went" section omitted; marker only with ASH |
| AI / agent plan table | `src/lib/ai/planText.ts:21-22`, `:39-40` (`A-Self` column; empty columns are dropped) | `A-Self` column dropped |
| Multi-selection stats | `src/lib/selectionStats.ts:83`, `:94-97` | label "A-Time", sum over outermost selected nodes |
| Compare metric "Self time" | `src/lib/compare.ts:243`, `src/components/CompareMetricSelector.tsx:15` | no value (`-`) |
| Experimental scatter radius | `src/components/views/experimental/ScatterView.tsx:127-129`, `:183-187` | all points minimum size (already handled: `maxSelf <= 0`) |
| Agent handoff / skill wording | `src/lib/agentHandoff.ts:404`, `:408`; `skills/oracle-plan-analysis/SKILL.md:18` | already say SQL Monitor time is a coarse active duration; unchanged |

`actualTime` itself (shown as "A-Time" on node cards, in the tabular view, the
flame and Sankey time metrics, filters, Compare) is **not** changed: the window
stays visible wherever it is today.

## The decision

**Option A (recommended, implemented by Steps 2-8).** Parsers mark a plan whose
per-operation times are active windows (`ParsedPlan.timeIsActiveWindow`). For
such a plan no self time is derived, and without ASH activity there is no time
ranking and no hotspot. Reports with ASH keep their activity-based ranking and
hotspot exactly as today. Honest, small, and it removes every place where the
derived number is shown as a measurement.

**Option B (alternative, not planned here).** Keep ranking by the active
window but label it for what it is ("Longest active", "active for N s"), still
drop the derived self time, and show no hotspot when all candidates tie. It
keeps a ring on long-running reports without ASH, at the price of new wording
in several components and a ranking that is still not "where the time went".
If the maintainer chooses B, this plan must be rewritten; do not improvise it.

### What the maintainer accepts with Option A

1. Bundled examples **21, 22, 24, 27 and 28** lose the hotspot ring, the
   "Slowest ops" list and the overview's hotspot item (they have no ASH
   samples). Examples 17, 18 and 23 keep their ASH-based hotspot but no longer
   show a "Self time" value.
2. The guided tour's sample is example 22. Its "details" step can no longer
   select "the hottest operation"; Step 6 makes it select the operation of the
   advisor's top finding and rewords the step.
3. Showcase media become stale and need a re-capture with a browser, which is
   **not part of this plan**: `scripts/capture-showcase.mjs` shoots
   `hotspot.png` / `hotspots.gif` from `?example=22` (its `hotspots()` step
   hovers "the hotspot node", which will not exist) and `hero.png` from
   `?example=21`; `README.md:9` captions the hero "Tree view with hotspots";
   `site/docs.html:552` shows `assets/hotspot.png`.
4. Landing page card "02 Hotspot detection & runtime stats"
   (`site/index.html:192-199`) links `?example=22` and says the node with the
   highest A-Time gets the ring. Step 7 rewords it and points it at example 23.

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Install (only if `node_modules/` is missing) | `npm ci` | exit 0 |
| Lint | `npm run lint` | exit 0 |
| Typecheck | `npm run typecheck` | exit 0, no errors |
| All tests | `npm test` | builds the core package, then vitest; baseline at `b5635d8`: `Test Files  155 passed (155)` / `Tests  1787 passed (1787)`, about 15 s |
| One test file | `npx vitest run --environment jsdom <path>` | all pass |

## Scope

**In scope** (the only files you should modify or create):
- `src/lib/__tests__/sqlMonitorTime.test.ts` (create in Step 1, rewrite in Step 5)
- `packages/ora-plan-core/src/types.ts`
- `packages/ora-plan-core/src/parser/sqlMonitorParser.ts`
- `packages/ora-plan-core/src/analysis.ts`
- `src/lib/walkthrough.ts`
- `src/components/Walkthrough.tsx`
- `src/lib/__tests__/walkthrough.test.ts`
- `site/docs.html`
- `site/index.html`
- `plans/README.md` (status row only)

**Out of scope** (do NOT touch, even though they look related):
- Every consumer listed in the table above other than the tour: they already
  cope with a missing `selfTime` / `null` hotspot. Do not relabel "A-Time".
- `usesActivityRanking` — unchanged.
- The legacy-XML branch of `sqlMonitorParser.ts` and the XBI branch of
  `computeSelfTimes`.
- `scripts/capture-showcase.mjs`, everything under `site/assets/`, `README.md`
  — re-capturing media needs a browser and is the maintainer's follow-up.
- `src/examples/*`, `src/lib/parser/__tests__/fixtures/*` (real captures; never edited).
- `src/lib/agentHandoff.ts` and `skills/oracle-plan-analysis/` — their wording
  is already correct and must stay in sync with each other.

## Git workflow

- Branch: `fix/sql-monitor-time-without-ash`
- Conventional-commit messages as the repository uses (example from `git log`:
  `fix(lint): satisfy eslint-plugin-react-hooks 7.1 / react-refresh 0.5`).
  Suggested: `test(analysis): characterise SQL Monitor time ranking` (Step 1),
  `fix(analysis): no self time or hotspot from SQL Monitor active windows`
  (Steps 2-5), `fix(tour): select the top finding when the plan has no hotspot`
  (Step 6), `docs(site): hotspots on SQL Monitor reports` (Step 7).
- Do NOT push or open a PR unless the operator instructed it.

## Steps

### Step 0: Baseline

**Verify**: `npm test` → exit 0; write down the `Test Files` and `Tests` totals.

### Step 1: Characterise the current behaviour (safe without a decision)

Create `src/lib/__tests__/sqlMonitorTime.test.ts`:

```ts
import { readFileSync } from 'fs';
import { join } from 'path';
import { describe, expect, it } from 'vitest';
import { computeHottestNodeId, usesActivityRanking } from '../analysis';
import { parsePlan } from '../parser';

const example = (name: string) => parsePlan(readFileSync(join(__dirname, '../../examples', name), 'utf-8'));

// [file, ranked by ASH activity?, total elapsed ms, hottest node id, its selfTime ms, Σ selfTime of non-root nodes ms]
const CURRENT: Array<[string, boolean, number, number, number, number]> = [
  ['17-sql_monitor-Exadata Cell Offload (K. Osborne).txt', true, 1000, 4, 0, 13000],
  ['18-sql_monitor-Skewed Parallel (J. Lewis).txt', true, 0, 30, 1000, 1100000],
  ['21-sql_monitor-Star Schema Rollup.txt', false, 399.675, 3, 1000, 4000],
  ['22-sql_monitor-Cardinality Trap (NL).txt', false, 146.466, 4, 1000, 3000],
  ['23-sql_monitor-Window Sort Spill.txt', true, 8531.237, 4, 5000, 8000],
  ['24-sql_monitor-Recursive BOM.txt', false, 137.51, 5, 1000, 6000],
  ['27-sql_monitor-Partitioned Star Query.txt', false, 325.716, 8, 1000, 3000],
  ['28-sql_monitor-Partition Range Iterator.txt', false, 123.014, 3, 1000, 3000],
];

describe('SQL Monitor time: characterisation of the current behaviour', () => {
  it.each(CURRENT)('%s', (name, ash, totalMs, hottest, hottestSelf, selfSum) => {
    const plan = example(name);
    expect(usesActivityRanking(plan)).toBe(ash);
    expect(plan.totalElapsedTime).toBeCloseTo(totalMs, 3);
    expect(computeHottestNodeId(plan)).toBe(hottest);
    expect(plan.allNodes.find((n) => n.id === hottest)!.selfTime).toBe(hottestSelf);
    const sum = plan.allNodes.filter((n) => n.parentId !== undefined).reduce((s, n) => s + (n.selfTime ?? 0), 0);
    expect(sum).toBe(selfSum);
  });
});
```

**Verify**: `npx vitest run --environment jsdom src/lib/__tests__/sqlMonitorTime.test.ts`
→ **8 passed**. This is the machine-checked form of the characterisation
table. If any row fails, STOP: the examples or the analysis have changed since
this plan was written and the table must be redone before deciding.

**Decision gate**: without an explicit "Option A" from the operator, commit
this test on the branch, report "Step 1: 8 passed", mark the plan BLOCKED as
the gate at the top says, and stop here.

### Step 2: Add the flag to `ParsedPlan`

In `packages/ora-plan-core/src/types.ts`, directly after the
`totalElapsedTime?: number;` line of `interface ParsedPlan`, add:

```ts
  /**
   * True when each operation's `actualTime` is SQL Monitor's active WINDOW (whole seconds from its
   * first to its last activity, minimum 1 s) instead of a measured, cumulative A-Time. Windows of a
   * parent and its children overlap, so no self time, time ranking or hotspot is derived from them.
   */
  timeIsActiveWindow?: boolean;
```

**Verify**: `npm run typecheck` → exit 0.

### Step 3: Set the flag in the two SQL Monitor parsers

In `packages/ora-plan-core/src/parser/sqlMonitorParser.ts`:

1. Text parser return (the object quoted in "Current state" with
   `source: 'sql_monitor_text'`): add after `totalElapsedTime,`
   ```ts
         // A real SQL Monitor report's time column is "Time Active(s)". A bare A-Rows table (no
         // report markers) carries a true, cumulative A-Time instead.
         timeIsActiveWindow: SQL_MONITOR_MARKERS.test(input) || undefined,
   ```
2. XML parser: directly after the line
   `applyActivitySamples(doc, nodeMap, activityTimeline);` add
   ```ts

     // Per-operation time comes from the "duration" stat: whole seconds between first_active and
     // last_active (minimum 1), an active window. Only a per-operation elapsed_time would be measured time.
     const operationStat = (name: string): Element | null =>
       planMonitor?.querySelector(`:scope > operation stats[type="plan_monitor"] > stat[name="${name}"]`) ?? null;
     const timeIsActiveWindow = operationStat('duration') !== null && operationStat('elapsed_time') === null;
   ```
   and in the XML return object (the one that also has `bindVariables:` — not
   the legacy one), after `totalElapsedTime,` add
   ```ts
       timeIsActiveWindow: timeIsActiveWindow || undefined,
   ```

**Verify**:
- `npm run typecheck` → exit 0.
- `npx vitest run --environment jsdom src/lib/parser` → all pass (the flag is not read anywhere yet).

### Step 4: Do not derive self time, ranking or hotspot from active windows

In `packages/ora-plan-core/src/analysis.ts`:

1. `computeSelfTimes`: insert a branch before the final `else`:
   ```ts
     } else if (plan.timeIsActiveWindow) {
       // SQL Monitor: actualTime is each operation's active window in whole seconds, and the windows
       // of a parent and its children overlap. "time − Σ children" is not the operation's own time.
       for (const node of plan.allNodes) node.selfTime = undefined;
     } else {
   ```
   (the XBI branch above it and the body of the final `else` stay as they are;
   `plan.maxSelfTime` is still computed on the last line and becomes 0).
   Add one bullet to the function's doc comment:
   `- SQL Monitor active windows (\`plan.timeIsActiveWindow\`): no self time is derived.`
2. `rankNodesByTime`: after `const byActivity = usesActivityRanking(plan);` add
   ```ts
     // Active windows say when an operation was busy, not how much work it did: without ASH there is no ranking.
     if (!byActivity && plan.timeIsActiveWindow) return [];
   ```
3. `computeHottestNodeId`: after `const byActivity = usesActivityRanking(plan);` add
   ```ts
     if (!byActivity && plan.timeIsActiveWindow) return null;
   ```
   and extend its doc comment with: `SQL Monitor reports without ASH samples have no hotspot.`

**Verify**:
- `npm run typecheck` → exit 0.
- `npx vitest run --environment jsdom src/lib/__tests__/sqlMonitorTime.test.ts` → now **fails** (the characterisation no longer holds): 8 failed. That is expected; Step 5 replaces the file.
- `npx vitest run --environment jsdom src --exclude src/lib/__tests__/sqlMonitorTime.test.ts` → all pass (no other test depends on the old behaviour).

### Step 5: Replace the characterisation with the new contract

Replace the whole content of `src/lib/__tests__/sqlMonitorTime.test.ts` with:

```ts
import { readFileSync } from 'fs';
import { join } from 'path';
import { describe, expect, it } from 'vitest';
import { computeHottestNodeId, rankNodesByTime, usesActivityRanking } from '../analysis';
import { parsePlan } from '../parser';

const example = (name: string) => parsePlan(readFileSync(join(__dirname, '../../examples', name), 'utf-8'));

// Bundled SQL Monitor examples, split by whether the report carries ASH activity per operation.
const WITHOUT_ASH = [
  '21-sql_monitor-Star Schema Rollup.txt',
  '22-sql_monitor-Cardinality Trap (NL).txt',
  '24-sql_monitor-Recursive BOM.txt',
  '27-sql_monitor-Partitioned Star Query.txt',
  '28-sql_monitor-Partition Range Iterator.txt',
];
const WITH_ASH: Array<[string, number]> = [
  ['17-sql_monitor-Exadata Cell Offload (K. Osborne).txt', 4],
  ['18-sql_monitor-Skewed Parallel (J. Lewis).txt', 30],
  ['23-sql_monitor-Window Sort Spill.txt', 4],
];

describe('SQL Monitor time (active windows are not self time)', () => {
  it.each(WITHOUT_ASH)('%s: no ASH activity, so no self time, no hotspot and no time ranking', (name) => {
    const plan = example(name);
    expect(plan.timeIsActiveWindow).toBe(true);
    expect(usesActivityRanking(plan)).toBe(false);
    expect(plan.allNodes.every((n) => n.selfTime === undefined)).toBe(true);
    expect(plan.maxSelfTime).toBe(0);
    expect(computeHottestNodeId(plan)).toBeNull();
    expect(rankNodesByTime(plan)).toEqual([]);
    // The active window itself is still there for display.
    expect(plan.allNodes.some((n) => n.actualTime !== undefined)).toBe(true);
  });

  it.each(WITH_ASH)('%s: ranked by ASH activity (hotspot %i), still without derived self time', (name, hottest) => {
    const plan = example(name);
    expect(plan.timeIsActiveWindow).toBe(true);
    expect(usesActivityRanking(plan)).toBe(true);
    expect(computeHottestNodeId(plan)).toBe(hottest);
    expect(rankNodesByTime(plan)[0].id).toBe(hottest);
    expect(plan.allNodes.every((n) => n.selfTime === undefined)).toBe(true);
  });

  it('keeps self time and the hotspot for a bare A-Rows table, whose A-Time is cumulative', () => {
    const plan = parsePlan([
      '| Id | Operation          | Name | Starts | E-Rows | A-Rows |   A-Time   |',
      '|  0 | SELECT STATEMENT   |      |      1 |        |     10 |00:00:02.50 |',
      '|  1 |  HASH JOIN         |      |      1 |    100 |     10 |00:00:02.50 |',
      '|  2 |   TABLE ACCESS FULL| T1   |      1 |    100 |    100 |00:00:00.50 |',
      '|  3 |   TABLE ACCESS FULL| T2   |      1 |   1000 |   1000 |00:00:01.50 |',
    ].join('\n'));
    expect(plan.source).toBe('sql_monitor_text');
    expect(plan.timeIsActiveWindow).toBeUndefined();
    expect(plan.allNodes.map((n) => n.selfTime)).toEqual([0, 500, 500, 1500]);
    expect(computeHottestNodeId(plan)).toBe(3);
  });
});
```

**Verify**: `npx vitest run --environment jsdom src/lib/__tests__/sqlMonitorTime.test.ts` → **9 passed**.

### Step 6: Give the tour a target when the plan has no hotspot

`src/lib/walkthrough.ts`:

1. Add these imports above `export type WalkthroughPlacement` (the file has no
   imports today; all three are pure modules):
   ```ts
   import type { AdvisorReport } from './advisor/types';
   import { computeHottestNodeId } from './analysis';
   import type { ParsedPlan } from './types';
   ```
2. In the step with `id: 'details'`, change the first sentence of `body` from
   `We selected the hottest operation for you.` to
   `We selected an operation worth a look for you.` (rest of the string unchanged).
   Keep `action: 'selectHotNode'`.
3. Directly above the doc comment of `pickWalkthroughSample`
   ("The example the tour loads when no plan is open: …") add:
   ```ts
   /**
    * The operation the tour selects on its "details" step: the hotspot when the plan has one, else
    * the operation of the advisor's top finding, else the first operation under the statement.
    * (A SQL Monitor report without ASH samples has no hotspot.)
    */
   export function pickTourNodeId(plan: ParsedPlan | null, report: AdvisorReport | null): number | null {
     if (!plan) return null;
     return computeHottestNodeId(plan)
       ?? report?.findings.find((f) => f.nodeIds.length > 0)?.nodeIds[0]
       ?? plan.rootNode?.children[0]?.id
       ?? null;
   }
   ```

`src/components/Walkthrough.tsx`:

1. Delete the line `import { computeHottestNodeId } from '../lib/analysis';`
   and add `pickTourNodeId,` to the existing import list from
   `'../lib/walkthrough'` (alphabetical: after `computeCardPosition,`).
2. In `Walkthrough()`, take `advisorReport` from the context and carry it
   through the ref:
   ```ts
     const {
       setWalkthroughOpen, parsedPlan, advisorReport, selectedNodeIds, selectNode, setDetailPanelCollapsed,
     } = usePlan();
   ```
   ```ts
     const selectionRef = useRef({ hasSelection, parsedPlan, advisorReport, selectNode, setDetailPanelCollapsed });
     useEffect(() => {
       selectionRef.current = { hasSelection, parsedPlan, advisorReport, selectNode, setDetailPanelCollapsed };
     });
   ```
3. In the `selectHotNode` effect:
   ```ts
       const { hasSelection: selected, parsedPlan: plan, advisorReport: report, selectNode: select, setDetailPanelCollapsed: expand } = selectionRef.current;
       expand(false);
       if (selected) return;
       const target = pickTourNodeId(plan, report);
       if (target !== null) select(target);
   ```

`src/lib/__tests__/walkthrough.test.ts`: add `pickTourNodeId,` to the import
from `'../walkthrough'` (after `computeCardPosition,`), add below that import

```ts
import { computeSelfTimes } from '../analysis';
import type { AdvisorReport, Finding } from '../advisor/types';
import { buildPlan } from './fixtures/buildPlan';
```

and append at the end of the file:

```ts

describe('pickTourNodeId', () => {
  const finding = (nodeIds: number[]): Finding => ({
    ruleId: 'cardinality-mismatch', severity: 'warning', nodeIds, title: 't', explanation: 'e', suggestion: 's',
  });
  const report = (findings: Finding[]): AdvisorReport => ({
    findings,
    findingsByNodeId: new Map(),
    counts: { critical: 0, warning: findings.length, info: 0 },
    maxSeverityByNodeId: new Map(),
  });
  // 0 SELECT -> 1 HASH JOIN -> 2 scan (fast), 3 scan (slow)
  const plan = (activeWindow: boolean) => {
    const p = buildPlan({
      id: 0, op: 'SELECT STATEMENT', actualRows: 1, actualTime: 3000, kids: [{
        id: 1, op: 'HASH JOIN', actualRows: 1, actualTime: 3000, kids: [
          { id: 2, op: 'TABLE ACCESS FULL', actualRows: 10, actualTime: 1000 },
          { id: 3, op: 'TABLE ACCESS FULL', actualRows: 10, actualTime: 2000 },
        ],
      }],
    }, activeWindow ? 'sql_monitor_xml' : 'dbms_xplan');
    if (activeWindow) p.timeIsActiveWindow = true;
    computeSelfTimes(p);
    return p;
  };

  it('picks the hotspot when the plan has one', () => {
    expect(pickTourNodeId(plan(false), report([finding([2])]))).toBe(3);
  });

  it('falls back to the top finding when there is no hotspot (SQL Monitor report without ASH)', () => {
    expect(pickTourNodeId(plan(true), report([finding([]), finding([2, 3])]))).toBe(2);
  });

  it('falls back to the first operation under the statement when there are no findings', () => {
    expect(pickTourNodeId(plan(true), report([]))).toBe(1);
    expect(pickTourNodeId(plan(true), null)).toBe(1);
  });

  it('returns null without a plan', () => {
    expect(pickTourNodeId(null, null)).toBeNull();
  });
});
```

**Verify**:
- `grep -n "computeHottestNodeId" src/components/Walkthrough.tsx` → no matches.
- `npm run typecheck` → exit 0; `npm run lint` → exit 0.
- `npx vitest run --environment jsdom src/lib/__tests__/walkthrough.test.ts src/components/__tests__/Walkthrough.test.tsx` → all pass (4 new tests in `walkthrough.test.ts`).

### Step 7: Documentation (same change, project rule)

`site/docs.html`, section `<h3>Hotspots</h3>`: replace the paragraph quoted
below

```html
      <p>
        With runtime statistics present, the node with the highest self A-Time gets a red ring and a "Hotspot" badge.
        The Hotspots panel (shown when nothing is selected) lists the top 5 nodes by A-Time, by cost, and the worst
        cardinality mismatches. Hotspot detection can be toggled from the command palette.
      </p>
```

with

```html
      <p>
        With runtime statistics present, the node with the highest self A-Time gets a red ring and a "Hotspot" badge.
        SQL Monitor reports are ranked by ASH activity instead: SQL Monitor gives each operation's active window in
        whole seconds, not its own time. A SQL Monitor report without ASH samples (typically a statement that ran
        for under a second) therefore has no hotspot ring and no "Slowest ops" list.
        The Hotspots panel (shown when nothing is selected) lists the top 5 nodes by time, by cost, and the worst
        cardinality mismatches. Hotspot detection can be toggled from the command palette.
      </p>
```

`site/index.html`, the card whose heading is
`Hotspot detection &amp; runtime stats`: replace its paragraph text with

```html
            When runtime statistics are available, every node shows A-Rows, E-Rows, A-Time, and Starts.
            The node that took the most time (by ASH activity for SQL Monitor reports, by self A-Time
            otherwise) gets a red ring and a "Hotspot" badge automatically.
            When nothing is selected, a summary panel lists the top 5 nodes by time, cost, and
            worst cardinality mismatch. Click any entry to jump straight to it.
```

and in the `<a data-app-link …>Try this live</a>` **of that card only** change
`data-app-query="?example=22"` to `data-app-query="?example=23"` (example 23
is a SQL Monitor report with ASH samples; its hotspot is operation 4). The
other two `?example=22` links in the file belong to other cards and stay.

**Verify**:
- `grep -c 'SQL Monitor reports are ranked by ASH activity' site/docs.html` → `1`.
- `grep -c 'data-app-query="?example=22"' site/index.html` → `2`; `grep -c 'data-app-query="?example=23"' site/index.html` → `1`.

### Step 8: Full verification

**Verify**:
- `npm run lint` → exit 0.
- `npm run typecheck` → exit 0.
- `npm test` → exit 0; `Test Files` is the Step 0 number **+1**, `Tests` is the Step 0 number **+13** (9 in `sqlMonitorTime.test.ts`, 4 in `walkthrough.test.ts`); no snapshot written or obsolete.

## Test plan

- `src/lib/__tests__/sqlMonitorTime.test.ts` (new): Step 1 version pins the
  current behaviour (8 cases, one per bundled SQL Monitor example); Step 5
  version pins the new contract (9 cases): five examples without ASH → flag
  set, no `selfTime`, `maxSelfTime` 0, no hotspot, empty ranking, window still
  present; three examples with ASH → same hotspot ids as before (4, 30, 4), no
  `selfTime`; one bare A-Rows table (`sql_monitor_text` source, no flag) →
  self times `[0, 500, 500, 1500]` and hotspot 3, i.e. unchanged behaviour.
- `src/lib/__tests__/walkthrough.test.ts`: 4 cases for `pickTourNodeId`
  (hotspot wins; top finding with node ids; first operation; no plan). The
  existing test "selects the hot node on exactly one step" keeps passing
  because the action name is unchanged.
- No existing expectation changes anywhere else (verified at `b5635d8`). If one
  does, STOP.
- Structural patterns: `src/lib/__tests__/planNumbers.test.ts` (reads bundled
  examples with `readFileSync(join(__dirname, '../../examples', name), 'utf-8')`),
  `src/lib/__tests__/fixtures/buildPlan.ts` for synthetic trees.

## Done criteria

Machine-checkable. ALL must hold:

- [ ] The operator's "Option A" confirmation is quoted in your report
- [ ] `grep -n "timeIsActiveWindow" packages/ora-plan-core/src/types.ts packages/ora-plan-core/src/analysis.ts packages/ora-plan-core/src/parser/sqlMonitorParser.ts` shows the field in `types.ts`, at least three code uses in `analysis.ts` (`computeSelfTimes`, `rankNodesByTime`, `computeHottestNodeId`), and the text and XML assignments in the parser
- [ ] `npx vitest run --environment jsdom src/lib/__tests__/sqlMonitorTime.test.ts` → 9 passed
- [ ] `grep -n "computeHottestNodeId" src/components/Walkthrough.tsx` returns no matches
- [ ] `grep -c 'We selected the hottest operation' src/lib/walkthrough.ts` prints `0`
- [ ] `grep -c 'SQL Monitor reports are ranked by ASH activity' site/docs.html` prints `1`
- [ ] `npm run lint` exits 0
- [ ] `npm run typecheck` exits 0
- [ ] `npm test` exits 0 with Step 0 totals +1 file / +13 tests and no snapshot written
- [ ] `git status --porcelain` lists only files from the in-scope list
- [ ] `git diff --stat b5635d8..HEAD -- src/examples src/lib/parser/__tests__/fixtures site/assets scripts` is empty
- [ ] `plans/README.md` status row for 021 updated

## STOP conditions

Stop and report back (do not improvise) if:

- **The operator did not explicitly confirm "Option A"** — stop after Step 1
  (see the decision gate). The same applies if the operator names Option B or
  anything else: this plan does not cover it.
- A row of the Step 1 characterisation test fails on the unmodified code.
- The code at the locations in "Current state" does not match the excerpts
  (other than line-number shifts), in particular if `SQL_MONITOR_MARKERS`, the
  `planMonitor` constant in the XML parser, or `usePlan().advisorReport` no
  longer exist under these names.
- After Step 4, any test other than `sqlMonitorTime.test.ts` fails, or vitest
  reports a changed snapshot. Report which consumer depended on the old value;
  do not patch the consumer.
- A bundled XML example turns out to have a per-operation `elapsed_time` stat
  (the flag would then be false for it and Step 5's `timeIsActiveWindow`
  expectation fails): report the file.
- A step's verification fails twice after a reasonable fix attempt.
- You find yourself wanting to change `scripts/capture-showcase.mjs`, media
  under `site/assets/`, or any "A-Time" label in the UI.

## Maintenance notes

- `timeIsActiveWindow` is the single statement of "this plan's per-operation
  time is a window". A new source with the same kind of number (for example a
  V$SQL_PLAN_MONITOR query result) should set it in its parser; nothing in
  `analysis.ts` should test `plan.source` for this.
- Follow-up the maintainer owns (needs a browser): re-capture `hero.png`,
  `hotspot.png`, `hotspots.gif` and friends with
  `scripts/capture-showcase.mjs` after changing its `hotspots()` step to an
  example that still has a hotspot (23, 18, 12, 13, 14 or 29), and adjust the
  `README.md:9` caption if the hero no longer shows one. A real SQL Monitor
  capture that ran long enough to have ASH samples would make a better
  default tour and showcase example than 22.
- Still showing the window under the label "A-Time" (unchanged here): node
  cards, the tabular A-Time column and share bar, the flame and Sankey time
  metrics (which compute their own "self" by subtraction), filters, Compare,
  and "A-Time (cumul.)" in the node details. Relabelling them to "Time active"
  for flagged plans is the natural next step and is what Option B would have
  started with.
- If a later change gives SQL Monitor plans a different work-based ranking
  without ASH (for example by buffer gets or I/O, which SQL Monitor reports
  per line), it belongs in `rankNodesByTime` / `computeHottestNodeId` next to
  the two early returns added here.
- Reviewer focus: the XML flag expression (`duration` present and no
  per-operation `elapsed_time`), that reports **with** ASH keep exactly the
  same hotspot ids (the Step 5 test pins 4, 30 and 4), and the tour on example
  22 in a real browser (the "details" step should select an operation and open
  the details panel).
