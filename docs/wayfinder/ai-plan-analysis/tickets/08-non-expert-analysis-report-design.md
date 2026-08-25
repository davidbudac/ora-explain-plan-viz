---
title: Non-expert analysis report design
labels: [wayfinder:prototype]
status: open
assignee:
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
