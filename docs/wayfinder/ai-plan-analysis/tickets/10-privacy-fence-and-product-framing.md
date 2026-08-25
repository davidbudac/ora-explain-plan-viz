---
title: Privacy fence and product framing
labels: [wayfinder:grilling]
status: open
assignee:
blocked-by: []
---

## Question

How is the fenced AI exception presented so the "no backend, nothing is uploaded" promise stays credible while a hosted paid tier exists?

Decide with the user:

- the boundary copy: how README/site/app describe "core = fully local, AI = explicit opt-in upload" without weasel words;
- the consent/review dialog's role as the fence (charter mandates it): what it must always show (destination, sections, counts) and whether "don't ask again" is ever allowed;
- data-handling statement for the hosted tier a non-lawyer can write honestly: no plan retention, metadata-only logs, Anthropic as subprocessor — and what is explicitly *not* claimed (no GDPR compliance claims, per the old plan);
- whether sensitive sections (SQL text, binds, metadata) keep the old plan's default-off stance even in the hosted flow, and how redaction is offered;
- account identity: what the account/token knows about the user (email? nothing but a key?).

Resolution = the fence rules + canonical copy blocks for the spec and README.
