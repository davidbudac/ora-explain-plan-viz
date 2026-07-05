import { describe, it, expect } from 'vitest';
import { findObjectInBundle } from '../../metadata/lookup';
import { selectiveFullScanRule } from '../rules/selectiveFullScan';
import { DEFAULT_THRESHOLDS } from '../config';
import { buildPlan, makeBundle, makeTable } from './helpers';
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
