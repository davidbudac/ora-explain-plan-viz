import type { PlanNode } from './types';

/**
 * Visible operations grouped by depth, in plan order — what the tree view's
 * "previous / next operation at the same depth" arrows step through.
 */
export interface DepthIndex {
  /** Visible nodes at each depth, in plan (allNodes) order. */
  byDepth: ReadonlyMap<number, readonly PlanNode[]>;
  /** Each visible node's position within its depth's list. */
  position: ReadonlyMap<number, number>;
}

/** One pass over the plan; rebuild only when the plan or the collapsed set changes. */
export function buildDepthIndex(nodes: readonly PlanNode[], hiddenIds: ReadonlySet<number>): DepthIndex {
  const byDepth = new Map<number, PlanNode[]>();
  const position = new Map<number, number>();
  for (const node of nodes) {
    if (hiddenIds.has(node.id)) continue;
    let level = byDepth.get(node.depth);
    if (!level) {
      level = [];
      byDepth.set(node.depth, level);
    }
    position.set(node.id, level.length);
    level.push(node);
  }
  return { byDepth, position };
}

/**
 * The visible node `delta` steps away from `node` at the same depth (siblings
 * come first, since they are adjacent in plan order), or null at either end
 * or when `node` itself is hidden.
 */
export function stepAtSameDepth(index: DepthIndex, node: PlanNode, delta: -1 | 1): number | null {
  const at = index.position.get(node.id);
  if (at === undefined) return null;
  return index.byDepth.get(node.depth)?.[at + delta]?.id ?? null;
}
