---
title: "Spec rewrite: ai-plan-analysis v2"
labels: [wayfinder:task]
status: open
assignee:
blocked-by: [02-credit-and-subscription-packaging.md, 04-oraplanviz-cloud-backend-shape.md, 05-repro-fidelity-ladder.md, 06-non-dba-metadata-gathering-fallback.md, 07-evals-harness-v1-scope.md, 08-non-expert-analysis-report-design.md, 09-test-case-builder-flow-design.md, 10-privacy-fence-and-product-framing.md, 12-guided-anonymization.md, 13-guided-optimization-walkthrough.md]
---

## Question

Rewrite `docs/plans/ai-plan-analysis.md` into the locked v2 spec — the map's destination.

Fold in every closed ticket: charter decisions, packaging table, backend contract, fidelity ladder, non-DBA gather fallback, evals gates, both prototyped flows, and the privacy fence. Keep what survives from v1 (versioned contracts, `AnalysisTransport` seam, streaming lifecycle, context/minimization machinery, sanitization rules — these were sound and are transport-agnostic). Restructure phases around hosted-first delivery with the builder as the headline; move companion engines, BYO-key, AI compare, and Phase-8 chat to an explicit roadmap appendix. The result must leave an implementation session nothing to decide.

Resolution = the merged v2 document + a one-paragraph changelog of what moved and why; closing this ticket closes the map.
