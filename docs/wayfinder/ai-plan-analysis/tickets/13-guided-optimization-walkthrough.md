---
title: Guided optimization walkthrough for non-experts
labels: [wayfinder:grilling]
status: open
assignee:
blocked-by: [08-non-expert-analysis-report-design.md]
---

## Question

What is the **step-by-step optimization walkthrough** — the mode for the charter customer ("the dev who inherited a slow query") who doesn't just need findings, but needs to be *walked through* fixing the query?

The analysis report ([Non-expert analysis report design](08-non-expert-analysis-report-design.md)) says *what's wrong*; the walkthrough turns that into an ordered, checkable sequence: "1. Confirm the stats are stale — run this query. 2. Create this index — here's the DDL. 3. Re-run and load the new plan here — we'll compare." It must respect the out-of-scope line: this is a **generated, static sequence** (one AI call, possibly refreshed when a new plan is loaded), **not** the Phase-8 guided chat/agent — guard against scope-creeping into that.

Decide with the user:

- **anatomy of a step**: goal in plain language, the exact action (SQL to run, script to hand to a DBA, app feature to click), expected outcome, and a *verification* ("load the new plan → Compare should show X") — leaning on existing deterministic features (Compare view, gather script, baseline script generator) as step actions;
- **product placement within settled packaging** ([Credit and subscription packaging](02-credit-and-subscription-packaging.md) is closed — fit inside it, don't reopen it): is the walkthrough part of the ¼-credit deep analysis, a report view over the same findings, or bundled with the 1-credit Builder run? Does the free teaser show a locked walkthrough preview the way it previews the Builder?
- **state across sessions**: steps are checkable — where does progress live (annotation system? localStorage?), and what happens when the user loads the "after" plan (auto-advance? re-generate remaining steps?);
- **hand-off seams**: a step that says "verify with a reproducible test case" hands off to the Builder ([Test-case builder flow design](09-test-case-builder-flow-design.md)); a step needing missing metadata hands off to the gather script / fidelity ladder;
- **safety of prescriptions**: walkthrough steps prescribe DDL and parameter changes to someone who by definition can't judge them — what guardrails/wording ("test system first", reversibility notes) are mandatory;
- **eval hook**: how walkthrough quality is judged in the harness ([Evals harness v1 scope](07-evals-harness-v1-scope.md)) — plausibly "does following the steps on a scenario actually improve the plan," which overlaps the experiment-payoff layer.

Resolution = the walkthrough anatomy, its place in the free/paid packaging, and the hand-off contracts for the spec.
