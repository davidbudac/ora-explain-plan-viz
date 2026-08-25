---
title: Unit economics of hosted analysis and builder runs
labels: [wayfinder:research]
status: closed
assignee: research-agent
blocked-by: []
---

## Question

What does one hosted AI run actually cost, per feature, and which models should each feature use so the paid tiers carry healthy margin and the free teaser is affordable?

Ground in current Anthropic API pricing (verify against docs, don't recall). For each of: **free teaser analysis**, **paid analysis**, **test-case build**, **experiment proposal**, estimate input/output token ranges from this app's context builders (compact plan table ~1–4k tokens, plus opt-in sections: SQL text, predicates, metadata projection; builder adds full bundle + histogram endpoints — read `src/lib/metadata/` and `docs/plans/ai-plan-analysis.md` §"Context construction" for realistic sizes). Produce:

- cost-per-run matrix across candidate models (Sonnet-class vs Opus-class, current IDs and prices), including prompt-caching effects if applicable;
- a recommended model per feature (charter says tiered: cheap for teaser, top for paid);
- the price floor this implies per credit so a pack sells at ≥70% gross margin;
- monthly cost of a plausible free-teaser load (e.g. 500/2000/10000 teaser runs).

Findings → `../research/unit-economics.md`; resolve this ticket with the recommendation summary.

## Resolution

Full findings: [`../research/unit-economics.md`](../research/unit-economics.md). Pricing verified
against live Anthropic docs on 2026-08-25; token sizes measured from `src/examples/` and
`src/lib/metadata/`. Token counts are chars-per-token estimates (no API credentials available) —
re-baseline with `messages.count_tokens` once the renderers exist.

### Model per feature

| Feature | Model | Effort |
|---|---|---|
| Free teaser analysis | **`claude-sonnet-5`** ($2/$10 per MTok — the cancelled Sept increase means it is now cheaper than Sonnet 4.6) | `low` |
| Paid analysis | **`claude-opus-5`** ($5/$25) | `high` |
| Test-case build (the Builder) | **`claude-opus-5`** | `high`, `xhigh` on retry |
| Experiment proposal | **`claude-opus-5`** | `high` |
| Eval judge (Layer 3) | `claude-opus-5` via Batch API (−50%) | `medium` |

Haiku 4.5 is rejected for the teaser despite being 2.5× cheaper: it retires "not sooner than
October 15, 2026", has **no `effort` parameter**, and only a 200K context. The saving is $105/mo
at 10k teasers — not worth a second model generation. Revisit above ~25k teasers/month or when a
current-generation Haiku ships. Fable 5 ($10/$50) is rejected everywhere until evals show Opus 5
plateauing below a sellable Repro Rate.

### Cost matrix headline numbers (typical run, no caching)

| Feature | Sonnet 5 | Opus 5 |
|---|---|---|
| Teaser (6k in / 0.9k out) | **$0.021** | $0.053 |
| Paid analysis (18k / 6k) | $0.096 | **$0.240** |
| Builder, single call (35k / 14k) | $0.210 | **$0.525** |
| Builder + 1 repair (bundle cached) | $0.287 | **$0.717** |
| Builder + repair + experiments | $0.403 | **$1.007** |
| Experiments alone (18k / 8k) | $0.116 | **$0.290** |

p90 roughly doubles each figure (Builder + repair p90 ≈ $1.50 on Opus 5).

### Credit price floor

Inference-only floors (cost ÷ 0.30), MoR/VAT/hosting **not** included:

- 1 paid analysis (Opus 5) → **$0.80**
- 1 Builder run, generate only → **$1.75**
- 1 Builder run incl. 1 repair → **$2.39**
- **1 Builder credit = build + 1 repair + experiments → $3.36** (80% floor: $5.03)

**Recommendation: price one Builder credit at $4–5** (packs: $19/4, $39/10, $89/25 → 72–79%
inference margin typical, 58–68% worst case). Because real margin is ~70% only *after* merchant-of-
record fees, target ~80% inference margin. Do **not** sell paid analysis 1:1 with a Builder credit —
they are 4× apart in cost; weight analysis at ¼ credit or fold it into the subscription. Cap repairs
at 2 per credit and cap `max_tokens` server-side per feature (output is 5× input price).

### Teaser load costs (Sonnet 5, typical run)

| Runs/month | Cost | With warm cached system prefix | Abuse case (all p90) |
|---|---|---|---|
| 500 | $10.50 | $8.25 | $20 |
| 2,000 | $42.00 | $33.00 | $80 |
| 10,000 | $210.00 | $165.00 | $400 |

A free teaser is affordable to ~2,000 runs/month with no enforcement. Beyond that: 3 teasers per
**account** (anonymous teasers are the abuse vector), a global monthly spend circuit-breaker that
degrades to "sign in to continue" rather than failing open, and a hard 15k-token cap on teaser
context so the p90 tail is bounded by construction.

### Spec items this research generates

1. **Histogram encoding is a Builder cost driver.** A naive v3 `histogram.endpoints` serialisation
   (254 buckets × ~60 chars/endpoint ≈ 4k tokens *per column*) can add 60k input tokens per turn and
   3× Builder cost. The spec must require: downsampled endpoints (~20) for the model, compact
   tuple/CSV encoding, predicate columns only, and a hard per-section cap with a truncation marker.
   The deterministic script generator still uses all 254 buckets — only the *prompt* is downsampled.
2. **Design the Builder prompt so the bundle sits in the cached prefix**; caching saves ~$0.15 per
   repair turn on Opus and ~21% on single-shot teasers.
3. Pin dateless model IDs server-side per tier; never let the client choose the model. Leave
   `inference_geo` unset (US pinning is a flat 1.1×).
4. Meter real `usage` (incl. `cache_read_input_tokens`) per run and alert on cost-per-credit drift —
   these tables are a snapshot, not a contract.
5. Measure effort (low→xhigh) against the Repro Rate in evals Layer 2 **before** pricing is locked;
   output tokens are the dominant and least-known cost term.
