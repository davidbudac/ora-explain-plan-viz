import { describe, expect, it } from 'vitest';
import { buildExperimentCandidates, buildSqlPatchScript, sqlPatchScriptFilename } from '../experiments';
import * as direct from '../../sqlPatchScript';
import type { AdvisorReport, Finding, FindingSeverity } from '../../advisor/types';

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

describe('sqlPatchScript re-export', () => {
  it('re-exports the builder and filename helper from the new module', () => {
    expect(buildSqlPatchScript).toBe(direct.buildSqlPatchScript);
    expect(sqlPatchScriptFilename).toBe(direct.sqlPatchScriptFilename);
    expect(buildSqlPatchScript({ sqlId: 'abc', hintText: 'FULL(t)' })).toContain('DBMS_SQLDIAG.CREATE_SQL_PATCH');
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

  it('has experiments for the per-row, index, join, notes and parallel rules', () => {
    const ids = [
      'per-row-reexecution', 'index-rows-discarded', 'buffer-gets-per-row', 'function-on-indexed-column',
      'hash-join-build-side', 'note-dynamic-sampling', 'note-sql-plan-directive', 'parallel-serial-feed', 'px-skew',
    ];
    const candidates = buildExperimentCandidates(makeReport(ids.map((ruleId) => finding({ ruleId, nodeIds: [4] }))));
    expect(candidates.map((c) => c.id)).toEqual(ids.map((id) => `exp-${id}-4`));
    expect(candidates.find((c) => c.id === 'exp-hash-join-build-side-4')).toMatchObject({ kind: 'hint' });
    expect(candidates.find((c) => c.id === 'exp-hash-join-build-side-4')?.rationale).toContain('SWAP_JOIN_INPUTS');
    expect(candidates.find((c) => c.id === 'exp-px-skew-4')?.rationale).toContain('PQ_DISTRIBUTE');
    expect(candidates.find((c) => c.id === 'exp-function-on-indexed-column-4')?.kind).toBe('params');
  });

  it('leaves informational notes without an experiment unmapped', () => {
    const candidates = buildExperimentCandidates(makeReport([
      finding({ ruleId: 'note-sql-baseline', nodeIds: [] }),
      finding({ ruleId: 'note-adaptive-plan', nodeIds: [] }),
    ]));
    expect(candidates).toEqual([]);
  });
});
