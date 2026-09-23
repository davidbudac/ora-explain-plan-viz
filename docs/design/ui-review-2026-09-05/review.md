# UI review and mockup

Reviewed 5 September 2026. No application source was changed for this review. The design files are standalone artifacts.

## Current workflow

Load a plan by pasting output, loading an example, or using an available import/connection path. Explore the tree or another visualization. Select an operation to inspect its statistics, predicates, metadata and notes. Use findings to investigate possible issues, then compare plans or export a report.

The application already has useful depth: node density controls, focus mode, collapsible/resizable panels, grouped header actions, findings, metadata, and client reports. Keep those capabilities. The opportunity is to make the common path more obvious and the evidence easier to read.

## Highest-value improvements

| Priority | Observed issue | Suggested change | Why it helps |
|---|---|---|---|
| 1 | At 1440×1000, the loaded example has icon-only view navigation and overflow; the detailed seven-node tree fits with very small text. | Keep the common view names visible; use compact node cards with operation, object and selected metrics. Move full predicates and less-used badges to the inspector. | Improves recognition and reading without removing expert detail. |
| 1 | At 1024×768, expanded side panels leave approximately 440px of graph width; the resized graph is partially outside that viewport. | Open filters on demand. At narrower widths, let the inspector become a drawer or a section below the canvas. Preserve selection and offer a visible focus/fit-selected action. | Gives the analytical content usable space. The mockup demonstrates a stacked inspector at 1100px and below; a drawer should also be evaluated before implementation. |
| 1 | Findings are nested in the right sidebar alongside slowest-operation and cost sections. Selecting an operation replaces that overview. | Show one concise starting finding with evidence and an Inspect action; retain separate Overview and Operation controls. | Answers “where should I look?” and keeps the investigation context accessible. This is a proposed workflow, not a validated ranking algorithm. |
| 2 | The Filter panel mixes search, filter conditions, density and metric display settings. Reset also resets display settings. | Move density/metric controls next to the view. Label the action Reset filters and make it reset only filtering. Offer Reset view separately. | Users can change what is visible without unexpectedly changing how the plan is drawn. |
| 2 | Many control labels use 10–11px text, extensive uppercase styling, small badges and competing accent colors. | Use 13–14px for primary interface text and explanations, quieter secondary labels, 12px or larger node text at its intended reading zoom, and restrained category colors. Use blue for selection/actions and amber/red for appropriately qualified findings. | Establishes a clearer hierarchy and reduces reading effort. Retain palette options and both light/dark themes. |
| 2 | The empty screen separates the input at the top from examples and explanatory content farther down. | Bring a clear paste/open action and a short example choice together. Label examples by the question they teach, with format as secondary information. Put database-link instructions behind “Other ways to load a plan.” | Shortens the path to a successful first load. |
| 2 | Several controls have visible text nearby but no programmatically associated name; table sorting is attached directly to headers. | Associate form labels; name switches and sliders; use keyboard-operable sorting buttons and announce sort direction. | Makes existing functionality usable beyond the mouse. |

## Source-backed details

- `src/App.tsx:193` — panel minimums and center-width calculation; `src/App.tsx:390` — loaded workspace with both side panels.
- `src/components/NavRibbon.tsx:109` — labels collapse to icons, then overflow. The screenshot demonstrates this at desktop width; retaining names will need a different allocation of header space.
- `src/components/FilterPanel.tsx:306` — Reset resets `showPredicates`, `animateEdges`, `focusSelection`, and `nodeDisplayOptions` as well as actual filter fields.
- `src/components/FilterPanel.tsx:418` — search input lacks an associated label; the visible Search label has no `htmlFor`. Slider inputs at lines 551, 575, 600 and 625 also need associated names.
- `src/components/NodeDetailPanel.tsx:176` and `:192` — Hotspots and Suggestions switches have state but lack an accessible name.
- `src/components/views/TabularView.tsx:505` — sorting uses clickable `th` elements. The table has row keyboard navigation, so this recommendation is specifically for sorting controls and sort announcements.

Line numbers describe the inspected checkout and can drift.

## Mockup

Open [mockup.html](mockup.html). The [desktop preview](mockup-desktop.png) and [dark preview](mockup-dark.png) show the proposed direction. Use “Start screen” for the onboarding alternative.

The mockup uses the bundled Cardinality Trap example, including operation #4 with 32 estimated rows, 20,000 actual rows and one Start. The arithmetic is 20,000 ÷ 32 = 625. It illustrates evidence presentation; it does not diagnose this query or validate the advisor’s remaining calculations. Avoid presenting a full scan alone as proof of a problem.

Deliberate tradeoffs:

- A second navigation row uses more height but keeps primary view labels readable. Keep the current focus/maximize options as an expert shortcut in a production design.
- A collapsed filter panel makes advanced filtering one click farther away. Allow experienced users to pin it open.
- Compact cards omit detail from the graph. Keep Detailed mode and the inspector, and make the selected metric explicit.
- The mockup has a fixed graph and scrollable canvas. It does not implement pan/zoom, parsing, connections, real exports, AI, or persistent notes. Larger-plan layout and performance need their own validation.
- The overview’s starting finding is intentionally selected for this example. Production prioritization must respect source semantics, Starts, evidence quality and duplicate downstream symptoms.

## Verification and limits

Inspected the running application’s empty screen, loaded Cardinality Trap tree and selected-operation inspector at 1440×1000 and 1024×768. Saved the original screenshots in [evidence](evidence/). Read the current layout, navigation, filters, details, table and example source. This is a targeted UX review, not an exhaustive audit of all formats, comparison, exports, databases or AI flows.

Checked mockup interactions in the browser: Overview → Inspect; seven table rows; table-only filter → two rows; reset; SQL view; search for ORDERS → one graph match; light/dark switch. The mockup uses local assets and fixed data. An initial favicon 404 was addressed with an inline empty favicon.

Recommendations concerning accessible names, keyboard interaction and focus follow the [Web Interface Guidelines](https://raw.githubusercontent.com/vercel-labs/web-interface-guidelines/main/command.md). Native dialog behavior was checked against [MDN](https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Elements/dialog). The optional modern-web-guidance package could not be retrieved in this environment; official browser documentation was used as a fallback.

## Suggested first slice, if approved later

Start with compact readable nodes, labeled common views, filters on demand and a stable Overview/Operation inspector. Include the filter-reset and accessible-label fixes. Evaluate that slice on a short plan, a large plan and a narrow laptop before adding further UI features.
