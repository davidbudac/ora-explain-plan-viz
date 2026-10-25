import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { gzipSync } from 'zlib';
import { cleanup } from '../../components/ui/__tests__/testUtils';
import { SIMPLE_PLAN, renderPlanContext } from '../../components/ui/__tests__/planContext';
import type { SharePayload } from '../../lib/url';
import type { SamplePlan } from '../../examples';

// jsdom's Blob has no stream(), so the real gzip decoder cannot run here.
vi.mock('../../lib/url', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../lib/url')>();
  const { gunzipSync } = await import('zlib');
  return {
    ...actual,
    decodeGzipPlanParam: async (value: string) => gunzipSync(Buffer.from(value, 'base64url')).toString('utf8'),
  };
});

const PLAN_A = SIMPLE_PLAN;
const PLAN_B = PLAN_A.replace('1234567890', '987654321').replace('ORDERS', 'ITEMS');

const flush = () => act(async () => { await new Promise((resolve) => setTimeout(resolve, 20)); });

function gzHash(payload: unknown): string {
  return `#gz=${gzipSync(Buffer.from(JSON.stringify(payload))).toString('base64url')}`;
}

function setUrl(url: string) {
  window.history.replaceState(null, '', url);
}

function sample(data: string): SamplePlan {
  return { name: 'Pair', category: 'dbms_xplan', data };
}

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  setUrl('/');
});
afterEach(() => {
  cleanup();
  localStorage.clear();
  setUrl('/');
});

describe('share link round trip with workspace state', () => {
  it('restores view, selection, compare pair, metrics and filters from a ?plan= link', async () => {
    const first = renderPlanContext();
    await act(async () => {
      await first.current().loadExample(sample(`${PLAN_A}\n${PLAN_B}`));
    });
    act(() => {
      first.current().setViewMode('compare');
      first.current().selectNodeForPlan(1, 1);
      first.current().setActivePlan(1);
      first.current().swapComparePlans();
      first.current().setCompareMetrics(['cost', 'actualTime']);
      first.current().setFilters({ searchText: 'ITEMS', minCost: 3 });
    });
    let url = '';
    await act(async () => {
      const result = await first.current().sharePlan();
      if (result.ok) url = result.url;
    });
    expect(url).toContain('plan=');
    cleanup();
    localStorage.clear();

    setUrl(new URL(url).pathname + new URL(url).search + new URL(url).hash);
    const second = renderPlanContext();
    await flush();
    const ctx = second.current();
    expect(ctx.viewMode).toBe('compare');
    expect(ctx.plans).toHaveLength(2);
    expect(ctx.activePlanIndex).toBe(1);
    expect(ctx.plans[1].selectedNodeIds).toEqual([1]);
    expect(ctx.comparePlanIndices).toEqual([1, 0]);
    expect(ctx.compareMetrics).toEqual(['cost', 'actualTime']);
    expect(ctx.filters.searchText).toBe('ITEMS');
    expect(ctx.filters.minCost).toBe(3);
  });

  it('keeps compare mode when the link is the gzip #gz= variant', async () => {
    const payload: SharePayload = {
      plans: [{ rawInput: PLAN_A }, { rawInput: PLAN_B, selectedNodeIds: [1] }],
      viewMode: 'compare',
      workspace: { v: 1, activePlan: 1, compare: { pair: [1, 0], metrics: ['cost'], tree: true } },
    };
    setUrl(`/${gzHash(payload)}`);
    const ctx = renderPlanContext();
    await flush();
    expect(ctx.current().viewMode).toBe('compare');
    expect(ctx.current().activePlanIndex).toBe(1);
    expect(ctx.current().comparePlanIndices).toEqual([1, 0]);
    expect(ctx.current().compareMetrics).toEqual(['cost']);
    expect(ctx.current().treeCompareEnabled).toBe(true);
    expect(ctx.current().plans[1].selectedNodeIds).toEqual([1]);
  });

  it('still loads an old link with no workspace block', async () => {
    const payload = { plans: [{ rawInput: PLAN_A }, { rawInput: PLAN_B }], viewMode: 'compare' };
    setUrl(`/${gzHash(payload)}`);
    const ctx = renderPlanContext();
    await flush();
    expect(ctx.current().viewMode).toBe('compare');
    expect(ctx.current().comparePlanIndices).toEqual([0, 1]);
    expect(ctx.current().activePlanIndex).toBe(0);
  });

  it('ignores selected ids and indices that do not exist in the plans', async () => {
    const payload = {
      plans: [{ rawInput: PLAN_A, selectedNodeIds: [99, 1] }],
      workspace: { v: 1, activePlan: 7, compare: { pair: [0, 5] }, filters: { minCost: 'lots' } },
    };
    setUrl(`/${gzHash(payload)}`);
    const ctx = renderPlanContext();
    await flush();
    expect(ctx.current().plans[0].selectedNodeIds).toEqual([1]);
    expect(ctx.current().activePlanIndex).toBe(0);
    expect(ctx.current().filters.minCost).toBe(0);
  });
});

describe('?node= and ?q= deep links', () => {
  it('selects the operation and fills the search box, then strips the params', async () => {
    const payload = { plans: [{ rawInput: PLAN_A }] };
    setUrl(`/?node=1&q=orders${gzHash(payload)}`);
    const ctx = renderPlanContext();
    await flush();
    expect(ctx.current().selectedNodeId).toBe(1);
    expect(ctx.current().filters.searchText).toBe('orders');
    expect(window.location.search).toBe('');
  });

  it('ignores an unknown node id', async () => {
    setUrl(`/?node=42${gzHash({ plans: [{ rawInput: PLAN_A }] })}`);
    const ctx = renderPlanContext();
    await flush();
    expect(ctx.current().parsedPlan).not.toBeNull();
    expect(ctx.current().selectedNodeId).toBeNull();
  });

  it('works together with ?example= and ?view=', async () => {
    setUrl('/?example=1&view=tabular&node=1');
    const ctx = renderPlanContext();
    await flush();
    expect(ctx.current().parsedPlan).not.toBeNull();
    expect(ctx.current().viewMode).toBe('tabular');
    expect(ctx.current().selectedNodeId).toBe(1);
    expect(window.location.search).toBe('');
  });

  it('does not select anything when no plan loads', async () => {
    setUrl('/?node=1');
    const ctx = renderPlanContext();
    await flush();
    expect(ctx.current().parsedPlan).toBeNull();
    act(() => {
      void ctx.current().loadExample(sample(PLAN_A));
    });
    await flush();
    expect(ctx.current().selectedNodeId).toBeNull();
  });
});
