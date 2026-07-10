import type { PlanNode } from './types';

export type FlameMetric = 'actualTime' | 'cost' | 'actualRows' | 'rows';

export interface FlameRect {
  node: PlanNode;
  x0: number;        // px within [0, width]
  x1: number;
  depth: number;     // 0 = layout root
  value: number;     // rolled-up metric value
  selfValue: number; // value - Σ children rolled-up values, >= 0
}

export interface FlameLayoutOptions {
  width: number;
  minWidthPx?: number; // default 2
}

function rawValue(node: PlanNode, metric: FlameMetric): number {
  switch (metric) {
    case 'actualTime':
      return node.actualTime ?? 0;
    case 'cost':
      return node.cost ?? 0;
    case 'actualRows': {
      // Matches SankeyView: A-Rows is per-execution; multiply by starts for
      // total data volume, falling back to estimated rows if A-Rows absent.
      const actualRows = node.actualRows ?? node.rows ?? 0;
      const starts = node.starts ?? 1;
      return actualRows * starts;
    }
    case 'rows':
      return node.rows ?? 0;
    default:
      return 0;
  }
}

export function rollupMetric(root: PlanNode, metric: FlameMetric): Map<number, number> {
  const values = new Map<number, number>();

  function visit(node: PlanNode): number {
    let childSum = 0;
    for (const child of node.children) {
      childSum += visit(child);
    }
    const value = Math.max(rawValue(node, metric), childSum);
    values.set(node.id, value);
    return value;
  }

  visit(root);
  return values;
}

/** Allocates child widths within [px0, px1], enforcing a per-child minimum where feasible. */
function allocateChildWidths(
  children: PlanNode[],
  values: Map<number, number>,
  parentValue: number,
  px0: number,
  px1: number,
  minWidthPx: number
): number[] {
  const parentWidth = px1 - px0;
  const n = children.length;
  if (n === 0) return [];

  const idealWidths = children.map((child) => {
    const v = values.get(child.id) ?? 0;
    return parentValue === 0 ? parentWidth / n : (v / parentValue) * parentWidth;
  });

  if (parentWidth < n * minWidthPx) {
    // Not enough room to guarantee the minimum for every child; fall back to
    // pure proportional widths (hairlines are acceptable here).
    return idealWidths;
  }

  // Guarantee minWidthPx per child. Children below the minimum are pinned to
  // it; the deficit this creates (pinned width minus its ideal width) is
  // taken proportionally (by ideal width) from the still-unpinned children,
  // re-checking until stable. Unpinned children otherwise keep their ideal
  // width, so a parent's leftover self-space is preserved.
  const widths = idealWidths.slice();
  const pinned = new Set<number>();
  let changed = true;
  while (changed) {
    changed = false;
    const unpinnedIndices = widths.map((_, i) => i).filter((i) => !pinned.has(i));
    if (unpinnedIndices.length === 0) break;

    const deficit = children.reduce(
      (sum, _, i) => sum + (pinned.has(i) ? minWidthPx - idealWidths[i] : 0),
      0
    );
    const unpinnedIdealTotal = unpinnedIndices.reduce((sum, i) => sum + idealWidths[i], 0);

    for (const i of unpinnedIndices) {
      const width = unpinnedIdealTotal === 0
        ? idealWidths[i] - deficit / unpinnedIndices.length
        : idealWidths[i] - (idealWidths[i] / unpinnedIdealTotal) * deficit;
      if (width < minWidthPx) {
        widths[i] = minWidthPx;
        pinned.add(i);
        changed = true;
      } else {
        widths[i] = width;
      }
    }
  }

  return widths;
}

function buildRects(
  node: PlanNode,
  depth: number,
  px0: number,
  px1: number,
  values: Map<number, number>,
  minWidthPx: number,
  out: FlameRect[]
): void {
  const value = values.get(node.id) ?? 0;
  let childrenValueSum = 0;
  for (const child of node.children) {
    childrenValueSum += values.get(child.id) ?? 0;
  }
  const selfValue = Math.max(0, value - childrenValueSum);

  out.push({ node, x0: px0, x1: px1, depth, value, selfValue });

  if (node.children.length === 0) return;

  const widths = allocateChildWidths(node.children, values, value, px0, px1, minWidthPx);
  let cursor = px0;
  for (let i = 0; i < node.children.length; i++) {
    const child = node.children[i];
    let childX0 = cursor;
    let childX1 = cursor + widths[i];
    // Clamp each child's span to the parent's span to guard floating point drift.
    childX0 = Math.min(Math.max(childX0, px0), px1);
    childX1 = Math.min(Math.max(childX1, px0), px1);
    if (childX1 < childX0) childX1 = childX0;
    buildRects(child, depth + 1, childX0, childX1, values, minWidthPx, out);
    cursor += widths[i];
  }
}

export function computeFlameLayout(
  root: PlanNode,
  metric: FlameMetric,
  opts: FlameLayoutOptions
): FlameRect[] {
  const { width } = opts;
  const minWidthPx = opts.minWidthPx ?? 2;
  const values = rollupMetric(root, metric);
  const out: FlameRect[] = [];
  buildRects(root, 0, 0, width, values, minWidthPx, out);
  return out;
}

export function getEffectiveFlameMetric(preferred: FlameMetric, hasActualStats: boolean): FlameMetric {
  if (preferred !== 'cost' && !hasActualStats) return 'cost';
  return preferred;
}
