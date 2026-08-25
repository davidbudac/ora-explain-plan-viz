---
labels: [wayfinder:map]
status: open
---

# Map: AI Plan Analysis — hosted-first, profitable, standout

## Destination

A **locked rewrite of [`docs/plans/ai-plan-analysis.md`](../../plans/ai-plan-analysis.md) (v2)** — a spec ready to hand to implementation sessions, with nothing left to decide before building. The spec describes a **hosted-first** AI feature set: a free AI-analysis teaser plus a **paid test-case builder** (the standout), with graceful fidelity degradation, credit-pack + subscription pricing via a merchant of record, tiered models, and a full 4-layer evals harness gating the paid claims.

## Notes

- **Tracker**: local-markdown. Tickets live in [`tickets/`](tickets/); a ticket is claimed by setting `assignee:` in its frontmatter, closed by setting `status: closed` and appending a `## Resolution` section. `blocked-by:` lists ticket filenames; the frontier = open + unassigned + all blockers closed.
- **Research agents** write findings to [`research/`](research/) and resolve only their own ticket file — they do **not** edit this map. Whichever session next loads the map folds closed tickets into Decisions-so-far.
- **Skills to consult** when working tickets: `mattpocock-skills:grilling` + `mattpocock-skills:domain-modeling` (default), `mattpocock-skills:prototype` for the two prototype tickets, `mattpocock-skills:research` for research tickets, `dbmint-oracle-test` for anything needing live-Oracle verification.
- **Glossary**: [`CONTEXT.md`](../../../CONTEXT.md) holds the canonical terms (Teaser, Credit, Repro Fidelity Level, …). Challenge drift against it.
- Wayfinder is planning-only here: tickets resolve decisions; implementation happens after the spec rewrite closes.

## Charter (settled at kickoff, before any ticket)

- **Destination type** — locked spec rewrite, not code, not a go/no-go memo.
- **Ambition** — side-income product: hosted paid tier covering inference + margin; no heavy-ops commitment.
- **Customer** — non-expert developers ("the dev who inherited a slow query"); experts benefit incidentally.
- **Standout bet** — the reproducible **test-case builder** (plan+stats → runnable synthetic repro + fix verification); structured-context analysis quality is the enabler, not the product.
- **Privacy** — the "no backend, nothing is uploaded" promise is inviolable for the core app; AI is a clearly-fenced, opt-in exception with its own consent/review flow.
- **Seam order** — hosted-first: browser → oraplanviz-cloud is the primary AI path. Companion engines (Codex / Claude Code) and BYO-key are **cut from v1**; the `AnalysisTransport` seam is kept so they can return later.
- **Free/paid boundary** — free: all deterministic features + a few teaser AI analyses; paid: test-case builder, experiments, higher quotas.
- **Pricing shape** — both: one-time credit packs (episodic users) + a subscription (consultants/heavy users).
- **Billing rails** — merchant of record (Lemon Squeezy / Polar / Paddle class) for EU VAT sanity.
- **Gather friction** — graceful degradation: builder always produces something from plan alone; each added input visibly raises a repro-fidelity level; gather script gets a non-DBA (ALL_*/USER_*) fallback.
- **Eval gating** — the **full** 4-layer harness (deterministic units, repro-fidelity backtest, LLM-judged analysis quality, experiment payoff) is in scope for v1; the builder is sold only with a measured repro rate.
- **Model policy** — tiered by feature: cheap/fast model for free teaser, top model for paid analysis + builder; exact models fixed by the unit-economics research ticket.

## Decisions so far

<!-- one line per closed ticket: gist + link. Appended as tickets close. -->

- [Non-DBA metadata gathering fallback](tickets/06-non-dba-metadata-gathering-fallback.md) — histograms (v3) need **no DBA at all** (`ALL_TAB_HISTOGRAMS` is column-identical), and nearly the whole bundle degrades cleanly to `ALL_*`; real gaps: SQL_ID→object resolution (V$), segment bytes, cross-schema DDL, optimizer_env. Recommendation: **one capability-probed script** (not a fork) emitting a `capabilities` block + `unavailable_reason`s; the fidelity ladder needs a privilege axis distinguishing *absent* from *invisible*. dbmint verification queued for implementation.
- [Merchant-of-record provider choice](tickets/03-merchant-of-record-provider-choice.md) — **Polar**: only MoR with license-key issuance + server-side validation, one model for packs *and* subs, German individuals allowed, Kleinunternehmer-friendly (US contracting entity; Steuerberater check pending); ≈12.9% net fees on a €9 pack; own hashed `opv_` tokens keep Polar confined to one backend adapter, with Stripe Managed Payments as the exit path. Lemon Squeezy and Paddle rejected.
- [Unit economics of hosted analysis and builder runs](tickets/01-unit-economics.md) — Sonnet 5 (low effort) for the teaser (~$0.02/run), Opus 5 (high) for paid analysis/Builder (~$0.24 / ~$1.01 full Builder turn); Builder credit priced $4–5 (70%+ margin, packs $19/4 · $39/10 · $89/25); teaser affordable unenforced to ~2k runs/mo (~$42); **spec must mandate compact histogram encoding in prompts** — naive v3 serialization can 3× Builder cost.

## Not yet specified

- **Teaser enforcement mechanics** — anonymous vs account-required free analyses, per-IP/device limits, abuse cost cap. Sharpens after [Credit and subscription packaging](tickets/02-credit-and-subscription-packaging.md) and [oraplanviz-cloud backend shape](tickets/04-oraplanviz-cloud-backend-shape.md).
- **Scenario corpus contents & gating thresholds** — the concrete ~15 eval scenarios and the pass bars. Sharpens after [Evals harness v1 scope](tickets/07-evals-harness-v1-scope.md).
- **Billing lifecycle detail** — refunds, credit expiry edge cases, invoice surface, webhook handling. Sharpens after [Merchant-of-record provider choice](tickets/03-merchant-of-record-provider-choice.md).
- **README / site reframing & launch** — how the public story changes at ship time. Sharpens after [Privacy fence and product framing](tickets/10-privacy-fence-and-product-framing.md) and the spec rewrite.
- **Companion & BYO return path** — how self-hoster transports come back post-v1 (roadmap section of the spec, not designed here).

## Out of scope

- **Phase 8 guided chat + agent auto-run** — a later effort with its own map; the v1 spec may name it as roadmap only.
- **Phase 4 AI Compare Plans** — deferred beyond v1.
- **Companion engines (Codex / Claude Code) and BYO-key transports in v1** — cut by charter; only the transport seam survives.
- **Marketing site / launch campaign** — separate effort after the spec ships.
