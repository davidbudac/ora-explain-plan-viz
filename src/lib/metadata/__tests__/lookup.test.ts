import { describe, it, expect } from 'vitest';
import { parsePlan } from '../../parser';
import { runAdvisor } from '../../advisor';
import { findObjectInBundle } from '../lookup';
import { makeBundle, makeTable } from '../../advisor/__tests__/helpers';

const bundle = makeBundle({
  'HR.EMP': makeTable({ stale_stats: 'YES' }),
  'SALES.EMP': makeTable({ last_analyzed: null }),
});

const scanOf = (owner: string | null) => parsePlan(JSON.stringify([
  { ID: 0, PARENT_ID: null, OPERATION: 'SELECT STATEMENT', CARDINALITY: 14, COST: 3 },
  { ID: 1, PARENT_ID: 0, POSITION: 1, OPERATION: 'TABLE ACCESS', OPTIONS: 'FULL', OBJECT_OWNER: owner, OBJECT_NAME: 'EMP', CARDINALITY: 14, COST: 3 },
]));

const statsTitles = (owner: string | null) =>
  runAdvisor(scanOf(owner), bundle).findings.filter(f => f.ruleId === 'stats-issues').map(f => f.title);

describe('metadata object lookup', () => {
  it('resolves an imported scan to the object of its OBJECT_OWNER', () => {
    expect(statsTitles('SALES')).toEqual(['missing stats on SALES.EMP']);
    expect(statsTitles('HR')).toEqual(['stale stats on HR.EMP']);
  });

  it('leaves an unqualified name that several schemas share unresolved', () => {
    expect(findObjectInBundle(bundle, 'EMP')).toBeNull();
    expect(statsTitles(null)).toEqual([]);
  });

  it('still resolves an unqualified name that only one schema has', () => {
    const single = makeBundle({ 'PLANVIZ.ORDERS': makeTable() });
    expect(findObjectInBundle(single, 'ORDERS')?.key).toBe('PLANVIZ.ORDERS');
  });
});
