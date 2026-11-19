import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup } from '../../components/ui/__tests__/testUtils';
import { SIMPLE_PLAN, loadPlan, renderPlanContext } from '../../components/ui/__tests__/planContext';
import { SESSION_KEY, SESSION_STALE_KEY } from '../../lib/session';

// A real oversized session needs > 4 MB of plan text; force the outcome instead.
const control = vi.hoisted(() => ({ tooLarge: false }));
vi.mock('../../lib/session', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../lib/session')>();
  return {
    ...actual,
    saveSession: (...args: Parameters<typeof actual.saveSession>) =>
      control.tooLarge
        ? ({ ok: false, reason: 'too-large', chars: 5 * 1024 * 1024 } as const)
        : actual.saveSession(...args),
  };
});

const PLAN_B = SIMPLE_PLAN.replace('1234567890', '987654321').replace('ORDERS', 'ITEMS');
const PLAN_C = SIMPLE_PLAN.replace('1234567890', '555555555').replace('ORDERS', 'CUSTOMERS');
const WARNING_TITLE = 'Autosave is off for this session';

const toastText = () => document.querySelector<HTMLElement>('[data-ui-toast-region]')?.textContent ?? '';
const warningCount = () => toastText().split(WARNING_TITLE).length - 1;
const flush = () => act(async () => { await new Promise((resolve) => setTimeout(resolve, 20)); });
/** Run the autosave now instead of waiting for its 1 s debounce. */
const autosaveNow = () => act(() => { window.dispatchEvent(new Event('pagehide')); });

beforeEach(() => {
  control.tooLarge = false;
  localStorage.clear();
  window.history.replaceState(null, '', '/');
});
afterEach(() => {
  cleanup();
  localStorage.clear();
});

describe('autosave of an oversized session', () => {
  it('warns once per oversize episode', async () => {
    const handle = renderPlanContext();
    await loadPlan(handle);

    control.tooLarge = true;
    autosaveNow();
    expect(toastText()).toContain(WARNING_TITLE);
    expect(toastText()).toContain('5.0 MB');
    expect(toastText()).toContain('4 MB autosave limit');
    expect(warningCount()).toBe(1);

    // Still too large after another change: no second warning.
    await loadPlan(handle, PLAN_B);
    autosaveNow();
    expect(warningCount()).toBe(1);

    // A successful save re-arms the warning.
    control.tooLarge = false;
    await loadPlan(handle, PLAN_C);
    autosaveNow();
    control.tooLarge = true;
    await loadPlan(handle, SIMPLE_PLAN);
    autosaveNow();
    expect(warningCount()).toBe(2);
  });
});

describe('restore toast', () => {
  function saveSnapshot() {
    localStorage.setItem(
      SESSION_KEY,
      JSON.stringify({ version: 1, savedAt: '', activePlanIndex: 0, viewMode: 'hierarchical', slots: [{ text: SIMPLE_PLAN }] }),
    );
  }

  it('says "previous session" for an up-to-date snapshot', async () => {
    saveSnapshot();
    const handle = renderPlanContext();
    await flush();
    expect(handle.current().parsedPlan).not.toBeNull();
    expect(toastText()).toContain('Restored your previous session');
  });

  it('says the snapshot is older when a later autosave was skipped', async () => {
    saveSnapshot();
    localStorage.setItem(SESSION_STALE_KEY, '1');
    const handle = renderPlanContext();
    await flush();
    expect(handle.current().parsedPlan).not.toBeNull();
    expect(toastText()).toContain('Restored an older session: the most recent one was too large to autosave');
    expect(toastText()).not.toContain('Restored your previous session');

    // The restored state is saved again, which clears the flag.
    autosaveNow();
    expect(localStorage.getItem(SESSION_STALE_KEY)).toBeNull();
  });
});
