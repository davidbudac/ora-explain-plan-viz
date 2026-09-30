import { describe, expect, it } from 'vitest';
import { planNodeAriaLabel } from '../nodeAriaLabel';

describe('planNodeAriaLabel', () => {
  it('summarises an operation with estimates and actuals', () => {
    const label = planNodeAriaLabel(
      { id: 4, operation: 'TABLE ACCESS FULL', objectName: 'ORDERS', rows: 32, actualRows: 20000, cost: 973 },
      { hasActualStats: true, isHotspot: true },
    );
    expect(label).toBe('#4 TABLE ACCESS FULL ORDERS, estimated 32 rows, actual 20K rows, cost 973, hotspot');
  });

  it('omits actuals for plain explain plans', () => {
    const label = planNodeAriaLabel({ id: 0, operation: 'SELECT STATEMENT', rows: 1, actualRows: 5, cost: 5 });
    expect(label).toBe('#0 SELECT STATEMENT, estimated 1 rows, cost 5');
  });

  it('mentions findings and collapsed subtrees', () => {
    const label = planNodeAriaLabel(
      { id: 2, operation: 'HASH JOIN', actualTime: 1500 },
      { hasActualStats: true, findingCount: 2, hiddenCount: 1 },
    );
    expect(label).toBe('#2 HASH JOIN, time 1.5 seconds, 2 advisor findings, collapsed, 1 hidden operation');
  });
});
