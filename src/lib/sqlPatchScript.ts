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

// Oracle stores hint text in 500-character pieces (sqlobj$data <hint>
// elements) and cuts blindly at every 500th character, so a hint straddling a
// boundary becomes a syntax error. Hints are therefore packed into chunks of at
// most this many characters and each chunk is RPAD-ed to exactly this length.
const HINT_PIECE = 500;

// A newline counts as two characters so a script saved with CRLF line endings
// still fits.
function chunkLength(hints: string[]): number {
  return hints.reduce((n, h) => n + h.length, 0) + 2 * Math.max(0, hints.length - 1);
}

// Greedy, in order: a hint goes into the current chunk while it still fits.
function packChunks(lines: string[]): string[][] {
  const chunks: string[][] = [];
  let current: string[] = [];
  for (const line of lines) {
    if (current.length > 0 && chunkLength([...current, line]) > HINT_PIECE) {
      chunks.push(current);
      current = [];
    }
    current.push(line);
  }
  if (current.length > 0) chunks.push(current);
  return chunks;
}

interface Quoting {
  open: string;
  close: string;
  escape: (text: string) => string;
}

function chooseQuoting(lines: string[]): Quoting {
  const whole = lines.join('\n');
  for (const [open, close] of Q_DELIMITERS) {
    if (!whole.includes(`${close}'`)) {
      return { open: `q'${open}`, close: `${close}'`, escape: (t) => t };
    }
  }
  // Every alternate delimiter is closed by the text; fall back to a plain
  // quoted literal with doubled single quotes, which can express anything.
  return { open: "'", close: "'", escape: (t) => t.replace(/'/g, "''") };
}

interface HintAssignment {
  lines: string[];
  oversized: string[];
}

// Builds the `l_hint_text := ...` assignment: one RPAD(<literal>, 500) per
// chunk, one hint per literal line (no indentation - it would count toward the
// 500). A hint over 500 characters cannot be protected, and RPAD would
// truncate it, so its chunk is emitted as a bare literal.
function hintAssignment(hintText: string): HintAssignment {
  const lines = hintLines(hintText);
  const quoting = chooseQuoting(lines);
  const chunks = packChunks(lines);
  if (chunks.length === 0) {
    return { lines: [`  l_hint_text := ${quoting.open}${quoting.close};`], oversized: [] };
  }
  const oversized: string[] = [];
  const out: string[] = ['  l_hint_text :='];
  chunks.forEach((chunk, i) => {
    const last = i === chunks.length - 1;
    const tooLong = chunkLength(chunk) > HINT_PIECE;
    if (tooLong) oversized.push(chunk[0]);
    const body = chunk.map(quoting.escape);
    body[0] = quoting.open + body[0];
    body[body.length - 1] += quoting.close;
    if (!tooLong) {
      body[0] = `RPAD(${body[0]}`;
      body[body.length - 1] += `, ${HINT_PIECE})`;
    }
    body[0] = `    ${body[0]}`;
    body[body.length - 1] += last ? ';' : ' ||';
    out.push(...body);
  });
  return { lines: out, oversized };
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
    '-- Oracle stores hint text in 500-character pieces and splits blindly, so the',
    '-- hints are packed into 500-character chunks (RPAD) that never cut a hint.',
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
  const { lines: assignment, oversized } = hintAssignment(opts.hintText);
  return [
    ...oversized.map(
      (h) =>
        `-- WARNING: the hint ${h.length > 60 ? `${h.slice(0, 57)}...` : h} is over ${HINT_PIECE} characters;` +
        ' Oracle 19c may split it and reject the patch.',
    ),
    'PROMPT === Creating the SQL patch ===',
    'DECLARE',
    '  l_patch_name  VARCHAR2(128);',
    '  l_hint_text   CLOB;',
    'BEGIN',
    '  -- Oracle stores hint text in 500-character pieces and splits blindly, so the',
    '  -- hints are packed into 500-character chunks (RPAD) that never cut a hint.',
    ...assignment,
    '  l_patch_name := DBMS_SQLDIAG.CREATE_SQL_PATCH(',
    "                    sql_id      => '&sql_id',",
    '                    hint_text   => l_hint_text,',
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
    '--                     hint_text => l_hint_text,',
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
    'PROMPT   SQL patch "&patch_name" used for this statement',
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
