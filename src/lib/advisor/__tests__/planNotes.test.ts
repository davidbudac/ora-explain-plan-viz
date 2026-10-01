import { describe, it, expect } from 'vitest';
import { planNotesRule } from '../rules/planNotes';
import { parseNoteSection } from '../../parser/noteSection';
import { buildPlan, ruleCtx } from './helpers';

function findingsFor(noteLines: string[]) {
  const notes = parseNoteSection(['Note', '-----', ...noteLines.map((l) => `   - ${l}`)]);
  const plan = buildPlan({ id: 0, operation: 'SELECT STATEMENT' }, { notes });
  return planNotesRule.evaluate(ruleCtx(plan));
}

describe('planNotesRule', () => {
  it('has no findings without a Note section', () => {
    expect(planNotesRule.evaluate(ruleCtx(buildPlan({ id: 0, operation: 'SELECT STATEMENT' })))).toEqual([]);
  });

  it('reports dynamic sampling as a plan-level info finding with its level', () => {
    const findings = findingsFor(['dynamic statistics used: dynamic sampling (level=2)']);
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({ ruleId: 'note-dynamic-sampling', severity: 'info', nodeIds: [] });
    expect(findings[0].explanation).toContain('level 2');
    expect(findings[0].explanation).toMatch(/statistics/);
  });

  it('reports SQL plan directives, adaptive plans and cardinality feedback', () => {
    const ids = findingsFor([
      'SQL plan directive used for this statement',
      'this is an adaptive plan',
      'cardinality feedback used for this statement',
    ]).map((f) => f.ruleId);
    expect(ids).toEqual(['note-sql-plan-directive', 'note-adaptive-plan', 'note-cardinality-feedback']);
  });

  it('names the SQL profile, plan baseline, SQL patch and outline', () => {
    const findings = findingsFor([
      'SQL profile "SYS_SQLPROF_0123" used for this statement',
      'SQL plan baseline "SQL_PLAN_abc" used for this statement',
      'SQL patch "PATCH_1" used for this statement',
      'outline "OL1" used for this statement',
    ]);
    expect(findings.map((f) => f.ruleId)).toEqual(['note-sql-profile', 'note-sql-baseline', 'note-sql-patch', 'note-stored-outline']);
    expect(findings[0].title).toContain('SYS_SQLPROF_0123');
    expect(findings[1].explanation).toContain('SQL_PLAN_abc');
    expect(findings[1].explanation).toContain('pinned');
    expect(findings[2].title).toContain('PATCH_1');
    expect(findings[3].title).toContain('OL1');
    expect(findings.every((f) => f.severity === 'info' && f.nodeIds.length === 0)).toBe(true);
  });

  it('works without actual stats (not gated)', () => {
    expect(planNotesRule.requiresActualStats).toBeUndefined();
    expect(planNotesRule.requiresMetadata).toBeUndefined();
  });
});
