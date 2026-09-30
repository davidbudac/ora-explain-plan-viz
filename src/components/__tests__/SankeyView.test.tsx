/** @jsxRuntime automatic */
/** @jsxImportSource react */
import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PlanNode } from '../../lib/types';

function node(id: number, operation: string, rows: number | undefined, children: PlanNode[] = [], extra: Partial<PlanNode> = {}): PlanNode {
  return { id, depth: 0, operation, rows, cost: 10, children, ...extra };
}

/** Shape of the "Cardinality Trap (NL)" example: estimates of ~126 rows all the way down. */
function buildPlan(): PlanNode {
  return node(0, 'SELECT STATEMENT', undefined, [
    node(1, 'SORT GROUP BY NOSORT', 126, [
      node(2, 'NESTED LOOPS', 126, [
        node(3, 'NESTED LOOPS', 128, [
          node(4, 'TABLE ACCESS FULL', 32, [], { objectName: 'ORDERS' }),
          node(5, 'INDEX RANGE SCAN', 4, [], { objectName: 'ORDER_ITEMS_IX' }),
        ]),
        node(6, 'TABLE ACCESS BY INDEX ROWID', 4, [], { objectName: 'ORDER_ITEMS' }),
      ]),
    ]),
  ]);
}

// The real context hands out referentially stable values; the view's redraw logic
// depends on that, so the mock must too (set once per test via `setRoot`).
const ctx = vi.hoisted(() => ({
  parsedPlan: null as unknown,
  metric: 'rows',
  selectNode: vi.fn(),
  selectedNodeIds: [] as number[],
  filteredNodeIds: new Set<number>([0, 1, 2, 3, 4, 5, 6]),
  filters: { searchText: '' },
}));

vi.mock('../../hooks/usePlanContext', () => ({
  usePlan: () => ({
    parsedPlan: ctx.parsedPlan,
    selectedNodeIds: ctx.selectedNodeIds,
    selectNode: ctx.selectNode,
    sankeyMetric: ctx.metric,
    filteredNodeIds: ctx.filteredNodeIds,
    theme: 'light',
    colorScheme: 'semantic',
    filters: ctx.filters,
  }),
}));

function setRoot(root: PlanNode) {
  ctx.parsedPlan = { rootNode: root, hasActualStats: false };
}

import { SankeyView } from '../views/SankeyView';
import { buttonByText, cleanup, click, render } from '../ui/__tests__/testUtils';

// --- environment stubs: jsdom has no layout, ResizeObserver or SVG text metrics
let resizeCallbacks: Array<() => void> = [];
let paneWidth = 900;
let failBBoxOnce = false;

beforeEach(() => {
  setRoot(buildPlan());
  ctx.metric = 'rows';
  ctx.selectedNodeIds = [];
  ctx.filteredNodeIds = new Set([0, 1, 2, 3, 4, 5, 6]);
  ctx.selectNode.mockReset();
  resizeCallbacks = [];
  paneWidth = 900;
  failBBoxOnce = false;

  vi.stubGlobal(
    'ResizeObserver',
    class {
      constructor(private cb: () => void) {}
      observe() {
        resizeCallbacks.push(this.cb);
        this.cb();
      }
      disconnect() {}
    },
  );
  Object.defineProperty(HTMLElement.prototype, 'clientWidth', { configurable: true, get: () => paneWidth });
  Object.defineProperty(HTMLElement.prototype, 'clientHeight', { configurable: true, get: () => 500 });
  (SVGElement.prototype as unknown as { getBBox: () => unknown }).getBBox = () => {
    if (failBBoxOnce) {
      failBBoxOnce = false;
      throw new Error('getBBox exploded');
    }
    return { x: 0, y: 0, width: 40, height: 12 };
  };
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  delete (HTMLElement.prototype as unknown as { clientWidth?: number }).clientWidth;
  delete (HTMLElement.prototype as unknown as { clientHeight?: number }).clientHeight;
});

const svg = () => document.querySelector<SVGSVGElement>('svg[aria-label^="Sankey"]')!;
const nodeRects = () => Array.from(svg().querySelectorAll<SVGRectElement>('rect[data-node-id]'));
const nodeRect = (id: number) => svg().querySelector<SVGRectElement>(`rect[data-node-id="${id}"]`)!;

async function draw(element = <SankeyView />) {
  await act(async () => {
    render(element);
  });
}

describe('SankeyView', () => {
  it('draws one keyboard-operable, named button per operation', async () => {
    await draw();
    expect(nodeRects()).toHaveLength(7);
    for (const rect of nodeRects()) {
      expect(rect.getAttribute('tabindex')).toBe('0');
      expect(rect.getAttribute('role')).toBe('button');
      expect(rect.getAttribute('aria-pressed')).toBe('false');
    }
    expect(nodeRect(4).getAttribute('aria-label')).toBe('#4 TABLE ACCESS FULL ORDERS, Rows 32');
    expect(nodeRect(0).getAttribute('aria-label')).toMatch(/^#0 SELECT STATEMENT, Rows /);
  });

  it('names the metric in a caption', async () => {
    await draw();
    expect(document.body.textContent).toContain('Metric: Rows');
  });

  it('sizes nodes in proportion to their flow (equal estimates give equal boxes)', async () => {
    await draw();
    const h = (id: number) => Number(nodeRect(id).getAttribute('height'));
    // Operations 0-3 all carry ~126-132 estimated rows: near-identical heights
    expect(Math.abs(h(0) - h(1))).toBeLessThan(1);
    expect(h(3) / h(0)).toBeGreaterThan(0.95);
    // 32 rows is a quarter of 128
    expect(h(4) / h(3)).toBeCloseTo(32 / 128, 1);
  });

  it('never draws a node thinner than the minimum height', async () => {
    // A 1-row root next to a 1M-row flow would collapse to a sub-pixel sliver
    ctx.metric = 'actualRows';
    setRoot(
      node(0, 'SELECT STATEMENT', undefined, [
        node(1, 'TABLE ACCESS FULL', 1_000_000, [], { objectName: 'BIG', actualRows: 1_000_000, starts: 1 }),
        node(2, 'INDEX RANGE SCAN', 1, [], { actualRows: 1, starts: 1 }),
      ]),
    );
    ctx.filteredNodeIds = new Set([0, 1, 2]);
    await draw();
    for (const rect of nodeRects()) {
      expect(Number(rect.getAttribute('height'))).toBeGreaterThanOrEqual(4);
    }
  });

  it('selects on Enter and Space, additively with Ctrl/Cmd', async () => {
    await draw();
    const rect = nodeRect(3);
    await act(async () => {
      rect.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
    });
    expect(ctx.selectNode).toHaveBeenLastCalledWith(3, { additive: false });

    await act(async () => {
      rect.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', bubbles: true, cancelable: true }));
    });
    expect(ctx.selectNode).toHaveBeenLastCalledWith(3, { additive: false });

    await act(async () => {
      rect.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', ctrlKey: true, bubbles: true, cancelable: true }));
    });
    expect(ctx.selectNode).toHaveBeenLastCalledWith(3, { additive: true });

    const before = ctx.selectNode.mock.calls.length;
    await act(async () => {
      rect.dispatchEvent(new KeyboardEvent('keydown', { key: 'a', bubbles: true, cancelable: true }));
    });
    expect(ctx.selectNode.mock.calls.length).toBe(before);
  });

  it('reflects the selection in aria-pressed', async () => {
    ctx.selectedNodeIds = [2];
    await draw();
    expect(nodeRect(2).getAttribute('aria-pressed')).toBe('true');
    expect(nodeRect(3).getAttribute('aria-pressed')).toBe('false');
  });

  it('re-fits when the pane is resized (e.g. a side panel opens)', async () => {
    await draw();
    expect(svg().getAttribute('width')).toBe('900');

    paneWidth = 620;
    await act(async () => {
      resizeCallbacks.forEach((cb) => cb());
    });
    expect(svg().getAttribute('width')).toBe('620');
  });

  it('shows an error card with a working "Try again" when drawing fails', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {}); // the view logs the failure
    failBBoxOnce = true;
    await draw();

    const alert = document.querySelector<HTMLElement>('[role="alert"]');
    expect(alert).not.toBeNull();
    expect(alert!.textContent).toContain('getBBox exploded');

    await act(async () => {
      click(buttonByText('Try again'));
    });
    expect(document.querySelector('[role="alert"]')).toBeNull();
    expect(nodeRects()).toHaveLength(7);
  });
});
