---
title: Merchant-of-record provider choice
labels: [wayfinder:research]
status: closed
assignee: research-agent
blocked-by: []
---

## Question

Which merchant-of-record fits a German-based side project selling **one-time credit packs + a subscription** for a client-side web app with a small custom backend?

Compare (primary sources: current official docs/pricing, not recall) **Lemon Squeezy, Polar, Paddle** — and note any strong newer alternative:

- fees on small transactions (€9-class packs);
- support for one-time purchases *and* subscriptions in one account;
- license-key or API-token issuance the `oraplanviz-cloud` backend can validate server-side (webhook + verification API shape);
- EU/Germany specifics: VAT handling, invoices, payout to German bank, Kleinunternehmer compatibility;
- account requirements imposed on buyers; checkout embed vs redirect;
- risk notes (e.g. Lemon Squeezy post-Stripe-acquisition status — verify current state).

Findings → `../research/mor-comparison.md`; resolve with a single recommended provider + integration sketch (webhook → token issuance → backend validation).

## Resolution

**Decision: Polar** ([polar.sh](https://polar.sh)) is the merchant of record for v1. Full evidence and
citations in [`../research/mor-comparison.md`](../research/mor-comparison.md) (all facts checked against
primary sources on 2026-08-25).

### Why Polar

- **Fees are acceptable, not optimal.** New organizations land on Polar's free **Starter** tier at
  **5% + 50¢**, plus **+1.5% for international (non-US) cards** — so effectively 6.5% + 50¢ on every EU
  buyer, computed on the tax-inclusive total. On a €9 pack sold to a German consumer (buyer pays €10.71)
  that is ≈ **€1.16, or 12.9% of net**; on a €19/month subscription ≈ 10.2%. Note Polar repriced in 2026:
  the old 4% + 40¢ is grandfathered only for orgs created before **2026-05-27**. Paddle would be ~11.1%
  and Stripe Managed Payments ~8.8% on the same €9 pack — the gap to the cheapest option is roughly
  **€20/month at €500/month revenue**, which does not buy back the entitlement infrastructure Polar
  ships for free.
- **One-time + subscription in one model.** Polar's docs: *"Subscriptions and one-time purchases are both
  products in Polar — same API, same data model."* Metered/usage billing exists in the same account if
  credits ever need to become metered.
- **Server-side verification is built in.** License keys are a first-class benefit with
  `POST /v1/customer-portal/license-keys/validate` and `/activate` (activation limits, usage quotas,
  expiry, rotation, auto-revoke on cancellation). Webhooks follow the **Standard Webhooks** spec with
  SDK-side signature validation, a sandbox, and a CLI tunnel for local testing. Events cover
  `order.paid`, the full `subscription.*` set, and `benefit_grant.*`.
- **Germany works, including as an individual.** Payouts run on Stripe Connect Express; Germany is a
  listed seller country and individuals are supported where Stripe Connect Express allows the individual
  business type. Bank account must be German and in EUR (Wise/Revolut virtual accounts generally do not
  qualify). No meaningful payout floor beyond Stripe's per-currency minimum.
- **Cleanest tax position.** The contracting entity is **Polar Software, Inc. (Delaware, US)**, so the
  seller's supply to the MoR falls outside EU VAT (§ 3a Abs. 2 UStG) with no *Zusammenfassende Meldung*.
  Kleinunternehmer status (§ 19 UStG: €25,000 prior year / €100,000 current year) stays undisturbed.
  ⚠️ Confirm with a Steuerberater before launch.
- **No approval gauntlet, no sub-$10 problem, buyers need no account** (email one-time-code portal, or
  pre-authenticated links from our app), and checkout can be **embedded on our own domain** or hosted.

### Why not the others

- **Lemon Squeezy — do not start here.** Stripe-owned since July 2024. Still live, still taking signups,
  no announced sunset — but the LS team is building **Stripe Managed Payments** and, per their own
  2026-01-28 post, is building migration paths *off* Lemon Squeezy. Same headline fees as Polar with a
  forced migration attached. (Caveat: lemonsqueezy.com blocks automated fetching; those facts came from
  search excerpts of the official pages — re-verify by hand if this ever gets reconsidered.)
- **Paddle — built for a different customer.** *"Selling products under $10 … contact us for custom
  pricing"* kills the €9 pack at standard rates; payouts only once the balance exceeds **$100/€100/£100**
  (monthly, by the 15th; $15 for international transfers); onboarding requires domain review + identity
  (and, for companies, KYB) verification; **Paddle Billing dropped license keys and Paddle-led
  fulfillment entirely**. Also, EU-VAT-registered sellers contract with **Paddle Payments Ltd (Ireland)**,
  which pulls reverse-charge/ZM paperwork back in.
- **Stripe Managed Payments — the runner-up and the exit path.** Cheapest for a German seller
  (3.5% MoR + 1.5% + €0.25 EEA processing ≈ 5% + €0.25) and Germany is an eligible business location.
  Rejected for v1 because: the buyer sees **Link** as merchant of record (receipts from Link, statement
  `LINK.COM*`), **custom checkout domains are not supported**, integration is limited to Checkout /
  Payment Links (no Elements), subscriptions require Stripe Billing at extra cost, there are no license
  keys, access is gated by an eligibility assessment, and Stripe may refund a transaction without
  consent if an escalation goes unanswered for 48 hours. Revisit if volume makes the fee delta material.
- Creem / Dodo / Fungies: unverified, less established, and every "comparison" surfaced in this space is
  published by one of them. No capability Polar lacks.

### Integration sketch

Principle: **Polar is the source of truth for money; `oraplanviz-cloud` is the source of truth for
entitlement.** No client-held Polar artifact ever grants access on its own.

1. **Checkout.** Backend creates a Polar checkout session with `external_customer_id` = our user id and
   `metadata: { user_id, pack_sku }`; browser embeds it or redirects to the returned `url`.
2. **Webhook → ledger.** `order.paid` arrives; verify the Standard Webhooks signature; **idempotent on
   event id + order id**; append `+N credits` to a credit ledger keyed by order id (never a mutable
   counter). Subscribe to `subscription.*` for plan/status/`current_period_end` and to `benefit_grant.*`
   for gating; `subscription.cycled` is the monthly refill trigger.
3. **Token issuance.** Backend mints an opaque `opv_…` token (32 random bytes), stores it **hashed**
   (SHA-256), shows it once; the browser app sends it as `Authorization: Bearer`.
4. **Backend validation on the request path.** Hash the token → look up the account → check subscription
   status and/or debit the ledger in the same transaction as the job record. **No call to Polar on the
   request path**, so Polar's uptime never gates inference. Refunds/disputes reverse the ledger entry.
5. **Reconciliation.** A boot-time and periodic job lists recent Polar orders via the API and replays
   anything the webhook missed — webhooks alone are not a durable ledger.
6. **License keys are reserved for the offline/companion path** (validate via
   `POST /v1/customer-portal/license-keys/validate` with `key` + `organization_id`), not for the hosted
   web app.
7. **Keep the exit open.** All Polar-specific code lives in one adapter (session creation, webhook
   verification, event → ledger mapping); everything upstream speaks our own `Order`, `Entitlement`,
   `CreditLedgerEntry` types, so a move to Stripe Managed Payments is one adapter plus a customer-id
   backfill.

### Follow-ups this unblocks / hands off

- **Billing lifecycle detail** (refunds, credit expiry, invoice surface, webhook handling) — now has a
  concrete provider to specify against.
- **Tax advisor confirmation** of the §19/§3a reading before going live — not a blocker for the spec.
- Concrete pack prices and credit-per-pack values remain with
  [Credit and subscription packaging](02-credit-and-subscription-packaging.md); ledger/token storage
  lands in [oraplanviz-cloud backend shape](04-oraplanviz-cloud-backend-shape.md).
