import type { ViewMode } from '../lib/types';

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
  /** View the example opens in (defaults to whatever view is active). */
  view?: ViewMode;
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
  // Verbatim from Tanel Poder, "xb.sql and xbi.sql - Explain Oracle Execution Plans Better! (Part 2)":
  // https://tanelpoder.com/posts/xb-sql-script-explain-oracle-plan-better-part-2/ (his post omits the predicate section).
  '13-xbi-XBI TPC-DS Query': {
    description: "Tanel Poder's xbi.sql output: per-step timings, Starts, and real vs. estimated rows for a nested-loop join.",
    featured: true,
  },
  // Verbatim from the same Tanel Poder post (Part 2); his output starts at the column header, no banner.
  '14-xbi-XBI TPC-DS Temp Table': {
    description: 'xbi.sql output for a TEMP TABLE TRANSFORMATION: a WITH clause materialised once (CURSOR DURATION MEMORY) and read twice.',
  },
  // Kerry Osborne, "Realtime SQL Monitoring – Designed with Exadata in Mind" (2011):
  // https://kerryosborne.oracle-guy.com/2011/04/realtime-sql-monitoring-designed-with-exadata-in-mind/
  '17-sql_monitor-Exadata Cell Offload (K. Osborne)': {
    description: 'Exadata smart scan (TABLE ACCESS STORAGE FULL) and the cell offload column, from Kerry Osborne.',
  },
  // Jonathan Lewis, "Case Study" (June 2022): https://jonathanlewis.wordpress.com/2022/06/17/case-study-5/
  '18-sql_monitor-Skewed Parallel (J. Lewis)': {
    description: "Captured mid-run: one PX server (p008) does ~99% of the work and spills 2 GB to temp in a BUFFER SORT (Jonathan Lewis's case study).",
  },
  '21-sql_monitor-Star Schema Rollup': {
    description: 'A healthy baseline: a star-schema GROUP BY ROLLUP where every estimate tracks the actual rows.',
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
