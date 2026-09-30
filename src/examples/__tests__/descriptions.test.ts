import { describe, it, expect } from 'vitest';
import { readdirSync } from 'fs';
import { join } from 'path';
import { EXAMPLE_DESCRIPTIONS, getExampleDescription } from '../descriptions';
import {
  SAMPLE_PLANS,
  SAMPLE_PLANS_WITH_ORDER,
  SAMPLE_PLAN_GROUPS,
  FEATURED_SAMPLE_PLANS,
  groupSamplePlans,
  type SamplePlan,
} from '../index';

const exampleStems = readdirSync(join(__dirname, '..'))
  .filter((file) => file.endsWith('.txt'))
  .map((file) => file.replace(/\.txt$/, ''));

describe('example descriptions', () => {
  it('only describes examples that exist (no stale keys)', () => {
    for (const stem of Object.keys(EXAMPLE_DESCRIPTIONS)) {
      expect(exampleStems).toContain(stem);
    }
  });

  it('describes every bundled example in one line', () => {
    for (const stem of exampleStems) {
      const entry = getExampleDescription(stem);
      expect(entry, stem).toBeDefined();
      expect(entry?.description).not.toMatch(/\n/);
    }
  });

  it('returns undefined for unknown stems', () => {
    expect(getExampleDescription('99-dbms_xplan-Does Not Exist')).toBeUndefined();
    expect(getExampleDescription('toString')).toBeUndefined();
  });

  it('populates SamplePlan.description / featured from the map', () => {
    const cardinality = SAMPLE_PLANS.find((p) => p.name === 'Cardinality Trap (NL)');
    expect(cardinality?.description).toBeTruthy();
    expect(cardinality?.featured).toBe(true);
    const complex = SAMPLE_PLANS.find((p) => p.name === 'Complex Plan');
    expect(complex?.featured).toBeUndefined();
    expect(SAMPLE_PLANS_WITH_ORDER[0].description).toBe(SAMPLE_PLANS[0].description);
  });

  it('features a handful of examples, in example order', () => {
    expect(FEATURED_SAMPLE_PLANS.length).toBeGreaterThanOrEqual(2);
    expect(FEATURED_SAMPLE_PLANS.length).toBeLessThanOrEqual(6);
    const order = FEATURED_SAMPLE_PLANS.map((p) => SAMPLE_PLANS.indexOf(p));
    expect([...order].sort((a, b) => a - b)).toEqual(order);
  });
});

describe('example groups', () => {
  it('derives groups from the categories that are present', () => {
    const categories = new Set(SAMPLE_PLANS.map((p) => p.category));
    expect(SAMPLE_PLAN_GROUPS.map((g) => g.category).sort()).toEqual([...categories].sort());
    for (const group of SAMPLE_PLAN_GROUPS) {
      expect(group.samples.length).toBeGreaterThan(0);
      expect(group.samples.every((s) => s.category === group.category)).toBe(true);
      expect(group.label).toBeTruthy();
    }
  });

  it('omits empty categories and keeps the preferred order', () => {
    const only: SamplePlan[] = [
      { name: 'b', category: 'xbi', data: '' },
      { name: 'a', category: 'dbms_xplan', data: '' },
    ];
    expect(groupSamplePlans(only).map((g) => g.category)).toEqual(['dbms_xplan', 'xbi']);
  });
});
