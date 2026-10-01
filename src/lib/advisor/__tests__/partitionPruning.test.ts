import { describe, it, expect } from 'vitest';
import { findObjectInBundle } from '../../metadata/lookup';
import { partitionPruningRule } from '../rules/partitionPruning';
import { DEFAULT_THRESHOLDS } from '../config';
import { buildPlan, makeBundle, makeColumn, makeIndex, makeTable, type NodeSpec } from './helpers';
import type { RuleContext } from '../types';
import type { MetadataBundle } from '../../metadata/bundle';

function makeCtx(plan: ReturnType<typeof buildPlan>, bundle: MetadataBundle | null = null): RuleContext {
  return {
    plan,
    bundle,
    thresholds: DEFAULT_THRESHOLDS,
    findObject: (name) => (bundle ? findObjectInBundle(bundle, name) : null),
    usedIndexKeys: new Set(),
  };
}

const salesBundle = () => makeBundle({
  'APP.SALES': makeTable(
    { partitioned: true, partition_count: 12, partition_type: 'RANGE', partition_key: ['SALE_DATE'] },
    { SALE_DATE: makeColumn({ data_type: 'DATE' }), STATUS: makeColumn({ data_type: 'VARCHAR2' }) },
    ['APP.SALES_LOC_IDX'],
  ),
  'APP.SALES_LOC_IDX': makeIndex('APP.SALES', ['STATUS'], { partitioned: true, locality: 'LOCAL' }),
});

const allPartitionsScan = (filter: string | undefined, alias = 'S@SEL$1'): NodeSpec => ({
  id: 1, operation: 'PARTITION RANGE ALL', pstart: '1', pstop: '12',
  children: [{
    id: 2, operation: 'TABLE ACCESS FULL', objectName: 'SALES', objectAlias: alias, pstart: '1', pstop: '12',
    filterPredicates: filter,
  }],
});

describe('partitionPruningRule', () => {
  describe('with the partition key known (metadata bundle)', () => {
    it('flags PARTITION RANGE ALL when a predicate references the partition key', () => {
      const plan = buildPlan(allPartitionsScan('TRUNC("S"."SALE_DATE")=TO_DATE(:1)'));
      const findings = partitionPruningRule.evaluate(makeCtx(plan, salesBundle()));
      expect(findings).toHaveLength(1);
      expect(findings[0]).toMatchObject({ ruleId: 'partition-no-pruning', severity: 'warning', nodeIds: [1] });
      expect(findings[0].explanation).toContain('SALE_DATE');
      expect(findings[0].explanation).toContain('wrapped in a function');
    });

    it('flags a plain key predicate and points at conversions / datatype mismatch', () => {
      const plan = buildPlan(allPartitionsScan('"S"."SALE_DATE">=:1'));
      const findings = partitionPruningRule.evaluate(makeCtx(plan, salesBundle()));
      expect(findings).toHaveLength(1);
      expect(findings[0].explanation).toContain('implicit conversion');
    });

    it('does not flag when predicates only touch non-key columns', () => {
      const plan = buildPlan(allPartitionsScan('"S"."STATUS"=:1'));
      expect(partitionPruningRule.evaluate(makeCtx(plan, salesBundle()))).toHaveLength(0);
    });

    it('does not flag an unfiltered scan of all partitions', () => {
      const plan = buildPlan(allPartitionsScan(undefined));
      expect(partitionPruningRule.evaluate(makeCtx(plan, salesBundle()))).toHaveLength(0);
    });

    it('ignores a same-named column of another alias', () => {
      const plan = buildPlan(allPartitionsScan('"S"."STATUS"="D"."SALE_DATE"'));
      expect(partitionPruningRule.evaluate(makeCtx(plan, salesBundle()))).toHaveLength(0);
    });

    it('resolves the key through a local index scan', () => {
      const plan = buildPlan({
        id: 1, operation: 'PARTITION RANGE ALL', pstart: '1', pstop: '12',
        children: [{
          id: 2, operation: 'INDEX RANGE SCAN', objectName: 'SALES_LOC_IDX', objectAlias: 'S@SEL$1',
          accessPredicates: '"S"."STATUS"=:1', filterPredicates: 'TO_CHAR("S"."SALE_DATE")=:2',
        }],
      });
      expect(partitionPruningRule.evaluate(makeCtx(plan, salesBundle()))).toHaveLength(1);
    });

    it('does not flag static or runtime pruning', () => {
      const bundle = salesBundle();
      for (const [op, pstart] of [['PARTITION RANGE SINGLE', '9'], ['PARTITION RANGE ITERATOR', 'KEY']]) {
        const plan = buildPlan({
          id: 1, operation: op, pstart, pstop: pstart,
          children: [{ id: 2, operation: 'TABLE ACCESS FULL', objectName: 'SALES', objectAlias: 'S@SEL$1', filterPredicates: '"S"."SALE_DATE">=:1' }],
        });
        expect(partitionPruningRule.evaluate(makeCtx(plan, bundle))).toHaveLength(0);
      }
    });
  });

  describe('without a known partition key', () => {
    it('downgrades to an info finding when the scan is filtered', () => {
      const plan = buildPlan(allPartitionsScan('"S"."SALE_DATE">=:1'));
      const findings = partitionPruningRule.evaluate(makeCtx(plan));
      expect(findings).toHaveLength(1);
      expect(findings[0]).toMatchObject({ ruleId: 'partition-no-pruning', severity: 'info', nodeIds: [1] });
      expect(findings[0].explanation).toContain('partition key is unknown');
    });

    it('downgrades to info when the bundle has the table but no partition key', () => {
      const bundle = makeBundle({ 'APP.SALES': makeTable({ partitioned: true, partition_count: 12 }) });
      const plan = buildPlan(allPartitionsScan('"S"."SALE_DATE">=:1'));
      expect(partitionPruningRule.evaluate(makeCtx(plan, bundle))[0].severity).toBe('info');
    });

    it('stays silent for an unfiltered scan of all partitions', () => {
      const plan = buildPlan({ id: 0, operation: 'PARTITION RANGE ALL', pstart: '1', pstop: '12', children: [
        { id: 1, operation: 'TABLE ACCESS FULL', objectName: 'SALES' },
      ] });
      expect(partitionPruningRule.evaluate(makeCtx(plan))).toHaveLength(0);
    });

    it('stays silent for a bare iterator with no scans beneath it', () => {
      const plan = buildPlan({ id: 0, operation: 'PARTITION RANGE ALL', pstart: '1', pstop: '12' });
      expect(partitionPruningRule.evaluate(makeCtx(plan))).toHaveLength(0);
    });
  });

  it('does not flag nodes without pstart/pstop', () => {
    const plan = buildPlan({ id: 0, operation: 'TABLE ACCESS FULL' });
    expect(partitionPruningRule.evaluate(makeCtx(plan))).toHaveLength(0);
  });

  it('caps findings at maxFindingsPerRule', () => {
    const children = Array.from({ length: 10 }, (_, i) => ({
      id: 100 + i, operation: 'PARTITION RANGE ALL', pstart: '1', pstop: '12',
      children: [{ id: 200 + i, operation: 'TABLE ACCESS FULL', objectName: 'SALES', filterPredicates: '"S"."X"=:1' }],
    }));
    const plan = buildPlan({ id: 0, operation: 'SELECT STATEMENT', children });
    const findings = partitionPruningRule.evaluate(makeCtx(plan));
    expect(findings.length).toBe(DEFAULT_THRESHOLDS.maxFindingsPerRule);
  });
});
