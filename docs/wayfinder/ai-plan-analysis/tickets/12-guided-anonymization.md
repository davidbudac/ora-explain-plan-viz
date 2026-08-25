---
title: Guided anonymization (offline, pre-upload)
labels: [wayfinder:grilling]
status: open
assignee:
blocked-by: []
---

## Question

What does **guided anonymization** look like — a fully offline pass the developer runs *before anything is uploaded*, so plans from sensitive schemas can still use the AI features?

This deepens the "how redaction is offered" bullet of [Privacy fence and product framing](10-privacy-fence-and-product-framing.md) into a first-class feature. It runs entirely client-side (the core-app privacy promise applies to it — no backend involved), and its output is what the consent/review dialog then shows.

Decide with the user:

- **anonymization model**: deterministic client-side renaming of schemas/tables/columns/indexes/partitions to stable placeholders (`T1`, `T1.C3`, `IX_T1_1`…), applied *consistently* across plan text, SQL text, predicates, and the metadata bundle so the uploaded artifacts stay mutually coherent and analyzable;
- **what must survive untouched** for analysis quality: operation shapes, cardinalities, costs, stats, datatypes — and the hard case: **literals, binds, and histogram endpoint values are data**, not identifiers. Which get scrubbed by default, which get offered as opt-in keeps, and what the quality cost is (feeds [Evals harness v1 scope](07-evals-harness-v1-scope.md): the corpus needs anonymized variants to measure degradation);
- **"guided" UX**: the tool proposes the mapping, flags likely-sensitive tokens it can't classify (string literals in predicates, comments in SQL text, schema names that look like client names), and walks the dev through approve/rename/drop per item with a before/after preview — not a silent regex pass;
- **round-trip**: the mapping stays in localStorage/memory only; AI responses are de-anonymized back to real names before rendering, so the report reads naturally. What happens to `NodeRefV1` links and Builder scripts (Builder repros already use synthetic objects — likely free synergy);
- **placement**: where it lives in the flow (a step inside the consent/review dialog vs a standalone tool also usable without AI), and whether it's free for everyone (it's offline — charging for it would be odd, but confirm);
- **relation to the v1 plan's existing sanitization rules** — does guided anonymization replace them or layer on top?

Resolution = the anonymization model (what's renamed, scrubbed, kept), the guided-review UX rules, and the round-trip contract for the spec.
