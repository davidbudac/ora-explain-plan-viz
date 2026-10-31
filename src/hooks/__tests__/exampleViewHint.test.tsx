import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { cleanup } from '../../components/ui/__tests__/testUtils';
import { SIMPLE_PLAN, renderPlanContext } from '../../components/ui/__tests__/planContext';
import type { SamplePlan } from '../../examples';

const PLAN_A = SIMPLE_PLAN;
const PLAN_B = PLAN_A.replace('1234567890', '987654321').replace('ORDERS', 'ITEMS');

function sample(overrides: Partial<SamplePlan>): SamplePlan {
  return { name: 'Hinted', category: 'dbms_xplan', data: PLAN_A, ...overrides };
}

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
});
afterEach(() => {
  cleanup();
});

describe('loadExample view hint', () => {
  it('switches to the example\'s view after a successful load', async () => {
    const ctx = renderPlanContext();
    await act(async () => {
      await ctx.current().loadExample(sample({ view: 'flame' }));
    });
    expect(ctx.current().parsedPlan).not.toBeNull();
    expect(ctx.current().viewMode).toBe('experimental');
    expect(ctx.current().experimentalSubView).toBe('flame');
  });

  it('leaves the view alone when the example has no hint', async () => {
    const ctx = renderPlanContext();
    const before = ctx.current().viewMode;
    await act(async () => {
      await ctx.current().loadExample(sample({}));
    });
    expect(ctx.current().viewMode).toBe(before);
  });

  it('ignores a compare hint when only one plan parsed', async () => {
    const ctx = renderPlanContext();
    await act(async () => {
      await ctx.current().loadExample(sample({ view: 'compare' }));
    });
    expect(ctx.current().viewMode).not.toBe('compare');
  });

  it('applies a compare hint when the example holds two plans', async () => {
    const ctx = renderPlanContext();
    await act(async () => {
      await ctx.current().loadExample(sample({ data: `${PLAN_A}\n${PLAN_B}`, view: 'compare' }));
    });
    expect(ctx.current().plans.filter((p) => p.parsedPlan)).toHaveLength(2);
    expect(ctx.current().viewMode).toBe('compare');
  });

  it('does not change the view when the load fails', async () => {
    const ctx = renderPlanContext();
    const before = ctx.current().viewMode;
    await act(async () => {
      await ctx.current().loadExample(sample({ data: 'not a plan at all', view: 'flame' }));
    });
    expect(ctx.current().viewMode).toBe(before);
  });
});
