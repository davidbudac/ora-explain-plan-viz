# Oracle Execution Plan Visualizer

A client-side web application that parses Oracle execution plan output and renders interactive visualizations. Supports DBMS_XPLAN output and SQL Monitor reports.

## Tech Stack

- **Framework**: React 18 + TypeScript
- **Build Tool**: Vite
- **Graph Visualization**: React Flow (@xyflow/react)
- **Sankey Diagram**: D3-sankey
- **Layout Algorithm**: Custom tree layout (with Dagre fallback)
- **Styling**: Tailwind CSS

## Project Structure

```
src/
├── lib/
│   ├── types.ts         # TypeScript interfaces, operation categories, colors
│   ├── settings.ts      # User settings persistence (localStorage)
│   ├── parser.ts        # Legacy parser (kept for compatibility)
│   └── parser/          # Modular parser system
│       ├── index.ts           # Parser orchestration, format detection
│       ├── types.ts           # Parser interfaces
│       ├── dbmsXplanParser.ts # DBMS_XPLAN text parser
│       └── sqlMonitorParser.ts # SQL Monitor text/XML parsers
├── hooks/
│   └── usePlanContext.tsx   # Global state management (React Context)
├── components/
│   ├── Header.tsx           # App header with theme toggle
│   ├── InputPanel.tsx       # Collapsible input with example loader
│   ├── FilterPanel.tsx      # Filter by operation type, cost, search
│   ├── NodeDetailPanel.tsx  # Shows selected node attributes + runtime stats
│   ├── VisualizationTabs.tsx # Tab switcher for views
│   ├── Legend.tsx           # Hideable color legend
│   ├── CollapsibleMiniMap.tsx # Toggleable minimap for navigation
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

## Features

- **Two Visualization Modes**: Hierarchical tree and Sankey diagram
- **Multiple Input Formats**: DBMS_XPLAN, SQL Monitor text, SQL Monitor XML
- **Runtime Statistics**: Display A-Rows, E-Rows, A-Time, and Starts from SQL Monitor
- **Example Plans**: Built-in sample plans for quick testing
- **Collapsible Input Panel**: More space for visualization when collapsed
- **Filter Panel**: Filter by operation type, cost threshold, or search text
- **Node Details**: Click any node to see full attributes and predicates
- **Settings Persistence**: View preferences saved to localStorage
- **Theme Toggle**: Light/dark mode with localStorage persistence
- **Sankey Metric Toggle**: Switch between Rows, Cost, A-Rows, or A-Time
- **Collapsible Minimap**: Navigation aid for large plans
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

## Code Conventions

- Use TypeScript strict mode
- React functional components with hooks
- Tailwind CSS for styling (dark mode via `dark:` prefix)
- Type imports use `import type { ... }`
