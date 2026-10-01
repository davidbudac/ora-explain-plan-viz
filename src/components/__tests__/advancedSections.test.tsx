/** @jsxRuntime automatic */
/** @jsxImportSource react */
import { act, useLayoutEffect } from 'react';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { PlanProvider, usePlan } from '../../hooks/usePlanContext';
import { NodeDetailBody } from '../NodeDetailPanel';
import { SqlTextView } from '../views/SqlTextView';
import { ConfirmProvider, ToastProvider } from '../ui';
import { cleanup, render } from '../ui/__tests__/testUtils';

const ADVANCED = readFileSync(
  resolve(__dirname, '../../lib/parser/__tests__/fixtures/advanced-allstats-19c.txt'),
  'utf8',
);

type Ctx = ReturnType<typeof usePlan>;

beforeAll(() => {
  (globalThis as Record<string, unknown>).ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
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
afterEach(() => cleanup());

async function mount(ui: React.ReactNode) {
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
          {ui}
        </PlanProvider>
      </ConfirmProvider>
    </ToastProvider>,
  );
  await act(async () => {
    await latest.ctx!.loadAndParsePlan(ADVANCED, undefined, { recordRecent: false, skipConfirm: true });
  });
  return () => latest.ctx!;
}

describe('ADVANCED sections in the UI', () => {
  it('shows hints with status and reason, and the projection, for the selected operation', async () => {
    const ctx = await mount(<NodeDetailBody />);
    act(() => ctx().selectNode(1));

    const text = document.body.textContent ?? '';
    expect(text).toContain('no_such_hint');
    expect(text).toContain('syntax error');
    expect(text).toContain('index(o)');
    expect(text).toContain('unused');
    expect(text).toContain('hint on view cannot be pushed into view');
    expect(text).toContain('Projection');
    expect(text).toContain('COUNT(*)[22]');
  });

  it('shows no hint or projection sections for an operation without them', async () => {
    const ctx = await mount(<NodeDetailBody />);
    act(() => ctx().selectNode(0));
    const headings = Array.from(document.querySelectorAll('h4')).map((h) => h.textContent);
    expect(headings).not.toContain('Hints');
    expect(headings).not.toContain('Projection');
  });

  it('lists the outline hints and the hint summary under the SQL text', async () => {
    await mount(<SqlTextView />);
    const text = document.body.textContent ?? '';
    expect(text).toContain('Hint report: 3 hints (1 unused, 2 syntax errors)');
    expect(text).toContain('Outline hints');
    expect(text).toContain('IGNORE_OPTIM_EMBEDDED_HINTS');
    expect(text).toContain('Copy as hint block');
  });
});
