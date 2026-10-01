/** @jsxRuntime automatic */
/** @jsxImportSource react */
import { act, useLayoutEffect } from 'react';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { ReactFlow, ReactFlowProvider } from '@xyflow/react';
import type { Node, NodeTypes } from '@xyflow/react';
import { PlanProvider, usePlan } from '../../hooks/usePlanContext';
import { PlanNodeMemo } from '../nodes/PlanNode';
import type { PlanNodeData } from '../nodes/PlanNode';
import { ConfirmProvider, ToastProvider } from '../ui';
import { cleanup, click, press, render } from '../ui/__tests__/testUtils';
import { defaultNodeDisplayOptions } from '../../lib/settings';
import type { PlanNode as PlanNodeType } from '../../lib/types';

const PLAN_TEXT = `Plan hash value: 1234567890

--------------------------------------------------------------------------------
| Id  | Operation                    | Name       | Rows  | Bytes | Cost (%CPU)|
--------------------------------------------------------------------------------
|   0 | SELECT STATEMENT             |            |     1 |    10 |     5   (0)|
|   1 |  TABLE ACCESS FULL           | ORDERS     |     1 |    10 |     5   (0)|
--------------------------------------------------------------------------------
`;

const nodeTypes = { planNode: PlanNodeMemo } as unknown as NodeTypes;

type Ctx = ReturnType<typeof usePlan>;

beforeAll(() => {
  // React Flow needs a few browser APIs jsdom lacks
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

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

function Canvas({ node, ready, onNodeClick }: { node: PlanNodeType | null; ready: boolean; onNodeClick?: () => void }) {
  if (!node || !ready) return null;
  const data: PlanNodeData = {
    label: node.operation,
    node,
    totalCost: 5,
    isSelected: false,
    isFiltered: true,
    displayOptions: { ...defaultNodeDisplayOptions },
    hasActualStats: false,
    planIndex: 0,
  };
  const nodes: Node[] = [{ id: String(node.id), type: 'planNode', position: { x: 0, y: 0 }, data, width: 260, height: 120 }];
  return (
    <div style={{ width: 800, height: 600 }}>
      <ReactFlow nodes={nodes} edges={[]} nodeTypes={nodeTypes} fitView onNodeClick={onNodeClick} />
    </div>
  );
}

function Scene({ onCtx, ready, onNodeClick }: { onCtx: (ctx: Ctx) => void; ready: boolean; onNodeClick?: () => void }) {
  const ctx = usePlan();
  useLayoutEffect(() => {
    onCtx(ctx);
  });
  return <Canvas node={ctx.parsedPlan?.allNodes[1] ?? null} ready={ready} onNodeClick={onNodeClick} />;
}

async function mountScene() {
  let ctx: Ctx | null = null;
  const onNodeClick = vi.fn();
  const tree = (ready: boolean) => (
    <ToastProvider>
      <ConfirmProvider>
        <PlanProvider>
          <ReactFlowProvider>
            <Scene onCtx={(c) => (ctx = c)} ready={ready} onNodeClick={onNodeClick} />
          </ReactFlowProvider>
        </PlanProvider>
      </ConfirmProvider>
    </ToastProvider>
  );
  const view = render(tree(false));
  await act(async () => {
    await ctx!.loadAndParsePlan(PLAN_TEXT, undefined, { recordRecent: false, skipConfirm: true });
  });
  vi.useFakeTimers();
  view.rerender(tree(true));
  const nodeEl = document.querySelector<HTMLElement>('.react-flow__node')!;
  const card = nodeEl.firstElementChild as HTMLElement;
  return { ctx: () => ctx!, onNodeClick, nodeEl, card };
}

const toolbarEl = () => document.querySelector<HTMLElement>('[role="toolbar"]');
const advance = (ms: number) => act(() => void vi.advanceTimersByTime(ms));
const hoverIn = (card: HTMLElement) =>
  act(() => void card.dispatchEvent(new MouseEvent('mouseover', { bubbles: true, relatedTarget: document.body })));
const hoverOut = (card: HTMLElement) =>
  act(() => void card.dispatchEvent(new MouseEvent('mouseout', { bubbles: true, relatedTarget: document.body })));

describe('hover toolbar inside a real React Flow node', () => {
  it('mounts into the flow renderer after a hover and unmounts after the pointer leaves', async () => {
    const { nodeEl, card } = await mountScene();
    expect(nodeEl.getAttribute('aria-keyshortcuts')).toBe('Shift+F10');
    expect(toolbarEl()).toBeNull();

    hoverIn(card);
    advance(100);
    const toolbar = toolbarEl();
    expect(toolbar).not.toBeNull();
    // Portalled into the flow renderer, outside the viewport that PNG export captures
    expect(toolbar!.closest('.react-flow__renderer')).not.toBeNull();
    expect(toolbar!.closest('.react-flow__viewport')).toBeNull();
    expect(toolbar!.closest('.react-flow__node-toolbar')).not.toBeNull();

    hoverOut(card);
    advance(300);
    expect(toolbarEl()).toBeNull();
  });

  it('paints on click without selecting the node; a click on the card does select it', async () => {
    const { ctx, onNodeClick, card } = await mountScene();
    hoverIn(card);
    advance(100);

    const paint = toolbarEl()!.querySelector<HTMLButtonElement>('button[aria-label^="Paint with"]')!;
    click(paint);
    expect(ctx().plans[0].annotations.nodeHighlights.get(1)).toEqual({ nodeId: 1, color: 'red', style: 'circle' });
    expect(onNodeClick).not.toHaveBeenCalled();
    expect(toolbarEl()!.querySelector('button[aria-label^="Remove"]')?.getAttribute('aria-pressed')).toBe('true');

    // Toggle: a second click takes it off again
    click(toolbarEl()!.querySelector<HTMLButtonElement>('button[aria-label^="Remove"]')!);
    expect(ctx().plans[0].annotations.nodeHighlights.size).toBe(0);
    expect(onNodeClick).not.toHaveBeenCalled();

    // Control: the same click on the node itself reaches React Flow's node click handler
    click(card);
    expect(onNodeClick).toHaveBeenCalledTimes(1);
  });

  it('the brush picker paints many nodes with one brush: pick once, then one click each', async () => {
    const { ctx, card } = await mountScene();
    hoverIn(card);
    advance(100);
    click(toolbarEl()!.querySelector<HTMLButtonElement>('button[aria-label="Choose highlight brush"]')!);
    const dialog = document.querySelector<HTMLElement>('[role="dialog"]')!;
    click(dialog.querySelector<HTMLButtonElement>('button[aria-label="Blue brush"]')!);
    click(Array.from(dialog.querySelectorAll('button')).find((b) => b.textContent === 'Glow')!);
    expect(ctx().highlightBrush).toEqual({ color: 'blue', style: 'glow' });
    // Picking did not paint
    expect(ctx().plans[0].annotations.nodeHighlights.size).toBe(0);

    click(Array.from(dialog.querySelectorAll('button')).find((b) => b.textContent === 'Paint #1')!);
    expect(ctx().plans[0].annotations.nodeHighlights.get(1)).toEqual({ nodeId: 1, color: 'blue', style: 'glow' });
    expect(document.querySelector('[role="dialog"]')).toBeNull();
  });

  it('the popover keeps the toolbar up while the pointer is away', async () => {
    const { card } = await mountScene();
    hoverIn(card);
    advance(100);
    click(toolbarEl()!.querySelector<HTMLButtonElement>('button[aria-label="Add note"]')!);
    hoverOut(card);
    advance(1000);
    expect(toolbarEl()).not.toBeNull();
    expect(document.querySelector('[role="dialog"]')).not.toBeNull();
  });

  it('Shift+F10 opens the toolbar on the focused node; Escape hides it and returns focus to the node', async () => {
    const { nodeEl } = await mountScene();
    act(() => nodeEl.focus());
    expect(toolbarEl()).toBeNull();

    press(nodeEl, 'F10', { shiftKey: true });
    const toolbar = toolbarEl();
    expect(toolbar).not.toBeNull();
    expect(document.activeElement).toBe(toolbar!.querySelector('button'));

    press(document.activeElement!, 'Escape');
    expect(toolbarEl()).toBeNull();
    expect(document.activeElement).toBe(nodeEl);
  });
});
