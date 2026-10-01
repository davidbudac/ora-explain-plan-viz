import { describe, it, expect } from 'vitest';
import { findObjectInBundle } from '../../metadata/lookup';
import { selectiveFullScanRule } from '../rules/selectiveFullScan';
import { DEFAULT_THRESHOLDS } from '../config';
import { buildPlan, makeBundle, makeTable, type NodeSpec } from './helpers';
import type { RuleContext } from '../types';
import type { MetadataBundle, TableObject } from '../../metadata/bundle';

function makeCtx(plan: ReturnType<typeof buildPlan>, bundle: MetadataBundle | null = null): RuleContext {
  return {
    plan,
    bundle,
    thresholds: DEFAULT_THRESHOLDS,
    findObject: (name) => (bundle ? findObjectInBundle(bundle, name) : null),
    usedIndexKeys: new Set(),
  };
}

describe('selectiveFullScanRule (bundle path)', () => {
  it('flags a warning when selectivity is below the warn threshold', () => {
    const bundle = makeBundle({ 'HR.EMPLOYEES': makeTable({ num_rows: 100_000 }) });
    const plan = buildPlan({
      id: 0, operation: 'TABLE ACCESS FULL', objectName: 'EMPLOYEES',
      filterPredicates: '"E"."STATUS"=:1', actualRows: 500,
    });
    const findings = selectiveFullScanRule.evaluate(makeCtx(plan, bundle));
    expect(findings).toHaveLength(1);
    expect(findings[0].severity).toBe('warning');
  });

  it('escalates to critical when selectivity and table size cross critical thresholds', () => {
    const bundle = makeBundle({ 'HR.EMPLOYEES': makeTable({ num_rows: 2_000_000 }) });
    const plan = buildPlan({
      id: 0, operation: 'TABLE ACCESS FULL', objectName: 'EMPLOYEES',
      filterPredicates: '"E"."STATUS"=:1', actualRows: 100,
    });
    const findings = selectiveFullScanRule.evaluate(makeCtx(plan, bundle));
    expect(findings[0].severity).toBe('critical');
  });

  it('does not flag when table is below ftsMinTableRows', () => {
    const bundle = makeBundle({ 'HR.EMPLOYEES': makeTable({ num_rows: 500 }) });
    const plan = buildPlan({
      id: 0, operation: 'TABLE ACCESS FULL', objectName: 'EMPLOYEES',
      filterPredicates: '"E"."STATUS"=:1', actualRows: 1,
    });
    expect(selectiveFullScanRule.evaluate(makeCtx(plan, bundle))).toHaveLength(0);
  });

  it('does not flag nodes without filter/access predicates', () => {
    const bundle = makeBundle({ 'HR.EMPLOYEES': makeTable({ num_rows: 100_000 }) });
    const plan = buildPlan({ id: 0, operation: 'TABLE ACCESS FULL', objectName: 'EMPLOYEES', actualRows: 1 });
    expect(selectiveFullScanRule.evaluate(makeCtx(plan, bundle))).toHaveLength(0);
  });

  it('does not flag non-full-scan operations', () => {
    const bundle = makeBundle({ 'HR.EMPLOYEES': makeTable({ num_rows: 100_000 }) });
    const plan = buildPlan({
      id: 0, operation: 'INDEX RANGE SCAN', objectName: 'EMP_IDX',
      filterPredicates: '"E"."STATUS"=:1', actualRows: 1,
    });
    expect(selectiveFullScanRule.evaluate(makeCtx(plan, bundle))).toHaveLength(0);
  });

  it('matches TABLE ACCESS STORAGE FULL (Exadata) as a full scan', () => {
    const bundle = makeBundle({ 'HR.EMPLOYEES': makeTable({ num_rows: 100_000 }) });
    const plan = buildPlan({
      id: 0, operation: 'TABLE ACCESS STORAGE FULL', objectName: 'EMPLOYEES',
      filterPredicates: '"E"."STATUS"=:1', actualRows: 5,
    });
    expect(selectiveFullScanRule.evaluate(makeCtx(plan, bundle))).toHaveLength(1);
  });
});

describe('selectiveFullScanRule (actuals fallback path, no bundle info for table)', () => {
  it('flags a warning when rows/start is low and gets/start is high', () => {
    const plan = buildPlan({
      id: 0, operation: 'TABLE ACCESS FULL', objectName: 'EMPLOYEES',
      filterPredicates: '"E"."STATUS"=:1', starts: 1, actualRows: 5, logicalReads: 50_000,
    });
    const findings = selectiveFullScanRule.evaluate(makeCtx(plan, null));
    expect(findings).toHaveLength(1);
    expect(findings[0].severity).toBe('warning');
  });

  it('escalates to critical when starts > 1', () => {
    const plan = buildPlan({
      id: 0, operation: 'TABLE ACCESS FULL', objectName: 'EMPLOYEES',
      filterPredicates: '"E"."STATUS"=:1', starts: 5, actualRows: 25, logicalReads: 250_000,
    });
    const findings = selectiveFullScanRule.evaluate(makeCtx(plan, null));
    expect(findings[0].severity).toBe('critical');
  });

  it('does not flag when starts is 0 (guarded)', () => {
    const plan = buildPlan({
      id: 0, operation: 'TABLE ACCESS FULL', objectName: 'EMPLOYEES',
      filterPredicates: '"E"."STATUS"=:1', starts: 0, actualRows: 0, logicalReads: 0,
    });
    expect(selectiveFullScanRule.evaluate(makeCtx(plan, null))).toHaveLength(0);
  });

  it('does not flag when gets/start is below the fallback threshold', () => {
    const plan = buildPlan({
      id: 0, operation: 'TABLE ACCESS FULL', objectName: 'EMPLOYEES',
      filterPredicates: '"E"."STATUS"=:1', starts: 1, actualRows: 5, logicalReads: 100,
    });
    expect(selectiveFullScanRule.evaluate(makeCtx(plan, null))).toHaveLength(0);
  });

  it('names filter columns in the suggestion', () => {
    const plan = buildPlan({
      id: 0, operation: 'TABLE ACCESS FULL', objectName: 'EMPLOYEES',
      filterPredicates: '"E"."STATUS"=:1', starts: 1, actualRows: 5, logicalReads: 50_000,
    });
    const findings = selectiveFullScanRule.evaluate(makeCtx(plan, null));
    expect(findings[0].suggestion).toContain('STATUS');
  });
});

describe('selectiveFullScanRule (partitioned tables)', () => {
  const partitioned = (extra: Partial<TableObject['stats']> = {}) => makeBundle({
    'HR.SALES': makeTable({ num_rows: 1_200_000, partitioned: true, partition_count: 12, ...extra }),
  });
  const scan = (iterator: string, pstart: string | undefined, pstop: string | undefined, actualRows: number, extra: Partial<NodeSpec> = {}) => buildPlan({
    id: 1, operation: iterator, pstart, pstop,
    children: [{
      id: 2, operation: 'TABLE ACCESS FULL', objectName: 'SALES', filterPredicates: '"S"."STATUS"=:1',
      pstart, pstop, actualRows, ...extra,
    }],
  });

  it('compares against the whole table when every partition is scanned', () => {
    const plan = scan('PARTITION RANGE ALL', '1', '12', 500);
    const findings = selectiveFullScanRule.evaluate(makeCtx(plan, partitioned()));
    expect(findings).toHaveLength(1);
    expect(findings[0].explanation).toContain('a table with');
    expect(findings[0].explanation).toContain((1_200_000).toLocaleString());
  });

  it('treats an interval table scanned 1..1048575 as unpruned', () => {
    const plan = scan('PARTITION RANGE ITERATOR', '1', '1048575', 500);
    expect(selectiveFullScanRule.evaluate(makeCtx(plan, partitioned()))).toHaveLength(1);
  });

  it('scales the table size by partitions scanned / partition count when pruned', () => {
    // 1 of 12 partitions = ~100,000 rows. 5,000 returned is 5% there (not selective), but only
    // 0.4% of the 1.2M-row table, which would have been a false positive.
    const plan = scan('PARTITION RANGE SINGLE', '3', '3', 5000);
    expect(selectiveFullScanRule.evaluate(makeCtx(plan, partitioned()))).toHaveLength(0);
  });

  it('flags a pruned scan that is still selective within its partitions and says it is approximated', () => {
    const plan = scan('PARTITION RANGE ITERATOR', '3', '5', 50);
    const findings = selectiveFullScanRule.evaluate(makeCtx(plan, partitioned()));
    expect(findings).toHaveLength(1);
    expect(findings[0].explanation).toContain('3 of 12 partitions');
    expect(findings[0].explanation).toContain((300_000).toLocaleString());
    expect(findings[0].explanation).toContain('estimated');
  });

  it('skips the table-size comparison when pruned but the number of partitions is unknown', () => {
    const plan = scan('PARTITION RANGE ITERATOR', 'KEY', 'KEY', 50);
    expect(selectiveFullScanRule.evaluate(makeCtx(plan, partitioned()))).toHaveLength(0);
  });

  it('skips the table-size comparison when the partition count is not in the bundle', () => {
    const plan = scan('PARTITION RANGE SINGLE', '3', '3', 5);
    expect(selectiveFullScanRule.evaluate(makeCtx(plan, partitioned({ partition_count: undefined })))).toHaveLength(0);
  });

  it('skips the table-size comparison when the plan carries no partition information', () => {
    const plan = buildPlan({
      id: 2, operation: 'TABLE ACCESS FULL', objectName: 'SALES', filterPredicates: '"S"."STATUS"=:1', actualRows: 5,
    });
    expect(selectiveFullScanRule.evaluate(makeCtx(plan, partitioned()))).toHaveLength(0);
  });

  it('still judges a pruned scan by measured buffer gets', () => {
    const plan = scan('PARTITION RANGE ITERATOR', 'KEY', 'KEY', 5, { starts: 1, logicalReads: 50_000 });
    const findings = selectiveFullScanRule.evaluate(makeCtx(plan, partitioned()));
    expect(findings).toHaveLength(1);
    expect(findings[0].explanation).toContain('logical reads per start');
  });

  it('does not flag a scan that never started', () => {
    const plan = scan('PARTITION RANGE ALL', '1', '12', 0, { starts: 0 });
    expect(selectiveFullScanRule.evaluate(makeCtx(plan, partitioned()))).toHaveLength(0);
  });
});
