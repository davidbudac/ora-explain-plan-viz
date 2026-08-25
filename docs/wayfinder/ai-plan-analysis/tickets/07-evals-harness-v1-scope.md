---
title: Evals harness v1 scope
labels: [wayfinder:grilling]
status: closed
assignee: davidbudac
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

## Resolution

Settled by grilling (2026-08-26). Phase-7 of `docs/plans/ai-plan-analysis.md`
stands as the base; the decisions below refine and extend it for the spec.

### Corpus

- **~15 seed scenarios confirmed as listed** (join tipping point, histogram
  skew, stale stats, implicit conversion, cartesian, partition pruning ±, bind
  peeking, unindexed FK, temp spill, selective full scan) — every category maps
  to an existing Advisor rule, which the Layer-3 baseline floor requires.
- **Hand-written by implementation sessions**; an LLM may draft `setup.sql`,
  but a session must verify each scenario actually exhibits its intended plan
  pathology before it enters the corpus. The corpus is built *with* Layer 2
  (which is what validates the exhibit), not after. Post-v1 growth: anonymized
  real-world cases.

### Per-rung backtesting (ladder tie-in)

Layer 2 measures Repro Rate (= shape match, per the
[fidelity ladder](05-repro-fidelity-ladder.md)) **at all four rungs**:

- **F2/F3** — deterministic path, no LLM: nightly CI run.
- **F0/F1** — the AI authors the guessed sections, so these cost LLM calls:
  measured in the on-demand LLM eval run alongside Layer 3.

### Gate table (v1 defaults — initial bars, revisable after the first corpus run; once real numbers exist, gates compare against the trailing baseline, not absolute thresholds)

| Metric | Layer | Gate |
|---|---|---|
| Repro Rate F3 ≥ **90%**, F2 ≥ **80%** | 2 | **blocks selling the Builder** (launch gate) + CI fails on drop below last baseline |
| Repro Rate F0/F1 | 2 | informational (published as measured, never gated) |
| Hard checks (schema validity, no hallucinated objects, plan-line refs) **100%** | 3 | blocking, every run |
| Advisor recall ≥ **90%** | 3 | blocking |
| LLM-judge mean score non-decreasing | 3 | blocks prompt/model changes only |
| Experiment regression rate ≤ **10%** | 4 | blocking |
| Experiment improvement rate | 4 | informational |

### Infra, cadence, licensing

- **GitHub Actions nightly + on-demand label**, plus local Docker — as
  Phase 7 plans. Not per-PR (≈2-min container startup).
- **`gvenzl/oracle-free:23` is fine for commercial CI**: Oracle Database Free
  ships under the Oracle Free Use Terms and Conditions, which permit internal
  business/dev/test use; nothing is redistributed. One sentence in the spec,
  flagged as a license reading, not legal advice.

### Judge + cost ceiling

- **Judge model: `claude-haiku-4-5`**, 3-sample majority vote, fixed —
  rubric scoring is where a cheap fixed model belongs (the user's general
  no-Haiku preference applies to dev workflows, not product eval plumbing —
  explicitly waived here).
- **Ceiling: $30 per full LLM run** (≈15 × Opus analysis + F0/F1 Builder
  turns + judge samples ≈ $20–25 expected) — alerting, not hard-stopping;
  the run is manual/on-demand.

### Marketing use

"Measured repro rate: NN%" **is published**: F2/F3 numbers on marketing
surfaces (pricing page, Builder upsell), F0/F1 numbers in-product in the
per-rung promise copy — always with corpus-size disclosure ("NN% across 15
scenario types"). Honest small-N beats vague claims.

### Sequencing

Layer 1 (unit tests) with every phase; **Layer 2 runner built alongside the
deterministic Builder skeleton** (it is the skeleton's real test) and the
corpus with it; Layers 3–4 after analysis/experiments exist; gates active from
then on.

### Production feedback loop

**In v1, minimal**: `POST /v1/feedback` (thumbs up/down + run-event log,
never plan payloads), thumbs in the report view, `promptVersion` tagging so
offline evals and online feedback join on the same key. Dashboards deferred.
Requirement inherited by [oraplanviz-cloud backend shape](04-oraplanviz-cloud-backend-shape.md).
