# Asset inventory — real app captures

All shots captured live from the running app in DARK theme at 3840×2160 (exact 16:9),
via `capture/capture-video-shots.mjs`. These are the canonical assets for the video.
Files live in `capture/assets/`.

| file | what it shows | best used for |
|------|----------------|----------------|
| `rawplan.png` | Plan Text view — dense DBMS_XPLAN ASCII pipe table (17 ops), the raw unreadable output | The "problem" beat. Crop to the ASCII table region (roughly left ~580px→1100px orig, top ~330→1200px). |
| `hero.png` | Hierarchical tree view, Star Schema Rollup, nothing selected. Red hotspot rings visible, filter panel left, hotspots panel right. Full app chrome incl. "Oracle Plan Visualizer" title. | Product/promise + "paste → tree blooms" beat. Good full-UI hero. |
| `tree.png` | Tree view, a mid-plan node selected showing predicates in the detail panel | Alt tree/detail beat if needed. |
| `hotspot.png` | Cardinality Trap plan, no selection, Hotspots summary panel ("Slowest Ops by self time") on the right; a node carries the red "Hotspot" badge/ring | Hotspot-detection beat. Zoom the ringed node + the Slowest Ops panel. |
| `cardinality.png` | NESTED LOOPS node selected; detail panel reads "Cardinality mismatch on NESTED LOOPS — Estimated 126 rows but actually produced 80,000 rows, a 634.9x deviation" + fix recommendation | Cardinality-mismatch beat. The right panel callout text is the hero element — zoom it. |
| `sankey.png` | Sankey diagram, blue flow ribbons + one orange, labeled join/scan nodes | "See where the rows flow" beat. |
| `compare.png` | Compare dashboard: Plan A vs Plan B cards (Cost +225.0%, Time +172.9%) + full delta table with green/red deltas (+1.9K +163%, +24 +2400%) | Plan-compare beat. Crop to top ~1600px orig (table doesn't fill full height). |
| `annotations.png` | Tree with an orange circle highlight + a blue highlight on nodes; annotation editor shows note "Full scan — candidate for index on ORDER_DATE" and highlight color/style pickers | Annotate/share beat. |

Notes:
- Every shot includes the app header with the "Oracle Plan Visualizer" wordmark + blue doc icon (top-left) — a ready-made logo lockup source.
- UI accent is blue (#2563eb); problem/hotspot accents are red (#ef4444) and amber (#f59e0b); positive/emerald (#10b981) for improvements.
- No separate logo file; use a typographic lockup in-frame, optionally echoing the header wordmark.
