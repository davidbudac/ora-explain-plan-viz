import { describe, it, expect } from 'vitest';
import { spillToDiskRule } from '../rules/spillToDisk';
import { DEFAULT_THRESHOLDS } from '../config';
import { buildPlan, ruleCtx, type NodeSpec } from './helpers';

describe('spillToDiskRule', () => {
  it('flags a warning when tempUsed is positive but below the critical threshold', () => {
    const plan = buildPlan({ id: 0, operation: 'SORT ORDER BY', tempUsed: 1024 * 1024 });
    const findings = spillToDiskRule.evaluate(ruleCtx(plan));
    expect(findings).toHaveLength(1);
    expect(findings[0].severity).toBe('warning');
    expect(findings[0].explanation).toContain('MB');
  });

  it('escalates to critical at or above spillCriticalBytes', () => {
    const plan = buildPlan({ id: 0, operation: 'SORT ORDER BY', tempUsed: DEFAULT_THRESHOLDS.spillCriticalBytes });
    const findings = spillToDiskRule.evaluate(ruleCtx(plan));
    expect(findings[0].severity).toBe('critical');
  });

  it('does not flag when tempUsed is zero or undefined', () => {
    const plan = buildPlan({ id: 0, operation: 'SORT ORDER BY', tempUsed: 0 });
    expect(spillToDiskRule.evaluate(ruleCtx(plan))).toHaveLength(0);
    const plan2 = buildPlan({ id: 0, operation: 'SORT ORDER BY' });
    expect(spillToDiskRule.evaluate(ruleCtx(plan2))).toHaveLength(0);
  });

  it('caps findings at maxFindingsPerRule', () => {
    const children = Array.from({ length: 10 }, (_, i) => ({ id: i + 1, operation: 'SORT ORDER BY', tempUsed: 1024 }));
    const plan = buildPlan({ id: 0, operation: 'SELECT STATEMENT', children });
    const findings = spillToDiskRule.evaluate(ruleCtx(plan));
    expect(findings.length).toBe(DEFAULT_THRESHOLDS.maxFindingsPerRule);
  });
});

const evaluate = (spec: NodeSpec) => spillToDiskRule.evaluate(ruleCtx(buildPlan(spec)));

describe('spillToDiskRule work-area passes', () => {
  it('flags a one-pass work area without temp usage as a warning', () => {
    const findings = evaluate({ id: 0, operation: 'HASH JOIN', workareaPasses: 1, memoryUsed: 50 * 1024 * 1024 });
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({ ruleId: 'spill-to-disk', severity: 'warning', nodeIds: [0] });
    expect(findings[0].title).toBe('One-pass work area on HASH JOIN');
    expect(findings[0].explanation).toContain('one-pass');
    expect(findings[0].explanation).toContain('50.0 MB');
  });

  it('flags a multipass work area as critical', () => {
    const findings = evaluate({ id: 0, operation: 'SORT ORDER BY', workareaPasses: 3 });
    expect(findings).toHaveLength(1);
    expect(findings[0].severity).toBe('critical');
    expect(findings[0].title).toBe('Multipass work area on SORT ORDER BY');
  });

  it('uses the O/1/M execution counts when the last-execution pass count is absent', () => {
    const findings = evaluate({ id: 0, operation: 'HASH GROUP BY', workareaExecutions: { optimal: 5, onePass: 3, multipass: 0 } });
    expect(findings[0].severity).toBe('warning');
    expect(findings[0].explanation).toContain('3 of 8 executions');
    const multi = evaluate({ id: 0, operation: 'HASH GROUP BY', workareaExecutions: { optimal: 0, onePass: 0, multipass: 2 } });
    expect(multi[0].severity).toBe('critical');
  });

  it('does not flag optimal work areas', () => {
    expect(evaluate({ id: 0, operation: 'SORT ORDER BY', workareaPasses: 0, workareaExecutions: { optimal: 4, onePass: 0, multipass: 0 } })).toHaveLength(0);
  });

  it('merges a spill and its passes into ONE finding', () => {
    const findings = evaluate({ id: 0, operation: 'HASH JOIN', tempUsed: 8 * 1024 * 1024, workareaPasses: 1 });
    expect(findings).toHaveLength(1);
    expect(findings[0].title).toBe('Spill to disk (one-pass) on HASH JOIN');
    expect(findings[0].explanation).toContain('8.0 MB of temp space');
    expect(findings[0].explanation).toContain('one-pass');
  });

  it('takes the worst severity when merging (multipass with a small spill is critical)', () => {
    const findings = evaluate({ id: 0, operation: 'SORT ORDER BY', tempUsed: 1024, workareaPasses: 2 });
    expect(findings).toHaveLength(1);
    expect(findings[0].severity).toBe('critical');
    expect(findings[0].title).toContain('multipass');
  });

  it('mentions the optimizer memory estimate when known', () => {
    const findings = evaluate({ id: 0, operation: 'SORT ORDER BY', workareaPasses: 1, estimatedOptimalMemory: 200 * 1024 * 1024 });
    expect(findings[0].explanation).toContain('200.0 MB');
  });
});
