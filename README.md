# Oracle Execution Plan Visualizer

**[Open the App](https://davidbudac.github.io/ora-explain-plan-viz/)** - runs entirely in your browser, no data leaves your machine.

Turn Oracle execution plans into interactive visualizations. Paste your DBMS_XPLAN output, SQL Monitor report, or JSON plan data - the tool auto-detects the format and renders it instantly.

> No backend. No account. No data upload. Everything stays in your browser.

---

## Getting Your Plan Into the Tool

Paste any of these directly into the input panel and press **Cmd+Enter** (or click Parse):

| Format | How to get it |
|--------|---------------|
| **DBMS_XPLAN** | `SELECT * FROM TABLE(DBMS_XPLAN.DISPLAY_CURSOR('sql_id', NULL, 'ALLSTATS LAST'));` |
| **SQL Monitor (Text)** | `SELECT DBMS_SQL_MONITOR.REPORT_SQL_MONITOR(sql_id => 'sql_id') FROM dual;` |
| **SQL Monitor (XML)** | `SELECT DBMS_SQL_MONITOR.REPORT_SQL_MONITOR(sql_id => 'sql_id', type => 'XML') FROM dual;` |
| **JSON (V$SQL_PLAN)** | JSON array from `V$SQL_PLAN_STATISTICS_ALL` - compatible with [Datadog](https://explain.datadoghq.com) and [Tanel Poder's xbi.sql](https://github.com/tanelpoder) formats |

Don't have a plan handy? Pick one from the **Examples** dropdown to try the tool immediately.

## What You Can Do

### Visualize

Five ways to look at your plan:

- **Tree View** - interactive hierarchical layout with animated edges showing data flow. Drag nodes, zoom, pan, and navigate with arrow keys.
- **Sankey Diagram** - flow visualization showing data volume between operations. Toggle between Rows, Cost, A-Rows, or A-Time to see where work concentrates.
- **Table View** - sortable spreadsheet with inline bar charts for cost and time. Collapse subtrees to focus on specific branches. Hover operations to see predicates.
- **Plan Text** - the raw plan output for quick reference and copy-paste.
- **SQL Tab** - see the full SQL text when available from SQL Monitor input.

### Find Problems Fast

**Quick Analysis** surfaces issues automatically when runtime stats are available:

- **Hotspot detection** - the slowest node gets a red ring and "Hotspot" badge so it's immediately visible in the tree. The side panel shows the top 5 nodes by time and cost.
- **Cardinality mismatches** - nodes where actual rows diverge significantly from estimated rows are flagged with severity badges (warning at 3x, bad at 10x). Use the filter slider to isolate only mismatched nodes.
- **Spill-to-disk warnings** - nodes using temp space are badged so you can spot memory pressure.
- **Operation tooltips** - hover any node to see an expert description of what that Oracle operation does.

### Compare Two Plans

Load a plan into Plan A, then switch to Plan B and load another. Click **Compare** to see them side by side:

- Nodes are automatically matched between plans (by ID and heuristic matching)
- Delta calculations show improvements and regressions across cost, rows, bytes, A-Rows, A-Time, starts, temp space, and memory
- Split tree view shows both plans simultaneously with matched nodes aligned

### Annotate and Share

Build up an analysis and share it with your team:

- **Highlight nodes** with colors (red, orange, yellow, green, blue, purple, pink) in multiple visual styles: circle, tint, glow, dot, underline, or hachure
- **Add text notes** to individual nodes with timestamps
- **Group nodes** into named annotation groups with a shared color and description
- **Multi-select** nodes with Cmd/Ctrl-click to highlight or annotate in bulk
- **Export** the full annotated plan as JSON - import it on another machine to see the same analysis
- **Export as PNG** to share a snapshot of the visualization
- **Share via URL** to send a plan link that opens with your data pre-loaded

### Filter and Search

- **Search** by operation name, object name, or predicate text - matches are highlighted in the tree
- **Filter by operation type** - show only joins, table accesses, sorts, etc.
- **Filter by metric ranges** - cost, rows, A-Rows, A-Time sliders to narrow down to expensive operations
- **Filter by predicate type** - show only nodes with access or filter predicates
- **Cardinality mismatch slider** - set a threshold to show only nodes where estimates diverge from actuals

## Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| **Cmd+K** | Open command palette (search all actions) |
| **Cmd+Enter** | Parse the plan input |
| **F** | Maximize / restore the visualization |
| **Arrow keys** | Navigate between nodes (tree and table views) |
| **Cmd/Ctrl+Click** | Multi-select nodes |
| **Escape** | Deselect all nodes |

The **Cmd+K command palette** is the fastest way to access everything: switch views, toggle display options, change themes, export, and more. It stays open after toggling so you can change multiple settings in one go.

## Customize the Display

Open **Customize View** (or press Cmd+K) to control what's shown on each node:

- **Node fields**: operation name, object name, rows, cost, bytes, predicates, query blocks
- **Runtime fields**: A-Rows, A-Time, starts (only when actual stats are available)
- **Warning badges**: hotspot indicator, spill-to-disk, cardinality mismatch
- **Annotation visibility**: show or hide highlights and notes
- **Node metric badges**: pick what number appears on each node (cost, A-Rows, A-Time, starts, activity %)

Four color schemes are available: **Muted** (default), **Vibrant**, **Professional**, **Readable** (high-contrast with bold left-border stripes), and **Monochrome**. Switch between light and dark mode with the theme toggle.

All preferences are saved to your browser and persist between sessions.

## Run It Locally

```bash
git clone https://github.com/davidbudac/ora-explain-plan-viz.git
cd ora-explain-plan-viz
npm install
npm run dev
```

Open http://localhost:5173/ora-explain-plan-viz/

## License

MIT
