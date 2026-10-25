import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { cleanup } from '../../components/ui/__tests__/testUtils';
import { loadPlan, renderPlanContext } from '../../components/ui/__tests__/planContext';
import sampleBundle from '../../examples/sample-metadata-bundle.json';

// The sample bundle has no SQL_ID, so attaching it always opens the pairing
// chooser (needs-choice) once a plan is loaded.
const BUNDLE_TEXT = JSON.stringify(sampleBundle);

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
