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

export interface SqlPatchScriptOptions {
  sqlId: string;
  hintText: string;
  name?: string;
  description?: string;
}

export type ExperimentKind = 'hint' | 'patch' | 'baseline' | 'params';

export interface ExperimentCandidate {
  id: string;
  title: string;
  rationale: string;
  kind: ExperimentKind;
  nodeIds: number[];
}

// Values land inside `DEFINE x = "..."` and '&x' substitutions; strip
// anything that could escape either context. UI validation (SQL_ID:
// /^[a-z0-9]{1,13}$/i) is stricter — this is a backstop, not the gatekeeper.
function sanitize(value: string): string {
  return value.replace(/["'&\r\n]/g, '');
}

// The hint text goes into a q'<open>...<close>' PL/SQL literal. Pick a
// delimiter pair the text does not close prematurely: prefer q'[...]',
// falling back to alternates when the text contains the closing sequence.
const Q_DELIMITERS: Array<[string, string]> = [
  ['[', ']'],
  ['{', '}'],
  ['<', '>'],
  ['(', ')'],
  ['!', '!'],
  ['#', '#'],
];

function quoteHintText(hintText: string): string {
  const text = hintText.replace(/\r?\n/g, ' ').trim();
  for (const [open, close] of Q_DELIMITERS) {
    if (!text.includes(`${close}'`)) {
      return `q'${open}${text}${close}'`;
    }
  }
  // Every alternate delimiter is closed by the text; fall back to a plain
  // quoted literal with doubled single quotes, which can express anything.
  return `'${text.replace(/'/g, "''")}'`;
}

function bannerLines(opts: SqlPatchScriptOptions): string[] {
  return [
    '-- SQL Patch creation script, stamped by the Oracle Plan Visualizer.',
    '--',
    '-- What this does: attaches the hint text below to the statement with the',
    '-- SQL_ID below via DBMS_SQLDIAG.CREATE_SQL_PATCH, so the optimizer applies',
    '-- the hints without changing the SQL text - useful for experimenting with',
    '-- alternative plans on statements you cannot edit.',
    '--',
    '-- Uses the Oracle 12c+ public signature (sql_id => ..., hint_text => ...).',
    '-- Requires Oracle 12.2 or newer for this exact call; no tuning pack needed.',
    ...(opts.description ? [`-- Purpose: ${opts.description}`] : []),
    '--',
    '-- Run this in SQL*Plus or SQLcl connected to the target database.',
  ];
}

function preCheckLines(): string[] {
  return [
    'PROMPT === Pre-check: existing SQL patches for this statement (if any) ===',
    'SELECT name, status, created, description',
    'FROM   dba_sql_patches',
    "WHERE  signature IN (SELECT exact_matching_signature",
    '                     FROM   v$sql',
    "                     WHERE  sql_id = '&sql_id');",
    '',
    'PROMPT A statement can only have one enabled SQL patch at a time - drop or',
    'PROMPT disable any conflicting patch above before creating a new one.',
  ];
}

function createBlockLines(opts: SqlPatchScriptOptions): string[] {
  const hintLiteral = quoteHintText(opts.hintText);
  return [
    'PROMPT === Creating the SQL patch ===',
    'DECLARE',
    '  l_patch_name  VARCHAR2(128);',
    'BEGIN',
    '  l_patch_name := DBMS_SQLDIAG.CREATE_SQL_PATCH(',
    "                    sql_id      => '&sql_id',",
    `                    hint_text   => ${hintLiteral},`,
    "                    name        => '&patch_name',",
    "                    description => 'Created by Oracle Plan Visualizer');",
    "  DBMS_OUTPUT.PUT_LINE('SQL patch created: ' || l_patch_name);",
    'END;',
    '/',
    '',
    '-- On Oracle 12.1 and older, CREATE_SQL_PATCH takes the SQL text instead',
    '-- of a SQL_ID (and lives in the internal DBMS_SQLDIAG_INTERNAL package',
    '-- before 12.1). Equivalent variant:',
    '--   l_patch_name := DBMS_SQLDIAG.CREATE_SQL_PATCH(',
    '--                     sql_text  => <the full SQL text as a CLOB>,',
    `--                     hint_text => ${hintLiteral},`,
    "--                     name      => '&patch_name');",
  ];
}

function verificationLines(): string[] {
  return [
    'PROMPT === Verification: SQL patches now present for this statement ===',
    'SELECT name, status, created, description',
    'FROM   dba_sql_patches',
    "WHERE  signature IN (SELECT exact_matching_signature",
    '                     FROM   v$sql',
    "                     WHERE  sql_id = '&sql_id');",
    '',
    'PROMPT Now re-run the statement and check its DBMS_XPLAN output - the Note',
    'PROMPT section must contain:',
    'PROMPT   "SQL patch \\"&patch_name\\" used for this statement"',
    'PROMPT Load the new plan back into the Plan Visualizer and use the Compare',
    'PROMPT view against the original plan.',
  ];
}

function cribSheetLines(): string[] {
  return [
    '-- ---------------------------------------------------------------------',
    '-- Managing this SQL patch later (informational - not executed by this script)',
    '-- ---------------------------------------------------------------------',
    '--',
    '-- Disable the patch without dropping it:',
    '--   BEGIN',
    '--     DBMS_SQLDIAG.ALTER_SQL_PATCH(',
    "--       name            => '&patch_name',",
    "--       attribute_name  => 'STATUS',",
    "--       attribute_value => 'DISABLED');",
    '--   END;',
    '--   /',
    '--',
    '-- Drop the patch:',
    '--   BEGIN',
    "--     DBMS_SQLDIAG.DROP_SQL_PATCH(name => '&patch_name');",
    '--   END;',
    '--   /',
  ];
}

export function buildSqlPatchScript(opts: SqlPatchScriptOptions): string {
  const sqlId = sanitize(opts.sqlId);
  const patchName = sanitize(opts.name ?? `PLANVIZ_PATCH_${opts.sqlId}`);

  const lines: string[] = [
    ...bannerLines(opts),
    '',
    'SET SERVEROUTPUT ON SIZE UNLIMITED',
    'SET LINESIZE 200',
    'SET VERIFY OFF',
    '',
    `DEFINE sql_id     = "${sqlId}"`,
    `DEFINE patch_name = "${patchName}"`,
    '',
    ...preCheckLines(),
    '',
    ...createBlockLines(opts),
    '',
    ...verificationLines(),
    '',
    ...cribSheetLines(),
    '',
    'UNDEFINE sql_id',
    'UNDEFINE patch_name',
  ];

  return lines.join('\n');
}

export function sqlPatchScriptFilename(opts: SqlPatchScriptOptions): string {
  const sqlId = sanitize(opts.sqlId).toLowerCase() || 'unknown';
  return `create_sql_patch_${sqlId}.sql`;
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
