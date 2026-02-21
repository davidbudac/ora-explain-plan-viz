# Oracle Execution Plan Visualizer

Parses and visualizes Oracle execution plans from `DBMS_XPLAN` and `DBMS_SQL_MONITOR` output. More input sources coming soon. It provides interactive filtering, multiple visualization modes (hierarchical tree and Sankey diagram), and detailed node information to help analyze query performance.

**Live Demo:** https://davidbudac.github.io/ora-explain-plan-viz/

It's a work in progress, and I'll probably break things from time to time as I work on it.

## How to use

1. Generate an execution plan in Oracle using
   ```sql
   select * from table(dbms_xplan.display_cursor('<sql_id>', 'null', 'ALLSTATS LAST'));>'));
   ```
   or for sql monitor (text or XML):
   ```sql
   -- Text format
   select dbms_sql_monitor.report_sql_monitor(sql_id => '<sql_id>') from dual;
   -- XML format (richest data: memory, I/O, predicates)
   select dbms_sql_monitor.report_sql_monitor(sql_id => '<sql_id>', type => 'XML') from dual;
   ```
2. Copy the output (including the table and predicate information)
3. Paste into the input panel and click "Parse Plan"
4. Explore the visualization using the three different view modes


## Features

- **Three Visualization Modes**
  - **Hierarchical Tree**: Traditional tree layout showing parent-child relationships with optional animated edges
  - **Sankey Diagram**: Flow visualization showing data movement through operations
  - **Plan Text**: Raw plan output in monospace format for quick reference

- **Performance Analysis**
  - **Hot Node Detection**: Automatically highlights the most expensive node (highest A-Time) with a red ring and badge
  - **Hotspots Summary**: Top 5 nodes ranked by A-Time, Cost, and cardinality mismatch (clickable to navigate)
  - **Cardinality Mismatch Analysis**: Detects E-Rows vs A-Rows divergence with severity badges (warn at 3x, critical at 10x)
  - **Spill-to-Disk Warnings**: Visual alerts on nodes that use temp space
  - **Operation Tooltips**: Expert descriptions for ~50 Oracle operations on hover

- **Interactive Filtering**
  - Filter by operation type (Table Access, Index Operations, Joins, etc.)
  - Filter by predicate type (Access, Filter, or No Predicate)
  - Filter by minimum cost threshold, A-Rows, A-Time ranges
  - Filter by cardinality mismatch threshold
  - Text search across operations, objects, and predicates

- **Keyboard Navigation**: Arrow keys to navigate parent/child/sibling nodes, Escape to deselect

- **Node Details Panel**: Click any node to see full attributes including predicates, cost, rows, cardinality analysis, and spill warnings. Copy-to-clipboard on predicates.

- **Query Block Visualization**: Visual grouping of nodes by query block with optional badges

- **Customizable Display**: Toggle visibility of rows, cost, bytes, predicates, and query block info

- **Dark/Light Mode**: Toggle between themes with localStorage persistence

- **Collapsible Minimap**: Navigate large plans with an expandable overview map

- **Fully Client-Side**: No data leaves your browser - paste your plan and visualize instantly


### Features in the works but not yet implemented in the UI:

- Multiple plans side by side for comparison with visual highlighting of differences
- Support for annotation of plans and their export/import for sharing with others


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

### Testing

```bash
# Run all tests
npx vitest run --environment jsdom

# Run tests in watch mode
npx vitest --environment jsdom
```

Tests use [Vitest](https://vitest.dev/) with jsdom and cover the parser logic (SQL Monitor XML format parsing, tree building, metadata extraction, backward compatibility).

## License

MIT
