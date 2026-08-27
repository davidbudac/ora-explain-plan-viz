import { describe, expect, it } from 'vitest';
import {
  buildSqlPatchScript,
  buildExperimentCandidates,
  sqlPatchScriptFilename,
} from '../experiments';
import type { AdvisorReport, Finding, FindingSeverity } from '../../advisor/types';

const base = { sqlId: 'abc123def4567', hintText: 'FULL(@SEL$1 E@SEL$1)' };

function makeReport(findings: Finding[]): AdvisorReport {
  const counts: Record<FindingSeverity, number> = { info: 0, warning: 0, critical: 0 };
  for (const f of findings) counts[f.severity] += 1;
  return {
    findings,
    findingsByNodeId: new Map(),
    counts,
    maxSeverityByNodeId: new Map(),
  };
}

function finding(partial: Partial<Finding> & { ruleId: string }): Finding {
  return {
    severity: 'warning',
    nodeIds: [3],
    title: 'Some finding',
    explanation: 'because',
    suggestion: 'do something',
    ...partial,
  };
}

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

describe('sqlPatchScriptFilename', () => {
  it('builds a lowercase filename from the sql_id', () => {
    expect(sqlPatchScriptFilename({ sqlId: 'ABC123def4567', hintText: 'x' })).toBe(
      'create_sql_patch_abc123def4567.sql',
    );
  });
});

describe('buildExperimentCandidates', () => {
  it('returns [] for null or empty reports', () => {
    expect(buildExperimentCandidates(null)).toEqual([]);
    expect(buildExperimentCandidates(makeReport([]))).toEqual([]);
  });

  it('maps advisor findings to experiment kinds', () => {
    const report = makeReport([
      finding({ ruleId: 'cardinality-mismatch', nodeIds: [2], title: 'Card mismatch on EMP' }),
      finding({ ruleId: 'spill-to-disk', nodeIds: [5], title: 'Spill on HASH JOIN' }),
      finding({ ruleId: 'index-exists-unused', nodeIds: [7], title: 'Index EMP_IX1 unused' }),
    ]);
    const candidates = buildExperimentCandidates(report);
    expect(candidates).toHaveLength(3);
    expect(candidates[0]).toMatchObject({
      id: 'exp-cardinality-mismatch-2',
      kind: 'hint',
      nodeIds: [2],
    });
    expect(candidates[0].rationale).toContain('Card mismatch on EMP');
    expect(candidates[1]).toMatchObject({ kind: 'params', nodeIds: [5] });
    expect(candidates[2]).toMatchObject({ kind: 'hint', nodeIds: [7] });
    expect(candidates[2].title).toContain('INDEX hint');
  });

  it('skips findings with unmapped ruleIds and dedupes identical candidates', () => {
    const report = makeReport([
      finding({ ruleId: 'some-unknown-rule' }),
      finding({ ruleId: 'stats-issues', nodeIds: [1] }),
      finding({ ruleId: 'stats-issues', nodeIds: [1] }),
    ]);
    const candidates = buildExperimentCandidates(report);
    expect(candidates).toHaveLength(1);
    expect(candidates[0].id).toBe('exp-stats-issues-1');
  });

  it('handles plan-level findings with no node ids', () => {
    const report = makeReport([finding({ ruleId: 'dop-downgrade', nodeIds: [] })]);
    const candidates = buildExperimentCandidates(report);
    expect(candidates[0].id).toBe('exp-dop-downgrade-plan');
    expect(candidates[0].kind).toBe('params');
  });
});
