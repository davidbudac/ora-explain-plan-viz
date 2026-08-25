# Unit economics of hosted analysis and Builder runs

Research findings for [ticket 01](../tickets/01-unit-economics.md).
Researched 2026-08-25. All prices USD, verified against live Anthropic docs on that date.

---

## 1. Method and confidence

| Input | Source | Confidence |
|---|---|---|
| Model prices, cache multipliers, batch discount | [platform.claude.com pricing](https://platform.claude.com/docs/en/about-claude/pricing) fetched 2026-08-25 | **High** — primary source, quoted verbatim below |
| Model IDs, context windows, effort support, retirement dates | [platform.claude.com models overview](https://platform.claude.com/docs/en/models/overview) fetched 2026-08-25 | **High** — primary source |
| Context section sizes | Measured directly from this repo (`src/examples/*.txt`, `src/examples/sample-metadata-bundle.json`) | **Medium-high** for plan/metadata; the renderers described in `docs/plans/ai-plan-analysis.md` §"Context construction" do not exist yet, so sizes are derived from the inputs they will render |
| Token counts | Char-count ÷ chars-per-token heuristic (see §3) | **Medium** — no API credentials were available in this environment to run `messages.count_tokens`. Ranges are given, not point estimates. **Re-baseline with `count_tokens` once the renderers exist** — this is the single largest source of error in every number below |
| Output-token sizes (incl. thinking) | Engineering judgement from the report shapes in the plan doc | **Low-medium** — the most volatile input; adaptive thinking is billed as output tokens |

Everything downstream of the token estimates should be read as **order-of-magnitude with a stated range**, not as a quote.

---

## 2. Verified current pricing (2026-08-25)

Per million tokens (MTok), Claude API first-party, global routing:

| Model | Model ID | Input | 5m cache write | 1h cache write | Cache read | Output | Context | Max output |
|---|---|---|---|---|---|---|---|---|
| Claude Fable 5 | `claude-fable-5` | $10 | $12.50 | $20 | $1.00 | $50 | 1M | 128K |
| Claude Opus 5 | `claude-opus-5` | $5 | $6.25 | $10 | $0.50 | $25 | 1M | 128K |
| Claude Opus 4.8 / 4.7 / 4.6 / 4.5 | `claude-opus-4-8` etc. | $5 | $6.25 | $10 | $0.50 | $25 | 1M | 128K |
| Claude Sonnet 5 | `claude-sonnet-5` | **$2** | $2.50 | $4 | $0.20 | **$10** | 1M | 128K |
| Claude Sonnet 4.6 | `claude-sonnet-4-6` | $3 | $3.75 | $6 | $0.30 | $15 | 1M | 128K |
| Claude Haiku 4.5 | `claude-haiku-4-5` | $1 | $1.25 | $2 | $0.10 | $5 | **200K** | 64K |

Facts that change the arithmetic and are easy to get wrong from memory:

- **Sonnet 5 is $2/$10 permanently.** The docs note that the launch "introductory" $2/$10 "is now the standard price. The previously scheduled increase to $3/$15 per million input/output tokens on September 1, 2026 will not occur." Sonnet 5 is therefore *cheaper than Sonnet 4.6* and only 2× Haiku 4.5 on input, 2× on output.
- **Cache multipliers**: 5m write = 1.25× input, 1h write = 2× input, read = 0.1× input. "Caching pays off after one cache read for the 5-minute duration, or after two cache reads for the 1-hour duration."
- **Batch API = 50% off input and output**, stacks with caching. Not available for interactive streaming (so: evals yes, product runs no).
- **Long context is not premium.** "Claude 4.6 and later models include the full 1M token context window at standard pricing" — a 900k request is billed at the same rate as a 9k one. No cliff to design around.
- **Tokenizer change**: "Claude 4.7 and later models use a newer tokenizer… approximately 30% more tokens for the same text. Claude Sonnet 4.6 and earlier models use the previous tokenizer." Opus 5 and Sonnet 5 use the *new* (more tokens) tokenizer; Haiku 4.5 uses the old one. Haiku's effective discount vs Sonnet 5 is therefore larger than the sticker 2× — roughly 2.5–2.6× on the same text.
- **`inference_geo: "us"` costs 1.1×.** Relevant only if EU/US data-residency pinning is ever promised; global (default) is standard price.
- **Haiku 4.5 retires "not sooner than October 15, 2026"** — ~7 weeks after this research. It also has **no effort parameter** and only a 200K context. See §6.

---

## 3. Context sizes measured from this repo

### 3.1 Plan table (always included)

Measured from `src/examples/`:

| Plan class | Rows | Measured row width | Rendered table |
|---|---|---|---|
| Small DBMS_XPLAN (`01`, `19`, `20`, `02`) | 5–11 | ~105 chars/row | ~0.6–1.2 KB |
| Median SQL Monitor (`06`, `15`, `08`) | 12–26 | ~150 chars/row | ~2–4 KB |
| Large SQL Monitor (`18`, `10`, `24`) | 22–48 | ~211 chars/row | ~5–10 KB |

The plan-doc renderer adds columns (Starts, A-Self, memory, temp, reads), so use the wide end. Plan tables are pipe-delimited numerics, which tokenize *worse* than prose — assume **~3.5 chars/token**, not 4.

→ **Plan table: 0.3k (tiny) / 1.0k (median) / 3.0k (large) / 5k+ (pathological wide parallel plan) tokens.** This matches the ticket's stated ~1–4k band.

### 3.2 Optional sections

| Section | Measured basis | Token estimate |
|---|---|---|
| SQL text | `<sql_fulltext>` in the XML examples: 151–865 chars. Real-world reporting SQL is much larger | 0.1k typical, 0.5–2k for real ETL/report SQL, 5k+ outliers |
| Predicates | 20–80 predicate lines × ~80 chars | 0.5–2k |
| Derived signals + advisor summary | ~10 findings × ~200 chars | 0.3–0.8k |
| Notes / monitor & optimizer metadata / binds | XML `<report_parameters>`, optimizer env | 0.3–1.5k |
| ASH detail (`<activity_detail>` buckets) | The large monitor XMLs are 17–38 KB total, much of it activity samples | 0.5–4k |
| **Projected** metadata (predicate columns only, no DDL) | `sample-metadata-bundle.json`: 16 KB for 4 tables + 5 indexes; per-column JSON averages **198 chars**; per-table object 1.7–2.2 KB; per-index object ~0.6 KB | 1–4k for a 3–5 table plan; 6k+ for a 10-table star query |
| System prompt + output-schema instructions | Not written yet | 1.5–3k |

### 3.3 Full metadata bundle (Builder only) — the cost driver

The Builder needs the **unprojected** bundle for referenced objects, and Phase 6 adds v3 `histogram.endpoints` from `DBA_TAB_HISTOGRAMS` "capped at 254 buckets".

Extrapolating from the measured 198 chars/column and 1.7–2.2 KB/table:

| Bundle shape | Size | Tokens |
|---|---|---|
| 3 tables × ~10 predicate columns, no histograms | ~10 KB | ~3k |
| 5 tables × ~30 real columns + 8 indexes + DDL | ~45 KB | ~12k |
| 10-table star schema, all columns | ~90 KB | ~25k |
| **+ v3 histograms**: one 254-endpoint histogram ≈ 254 × ~60 chars ≈ **15 KB ≈ 4k tokens per column** | — | — |
| 5 tables × 3 histogram columns | +225 KB | **+60k tokens** |

**This is the finding that most affects Builder margin.** A naively-serialised v3 bundle can be 5× the size of everything else in the prompt combined, and at Opus prices 60k input tokens is $0.30 of pure input on every Builder call and every repair turn.

Mitigations to specify in the v2 spec (all deterministic, no model involved):

1. **Downsample histogram endpoints before they enter the prompt.** The *script* needs all 254 buckets, but the script is generated deterministically by `buildTestCaseScript()` — the model only needs the *shape* of the skew. Send ~20 representative endpoints plus min/max/mode and a "254 buckets, downsampled" marker.
2. **Compact encoding.** Emit endpoints as a CSV/tuple line, not per-endpoint JSON objects — cuts ~60 chars/endpoint to ~15.
3. **Histogram columns only for predicate columns**, never for the whole table.
4. **Hard character cap per section** with an explicit truncation marker — already required by the plan doc's `projectMetadata` contract; extend it to the full bundle.

With (1)+(2), the histogram contribution drops from ~60k tokens to ~3–5k. **All Builder numbers below assume the mitigated encoding**; the unmitigated case is shown separately in §5.4.

### 3.4 Output tokens (incl. thinking)

Adaptive thinking is billed at output rates. Effort level is therefore a direct cost lever ($25/MTok on Opus).

| Feature | Visible output | Thinking | Total output assumption |
|---|---|---|---|
| Teaser | ~600–1,200 tok (short, 3–5 findings) | low effort, minimal | **600 / 900 / 1,800** (low/typ/p90) |
| Paid analysis | 1.5–3k tok full report | high effort, 1.5–8k | **3,000 / 6,000 / 11,000** |
| Builder | 3–8k tok (scripts are long) | high/xhigh, 4–16k | **7,000 / 14,000 / 24,000** |
| Experiments | 2–4k tok (several scripts) | high, 2–10k | **4,000 / 8,000 / 14,000** |

---

## 4. Per-run token assumptions used in the cost matrix

| Feature | Sections | Input low / typ / p90 | Output low / typ / p90 |
|---|---|---|---|
| **Teaser analysis** | system + plan table + signals + advisor summary | 3,500 / **6,000** / 11,000 | 600 / **900** / 1,800 |
| **Paid analysis** | + SQL, predicates, notes, monitor meta, ASH, projected metadata | 9,000 / **18,000** / 38,000 | 3,000 / **6,000** / 11,000 |
| **Test-case build** (one call) | analyze sections + full mitigated bundle + deterministic skeleton | 14,000 / **35,000** / 90,000 | 7,000 / **14,000** / 24,000 |
| **Experiment proposal** | analyze sections + advisor findings + candidate list | 9,000 / **18,000** / 35,000 | 4,000 / **8,000** / 14,000 |

---

## 5. Cost-per-run matrix

Computed as `input × in_price + output × out_price`, no caching.

### 5.1 Teaser analysis

| Model | low | **typical** | p90 |
|---|---|---|---|
| Opus 5 | $0.0325 | **$0.0525** | $0.1000 |
| Sonnet 5 | $0.0130 | **$0.0210** | $0.0400 |
| Haiku 4.5 | $0.0065 | **$0.0105** | $0.0200 |
| Fable 5 | $0.0650 | $0.1050 | $0.2000 |

### 5.2 Paid analysis

| Model | low | **typical** | p90 |
|---|---|---|---|
| Opus 5 | $0.1200 | **$0.2400** | $0.4650 |
| Sonnet 5 | $0.0480 | **$0.0960** | $0.1860 |
| Haiku 4.5 | $0.0240 | $0.0480 | $0.0930 |
| Fable 5 | $0.2400 | $0.4800 | $0.9300 |

### 5.3 Test-case build (single call)

| Model | low | **typical** | p90 |
|---|---|---|---|
| Opus 5 | $0.2450 | **$0.5250** | $1.0500 |
| Sonnet 5 | $0.0980 | **$0.2100** | $0.4200 |
| Haiku 4.5 | $0.0490 | $0.1050 | $0.2100 |
| Fable 5 | $0.4900 | $1.0500 | $2.1000 |

### 5.4 Builder as a *flow*, not a call

A realistic Builder run is 1 generation + 0–2 repair turns (the plan doc's Layer-2 repro backtest implies a repair loop when the generated case doesn't reproduce the plan shape). Repair turns resend the bundle — **cache it** (5m write on turn 1, reads afterwards):

| Flow | Opus 5 | Sonnet 5 |
|---|---|---|
| Generate only | $0.5250 | $0.2100 |
| Generate + 1 repair (33k cached) | **$0.7165** | **$0.2866** |
| Generate + 2 repairs | $0.9080 | $0.3632 |
| Generate + 1 repair + experiment set | **$1.0065** | **$0.4026** |
| Generate + 1 repair, **unmitigated histograms** (+60k input/turn) | ~$1.32 | ~$0.53 |

The unmitigated-histogram row is why §3.3's mitigations belong in the spec, not in a backlog.

### 5.5 Experiment proposal

| Model | low | **typical** | p90 |
|---|---|---|---|
| Opus 5 | $0.1450 | **$0.2900** | $0.5250 |
| Sonnet 5 | $0.0580 | **$0.1160** | $0.2100 |
| Haiku 4.5 | $0.0290 | $0.0580 | $0.1050 |
| Fable 5 | $0.2900 | $0.5800 | $1.0500 |

### 5.6 Prompt caching — where it actually pays

Caching is a **prefix** match, and every run carries a *different plan*. So:

- **Single-shot teaser/analysis**: only the system prompt + output-schema instructions are stable. At a 2,500-token cached prefix that is a **~21% saving** on a typical teaser ($0.0210 → $0.0165 on Sonnet 5) — real but not decisive, and only when traffic keeps the 5m cache warm. At 10k teasers/month: $210 → $165.
  - Watch the minimum: the docs' cacheable prefix floor is ~1024 tokens. A short system prompt silently won't cache.
- **Builder repair loop and any future chat**: this is where caching earns its keep — 33k of resent bundle at 0.1× instead of 1×, saving ~$0.15/repair turn on Opus. **Design the Builder prompt so the bundle sits in the cached prefix and only the repair instruction varies.**
- **Evals harness**: same fixtures re-run on every prompt change → cache + Batch API's 50% together make Layer 3 nearly free (§7).

---

## 6. Recommended model per feature

The charter says "cheap/fast model for free teaser, top model for paid analysis + builder". Concretely:

| Feature | Recommendation | Effort | Rationale |
|---|---|---|---|
| **Free teaser analysis** | **`claude-sonnet-5`** | `low` (or `medium`) | $2/$10 makes it 2.5× cheaper than Opus 5 while keeping the 1M context, adaptive thinking **and effort control**. $0.021/run typical. |
| **Paid analysis** | **`claude-opus-5`** | `high` | $0.24/run typical is trivially covered by any sane credit price; analysis quality is what makes the Builder credible. |
| **Test-case build** | **`claude-opus-5`** | `high`, `xhigh` on retry | The flagship. Correctness (bind values consistent with predicates, skew-matching row generators) is exactly where Opus's margin over Sonnet shows, and the Repro Rate is the number being sold. $0.72/run typical incl. one repair. |
| **Experiment proposal** | **`claude-opus-5`** | `high` | Emitted alongside the Builder, same quality bar; $0.29/run. |
| **Eval judge (Layer 3)** | **`claude-opus-5`**, Batch API | `medium` | Judge must not be weaker than the thing judged; batch halves it (§7). |

### Why not Haiku 4.5 for the teaser (the obvious cheap choice)

Haiku is genuinely half the price of Sonnet 5 and ~2.5× cheaper on the same text (older tokenizer), at ~$0.0105/teaser. Three reasons it still loses:

1. **Retirement "not sooner than October 15, 2026"** — roughly 7 weeks out. Pinning the teaser to a model that may be retired before v1 ships is a self-inflicted migration.
2. **No `effort` parameter** (docs: "Default effort: Not supported") — the teaser's main cost lever on output tokens is unavailable, and 4.5-generation extended thinking with `budget_tokens` is a deprecated shape.
3. **200K context** — fine for the teaser, but it means the teaser and the paid path can't share one prompt/transport path unconditionally.

The absolute saving is $105/month at 10,000 teasers. That is not worth a second model generation in the stack. **Revisit only if teaser volume exceeds ~25k/month**, or when a current-generation Haiku ships.

### Why not Fable 5 anywhere

$10/$50 is 2× Opus 5 with no evidence — and no eval data yet — that it raises the Repro Rate. Revisit only if Layer 2/3 evals show Opus 5 plateauing below the Repro Rate the Builder needs to be sellable. Note also Fable 5 requires 30-day data retention, which is awkward against the Privacy Fence framing.

### Model-policy notes for the spec

- Pin **dateless snapshot IDs** (`claude-opus-5`, `claude-sonnet-5`) server-side, per tier, as the plan doc already says. Never let the client choose the model — it is the cost surface.
- The tokenizer difference means any migration to/from a 4.6-or-earlier model re-baselines every number here (~30% token swing). Budget for a re-measure, not a find-and-replace.
- `inference_geo` stays **unset** (global). If EU customers later demand US/EU pinning, every number above rises 1.1×.

---

## 7. Credit price floor for ≥70% gross margin

Floor = typical model cost ÷ 0.30. "Gross margin" here counts **model inference only** — merchant-of-record fees (~5%+€0.50/txn class), hosting, and Stripe-style FX are *not* included and are decided in tickets 02/03. Treat these as a hard floor, not a price.

| Credit definition | Model | Typical cost | **≥70% floor** | ≥80% floor |
|---|---|---|---|---|
| 1 paid analysis | Opus 5 | $0.240 | **$0.80** | $1.20 |
| 1 experiment set | Opus 5 | $0.290 | **$0.97** | $1.45 |
| 1 Builder run (generate only) | Opus 5 | $0.525 | **$1.75** | $2.63 |
| **1 Builder run incl. 1 repair** | Opus 5 | $0.717 | **$2.39** | $3.58 |
| **1 Builder run + repair + experiments** (the honest "one Builder credit") | Opus 5 | $1.007 | **$3.36** | $5.03 |
| Same, if Builder ran on Sonnet 5 | Sonnet 5 | $0.403 | $1.34 | $2.01 |

**Recommendation: price one Builder credit at $4–5.** That clears the 70% floor on the typical case *and* covers the p90 case (~$1.50 model cost → still ~65–70% margin at $4.50), which matters because credits are consumed one at a time and a p90 plan is exactly the plan a user is desperate enough to pay for.

Worked pack shapes at $4.50/credit:

| Pack | Price | Credits | Typical model cost | Worst-case (all p90 Builder) | Margin typ / worst |
|---|---|---|---|---|---|
| Starter | $19 | 4 | $4.03 | $6.0 | 79% / 68% |
| Standard | $39 | 10 | $10.07 | $15.0 | 74% / 62% |
| Pro | $89 | 25 | $25.16 | $37.5 | 72% / 58% |

Guardrails the packaging ticket (02) should inherit:
- **Meter what is actually billed.** Charge the credit on *completed* runs; a repair turn the user asked for is inside the credit, an unlimited repair loop is not — **cap repairs at 2 per credit**.
- **Cap max_tokens per feature** server-side. Output is 5× input price; an unbounded 128K response on Opus is $3.20 of output on its own.
- **Don't sell paid analysis as its own credit at 1:1 with the Builder.** At $0.24 vs $1.01 typical cost they are 4× apart; either weight them (analysis = ¼ credit) or fold analysis into the subscription and keep credits Builder-only.
- The **subscription** tier must carry a fair-use ceiling expressed in Builder runs, not "unlimited" — at $0.72–1.50/run, ~20 runs/month is already $15–30 of inference.

---

## 8. Free-teaser load cost

At the typical teaser (6,000 in / 900 out), no caching:

| Teasers/month | Sonnet 5 (**recommended**) | Haiku 4.5 | Opus 5 | Fable 5 |
|---|---|---|---|---|
| 500 | **$10.50** | $5.25 | $26.25 | $52.50 |
| 2,000 | **$42.00** | $21.00 | $105.00 | $210.00 |
| 10,000 | **$210.00** | $105.00 | $525.00 | $1,050.00 |

With a warm 2,500-token cached system prefix: 10,000 teasers on Sonnet 5 → **$165/month** (−21%).

**Abuse ceiling** (every run at p90 — the number to budget against, since abusive traffic is not average traffic): 10,000 p90 teasers on Sonnet 5 = **$400/month**; on Haiku = $200. This is the number the teaser-enforcement mechanics in the map's "Not yet specified" section have to hold down.

For a side-income product the honest read: **a free teaser is affordable up to roughly 2,000 runs/month (~$42, ~$80 worst case) on Sonnet 5 with no enforcement at all.** Beyond that it needs identity or a device/IP cap. Concretely, budget-safe defaults for v1:

- 3 teaser runs per account (not per anonymous device — anonymous teasers are the abuse vector).
- A global monthly spend circuit-breaker in oraplanviz-cloud (ticket 04) that degrades the teaser to "sign in to continue" rather than failing open.
- Reject teaser requests whose reviewed context exceeds a fixed token budget (e.g. 15k) — send the plan table only, truncate the rest. This bounds the p90 tail directly instead of hoping for it.

---

## 9. Evals harness cost (Phase 7 Layer 3)

Layer 3 is LLM-judged analysis quality over ~15 scenarios. Per scenario-run = one analysis (18k/6k) + one judge pass (12k/1.2k):

| Model | Per scenario-run | 15 scenarios × 3 runs | Same, **Batch API (−50%)** |
|---|---|---|---|
| Opus 5 | $0.330 | $14.85 | **$7.42** |
| Sonnet 5 | $0.132 | $5.94 | $2.97 |

Add prompt caching on the fixed scenario fixtures and a full regression sweep is **under $10 on Opus 5**. Cost is not a reason to weaken the eval gate — run Layer 3 on every prompt/model change. Layers 1 and 2 are free/DB-only.

---

## 10. Risks and open items

1. **Token estimates are unvalidated.** No API credentials in this environment. Once `renderPlanTable` / `projectMetadata` exist, run `messages.count_tokens` over the `src/examples/` corpus and replace §3–§4. Expect ±40%.
2. **Output tokens are the dominant, least-known term.** At Opus prices output is 5× input; thinking is billed as output and effort behaviour on real Builder prompts has never been measured. A single effort mis-setting can double Builder cost. **Measure effort low/medium/high/xhigh against the Repro Rate in Layer 2 before pricing is locked.**
3. **Histogram encoding** (§3.3) can 3× Builder input cost if it lands as naive per-endpoint JSON. This is a spec item.
4. **Haiku 4.5's Oct 2026 retirement** — if the packaging ticket wants the cheapest possible teaser anyway, check for a current-generation Haiku before committing.
5. **Margin here is inference-only.** MoR fees, VAT handling, hosting, and refunds come off the top; the 70% floors are a *lower* bound on price, and the real target should be closer to 80% inference margin so the all-in margin lands near 70%.
6. **Prices change.** Sonnet 5's scheduled increase was cancelled but the episode shows the risk. Store per-model prices as backend config, meter every run's real `usage` (including `cache_read_input_tokens`), and alert on cost-per-credit drift rather than trusting these tables.

---

## Sources

- Anthropic — Pricing: https://platform.claude.com/docs/en/about-claude/pricing (fetched 2026-08-25)
- Anthropic — Models overview: https://platform.claude.com/docs/en/models/overview (fetched 2026-08-25)
- This repo: `docs/plans/ai-plan-analysis.md` §"Context construction and minimization", §"Phase 5 — Hosted provider", §"Phase 6 — Test Case Builder", §"Phase 7 — Evaluation & backtesting harness"
- This repo: `src/examples/*.txt` (23 plan fixtures, measured), `src/examples/sample-metadata-bundle.json` (16 KB, 4 tables + 5 indexes, measured), `src/lib/metadata/bundle.ts`
- This repo: `docs/wayfinder/ai-plan-analysis/map.md` (charter), `CONTEXT.md` (glossary)
