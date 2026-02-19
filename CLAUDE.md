# Oracle Execution Plan Visualizer

A client-side web application that parses Oracle execution plan output and renders interactive visualizations. Supports DBMS_XPLAN output and SQL Monitor reports.

## Tech Stack

- **Framework**: React 18 + TypeScript
- **Build Tool**: Vite
- **Graph Visualization**: React Flow (@xyflow/react)
- **Sankey Diagram**: D3-sankey
- **Layout Algorithm**: Custom tree layout (with Dagre fallback)
- **Styling**: Tailwind CSS (slate color palette, compact layout)

## Project Structure

```
src/
├── lib/
│   ├── types.ts         # TypeScript interfaces, operation categories, colors
│   ├── settings.ts      # User settings persistence (localStorage)
│   ├── filtering.ts     # Node filtering logic (search, predicates, cost/rows/time ranges)
│   ├── format.ts        # Number/time/bytes formatting utilities
│   ├── parser.ts        # Legacy parser (kept for compatibility)
│   └── parser/          # Modular parser system
│       ├── index.ts           # Parser orchestration, format detection
│       ├── types.ts           # Parser interfaces
│       ├── dbmsXplanParser.ts # DBMS_XPLAN text parser
│       ├── sqlMonitorParser.ts # SQL Monitor text/XML parsers
│       └── __tests__/         # Parser unit tests (vitest + jsdom)
│           └── sqlMonitorXml.test.ts
├── examples/            # Sample plan files loaded via Vite glob import
│   ├── index.ts              # Auto-loader using NN-category-Name.txt convention
│   └── *.txt                 # Example plan files (DBMS_XPLAN and SQL Monitor)
├── hooks/
│   └── usePlanContext.tsx   # Global state management (React Context)
├── components/
│   ├── Header.tsx           # App header with theme toggle
│   ├── InputPanel.tsx       # Collapsible input with example loader
│   ├── FilterPanel.tsx      # Filter by operation type, cost, search, predicates
│   ├── NodeDetailPanel.tsx  # Shows selected node attributes + runtime stats
│   ├── VisualizationTabs.tsx # Tab switcher for views
│   ├── Legend.tsx           # Hideable color legend
│   ├── HighlightText.tsx    # Search text highlighting component
│   ├── nodes/
│   │   └── PlanNode.tsx     # Custom React Flow node component
│   └── views/
│       ├── HierarchicalView.tsx   # Tree layout (React Flow + custom algorithm)
│       └── SankeyView.tsx         # Sankey diagram (D3)
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
└── lib/
    └── parser/
        └── __tests__/
            └── sqlMonitorXml.test.ts   # SQL Monitor XML parser tests (real Oracle format + legacy)
```

Tests are excluded from the production build via `tsconfig.app.json` exclude patterns. Test files use the `*.test.ts` convention and live in `__tests__/` directories alongside the code they test.

## Features

- **Two Visualization Modes**: Hierarchical tree and Sankey diagram
- **Multiple Input Formats**: DBMS_XPLAN, SQL Monitor text, SQL Monitor XML
- **Runtime Statistics**: Display A-Rows, E-Rows, A-Time, and Starts from SQL Monitor
- **Node Indicator Metrics**: Configurable node badges showing cost, A-Rows, A-Time, starts, or activity %
- **Example Plans**: Auto-loaded sample plans from `src/examples/` (add .txt files, no code changes needed)
- **Plan Metadata**: SQL ID, Plan Hash, A-Rows, and A-Time shown in input panel header
- **Collapsible Input Panel**: More space for visualization when collapsed
- **Filter Panel**: Filter by operation type, cost threshold, search text, predicate type, and actual stats ranges
- **Search Highlighting**: Matching text highlighted in plan nodes
- **Node Details**: Click any node to see full attributes and predicates
- **Color Schemes**: Muted (default), vibrant, professional, and monochrome options
- **Settings Persistence**: View preferences saved to localStorage
- **Theme Toggle**: Light/dark mode with localStorage persistence
- **Sankey Metric Toggle**: Switch between Rows, Cost, A-Rows, or A-Time
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

## Code Conventions

- Use TypeScript strict mode
- React functional components with hooks
- Tailwind CSS for styling (dark mode via `dark:` prefix)
- Type imports use `import type { ... }`
