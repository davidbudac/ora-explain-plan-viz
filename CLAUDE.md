# Oracle Execution Plan Visualizer

A client-side web application that parses Oracle DBMS_XPLAN output and renders interactive visualizations.

## Tech Stack

- **Framework**: React 18 + TypeScript
- **Build Tool**: Vite
- **Graph Visualization**: React Flow (@xyflow/react)
- **Sankey Diagram**: D3-sankey
- **Layout Algorithm**: Dagre (for hierarchical layout)
- **Styling**: Tailwind CSS

## Project Structure

```
src/
├── lib/
│   ├── types.ts         # TypeScript interfaces, operation categories, colors
│   └── parser.ts        # DBMS_XPLAN text parser + sample plans
├── hooks/
│   └── usePlanContext.tsx   # Global state management (React Context)
├── components/
│   ├── Header.tsx           # App header with theme toggle
│   ├── InputPanel.tsx       # Collapsible input area for plan text
│   ├── FilterPanel.tsx      # Filter by operation type, cost, search
│   ├── NodeDetailPanel.tsx  # Shows selected node attributes
│   ├── VisualizationTabs.tsx # Tab switcher for 3 views
│   ├── Legend.tsx           # Hideable color legend
│   ├── nodes/
│   │   └── PlanNode.tsx     # Custom React Flow node component
│   └── views/
│       ├── HierarchicalView.tsx   # Tree layout (React Flow + Dagre)
│       ├── ForceDirectedView.tsx  # Force-directed graph
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

- **Three Visualization Modes**: Hierarchical tree, Force-directed graph, Sankey diagram
- **Collapsible Input Panel**: More space for visualization when collapsed
- **Filter Panel**: Filter by operation type, cost threshold, or search text
- **Node Details**: Click any node to see full attributes and predicates
- **Theme Toggle**: Light/dark mode with localStorage persistence
- **Sankey Metric Toggle**: Switch between Rows and Cost for link width
- **Hideable Legend**: Color coding reference that can be hidden
- **Fully Client-Side**: No backend, no data upload - everything runs in browser

## Supported Input Format

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

## Code Conventions

- Use TypeScript strict mode
- React functional components with hooks
- Tailwind CSS for styling (dark mode via `dark:` prefix)
- Type imports use `import type { ... }`
