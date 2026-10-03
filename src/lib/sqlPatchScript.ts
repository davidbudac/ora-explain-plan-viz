/**
 * Builds a self-contained SQL*Plus / SQLcl script that creates a SQL Patch via
 * DBMS_SQLDIAG.CREATE_SQL_PATCH, cloned from the `buildBaselineScript()`
 * structure in `./baselineScript.ts` (banner -> pre-checks -> action block ->
 * verification -> crib sheet -> UNDEFINE). The app never runs this script -- it
 * only hands the user text to copy or download and run themselves.
 */

export interface SqlPatchScriptOptions {
  sqlId: string;
  hintText: string;
  name?: string;
  description?: string;
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

// One hint per line: Oracle treats newlines in hint text as whitespace, and
// keeping the lines short stays clear of the SQL*Plus ~2499-char line limit
// that a full outline on a single line would hit.
function hintLines(hintText: string): string[] {
  return hintText
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l !== '');
}

// Returns the literal as lines: the first starts with the opening quote, the
// last ends with the closing one, and continuation lines carry no indent (the
// caller indents them under the first).
function quoteHintLines(hintText: string): string[] {
  const lines = hintLines(hintText);
  const whole = lines.join('\n');
  for (const [open, close] of Q_DELIMITERS) {
    if (!whole.includes(`${close}'`)) {
      return withWrapper(lines, `q'${open}`, `${close}'`);
    }
  }
  // Every alternate delimiter is closed by the text; fall back to a plain
  // quoted literal with doubled single quotes, which can express anything.
  return withWrapper(
    lines.map((l) => l.replace(/'/g, "''")),
    "'",
    "'",
  );
}

function withWrapper(lines: string[], open: string, close: string): string[] {
  if (lines.length === 0) return [`${open}${close}`];
  const out = [...lines];
  out[0] = open + out[0];
  out[out.length - 1] += close;
  return out;
}

// Lays the literal out after `prefix` (e.g. `hint_text   => `), continuation
// lines aligned under the first hint. `trailer` follows the closing quote.
function layoutLiteral(prefix: string, literal: string[], trailer: string, linePrefix = ''): string[] {
  const pad = ' '.repeat(prefix.length + (literal[0].startsWith('q') ? 3 : 1));
  return literal.map((l, i) => {
    const text = i === 0 ? prefix + l : pad + l;
    return linePrefix + text + (i === literal.length - 1 ? trailer : '');
  });
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
    '--',
    '-- CREATE_SQL_PATCH(sql_id => ...) looks the statement up, so it must still be',
    '-- in the cursor cache (or AWR) when this script runs - run the statement',
    '-- first if it has aged out. Only one enabled SQL patch applies per statement.',
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
  const literal = quoteHintLines(opts.hintText);
  return [
    'PROMPT === Creating the SQL patch ===',
    'DECLARE',
    '  l_patch_name  VARCHAR2(128);',
    'BEGIN',
    '  l_patch_name := DBMS_SQLDIAG.CREATE_SQL_PATCH(',
    "                    sql_id      => '&sql_id',",
    ...layoutLiteral('                    hint_text   => ', literal, ','),
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
    ...layoutLiteral('                     hint_text => ', literal, ',', '--'),
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
