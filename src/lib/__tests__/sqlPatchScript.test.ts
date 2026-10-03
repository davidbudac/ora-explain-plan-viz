import { describe, expect, it } from 'vitest';
import { buildSqlPatchScript, sqlPatchScriptFilename } from '../sqlPatchScript';

const base = { sqlId: 'abc123def4567', hintText: 'FULL(@SEL$1 E@SEL$1)' };

describe('buildSqlPatchScript', () => {
  it('emits the full structure: banner, defines, pre-check, create block, verification, crib sheet, undefines', () => {
    const script = buildSqlPatchScript(base);
    const markers = [
      '-- SQL Patch creation script, stamped by the Oracle Plan Visualizer.',
      'SET SERVEROUTPUT ON SIZE UNLIMITED',
      'DEFINE sql_id     = "abc123def4567"',
      'DEFINE patch_name = "PLANVIZ_PATCH_abc123def4567"',
      'PROMPT === Pre-check: existing SQL patches for this statement (if any) ===',
      'FROM   dba_sql_patches',
      'PROMPT === Creating the SQL patch ===',
      "RPAD(q'[FULL(@SEL$1 E@SEL$1)]', 500);",
      'DBMS_SQLDIAG.CREATE_SQL_PATCH(',
      "sql_id      => 'abc123def4567',",
      'hint_text   => l_hint_text,',
      'PROMPT === Verification: SQL patches now present for this statement ===',
      '-- Managing this SQL patch later (informational - not executed by this script)',
      'DBMS_SQLDIAG.ALTER_SQL_PATCH(',
      "DBMS_SQLDIAG.DROP_SQL_PATCH(name => '&patch_name');",
      'UNDEFINE sql_id',
      'UNDEFINE patch_name',
    ];
    let last = -1;
    for (const marker of markers) {
      const idx = script.indexOf(marker);
      expect(idx, marker).toBeGreaterThan(last);
      last = idx;
    }
  });

  it('includes the commented 12c sql_text variant note', () => {
    const script = buildSqlPatchScript(base);
    expect(script).toContain('-- On Oracle 12.1 and older, CREATE_SQL_PATCH takes the SQL text instead');
    expect(script).toContain('--                     sql_text  => <the full SQL text as a CLOB>,');
  });

  it('tells the user to check the plan Note section for the patch', () => {
    const script = buildSqlPatchScript(base);
    expect(script).toContain('PROMPT   SQL patch "&patch_name" used for this statement');
    expect(script).toContain('PROMPT section must contain:');
  });

  it('sanitizes sql_id and custom name', () => {
    const script = buildSqlPatchScript({
      ...base,
      sqlId: "abc'&\"12\n3",
      name: 'MY"PATCH&1',
    });
    expect(script).toContain('DEFINE sql_id     = "abc123"');
    expect(script).toContain('DEFINE patch_name = "MYPATCH1"');
  });

  it("uses an alternate q-quote delimiter when the hint contains ]'", () => {
    const script = buildSqlPatchScript({ ...base, hintText: "INDEX(t x[1]')" });
    expect(script).toContain("RPAD(q'{INDEX(t x[1]')}', 500);");
    expect(script).not.toContain("q'[INDEX");
  });

  it('falls back to a doubled-quote literal when every delimiter is exhausted', () => {
    const hint = "]' }' >' )' !' #'";
    const script = buildSqlPatchScript({ ...base, hintText: hint });
    expect(script).toContain("RPAD(']'' }'' >'' )'' !'' #''', 500);");
  });

  it('includes an optional description in the banner', () => {
    const script = buildSqlPatchScript({ ...base, description: 'try hash join' });
    expect(script).toContain('-- Purpose: try hash join');
  });
});

const REAL_OUTLINE = [
  'IGNORE_OPTIM_EMBEDDED_HINTS',
  "OPTIMIZER_FEATURES_ENABLE('19.1.0')",
  "DB_VERSION('19.1.0')",
  'ALL_ROWS',
  'OUTLINE_LEAF(@"SEL$EE94F965")',
  'MERGE(@"SEL$9E43CB6E" >"SEL$4")',
  'OUTLINE(@"SEL$4")',
  'OUTLINE(@"SEL$9E43CB6E")',
  'MERGE(@"SEL$58A6D7F6" >"SEL$3")',
  'OUTLINE(@"SEL$3")',
  'OUTLINE(@"SEL$58A6D7F6")',
  'MERGE(@"SEL$1" >"SEL$2")',
  'OUTLINE(@"SEL$2")',
  'OUTLINE(@"SEL$1")',
  'FULL(@"SEL$EE94F965" "C"@"SEL$3")',
  'FULL(@"SEL$EE94F965" "S"@"SEL$1")',
  'FULL(@"SEL$EE94F965" "T"@"SEL$2")',
  'FULL(@"SEL$EE94F965" "P"@"SEL$1")',
  'LEADING(@"SEL$EE94F965" "C"@"SEL$3" "S"@"SEL$1" "T"@"SEL$2" "P"@"SEL$1")',
  'USE_HASH(@"SEL$EE94F965" "S"@"SEL$1")',
  'USE_HASH(@"SEL$EE94F965" "T"@"SEL$2")',
  'USE_HASH(@"SEL$EE94F965" "P"@"SEL$1")',
  'SWAP_JOIN_INPUTS(@"SEL$EE94F965" "T"@"SEL$2")',
  'SWAP_JOIN_INPUTS(@"SEL$EE94F965" "P"@"SEL$1")',
];

// Content of each RPAD(q'[...]', 500) chunk (the literal body).
function chunksOf(script: string): string[] {
  return [...script.matchAll(/RPAD\(q'\[([\s\S]*?)\]', 500\)/g)].map((m) => m[1]);
}

// Newlines count as two characters so a CRLF-saved script still fits.
const pieceLength = (chunk: string) => chunk.replace(/\n/g, '\r\n').length;

describe('buildSqlPatchScript hint layout', () => {
  const hints = ['FULL(@"SEL$1" "E"@"SEL$1")', 'INDEX(@"SEL$1" "D"@"SEL$1" ("DEPT"."ID"))', 'LEADING(@"SEL$1" "E"@"SEL$1" "D"@"SEL$1")'];

  it('puts a small hint set into exactly one RPAD chunk passed through l_hint_text', () => {
    const script = buildSqlPatchScript({ ...base, hintText: hints.join('\n') });
    expect(script.match(/RPAD\(/g)).toHaveLength(1);
    expect(chunksOf(script)).toEqual([hints.join('\n')]);
    expect(script).toContain('  l_hint_text   CLOB;');
    expect(script).toContain('hint_text   => l_hint_text,');
    expect(script).toContain('hints are packed into 500-character chunks (RPAD)');
  });

  it('keeps one hint per line with no indentation inside the literal', () => {
    const script = buildSqlPatchScript({ ...base, hintText: hints.join('\n') });
    const lines = script.split('\n');
    const first = lines.findIndex((l) => l.includes("RPAD(q'[" + hints[0]));
    expect(first).toBeGreaterThan(-1);
    expect(lines[first + 1]).toBe(hints[1]);
    expect(lines[first + 2]).toBe(hints[2] + "]', 500);");
  });

  it('trims lines and drops blank ones', () => {
    const script = buildSqlPatchScript({ ...base, hintText: '\n  FULL(a)  \r\n\n\t\n INDEX(b) \n' });
    expect(script).toContain("RPAD(q'[FULL(a)\nINDEX(b)]', 500);");
  });

  it('packs the real 24-hint 19c outline into chunks that never split a hint', () => {
    const script = buildSqlPatchScript({ ...base, hintText: REAL_OUTLINE.join('\n') });
    const chunks = chunksOf(script);
    expect(chunks.length).toBeGreaterThanOrEqual(2);
    for (const chunk of chunks) expect(pieceLength(chunk)).toBeLessThanOrEqual(500);
    // all hints present, in order, each whole inside exactly one chunk
    expect(chunks.flatMap((c) => c.split('\n'))).toEqual(REAL_OUTLINE);
    expect(script).not.toContain('WARNING');
    expect(Math.max(...script.split('\n').map((l) => l.length))).toBeLessThan(2000);
    // chunks are concatenated with || and the last one ends the statement
    expect(script).toContain("l_hint_text :=\n    RPAD(q'[");
    expect(script.match(/, 500\) \|\|\n/g)).toHaveLength(chunks.length - 1);
    expect(script).toContain(", 500);\n  l_patch_name :=");
  });

  it('emits a hint over 500 characters without RPAD and warns about it', () => {
    const big = `INDEX(@"SEL$1" "T"@"SEL$1" ("${'C'.repeat(600)}"))`;
    const script = buildSqlPatchScript({ ...base, hintText: ['FULL(a)', big, 'FULL(b)'].join('\n') });
    expect(script).toContain('-- WARNING: the hint INDEX(@"SEL$1"');
    expect(script).toContain('is over 500 characters');
    expect(script.indexOf('-- WARNING')).toBeLessThan(script.indexOf('DECLARE'));
    expect(script).toContain(`\n    q'[${big}]' ||\n`);
    expect(script).not.toContain(`${big}]', 500)`);
    expect(script).toContain("RPAD(q'[FULL(a)]', 500) ||");
    expect(script).toContain("RPAD(q'[FULL(b)]', 500);");
  });

  it('keeps the commented 12.1 variant commented and on l_hint_text', () => {
    const script = buildSqlPatchScript({ ...base, hintText: hints.join('\n') });
    const lines = script.split('\n');
    const idx = lines.findIndex((l) => l.startsWith('--') && l.includes('hint_text => l_hint_text'));
    expect(idx).toBeGreaterThan(-1);
    expect(lines[idx - 1].startsWith('--')).toBe(true);
    expect(lines[idx + 1].startsWith('--')).toBe(true);
  });

  it('produces no line over 2000 chars for a ~5 KB outline', () => {
    const outline = Array.from(
      { length: 60 },
      (_, i) => `INDEX_RS_ASC(@"SEL$${i}" "T${i}"@"SEL$${i}" ("TABLE_${i}"."COLUMN_NAME_${i}"))`,
    );
    const big = outline.concat(outline).join('\n');
    expect(big.length).toBeGreaterThan(5000);
    const script = buildSqlPatchScript({ ...base, hintText: big });
    const longest = Math.max(...script.split('\n').map((l) => l.length));
    expect(longest).toBeLessThan(2000);
    for (const chunk of chunksOf(script)) expect(pieceLength(chunk)).toBeLessThanOrEqual(500);
  });

  it('checks the whole multi-line text when picking the q-delimiter', () => {
    const script = buildSqlPatchScript({ ...base, hintText: "FULL(a)\nINDEX(t x[1]')" });
    expect(script).toContain("RPAD(q'{FULL(a)\n");
    expect(script).toContain("INDEX(t x[1]')}', 500);");
  });

  it('falls back to a doubled-quote literal across lines', () => {
    const script = buildSqlPatchScript({ ...base, hintText: "]' }' >'\n)' !' #'" });
    expect(script).toContain("RPAD(']'' }'' >''\n");
    expect(script).toContain(")'' !'' #''', 500);");
  });

  it('measures chunk length on the unescaped text in the doubled-quote fallback', () => {
    // Each hint is 17 chars unescaped (23 escaped): 26 fit per chunk unescaped.
    const hint = "]' }' >' )' !' #'";
    const script = buildSqlPatchScript({ ...base, hintText: Array(52).fill(hint).join('\n') });
    const chunks = [...script.matchAll(/RPAD\('([\s\S]*?)', 500\)/g)].map((m) => m[1].replace(/''/g, "'"));
    expect(chunks).toHaveLength(2);
    for (const chunk of chunks) {
      expect(chunk.split('\n')).toHaveLength(26);
      expect(pieceLength(chunk)).toBeLessThanOrEqual(500);
    }
  });

  it('notes that the statement must be in the cursor cache or AWR', () => {
    const script = buildSqlPatchScript(base);
    expect(script).toContain('in the cursor cache (or AWR)');
    expect(script).toContain('Only one enabled SQL patch applies per statement');
  });
});

describe('buildSqlPatchScript ampersands and description', () => {
  it('turns substitution off around the create block so & in hints is literal', () => {
    const script = buildSqlPatchScript({ ...base, hintText: 'OPT_PARAM(\'a\' \'b&c\')' });
    const off = script.indexOf('SET DEFINE OFF');
    const on = script.indexOf("SET DEFINE '&'");
    const amp = script.indexOf('b&c');
    expect(off).toBeGreaterThan(-1);
    expect(amp).toBeGreaterThan(off);
    expect(on).toBeGreaterThan(amp);
    // No substitution variable is used between the two switches.
    expect(script.slice(off, on)).not.toMatch(/&(sql_id|patch_name)/);
  });

  it('keeps a newline in the description from escaping the banner comment', () => {
    const script = buildSqlPatchScript({ ...base, description: 'first\nDROP TABLE t;' });
    expect(script).toContain('-- Purpose: first DROP TABLE t;');
    expect(script.split('\n').some((l) => l.startsWith('DROP TABLE'))).toBe(false);
  });

  it("passes the description to CREATE_SQL_PATCH with quotes doubled", () => {
    const script = buildSqlPatchScript({ ...base, description: "it's\nfine" });
    expect(script).toContain("description => 'it''s fine');");
  });

  it('defaults the description to the previous text', () => {
    expect(buildSqlPatchScript(base)).toContain("description => 'Created by Oracle Plan Visualizer');");
  });
});

describe('sqlPatchScriptFilename', () => {
  it('builds a lowercase filename from the sql_id', () => {
    expect(sqlPatchScriptFilename({ sqlId: 'ABC123def4567', hintText: 'x' })).toBe(
      'create_sql_patch_abc123def4567.sql',
    );
  });
});
