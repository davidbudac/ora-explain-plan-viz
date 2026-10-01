/**
 * Walkthrough ("guided tour") content and layout math. Pure — no React, no DOM
 * — so the step list and the card/spotlight placement are unit-testable. The
 * overlay itself lives in `components/Walkthrough.tsx`.
 */

export type WalkthroughPlacement = 'top' | 'bottom' | 'left' | 'right' | 'auto';
export type ResolvedPlacement = 'top' | 'bottom' | 'left' | 'right' | 'center';

export interface WalkthroughStep {
  id: string;
  title: string;
  body: string;
  /** Value of a `data-tour` attribute on the element to spotlight. Omit for a centred card. */
  target?: string;
  /** Used when `target` is not on screen (e.g. the action cluster folded into a menu). */
  fallbackTarget?: string;
  placement?: WalkthroughPlacement;
  /** Side effect performed when the step is entered. */
  action?: 'selectHotNode';
}

const IS_MAC = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform ?? '');
const MOD = IS_MAC ? '⌘' : 'Ctrl';

export const WALKTHROUGH_STEPS: WalkthroughStep[] = [
  {
    id: 'welcome',
    title: 'Welcome to the plan visualizer',
    body:
      "We've loaded a sample plan so you can try things out. This 1-minute tour covers the main parts of the screen; use the arrow keys or the buttons to move on.",
  },
  {
    id: 'tree',
    title: 'The plan tree',
    target: 'tree',
    placement: 'auto',
    body:
      'Drag to pan and scroll to zoom. Click an operation to select it, and use the arrow keys to move to its parent (↑), first child (↓) or siblings (←/→). Hover a node for the highlight, note, zoom and copy toolbar.',
  },
  {
    id: 'details',
    title: 'Operation details',
    target: 'details',
    placement: 'left',
    action: 'selectHotNode',
    body:
      "We selected the hottest operation for you. The details panel shows its predicates, estimated vs actual rows, spills and the advisor's findings for that node.",
  },
  {
    id: 'filters',
    title: 'Filters',
    target: 'filters',
    placement: 'bottom',
    body:
      'Search the plan, filter by operation type, cost, rows or time, or drag the cardinality-mismatch slider to show only operations where the estimate was badly off.',
  },
  {
    id: 'view-controls',
    title: 'View controls',
    target: 'view-controls',
    placement: 'bottom',
    body:
      'Switch node density (Minimal / Compact / Detailed), pick the metric on the node badge, flip the tree between top-down and left-to-right, and toggle the minimap and legend.',
  },
  {
    id: 'view-tabs',
    title: 'Other views',
    target: 'view-tabs',
    placement: 'bottom',
    body:
      'The same plan as a sortable table, a Sankey flow, a flame graph, raw plan text, the SQL statement, schema metadata and more. Which tabs appear depends on what your plan contains.',
  },
  {
    id: 'plan-tabs',
    title: 'Compare two plans',
    target: 'plan-tabs',
    placement: 'bottom',
    body:
      'Use Add Plan to load a second plan, for example before and after a fix. Then open Compare, or the side-by-side Tree and Tabular views, to see what changed.',
  },
  {
    id: 'input',
    title: 'Load your own plan',
    target: 'input',
    placement: 'bottom',
    body:
      'Open the plan input here and paste DBMS_XPLAN, SQL Monitor, JSON or xbi output, or just drop a file anywhere on the page. Load Example and Recent plans are in the top bar.',
  },
  {
    id: 'actions',
    title: 'Share and export',
    target: 'actions',
    placement: 'bottom',
    body:
      'Copy a share link, export the tree as a PNG, build a client report, or save your annotations from the File menu. Everything runs in your browser; plans are never uploaded.',
  },
  {
    id: 'palette',
    title: 'Command palette and shortcuts',
    target: 'palette',
    fallbackTarget: 'actions',
    placement: 'bottom',
    body: `Press ${MOD}+K to search every action and setting, ? for all keyboard shortcuts, F to maximize the canvas and Z for focus mode.`,
  },
  {
    id: 'done',
    title: "You're all set",
    body:
      'Load your own plan to get started. You can replay this tour any time from Help → Walkthrough or the command palette.',
  },
];

export interface Rect {
  top: number;
  left: number;
  width: number;
  height: number;
}

export interface Size {
  width: number;
  height: number;
}

export const VIEWPORT_MARGIN = 8;

function clamp(value: number, min: number, max: number): number {
  // When the box is larger than the room, pin it to the start edge.
  if (max < min) return min;
  return Math.min(Math.max(value, min), max);
}

/** The highlight box around a target: the rect grown by `padding`, kept inside the viewport. */
export function spotlightRect(target: Rect, viewport: Size, padding = 6): Rect {
  const left = Math.max(0, target.left - padding);
  const top = Math.max(0, target.top - padding);
  const right = Math.min(viewport.width, target.left + target.width + padding);
  const bottom = Math.min(viewport.height, target.top + target.height + padding);
  return { top, left, width: Math.max(0, right - left), height: Math.max(0, bottom - top) };
}

/**
 * Where to put the tour card. No target → centred. `auto` prefers the side
 * with room in the order bottom, right, top, left; an explicit placement that
 * does not fit flips to the opposite side (and falls back to `auto`). The
 * result is always clamped to the viewport with an 8px margin.
 */
export function computeCardPosition(
  target: Rect | null,
  card: Size,
  viewport: Size,
  placement: WalkthroughPlacement = 'auto',
  gap = 12,
): { top: number; left: number; placement: ResolvedPlacement } {
  const m = VIEWPORT_MARGIN;
  const maxLeft = viewport.width - card.width - m;
  const maxTop = viewport.height - card.height - m;

  if (!target) {
    return {
      top: clamp((viewport.height - card.height) / 2, m, maxTop),
      left: clamp((viewport.width - card.width) / 2, m, maxLeft),
      placement: 'center',
    };
  }

  const room = {
    bottom: viewport.height - (target.top + target.height) - gap - m,
    top: target.top - gap - m,
    right: viewport.width - (target.left + target.width) - gap - m,
    left: target.left - gap - m,
  };
  const fits = (side: 'top' | 'bottom' | 'left' | 'right') =>
    side === 'top' || side === 'bottom' ? room[side] >= card.height : room[side] >= card.width;
  const opposite = { top: 'bottom', bottom: 'top', left: 'right', right: 'left' } as const;

  let side: 'top' | 'bottom' | 'left' | 'right' | null = null;
  if (placement !== 'auto') {
    if (fits(placement)) side = placement;
    else if (fits(opposite[placement])) side = opposite[placement];
  }
  if (!side) {
    side = (['bottom', 'right', 'top', 'left'] as const).find(fits) ?? null;
  }
  if (!side) {
    // Nothing fits cleanly (small viewport, big target): take the roomiest side.
    side = (['bottom', 'right', 'top', 'left'] as const).reduce((best, s) => (room[s] > room[best] ? s : best), 'bottom');
  }

  const centerX = target.left + target.width / 2 - card.width / 2;
  const centerY = target.top + target.height / 2 - card.height / 2;
  let top: number;
  let left: number;
  switch (side) {
    case 'bottom':
      top = target.top + target.height + gap;
      left = centerX;
      break;
    case 'top':
      top = target.top - gap - card.height;
      left = centerX;
      break;
    case 'right':
      top = centerY;
      left = target.left + target.width + gap;
      break;
    default:
      top = centerY;
      left = target.left - gap - card.width;
      break;
  }
  return {
    top: clamp(top, m, maxTop),
    left: clamp(left, m, maxLeft),
    placement: side,
  };
}

export interface WalkthroughSampleLike {
  name: string;
  category: string;
  featured?: boolean;
}

/**
 * The example the tour loads when no plan is open: it needs actual runtime
 * stats (so there is a hot node and A-Rows), which in practice means a SQL
 * Monitor sample. Prefers "Cardinality Trap (NL)", then any featured SQL
 * Monitor sample, then any featured example, then the first SQL Monitor one.
 */
export function pickWalkthroughSample<T extends WalkthroughSampleLike>(
  byCategory: { sql_monitor: T[] },
  featured: T[],
): T | null {
  const monitor = byCategory.sql_monitor;
  return (
    monitor.find((s) => s.name === 'Cardinality Trap (NL)') ??
    monitor.find((s) => s.featured) ??
    featured[0] ??
    monitor[0] ??
    null
  );
}
