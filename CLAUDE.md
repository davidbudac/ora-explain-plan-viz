# Oracle Execution Plan Visualizer

A client-side web application that parses Oracle execution plan output and renders interactive visualizations. Supports DBMS_XPLAN output and SQL Monitor reports, with plan comparison and annotation features.

## Tech Stack

- **Framework**: React 18 + TypeScript
- **Build Tool**: Vite
- **Graph Visualization**: React Flow (@xyflow/react)
- **Sankey Diagram**: D3-sankey
- **Syntax Highlighting**: highlight.js (SQL)
- **Layout Algorithm**: Custom tree layout (with Dagre fallback)
- **Styling**: Tailwind CSS (slate color palette, compact layout)

## Project Structure

```
src/
├── lib/
│   ├── types.ts         # TypeScript interfaces, operation categories, colors, operation tooltips
│   ├── settings.ts      # User settings persistence (localStorage)
│   ├── filtering.ts     # Node filtering logic (search, predicates, cost/rows/time/cardinality ranges)
│   ├── format.ts        # Number/time/bytes formatting + cardinality ratio utilities
│   ├── analysis.ts      # Plan tree walking + hotspot/hottest-node detection helpers
│   ├── planSignals.ts   # Plan-level signal detection (partition pruning, parallelism, spills)
│   ├── density.ts       # Layout density presets (bundle node-display toggles into levels)
│   ├── clipboard.ts     # Clipboard copy helper (async API + fallback)
│   ├── baselineScript.ts # SQL Plan Baseline script builder (DBMS_SPM; cursor cache / AWR / STS)
│   ├── severityStyles.ts # Shared severity color/badge styles (advisor findings)
│   ├── flameLayout.ts   # Flame graph layout (metric rollup, self-value, zoom)
│   ├── url.ts           # Shareable-URL encode/decode (gzip) for plan state
│   ├── annotations.ts   # Annotation system (notes, highlights, groups, export/import)
│   ├── compare.ts       # Plan comparison engine (node matching, delta calculations)
│   ├── ash.ts           # ASH wait-class colors + per-line/per-bucket activity aggregation
│   ├── rowFlow.ts       # Wasted-work row-flow computation (rows read vs returned per node)
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
│   └── *.txt                 # Example plan files (DBMS_XPLAN and SQL Monitor)
├── hooks/
│   └── usePlanContext.tsx   # Global state management (React Context, multi-plan support)
├── components/
│   ├── Header.tsx           # App header with theme toggle, annotation save/load
│   ├── NavRibbon.tsx        # View tab ribbon (Tree/Compare/Tabular/Sankey/Flame/Text/SQL/Metadata/Monitor/Experimental) + maximize
│   ├── InputPanel.tsx       # Collapsible input with example loader
│   ├── FilterPanel.tsx      # Filter by operation type, cost, search, predicates, cardinality mismatch
│   ├── NodeDetailPanel.tsx  # Node details, hotspots, annotations, cardinality analysis
│   ├── FindingsPanel.tsx    # Plan advisor findings (per-node + full list, togglable)
│   ├── VisualizationTabs.tsx # View switcher (hierarchical, compare, sankey, flame, tabular, text, sql, metadata, monitor, experimental)
│   ├── PlanTabs.tsx         # Plan A/B tab bar with compare button
│   ├── ComparePlanPicker.tsx # Picker for choosing which two plans to compare
│   ├── CommandPalette.tsx   # Cmd/Ctrl-K command palette (views, color schemes, actions)
│   ├── ShortcutsOverlay.tsx # Keyboard shortcuts help overlay
│   ├── ShareResultDialog.tsx # Share-via-URL dialog (encoded plan link)
│   ├── PopoutWindow.tsx     # Detachable pop-out window (e.g. Metadata Explorer)
│   ├── GatherScriptModal.tsx # Generates a schema-metadata gather SQL script
│   ├── BaselineScriptModal.tsx # Generates a SQL Plan Baseline creation script (DBMS_SPM)
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
│       ├── HierarchicalView.tsx   # Tree layout (React Flow + custom algorithm + keyboard nav)
│       ├── TreeCompareView.tsx    # Side-by-side dual tree panes (two plans)
│       ├── CompareView.tsx        # Side-by-side plan comparison dashboard
│       ├── TabularView.tsx        # Sortable/resizable plan table (persisted column widths)
│       ├── TabularCompareView.tsx # Side-by-side dual tabular panes (two plans)
│       ├── SankeyView.tsx         # Sankey diagram (D3)
│       ├── FlameView.tsx          # Flame graph (metric toggle cost/A-Time/A-Rows, click-to-zoom)
│       ├── SqlTextView.tsx        # Full SQL text with syntax highlighting + copy
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

Tests use [Vitest](https://vitest.dev/) with jsdom for DOM API support (DOMParser, etc.).

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
└── examples/__tests__/       # Example loader / sidecar-metadata tests
```

Tests are excluded from the production build via `tsconfig.app.json` exclude patterns. Test files use the `*.test.ts` convention and live in `__tests__/` directories alongside the code they test.

## Features

### Visualization
- **Visualization Modes**: Hierarchical tree, Tabular table, Sankey diagram, Flame graph, raw Plan Text, SQL text, Metadata explorer, Monitor details, Compare, and Experimental tabs (available tabs depend on the loaded plan's format)
- **Flame Graph**: Rolled-up flame bars sized by self value, with a metric toggle (Cost / A-Time / A-Rows) and click-to-zoom into any subtree
- **Tabular View**: Sortable, resizable plan table (column widths persisted to localStorage), respects the active filters and highlights the hottest node
- **SQL Text View**: Full SQL statement with SQL syntax highlighting and copy-to-clipboard
- **Monitor Details View**: SQL Monitor XML report detail — activity breakdown (CPU / I/O Wait / PL/SQL / Other) plus Execution Summary, Session & Environment, SQL Text, Bind Variables, Resource Consumption, and Optimizer Environment sections
- **Tree / Tabular Compare**: When two plans are loaded, the Tree and Tabular tabs switch to side-by-side dual-pane variants with an active-plan accent
- **Experimental Tab**: five research views behind one tab — optimizer calibration scatter (E-Rows vs A-Rows, log-log), execution timeline Gantt (per-op first/last active + ASH wait-class cells), wasted-work waterfall (rows read vs returned), estimate→actual icicle morph, and per-line wait-class composition. SQL Monitor XML parser extracts `<activity_detail>` bucketed ASH samples and per-op `first_active`/`last_active` offsets to power them
- **Multiple Input Formats**: DBMS_XPLAN, SQL Monitor text, SQL Monitor XML, JSON plan (V$SQL_PLAN_STATISTICS_ALL), and Tanel Poder xbi.sql output
- **Runtime Statistics**: Display A-Rows, E-Rows, A-Time, and Starts from SQL Monitor
- **Node Indicator Metrics**: Configurable node badges showing cost, A-Rows, A-Time, starts, or activity %
- **Hot Node Detection**: Automatically highlights the node with highest A-Time (red ring + "Hotspot" badge)
- **Hotspots Summary Panel**: When no node is selected, shows top 5 nodes by A-Time, Cost, and worst cardinality mismatches (clickable to navigate)
- **Sankey Metric Toggle**: Switch between Rows, Cost, A-Rows, or A-Time

### Analysis
- **Plan Comparison**: Load two plans side-by-side with node matching (exact ID + heuristic), delta calculations, and improvement/regression indicators across 9 metrics (cost, rows, bytes, A-Rows, A-Time, self time, starts, temp space, memory)
- **Plan Advisor**: Heuristic findings engine (`runAdvisor`) with 10 rules — cardinality mismatch, implicit conversion, cartesian merge join, nested-loop volume, parallel signals, partition pruning, selective full scan, spill-to-disk, stats issues, and unused index — surfaced per-node and as a ranked list; suggestion hints are togglable (off by default)
- **Cardinality Mismatch Analysis**: Detects E-Rows vs A-Rows divergence with severity badges (warn at 3x, bad at 10x)
- **Cardinality Mismatch Filter**: Slider in filter panel to show only nodes exceeding a mismatch threshold
- **Spill-to-Disk Warnings**: Badge on nodes that use temp space, with details in node panel
- **Operation Tooltips**: ~55 Oracle operations with expert descriptions shown on hover and in detail panel

### Schema Metadata
- **Metadata Explorer**: Dedicated tab (and detachable pop-out window) that browses schema objects referenced by the plan — tables, indexes, and columns — with per-object detail panels and a bundle overview
- **Metadata Bundles**: Attach schema-metadata bundles to a plan; objects with metadata show inline badges/chips in the plan
- **Gather Script**: Generates a SQL script to collect the schema metadata needed for a bundle from the database

### Plan Baselines
- **Baseline Script Generator**: Generates a ready-to-run SQL*Plus script that creates a SQL Plan Baseline (via `DBMS_SPM`) for the loaded plan's SQL ID + plan hash value — from the cursor cache, AWR directly (19c+), or AWR via a temporary SQL Tuning Set (11.2+), with FIXED/ENABLED options, pre-check and verification queries, and a management crib sheet. Opened from the input-panel header or command palette; fully offline — the user runs the script themselves

### Annotations
- **Node Annotations**: Add text notes to individual nodes with timestamps
- **Color Highlights**: 7-color highlight system (red, orange, yellow, green, blue, purple, pink) shown as rings on nodes
- **Annotation Groups**: Create named groups of nodes with color and optional note
- **Bulk Highlighting**: Apply highlights to multiple selected nodes at once
- **Export/Import**: Save annotated plans as JSON files, load them back with validation

### Navigation & Filtering
- **Multi-Node Selection**: Cmd/Ctrl-click for multi-select with aggregated statistics
- **Keyboard Navigation**: Arrow keys to navigate parent/child/sibling nodes, Escape to deselect
- **Copy-to-Clipboard**: Copy buttons on access and filter predicates in the detail panel
- **Filter Panel**: Filter by operation type, cost threshold, search text, predicate type, actual stats ranges, and cardinality mismatch
- **Search Highlighting**: Matching text highlighted in plan nodes
- **Node Details**: Click any node to see full attributes, predicates, cardinality analysis, and spill warnings

### UI/UX
- **Plan Tabs**: Tab bar for switching between Plan A / Plan B when comparing
- **Example Plans**: Auto-loaded sample plans from `src/examples/` (add .txt files, no code changes needed)
- **Plan Metadata**: SQL ID, Plan Hash, A-Rows, and A-Time shown in input panel header
- **Collapsible Input Panel**: More space for visualization when collapsed
- **Maximize Visualization**: Toggle a fullscreen visualization mode (F) that hides the surrounding panels
- **Command Palette**: Cmd/Ctrl-K palette for switching views, color schemes, and running actions
- **Keyboard Shortcuts Overlay**: Help overlay listing available shortcuts
- **Share via URL**: Encode the current plan into a shareable link (gzip-compressed) via the share dialog
- **Color Schemes**: High Contrast, Semantic (default), Est ⇄ Act, Icon Rail, and Ticker options
- **Settings Persistence**: View preferences saved to localStorage
- **Theme Toggle**: Light/dark mode with localStorage persistence
- **Hideable Legend**: Color coding reference that can be hidden
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
The context (`usePlanContext.tsx`) uses a `PlanSlot[]` array to support 1-2 simultaneous plans. Each slot holds its own `rawInput`, `parsedPlan`, `selectedNodeId/Ids`, and `error`. Backward-compatible derived values (`rawInput`, `parsedPlan`, etc.) are exposed from the active plan slot.

### Plan Comparison Engine
The comparison system (`compare.ts`) uses a 3-pass node matching algorithm:
1. **Exact ID match**: Same node ID with operation similarity check
2. **Heuristic match**: Operation+object signature matching, closest depth wins
3. **Unmatched**: Leftover nodes from either plan

### Annotation System
Annotations (`annotations.ts`) are an in-memory overlay, not persisted to localStorage. They include per-node notes/highlights and named groups. Export produces a versioned JSON (v1) with plan metadata for validation on re-import.

### DB-Connect Agent (optional feature)
`src/lib/agent/client.ts` is the app's **only** HTTP module — a typed fetch
wrapper for the local [`oraplanviz-agent`](https://github.com/davidbudac/oraplanviz-agent)
companion (adjacent repo `../oraplanviz-agent`). The whole feature is
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
