---
title: Non-expert analysis report design
labels: [wayfinder:prototype]
status: open
assignee: davidbudac
blocked-by: []
---

## Question

What does the AI analysis report look like for a **non-expert** — the free teaser that must both genuinely help and sell the builder?

Prototype (skill `mattpocock-skills:prototype`): a static mock of the `AiReportView` rendered with realistic content from one of the bundled example plans. Questions the prototype must force answers to:

- settled input from [Credit and subscription packaging](02-credit-and-subscription-packaging.md): the teaser report **must include a locked preview of the Builder output** (grayed fidelity meter, "your repro would be Level N") — not a bare CTA; funnel is teaser → ¼-credit deep analysis → 1-credit test case;
- structure for someone who can't read a plan: verdict-first ("your query is slow because…"), plain-language findings, severity, "what to do next" actions;
- how findings link to plan nodes (the existing `NodeRefV1` navigation) without assuming plan-reading skill;
- where the deterministic advisor findings appear vs the AI's additions (they must not contradict; who wins?);
- the upsell seam: where "build a reproducible test case" appears in a teaser report without feeling like an ad;
- streaming presentation (text streams in; structured findings appear at the end).

Link the prototype as an asset; resolution = the agreed report anatomy for the spec.

## Prototype (asset — awaiting user reaction, 2026-08-26)

Built and verified in-app: dev-only tab **AI (proto)** (visible only in `npm run dev`), three variants in `src/components/views/prototype/` (uncommitted working-tree files; move to a throwaway branch once a winner is picked). Open `http://localhost:5173/?example=22` → AI (proto) tab; flip variants with the floating bar or `←`/`→` (also `?variant=A|B|C`):

- **A — The Memo**: single-column expert-report document; findings interleaved into the streaming narrative; actions checklist; builder card as closing recommendation.
- **B — The Triage Board**: ops console; left rail = ranked findings (Verified check vs AI insight chips), right pane = overview/finding detail with evidence tiles; builder card permanently docked.
- **C — The Guided Path**: numbered walkthrough (see what went wrong → fix stats → verify → *prove it before production*); the locked Builder **is Step 4**; foreshadows ticket 13.

All variants share: verdict-first banner, simulated streaming (prose streams, structured parts appear at end), plain-language node pills that jump to the Tree view, advisor-vs-AI source chips (deterministic never contradicted; AI labeled), F0–F3 fidelity meter with "you are here", quota chip (3 free), "Go deeper · ¼ credit" pill. Mock content is hand-written for example *22 · Cardinality Trap (NL)*; `mockReport.ts` doubles as a draft report contract.
