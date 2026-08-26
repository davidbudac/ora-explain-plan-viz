# CONTEXT

Canonical vocabulary for the Oracle Execution Plan Visualizer domain. Glossary only — no implementation detail.

## Glossary

- **Plan** — a parsed Oracle execution plan (any supported input format) loaded into the app.
- **Advisor** — the built-in *deterministic* heuristic findings engine. Free, offline, never uses a model.
- **AI Analysis** — a model-generated expert report over a loaded plan. Distinct from the Advisor; must never silently contradict it.
- **Teaser** — the free AI Analyses a user gets: 1 anonymous, 2 more after sign-in (3 per account, lifetime — no refill; the Advisor is the unlimited free tier). Runs on the cheap model tier; globally bounded by a monthly spend circuit-breaker that degrades to "sign in / come back later". Its report includes a locked preview of the Builder output to drive the upsell.
- **Credit** — the prepaid unit of paid AI usage, sold in one-time packs (EUR, no expiry). 1 Credit = 1 full Builder run (build + up to 2 repairs + Experiments). A paid deep analysis debits ¼ Credit; fractional debits are internal metering, never a separate SKU.
- **Test-Case Builder** (the *Builder*) — the flagship paid feature: turns a plan (plus whatever inputs are attached) into a runnable synthetic repro script set, no production data required.
- **Repro Fidelity Level** — a rung on the *fidelity ladder*: how faithful the Builder's repro can be given the inputs attached. Derived from the *set* of attached inputs (cumulative requirements): **F0 Sketch** (plan only), **F1 Skeleton** (+SQL text), **F2 Faithful** (+Metadata Bundle), **F3 Skew-Faithful** (+histograms). Each rung carries an honest promise of repro likelihood, later backed by a measured Repro Rate.
- **Environment Modifier** — the optional "optimizer environment captured" flag on a repro at any Repro Fidelity Level; adds session-parameter fidelity. Not a ladder rung (it is privilege-gated and orthogonal to schema fidelity).
- **Absent vs Invisible** — the two ways a bundle item can be missing: *absent* = checked and not found; *invisible* = could not be checked for lack of privilege. Never conflated in coverage or promise wording.
- **Metadata Bundle** — the schema-metadata package (stats, DDL, constraints, histograms) gathered from the source database that raises repro fidelity.
- **Experiment** — a candidate alternative-plan attempt (hints, SQL patch, session parameters) emitted alongside a test case, verified by comparing plans.
- **Privacy Fence** — the hard boundary: the core app is fully client-side ("nothing is uploaded"); AI features are an explicit, per-run opt-in exception with a mandatory review of exactly what leaves the browser.
- **Guided Anonymization** — an offline, client-side pass run *before* any AI upload: consistently renames identifiers to placeholders and scrubs sensitive values across plan/SQL/metadata, with a guided review of the mapping; responses are de-anonymized locally. Part of the Privacy Fence, never a backend feature.
- **Walkthrough** — a generated, ordered step sequence ("run this, then load the new plan, verify with Compare") that guides a non-expert through fixing their query. Static output of an AI Analysis — not interactive chat (that is the out-of-scope Phase 8).
- **Hosted tier / oraplanviz-cloud** — the paid backend that holds model credentials and streams AI output; the primary AI path for v1.
- **Run** — one metered, streamed model invocation through oraplanviz-cloud (kinds: teaser analysis, deep analysis, walkthrough, build, repair). The unit that metering, debits, feedback, and repair linkage attach to; never stored beyond payload-free metadata.
- **Companion** — the optional local `oraplanviz-agent` process for database connectivity; not part of AI v1.
- **Repro Rate** — the measured fraction of eval scenarios whose generated test case reproduces the original plan shape; the number that gates selling the Builder.
