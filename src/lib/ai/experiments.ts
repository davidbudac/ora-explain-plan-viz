/**
 * Alternative-plan experiment helpers for the AI Test Case Builder (Phase 2).
 *
 * Two pieces live here:
 *
 * - `buildSqlPatchScript()` — a self-contained SQL*Plus / SQLcl script that
 *   creates a SQL Patch via DBMS_SQLDIAG.CREATE_SQL_PATCH, cloned from the
 *   `buildBaselineScript()` structure in `src/lib/baselineScript.ts`
 *   (banner → pre-checks → action block → verification → crib sheet →
 *   UNDEFINE). The app never runs this script — it only hands the user text
 *   to copy or download and run themselves.
 *
 * - `buildExperimentCandidates()` — derives simple, data-driven experiment
 *   candidates (hint / patch / baseline / parameter experiments) from the
 *   Plan Advisor's findings, for the AI layer to elaborate on.
 */

import type { AdvisorReport } from '../advisor/types';

export type { SqlPatchScriptOptions } from '../sqlPatchScript';
export { buildSqlPatchScript, sqlPatchScriptFilename } from '../sqlPatchScript';

export type ExperimentKind = 'hint' | 'patch' | 'baseline' | 'params';

export interface ExperimentCandidate {
  id: string;
  title: string;
  rationale: string;
  kind: ExperimentKind;
  nodeIds: number[];
}

// ---------------------------------------------------------------------------
// Experiment candidate derivation from advisor findings
// ---------------------------------------------------------------------------

interface CandidateTemplate {
  kind: ExperimentKind;
  title: string;
  rationale: string;
}

// Data-driven mapping from advisor ruleIds (src/lib/advisor/rules/) to
// experiment kinds. Rules without an entry produce no candidate.
const RULE_EXPERIMENTS: Record<string, CandidateTemplate> = {
  'cardinality-mismatch': {
    kind: 'hint',
    title: 'Correct the misestimate with fresh stats or a cardinality hint',
    rationale:
      'Estimated vs actual rows diverge sharply; re-gather statistics (with histograms) or test a CARDINALITY/OPT_ESTIMATE hint to see whether the plan changes.',
  },
  'stats-issues': {
    kind: 'hint',
    title: 'Re-gather statistics and re-explain',
    rationale:
      'The advisor flagged stale or missing statistics; refresh them with DBMS_STATS and compare the resulting plan.',
  },
  'spill-to-disk': {
    kind: 'params',
    title: 'Increase work-area memory to avoid the temp spill',
    rationale:
      'An operation spilled to temp; experiment with ALTER SESSION SET workarea_size_policy / pga_aggregate_target (or a MANUAL sort_area_size) to keep the workarea in memory.',
  },
  'index-exists-unused': {
    kind: 'hint',
    title: 'Force the unused index with an INDEX hint',
    rationale:
      'A plausible index exists but is not used; test an INDEX(alias index_name) hint to compare the indexed plan against the current one.',
  },
  'selective-full-scan': {
    kind: 'hint',
    title: 'Test an index access path for the selective full scan',
    rationale:
      'A full scan returns few rows; try an INDEX hint (or create a candidate index in a scratch schema) and compare.',
  },
  'implicit-conversion': {
    kind: 'hint',
    title: 'Fix the implicit datatype conversion',
    rationale:
      'A predicate applies an implicit conversion that disables index use; test an explicit conversion on the literal/bind side, or a function-based index.',
  },
  'merge-join-cartesian': {
    kind: 'hint',
    title: 'Break the cartesian merge join',
    rationale:
      'A MERGE JOIN CARTESIAN usually follows a row misestimate or missing join predicate; test LEADING/USE_HASH hints or fix the predicate.',
  },
  'nested-loop-volume': {
    kind: 'hint',
    title: 'Swap the high-volume nested loop for a hash join',
    rationale:
      'A nested loop drives a large row volume; test a USE_HASH hint on the join and compare buffer gets.',
  },
  'partition-no-pruning': {
    kind: 'params',
    title: 'Enable partition pruning',
    rationale:
      'The scan reads all partitions; ensure the partition key appears in the predicates (typed correctly) and re-explain.',
  },
  'dop-downgrade': {
    kind: 'params',
    title: 'Investigate the parallel downgrade',
    rationale:
      'The statement ran at a lower DOP than requested; experiment with parallel_degree_policy / parallel_max_servers session settings.',
  },
  'per-row-reexecution': {
    kind: 'hint',
    title: 'Unnest the per-row subquery or rewrite it as a join',
    rationale:
      'A subquery is started once per outer row; test the UNNEST hint (or the NO_UNNEST/ NO_PUSH_SUBQ counterparts to compare), rewrite it as a join or semi/anti-join, or wrap a deterministic PL/SQL function in a scalar subquery cache or RESULT_CACHE and compare the Starts of the inner side.',
  },
  'index-rows-discarded': {
    kind: 'params',
    title: 'Extend the index with the filter column in a scratch schema',
    rationale:
      'The index returns many rows that the table access then discards on a filter; in a scratch schema, create a variant of the index that also carries the filtering column (DDL experiment), re-gather statistics and compare rows and buffer gets of the table access.',
  },
  'buffer-gets-per-row': {
    kind: 'params',
    title: 'Test a tighter access path for the buffer-hungry access',
    rationale:
      'The access reads far more blocks than the rows it returns; in a scratch schema test a composite index covering the predicates (or a better-clustered/rebuilt index), or an INDEX hint on the more selective index, and compare buffer gets per row.',
  },
  'function-on-indexed-column': {
    kind: 'params',
    title: 'Add a function-based index or make the predicate sargable',
    rationale:
      'A function wraps an indexed column so the index cannot be used for access; test a function-based index on the same expression in a scratch schema, or rewrite the predicate to compare the bare column (for example a range instead of TRUNC(col)).',
  },
  'hash-join-build-side': {
    kind: 'hint',
    title: 'Swap the hash join inputs',
    rationale:
      'The larger input builds the hash table; test SWAP_JOIN_INPUTS(alias) on the join (or a LEADING hint that puts the smaller row source first) and compare memory use, temp spill and elapsed time.',
  },
  'note-dynamic-sampling': {
    kind: 'hint',
    title: 'Replace dynamic sampling with gathered statistics',
    rationale:
      'The optimizer sampled at parse time because statistics are missing or insufficient; gather statistics with DBMS_STATS (including column groups or histograms as needed) and compare the plan with and without a DYNAMIC_SAMPLING hint.',
  },
  'note-sql-plan-directive': {
    kind: 'params',
    title: 'Gather statistics to retire the SQL plan directive',
    rationale:
      'A SQL plan directive says the optimizer misestimated this query shape before; gather extended statistics (column groups) on the directive columns and re-explain to see whether the estimates and plan stabilise.',
  },
  'parallel-serial-feed': {
    kind: 'hint',
    title: 'Make the serial producer parallel',
    rationale:
      'A serial row source feeds the parallel servers; test PARALLEL(alias degree) on the serial table or index (or a PARALLEL_ENABLE function) and check that the S->P transition disappears.',
  },
  'px-skew': {
    kind: 'hint',
    title: 'Try other PQ distribution methods for the skewed set',
    rationale:
      'One PX server did much more work than its peers; test PQ_DISTRIBUTE(alias outer_distribution inner_distribution) with BROADCAST, NONE or HYBRID HASH variants on the joins feeding that server set and compare per-server elapsed time.',
  },
};

export function buildExperimentCandidates(advisorReport: AdvisorReport | null): ExperimentCandidate[] {
  if (!advisorReport || advisorReport.findings.length === 0) return [];

  const candidates: ExperimentCandidate[] = [];
  const seen = new Set<string>();

  for (const finding of advisorReport.findings) {
    const template = RULE_EXPERIMENTS[finding.ruleId];
    if (!template) continue;
    const id = `exp-${finding.ruleId}-${finding.nodeIds.join('-') || 'plan'}`;
    if (seen.has(id)) continue;
    seen.add(id);
    candidates.push({
      id,
      title: template.title,
      rationale: `${template.rationale} (Advisor: ${finding.title})`,
      kind: template.kind,
      nodeIds: [...finding.nodeIds],
    });
  }

  return candidates;
}
