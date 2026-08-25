---
title: Repro fidelity ladder
labels: [wayfinder:grilling]
status: closed
assignee: davidbudac
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

## Resolution

Settled by grilling (2026-08-26). All decisions below are locked for the spec rewrite.

### Ladder semantics

- **Input-set-derived, not a strict chain**: the level = the highest rung whose
  cumulative required inputs are all present in the (unordered) attached input
  set. Odd combinations (e.g. bundle attached but no SQL text) still emit their
  real sections, but the level label and promise stay capped by the missing
  input. The UI always shows "attach X to reach the next level" — the ladder
  doubles as the upsell surface.
- **optimizer_env is a modifier, not a rung**: "environment captured: yes/no"
  can attach to any rung and adds the `ALTER SESSION` section. It is not on the
  main ladder because it is privilege-gated (V$-only) and orthogonal to schema
  fidelity — making it a rung would put the top of the ladder out of reach for
  the target non-DBA customer.
- **Privilege surfaces as per-item provenance, not a second user-facing axis**:
  the ladder stays 1D. The bundle's `capabilities` block + per-item
  `unavailable_reason` (from the [non-DBA gather](06-non-dba-metadata-gathering-fallback.md)
  finding) downgrade the *promise wording*, never the rung. *Absent* (checked,
  not found) and *invisible* (could not check — insufficient privilege) are
  never conflated anywhere coverage is shown: "No SQL profile found" ≠
  "Could not check for SQL profiles — insufficient privileges".
- **The row-data generator is a repair strategy, not a rung**: the ladder
  measures input fidelity; `INSERT … CONNECT BY` skew-matched data generation
  is a technique the Builder reaches for inside its ≤2-repair budget when the
  stats-only script fails verification.

### The ladder table

Requirements are cumulative. Names are canonical vocabulary (→ `CONTEXT.md`).

| Rung | Requires | Emitted sections | Guessed markers |
|---|---|---|---|
| **F0 Sketch** | plan | banner; `CREATE TABLE`/`CREATE INDEX` reconstructed from plan object names + predicates + access paths (indexes visible in access paths *are* emitted); `SET_TABLE_STATS` from E-rows; **guessed query** reconstructed from operations/predicates; verification | DDL columns/types, query, all stats |
| **F1 Skeleton** | + SQL text | same, but real query + `VARIABLE` bind stubs; DDL cross-checked against columns referenced in the SQL | DDL types, stats |
| **F2 Faithful** | + Metadata Bundle (v2) | real DDL (or dictionary-synthesized where `GET_DDL` was privilege-blocked), constraints, `SET_TABLE/INDEX/COLUMN_STATS` from real stats | only binds |
| **F3 Skew-Faithful** | + bundle v3 histograms | + `PREPARE_COLUMN_VALUES`/srec histogram section, **all** buckets | only binds |
| *env modifier* | optimizer_env in bundle | + `ALTER SESSION` non-default params (any rung) | — |

### Deterministic vs AI, and free vs paid

- At **F2+** the skeleton is fully deterministic (bundle → script, modeled on
  the baseline generator); the AI fills only bind values, narrative, and
  repairs. At **F0/F1** the AI *authors* the guessed sections (DDL types can't
  be derived deterministically). The AI never overwrites a section the
  deterministic generator owns.
- **The whole Builder stays paid in v1**, including the F2+ deterministic
  skeleton. The skeleton alone without binds and verified repro is a
  half-product that would muddy the measured-repro-rate claim; the charter's
  "free = deterministic features" line refers to the existing app features.
  The spec must state this explicitly so it isn't re-litigated.

### Verification and honesty contract

- **Verification is rung-keyed**: F0/F1 promise *shape similarity*
  (operation-tree comparison — eyeballed or via the app's Compare view);
  F2/F3 promise *shape match*, with plan-hash match as a bonus note. The evals
  harness' **Repro Rate is defined as shape match at every rung** — one metric,
  comparable across rungs.
- **Promise = fixed qualitative copy + measured number**: once the harness
  runs, "measured on our corpus: NN%" is appended per rung. Pre-measurement
  copy (locked):
  - **F0 Sketch** — "A structural sketch. Schema and query are reconstructed from the plan and marked GUESSED — expect to edit before it runs. A starting point, not a promised repro."
  - **F1 Skeleton** — "Your real query against a guessed schema. Often reproduces the join shape; column types and statistics are estimates."
  - **F2 Faithful** — "Real schema and optimizer statistics. Expected to reproduce the plan shape in most cases."
  - **F3 Skew-Faithful** — "Real schema, statistics, and column histograms — skew-dependent plans included. Our highest-fidelity repro."

### Histograms in prompts (unit-economics mandate)

v3 histograms stay in v1. The deterministic script keeps all ≤254 buckets; the
**prompt** gets a capped representative encoding per column: type, NDV, nulls,
min/max + up to **~24 endpoints** chosen as top-popular by `repeat_count` plus
an evenly-sampled remainder. This caps worst-case prompt tokens at a known
constant while still letting the model respect skew when choosing bind values
and repair strategies (per the [unit economics](01-unit-economics.md) 3×-cost
finding).
