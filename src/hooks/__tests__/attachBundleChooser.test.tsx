/** @jsxRuntime automatic */
/** @jsxImportSource react */
import { act, useLayoutEffect } from 'react';
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { PlanProvider, usePlan } from '../usePlanContext';
import { ConfirmProvider, ToastProvider } from '../../components/ui';
import { cleanup, render } from '../../components/ui/__tests__/testUtils';
import sampleBundle from '../../examples/sample-metadata-bundle.json';

// The sample bundle has no SQL_ID, so attaching it always opens the pairing
// chooser (needs-choice) once a plan is loaded.
const BUNDLE_TEXT = JSON.stringify(sampleBundle);

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

describe('attachBundleText with the pairing chooser', () => {
  it('resolves true only after the user picks a plan in the chooser', async () => {
    const ctx = renderPlanContext();
    await loadPlan(ctx);

    let settled: boolean | null = null;
    await act(async () => {
      void ctx.current().attachBundleText(BUNDLE_TEXT).then((attached) => {
        settled = attached;
      });
    });
    expect(ctx.current().pendingBundleChoice).not.toBeNull();
    expect(settled).toBeNull();

    await act(async () => {
      await ctx.current().resolveBundleChoice(0);
    });
    expect(settled).toBe(true);
    expect(ctx.current().pendingBundleChoice).toBeNull();
    expect(ctx.current().metadataBundle).not.toBeNull();
  });

  it('resolves false when the chooser is cancelled', async () => {
    const ctx = renderPlanContext();
    await loadPlan(ctx);

    let settled: boolean | null = null;
    await act(async () => {
      void ctx.current().attachBundleText(BUNDLE_TEXT).then((attached) => {
        settled = attached;
      });
    });
    expect(settled).toBeNull();

    await act(async () => {
      await ctx.current().resolveBundleChoice(null);
    });
    expect(settled).toBe(false);
    expect(ctx.current().metadataBundle).toBeNull();
  });

  it('resolves false when a newer chooser replaces a pending one', async () => {
    const ctx = renderPlanContext();
    await loadPlan(ctx);

    let first: boolean | null = null;
    let second: boolean | null = null;
    await act(async () => {
      void ctx.current().attachBundleText(BUNDLE_TEXT).then((attached) => {
        first = attached;
      });
    });
    await act(async () => {
      void ctx.current().attachBundleText(BUNDLE_TEXT).then((attached) => {
        second = attached;
      });
    });
    expect(first).toBe(false);
    expect(second).toBeNull();

    await act(async () => {
      await ctx.current().resolveBundleChoice(0);
    });
    expect(second).toBe(true);
  });
});
