import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { cleanup } from '../../components/ui/__tests__/testUtils';
import { loadPlan, renderPlanContext } from '../../components/ui/__tests__/planContext';

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
});
afterEach(() => {
  cleanup();
});

describe('startWalkthrough', () => {
  it('loads a sample with runtime stats, switches to the tree and opens the tour', async () => {
    const ctx = renderPlanContext();
    expect(ctx.current().parsedPlan).toBeNull();
    expect(ctx.current().walkthroughOpen).toBe(false);

    let started: boolean | null = null;
    await act(async () => {
      started = await ctx.current().startWalkthrough();
    });

    expect(started).toBe(true);
    expect(ctx.current().parsedPlan?.hasActualStats).toBe(true);
    expect(ctx.current().viewMode).toBe('hierarchical');
    expect(ctx.current().walkthroughOpen).toBe(true);
  });

  it('tours the plan that is already loaded, switching to the tree first', async () => {
    const ctx = renderPlanContext();
    await loadPlan(ctx);
    const loaded = ctx.current().parsedPlan;
    act(() => ctx.current().setViewMode('sankey'));
    expect(ctx.current().viewMode).toBe('sankey');

    await act(async () => {
      await ctx.current().startWalkthrough();
    });

    expect(ctx.current().parsedPlan).toBe(loaded);
    expect(ctx.current().viewMode).toBe('hierarchical');
    expect(ctx.current().walkthroughOpen).toBe(true);
  });
});
