import { describe, expect, it } from 'vitest';
import {
  EMPTY_COLLAPSED,
  collapseAllIds,
  computeHiddenNodeIds,
  countDescendants,
  countHiddenMatches,
  expandAncestors,
  getAncestorIds,
  nearestVisibleAncestor,
  recallCollapsed,
  rememberCollapsed,
  setNodeCollapsed,
  toggleNodeCollapsed,
} from '../treeCollapse';
import type { CollapsibleNode } from '../treeCollapse';

/*
 *        0
 *        |
 *        1
 *      /   \
 *     2     5
 *    / \     \
 *   3   4     6
 *              \
 *               7
 */
interface TestNode extends CollapsibleNode {
  parentId?: number;
  children: TestNode[];
}

function node(id: number, children: TestNode[] = []): TestNode {
  const n: TestNode = { id, children };
  children.forEach((c) => { c.parentId = id; });
  return n;
}

function buildTree() {
  const root = node(0, [node(1, [node(2, [node(3), node(4)]), node(5, [node(6, [node(7)])])])]);
  const byId = new Map<number, TestNode>();
  const walk = (n: TestNode) => { byId.set(n.id, n); n.children.forEach(walk); };
  walk(root);
  const parentOf = (id: number) => byId.get(id)?.parentId;
  return { root, parentOf };
}

describe('computeHiddenNodeIds', () => {
  it('hides nothing without collapsed nodes', () => {
    const { root } = buildTree();
    expect(computeHiddenNodeIds(root, EMPTY_COLLAPSED).size).toBe(0);
    expect(computeHiddenNodeIds(null, new Set([1])).size).toBe(0);
  });

  it('hides every descendant of a collapsed node but keeps the node itself', () => {
    const { root } = buildTree();
    expect([...computeHiddenNodeIds(root, new Set([2]))].sort()).toEqual([3, 4]);
    expect([...computeHiddenNodeIds(root, new Set([5]))].sort()).toEqual([6, 7]);
  });

  it('handles nested collapsed nodes (inner state is kept but irrelevant)', () => {
    const { root } = buildTree();
    const hidden = computeHiddenNodeIds(root, new Set([1, 6]));
    expect([...hidden].sort()).toEqual([2, 3, 4, 5, 6, 7]);
  });
});

describe('countDescendants', () => {
  it('counts all descendants per node', () => {
    const { root } = buildTree();
    const counts = countDescendants(root);
    expect(counts.get(0)).toBe(7);
    expect(counts.get(1)).toBe(6);
    expect(counts.get(2)).toBe(2);
    expect(counts.get(5)).toBe(2);
    expect(counts.get(7)).toBe(0);
  });
});

describe('getAncestorIds', () => {
  it('lists ancestors nearest first', () => {
    const { parentOf } = buildTree();
    expect(getAncestorIds(7, parentOf)).toEqual([6, 5, 1, 0]);
    expect(getAncestorIds(0, parentOf)).toEqual([]);
  });

  it('stops on cyclic parent data', () => {
    const parents = new Map<number, number>([[1, 2], [2, 1]]);
    expect(getAncestorIds(1, (id) => parents.get(id))).toEqual([2]);
  });
});

describe('expandAncestors', () => {
  it('expands every collapsed ancestor of a hidden node', () => {
    const { root, parentOf } = buildTree();
    const collapsed = new Set([1, 5, 2]);
    const next = expandAncestors(collapsed, [7], parentOf);
    expect([...next].sort()).toEqual([2]);
    // node 7 is now visible, node 3/4 stay hidden under 2
    const hidden = computeHiddenNodeIds(root, next);
    expect(hidden.has(7)).toBe(false);
    expect(hidden.has(3)).toBe(true);
  });

  it('returns the same instance when nothing changes', () => {
    const { parentOf } = buildTree();
    const collapsed = new Set([2]);
    expect(expandAncestors(collapsed, [7], parentOf)).toBe(collapsed);
    expect(expandAncestors(EMPTY_COLLAPSED, [7], parentOf)).toBe(EMPTY_COLLAPSED);
  });

  it('does not expand the node itself (its own subtree may stay collapsed)', () => {
    const { parentOf } = buildTree();
    const collapsed = new Set([5]);
    expect(expandAncestors(collapsed, [5], parentOf)).toBe(collapsed);
  });
});

describe('setNodeCollapsed / toggleNodeCollapsed', () => {
  it('adds and removes ids immutably', () => {
    const a = setNodeCollapsed(EMPTY_COLLAPSED, 2, true);
    expect(a.has(2)).toBe(true);
    expect(EMPTY_COLLAPSED.has(2)).toBe(false);
    const b = toggleNodeCollapsed(a, 2);
    expect(b.has(2)).toBe(false);
    expect(setNodeCollapsed(a, 2, true)).toBe(a);
  });
});

describe('collapseAllIds', () => {
  it('collapses every internal node except the root', () => {
    const { root } = buildTree();
    expect([...collapseAllIds(root)].sort()).toEqual([1, 2, 5, 6]);
    // Only the root and its direct child remain visible
    const hidden = computeHiddenNodeIds(root, collapseAllIds(root));
    expect(8 - hidden.size).toBe(2);
  });

  it('is empty for a single-node plan', () => {
    expect(collapseAllIds(node(0)).size).toBe(0);
    expect(collapseAllIds(null).size).toBe(0);
  });
});

describe('nearestVisibleAncestor', () => {
  it('returns the collapsed stub that stands in for a hidden node', () => {
    const { root, parentOf } = buildTree();
    const hidden = computeHiddenNodeIds(root, new Set([5]));
    expect(nearestVisibleAncestor(7, hidden, parentOf)).toBe(5);
    expect(nearestVisibleAncestor(3, hidden, parentOf)).toBe(3);
  });
});

describe('countHiddenMatches', () => {
  it('counts matching hidden descendants per visible collapsed node', () => {
    const { root } = buildTree();
    const matches = new Set([4, 7, 6]);
    const counts = countHiddenMatches(root, new Set([2, 5]), (id) => matches.has(id));
    expect(counts.get(2)).toBe(1);
    expect(counts.get(5)).toBe(2);
  });

  it('only reports the outermost collapsed node', () => {
    const { root } = buildTree();
    const counts = countHiddenMatches(root, new Set([1, 5]), (id) => id === 7);
    expect(counts.get(1)).toBe(1);
    expect(counts.has(5)).toBe(false);
  });

  it('omits collapsed nodes with no matches', () => {
    const { root } = buildTree();
    expect(countHiddenMatches(root, new Set([2]), () => false).size).toBe(0);
  });
});

describe('collapse memory', () => {
  it('remembers per plan object and resets for a different plan', () => {
    const planA = {};
    const planB = {};
    rememberCollapsed(planA, new Set([1, 2]));
    expect([...recallCollapsed(planA)]).toEqual([1, 2]);
    expect(recallCollapsed(planB)).toBe(EMPTY_COLLAPSED);
    expect(recallCollapsed(null)).toBe(EMPTY_COLLAPSED);
    rememberCollapsed(planA, EMPTY_COLLAPSED);
    expect(recallCollapsed(planA)).toBe(EMPTY_COLLAPSED);
  });
});
