# CONTEXT

Canonical vocabulary for the Oracle Execution Plan Visualizer domain. Glossary only — no implementation detail.

## Glossary

- **Plan** — a parsed Oracle execution plan (any supported input format) loaded into the app.
- **Advisor** — the built-in *deterministic* heuristic findings engine. Free, offline, never uses a model.
- **AI Analysis** — a model-generated expert report over a loaded plan. Distinct from the Advisor; must never silently contradict it.
- **Teaser** — the limited number of free AI Analyses a user gets; exists to demonstrate value and lead to the Builder.
- **Credit** — the prepaid unit of paid AI usage, sold in one-time packs. What one credit buys per feature is defined by packaging (see wayfinder map).
- **Test-Case Builder** (the *Builder*) — the flagship paid feature: turns a plan (plus whatever inputs are attached) into a runnable synthetic repro script set, no production data required.
- **Repro Fidelity Level** — a rung on the *fidelity ladder*: how faithful the Builder's repro can be given the inputs attached (plan only → +SQL text → +metadata bundle → +histograms). Each level carries an honest promise of repro likelihood.
- **Metadata Bundle** — the schema-metadata package (stats, DDL, constraints, histograms) gathered from the source database that raises repro fidelity.
- **Experiment** — a candidate alternative-plan attempt (hints, SQL patch, session parameters) emitted alongside a test case, verified by comparing plans.
- **Privacy Fence** — the hard boundary: the core app is fully client-side ("nothing is uploaded"); AI features are an explicit, per-run opt-in exception with a mandatory review of exactly what leaves the browser.
- **Hosted tier / oraplanviz-cloud** — the paid backend that holds model credentials and streams AI output; the primary AI path for v1.
- **Companion** — the optional local `oraplanviz-agent` process for database connectivity; not part of AI v1.
- **Repro Rate** — the measured fraction of eval scenarios whose generated test case reproduces the original plan shape; the number that gates selling the Builder.
