import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, click } from '../../components/ui/__tests__/testUtils';
import { loadPlan, renderPlanContext } from '../../components/ui/__tests__/planContext';
import type { PlanHandle } from '../../components/ui/__tests__/planContext';
import { NodeDetailBody } from '../../components/NodeDetailPanel';

/** Two loaded plans; plan A (index 0) is left active. */
async function loadTwoPlans(ctx: PlanHandle) {
  await loadPlan(ctx);
  act(() => ctx.current().addPlanSlot());
  await loadPlan(ctx);
  act(() => ctx.current().setActivePlan(0));
  expect(ctx.current().activePlanIndex).toBe(0);
}

const highlightOf = (ctx: PlanHandle, planIndex: number, nodeId: number) =>
  ctx.current().plans[planIndex].annotations.nodeHighlights.get(nodeId);

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
});
afterEach(() => {
  cleanup();
});

describe('highlight brush state', () => {
  it('starts as a red circle brush and merges partial updates', () => {
    const ctx = renderPlanContext();
    expect(ctx.current().highlightBrush).toEqual({ color: 'red', style: 'circle' });

    act(() => ctx.current().setHighlightBrush({ color: 'blue' }));
    expect(ctx.current().highlightBrush).toEqual({ color: 'blue', style: 'circle' });

    act(() => ctx.current().setHighlightBrush({ style: 'glow' }));
    expect(ctx.current().highlightBrush).toEqual({ color: 'blue', style: 'glow' });
    // The brush style is the global highlight style
    expect(ctx.current().highlightStyle).toBe('glow');

    act(() => ctx.current().setHighlightStyle('tint'));
    expect(ctx.current().highlightBrush).toEqual({ color: 'blue', style: 'tint' });
  });

  it('persists the brush and restores it on the next visit', () => {
    vi.useFakeTimers();
    try {
      const first = renderPlanContext();
      act(() => first.current().setHighlightBrush({ color: 'purple', style: 'dot' }));
      act(() => {
        vi.advanceTimersByTime(400);
      });
      const saved = JSON.parse(localStorage.getItem('ora-explain-viz-settings') ?? '{}');
      expect(saved.highlightBrushColor).toBe('purple');
      expect(saved.highlightStyle).toBe('dot');

      cleanup();
      const second = renderPlanContext();
      expect(second.current().highlightBrush).toEqual({ color: 'purple', style: 'dot' });
    } finally {
      vi.useRealTimers();
    }
  });

  it('keeps the brush object stable across unrelated updates', () => {
    const ctx = renderPlanContext();
    const before = ctx.current().highlightBrush;
    act(() => ctx.current().setHighlightBrush({ color: 'red' }));
    expect(ctx.current().highlightBrush).toBe(before);
  });
});

describe('setNodeHighlight stamps a style', () => {
  it('gives a new highlight the brush style', async () => {
    const ctx = renderPlanContext();
    await loadPlan(ctx);
    act(() => ctx.current().setHighlightStyle('hachure'));
    act(() => ctx.current().setNodeHighlight(1, 'green'));
    expect(highlightOf(ctx, 0, 1)).toEqual({ nodeId: 1, color: 'green', style: 'hachure' });
  });

  it('keeps each highlight on the style it was created with when the brush changes', async () => {
    const ctx = renderPlanContext();
    await loadPlan(ctx);
    act(() => ctx.current().setHighlightStyle('glow'));
    act(() => ctx.current().setNodeHighlight(1, 'red'));
    act(() => ctx.current().setHighlightStyle('tint'));
    act(() => ctx.current().setNodeHighlight(0, 'blue'));
    expect(highlightOf(ctx, 0, 1)?.style).toBe('glow');
    expect(highlightOf(ctx, 0, 0)?.style).toBe('tint');
  });

  it('changing only the colour keeps the node style', async () => {
    const ctx = renderPlanContext();
    await loadPlan(ctx);
    act(() => ctx.current().setNodeHighlight(1, 'red', 'underline'));
    act(() => ctx.current().setHighlightStyle('tint'));
    act(() => ctx.current().setNodeHighlight(1, 'purple'));
    expect(highlightOf(ctx, 0, 1)).toEqual({ nodeId: 1, color: 'purple', style: 'underline' });
  });

  it('an explicit style restyles just that node', async () => {
    const ctx = renderPlanContext();
    await loadPlan(ctx);
    act(() => ctx.current().setNodeHighlight(1, 'red'));
    act(() => ctx.current().setNodeHighlight(0, 'red'));
    act(() => ctx.current().setNodeHighlight(1, 'red', 'dot'));
    expect(highlightOf(ctx, 0, 1)?.style).toBe('dot');
    expect(highlightOf(ctx, 0, 0)?.style).toBe('circle');
  });
});

describe('paintNodeWithBrush', () => {
  it('paints with the brush, then clears on the second click', async () => {
    const ctx = renderPlanContext();
    await loadPlan(ctx);
    act(() => ctx.current().setHighlightBrush({ color: 'orange', style: 'glow' }));

    act(() => ctx.current().paintNodeWithBrush(0, 1));
    expect(highlightOf(ctx, 0, 1)).toEqual({ nodeId: 1, color: 'orange', style: 'glow' });

    act(() => ctx.current().paintNodeWithBrush(0, 1));
    expect(highlightOf(ctx, 0, 1)).toBeUndefined();
  });

  it('repaints (rather than clears) when the node carries a different brush', async () => {
    const ctx = renderPlanContext();
    await loadPlan(ctx);
    act(() => ctx.current().setHighlightBrush({ color: 'orange', style: 'glow' }));
    act(() => ctx.current().paintNodeWithBrush(0, 1));

    act(() => ctx.current().setHighlightBrush({ color: 'blue' }));
    act(() => ctx.current().paintNodeWithBrush(0, 1));
    expect(highlightOf(ctx, 0, 1)).toEqual({ nodeId: 1, color: 'blue', style: 'glow' });

    act(() => ctx.current().setHighlightBrush({ style: 'tint' }));
    act(() => ctx.current().paintNodeWithBrush(0, 1));
    expect(highlightOf(ctx, 0, 1)).toEqual({ nodeId: 1, color: 'blue', style: 'tint' });
  });

  it('treats a style-less (legacy) highlight as drawn in the global style', async () => {
    const ctx = renderPlanContext();
    await loadPlan(ctx);
    act(() => ctx.current().setHighlightBrush({ color: 'red', style: 'circle' }));
    // Simulate a highlight restored from an older save: colour only
    act(() => {
      const legacy = ctx.current().annotations;
      legacy.nodeHighlights.set(1, { nodeId: 1, color: 'red' });
    });
    act(() => ctx.current().paintNodeWithBrush(0, 1));
    expect(highlightOf(ctx, 0, 1)).toBeUndefined();
  });

  it('acts on the requested plan without switching the active one', async () => {
    const ctx = renderPlanContext();
    await loadTwoPlans(ctx);

    act(() => ctx.current().paintNodeWithBrush(1, 1));
    expect(highlightOf(ctx, 1, 1)).toBeDefined();
    expect(highlightOf(ctx, 0, 1)).toBeUndefined();
    expect(ctx.current().activePlanIndex).toBe(0);

    act(() => ctx.current().paintNodeWithBrush(1, 1));
    expect(highlightOf(ctx, 1, 1)).toBeUndefined();
  });
});

describe('plan-targeted note and highlight setters', () => {
  it('write to the addressed plan only', async () => {
    const ctx = renderPlanContext();
    await loadTwoPlans(ctx);

    act(() => ctx.current().setNodeAnnotationForPlan(1, 0, 'second plan note'));
    act(() => ctx.current().setNodeHighlightForPlan(1, 0, 'pink', 'dot'));
    expect(ctx.current().plans[1].annotations.nodeAnnotations.get(0)?.text).toBe('second plan note');
    expect(highlightOf(ctx, 1, 0)).toEqual({ nodeId: 0, color: 'pink', style: 'dot' });
    expect(ctx.current().plans[0].annotations.nodeAnnotations.size).toBe(0);
    expect(highlightOf(ctx, 0, 0)).toBeUndefined();

    act(() => ctx.current().removeNodeAnnotationForPlan(1, 0));
    act(() => ctx.current().removeNodeHighlightForPlan(1, 0));
    expect(ctx.current().plans[1].annotations.nodeAnnotations.size).toBe(0);
    expect(highlightOf(ctx, 1, 0)).toBeUndefined();
  });

  it('the plain setters still act on the active plan', async () => {
    const ctx = renderPlanContext();
    await loadTwoPlans(ctx);
    act(() => ctx.current().setNodeAnnotation(1, 'active plan note'));
    act(() => ctx.current().setNodeHighlight(1, 'red'));
    expect(ctx.current().plans[0].annotations.nodeAnnotations.get(1)?.text).toBe('active plan note');
    expect(highlightOf(ctx, 0, 1)?.color).toBe('red');
    expect(ctx.current().plans[1].annotations.nodeAnnotations.size).toBe(0);

    act(() => ctx.current().removeNodeAnnotation(1));
    act(() => ctx.current().removeNodeHighlight(1));
    expect(ctx.current().plans[0].annotations.nodeAnnotations.size).toBe(0);
    expect(highlightOf(ctx, 0, 1)).toBeUndefined();
  });
});

describe('details panel restyles only the selected node', () => {
  it('the Style buttons change this node\'s highlight, not the brush or other nodes', async () => {
    const ctx = renderPlanContext(<NodeDetailBody />);
    await loadPlan(ctx);
    act(() => ctx.current().setNodeHighlight(0, 'red', 'circle'));
    act(() => ctx.current().setNodeHighlight(1, 'blue', 'circle'));
    act(() => ctx.current().selectNode(1));

    const group = document.querySelector('[role="group"][aria-label="Highlight style"]')!;
    const glow = Array.from(group.querySelectorAll('button')).find((b) => b.textContent === 'Glow')!;
    const circle = Array.from(group.querySelectorAll('button')).find((b) => b.textContent === 'Circle')!;
    // The node's own style is what shows as pressed
    expect(circle.getAttribute('aria-pressed')).toBe('true');

    click(glow);
    expect(highlightOf(ctx, 0, 1)).toEqual({ nodeId: 1, color: 'blue', style: 'glow' });
    expect(highlightOf(ctx, 0, 0)?.style).toBe('circle');
    expect(ctx.current().highlightStyle).toBe('circle');
    expect(glow.getAttribute('aria-pressed')).toBe('true');
  });

  it('shows the global style as pressed for a legacy highlight without its own', async () => {
    const ctx = renderPlanContext(<NodeDetailBody />);
    await loadPlan(ctx);
    act(() => ctx.current().setHighlightStyle('tint'));
    act(() => {
      ctx.current().annotations.nodeHighlights.set(1, { nodeId: 1, color: 'green' });
    });
    act(() => ctx.current().selectNode(1));
    const group = document.querySelector('[role="group"][aria-label="Highlight style"]')!;
    const tint = Array.from(group.querySelectorAll('button')).find((b) => b.textContent === 'Tint')!;
    expect(tint.getAttribute('aria-pressed')).toBe('true');
  });
});
