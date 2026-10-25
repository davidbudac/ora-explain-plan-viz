import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, click } from '../ui/__tests__/testUtils';
import { SIMPLE_PLAN, loadPlan, renderPlanContext } from '../ui/__tests__/planContext';
import { HeaderActions } from '../Header';
import * as clipboard from '../../lib/clipboard';
import * as filePicker from '../../lib/filePicker';

const renderHeader = () => renderPlanContext(<HeaderActions />);

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
    const file = new File([SIMPLE_PLAN], 'my-plan.txt', { type: 'text/plain' });
    const picker = vi
      .spyOn(filePicker, 'openPlanFilePicker')
      .mockImplementation((onFiles) => onFiles([file]));
    const plan = renderHeader();
    openFileMenu();

    const items = Array.from(document.querySelectorAll('[role="menuitem"]'));
    expect(items[0].textContent).toContain('Open plan file…');
    expect(menuItem('Open plan file…').disabled).toBe(false);
    expect(plan.current().parsedPlan).toBeNull();

    await act(async () => {
      menuItem('Open plan file…').click();
    });
    expect(picker).toHaveBeenCalledTimes(1);
    // The menu closes after selecting, and the plan went through loadFiles.
    expect(document.querySelector('[role="menu"]')).toBeNull();
    // Reading the file is asynchronous (FileReader), so wait for the load.
    for (let i = 0; i < 50 && plan.current().parsedPlan === null; i++) {
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 20));
      });
    }
    expect(plan.current().parsedPlan?.planHashValue).toBe('1234567890');
  });

  it('disables "Copy plan as Markdown" until a plan is loaded, then copies and toasts', async () => {
    const copy = vi.spyOn(clipboard, 'copyToClipboard').mockResolvedValue(true);
    const plan = renderHeader();

    openFileMenu();
    expect(menuItem('Copy plan as Markdown').disabled).toBe(true);
    click(document.querySelector<HTMLButtonElement>('button[aria-label="File"]')!);

    await loadPlan(plan);

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
