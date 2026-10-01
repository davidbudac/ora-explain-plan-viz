/** @jsxRuntime automatic */
/** @jsxImportSource react */
import { act, useLayoutEffect } from 'react';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { ReactFlow, ReactFlowProvider } from '@xyflow/react';
import type { Node, NodeTypes } from '@xyflow/react';
import { PlanProvider, usePlan } from '../../hooks/usePlanContext';
import { PlanNodeMemo } from '../nodes/PlanNode';
import type { PlanNodeData } from '../nodes/PlanNode';
import { TabularView } from '../views/TabularView';
import { Legend } from '../Legend';
import { InputPanel } from '../InputPanel';
import { PlanTabs } from '../PlanTabs';
import { ConfirmProvider, ToastProvider } from '../ui';
import { cleanup, render } from '../ui/__tests__/testUtils';
import { DENSITY_PRESETS } from '../../lib/density';
import type { DensityPreset } from '../../lib/density';
import { COLOR_SCHEMES } from '../../lib/types';
import type { ColorScheme, PlanNode as PlanNodeType } from '../../lib/types';

// jsdom has no layout, so a real virtualizer renders a handful of rows; render them all.
vi.mock('@tanstack/react-virtual', () => ({
  useVirtualizer: ({ count }: { count: number }) => ({
    options: { scrollMargin: 0 },
    getVirtualItems: () =>
      Array.from({ length: count }, (_, index) => ({ index, key: index, start: index * 30, end: index * 30 + 30, size: 30 })),
    getTotalSize: () => count * 30,
    measureElement: () => {},
    measure: () => {},
    scrollToIndex: () => {},
  }),
}));

const ADAPTIVE_PLAN = readFileSync(
  resolve(__dirname, '../../lib/parser/__tests__/fixtures/allstats-adaptive-19c.txt'),
  'utf8',
);

const nodeTypes = { planNode: PlanNodeMemo } as unknown as NodeTypes;
type Ctx = ReturnType<typeof usePlan>;

beforeAll(() => {
  class RO {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
  (globalThis as Record<string, unknown>).ResizeObserver ??= RO;
  (globalThis as Record<string, unknown>).DOMMatrixReadOnly ??= class {
    m22 = 1;
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

function plainNode(extra: Partial<PlanNodeType> = {}): PlanNodeType {
  return { id: 27, depth: 1, operation: 'HASH JOIN', cost: 10, rows: 100, children: [], ...extra };
}

function Canvas({ node, ...rest }: { node: PlanNodeType } & Partial<PlanNodeData>) {
  const data: PlanNodeData = {
    label: node.operation,
    node,
    totalCost: 10,
    isSelected: false,
    isFiltered: true,
    displayOptions: { ...DENSITY_PRESETS.compact },
    hasActualStats: false,
    ...rest,
  };
  const nodes: Node[] = [{ id: String(node.id), type: 'planNode', position: { x: 0, y: 0 }, data, width: 260, height: 120 }];
  return (
    <div style={{ width: 800, height: 600 }}>
      <ReactFlowProvider>
        <ReactFlow nodes={nodes} edges={[]} nodeTypes={nodeTypes} />
      </ReactFlowProvider>
    </div>
  );
}

const card = () => document.querySelector<HTMLElement>('.react-flow__node')!.firstElementChild as HTMLElement;

describe('tree node, inactive adaptive operation', () => {
  const densities: DensityPreset[] = ['minimal', 'compact', 'detailed'];
  const schemes = Object.keys(COLOR_SCHEMES) as ColorScheme[];

  for (const density of densities) {
    it(`is dimmed, dashed and tagged at ${density} density`, () => {
      render(<Canvas node={plainNode({ inactive: true })} displayOptions={{ ...DENSITY_PRESETS[density] }} />);
      expect(card().getAttribute('data-inactive')).toBe('true');
      expect(card().className).toContain('border-dashed');
      expect(Number(card().style.opacity)).toBeLessThanOrEqual(0.5);
      const chip = card().querySelector('[data-testid="inactive-chip"]');
      expect(chip?.textContent).toBe('inactive');
      expect(chip?.getAttribute('title')).toBe('Adaptive plan: the optimizer did not use this operation');
    });
  }

  for (const scheme of schemes) {
    it(`carries the inactive treatment in the ${scheme} color scheme`, () => {
      render(<Canvas node={plainNode({ inactive: true })} colorScheme={scheme} />);
      expect(card().className).toContain('border-dashed');
      expect(card().querySelector('[data-testid="inactive-chip"]')).not.toBeNull();
    });
  }

  it('leaves an active operation untouched', () => {
    render(<Canvas node={plainNode()} />);
    expect(card().getAttribute('data-inactive')).toBeNull();
    expect(card().className).not.toContain('border-dashed');
    expect(card().style.opacity).toBe('1');
    expect(card().querySelector('[data-testid="inactive-chip"]')).toBeNull();
  });

  it('keeps the selection ring and full opacity on a selected inactive node', () => {
    render(<Canvas node={plainNode({ inactive: true })} isSelected />);
    expect(card().className).toContain('ring-blue-600');
    expect(card().style.opacity).toBe('1');
  });
});

function renderWithPlan(ui: React.ReactNode, planText = ADAPTIVE_PLAN) {
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
  const load = () =>
    act(async () => {
      await latest.ctx!.loadAndParsePlan(planText, undefined, { recordRecent: false, skipConfirm: true });
    });
  return { ctx: () => latest.ctx!, load };
}

describe('tabular view, inactive adaptive operation', () => {
  it('mutes inactive rows and tags the Operation cell; active rows are unchanged', async () => {
    const { ctx, load } = renderWithPlan(<TabularView />);
    await load();
    const inactiveIds = ctx().parsedPlan!.allNodes.filter((n) => n.inactive).map((n) => n.id);
    expect(inactiveIds).toEqual(expect.arrayContaining([27, 29, 32]));

    const rows = Array.from(document.querySelectorAll<HTMLTableRowElement>('tr[data-index]'));
    expect(rows.length).toBeGreaterThan(0);
    const inactiveRows = rows.filter((r) => r.getAttribute('data-inactive') === 'true');
    expect(inactiveRows.length).toBeGreaterThan(0);
    for (const row of inactiveRows) {
      expect(row.className).toContain('opacity-60');
      expect(row.querySelector('[data-testid="inactive-tag"]')?.textContent).toBe('inactive');
    }
    for (const row of rows.filter((r) => r.getAttribute('data-inactive') !== 'true')) {
      expect(row.className).not.toContain('opacity-60');
      expect(row.querySelector('[data-testid="inactive-tag"]')).toBeNull();
    }
  });
});

describe('legend, inactive row', () => {
  it('explains the inactive style only when the plan has inactive operations', async () => {
    const adaptive = renderWithPlan(<Legend />);
    await adaptive.load();
    act(() => adaptive.ctx().setLegendVisible(true));
    expect(document.querySelector('[data-testid="legend-inactive"]')?.textContent).toContain('inactive');
    cleanup();

    const plain = renderWithPlan(<Legend />, `Plan hash value: 1234567890

--------------------------------------------------------------------------------
| Id  | Operation                    | Name       | Rows  | Bytes | Cost (%CPU)|
--------------------------------------------------------------------------------
|   0 | SELECT STATEMENT             |            |     1 |    10 |     5   (0)|
|   1 |  TABLE ACCESS FULL           | ORDERS     |     1 |    10 |     5   (0)|
--------------------------------------------------------------------------------
`);
    await plain.load();
    act(() => plain.ctx().setLegendVisible(true));
    expect(document.querySelector('section[aria-label="Legend"]')).not.toBeNull();
    expect(document.querySelector('[data-testid="legend-inactive"]')).toBeNull();
  });
});

describe('cursor child number', () => {
  it('shows "Child N" in the input drawer and in the plan tab tooltip', async () => {
    const { ctx, load } = renderWithPlan(
      <>
        <PlanTabs />
        <InputPanel />
      </>,
    );
    await load();
    act(() => ctx().setInputPanelCollapsed(false));
    const child = ctx().parsedPlan!.childNumber;
    expect(child).toBe(0);
    expect(document.body.textContent).toContain('Child 0');
    const tab = document.querySelector<HTMLButtonElement>('[role="group"][aria-label="Plans"] button[title*="PHV"]')!;
    expect(tab.title).toContain('PHV 3027739212 · child 0');
  });

  it('omits it when the plan has no cursor header', async () => {
    const { ctx, load } = renderWithPlan(
      <>
        <PlanTabs />
        <InputPanel />
      </>,
      `Plan hash value: 1234567890

--------------------------------------------------------------------------------
| Id  | Operation                    | Name       | Rows  | Bytes | Cost (%CPU)|
--------------------------------------------------------------------------------
|   0 | SELECT STATEMENT             |            |     1 |    10 |     5   (0)|
--------------------------------------------------------------------------------
`,
    );
    await load();
    act(() => ctx().setInputPanelCollapsed(false));
    expect(document.body.textContent).not.toContain('Child ');
    expect(document.querySelector('button[title*="PHV 1234567890"]')?.getAttribute('title')).not.toContain('child');
  });
});

