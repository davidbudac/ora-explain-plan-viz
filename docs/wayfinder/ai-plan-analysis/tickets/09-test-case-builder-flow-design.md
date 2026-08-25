---
title: Test-case builder flow design
labels: [wayfinder:prototype]
status: open
assignee:
blocked-by: [05-repro-fidelity-ladder.md]
---

## Question

What is the end-to-end builder UX — from a loaded plan to a verified repro — for a non-expert, given the settled [repro fidelity ladder](05-repro-fidelity-ladder.md)?

Prototype the flow (mock, not implementation):

- the **fidelity meter**: how the UI shows the current level and exactly what attaching SQL text / running the gather script would unlock (the ladder made visible);
- the generate step: review dialog (charter: consent flow is mandatory) → credits notice → streamed build;
- the output surface: multi-script result (setup / stats / repro / experiments / verify), per-script copy/download, run-order guidance a non-expert can follow;
- the verification loop: "run this, paste the resulting DBMS_XPLAN back, we compare shape" — how plan-shape match/mismatch is presented and what a mismatch offers next;
- experiments: how alternative-plan candidates are presented and how the A/B lands in the existing Compare view.

Link the prototype as an asset; resolution = the flow spec (screens + states) for the rewrite.
