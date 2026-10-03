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
      'DBMS_SQLDIAG.CREATE_SQL_PATCH(',
      "sql_id      => '&sql_id',",
      "hint_text   => q'[FULL(@SEL$1 E@SEL$1)]',",
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
    expect(script).toContain('used for this statement');
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
    expect(script).toContain("hint_text   => q'{INDEX(t x[1]')}',");
    expect(script).not.toContain("q'[INDEX");
  });

  it('falls back to a doubled-quote literal when every delimiter is exhausted', () => {
    const hint = "]' }' >' )' !' #'";
    const script = buildSqlPatchScript({ ...base, hintText: hint });
    expect(script).toContain("hint_text   => ']'' }'' >'' )'' !'' #''',");
  });

  it('includes an optional description in the banner', () => {
    const script = buildSqlPatchScript({ ...base, description: 'try hash join' });
    expect(script).toContain('-- Purpose: try hash join');
  });
});

describe('buildSqlPatchScript hint layout', () => {
  const hints = ['FULL(@"SEL$1" "E"@"SEL$1")', 'INDEX(@"SEL$1" "D"@"SEL$1" ("DEPT"."ID"))', 'LEADING(@"SEL$1" "E"@"SEL$1" "D"@"SEL$1")'];

  it('keeps one hint per line inside the q-literal', () => {
    const script = buildSqlPatchScript({ ...base, hintText: hints.join('\n') });
    const lines = script.split('\n');
    const first = lines.findIndex((l) => l.includes("hint_text   => q'[" + hints[0]));
    expect(first).toBeGreaterThan(-1);
    expect(lines[first + 1].trim()).toBe(hints[1]);
    expect(lines[first + 2].trim()).toBe(hints[2] + "]',");
    // continuation lines are indented under the first hint
    expect(lines[first + 1].startsWith(' '.repeat(38))).toBe(true);
  });

  it('trims lines and drops blank ones', () => {
    const script = buildSqlPatchScript({ ...base, hintText: '\n  FULL(a)  \r\n\n\t\n INDEX(b) \n' });
    expect(script).toContain("hint_text   => q'[FULL(a)\n");
    expect(script).toMatch(/\n {38}INDEX\(b\)\]',\n/);
  });

  it('keeps the commented 12.1 variant commented on every line', () => {
    const script = buildSqlPatchScript({ ...base, hintText: hints.join('\n') });
    const lines = script.split('\n');
    const idx = lines.findIndex((l) => l.startsWith('--') && l.includes('hint_text => q'));
    expect(idx).toBeGreaterThan(-1);
    expect(lines[idx + 1].startsWith('--')).toBe(true);
    expect(lines[idx + 2].startsWith('--')).toBe(true);
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
  });

  it('checks the whole multi-line text when picking the q-delimiter', () => {
    const script = buildSqlPatchScript({ ...base, hintText: "FULL(a)\nINDEX(t x[1]')" });
    expect(script).toContain("hint_text   => q'{FULL(a)\n");
    expect(script).toContain("INDEX(t x[1]')}',");
  });

  it('falls back to a doubled-quote literal across lines', () => {
    const script = buildSqlPatchScript({ ...base, hintText: "]' }' >'\n)' !' #'" });
    expect(script).toContain("hint_text   => ']'' }'' >''\n");
    expect(script).toContain(" )'' !'' #''',\n");
  });

  it('notes that the statement must be in the cursor cache or AWR', () => {
    const script = buildSqlPatchScript(base);
    expect(script).toContain('in the cursor cache (or AWR)');
    expect(script).toContain('Only one enabled SQL patch applies per statement');
  });
});

describe('sqlPatchScriptFilename', () => {
  it('builds a lowercase filename from the sql_id', () => {
    expect(sqlPatchScriptFilename({ sqlId: 'ABC123def4567', hintText: 'x' })).toBe(
      'create_sql_patch_abc123def4567.sql',
    );
  });
});
