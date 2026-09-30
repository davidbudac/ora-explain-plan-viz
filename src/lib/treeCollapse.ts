/**
 * Pure helpers for collapsing / expanding plan subtrees in the tree view.
 *
 * Collapse state is a set of node ids whose *descendants* are hidden: the
 * collapsed node itself stays on the canvas (with a "+N hidden" badge), its
 * whole subtree is dropped from layout and edges.
 *
 * Every helper that returns a collapse set returns the *same instance* when
 * nothing changed, so callers can bail out of state updates cheaply.
 */

/** The minimal tree shape the helpers need (PlanNode satisfies it). */
export interface CollapsibleNode {
  id: number;
  children: readonly CollapsibleNode[];
}

/** Resolves a node's parent id (undefined for the root / unknown ids). */
export type ParentLookup = (id: number) => number | undefined;

export const EMPTY_COLLAPSED: ReadonlySet<number> = new Set<number>();

/**
 * Tree-view actions a mounted HierarchicalView registers so chrome outside
 * the canvas (toolbar, command palette) can drive it.
 */
export interface TreeViewActions {
  expandAll: () => void;
  collapseAll: () => void;
  /** Fit the whole (visible) tree into the canvas. */
  fitView: () => void;
  /** Centre the selected node at a readable zoom (no-op without a selection). */
  focusSelected: () => void;
  /** Drop manual node drags: re-apply the computed layout, then fit the tree. */
  resetLayout: () => void;
}

/**
 * Tree state the mounted HierarchicalView publishes for chrome outside the
 * canvas (the toolbar's layout strip, focus mode's View chip).
 */
export interface TreeViewState {
  /** Operations currently hidden inside collapsed subtrees. */
  hiddenCount: number;
  /** The plan has at least one subtree below the root that could be collapsed. */
  canCollapse: boolean;
  /** The overview map is on screen (resolves the 'auto' minimap mode). */
  minimapShown: boolean;
}

/** Ids of every node hidden because some ancestor is collapsed. */
export function computeHiddenNodeIds(
  root: CollapsibleNode | null | undefined,
  collapsed: ReadonlySet<number>,
): Set<number> {
  const hidden = new Set<number>();
  if (!root || collapsed.size === 0) return hidden;
  const stack: Array<{ node: CollapsibleNode; isHidden: boolean }> = [{ node: root, isHidden: false }];
  while (stack.length > 0) {
    const { node, isHidden } = stack.pop()!;
    if (isHidden) hidden.add(node.id);
    const hideChildren = isHidden || collapsed.has(node.id);
    for (const child of node.children) stack.push({ node: child, isHidden: hideChildren });
  }
  return hidden;
}

/** Number of descendants (all depths, excluding the node itself) per node id. */
export function countDescendants(root: CollapsibleNode | null | undefined): Map<number, number> {
  const counts = new Map<number, number>();
  if (!root) return counts;
  const visit = (node: CollapsibleNode): number => {
    let total = 0;
    for (const child of node.children) total += 1 + visit(child);
    counts.set(node.id, total);
    return total;
  };
  visit(root);
  return counts;
}

/** Ancestors of `nodeId`, nearest first. Guards against cyclic parent data. */
export function getAncestorIds(nodeId: number, parentOf: ParentLookup): number[] {
  const ancestors: number[] = [];
  const seen = new Set<number>([nodeId]);
  let current = parentOf(nodeId);
  while (current !== undefined && !seen.has(current)) {
    ancestors.push(current);
    seen.add(current);
    current = parentOf(current);
  }
  return ancestors;
}

/**
 * Expand every collapsed ancestor of the given nodes so they become visible.
 * Returns the same set instance when nothing had to change.
 */
export function expandAncestors(
  collapsed: ReadonlySet<number>,
  nodeIds: Iterable<number>,
  parentOf: ParentLookup,
): ReadonlySet<number> {
  if (collapsed.size === 0) return collapsed;
  let next: Set<number> | null = null;
  for (const id of nodeIds) {
    for (const ancestorId of getAncestorIds(id, parentOf)) {
      if (collapsed.has(ancestorId)) {
        next ??= new Set(collapsed);
        next.delete(ancestorId);
      }
    }
  }
  return next ?? collapsed;
}

/** Collapse (or expand) one node. Returns the same instance when already in that state. */
export function setNodeCollapsed(
  collapsed: ReadonlySet<number>,
  nodeId: number,
  isCollapsed: boolean,
): ReadonlySet<number> {
  if (collapsed.has(nodeId) === isCollapsed) return collapsed;
  const next = new Set(collapsed);
  if (isCollapsed) next.add(nodeId);
  else next.delete(nodeId);
  return next;
}

/** Flip one node's collapsed state. */
export function toggleNodeCollapsed(collapsed: ReadonlySet<number>, nodeId: number): ReadonlySet<number> {
  return setNodeCollapsed(collapsed, nodeId, !collapsed.has(nodeId));
}

/**
 * "Collapse all": every node that has children, except the root, so the
 * canvas shows the root and its direct children — each a collapsed stub the
 * user can expand one level at a time.
 */
export function collapseAllIds(root: CollapsibleNode | null | undefined): ReadonlySet<number> {
  const ids = new Set<number>();
  if (!root) return ids;
  const stack: CollapsibleNode[] = [...root.children];
  while (stack.length > 0) {
    const node = stack.pop()!;
    if (node.children.length > 0) ids.add(node.id);
    stack.push(...node.children);
  }
  return ids;
}

/**
 * The nearest ancestor of `nodeId` that is not hidden — the collapsed stub
 * that currently stands in for a hidden node. Returns `nodeId` itself when it
 * is visible, or null when nothing on the path is visible.
 */
export function nearestVisibleAncestor(
  nodeId: number,
  hidden: ReadonlySet<number>,
  parentOf: ParentLookup,
): number | null {
  if (!hidden.has(nodeId)) return nodeId;
  for (const ancestorId of getAncestorIds(nodeId, parentOf)) {
    if (!hidden.has(ancestorId)) return ancestorId;
  }
  return null;
}

/**
 * Per collapsed node, how many of its hidden descendants satisfy `matches`
 * (e.g. the active search). Only collapsed nodes that are themselves visible
 * get an entry, and only when the count is non-zero.
 */
export function countHiddenMatches(
  root: CollapsibleNode | null | undefined,
  collapsed: ReadonlySet<number>,
  matches: (id: number) => boolean,
): Map<number, number> {
  const result = new Map<number, number>();
  if (!root || collapsed.size === 0) return result;
  const countSubtree = (node: CollapsibleNode): number => {
    let total = 0;
    for (const child of node.children) {
      if (matches(child.id)) total++;
      total += countSubtree(child);
    }
    return total;
  };
  const walkVisible = (node: CollapsibleNode) => {
    if (collapsed.has(node.id)) {
      const count = countSubtree(node);
      if (count > 0) result.set(node.id, count);
      return;
    }
    node.children.forEach(walkVisible);
  };
  walkVisible(root);
  return result;
}

/* ------------------------------------------------------------------ *
 * In-memory collapse memory, keyed on plan identity.
 *
 * A WeakMap keyed on the parsed plan object: collapse state survives view
 * switches (Tree → Tabular → Tree) and remounts (layout direction / colour
 * scheme changes), resets automatically when a different plan is parsed
 * (new object), and is garbage-collected with the plan. Never persisted.
 * ------------------------------------------------------------------ */

const collapseMemory = new WeakMap<object, ReadonlySet<number>>();

export function recallCollapsed(planKey: object | null | undefined): ReadonlySet<number> {
  if (!planKey) return EMPTY_COLLAPSED;
  return collapseMemory.get(planKey) ?? EMPTY_COLLAPSED;
}

export function rememberCollapsed(planKey: object | null | undefined, collapsed: ReadonlySet<number>): void {
  if (!planKey) return;
  if (collapsed.size === 0) collapseMemory.delete(planKey);
  else collapseMemory.set(planKey, collapsed);
}
