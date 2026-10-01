/** @jsxRuntime automatic */
/** @jsxImportSource react */
import { act, useLayoutEffect } from 'react';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { PlanProvider, usePlan } from '../../hooks/usePlanContext';
import { ConfirmProvider, ToastProvider } from '../ui';
import { cleanup, click, render } from '../ui/__tests__/testUtils';
import { HeaderActions } from '../Header';
import * as clipboard from '../../lib/clipboard';
import * as filePicker from '../../lib/filePicker';

const PLAN_TEXT = `Plan hash value: 1234567890

--------------------------------------------------------------------------------
| Id  | Operation                    | Name       | Rows  | Bytes | Cost (%CPU)|
--------------------------------------------------------------------------------
|   0 | SELECT STATEMENT             |            |     1 |    10 |     5   (0)|
|   1 |  TABLE ACCESS FULL           | ORDERS     |     1 |    10 |     5   (0)|
--------------------------------------------------------------------------------
`;

type Ctx = ReturnType<typeof usePlan>;

function renderHeader(): { ctx: () => Ctx } {
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
          <HeaderActions />
        </PlanProvider>
      </ConfirmProvider>
    </ToastProvider>,
  );
  return { ctx: () => latest.ctx! };
}

function openFileMenu(): void {
  click(document.querySelector<HTMLButtonElement>('button[aria-label="File"]')!);
}

function menuItem(text: string): HTMLButtonElement {
  const match = Array.from(document.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')).find((b) =>
    b.textContent?.includes(text),
  );
  if (!match) throw new Error(`No menu item "${text}"`);
  return match;
}

beforeAll(() => {
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
  vi.restoreAllMocks();
});

describe('Header File menu', () => {
  it('lists "Open plan file…" first in Import and loads the picked files like a drop', async () => {
    const file = new File([PLAN_TEXT], 'my-plan.txt', { type: 'text/plain' });
    const picker = vi
      .spyOn(filePicker, 'openPlanFilePicker')
      .mockImplementation((onFiles) => onFiles([file]));
    const { ctx } = renderHeader();
    openFileMenu();

    const items = Array.from(document.querySelectorAll('[role="menuitem"]'));
    expect(items[0].textContent).toContain('Open plan file…');
    expect(menuItem('Open plan file…').disabled).toBe(false);
    expect(ctx().parsedPlan).toBeNull();

    await act(async () => {
      menuItem('Open plan file…').click();
    });
    expect(picker).toHaveBeenCalledTimes(1);
    // The menu closes after selecting, and the plan went through loadFiles.
    expect(document.querySelector('[role="menu"]')).toBeNull();
    // Reading the file is asynchronous (FileReader), so wait for the load.
    for (let i = 0; i < 50 && ctx().parsedPlan === null; i++) {
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 20));
      });
    }
    expect(ctx().parsedPlan?.planHashValue).toBe('1234567890');
  });

  it('disables "Copy plan as Markdown" until a plan is loaded, then copies and toasts', async () => {
    const copy = vi.spyOn(clipboard, 'copyToClipboard').mockResolvedValue(true);
    const { ctx } = renderHeader();

    openFileMenu();
    expect(menuItem('Copy plan as Markdown').disabled).toBe(true);
    click(document.querySelector<HTMLButtonElement>('button[aria-label="File"]')!);

    await act(async () => {
      await ctx().loadAndParsePlan(PLAN_TEXT, undefined, { recordRecent: false, skipConfirm: true });
    });

    openFileMenu();
    expect(menuItem('Copy plan as Markdown').disabled).toBe(false);
    await act(async () => {
      menuItem('Copy plan as Markdown').click();
    });

    expect(copy).toHaveBeenCalledTimes(1);
    const text = copy.mock.calls[0][0];
    expect(text).toContain('### Execution plan — plan hash value `1234567890`');
    expect(text).toContain('TABLE ACCESS FULL');
    expect(document.body.textContent).toContain('Plan copied as Markdown');
  });
});
