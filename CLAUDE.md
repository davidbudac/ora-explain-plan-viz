# Oracle Execution Plan Visualizer

A client-side web application that parses Oracle execution plan output and renders interactive visualizations. Supports DBMS_XPLAN output and SQL Monitor reports, with plan comparison and annotation features.

## Tech Stack

- **Framework**: React 19 + TypeScript
- **Build Tool**: Vite
- **Graph Visualization**: React Flow (@xyflow/react)
- **Sankey Diagram**: D3-sankey
- **Syntax Highlighting**: highlight.js (SQL)
- **Virtualisation**: TanStack Virtual (Tabular view rows)
- **Layout Algorithm**: Custom tree layout (with Dagre fallback)
- **Styling**: Tailwind CSS (selectable app palettes — slate default, compact layout)

## Project Structure

```
src/
├── lib/
│   ├── types.ts         # TypeScript interfaces, operation categories, colors, operation tooltips
│   ├── settings.ts      # User settings persistence (localStorage); exports `defaultNodeDisplayOptions` / `defaultBehaviourOptions`
│   ├── filtering.ts     # Node filtering logic (search, predicates, cost/rows/time/cardinality ranges)
│   ├── format.ts        # Number/time/bytes formatting + cardinality ratio utilities
│   ├── analysis.ts      # Plan tree walking + hotspot/hottest-node detection helpers
│   ├── planSignals.ts   # Plan-level signal detection (partition pruning, parallelism, spills)
│   ├── density.ts       # Layout density presets (Minimal / Compact / Detailed node-display levels)
│   ├── clipboard.ts     # Clipboard copy helper (async API + fallback)
│   ├── baselineScript.ts # SQL Plan Baseline script builder (DBMS_SPM; cursor cache / AWR / STS)
│   ├── clientReport.ts  # Client report builder (self-contained HTML doc: plan, notes, findings)
│   ├── severityStyles.ts # Shared severity color/badge styles (advisor findings)
│   ├── flameLayout.ts   # Flame graph layout (metric rollup, self-value, zoom)
│   ├── url.ts           # Shareable-URL encode/decode (gzip) for plan state
│   ├── annotations.ts   # Annotation system (notes, highlights, groups, export/import)
│   ├── compare.ts       # Plan comparison engine (node matching, delta calculations)
│   ├── ash.ts           # ASH wait-class colors + per-line/per-bucket activity aggregation
│   ├── rowFlow.ts       # Wasted-work row-flow computation (rows read vs returned per node)
│   ├── ids.ts           # `generateId()` — UUID that also works on plain-HTTP origins (no `crypto.randomUUID`)
│   ├── session.ts       # Session autosave/restore + Recent plans (localStorage only, size-capped, try/catch-guarded)
│   ├── formats.ts       # Single source of truth for accepted input formats (placeholder, parse errors, start screen, `looksLikePlan`)
│   ├── dropFiles.ts     # Drag-and-drop file reading/classification + multi-file drop planning (plan + optional bundle)
│   ├── topBarLayout.ts  # Pure width allocation for the single top bar (title → button labels → plan tabs → view tabs)
│   ├── actionFeedback.ts # Toast wording/branching for share-link and PNG-export outcomes (`runPngExport`, `shareFeedback`)
│   ├── paletteSearch.ts # Ranked command-palette matching (whole-word/prefix hits beat substrings)
│   ├── treeCollapse.ts  # Tree collapse/expand helpers, per-plan collapse memory, `TreeViewActions` / `TreeViewState` types
│   ├── nodeAriaLabel.ts # One-sentence accessible name for a tree node
│   ├── tabularHelpers.ts # Tabular view helpers (A-Time share, sort cycling, Copy as TSV)
│   ├── planText.ts      # Plan Text view helpers (line → operation id, search matches, highlight segments)
│   ├── fileExport.ts    # Download / print-window helpers that report failure via toasts and return success
│   ├── ai/              # AI plan analysis: types, plan/context serialization, prompts, findings parser, secrets (sessionStorage keys), provider layer (anthropic / openaiCompat / agent / hosted / sse), chat follow-up support (streamChat), testCase.ts (deterministic test-case script builder), experiments.ts (SQL Patch script + advisor-driven experiment candidates)
│   ├── parser.ts        # Legacy parser (kept for compatibility)
│   ├── advisor/         # Plan advisor: runAdvisor engine + 10 heuristic rules (findings)
│   ├── metadata/        # Schema-metadata bundles, indexes, gather-script, pairing/lookup helpers
│   └── parser/          # Modular parser system
│       ├── index.ts           # Parser orchestration, format detection (json/xml/text/xbi/dbms_xplan)
│       ├── types.ts           # Parser interfaces
│       ├── dbmsXplanParser.ts # DBMS_XPLAN text parser
│       ├── sqlMonitorParser.ts # SQL Monitor text/XML parsers
│       ├── jsonPlanParser.ts  # JSON plan parser (V$SQL_PLAN_STATISTICS_ALL / Datadog / xdd.sql)
│       ├── xbiParser.ts       # Tanel Poder xbi.sql (eXplain Better) output parser
│       ├── noteSection.ts     # DBMS_XPLAN "Note" section parser
│       └── __tests__/         # Parser unit tests (vitest + jsdom)
├── examples/            # Sample plan files loaded via Vite glob import
│   ├── index.ts              # Auto-loader using NN-category-Name.txt convention
│   ├── descriptions.ts       # One-line "what this example teaches" blurbs; `featured` ones go on the start screen
│   └── *.txt                 # Example plan files (DBMS_XPLAN and SQL Monitor)
├── hooks/
│   ├── usePlanContext.tsx   # Global state management (React Context, multi-plan support)
│   ├── useAiAnalysis.tsx    # AI analysis state (React Context: dialog, run/stream/cancel, report)
│   ├── useNarrowWorkspace.ts # `(max-width: 1100px)` media query → responsive workspace (docked panels become sheets)
│   └── useTopBarMode.ts     # Top-bar compaction state (labels collapsed, plan tabs compact/squeezed) written by the view ribbon
├── components/
│   ├── ui/                  # Shared primitives (barrel `index.ts`): Dialog (+Header/Body/Footer), ConfirmProvider/useConfirm, ToastProvider/useToast/`toast`, CopyButton, ErrorBoundary (+ErrorFallback), FOCUS_RING(_INSET), useMenuKeyboard, button styles, z-layers
│   ├── Header.tsx           # Top-bar actions: File / Appearance / Help menus, share, PNG, focus mode, palette (fold into one menu below 1100px)
│   ├── NavRibbon.tsx        # View tab ribbon (Tree/Compare/Tabular/Sankey/Flame/Text/SQL/Metadata/Monitor/Experimental) + plan-tabs cluster + maximize; measures the bar (`topBarLayout.ts`)
│   ├── FocusOverlay.tsx     # Focus-mode floating instruments (search/filters/View/legend/findings pill + selection inspector card)
│   ├── PanelEdgeTab.tsx     # Seam-attached collapse tabs + `PanelResizeHandle` (keyboard-resizable side-panel separators)
│   ├── WorkspaceTools.tsx   # Toolbar above the canvas: Filters (count), per-view controls (`ViewControls`: density/Customize/indicator/tree layout strip, Sankey/Flame metric), Legend, Details; narrow screens open panels as non-modal sheets
│   ├── NoMatchesBanner.tsx  # Floating "filters match nothing" notice with a filter-only reset
│   ├── viewIcons.tsx        # Icons for the view tabs
│   ├── InputPanel.tsx       # Owns the single top bar (brand, SQL-ID drawer handle, plan/view tabs, DB Connect, Load Example/Recent, actions) + the input drawer; also the bundle-pairing chooser
│   ├── FilterPanel.tsx      # Filter by operation type, cost, search, predicates, cardinality mismatch
│   ├── NodeDetailPanel.tsx  # Node details, hotspots, annotations, cardinality analysis
│   ├── FindingsPanel.tsx    # Plan advisor findings (per-node + full list, togglable)
│   ├── VisualizationTabs.tsx # View switcher (hierarchical, compare, sankey, flame, tabular, text, sql, metadata, monitor, experimental)
│   ├── PlanTabs.tsx         # Plan A/B tab bar with compare button
│   ├── ComparePlanPicker.tsx # Picker for choosing which two plans to compare
│   ├── CommandPalette.tsx   # Cmd/Ctrl-K command palette (ranked search, action/toggle/select kinds, views, schemes, tree actions, examples)
│   ├── ShortcutsOverlay.tsx # Keyboard shortcuts help overlay
│   ├── ShareResultDialog.tsx # Share-via-URL dialog (encoded plan link)
│   ├── PopoutWindow.tsx     # Detachable pop-out window (e.g. Metadata Explorer)
│   ├── GatherScriptModal.tsx # Generates a schema-metadata gather SQL script
│   ├── BaselineScriptModal.tsx # Generates a SQL Plan Baseline creation script (DBMS_SPM)
│   ├── AiAnalysisDialog.tsx # AI analysis setup dialog (provider, model, key, run analyze/compare)
│   ├── ClientReportModal.tsx # Client report export dialog (title/client/author, sections, preview)
│   ├── MetadataChip.tsx     # Inline schema-metadata badge/chip
│   ├── FormattedPredicate.tsx # Predicate rendering with column formatting
│   ├── Legend.tsx           # Hideable color legend
│   ├── HighlightText.tsx    # Search text highlighting component
│   ├── CustomizeViewMenu.tsx # Node display options popover
│   ├── AnnotationEditor.tsx # Per-node annotation text + color highlight picker
│   ├── GroupAnnotationDialog.tsx # Modal for creating/editing annotation groups
│   ├── CompareMetricSelector.tsx # Metric toggle pills for compare view
│   ├── metadata/            # Schema Metadata explorer (view, sidebar, table/index/columns detail, bundle overview)
│   ├── nodes/
│   │   └── PlanNode.tsx     # Custom React Flow node (badges, hot node ring, tooltips, highlights)
│   └── views/
│       ├── HierarchicalView.tsx   # Tree layout (React Flow + custom algorithm, TB/LR, collapse, minimap, keyboard nav, PNG export)
│       ├── TreeLayoutControls.tsx # Props-only tree strip (direction, minimap, expand/collapse all, focus selected, redraw)
│       ├── TreeCompareView.tsx    # Side-by-side dual tree panes (two plans)
│       ├── CompareView.tsx        # Side-by-side plan comparison dashboard
│       ├── TabularView.tsx        # Sortable/resizable, virtualised plan table (persisted column widths, toolbar)
│       ├── TabularCompareView.tsx # Side-by-side dual tabular panes (two plans)
│       ├── SankeyView.tsx         # Sankey diagram (D3)
│       ├── FlameView.tsx          # Flame graph (metric toggle cost/A-Time/A-Rows, click-to-zoom)
│       ├── PlanTextView.tsx       # Raw plan text: in-view search, line numbers/wrap, copy, click a line to select its operation
│       ├── SqlTextView.tsx        # Full SQL text with syntax highlighting + copy
│       ├── AiReportView.tsx       # AI analysis report tab (streamed markdown + findings)
│       ├── MonitorDetailsView.tsx # SQL Monitor XML details (activity, session, resources, binds)
│       └── experimental/          # Experimental tab: 5 sub-views behind a segmented switcher
│           ├── ExperimentalView.tsx  # Shell (sub-view switcher, persisted via settings)
│           ├── ScatterView.tsx       # E-Rows vs A-Rows log-log calibration scatter
│           ├── TimelineView.tsx      # Execution Gantt (first/last active + ASH wait-class cells)
│           ├── WaterfallView.tsx     # Wasted-work row flow (rows read vs returned)
│           ├── MorphView.tsx         # Estimate→actual animated icicle morph
│           └── WaitsView.tsx         # Per-line wait-class composition (ASH samples)
├── App.tsx
├── main.tsx
└── index.css            # Tailwind imports + dark mode styles

evals/                   # AI eval harness (Node + tsx + oracledb thin; NOT part of the Vite build)
├── run.ts               # Repro-fidelity backtest (plan shape match in a scratch schema)
├── analyze.ts           # Analysis-quality backtest (findings vs known injected faults)
├── scenarios/           # Scenario corpus (setup.sql + query.sql + expect.json per scenario)
├── lib/                 # DB exec, metadata gather, plan capture/compare helpers
└── results/             # Timestamped run-result JSON (gitignored)
```

## Development

```bash
# Install dependencies
npm install

# Start dev server
npm run dev

# Build for production
npm run build

# Preview production build
npm run preview
```

## Testing

Tests use [Vitest](https://vitest.dev/) with jsdom for DOM API support (DOMParser, etc.). `vitest.config.ts` uses the automatic JSX runtime (no per-file pragma needed), loads `vitest.setup.ts` (real jsdom Web Storage on Node ≥ 22), and excludes `.claude/**` (agent worktrees) and `prototypes/**` besides the vitest defaults. Component tests render with the minimal helpers in `src/components/ui/__tests__/testUtils.tsx` (no Testing Library).

```bash
# Run all tests
npx vitest run --environment jsdom

# Run tests in watch mode
npx vitest --environment jsdom

# Run a specific test file
npx vitest run --environment jsdom src/lib/parser/__tests__/sqlMonitorXml.test.ts
```

### Test Structure

```
src/
├── lib/
│   ├── __tests__/            # Core lib tests (analysis, filtering, format, url, flame layout, plan signals, ...)
│   ├── advisor/__tests__/    # Advisor engine + per-rule tests
│   ├── metadata/__tests__/   # Schema-metadata tests (bundle, indexes, gather script, pairing, ...)
│   └── parser/__tests__/     # Parser tests (DBMS_XPLAN, SQL Monitor XML, JSON, xbi, note section, compare)
├── hooks/__tests__/          # Plan-context behaviour (e.g. bundle-chooser attach flow)
├── components/__tests__/     # Component tests (modals, metadata chip, views, annotation editors, ...)
├── components/ui/__tests__/  # Shared primitive tests (Dialog, ConfirmDialog, Toast, CopyButton, ErrorBoundary, useMenuKeyboard)
└── examples/__tests__/       # Example loader / descriptions / sidecar-metadata tests
```

Tests are excluded from the production build via `tsconfig.app.json` exclude patterns. Test files use the `*.test.ts(x)` convention and live in `__tests__/` directories alongside the code they test.

## Features

### Visualization
- **Visualization Modes**: Hierarchical tree, Tabular table, Sankey diagram, Flame graph, raw Plan Text, SQL text, Metadata explorer, Monitor details, Compare, and Experimental tabs (available tabs depend on the loaded plan's format)
- **Flame Graph**: Rolled-up flame bars sized by self value, with a metric toggle (Cost / A-Time / A-Rows) and click-to-zoom into any subtree
- **Tree Layout**: Top-down or left-to-right direction (persisted; keyboard arrows rotate with it), per-subtree collapse/expand with "+N hidden" stubs (in-memory per plan, survives view switches; an external selection inside a collapsed subtree expands it), Expand/Collapse all, an overview minimap (Auto — shown above 12 visible operations — / On / Off), auto-centring on selections made outside the canvas, "Focus selected" and "Redraw" (drops manual drags and refits). The layout strip lives in the workspace toolbar; the tree-compare panes keep a per-pane overlay strip
- **Tabular View**: Sortable, resizable plan table (column widths persisted to localStorage), virtualised rows (TanStack Virtual) with keyboard navigation, and a toolbar (collapse all, wrap predicates, hide non-matching rows, Copy as TSV); respects the active filters and highlights the hottest node
- **Plan Text View**: Raw plan text with in-view search (Enter / Shift+Enter to step), global-search highlighting, line-number and wrap toggles (persisted), copy, and click-a-line to select its operation
- **SQL Text View**: Full SQL statement with SQL syntax highlighting and copy-to-clipboard
- **Monitor Details View**: SQL Monitor XML report detail — activity breakdown (CPU / I/O Wait / PL/SQL / Other) plus Execution Summary, Session & Environment, SQL Text, Bind Variables, Resource Consumption, and Optimizer Environment sections
- **Tree / Tabular Compare**: When two plans are loaded, the Tree and Tabular tabs switch to side-by-side dual-pane variants with an active-plan accent
- **Experimental Tab**: five research views behind one tab — optimizer calibration scatter (E-Rows vs A-Rows, log-log), execution timeline Gantt (per-op first/last active + ASH wait-class cells), wasted-work waterfall (rows read vs returned), estimate→actual icicle morph, and per-line wait-class composition. SQL Monitor XML parser extracts `<activity_detail>` bucketed ASH samples and per-op `first_active`/`last_active` offsets to power them
- **Multiple Input Formats**: DBMS_XPLAN, SQL Monitor text, SQL Monitor XML, JSON plan (V$SQL_PLAN_STATISTICS_ALL), and Tanel Poder xbi.sql output
- **Runtime Statistics**: Display A-Rows, E-Rows, A-Time, and Starts from SQL Monitor
- **Node Indicator Metrics**: Configurable node badges showing cost, A-Rows, A-Time, starts, or activity %
- **Hot Node Detection**: Automatically highlights the node with the highest self time — ASH activity % for SQL Monitor plans that carry it (red ring + "Hotspot" badge)
- **Hotspots Summary Panel**: When no node is selected, shows top 5 nodes by self time (or activity %), own cost, and worst cardinality mismatches (clickable to navigate; `lib/worstNodes.ts`)
- **Sankey / Flame Metric Toggles**: Sankey flow (E-Rows, Cost, Total rows over all starts, A-Time) and flame metric switch from the workspace toolbar

### Analysis
- **Plan Comparison**: Load two plans side-by-side with node matching (exact ID, heuristic, access-path changed), delta calculations, and improvement/regression indicators across 9 metrics (cost, rows, bytes, A-Rows, A-Time, self time, starts, temp space, memory)
- **Plan Advisor**: Heuristic findings engine (`runAdvisor`) with 10 rules — cardinality mismatch, implicit conversion, cartesian merge join, nested-loop volume, parallel signals, partition pruning, selective full scan, spill-to-disk, stats issues, and unused index — surfaced per-node and as a ranked list; suggestion hints are togglable (off by default)
- **AI Plan Analysis**: Optional LLM-powered analysis (single plan or A/B compare) via an Anthropic, OpenAI-compatible, local-agent, or hosted (oraplanviz cloud account token) provider — streamed markdown report in an AI tab with findings linked to plan nodes. Privacy: nothing leaves the browser until the user clicks Run, and only to the provider they chose; API keys live in sessionStorage only (`src/lib/ai/secrets.ts`), never in localStorage settings or share URLs
- **AI Test Case Builder**: With a plan + attached metadata bundle, builds a deterministic synthetic-repro skeleton (`src/lib/ai/testCase.ts` — empty DDL, DBMS_STATS stats/histograms, optimizer env, binds, EXPLAIN PLAN verification) that the AI amends into a runnable scratch-schema script with realistic binds, an optional data generator, and alternative-plan experiments (`src/lib/ai/experiments.ts` — SQL Patch script + advisor-driven experiment candidates); SQL fences in the report get per-block copy/download
- **AI Follow-up Chat**: After a completed AI report, a chat section in the AI tab lets the user ask follow-up questions (multi-turn via `streamChat`); when the DB agent feature is enabled, SQL blocks in test-case reports and chat replies get a "Run via agent" button that executes against the agent's scratch test connection only after explicit per-script user approval (script preview + destructive-statement warning) — nothing ever auto-runs or auto-sends
- **AI Eval Harness**: `evals/` backtesting harness (Node + tsx + oracledb thin, outside the Vite build) measuring repro fidelity (does the generated test case reproduce the plan shape?) and analysis quality (does the AI find a known injected fault?) against a real Oracle scratch schema via `ORA_EVAL_*` env vars — see `evals/README.md`
- **Cardinality Mismatch Analysis**: Detects divergence between A-Rows and the estimate over all starts (`estimatedRowsTotal`, see Architecture Notes) with severity badges (warn at 3x, bad at 10x); the advisor also needs a ≥100-row absolute difference
- **Cardinality Mismatch Filter**: Slider in filter panel to show only nodes exceeding a mismatch threshold
- **Spill-to-Disk Warnings**: Badge on nodes that use temp space, with details in node panel
- **Operation Tooltips**: ~55 Oracle operations with expert descriptions shown on hover and in detail panel

### Schema Metadata
- **Metadata Explorer**: Dedicated tab (and detachable pop-out window) that browses schema objects referenced by the plan — tables, indexes, and columns — with per-object detail panels and a bundle overview
- **Metadata Bundles**: Attach schema-metadata bundles to a plan; objects with metadata show inline badges/chips in the plan
- **Gather Script**: Generates a SQL script to collect the schema metadata needed for a bundle from the database

### Plan Baselines
- **Baseline Script Generator**: Generates a ready-to-run SQL*Plus script that creates a SQL Plan Baseline (via `DBMS_SPM`) for the loaded plan's SQL ID + plan hash value — from the cursor cache, AWR directly (19c+), or AWR via a temporary SQL Tuning Set (11.2+), with FIXED/ENABLED options, pre-check and verification queries, and a management crib sheet. Opened from the input-panel header or command palette; fully offline — the user runs the script themselves

### Client Report
- **Client Report Export**: Packages the loaded plan, the consultant's annotations, and all derived analysis into a single self-contained HTML document for handing to a client — header metadata (title, client, prepared by, date, SQL ID, plan hash), free-text executive summary with headline stat cards and optimizer-note tags, SQL statement, full plan table (with hotspot marker, highlight chips, inline notes, estimate-quality column), consultant notes/groups/highlights, advisor findings with recommendations, top self-time hotspots, worst cardinality mismatches, predicates, execution environment + bind variables, and a raw-plan appendix. Section toggles, live preview iframe, download as `.html` or open a print view for save-as-PDF. Client/author names persist to localStorage. Opened from the top-bar document icon or the command palette (`clientReport.ts` + `ClientReportModal.tsx`); fully offline, nothing is uploaded

### Annotations
- **Node Annotations**: Add text notes to individual nodes with timestamps
- **Color Highlights**: 7-color highlight system (red, orange, yellow, green, blue, purple, pink) shown as rings on nodes
- **Annotation Groups**: Create named groups of nodes with color and optional note
- **Bulk Highlighting**: Apply highlights to multiple selected nodes at once
- **Export/Import**: Save annotated plans as JSON files, load them back with validation

### Navigation & Filtering
- **Multi-Node Selection**: Cmd/Ctrl-click for multi-select with aggregated statistics
- **Keyboard Navigation**: Arrow keys to navigate parent/child/sibling nodes (rotated in the left-to-right layout: ← parent, → first child, ↑/↓ siblings), Escape to deselect
- **Copy-to-Clipboard**: Copy buttons on access and filter predicates in the detail panel
- **Filter Panel**: Filter by operation type, cost threshold, search text, predicate type, actual stats ranges, and cardinality mismatch; "Reset filters" clears only filter fields, never display settings (density, predicates, edge animation, focus selection)
- **Search Highlighting**: Matching text highlighted in plan nodes
- **Zero-Match Banner**: When the active filters match nothing, a floating notice (`NoMatchesBanner.tsx`, `role="status"`) offers a filter-only reset
- **Node Details**: Click any node to see full attributes, predicates, cardinality analysis, and spill warnings

### UI/UX
- **Single-Bar Chrome**: One top bar (rendered by `InputPanel.tsx`) holds brand, SQL-ID drawer handle, plan tabs, view tabs, DB Connect, Load Example, and all actions. The view ribbon measures the bar and allocates width (`lib/topBarLayout.ts` → `useTopBarMode`; the title mode reaches `InputPanel` via `useTitleMode` in `NavRibbon.tsx`). The SQL ID is the last thing to give, so space is given up in this order: (1) button labels marked `data-topbar-label` collapse to icons (buttons keep an icon + `aria-label`); (2) plan tabs drop secondary text (PHV, SPM, "Add Plan"); (3) view-tab labels drop from the tail down to the first three (`PRIORITY_LABELS`: Tree / Compare / Tabular); (4a) the title drops its "SQL ID:" prefix and shows the bare id (`titleMode: 'bare'`; the prefix turns `sr-only`, so the accessible name and button tooltip keep the full text); (4b) the bare id truncates (`'truncated'`; its text hides below ~40 px rather than show a sliver); (5) the remaining labels drop; (6) the ribbon goes icon-only; (7) the tail moves into an overflow menu; (8) only then do plan tabs scroll. Measured with ten views and one plan: at 1440 the full title shows beside five labels, at 1280 the bare id beside three labels, at 1024 all ten views stay and the id truncates. Below 1100px the actions fold into one menu. Metadata/format chips live in the input drawer
- **Plan Tabs**: Tab bar for switching between Plan A / Plan B when comparing
- **Example Plans**: Auto-loaded sample plans from `src/examples/` (add .txt files, no code changes needed); one-line blurbs and start-screen "featured" flags come from `examples/descriptions.ts`
- **Plan Metadata**: SQL ID in the top bar; format / actual-stats / binds / optimizer-note chips plus operation count, cost and PHV in the input drawer
- **Collapsible Panels**: Input drawer collapses; side panels collapse via seam-attached edge tabs into slim clickable rails (with live filter count). The filter panel starts collapsed for new users. Side-panel separators (`PanelResizeHandle`, `role="separator"`) resize by pointer or keyboard (←/→ 16 px, Shift 64 px, Home/End to the limits)
- **Workspace Toolbar**: A slim bar above the canvas (`WorkspaceTools.tsx`) with Filters (live n/m count), the active view's controls (`ViewControls`: tree → density `<select>` + Customize…, a node-indicator `<select>` (Cost / A-Rows / A-Time / Starts), and the tree layout strip; Sankey → flow metric; Flame → metric), an icon-only Legend toggle (`aria-label="Toggle legend"`), and — in the narrow layout only — Details (shows the selected node id; on wide screens the details panel is toggled from its edge tab). The bar is always a single row: Filters (and Details, when narrow) keep the ends and the view controls between them scroll sideways (no scrollbar) when the canvas is too narrow; the "Nodes"/"Indicator" field labels show only when the toolbar is at least 900px wide (container query), otherwise they stay as accessible names. The tree strip is driven through the context (`treeViewActionsRef` for actions, `treeViewState` for the hidden count / collapsibility / minimap visibility the mounted tree publishes). On wide screens it toggles the docked panels; below 1100px (`useNarrowWorkspace`) the docked panels and edge tabs are hidden and the same buttons open Filters/Details as floating non-modal sheets (`role="dialog"`, `aria-modal="false"`) — selecting a node auto-opens the details sheet, Escape closes it without stealing focus from the graph. Focus mode is disabled in the narrow layout. The tree refits itself when the canvas is resized (ResizeObserver)
- **Maximize Visualization**: Toggle a fullscreen visualization mode (F) that hides the surrounding panels, keeping a slim tabs-only bar
- **Focus Mode**: Toggle (Z, persisted) that hides both side panels for a full-width canvas, replaced by a floating pill (search, Filters, a View chip with the same per-view controls as the toolbar, Legend, Findings) and a selection-driven inspector card; composes with maximize, skipped in the compare workspace
- **Density Presets**: Minimal / Compact / Detailed node density (`src/lib/density.ts`), picked from the toolbar's Nodes select; Customize… fine-tunes node fields and behaviour toggles, and its "Reset defaults" restores `defaultNodeDisplayOptions` + `defaultBehaviourOptions` from `settings.ts`. **Compact is the default** for new users: a readable overview card with operation, object, Est./Actual rows and cost (no predicate chips or partition info — those live in the details panel), rendered by a dedicated branch in `PlanNode.tsx` with matching node heights and tighter row spacing in `HierarchicalView.tsx`. `defaultNodeDisplayOptions` is derived from `DENSITY_PRESETS.compact`; saved preferences are preserved. Minimal reduces nodes to operation, object, one mono metric line, and an amber warning dot for collapsed signals; hovering (250ms) opens a portal card with the full Est/Act grid, badges, and predicates. Detailed shows everything including predicate text
- **Command Palette**: Cmd/Ctrl-K palette with ranked search (`paletteSearch.ts`: whole-word/prefix hits beat incidental substrings), commands typed as action / toggle / select (toggles show their state), views, color schemes, palettes, tree actions, and a "Load example: …" command per bundled example
- **Help Menu**: Top-bar Help menu — keyboard shortcuts (also `?`), the "getting a plan" guide, and the GitHub repo
- **Keyboard Shortcuts Overlay**: Help overlay listing available shortcuts per view
- **Session Autosave / Restore**: The workspace (plans, custom labels, metadata bundles, annotations, active plan, view) autosaves to localStorage and is restored on the next visit with a "Restored your previous session" toast offering "Start fresh" (`lib/session.ts`; oversized sessions are skipped, never truncated)
- **Recent Plans**: The Load Example menu lists the last 8 loaded plans (with their metadata bundle when it fits) above the examples; entries can be removed individually
- **Full-Window Drop**: Dropping files anywhere shows a drop overlay; a drop loads one plan plus an optional metadata bundle, an annotated-plan export, or attaches a bundle (`lib/dropFiles.ts`)
- **Confirmations**: Destructive actions ask first through the shared confirm dialog (`useConfirm`): clearing or removing a plan, discarding annotations on re-parse/import, clearing annotations, replacing an attached metadata bundle, and closing a dialog with typed input
- **Toasts**: Outcomes that are otherwise invisible — share link copied, PNG downloaded or failed (`lib/actionFeedback.ts`), copy/download failures, session restore, unused dropped files — are reported via `useToast` / `toast`
- **Shared Dialog / a11y Primitives**: All modals use `ui/Dialog` (labelled `role="dialog"`, focus trap + restore, Escape, dirty-close guard); menus use `useMenuKeyboard` (arrows, Home/End, Escape); one `FOCUS_RING` recipe; tree nodes carry a one-sentence `aria-label` (`nodeAriaLabel.ts`); an app-level `ErrorBoundary` shows a copyable error report
- **Share via URL**: Encode the current plans (with annotations, the active view, and metadata bundles while the URL stays under ~32k chars) into a gzip-compressed shareable link via the share dialog
- **Color Schemes**: 8 data-paint options — High Contrast, Semantic (default), Est ⇄ Act, Icon Rail, Ticker, plus three node-identity schemes that restyle the node card itself: Stripe (category spine), Tinted (card carries a quiet category tint), and Terminal (square corners, mono titles, hard offset shadow)
- **App Palettes**: Slate (default), Graphite, Teal, Violet, and Paper — a third appearance axis next to theme and color scheme that re-skins neutral surfaces and accent via CSS variable overrides (`html[data-palette=…]` in `index.css`); data colors (category, severity) are untouched
- **Settings Persistence**: View preferences saved to localStorage
- **Theme Toggle**: Light/dark mode with localStorage persistence
- **Legend Toggle**: Color/badge legend for the tree, tabular, Sankey and flame views, toggled from the toolbar, the focus pill, the Appearance menu or the palette
- **Fully Client-Side**: No backend, no data upload - everything runs in browser

## Supported Input Formats

### DBMS_XPLAN Output
Standard Oracle DBMS_XPLAN.DISPLAY output:

```
Plan hash value: 1234567890

--------------------------------------------------------------------------------
| Id  | Operation                    | Name       | Rows  | Bytes | Cost (%CPU)|
--------------------------------------------------------------------------------
|   0 | SELECT STATEMENT             |            |     1 |    10 |     5   (0)|
|   1 |  NESTED LOOPS                |            |     1 |    10 |     5   (0)|
...
--------------------------------------------------------------------------------

Predicate Information (identified by operation id):
---------------------------------------------------
   3 - access("E"."EMPLOYEE_ID"=:1)
```

### SQL Monitor Text
Text output from V$SQL_PLAN_MONITOR with actual execution statistics:

```
SQL Plan Monitoring Details (Plan Hash Value=1234567890)
================================================================================
| Id | Operation              | Name  | E-Rows | A-Rows | A-Time   | Starts |
================================================================================
|  0 | SELECT STATEMENT       |       |        |      1 | 00:00:01 |      1 |
|  1 |  NESTED LOOPS          |       |      1 |      1 | 00:00:01 |      1 |
...
```

### SQL Monitor XML
XML format from DBMS_SQL_MONITOR.REPORT_SQL_MONITOR with full execution details.

The parser handles the **real Oracle XML format** with separate `<plan>` (optimizer estimates + predicates) and `<plan_monitor>` (actual runtime statistics) sections. Key XML elements:

- `<report>` root with `<sql_monitor_report>` container
- `<report_parameters>` / `<target>` for metadata (sql_id, plan_hash, sql_fulltext)
- `<plan>` operations: `<card>`, `<cost>`, `<predicates type="access|filter">`
- `<plan_monitor>` operations: `<stats type="plan_monitor">` with `<stat name="cardinality">` (actual rows), `<stat name="starts">`, `<stat name="max_memory">`, etc.
- Operation names combine `name` + `options` attributes (e.g., `TABLE ACCESS` + `FULL`)
- A legacy simplified XML format is also supported for backward compatibility

## Architecture Notes

### Multi-Plan State
The context (`usePlanContext.tsx`) uses a `PlanSlot[]` array to support 1-2 simultaneous plans. Each slot holds its own `rawInput`, `draftInput`, `parsedPlan`, `selectedNodeId/Ids`, and `error`. Backward-compatible derived values (`rawInput`, `parsedPlan`, etc.) are exposed from the active plan slot.

### Draft vs Loaded Input
`rawInput` is the text of the **loaded** (parsed) plan; `draftInput` is what the input textarea currently holds. Editing the textarea only changes the draft; Parse (or a recognisable paste) loads it, re-parsing unchanged text is a no-op, and a pasted metadata bundle is routed to the attach flow and the draft reset to the loaded text. Loads that would discard annotations ask first.

### Session Persistence & Sharing
`lib/session.ts` owns two localStorage keys: `oraplanviz.session.v1` (autosaved workspace: slots with plan text, custom label, metadata bundle, annotations; active plan; view mode) and `oraplanviz.recent.v1` (Recent plans). All access is try/catch-guarded and size-capped. A share URL (`lib/url.ts`) takes precedence over a saved session on load; its payload carries each plan's text and annotations, the view mode, and the metadata bundles (dropped, with a warning, when the URL would get too long).

### Metadata Bundle Attach Flow
`attachBundleText` (paste, drop, Gather dialog) pairs a bundle with the loaded plans (`metadata/pairing.ts`). An ambiguous or SQL_ID-less bundle opens the pairing chooser (`pendingBundleChoice`, rendered by App); the returned promise resolves only when the chooser settles — true once attached, false when cancelled or superseded — so callers such as the Gather dialog can clear their input on success.

### Plan Comparison Engine
The comparison system (`compare.ts`) matches nodes in passes:
1. **Exact ID match**: same node ID, same full operation and same object
2. **Heuristic match**: operation+object signature, matching alias@query block first, then closest depth
3. **Access changed**: same object (alias@query block, else object name) with a different operation — e.g. FULL → BY INDEX ROWID
4. **Unmatched**: leftover nodes from either plan

### Plan Numbers (post-parse derivations)
`parsePlan` (`lib/parser/index.ts`) runs `computeSelfTimes`, `computeEstimatedRowTotals` and `computeSelfCosts` (`lib/analysis.ts`) on every plan. Oracle semantics to preserve:
- **E-Rows is per start, A-Rows is cumulative.** Compare A-Rows only with `estimatedRowsTotal` via `nodeCardinalityRatio(node)` (`lib/format.ts`); never `actualRows / rows`. The total is E-Rows × Starts, except: inside a PX slave set and not on a NESTED LOOPS/FILTER probe side → E-Rows (Starts counts slaves/granules); under a partition iterator → the topmost iterator's Starts (child Starts count partitions); a rowid fetch fed by an NLJ-batching or batched-rowid nested loop → the Starts of the index that supplies the rowids (verified on 19c, fixtures in `lib/parser/__tests__/fixtures/allstats-*.txt`); Starts = 0 or a COUNT STOPKEY cut-off → undefined (no signal). Ratios floor both sides at 1, so they are never 0 or ∞.
- **Cost is cumulative.** `ParsedPlan.totalCost` is the root's cost (`planRootCost`), so cost shares top out at 100% at the root; `selfCost` = cost − Σ children's cost.
- **A-Rows needs no × Starts** anywhere (flame, Sankey, row totals).
- **Temp**: `tempSpace` is the optimizer estimate (TempSpc / E-Temp / JSON `temp_space`); `tempUsed` is actual spill (Used-Tmp, SQL Monitor Temp).

### Annotation System
Annotations (`annotations.ts`) are an in-memory overlay per plan slot, persisted only as part of the session autosave (and share links). They include per-node notes/highlights and named groups. Export produces a versioned JSON with plan metadata for validation on re-import.

### DB-Connect Agent (optional feature)
`src/lib/agent/client.ts` is the app's **only** HTTP module — a typed fetch
wrapper for the local [`oraplanviz-db-connector`](https://github.com/davidbudac/oraplanviz-db-connector)
companion (adjacent repo `../oraplanviz-db-connector`). The whole feature is
build-time gated on `VITE_ENABLE_DB_AGENT=1` (`isDbAgentEnabled()`); the
GitHub Pages build never sets it. `ConnectPanel.tsx` renders inside
`InputPanel` (open state lives in the plan context as `connectPanelOpen`, so
the command palette can open it). Plans load via
`fetchPlanWithMetadata()` → `loadAndParsePlan(text, metadataText)`; the
metadata bundle is the same `ora-plan-metadata` contract as
`scripts/gather_plan_metadata.sql`, and a failed gather degrades to a plain
plan load with a notice — never a blocked load. Privacy invariant to
preserve: credentials/plan text only ever flow browser ↔ local agent.

## Code Conventions

- Use TypeScript strict mode
- React functional components with hooks
- Tailwind CSS for styling (dark mode via `dark:` prefix)
- Type imports use `import type { ... }`
