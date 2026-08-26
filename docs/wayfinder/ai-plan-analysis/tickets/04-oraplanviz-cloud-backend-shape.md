---
title: oraplanviz-cloud backend shape
labels: [wayfinder:grilling]
status: closed
assignee: davidbudac
blocked-by: [02-credit-and-subscription-packaging.md, 03-merchant-of-record-provider-choice.md]
---

## Question

What is the smallest backend that streams model output, validates entitlements, meters usage, and retains no plan payloads — and where does it run?

Decide with the user:

- runtime: Cloudflare Workers vs Fly.io vs Vercel functions vs small VPS — judged on SSE streaming reliability, cold starts, cost at low volume, and secret handling for the Anthropic key;
- API contract: keep the plan's `POST /v1/analyze` SSE shape + `GET /v1/me`; add what packaging needs (credit balance, teaser counters) per the closed [packaging ticket](02-credit-and-subscription-packaging.md);
- entitlement check against the chosen [MoR provider](03-merchant-of-record-provider-choice.md): webhook-driven token store vs per-request license validation; storage (KV/SQLite/Postgres) for balances and metering;
- teaser enforcement mechanics (identity, limits, abuse cap) — graduate this from the map's fog;
- the no-retention logging policy (what metadata is kept, where);
- repo boundary: new `oraplanviz-cloud` repo; only the HTTP contract lands in this repo's spec.
- **inherited requirement** from the closed [Evals harness v1 scope](07-evals-harness-v1-scope.md): the v1 contract must include `POST /v1/feedback` (thumbs up/down + run-event log — kind, model, promptVersion, token counts, latency; never plan payloads).

Resolution = the chosen stack + the full v1 HTTP contract, ready to paste into the spec rewrite.

## Resolution

Decided with the user 2026-08-26 (grilling, 2 rounds, all 13 questions settled as recommended).
Also settles two fog items: **teaser enforcement mechanics** and **billing lifecycle detail**.

### Stack

- **Cloudflare Workers + Hono (TypeScript) + D1** (SQLite). Scale-to-zero, ~$5/mo, zero ops,
  platform secrets for the Anthropic key. D1 constraint acknowledged: the debit path
  (run record + ledger entry) must be a single batched statement set — it fits.
- Reconciliation and refill jobs run as Workers **Cron Triggers**.
- **Auth: hand-rolled GitHub + Google OAuth** (authorization-code flow on the Worker). One
  `accounts` row per provider identity. Session token = opaque `opv_` token, SHA-256-hashed in
  D1 — the **same validation path** as paid tokens (one auth code path, not two). No Clerk/Auth.js.
- New private repo `oraplanviz-cloud`. **Contract types are hand-copied** between the two repos;
  the spec (this repo) is canonical. No shared npm package in v1; revisit at a third consumer.

### v1 HTTP contract (pasteable)

```
POST /v1/runs            Authorization: Bearer <opv_ token>   (or anon-id for teaser)
  Body: { kind: 'teaser_analysis'|'deep_analysis'|'walkthrough'|'build'|'repair',
          system, prompt, promptVersion, parentRunId? }        // parentRunId: repair only
  → 200 text/event-stream:
      start {runId}
      delta {text}
      done  {stopReason, usage:{inputTokens,outputTokens}, debitedUnits}
      error {message, status}
  → JSON {error, code}: invalid_request 400 · unauthorized 401 ·
      insufficient_credits 402 · teaser_exhausted 402 · origin_forbidden 403 ·
      context_too_large 413 · concurrency_limit 429 · rate_limited 429 ·
      upstream_error 502 · breaker_open 503

GET  /v1/me              → { account, teaser:{remaining}, credits:{balanceUnits},
                             subscription:{status, periodEnd} | null }
POST /v1/feedback        { runId, verdict:'up'|'down', comment? }
POST /v1/checkout        { sku } → { url }        // Polar session; external_customer_id = account
POST /v1/webhooks/polar                            // Standard Webhooks signature
GET|POST /v1/auth/*                                // GitHub/Google code flow → opv_ session token
```

- SSE events are **additive over `AnalysisStreamEventV1`** (`start` prepended, `done` extended);
  a V1 parser still works.
- **Models, effort, input caps, and output caps are server-pinned per kind** — no `model` field.
  Client-assembled `{system, prompt}` is kept (the privacy-fence review dialog shows exactly the
  bytes sent); the backend never inspects payloads. The deep-analysis(¼cr)-vs-build(1cr) Opus
  arbitrage is closed economically by output caps (~8k vs ~32k maxTokens), not inspection.
- `promptVersion` is client-sent, validated against a known-versions list (evals tagging).
- `repair`: server enforces ≤ 2 per parent `build`; experiments ride inside the `build` output.
- `walkthrough` is its own kind to keep ticket 13's options open.

### Entitlements, metering, teaser

- **Ledger in integer quarter-credit units** (1 Credit = 4 units); append-only signed entries;
  balance = SUM per account, never a mutable counter. **Debit on delivery**: the debit row is
  written only when a run reaches `done` — an errored run never debits (no compensating refunds).
- **Per-account concurrency 1** on paid runs (overdraft guard + natural UX + abuse control).
- **Anonymous teaser identity**: signed anon-id minted on first request, stored in localStorage;
  plus hashed-IP cap of 3 anonymous runs/day/IP (NAT fairness); plus the $10/mo global breaker.
  Clearing storage regains a teaser — accepted; the breaker caps blast radius. No fingerprinting,
  no CAPTCHA in v1 (Turnstile is the documented escalation lever).
- **Sub fair-use cap**: 50 Sonnet quick analyses/day per subscriber, documented, → `rate_limited`.

### Billing lifecycle (Polar)

- Webhook: verify Standard-Webhooks signature → idempotent insert into `polar_events` →
  `order.paid` = `+N units` keyed by order id · `subscription.cycled` = monthly refill entry ·
  refund/dispute = negative entry. **Balance may go negative; paid runs blocked while ≤ 0.**
- Reconciliation cron (~6h) lists recent Polar orders and replays anything the webhook missed.
- Invoice/receipt surface is Polar's own (MoR); credits never expire (per packaging).

### D1 schema (8 tables)

`accounts` · `identities` (provider, provider_user_id) · `tokens` (token_hash, kind) ·
`credit_ledger` (append-only, signed quarter-units, keyed by order/run/adjustment id) ·
`run_events` (runId, account/anon id, kind, model, promptVersion, token counts, latency, status,
fidelity level, debit, feedback verdict/comment — **never payloads**) · `teaser_grants` ·
`subscriptions` · `polar_events` (webhook idempotency).

### Logging / retention policy

- Server keeps **metadata only**: the `run_events` row. Never plan payloads, prompts, or
  completions; request bodies are never buffered to logs (pure streaming pass-through).
- `run_events` kept indefinitely (tiny, payload-free; feeds the evals harness + unit economics).
  Raw platform logs 30 days. Printable promise: *"your plan is processed in memory and never stored."*
- **CORS: strict origin allowlist** (prod origins + localhost dev); Bearer-only (no cookies, no
  CSRF surface); non-allowlisted origin → `origin_forbidden` — stops third-party teaser free-riding.
