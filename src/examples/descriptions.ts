/**
 * One-line "what this example teaches" blurbs for the bundled sample plans,
 * keyed by the example's file stem (`NN-category-Display Name`, no extension).
 *
 * `featured: true` puts the example on the start screen's example cards.
 * Examples without an entry here still load; they just show no description.
 */
export interface ExampleDescription {
  description: string;
  featured?: boolean;
}

export const EXAMPLE_DESCRIPTIONS: Record<string, ExampleDescription> = {
  '01-dbms_xplan-Simple Plan': {
    description: 'A small hash join over nested loops — the quickest tour of the tree and details panel.',
    featured: true,
  },
  '02-dbms_xplan-Complex Plan': {
    description: 'A multi-join plan with a large ORDER BY sort and estimated TEMP usage; practise reading cost and bytes.',
  },
  '12-json-JSON Plan (TPC-DS Hash Joins)': {
    description: 'V$SQL_PLAN rows exported as JSON: a chain of hash joins from a TPC-DS query.',
  },
  '13-xbi-XBI TPC-DS Query': {
    description: "Tanel Poder's xbi.sql output with per-step timings and real vs. estimated rows.",
    featured: true,
  },
  '14-xbi-XBI TPC-DS Temp Table': {
    description: 'xbi.sql output for a TEMP TABLE TRANSFORMATION (a WITH clause materialised once and reused).',
  },
  '17-sql_monitor-Exadata Cell Offload (K. Osborne)': {
    description: 'Exadata smart scan (TABLE ACCESS STORAGE FULL) and the cell offload column, from Kerry Osborne.',
  },
  '18-sql_monitor-Skewed Parallel (J. Lewis)': {
    description: "Parallel execution where a few PX servers do most of the work (Jonathan Lewis's case).",
  },
  '21-sql_monitor-Star Schema Rollup': {
    description: 'A star-schema GROUP BY ROLLUP; see where the time goes with real row counts.',
  },
  '22-sql_monitor-Cardinality Trap (NL)': {
    description: 'The optimizer expects a handful of rows and picks nested loops; reality is far bigger.',
    featured: true,
  },
  '23-sql_monitor-Window Sort Spill': {
    description: 'An analytic WINDOW SORT that spills to disk; spot it with the temp-space badges.',
  },
  '24-sql_monitor-Recursive BOM': {
    description: 'A recursive WITH (bill of materials): UNION ALL (RECURSIVE WITH) and the pump that feeds rows back in.',
  },
  '25-dbms_xplan-Partitioned Query': {
    description: 'Three partition access patterns side by side: RANGE ALL (no pruning), SINGLE and ITERATOR (Pstart/Pstop).',
  },
  '26-dbms_xplan-Parallel Query': {
    description: 'Reading PX COORDINATOR, table queues and distribution methods in a parallel plan.',
  },
  '27-sql_monitor-Partitioned Star Query': {
    description: 'A large SQL Monitor XML report of a partitioned star join — a good workout for the Tabular and Flame views.',
  },
  '28-sql_monitor-Partition Range Iterator': {
    description: 'Partition pruning via PARTITION RANGE ITERATOR, with a metadata bundle incl. constraints.',
    featured: true,
  },
};

export function getExampleDescription(stem: string): ExampleDescription | undefined {
  return Object.prototype.hasOwnProperty.call(EXAMPLE_DESCRIPTIONS, stem) ? EXAMPLE_DESCRIPTIONS[stem] : undefined;
}
