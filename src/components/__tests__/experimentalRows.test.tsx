/** @jsxRuntime automatic */
/** @jsxImportSource react */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PlanNode } from '../../lib/types';

function node(id: number, operation: string, rows: number, children: PlanNode[] = [], objectName?: string): PlanNode {
  return { id, depth: 0, operation, rows, actualRows: rows, children, objectName };
}

const leaf = node(2, 'TABLE ACCESS FULL', 1_000_000, [], 'ORDERS');
const filter = node(1, 'HASH GROUP BY', 100, [leaf]);
const root = node(0, 'SELECT STATEMENT', 100, [filter]);
const allNodes = [root, filter, leaf];

const ctx = vi.hoisted(() => ({
  selectNode: vi.fn(),
  selectedNodeIds: [] as number[],
}));

vi.mock('../../hooks/usePlanContext', () => {
  const filteredNodeIds = new Set([0, 1, 2]);
  const filters = { searchText: '' };
  const nodeById = new Map<number, PlanNode>();
  const parsedPlan = {
    rootNode: null as unknown,
    allNodes: [] as PlanNode[],
    hasActualStats: true,
    activityTimeline: {
      durationSecs: 3,
      bucketIntervalSecs: 1,
      bucketCount: 3,
      samples: [
        { bucket: 0, line: 2, waitClass: 'CPU', count: 3 },
        { bucket: 1, line: 2, waitClass: 'User I/O', event: 'db file scattered read', count: 1 },
      ],
    },
  };
  return {
    // Filled in by the tests' module scope below (hoisted mocks cannot see it directly)
    __fixture: { parsedPlan, nodeById },
    usePlan: () => ({
      parsedPlan,
      nodeById,
      selectedNodeIds: ctx.selectedNodeIds,
      selectNode: ctx.selectNode,
      filteredNodeIds,
      filters,
      colorScheme: 'semantic',
      theme: 'light',
    }),
  };
});

import * as planContext from '../../hooks/usePlanContext';
import { WaterfallView } from '../views/experimental/WaterfallView';
import { WaitsView } from '../views/experimental/WaitsView';
import { cleanup, click, render } from '../ui/__tests__/testUtils';

const fixture = (planContext as unknown as { __fixture: { parsedPlan: Record<string, unknown>; nodeById: Map<number, PlanNode> } }).__fixture;

beforeEach(() => {
  fixture.parsedPlan.rootNode = root;
  fixture.parsedPlan.allNodes = allNodes;
  fixture.nodeById.clear();
  for (const n of allNodes) fixture.nodeById.set(n.id, n);
  ctx.selectNode.mockReset();
  ctx.selectedNodeIds = [];
});
afterEach(cleanup);

describe('WaterfallView rows', () => {
  it('are real buttons that report selection and describe the operation', () => {
    ctx.selectedNodeIds = [2];
    render(<WaterfallView />);
    const rows = Array.from(document.querySelectorAll<HTMLButtonElement>('button[aria-pressed]'));
    expect(rows).toHaveLength(3);

    const scan = rows.find((b) => b.getAttribute('aria-label')?.startsWith('#2 '))!;
    expect(scan.getAttribute('aria-pressed')).toBe('true');
    expect(scan.getAttribute('aria-label')).toContain('TABLE ACCESS FULL ORDERS');
    expect(scan.getAttribute('aria-label')).toContain('1.0M rows out');
    // A leaf scan has no input rows to report
    expect(scan.getAttribute('aria-label')).not.toContain(' in');

    const group = rows.find((b) => b.getAttribute('aria-label')?.startsWith('#1 '))!;
    expect(group.getAttribute('aria-pressed')).toBe('false');
    // 1M rows in, 100 out: announced in words, without the decorative arrow glyph
    expect(group.getAttribute('aria-label')).toContain('filter');
    expect(group.getAttribute('aria-label')).not.toContain('▼');
  });

  it('select on click', () => {
    render(<WaterfallView />);
    click(document.querySelector<HTMLButtonElement>('button[aria-label^="#1 "]')!);
    expect(ctx.selectNode).toHaveBeenCalledWith(1, { additive: false });
  });
});

describe('WaitsView rows', () => {
  it('are real buttons summarising the samples per wait class', () => {
    ctx.selectedNodeIds = [2];
    render(<WaitsView />);
    const row = document.querySelector<HTMLButtonElement>('button[aria-pressed]')!;
    expect(row.getAttribute('aria-pressed')).toBe('true');
    const label = row.getAttribute('aria-label')!;
    expect(label).toContain('#2 TABLE ACCESS FULL ORDERS');
    expect(label).toContain('4 ASH samples');
    expect(label).toContain('CPU 3');
    expect(label).toContain('User I/O 1');
  });

  it('select on click', () => {
    render(<WaitsView />);
    click(document.querySelector<HTMLButtonElement>('button[aria-pressed]')!);
    expect(ctx.selectNode).toHaveBeenCalledWith(2, { additive: false });
  });
});
