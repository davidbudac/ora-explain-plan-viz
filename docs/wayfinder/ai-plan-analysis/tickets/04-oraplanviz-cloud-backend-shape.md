---
title: oraplanviz-cloud backend shape
labels: [wayfinder:grilling]
status: open
assignee:
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
