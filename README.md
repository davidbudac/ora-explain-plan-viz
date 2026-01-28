# Oracle Execution Plan Visualizer

A client-side web application that parses Oracle DBMS_XPLAN output and renders interactive visualizations. No backend required - everything runs in your browser.

**Live Demo:** https://davidbudac.github.io/ora-explain-plan-viz/

## Features

- **Two Visualization Modes**
  - **Hierarchical Tree**: Traditional tree layout showing parent-child relationships with optional animated edges
  - **Sankey Diagram**: Flow visualization showing data movement through operations

- **Interactive Filtering**
  - Filter by operation type (Table Access, Index Operations, Joins, etc.)
  - Filter by predicate type (Access, Filter, or No Predicate)
  - Filter by minimum cost threshold
  - Text search across operations, objects, and predicates

- **Node Details Panel**: Click any node to see full attributes including predicates, cost, rows, and bytes

- **Query Block Visualization**: Visual grouping of nodes by query block with optional badges

- **Customizable Display**: Toggle visibility of rows, cost, bytes, predicates, and query block info

- **Dark/Light Mode**: Toggle between themes with localStorage persistence

- **Collapsible Minimap**: Navigate large plans with an expandable overview map

- **Fully Client-Side**: No data leaves your browser - paste your plan and visualize instantly

## Installation

```bash
# Clone the repository
git clone https://github.com/davidbudac/ora-explain-plan-viz.git
cd ora-explain-plan-viz

# Install dependencies
npm install
```

## Usage

### Development

```bash
# Start the development server
npm run dev
```

Then open http://localhost:5173/ora-explain-plan-viz/ in your browser.

### Production Build

```bash
# Build for production
npm run build

# Preview the production build locally
npm run preview
```

## How to Use

1. Generate an execution plan in Oracle using `DBMS_XPLAN.DISPLAY`:
   ```sql
   EXPLAIN PLAN FOR
   SELECT * FROM employees WHERE department_id = 10;

   SELECT * FROM TABLE(DBMS_XPLAN.DISPLAY);
   ```

2. Copy the output (including the table and predicate information)

3. Paste into the input panel and click "Parse Plan"

4. Explore the visualization using the three different view modes

### Supported Input Format

Standard Oracle DBMS_XPLAN.DISPLAY output:

```
Plan hash value: 1234567890

--------------------------------------------------------------------------------
| Id  | Operation                    | Name       | Rows  | Bytes | Cost (%CPU)|
--------------------------------------------------------------------------------
|   0 | SELECT STATEMENT             |            |     1 |    10 |     5   (0)|
|   1 |  NESTED LOOPS                |            |     1 |    10 |     5   (0)|
|*  2 |   INDEX RANGE SCAN           | EMP_IDX    |     1 |       |     2   (0)|
|   3 |   TABLE ACCESS BY INDEX ROWID| EMPLOYEES  |     1 |    10 |     3   (0)|
--------------------------------------------------------------------------------

Predicate Information (identified by operation id):
---------------------------------------------------
   2 - access("DEPARTMENT_ID"=10)
```

## Tech Stack

- **React 18** + **TypeScript**
- **Vite** - Build tool
- **React Flow** (@xyflow/react) - Graph visualization
- **D3-sankey** - Sankey diagram
- **Dagre** - Hierarchical layout algorithm
- **Tailwind CSS** - Styling

## License

MIT
