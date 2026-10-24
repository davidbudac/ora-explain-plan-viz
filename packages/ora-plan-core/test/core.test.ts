// @vitest-environment node
import { describe, expect, it } from 'vitest';
import * as src from '../src/index.ts';
import * as built from '../dist/index.js';

// A V$SQL_PLAN-style row array, as mtkprof builds from STAT lines: T1 is estimated at 1 row but returns 5000.
const rows = [
  { id: 0, depth: 0, operation: 'SELECT STATEMENT', cost: 40, actual_rows: 5000, starts: 1, actual_elapsed_time: 900000 },
  { id: 1, parent_id: 0, depth: 1, operation: 'NESTED LOOPS', cardinality: 1, cost: 40, actual_rows: 5000, starts: 1, actual_elapsed_time: 880000 },
  { id: 2, parent_id: 1, depth: 2, operation: 'TABLE ACCESS FULL', object_name: 'T1', cardinality: 1, cost: 3, actual_rows: 5000, starts: 1, actual_elapsed_time: 20000 },
  { id: 3, parent_id: 1, depth: 2, operation: 'TABLE ACCESS FULL', object_name: 'T2', cardinality: 1, cost: 3, actual_rows: 5000, starts: 5000, actual_elapsed_time: 800000 },
];

describe('ora-plan-core', () => {
  it('parses a JSON row array and derives self times', () => {
    const plan = src.parsePlan(JSON.stringify(rows));
    expect(plan.source).toBe('json');
    expect(plan.allNodes).toHaveLength(4);
    expect(plan.hasActualStats).toBe(true);
    expect(plan.allNodes.find((n) => n.id === 1)?.selfTime).toBeGreaterThan(0);
  });

  it('runs the advisor on a plan without metadata', () => {
    const plan = src.parsePlan(JSON.stringify(rows));
    const report = src.runAdvisor(plan, null);
    expect(report.findings.length).toBeGreaterThan(0);
    for (const f of report.findings) {
      expect(['info', 'warning', 'critical']).toContain(f.severity);
      expect(f.title).not.toBe('');
    }
    expect(report.findings.some((f) => f.ruleId === 'cardinality-mismatch' && f.nodeIds.includes(2))).toBe(true);
  });

  it('parses DBMS_XPLAN text', () => {
    const text = [
      'Plan hash value: 1357081020',
      '',
      '-----------------------------------',
      '| Id  | Operation         | Name |',
      '-----------------------------------',
      '|   0 | SELECT STATEMENT  |      |',
      '|   1 |  TABLE ACCESS FULL| T1   |',
      '-----------------------------------',
    ].join('\n');
    const plan = src.parsePlan(text);
    expect(plan.source).toBe('dbms_xplan');
    expect(plan.allNodes.map((n) => n.id)).toEqual([0, 1]);
  });

  it('ships a dist build with the same exports as the sources', () => {
    expect(Object.keys(built).sort()).toEqual(Object.keys(src).sort());
  });
});
