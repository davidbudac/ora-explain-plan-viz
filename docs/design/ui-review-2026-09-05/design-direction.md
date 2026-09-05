# Design exploration — 5 September 2026

This folder contains a standalone mockup and review evidence. It is not wired into the application. No production implementation is proposed by the presence of HTML here.

## Direction before drawing

Keep the familiar analytical workbench. Give the execution tree most of the width, keep one evidence inspector, and bring the first useful finding into view. Retain expert controls through labeled menus.

- Canvas: #F3F6FA; panels: #FFFFFF; text: #17263C; secondary: #53647B; action/selection: #285BCC; warning: #9B5107.
- System sans-serif for navigation and explanations; system monospace for SQL, identifiers and aligned numeric values. Main UI text 13–14px, node headings 12–13px, secondary labels at least 12px before any graph scaling.
- Two compact navigation rows: document identity/actions, then views and canvas controls. Left-aligned labels. A one-line diagnostic summary sits below them.
- One right inspector switches between Overview and Operation without losing the overview. Filters are a temporary dialog. At narrow widths, inspector moves below the canvas; a production version should evaluate a drawer against this alternative.
- Keep Oracle operation IDs, object names, estimated/actual distinctions and Starts. Do not imply that a scan is inherently a problem or that a heuristic proves a root cause.

```text
Plan identity                         Load plan / Compare / Export
Tree  Table  SQL  More views           Search / Filters / Display
Start here: ORDERS returned 625× the estimated rows     Inspect
┌───────────────────────────────────┬──────────────────────────┐
│                                   │ Overview | Operation     │
│          Readable plan tree       │ Evidence, explanation,   │
│                                   │ next check, notes         │
└───────────────────────────────────┴──────────────────────────┘
```

## Brief check

A general dashboard with KPI cards would take space from the graph and duplicate the existing statistics. The chosen design instead spends its visual emphasis on a readable tree and an evidence-linked finding. A second toolbar costs vertical space; hiding the permanent filter panel and simplifying node contents earns useful space back. Preserve the existing focus mode for experienced users who prefer maximum canvas area.

## Mockup boundary

The HTML uses fixed data from the bundled Cardinality Trap example. It demonstrates tree selection, table and SQL views, search highlighting, a filter dialog, overview/operation switching, a note draft, light/dark appearance, and a start-screen concept. It does not parse files, connect to Oracle, export reports, run AI, or save notes. Those controls explain their intended flow. Node positions are a fixed illustration, not a replacement graph layout algorithm. Runtime timings are deliberately omitted from the compact tree; this exploration has not validated their source/aggregation semantics.
