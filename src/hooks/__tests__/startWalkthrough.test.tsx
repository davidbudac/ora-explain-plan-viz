/** @jsxRuntime automatic */
/** @jsxImportSource react */
import { act, useLayoutEffect } from 'react';
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { PlanProvider, usePlan } from '../usePlanContext';
import { ConfirmProvider, ToastProvider } from '../../components/ui';
import { cleanup, render } from '../../components/ui/__tests__/testUtils';

const PLAN_TEXT = `Plan hash value: 1234567890

--------------------------------------------------------------------------------
| Id  | Operation                    | Name       | Rows  | Bytes | Cost (%CPU)|
--------------------------------------------------------------------------------
|   0 | SELECT STATEMENT             |            |     1 |    10 |     5   (0)|
|   1 |  TABLE ACCESS FULL           | ORDERS     |     1 |    10 |     5   (0)|
--------------------------------------------------------------------------------
`;

type Ctx = ReturnType<typeof usePlan>;

function renderPlanContext(): { current: () => Ctx } {
  const latest: { ctx: Ctx | null } = { ctx: null };
  function Probe() {
    const ctx = usePlan();
    useLayoutEffect(() => {
      latest.ctx = ctx;
    });
    return null;
  }
  render(
    <ToastProvider>
      <ConfirmProvider>
        <PlanProvider>
          <Probe />
        </PlanProvider>
      </ConfirmProvider>
    </ToastProvider>,
  );
  return { current: () => latest.ctx! };
}

async function loadPlan(ctx: { current: () => Ctx }) {
  await act(async () => {
    await ctx.current().loadAndParsePlan(PLAN_TEXT, undefined, { recordRecent: false, skipConfirm: true });
  });
  expect(ctx.current().parsedPlan).not.toBeNull();
}

beforeAll(() => {
  // jsdom has no matchMedia; the provider reads prefers-color-scheme on init.
  if (typeof window.matchMedia !== 'function') {
    window.matchMedia = ((query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
    })) as typeof window.matchMedia;
  }
});

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
