---
labels: [wayfinder:map]
status: open
---

# Map: AI Plan Analysis — hosted-first, profitable, standout

## Destination

A **locked rewrite of [`docs/plans/ai-plan-analysis.md`](../../plans/ai-plan-analysis.md) (v2)** — a spec ready to hand to implementation sessions, with nothing left to decide before building. The spec describes a **hosted-first** AI feature set: a free AI-analysis teaser plus a **paid test-case builder** (the standout), with graceful fidelity degradation, credit-pack + subscription pricing via a merchant of record, tiered models, and a full 4-layer evals harness gating the paid claims. Two user-added features ride along: **guided anonymization** (offline, before anything is uploaded) and a **step-by-step optimization walkthrough** for non-experts.

## Notes

- **Tracker**: local-markdown. Tickets live in [`tickets/`](tickets/); a ticket is claimed by setting `assignee:` in its frontmatter, closed by setting `status: closed` and appending a `## Resolution` section. `blocked-by:` lists ticket filenames; the frontier = open + unassigned + all blockers closed.
- **Research agents** write findings to [`research/`](research/) and resolve only their own ticket file — they do **not** edit this map. Whichever session next loads the map folds closed tickets into Decisions-so-far.
- **Skills to consult** when working tickets: `mattpocock-skills:grilling` + `mattpocock-skills:domain-modeling` (default), `mattpocock-skills:prototype` for the two prototype tickets, `mattpocock-skills:research` for research tickets, `dbmint-oracle-test` for anything needing live-Oracle verification.
- **Glossary**: [`CONTEXT.md`](../../../CONTEXT.md) holds the canonical terms (Teaser, Credit, Repro Fidelity Level, …). Challenge drift against it.
- Wayfinder is planning-only here: tickets resolve decisions; implementation happens after the spec rewrite closes.
- **2026-08-26**: user added two feature tickets — [Guided anonymization](tickets/12-guided-anonymization.md) (offline pre-upload renaming/scrubbing with guided review + round-trip de-anonymization) and [Guided optimization walkthrough](tickets/13-guided-optimization-walkthrough.md) (generated step sequence for non-experts; explicitly *not* the out-of-scope Phase-8 chat). Both now block the spec rewrite.

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

- [oraplanviz-cloud backend shape](tickets/04-oraplanviz-cloud-backend-shape.md) — **Cloudflare Workers + Hono + D1**, hand-rolled GitHub/Google OAuth (session = hashed `opv_` token, one validation path); contract = `POST /v1/runs` SSE (kinds teaser_analysis/deep_analysis/walkthrough/build/repair, server-pinned models + per-kind input/output caps closing the ¼-vs-1-credit arbitrage) + `/v1/me`, `/v1/feedback`, `/v1/checkout`, Polar webhook, auth routes; append-only quarter-unit credit ledger, debit-on-delivery, concurrency 1; teaser mechanics settled (localStorage anon-id + 3/day/IP + $10 breaker, no CAPTCHA); sub fair-use = 50 Sonnet analyses/day; payload-free `run_events` kept indefinitely, strict CORS allowlist; refunds → negative balance blocks paid runs; contract types hand-copied, spec canonical.
- [Evals harness v1 scope](tickets/07-evals-harness-v1-scope.md) — Phase-7 base confirmed: ~15 hand-written scenarios (session-verified to exhibit their fault, built *with* Layer 2); Repro Rate measured at **all four rungs** (F2/F3 nightly deterministic, F0/F1 in the on-demand LLM run); gate table locked (F3 ≥ 90% / F2 ≥ 80% blocks selling the Builder, 100% hard checks, advisor recall ≥ 90%, regression rate ≤ 10%); GH Actions nightly on gvenzl/oracle-free (FUTC-covered); Haiku judge, $30/run alert ceiling; F2/F3 rates published with corpus-size disclosure; minimal `POST /v1/feedback` + promptVersion tagging in v1.
- [Repro fidelity ladder](tickets/05-repro-fidelity-ladder.md) — four input-set-derived rungs **F0 Sketch / F1 Skeleton / F2 Faithful / F3 Skew-Faithful** (+optimizer_env as a modifier, not a rung); privilege = per-item provenance (*absent* ≠ *invisible*), never a second axis; AI authors guessed sections at F0/F1, deterministic generator owns F2+; whole Builder paid in v1; Repro Rate = shape match at every rung; prompts get a capped ~24-endpoint histogram encoding while scripts keep all buckets.
- [Non-DBA metadata gathering fallback](tickets/06-non-dba-metadata-gathering-fallback.md) — histograms (v3) need **no DBA at all** (`ALL_TAB_HISTOGRAMS` is column-identical), and nearly the whole bundle degrades cleanly to `ALL_*`; real gaps: SQL_ID→object resolution (V$), segment bytes, cross-schema DDL, optimizer_env. Recommendation: **one capability-probed script** (not a fork) emitting a `capabilities` block + `unavailable_reason`s; the fidelity ladder needs a privilege axis distinguishing *absent* from *invisible*. dbmint verification queued for implementation.
- [Merchant-of-record provider choice](tickets/03-merchant-of-record-provider-choice.md) — **Polar**: only MoR with license-key issuance + server-side validation, one model for packs *and* subs, German individuals allowed, Kleinunternehmer-friendly (US contracting entity; Steuerberater check pending); ≈12.9% net fees on a €9 pack; own hashed `opv_` tokens keep Polar confined to one backend adapter, with Stripe Managed Payments as the exit path. Lemon Squeezy and Paddle rejected.
- [Credit and subscription packaging](tickets/02-credit-and-subscription-packaging.md) — **1 Credit = 1 Builder run** (≤2 repairs + experiments incl.), deep analysis ¼ credit internally; EUR tax-inclusive packs €19/4 · €39/10 · €89/25, no expiry; one sub tier €39/mo → 12 credits + rollover + unlimited Sonnet quick analyses; teaser = 3 lifetime per account (1 anonymous + 2 post-sign-in), $10/mo circuit-breaker; debit on delivery (infra errors auto-refund, unverified repro doesn't); teaser report carries a locked Builder preview.
- [Unit economics of hosted analysis and builder runs](tickets/01-unit-economics.md) — Sonnet 5 (low effort) for the teaser (~$0.02/run), Opus 5 (high) for paid analysis/Builder (~$0.24 / ~$1.01 full Builder turn); Builder credit priced $4–5 (70%+ margin, packs $19/4 · $39/10 · $89/25); teaser affordable unenforced to ~2k runs/mo (~$42); **spec must mandate compact histogram encoding in prompts** — naive v3 serialization can 3× Builder cost.

## Not yet specified

- **README / site reframing & launch** — how the public story changes at ship time. Sharpens after [Privacy fence and product framing](tickets/10-privacy-fence-and-product-framing.md) and the spec rewrite.
- **Companion & BYO return path** — how self-hoster transports come back post-v1 (roadmap section of the spec, not designed here).

## Out of scope

- **Phase 8 guided chat + agent auto-run** — a later effort with its own map; the v1 spec may name it as roadmap only.
- **Phase 4 AI Compare Plans** — deferred beyond v1.
- **Companion engines (Codex / Claude Code) and BYO-key transports in v1** — cut by charter; only the transport seam survives.
- **Marketing site / launch campaign** — separate effort after the spec ships.
