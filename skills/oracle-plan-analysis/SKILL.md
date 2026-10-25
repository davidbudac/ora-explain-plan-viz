---
name: oracle-plan-analysis
description: Oracle execution plan analysis — find why a SQL statement is slow from DBMS_XPLAN, SQL Monitor or V$SQL_PLAN output, recommend fixes, and request the data still missing. Use for an Oracle Plan Visualizer agent handoff, an Oracle plan to explain or tune, a slow or regressed Oracle query, or two Oracle plans to compare.
---

# Oracle plan analysis

Turn an Oracle execution plan into a diagnosis: where the time goes, why the optimizer chose this plan, and what to change. Every claim rests on **evidence**: a plan line Id plus the numbers on that line.

The input is usually an **agent handoff** exported from Oracle Plan Visualizer. It starts with `<!-- oraplanviz-agent-handoff v1 -->` and holds the task, the user's question, a "What this handoff contains" checklist, then "Plan data": the plan table and whichever of these the source had: SQL text, predicates, note section, bind variables, hints & outline, execution metadata, ASH activity, plan signals, heuristic pre-analysis, analyst notes, schema metadata, original plan text. Raw DBMS_XPLAN or SQL Monitor output works the same way; build the checklist yourself.

## Reading the numbers

- **E-Rows is per start; A-Rows is the total over all starts.** Estimate quality is A-Rows against E-Rows × Starts, never A-Rows against E-Rows. Starts is not the execution count in three places: inside a PX slave set (Starts counts slaves or granules, so use E-Rows alone), under a partition iterator (child Starts count partitions; use the topmost iterator's Starts), and on a rowid fetch fed by a batched nested loop (use the Starts of the index that supplies the rowids).
- **Cost, A-Time, Buffers and Reads are cumulative**: each line includes its children. A line's own share is its value minus its children's. The hot line is the one with the highest *self* value, usually not the one with the highest cumulative value. The handoff's `A-Self` column is that self time, computed by the app.
- `ALLSTATS LAST` shows the last execution; `ALLSTATS` without `LAST` sums every execution since the cursor was loaded, so divide by executions.
- **Parallel plans**: DISPLAY_CURSOR actuals for PX lines are partial (the coordinator does not see all slave work). Read SQL Monitor for PX statements.
- SQL Monitor's per-line time is usually *Time Active*: the seconds a line was active, in whole seconds. It is coarse, and lines running at the same time each count the same seconds. Attribute time by activity (Activity %, ASH samples per line) instead.
- Starts = 0 means the line never ran. A-Rows below the estimate under `COUNT STOPKEY`, `ROWNUM` or a FIRST_ROWS fetch is early termination, not a misestimate.
- An inactive adaptive-plan row (an Id prefixed with `-`, or marked inactive) did not run.
- **Access** predicates locate rows (index keys, join keys); **filter** predicates discard rows after they were read. A filter that throws away most of what a line read is wasted work.
- **Cost is the optimizer's model, not time.** With estimates only, you can say where the optimizer *expected* the work; say plainly that the real hot spot is unconfirmed.
- The handoff's plan table is regenerated and abbreviated (1.2K, 3.4M). When an "Original plan text" section is present, it is the source of truth.
- `Act%` is the line's share of the statement's ASH samples, the most direct measure of where time went.
- The "Heuristic pre-analysis" comes from the app's fixed rule engine: leads to confirm, refute or refine against the plan.
- "Analyst notes" are the user's own notes and highlights on plan lines: they show what the user suspects or cares about.

## Workflow

### 1. Take inventory

List what you have: runtime statistics or estimates only; predicates; SQL text; bind values; schema metadata (table, column and index statistics, histograms); wait or ASH data; notes (SQL plan baseline, SQL profile, SQL patch, dynamic sampling, adaptive plan, cardinality feedback); and the user's question.

Done when you can mark each item present, absent or withheld by the user, and name the conclusions each absence blocks.

### 2. Locate the time

Rank lines by self time (`A-Self`, or ASH samples per line), then by self buffers and reads. With estimates only, rank by self cost and label the ranking as the optimizer's expectation.

Check the total too: when the plan's root A-Time is far below the elapsed time the user reports, the time is spent outside the plan (fetch round trips, PL/SQL functions called per row, recursive SQL, the network). Say so and ask how the statement is called.

Done when you have named the one to three lines that account for most of the time, with their numbers and their share of the total.

### 3. Find the first divergence

From each hot line, walk down into its inputs to the lowest line where A-Rows departs from E-Rows × Starts by 10× or more. That line holds the root misestimate; the lines above it inherit it. Then explain why the optimizer was wrong *there*, from its predicates and statistics: a function or implicit conversion on a column (`INTERNAL_FUNCTION`, `TO_NUMBER("COL")`), correlated predicates, skew without a histogram, stale or missing statistics, a value beyond the column's known high value, binds peeked from an unrepresentative value.

When the estimates hold everywhere, the plan is the optimizer's honest best for what it knows: look for a missing access path, wasted work (filters discarding most rows, inner lines started once per outer row), or physical trouble (spills to temp, I/O, PX skew).

Match each hot line's shape against [references/patterns.md](references/patterns.md).

Done when every hot line has a cause backed by evidence, or is marked "cause unknown" together with the data that would settle it.

### 4. Decide whether to ask

For each conclusion, ask whether data you lack could reverse it. When it could, request that data as described in [references/data-requests.md](references/data-requests.md), and still give your provisional diagnosis, labelled provisional.

When you can query the database yourself (a SQL tool, or a shell with sqlplus or sqlcl), run the read-only queries instead of asking. Changes (DDL, DML, statistics gathering, parameters, baselines, profiles, patches) are always proposals for the user to run.

Done when every recommendation is either supported by evidence you hold or paired with the request that would confirm it.

### 5. Recommend

Prefer fixes in this order:

1. Give the optimizer the statistics it lacked: gather stale or missing statistics, add a histogram on a skewed column, create extended statistics for correlated columns or expressions.
2. Rewrite the SQL: sargable predicates, matching datatypes, a join or filter the optimizer can use.
3. Add or change an access structure: an index, often composite or covering.
4. Control the plan for this statement only: a SQL patch with hints, a SQL plan baseline from a known-good plan, a SQL profile.
5. Session-level optimizer parameters, as a test or a last resort.

For each recommendation give the change as ready-to-run SQL, the evidence (line Ids and numbers), the expected effect on the hot lines, the risk (index maintenance, statistics changes that move other statements' plans, a pinned plan going stale as data grows), and how to verify it.

Done when every hot line from step 2 is covered by a recommendation or by a data request.

### 6. Report

Follow the handoff's "Answer with" structure when there is one. Otherwise:

1. **Summary**: what the statement does, where the time goes, the main problem.
2. **Findings**: each with line Ids, the numbers that show it, and your confidence.
3. **Recommendations**: prioritized, as in step 5.
4. **Data requests**, if any.
5. **Verification**: in SQL*Plus, `SET SERVEROUTPUT OFF`, run the statement with `/*+ GATHER_PLAN_STATISTICS */`, then `DBMS_XPLAN.DISPLAY_CURSOR(NULL, NULL, 'ALLSTATS LAST')`, before and after the change. Both plans load side by side in Oracle Plan Visualizer (Compare).

## Comparing two plans

A handoff with Plan A (baseline) and Plan B (candidate) carries a node match digest of the changed lines. For each structural change (join order, join method, access path, pruning, parallelism), find the estimate, statistic or environment difference that flipped the optimizer's choice. Judge the plans by actuals when both have them; costs computed under different statistics or environments cannot be compared. If the SQL_IDs differ, the plans belong to different statements: compare their shapes, not their numbers. Recommend which plan to keep and how to keep it, for example a SQL plan baseline loaded from the good plan hash value.
