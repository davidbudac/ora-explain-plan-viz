import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { compressToEncodedURIComponent } from 'lz-string';
import { gzipSync } from 'zlib';
import { cleanup } from '../../components/ui/__tests__/testUtils';
import { SIMPLE_PLAN, loadPlan, renderPlanContext } from '../../components/ui/__tests__/planContext';
import type { SharePayload } from '../../lib/url';
import type { SamplePlan } from '../../examples';
import { SESSION_KEY, loadSession } from '../../lib/session';

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

const toastText = () => document.querySelector<HTMLElement>('[data-ui-toast-region]')?.textContent ?? '';
const LINK_ERROR = 'The shared plan link is corrupt or truncated. Ask for a fresh link or paste the plan text directly.';
const flush = () => act(async () => { await new Promise((resolve) => setTimeout(resolve, 20)); });

function gzHash(payload: unknown): string {
  return gzTextHash(JSON.stringify(payload));
}

function gzTextHash(text: string): string {
  return `#gz=${gzipSync(Buffer.from(text)).toString('base64url')}`;
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

describe('corrupt #gz= link', () => {
  // Not gzip data: the decoder rejects, like a link cut short by a mail or chat client.
  const CORRUPT = '/#gz=AAAA';

  function saveSessionWith(text: string, customLabel: string) {
    localStorage.setItem(
      SESSION_KEY,
      JSON.stringify({ version: 1, savedAt: '', activePlanIndex: 0, viewMode: 'hierarchical', slots: [{ text, customLabel }] }),
    );
  }

  it('restores the autosaved session and keeps it in storage', async () => {
    saveSessionWith(PLAN_A, 'Kept');
    setUrl(CORRUPT);
    const ctx = renderPlanContext();
    await flush();

    expect(ctx.current().parsedPlan).not.toBeNull();
    expect(ctx.current().plans[0].customLabel).toBe('Kept');
    expect(ctx.current().error).toBeNull();
    expect(toastText()).toContain(LINK_ERROR);
    expect(toastText()).toContain('Your previous session was restored.');
    expect(window.location.hash).toBe('');

    // Force the autosave that would otherwise run after its 1 s debounce.
    act(() => {
      window.dispatchEvent(new Event('pagehide'));
    });
    expect(loadSession()?.slots[0].customLabel).toBe('Kept');
  });

  it('shows the link error in the input panel when there is no session to restore', async () => {
    setUrl(CORRUPT);
    const ctx = renderPlanContext();
    await flush();

    expect(ctx.current().parsedPlan).toBeNull();
    expect(ctx.current().error).toBe(LINK_ERROR);
    expect(localStorage.getItem(SESSION_KEY)).toBeNull();
  });
});

describe('share link with no usable plan', () => {
  // A real 19c DISPLAY_CURSOR capture cut off before its plan table.
  const TRUNCATED = readFileSync(join(__dirname, '../../lib/parser/__tests__/fixtures/advanced-allstats-19c.txt'), 'utf-8')
    .split('\n').slice(0, 7).join('\n');
  const autosaveNow = () => act(() => { window.dispatchEvent(new Event('pagehide')); });

  async function saveWorkspace() {
    const handle = renderPlanContext();
    await loadPlan(handle, PLAN_A);
    act(() => {
      handle.current().renamePlanSlot(0, 'Mine');
      handle.current().setNodeAnnotation(1, 'keep this note');
    });
    autosaveNow();
    cleanup();
    expect(loadSession()?.slots[0].annotations?.nodeAnnotations['1']?.text).toBe('keep this note');
  }

  const links: Array<[string, string]> = [
    ['a #gz= link holding plan text', `/${gzTextHash(TRUNCATED)}`],
    ['a #gz= link holding a payload', `/${gzHash({ plans: [{ rawInput: TRUNCATED }] })}`],
    ['a ?plan= link', `/?plan=${compressToEncodedURIComponent(TRUNCATED)}`],
    ['a corrupt #gz= link', '/#gz=AAAA'],
  ];

  it.each(links)('keeps the saved workspace after %s', async (_name, url) => {
    await saveWorkspace();
    setUrl(url);
    const ctx = renderPlanContext();
    await flush();
    autosaveNow();

    const saved = loadSession();
    expect(saved?.slots).toHaveLength(1);
    expect(saved?.slots[0].text).toBe(PLAN_A);
    expect(saved?.slots[0].customLabel).toBe('Mine');
    expect(saved?.slots[0].annotations?.nodeAnnotations['1']?.text).toBe('keep this note');

    expect(ctx.current().plans).toHaveLength(1);
    expect(ctx.current().plans[0].customLabel).toBe('Mine');
    expect(ctx.current().rawInput).toBe(PLAN_A);
    expect(ctx.current().annotations.nodeAnnotations.get(1)?.text).toBe('keep this note');
    expect(toastText()).toContain('Shared link could not be opened');
    expect(toastText()).toContain('Your previous session was restored.');
  });

  it('keeps the saved workspace when the page closes while a #gz= link is still decoding', async () => {
    await saveWorkspace();
    setUrl(`/${gzHash({ plans: [{ rawInput: PLAN_B }] })}`);
    renderPlanContext();
    autosaveNow();

    expect(loadSession()?.slots[0].customLabel).toBe('Mine');
    await flush();
  });

  it('shows the parse error with the link text when there is no session to restore', async () => {
    setUrl(`/${gzTextHash(TRUNCATED)}`);
    const ctx = renderPlanContext();
    await flush();

    expect(ctx.current().parsedPlan).toBeNull();
    expect(ctx.current().error).toBeTruthy();
    expect(ctx.current().plans[0].draftInput).toBe(TRUNCATED);
    autosaveNow();
    expect(localStorage.getItem(SESSION_KEY)).toBeNull();
  });

  it('replaces the saved workspace when at least one shared plan is usable', async () => {
    await saveWorkspace();
    setUrl(`/${gzHash({ plans: [{ rawInput: TRUNCATED }, { rawInput: PLAN_B }] })}`);
    const ctx = renderPlanContext();
    await flush();

    expect(ctx.current().plans.some((slot) => slot.rawInput === PLAN_B.trim())).toBe(true);
    autosaveNow();
    expect(loadSession()?.slots.map((slot) => slot.text)).toEqual([PLAN_B.trim()]);
  });
});
