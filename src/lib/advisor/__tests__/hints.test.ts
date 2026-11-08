import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { hintsRule } from '../rules/hints';
import { parsePlan } from '../../parser';
import { parseNoteSection } from '../../parser/noteSection';
import { buildPlan, ruleCtx } from './helpers';

// Real Oracle 19c capture: full(o), index(u), leading(u o) used; use_nl(o u) unused on U; two misspelt hints.
const FIXTURE = readFileSync(join(__dirname, '../../parser/__tests__/fixtures/advanced-hint-report-19c.txt'), 'utf8');

describe('hintsRule', () => {
  it('is quiet without a Hint Report', () => {
    expect(hintsRule.evaluate(ruleCtx(buildPlan({ id: 0, operation: 'SELECT STATEMENT' })))).toEqual([]);
  });

  it('flags syntax errors and unused hints on the operation Oracle reported them on', () => {
    const findings = hintsRule.evaluate(ruleCtx(parsePlan(FIXTURE)));
    expect(findings.map((f) => `${f.severity}:${f.ruleId}@${f.nodeIds.join(',')}`)).toEqual([
      'warning:hint-syntax-error@1',
      'warning:hint-unused@3',
    ]);
    expect(findings[0].title).toBe('2 hints have syntax errors');
    expect(findings[0].explanation).toContain('`no_such_hint`');
    expect(findings[1].title).toBe('Hint not used: use_nl(o u)');
    expect(findings[1].explanation).toContain('on U@SEL$1');
  });

  it('carries Oracle\'s reason for an unused hint', () => {
    const plan = buildPlan({ id: 0, operation: 'SELECT STATEMENT', children: [{ id: 1, operation: 'VIEW', objectAlias: 'O@SEL$1' }] });
    plan.allNodes[1].hints = [{ text: 'index(o)', status: 'unused', code: 'U', reason: 'hint on view cannot be pushed into view', queryBlock: 'SEL$1', alias: 'O@SEL$1' }];
    const [finding] = hintsRule.evaluate(ruleCtx(plan));
    expect(finding.ruleId).toBe('hint-unused');
    expect(finding.explanation).toContain("Oracle's reason: `index(o)`: hint on view cannot be pushed into view");
  });

  it('reports embedded hints overridden by a baseline, but only when the statement has hints', () => {
    const notes = parseNoteSection(['Note', '-----', '   - SQL plan baseline "SQL_PLAN_abc" used for this statement']);
    const hinted = buildPlan({ id: 0, operation: 'SELECT STATEMENT' }, { notes });
    hinted.sqlText = 'select /*+ full(t) */ * from t';
    const [finding] = hintsRule.evaluate(ruleCtx(hinted));
    expect(finding).toMatchObject({ ruleId: 'hints-overridden', severity: 'info', nodeIds: [] });
    expect(finding.title).toContain('SQL_PLAN_abc');

    const plain = buildPlan({ id: 0, operation: 'SELECT STATEMENT' }, { notes });
    plain.sqlText = 'select * from t';
    expect(hintsRule.evaluate(ruleCtx(plain))).toEqual([]);
  });
});
