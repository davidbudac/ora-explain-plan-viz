# Merchant-of-record comparison for a German side project

Research for ticket [`03-merchant-of-record-provider-choice`](../tickets/03-merchant-of-record-provider-choice.md).
All facts checked against official docs/pricing pages on **2026-08-25**; every claim is linked to the
page that owns it. Where a vendor site blocked automated fetching, that is called out explicitly.

**Seller context assumed throughout:** individual / side business resident in **Germany**, selling
**one-time credit packs (~€9–29)** and **one subscription** for a web app, with a small custom backend
(`oraplanviz-cloud`) that must verify entitlements server-side. Volume at launch: low (tens to low
hundreds of € per month).

---

## 1. Verdict up front

**Recommended: [Polar](https://polar.sh).** Not the cheapest per transaction, but the only candidate
that combines: one-time + subscription in one data model, **built-in license-key issuance with a
server-side validate/activate API**, Standard-Webhooks-signed events, a sandbox, no seller-approval
gauntlet, no meaningful payout minimum, German individual sellers explicitly supported, and a **US
contracting entity** — which keeps the seller's own VAT position as simple as it can be.

**Runner-up / watch item: [Stripe Managed Payments](https://docs.stripe.com/payments/managed-payments).**
Cheapest on paper for a German seller (roughly 5% + €0.25 on EEA cards vs Polar's 6.5% + $0.50), and it
is where Lemon Squeezy is heading. Rejected for v1 because it forces Stripe Checkout/Payment Links with
**Link** shown to the buyer as the merchant of record, does not support custom checkout domains, issues
no license keys, and gates access behind an eligibility assessment. Keep the integration seam thin so
this stays a migration option.

**Rejected: Paddle** (sub-$10 products need negotiated custom pricing; $100/€100/£100 monthly payout
minimum; KYB/domain-review approval; no license keys in Paddle Billing).
**Rejected: Lemon Squeezy** (same headline fees as Polar but strategically end-of-life: Stripe-owned and
publicly building a migration path to Stripe Managed Payments).

---

## 2. Fee comparison

### 2.1 Published rates

| Provider | Base rate | Surcharges relevant to a German seller | Payout cost |
|---|---|---|---|
| **Polar** (Starter, free plan — the tier a *new* org lands on) | **5% + 50¢** | **+1.5% international cards (non-US)** — i.e. essentially every EU buyer; +0.5% on subscriptions is *Early Member only*; **$15 per dispute** | Stripe's costs passed through: **$2 per month with active payouts**, **0.25% + $0.25 per payout**, FX 0.25% (EU) up to 1% elsewhere |
| **Polar** (Pro $20/mo) | 3.8% + 40¢ | same +1.5% intl | same |
| **Polar** (Early Member, orgs created before **May 27, 2026**) | 4% + 40¢ (+0.5% subscriptions) | grandfathered indefinitely | same |
| **Paddle** | **5% + 50¢** per checkout transaction, all-inclusive | *"If you're selling products under $10 … contact us for custom pricing"* | Monthly, only **if the balance exceeds $100 / €100 / £100**; local ACH free, **international bank transfer $15** |
| **Lemon Squeezy** | **5% + 50¢** | +1.5% international cards, +1.5% PayPal, +0.5% subscriptions | Payouts on the 1st and 15th; **$50 minimum**; small processing/conversion fee deducted depending on method/region |
| **Stripe Managed Payments** | **3.5%** MoR fee **on top of** normal Stripe processing | German account: EEA cards **1.5% + €0.25** (premium cards 2.8% + €0.25), UK cards 2.5% + €0.25, international cards 3.15% + €0.25, currency conversion **+2%**. Subscriptions additionally need Stripe Billing (its own fee). | Standard Stripe payouts to a German bank account |

Sources: [Polar fees](https://polar.sh/docs/merchant-of-record/fees) ·
[Paddle pricing](https://www.paddle.com/pricing) ·
[Paddle seller terms](https://www.paddle.com/legal/terms) ·
[Lemon Squeezy fees](https://docs.lemonsqueezy.com/help/getting-started/fees) and
[getting paid](https://docs.lemonsqueezy.com/help/getting-started/getting-paid) (see caveat in §8) ·
[Managed Payments pricing](https://support.stripe.com/questions/managed-payments-pricing) ·
[Stripe DE pricing](https://stripe.com/de/pricing).

### 2.2 What that actually costs on a €9 pack

Polar documents that its fee is calculated on the **tax-inclusive** total: its own worked example is a
$30 purchase with 25% VAT = $37.50, *"all fees calculated on the full $37.5"*
([fees](https://polar.sh/docs/merchant-of-record/fees)). Stripe states the same for Managed Payments —
the 3.5% *"covers the transaction amount including indirect taxes like VAT"*
([pricing](https://support.stripe.com/questions/managed-payments-pricing)). Treat that as the norm and
assume list price is tax-exclusive with VAT added at checkout.

A €9 pack sold to a German consumer (19% VAT) ⇒ buyer pays **€10.71**; fee base €10.71.
USD fixed fees converted at ≈ $1.08/€ (so $0.50 ≈ €0.46). Percentages below are **of the €9 net**:

| Provider | Fee on a €9 pack | Seller keeps | Effective take |
|---|---|---|---|
| Stripe Managed Payments (EEA card) | 5% × 10.71 + €0.25 = **€0.79** | €8.21 | **8.8%** |
| Paddle (if they'd take a sub-$10 product) | 5% × 10.71 + €0.46 = **€1.00** | €8.00 | **11.1%** |
| Polar Pro ($20/mo) | 5.3% × 10.71 + €0.37 = **€0.94** | €8.06 | 10.4% + $20/mo fixed |
| **Polar Starter** | 6.5% × 10.71 + €0.46 = **€1.16** | **€7.84** | **12.9%** |
| Lemon Squeezy | 6.5% × 10.71 + €0.46 = **€1.16** | €7.84 | 12.9% |

Same exercise on a **€19/month subscription** (buyer pays €22.61):

| Provider | Fee | Effective take of €19 |
|---|---|---|
| Stripe Managed Payments (EEA card) | €1.38 (+ Stripe Billing fee) | ~7.3%+ |
| Paddle | €1.59 | 8.4% |
| Polar Starter | €1.93 | 10.2% |
| Lemon Squeezy (incl. +0.5% subs) | €2.04 | 10.7% |

**Reading of the numbers.** The spread between the recommended option and the cheapest is ~4 percentage
points ≈ **€20/month at €500/month revenue** — less than one hour of build time, and far less than the
cost of building license/entitlement infrastructure that Polar ships for free. Polar's own published
breakeven for upgrading to Pro is **~$1,379/month in sales**
([fees](https://polar.sh/docs/merchant-of-record/fees)), so stay on Starter until then.

**Note the 2026 Polar repricing:** Polar's old headline was 4% + 40¢. Organizations created **before
May 27, 2026** keep it as "Early Member"; anything created now starts on Starter at 5% + 50¢. So Polar
no longer has a fee advantage over Paddle/Lemon Squeezy at the free tier — it wins on capability, not price.

---

## 3. One-time purchases *and* subscriptions in one account

- **Polar** — explicitly one model: *"Subscriptions and one-time purchases are both products in Polar —
  same API, same data model, just different pricing and billing logic."* Supports one-time,
  recurring (daily→yearly and custom intervals), pay-what-you-want, free, **usage-based/metered**, and
  seat-based pricing. Each pricing model is a separate product rather than a variant, so monthly and
  yearly plans are two products presented together at checkout.
  ([products](https://polar.sh/docs/features/products))
- **Paddle** — one-time transactions and subscriptions both first-class in Paddle Billing.
  ([webhook events](https://developer.paddle.com/webhooks/signature-verification) list both
  `transaction.*` and `subscription.*`)
- **Lemon Squeezy** — both, but subscription payments carry the extra +0.5% and are limited to
  *"cards, Apple Pay, Google Pay and PayPal"*
  ([payment methods](https://docs.lemonsqueezy.com/help/checkout/payment-methods)).
- **Stripe Managed Payments** — one-time via Checkout/Payment Links; subscriptions only *"available with
  [Billing](https://docs.stripe.com/billing)"*, and **subscriptions cannot be created outside Checkout or
  Payment Links**. ([overview](https://docs.stripe.com/payments/managed-payments))

Polar's metered/usage billing is a bonus worth noting: if credit consumption ever needs to become
metered rather than pack-based, the primitive already exists in the same account.

---

## 4. Server-side verification: webhooks, license keys, tokens

This is where the field separates.

### Polar — best fit

- **License keys are a built-in benefit.** On purchase or subscription the customer *"automatically
  receive[s] a unique license key"*. Features: brandable prefixes (`MYAPP_<UUID4>`), automatic expiry,
  key rotation preserving usage/limits/activations, optional **activation limits** (per device/IP),
  **usage quotas per key**, and automatic revocation when a subscription is cancelled.
  ([license keys](https://polar.sh/docs/features/benefits/license-keys))
- **Two public endpoints the backend can call:**
  - `POST /v1/customer-portal/license-keys/activate` — body `key`, `organization_id`, `label`;
    optional `conditions`, `meta`. Only needed when activation limits are on.
  - `POST /v1/customer-portal/license-keys/validate` — body `key`, `organization_id`; optional
    `activation_id`, `conditions`, `increment_usage`.
  Both return the full license-key record (usage, limits, validations, expiry). `organization_id` is
  required specifically to prevent cross-organization key misuse.
- **Webhooks** follow the **Standard Webhooks** spec with a shared secret you set or generate;
  official SDKs ship signature validation and fully typed payloads. Delivery formats: raw JSON,
  Discord, Slack. There is a **sandbox environment** and a CLI that tunnels webhooks to localhost.
  ([webhook endpoints](https://polar.sh/docs/integrate/webhooks/endpoints))
- **Events available:** `order.created`, `order.paid`, `checkout.updated`; the full
  `subscription.created / active / cycled / updated / canceled / revoked / past_due / paused / resumed`
  set; and `benefit_grant.created / updated / revoked` — the last of these is the "entitlement changed"
  signal for gating. ([webhook events](https://polar.sh/docs/integrate/webhooks/events))
- **Identity linking:** a checkout session accepts `external_customer_id` (your own user id) plus
  ad-hoc `prices`; when `external_customer_id` is set the customer's email is pre-filled and locked on
  the checkout page. The API returns a URL to redirect to.
  ([checkout session](https://polar.sh/docs/features/checkout/session))

### Paddle — you build it yourself

Paddle Billing **removed** the licensing features Paddle Classic had. The migration matrix lists, under
*Provisioning and fulfillment*: **"Product delivery by Paddle" — not supported**, and **"License key
generation and activation" — not supported**, with the note that *"Paddle-led fulfillment — including
product delivery and license key generation — has been deprecated"*; the replacement is
*"webhooks, a unified event stream, and comprehensive documentation that you can use to build your own
fulfillment workflows."* ([feature comparison](https://developer.paddle.com/migrate/paddle-classic/features))

Webhook security is solid: HMAC-SHA256 over `ts:rawBody`, delivered in a `Paddle-Signature` header
carrying `ts` and `h1`; official Node/Go/PHP/Python SDKs verify with a 5-second default timestamp
tolerance. ([signature verification](https://developer.paddle.com/webhooks/signature-verification))

### Lemon Squeezy — capable, but on a sunsetting platform

The official JS SDK exposes `activateLicense`, `validateLicense`, `deactivateLicense`, `getLicenseKey`,
`listLicenseKeys`, `updateLicenseKey`, `getLicenseKeyInstance`, `listLicenseKeyInstances`, plus webhook
CRUD. ([lmsqueezy/lemonsqueezy.js](https://github.com/lmsqueezy/lemonsqueezy.js))

### Stripe Managed Payments — no licensing layer

Standard Stripe webhooks and API, which are excellent, but nothing equivalent to license keys; you build
entitlement yourself. Integration surface is deliberately narrow — Checkout and Payment Links only.
**Elements and other advanced integrations are not supported**, and **custom domains are not supported
for Managed Payments checkout**.
([overview](https://docs.stripe.com/payments/managed-payments) ·
[how it works](https://docs.stripe.com/payments/managed-payments/how-it-works))

---

## 5. EU / Germany specifics

### 5.1 Who is the seller of record, and which entity contracts with *you*

| Provider | MoR entity facing the buyer | Contracting entity facing a German seller |
|---|---|---|
| Polar | Polar, as *"reseller of your digital goods & services"* | **Polar Software, Inc.**, 3500 South DuPont Highway, Dover, DE 19901 (**US**) |
| Paddle | Paddle, *"acts as a reseller of your product, and is, therefore, the 'seller on record'"* | **Paddle Payments Ltd. (Ireland)** for non-US sellers **registered for VAT in the EU**; **Paddle.com Market Ltd. (UK)** for all other sellers; Paddle.com Inc. (US) for US-facing sales |
| Lemon Squeezy | Lemon Squeezy (US) | US |
| Stripe Managed Payments | **Link** — the buyer sees Link as merchant of record, purchases labelled *"Sold through Link"*, statement descriptor `LINK.COM* [your descriptor]`; acquiring by *Stripe Payments Company* or *Stripe Technology Europe, Limited* | not stated in the docs — **open question** |

Sources: [Polar MoR](https://polar.sh/docs/merchant-of-record/introduction) and
[Polar legal](https://polar.sh/legal) · [Paddle terms](https://www.paddle.com/legal/terms) and
[why Paddle can take on VAT](https://www.paddle.com/help/start/intro-to-paddle/how-paddle-is-able-to-take-on-your-vat-and-tax-responsibilities) ·
[Managed Payments how it works](https://docs.stripe.com/payments/managed-payments/how-it-works).

**Why the entity's country matters here.** Under a MoR arrangement you are not selling to the end
customer; you are supplying a service to the MoR, who resells. For a German seller:

- **US MoR (Polar, Lemon Squeezy):** the place of supply for a B2B service follows the recipient
  (§ 3a Abs. 2 UStG) — it lands in the US, outside German VAT, with no EU recapitulative statement
  (*Zusammenfassende Meldung*, § 18a UStG) to file.
- **EU MoR (Paddle Payments Ltd, Ireland — which is what you get *if you are EU-VAT-registered*):** an
  intra-EU B2B service under reverse charge, which normally means you need a **USt-IdNr.** and must file
  a **ZM**. That is real recurring paperwork for a side business.
- **Stripe Managed Payments:** the docs do not name the entity that contracts with an EU seller, so the
  ZM question is unresolved. Treat as a risk, not a defect.

⚠️ This paragraph is a reading of the statute, not tax advice — **confirm with a Steuerberater before
launch.** § 19 UStG is quoted below precisely so the question can be put concretely.

### 5.2 VAT handling by the MoR

- **Polar:** *"We are liable for all of the above as your reseller, i.e. we have to worry about it vs.
  you."* Polar is registered in jurisdictions worldwide and works with accounting firms to monitor
  thresholds, register in new markets, and handle filings and remittance. Two stated trade-offs: sales
  tax gets added for more of your customers than if you sold direct, and **you cannot leverage inbound
  VAT towards VAT expense deductions yourself**. You remain responsible for *"your own income/revenue
  tax in your country of residency."* ([tax](https://polar.sh/docs/merchant-of-record/tax))
- **Paddle:** registered in 100+ jurisdictions; calculates, charges and remits VAT/GST/US sales tax, and
  issues compliant invoices to buyers, including EU B2B reverse-charge invoices when the buyer supplies
  a VAT ID. ([how Paddle handles VAT](https://www.paddle.com/help/sell/tax/how-paddle-handles-vat-on-your-behalf))
- **Stripe Managed Payments:** handles indirect-tax compliance (sales tax / VAT / GST) in **80+
  countries**, calculating, collecting, filing and remitting; where a country is not covered, the
  obligation stays with you and Stripe Tax is available at no extra cost. Stripe always emails receipts
  and invoices (PDF attached) to the buyer directly, from Link.
  ([how it works](https://docs.stripe.com/payments/managed-payments/how-it-works))

### 5.3 Kleinunternehmer (§ 19 UStG) compatibility

Current thresholds, quoted from the statute: a business qualifies where *"der Gesamtumsatz nach Absatz 2
im vorangegangenen Kalenderjahr **25 000 Euro** nicht überschritten hat und im laufenden Kalenderjahr
**100 000 Euro** nicht überschreitet"* ([§ 19 UStG](https://www.gesetze-im-internet.de/ustg_1980/__19.html)).

Practical consequence for this project: with a **US-based MoR**, the Kleinunternehmer status is
essentially undisturbed — no German VAT is charged on your supply to the MoR, no ZM, and the MoR
handles all consumer VAT worldwide. Choosing Paddle would push you toward EU-VAT registration
(their Irish entity applies precisely *when you are EU-VAT-registered*), i.e. toward the paperwork
Kleinunternehmer status exists to avoid. This is a second, independent reason to prefer Polar over
Paddle at this scale. Again: verify with a tax advisor.

### 5.4 Payouts to a German bank account

- **Polar:** payouts run on **Stripe Connect Express**, and **Germany is listed as a supported country**.
  Individuals can sell — *"Yes, given that Stripe Connect Express supports individual as a business type
  in your region"* — verified via Stripe's country/business-type matrix (platform country US, dashboard
  type express, service agreement recipient, capability transfers).
  ([supported countries](https://polar.sh/docs/merchant-of-record/supported-countries))
  A connected payout account is mandatory (*"Polar can't accept money on your behalf"* without one), and
  Stripe requires the bank account to be **in the same country as the registered business and in that
  country's local currency** — Wise/Payoneer/Revolut virtual accounts generally do not qualify.
  ([payout accounts](https://polar.sh/docs/finance/accounts)) Minimum withdrawal is whatever Stripe's
  per-currency minimum is; anything below stays on the balance until the next payout, and Polar may
  trigger a payout for you if a balance sits unwithdrawn for months.
  ([payouts](https://polar.sh/docs/features/finance/payouts))
- **Paddle:** paid monthly, *"on or before the 15th of the following month"*, and **only once the accrued
  Supplier Fee exceeds $100 / €100 / £100**. Local ACH is free; **international bank transfer costs $15**.
  ([terms](https://www.paddle.com/legal/terms)) At €50–200/month of revenue this means money sits
  unpaid for months — a genuine drawback for a small launch.
- **Lemon Squeezy:** payouts on the 1st and 15th, **$50 minimum**, small method/region-dependent fee.
  ([getting paid](https://docs.lemonsqueezy.com/help/getting-started/getting-paid))
- **Stripe Managed Payments:** standard Stripe payouts; Germany is a supported business location (below).

---

## 6. Buyer experience: accounts and checkout embedding

| Provider | Buyer needs an account? | Checkout |
|---|---|---|
| **Polar** | No. Customers authenticate to the portal *"with the email address they used to purchase … Polar emails them a one-time code"*, or you hand them a **pre-authenticated link** generated from your app and skip that step. Portal shows subscriptions, purchase history, **license keys**, downloads, and lets them **download and edit invoices**. | **Both**: embedded checkout on your own domain (snippet or JS library; after payment *"the checkout sends your page a message carrying a session token for your customer"*), or a hosted redirect link. Apple Pay / Google Pay appear automatically; embedded checkouts need manual domain validation for wallets. ([embed](https://polar.sh/docs/features/checkout/embed) · [customer portal](https://polar.sh/docs/features/customer-portal)) |
| **Paddle** | No account required to buy. | Paddle.js overlay/inline checkout on an **approved domain** (domain review is part of onboarding). |
| **Lemon Squeezy** | No. | Hosted checkout + overlay. |
| **Stripe Managed Payments** | Guests can buy, but the order-management tools live on link.com and guests are *"prompted to create an account"* to use them. **Buyers see Link as the merchant**, receipts come from Link, statement shows `LINK.COM*`. | Stripe Checkout or Payment Links only; **custom domains not supported**; Elements/advanced integrations not supported. |

For a developer-tool audience the Link-branded checkout is the sharpest edge on Stripe Managed
Payments: the buyer's card statement and receipt say Link, not your product.

---

## 7. Risk notes

**Lemon Squeezy — the acquisition question (the ticket's specific ask).**
Stripe acquired Lemon Squeezy in **July 2024** ([Stripe acquires Lemon Squeezy](https://www.lemonsqueezy.com/blog/stripe-acquires-lemon-squeezy),
[TechCrunch](https://techcrunch.com/2024/07/26/stripe-acquires-payment-processing-startup-lemon-squeezy/)).
Current state as of 2026-08:
- Lemon Squeezy **still operates** with its own dashboard, API and MoR model, **still accepts new
  signups**, and is even running a migration promotion (0% fees for the first 30 days —
  [migration offer](https://www.lemonsqueezy.com/migration-offer)). Pricing has not changed since the
  acquisition.
- **No shutdown date has been announced.**
- But the direction is unambiguous: the Lemon Squeezy team is building **Stripe Managed Payments**, and
  the official post *"2026 Update: Lemon Squeezy + Stripe Managed Payments"* (2026-01-28,
  https://www.lemonsqueezy.com/blog/2026-update) describes building migration paths from Lemon Squeezy
  to SMP; Stripe Managed Payments entered public preview in February 2026 and is now documented as a
  live product.
- **Assessment: do not start a new integration on Lemon Squeezy in 2026.** You would be building on a
  platform whose own team is building its replacement — an eventual forced migration with no feature or
  price advantage over Polar today.

**Polar risks.**
- Young company, and it **has already repriced once**: the 4% + 40¢ headline became 5% + 50¢ for
  organizations created after **2026-05-27**, with older orgs grandfathered. Assume terms can change
  again; keep the integration replaceable.
- Payouts depend on Stripe Connect Express — a Stripe-side account problem is a Polar-side payout problem.
- Fees are non-refundable on refunded orders (*"credit card networks and PSPs charge them regardless"*),
  and Polar may itself issue refunds within 60 days to head off chargebacks; **$15 per dispute**.
  ([fees](https://polar.sh/docs/merchant-of-record/fees))
- You cannot deduct inbound VAT on the sales side ([tax](https://polar.sh/docs/merchant-of-record/tax)).

**Paddle risks.** Verification is a gate, not a formality: **domain review**, **business verification**
(*"not required for individuals or sole traders"*), and **identity verification** before Paddle will act
as MoR ([account verification](https://www.paddle.com/help/start/account-verification/what-is-account-verification)).
Combined with "contact us for custom pricing" on sub-$10 products and a €100 payout floor, Paddle is
built for companies with a sales motion, not for €9 credit packs.

**Stripe Managed Payments risks/limits.** Access is decided by *"an eligibility assessment considering
factors such as business type and region"*; Connect platforms, Express accounts and platform-controlled
accounts are excluded. Products must be digital and **fully automated** (anything with human
involvement, e.g. 1:1 coaching, is out) and must carry an approved Stripe **product tax code** — for
this product that would be one of the SaaS or AIaaS codes (e.g. `txcd_10103001` SaaS business use, or
`txcd_10105002` AIaaS cloud-based business use). Supported seller locations include **DE** (full list:
CA, US; AT BE BG CH CY CZ **DE** DK EE ES FI FR GB GI GR HR HU IE IT LI LT LU LV MT NL NO PL PT RO SE SI
SK; AU HK JP SG). Buyers from 195+ countries except a restricted list (China, Cuba, Iran, North Korea,
Russia, Syria, Kosovo, Ascension, Tristan da Cunha). Ongoing eligibility requires a low dispute rate,
and **Stripe may refund a transaction without your consent if you don't respond to an escalation within
48 hours**. ([eligibility](https://docs.stripe.com/payments/managed-payments/eligibility) ·
[how it works](https://docs.stripe.com/payments/managed-payments/how-it-works))

**Other newer alternatives.** Creem, Dodo Payments and Fungies market themselves aggressively as
"MoR for indie devs" and dominate the search results for every query in this space — note that almost
all comparison articles found during this research were published *by* those vendors and are marketing,
not analysis. None was verified against primary sources here, none is more established than Polar, and
none offers a capability Polar lacks. **The only newer alternative that genuinely matters is Stripe
Managed Payments**, covered above.

---

## 8. Source-quality caveat

`lemonsqueezy.com` and `docs.lemonsqueezy.com` return **HTTP 403** to the research tooling, so the
Lemon Squeezy fee, payout and status facts above could not be read directly off the page. They are
sourced from search excerpts *of those official pages* (URLs cited inline) rather than from third-party
write-ups, but they carry one extra hop of uncertainty. **Re-verify by hand in a browser** if Lemon
Squeezy ever becomes a serious candidate again — which, per §7, it should not.

Everything else in this document was fetched directly from the vendor's own docs, pricing page, legal
terms, or (for § 19 UStG) gesetze-im-internet.de.

---

## 9. Integration sketch for `oraplanviz-cloud` (Polar)

Design principle: **Polar is the source of truth for money; our backend is the source of truth for
entitlement.** Never let a client-held Polar artifact be the thing that grants access.

### 9.1 Purchase → credit

```
browser                    oraplanviz-cloud                Polar
   │  POST /billing/checkout   │
   ├──────────────────────────►│  POST /v1/checkouts
   │                           ├───────────────────────────►│
   │                           │   { products:[pack_9],
   │                           │     external_customer_id: <our user id>,
   │                           │     metadata: { user_id, pack_sku } }
   │                           │◄───────────────────────────┤ { url }
   │◄──────────────────────────┤ { url }
   │  embed or redirect ─────────────────────────────────► │ checkout
   │                           │◄──── webhook order.paid ───┤
   │                           │  verify Standard Webhooks signature
   │                           │  idempotent on event id + order id
   │                           │  ledger: +N credits for metadata.user_id
```

- Use `external_customer_id` = our user id so Polar's customer and ours are permanently joined
  (it also pre-fills and locks the email at checkout).
- Put `user_id` and the pack SKU in checkout `metadata` so `order.paid` is self-describing.
- **Idempotency is mandatory**: store the processed webhook event id and the order id; a redelivery must
  be a no-op. Credits are appended to a ledger (order id as the natural key), never a mutable counter.
- Add a **reconciliation job**: on boot and on a timer, list recent Polar orders via the API and replay
  anything missing. Webhooks alone are not a durable ledger.

### 9.2 Subscription → entitlement

Subscribe to `subscription.created / active / cycled / updated / canceled / revoked / past_due /
paused / resumed`, and to `benefit_grant.created / updated / revoked`. Maintain one row per user:
`plan`, `status`, `current_period_end`. Gate paid features on that row, not on a webhook arriving on
time. `subscription.cycled` is the monthly credit-refill trigger for the subscription tier.

### 9.3 Token issuance and backend validation

1. On first sign-in (or right after `order.paid` for an anonymous purchase), the backend mints an
   **opaque API token** — random 32 bytes, prefix `opv_`, stored **hashed** (SHA-256), shown once.
2. The browser app stores the token locally and sends it as `Authorization: Bearer opv_…`.
3. On each AI request the backend: hashes the token → looks up the account → checks subscription status
   and/or debits the credit ledger inside the same transaction as the job record. **No call to Polar on
   the request path** — the token is validated locally, so Polar's availability never gates inference.
4. Token rotation and revocation are ours; a refunded or charged-back order (`order.refunded`,
   dispute events) reverses the ledger entry and can invalidate the token.

### 9.4 Where Polar license keys fit

Attach a license-key benefit to the products anyway, and use it for exactly one thing: the **offline /
self-hosted companion path** if it ever returns (see the map's "Companion & BYO return path"). A
companion binary that cannot hold our session can call
`POST /v1/customer-portal/license-keys/validate` with `key` + `organization_id` (plus `increment_usage`
for quota-metered use, and `activate` first when activation limits are on). For the hosted web path,
prefer our own token — it is cheaper, faster, revocable by us, and does not couple the request path to
Polar's uptime.

### 9.5 Keeping the exit open

Confine everything Polar-specific to one module (checkout-session creation, webhook verification, event
→ ledger mapping). Everything upstream speaks our own `Order`, `Entitlement` and `CreditLedgerEntry`
types. If fees, terms or the Stripe Managed Payments trajectory ever make a move worthwhile, the
migration is one adapter plus a customer-id backfill.

### 9.6 Build order

1. Polar **sandbox** org + products (credit packs as one-time products, subscription as its own product).
2. Webhook endpoint with signature verification + idempotency; drive it with the **Polar CLI tunnel**.
3. Credit ledger + entitlement row + token mint/validate.
4. Embedded checkout in the app; portal link (pre-authenticated) for invoices and subscription management.
5. Reconciliation job.
6. Only then: live org, Stripe Connect Express onboarding with the German bank account, and the tax
   advisor conversation from §5.3.

---

## Sources

All accessed 2026-08-25.

**Polar** — [Merchant of record intro](https://polar.sh/docs/merchant-of-record/introduction) ·
[Fees](https://polar.sh/docs/merchant-of-record/fees) ·
[Tax](https://polar.sh/docs/merchant-of-record/tax) ·
[Supported countries](https://polar.sh/docs/merchant-of-record/supported-countries) ·
[Payout accounts](https://polar.sh/docs/finance/accounts) ·
[Payouts](https://polar.sh/docs/features/finance/payouts) ·
[Products](https://polar.sh/docs/features/products) ·
[License keys](https://polar.sh/docs/features/benefits/license-keys) ·
[Checkout embed](https://polar.sh/docs/features/checkout/embed) ·
[Checkout session](https://polar.sh/docs/features/checkout/session) ·
[Customer portal](https://polar.sh/docs/features/customer-portal) ·
[Webhook endpoints](https://polar.sh/docs/integrate/webhooks/endpoints) ·
[Webhook events](https://polar.sh/docs/integrate/webhooks/events) ·
[Legal](https://polar.sh/legal)

**Paddle** — [Pricing](https://www.paddle.com/pricing) ·
[Seller terms](https://www.paddle.com/legal/terms) ·
[Account verification](https://www.paddle.com/help/start/account-verification/what-is-account-verification) ·
[How Paddle takes on VAT](https://www.paddle.com/help/start/intro-to-paddle/how-paddle-is-able-to-take-on-your-vat-and-tax-responsibilities) ·
[How Paddle handles VAT](https://www.paddle.com/help/sell/tax/how-paddle-handles-vat-on-your-behalf) ·
[Paddle Classic → Billing feature comparison](https://developer.paddle.com/migrate/paddle-classic/features) ·
[Webhook signature verification](https://developer.paddle.com/webhooks/signature-verification)

**Lemon Squeezy** (403 to automated fetch — see §8) —
[Fees](https://docs.lemonsqueezy.com/help/getting-started/fees) ·
[Getting paid](https://docs.lemonsqueezy.com/help/getting-started/getting-paid) ·
[Payment methods](https://docs.lemonsqueezy.com/help/checkout/payment-methods) ·
[Stripe acquires Lemon Squeezy](https://www.lemonsqueezy.com/blog/stripe-acquires-lemon-squeezy) ·
[2026 update](https://www.lemonsqueezy.com/blog/2026-update) ·
[Migration offer](https://www.lemonsqueezy.com/migration-offer) ·
[lemonsqueezy.js SDK](https://github.com/lmsqueezy/lemonsqueezy.js)

**Stripe** — [Managed Payments overview](https://docs.stripe.com/payments/managed-payments) ·
[How it works](https://docs.stripe.com/payments/managed-payments/how-it-works) ·
[Eligibility](https://docs.stripe.com/payments/managed-payments/eligibility) ·
[Managed Payments pricing](https://support.stripe.com/questions/managed-payments-pricing) ·
[Stripe DE pricing](https://stripe.com/de/pricing) ·
[stripe.com/managed-payments](https://stripe.com/managed-payments)

**German law** — [§ 19 UStG](https://www.gesetze-im-internet.de/ustg_1980/__19.html)

**Press** — [TechCrunch: Stripe acquires Lemon Squeezy (2024-07-26)](https://techcrunch.com/2024/07/26/stripe-acquires-payment-processing-startup-lemon-squeezy/)
