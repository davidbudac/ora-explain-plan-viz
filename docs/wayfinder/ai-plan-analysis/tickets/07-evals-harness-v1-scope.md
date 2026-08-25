---
title: Evals harness v1 scope
labels: [wayfinder:grilling]
status: open
assignee:
blocked-by: []
---

## Question

The charter puts the **full 4-layer harness** in v1 scope. Pin down what that concretely means before the spec rewrite: how big, what gates what, and what it costs to run.

Decide with the user (the Phase-7 section of `docs/plans/ai-plan-analysis.md` is the base):

- scenario corpus v1: confirm/trim the ~15 seed scenarios; who writes them (sessions vs generated); graduate the corpus-contents fog;
- gating: which numbers block a release (repro rate ≥ X% per fidelity level? analysis recall ≥ advisor baseline? experiment regression rate ≤ Y%?) and which are informational;
- run cadence + infra: local Docker only vs GitHub Actions nightly; is the gvenzl/oracle-free license/marketing claim OK for a commercial product's CI;
- LLM-judge cost ceiling per full run (uses [unit economics](01-unit-economics.md) pricing if closed, else rough) and the judge model;
- the marketing use: is "measured repro rate: N%" published, and where;
- sequencing: harness layers vs builder implementation (which is built first).

Resolution = the harness v1 definition + gate table for the spec.
