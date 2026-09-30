/** @jsxRuntime automatic */
/** @jsxImportSource react */
import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PlanNode } from '../../lib/types';

function node(id: number, cost: number, children: PlanNode[] = [], objectName?: string): PlanNode {
  return { id, depth: 0, operation: id === 0 ? 'SELECT STATEMENT' : 'TABLE ACCESS FULL', cost, objectName, children };
}

const ctx = vi.hoisted(() => ({
  parsedPlan: null as unknown,
  selectNode: vi.fn(),
  selectedNodeIds: [] as number[],
  filteredNodeIds: new Set<number>(),
  filters: { searchText: '' },
}));

vi.mock('../../hooks/usePlanContext', () => ({
  usePlan: () => ({
    parsedPlan: ctx.parsedPlan,
    selectedNodeIds: ctx.selectedNodeIds,
    selectNode: ctx.selectNode,
    filteredNodeIds: ctx.filteredNodeIds,
    theme: 'light',
    colorScheme: 'semantic',
    filters: ctx.filters,
    flameMetric: 'cost',
  }),
}));

import { FlameView } from '../views/FlameView';
import { buttonByText, cleanup, click, press, render } from '../ui/__tests__/testUtils';

const HINT_KEY = 'ora-explain-viz-flame-zoom-hint-dismissed';
const HINT_TEXT = 'Double-click a bar to zoom in · Esc resets';

function setPlan(root: PlanNode, ids: number[]) {
  ctx.parsedPlan = { rootNode: root, hasActualStats: true };
  ctx.filteredNodeIds = new Set(ids);
}

beforeEach(() => {
  setPlan(node(0, 100, [node(1, 60, [], 'ORDERS'), node(2, 40, [], 'ITEMS')]), [0, 1, 2]);
  ctx.selectedNodeIds = [];
  ctx.selectNode.mockReset();
  localStorage.removeItem(HINT_KEY);

  vi.stubGlobal(
    'ResizeObserver',
    class {
      constructor(private cb: () => void) {}
      observe() {
        this.cb();
      }
      disconnect() {}
    },
  );
  Object.defineProperty(HTMLElement.prototype, 'clientWidth', { configurable: true, get: () => 900 });
  Object.defineProperty(HTMLElement.prototype, 'clientHeight', { configurable: true, get: () => 400 });
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  delete (HTMLElement.prototype as unknown as { clientWidth?: number }).clientWidth;
  delete (HTMLElement.prototype as unknown as { clientHeight?: number }).clientHeight;
});

const bars = () => Array.from(document.querySelectorAll<SVGRectElement>('rect[data-node-id]'));
const bar = (id: number) => document.querySelector<SVGRectElement>(`rect[data-node-id="${id}"]`)!;

async function draw() {
  await act(async () => {
    render(<FlameView />);
  });
}

describe('FlameView zoom hint', () => {
  it('shows the discoverability hint until dismissed, and remembers the dismissal', async () => {
    await draw();
    expect(document.body.textContent).toContain(HINT_TEXT);

    await act(async () => {
      click(document.querySelector<HTMLButtonElement>('button[aria-label="Dismiss hint"]')!);
    });
    expect(document.body.textContent).not.toContain(HINT_TEXT);
    expect(localStorage.getItem(HINT_KEY)).toBe('1');

    // A fresh mount stays dismissed
    cleanup();
    await draw();
    expect(document.body.textContent).not.toContain(HINT_TEXT);
  });
});

describe('FlameView bars', () => {
  it('are focusable buttons with descriptive accessible names', async () => {
    await draw();
    expect(bars()).toHaveLength(3);
    for (const b of bars()) {
      expect(b.getAttribute('tabindex')).toBe('0');
      expect(b.getAttribute('role')).toBe('button');
    }
    const label = bar(1).getAttribute('aria-label')!;
    expect(label).toContain('#1 TABLE ACCESS FULL (ORDERS)');
    expect(label).toContain('% of total: 60.0%');
  });

  it('select on Enter / Space, additively with Ctrl/Cmd', async () => {
    await draw();
    await act(async () => {
      press(bar(1), 'Enter');
    });
    expect(ctx.selectNode).toHaveBeenLastCalledWith(1, { additive: false });
    await act(async () => {
      press(bar(2), ' ');
    });
    expect(ctx.selectNode).toHaveBeenLastCalledWith(2, { additive: false });
    await act(async () => {
      press(bar(2), 'Enter', { ctrlKey: true });
    });
    expect(ctx.selectNode).toHaveBeenLastCalledWith(2, { additive: true });
  });

  it('zoom with Shift+Enter and reset with Escape (before deselecting)', async () => {
    ctx.selectedNodeIds = [1];
    await draw();

    await act(async () => {
      press(bar(1), 'Enter', { shiftKey: true });
    });
    expect(document.body.textContent).toContain('Reset zoom');
    // Zooming counts as having found the gesture: the hint goes away for good
    expect(document.body.textContent).not.toContain(HINT_TEXT);
    expect(localStorage.getItem(HINT_KEY)).toBe('1');

    await act(async () => {
      press(document.body, 'Escape');
    });
    expect(document.body.textContent).not.toContain('Reset zoom');
    // The first Escape only reset the zoom
    expect(ctx.selectNode).not.toHaveBeenCalled();

    await act(async () => {
      press(document.body, 'Escape');
    });
    expect(ctx.selectNode).toHaveBeenCalledWith(null);
  });

  it('skips bars narrower than half a pixel', async () => {
    // tiny is pinned to its 2px minimum; its eight children cannot all get 2px
    // and end up ~0.25px wide each.
    const tinyChildren = Array.from({ length: 8 }, (_, i) => node(10 + i, 0.125));
    setPlan(node(0, 1000, [node(1, 999), node(2, 1, tinyChildren)]), [0, 1, 2, ...tinyChildren.map((c) => c.id)]);
    await draw();

    const ids = bars().map((b) => Number(b.dataset.nodeId));
    expect(ids).toEqual(expect.arrayContaining([0, 1, 2]));
    expect(ids.filter((id) => id >= 10)).toHaveLength(0);
  });

  it('still draws a selected bar even when it is sub-pixel', async () => {
    const tinyChildren = Array.from({ length: 8 }, (_, i) => node(10 + i, 0.125));
    setPlan(node(0, 1000, [node(1, 999), node(2, 1, tinyChildren)]), [0, 1, 2, ...tinyChildren.map((c) => c.id)]);
    ctx.selectedNodeIds = [12];
    await draw();
    expect(bar(12)).not.toBeNull();
  });
});

describe('FlameView zoom reset button', () => {
  it('is keyboard reachable and resets the zoom', async () => {
    await draw();
    await act(async () => {
      press(bar(1), 'Enter', { shiftKey: true });
    });
    await act(async () => {
      click(buttonByText('Reset zoom'));
    });
    expect(document.body.textContent).not.toContain('Reset zoom');
  });
});
