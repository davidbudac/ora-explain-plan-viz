---
title: Repro fidelity ladder
labels: [wayfinder:grilling]
status: open
assignee:
blocked-by: []
---

## Question

Define the **repro-fidelity ladder**: the discrete levels of test-case fidelity the builder can achieve given what the user has attached, what each level emits, and what each level honestly promises.

Charter says graceful degradation — the builder always produces something. Pin down (grilling + domain-modeling; this creates core vocabulary → `CONTEXT.md`):

- the closed [Non-DBA gather](06-non-dba-metadata-gathering-fallback.md) finding: privilege and rung are near-orthogonal — the ladder needs a privilege axis and must distinguish *absent* (not gathered) from *invisible* (no privilege); histograms are reachable without DBA, so v3 need not be a DBA-only rung;
- the levels, e.g. L0 plan-only (DDL skeleton + SET_TABLE_STATS from plan estimates), L1 +SQL text (real query + bind stubs), L2 +bundle v2 (real stats/DDL/constraints), L3 +bundle v3 histograms (skew-faithful), and whether optimizer_env is its own rung;
- what script sections exist at each level (map to the Phase-6 skeleton in `docs/plans/ai-plan-analysis.md`) and what is explicitly marked "guessed";
- the honesty contract per level: expected repro likelihood wording, verified later by the evals harness;
- what the AI fills at each level vs what stays deterministic;
- whether bundle v3 (histogram endpoints) stays in v1 scope as speced — note the closed [Unit economics](01-unit-economics.md) finding: naive 254-bucket histogram serialization can 3× a Builder run's cost, so the prompt needs a compact/downsampled encoding while the deterministic script keeps all buckets.

Resolution = the ladder table (level → inputs → emitted sections → promise), the builder's core spec input.
