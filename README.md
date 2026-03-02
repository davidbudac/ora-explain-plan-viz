# Oracle Execution Plan Visualizer

A browser-based tool for analyzing Oracle SQL execution plans. Paste your plan output, get an interactive visualization that helps you find performance bottlenecks, cardinality misestimates, and inefficient operations - without uploading your data anywhere.

**Live Demo:** https://davidbudac.github.io/ora-explain-plan-viz/

## Why this tool?

Oracle execution plans are hard to read in text form, especially large ones with dozens of operations. This tool turns them into interactive visualizations where you can:

- **Spot the bottleneck instantly** - the hottest node (highest actual time) is automatically highlighted
- **Find cardinality misestimates** - see where the optimizer's row estimates were off by 10x or more, a common cause of bad plans
- **Compare two plans side by side** - load Plan A and Plan B to see what changed: which operations got faster, which got slower, and by how much
- **Trace data flow** - the Sankey view shows how rows flow through the plan, making it easy to see where volume explodes or gets filtered down
- **Annotate and share** - add notes and color highlights to specific nodes, then export the annotated plan as JSON to share with your team

Everything runs in your browser. No backend, no data upload, no account required.

## Supported Input Formats

Paste any of the following directly into the input panel:

**DBMS_XPLAN** - the standard Oracle explain plan output
```sql
SELECT * FROM TABLE(DBMS_XPLAN.DISPLAY_CURSOR('<sql_id>', NULL, 'ALLSTATS LAST'));
```

**SQL Monitor (Text)** - runtime statistics from SQL Monitor
```sql
SELECT DBMS_SQL_MONITOR.REPORT_SQL_MONITOR(sql_id => '<sql_id>') FROM dual;
```

**SQL Monitor (XML)** - the richest format with memory, I/O, predicates, and per-node timing
```sql
SELECT DBMS_SQL_MONITOR.REPORT_SQL_MONITOR(sql_id => '<sql_id>', type => 'XML') FROM dual;
```

**JSON (V$SQL_PLAN_STATISTICS_ALL)** - JSON array extracted from the performance views, as used by tools like [Datadog's explain visualizer](https://explain.datadoghq.com) and [Tanel Poder's scripts](https://github.com/tanelpoder)
```sql
SELECT JSON_ARRAYAGG(JSON_OBJECT(
  'id' VALUE id, 'parent_id' VALUE parent_id, 'depth' VALUE depth,
  'operation' VALUE operation, 'options' VALUE options,
  'object_name' VALUE object_name, 'object_alias' VALUE object_alias,
  'cost' VALUE cost, 'cardinality' VALUE cardinality, 'bytes' VALUE bytes,
  'access_predicates' VALUE access_predicates,
  'filter_predicates' VALUE filter_predicates,
  'actual_starts' VALUE last_starts,
  'actual_rows' VALUE last_output_rows,
  'actual_elapsed_time' VALUE last_elapsed_time,
  'actual_memory_used' VALUE last_memory_used,
  'actual_tempseg_size' VALUE last_tempseg_size
  ABSENT ON NULL
) ORDER BY id RETURNING CLOB) AS json_plan
FROM v$sql_plan_statistics_all
WHERE sql_id = '<sql_id>' AND child_number = <child_number>;
```

The tool auto-detects the format - just paste and go.

## Visualization Modes

- **Hierarchical Tree** - traditional tree layout with animated edges, keyboard navigation, and configurable node badges
- **Sankey Diagram** - flow visualization showing data volume between operations, switchable between rows, cost, actual rows, or actual time
- **Tabular View** - sortable spreadsheet-style view with collapsible nodes
- **Plan Text** - raw plan output for quick reference
- **Compare View** - side-by-side comparison of two plans with delta calculations across 8 metrics

## Analysis Features

- **Hot Node Detection** - automatically identifies the most expensive node and shows a top-5 hotspots summary
- **Cardinality Mismatch Analysis** - flags nodes where estimated vs. actual rows diverge (warning at 3x, critical at 10x), with a filter slider to focus on the worst offenders
- **Spill-to-Disk Warnings** - visual badges on nodes that use temp space
- **Operation Tooltips** - expert descriptions for ~50 Oracle operations explaining what each one does and what to watch for
- **Predicate Display** - view access and filter predicates per node with copy-to-clipboard
- **Plan Comparison** - 3-pass node matching algorithm (exact ID, heuristic, unmatched) with improvement/regression indicators

## Annotations

Add text notes and color highlights to individual nodes. Group related nodes together with named annotation groups. Export the full annotated plan as JSON and share it with your team - they can import it and see your analysis.

## Getting Started

The easiest way is to use the [live demo](https://davidbudac.github.io/ora-explain-plan-viz/). Or run it locally:

```bash
git clone https://github.com/davidbudac/ora-explain-plan-viz.git
cd ora-explain-plan-viz
npm install
npm run dev
```

Then open http://localhost:5173/ora-explain-plan-viz/ in your browser.

Several example plans are included in the dropdown menu to try without needing access to an Oracle database.

## License

MIT
