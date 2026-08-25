---
title: Credit and subscription packaging
labels: [wayfinder:grilling]
status: closed
assignee: davidbudac
blocked-by: [01-unit-economics.md]
---

## Question

What exactly does a **credit** buy, what do the packs and the subscription cost, and how is the free teaser bounded?

Decide with the user (grilling + domain-modeling), using the closed [Unit economics](01-unit-economics.md) numbers:

- credit definition: 1 credit = 1 analysis? Is a test-case build 1 credit or N? Are experiments separate?
- pack sizes and prices (episodic buyer psychology — impulse-buy small pack, better-value big pack); do credits expire?
- subscription: price, monthly quota or unlimited-with-fair-use, who it's for (consultants/teams);
- free teaser: how many runs, per what identity (anonymous? account?), which model, and the monthly cost cap the user accepts for it;
- upgrade path story: teaser report → "build a test case" upsell.

Record the pricing table as the resolution; update `CONTEXT.md` with the settled meaning of Credit/Teaser.

## Resolution

Decided with the user 2026-08-26 (grilling, 3 rounds, all settled). `CONTEXT.md` updated (Credit, Teaser).

### Credit definition

- **1 Credit = 1 full Builder run**: build + up to 2 repairs + Experiments. Builder-denominated — "1 credit = 1 test case" is the catalog story.
- **Paid deep analysis (Opus) debits ¼ Credit.** Fractional debits are internal metering; never a separate SKU, never visible to Polar.
- **No standalone Experiments SKU in v1** — Builder-bundled only. Revisit post-v1 if users want to re-run experiments on an existing test case.
- **Debit on delivery, not on click**: infra/model errors auto-refund the credit silently. A delivered-but-unverified repro does **not** refund — the fidelity ladder promises a likelihood (backed by the published Repro Rate), not a guarantee.

### Pricing (EUR canonical, tax-inclusive, Polar localizes display)

| SKU | Price | €/credit |
|---|---|---|
| Starter pack | **€19 / 4 credits** | €4.75 |
| Pro pack | **€39 / 10 credits** | €3.90 |
| Bulk pack | **€89 / 25 credits** | €3.56 |
| Subscription (one tier, v1) | **€39/mo → 12 credits** | €3.25 |

- Prices are what the card is charged (German-consumer gross convention); worst-case net €19 → €15.97 still clears the 80%-inference-margin floor (~€4.60/credit floor on Starter, met; Bulk €3.56 vs ~€3.10 cost floor).
- **Credits never expire** (3-year nominal cap only if accounting demands one).
- Subscription: 1-month rollover on unused credits, cancel anytime, always the best per-credit price (~9% under Bulk), **plus unlimited fair-use Sonnet-tier quick analyses** — the sub is qualitatively better than packs, not just cheaper. Target: consultants/heavy users.

### Free teaser bounds

- **3 AI analyses per account, lifetime** (no refill — the Advisor is the unlimited free tier; a refill is a later config change if conversion data demands it): **1 anonymous** (zero-friction first-visit wow), **+2 after sign-in** (GitHub/Google).
- Model: `claude-sonnet-5`, effort `low` (per unit-economics ticket); 15k-token context cap.
- Global monthly spend circuit-breaker at **$10/mo** (~475 runs) — degrades to "sign in / come back later", never fails open.

### Upsell story

Teaser report includes a **locked preview** of the Builder output (grayed fidelity meter, "your repro would be Level N") — not a bare CTA. Funnel: teaser → ¼-credit deep analysis → 1-credit test case. Concrete rendering belongs to [Non-expert analysis report design](08-non-expert-analysis-report-design.md).
