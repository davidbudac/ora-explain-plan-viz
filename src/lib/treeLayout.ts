import dagre from '@dagrejs/dagre';
import type { Node, Edge } from '@xyflow/react';
import { matchDensityPreset } from './density';
import { cardinalityRatioSeverity, formatPartitionRange, nodeCardinalityRatio } from './format';
import type { NodeDisplayOptions, PlanNode } from './types';
import type { TreeLayoutDirection } from './settings';

// Pure tree-layout maths for the Tree view (kept out of the component so it can be unit-tested and benchmarked).

// Layout dimensions for dagre algorithm
export const NODE_WIDTH = 260;
export const COMPACT_NODE_WIDTH = 200; // Minimal density card (mirrors PlanNode)
export const NODE_BASE_HEIGHT = 60; // Base: operation name + ID badge + cost bar

// Calculate dynamic node height based on display options and node content
export function calculateNodeHeight(
  node: PlanNode,
  displayOptions: NodeDisplayOptions,
  hasActualStats: boolean,
  hasAnnotation?: boolean,
  usesGrid?: boolean,
  isRail?: boolean,
  isTicker?: boolean,
  hasAdvisorBadge?: boolean,
): number {
  // Minimal density: operation name + optional object row + one metric line
  if (displayOptions.compactStats) {
    let compactHeight = NODE_BASE_HEIGHT;
    if (displayOptions.showObjectName && node.objectName) compactHeight += 20;
    compactHeight += 18; // single mono metric line (+ warning dot)
    if (hasAnnotation) compactHeight += 20;
    return compactHeight;
  }

  if (matchDensityPreset(displayOptions) === 'compact') {
    // Match the compact card's two metric lines instead of budgeting a full
    // Est/Act table. Keep room for wrapped operation names and signal badges.
    return 84 + (node.operation.length > 28 ? 18 : 0)
      + (node.objectName ? 24 : 0)
      + (hasAdvisorBadge || (hasActualStats && node.actualTime !== undefined) || (node.tempUsed ?? 0) > 0 ? 24 : 0)
      + (isRail ? 28 : 0) + (hasAnnotation ? 24 : 0);
  }

  let height = NODE_BASE_HEIGHT;

  // Warning badges row (hotspot, spill, cardinality mismatch, advisor)
  const hasSpill = (node.tempUsed !== undefined && node.tempUsed > 0);
  const cardRatio = hasActualStats ? nodeCardinalityRatio(node) : undefined;
  const hasCardBadge = cardinalityRatioSeverity(cardRatio) !== 'good' && !usesGrid;
  // We always add space for badges if there's a potential hot node (we don't know which is hottest at layout time)
  // Rail mode moves these badges into the footer rail, so no badge row.
  if (!isRail && (hasSpill || hasCardBadge || hasAdvisorBadge || (hasActualStats && node.actualTime !== undefined))) {
    height += 24;
  }

  // Object name row (ticker scheme renders it inline in the operation name — no extra row)
  if (!isTicker && displayOptions.showObjectName && node.objectName) {
    height += 20;
  }

  // Query block badge row (rail mode moves it into the footer rail)
  if (!isRail && displayOptions.showQueryBlockBadge && node.queryBlock) {
    height += 24;
  }

  // Est ⇄ Act / Icon Rail comparison grid: one row per metric + header row when actuals exist
  if (usesGrid) {
    let rowCount = 0;
    if ((displayOptions.showRows && node.rows !== undefined) || (displayOptions.showActualRows && node.actualRows !== undefined)) rowCount++;
    if (displayOptions.showActualTime && node.actualTime !== undefined) rowCount++;
    if (displayOptions.showCost && node.cost !== undefined) rowCount++;
    if (displayOptions.showBytes && node.bytes !== undefined) rowCount++;
    if (displayOptions.showStarts && node.starts !== undefined) rowCount++;
    if (rowCount > 0) {
      height += rowCount * 19 + (hasActualStats ? 17 : 0) + 8;
    }
  }

  // Ticker mode: compact monospace lines — rows / runtime / cost, one line each
  if (isTicker) {
    let lineCount = 0;
    if ((displayOptions.showRows && node.rows !== undefined) || (displayOptions.showActualRows && node.actualRows !== undefined)) lineCount++;
    if (hasActualStats && ((displayOptions.showActualTime && node.actualTime !== undefined) || (displayOptions.showStarts && node.starts !== undefined))) lineCount++;
    if ((displayOptions.showCost && node.cost !== undefined) || (displayOptions.showBytes && node.bytes !== undefined)) lineCount++;
    if (lineCount > 0) {
      height += lineCount * 15 + 6;
    }
  }

  // Estimated stats (rows, cost, bytes)
  if (!usesGrid && !isTicker) {
    const hasEstimatedStats =
      (displayOptions.showRows && node.rows !== undefined) ||
      (displayOptions.showCost && node.cost !== undefined) ||
      (displayOptions.showBytes && node.bytes !== undefined);
    if (hasEstimatedStats) {
      height += 26;
    }
  }

  // Actual stats (A-Rows, A-Time, Starts)
  if (hasActualStats && !usesGrid && !isTicker) {
    const hasActualStatsToShow =
      (displayOptions.showActualRows && node.actualRows !== undefined) ||
      (displayOptions.showActualTime && node.actualTime !== undefined) ||
      (displayOptions.showStarts && node.starts !== undefined);
    if (hasActualStatsToShow) {
      height += 26;
    }
  }

  // Predicate indicators row (rail mode renders them in the footer rail)
  if (!isRail && displayOptions.showPredicateIndicators && (node.accessPredicates || node.filterPredicates)) {
    height += 28;
  }

  // Partition pruning indicator row (rail mode renders it in the footer rail)
  if (!isRail && displayOptions.showPartitionInfo && formatPartitionRange(node.pstart, node.pstop)) {
    height += 28;
  }

  // Footer rail row (badges + query block chips)
  if (isRail) {
    height += 28;
  }

  // Predicate details (can be multiple lines)
  if (displayOptions.showPredicateDetails && (node.accessPredicates || node.filterPredicates)) {
    if (node.accessPredicates) {
      height += 24 + Math.min(60, Math.ceil(node.accessPredicates.length / 35) * 16);
    }
    if (node.filterPredicates) {
      height += 24 + Math.min(60, Math.ceil(node.filterPredicates.length / 35) * 16);
    }
  }

  // Annotation preview text (always shown when present)
  if (hasAnnotation) {
    height += 20;
  }

  return height;
}

// Spacing between nodes. "Breadth" runs across siblings (horizontal in the
// top-down layout, vertical in left-to-right); "depth" runs from a parent to
// its children. Extra padding keeps query block groups from overlapping.
export const NODE_H_SPACING = 80;
export const NODE_V_SPACING = 80;
/** Compact density packs levels tighter in the top-down layout. */
export const COMPACT_TB_DEPTH_SPACING = 32;
/** Left-to-right: sibling subtrees stack vertically, levels need room for edge labels. */
export const LR_BREADTH_SPACING = 28;
export const LR_DEPTH_SPACING = 72;

export interface NodeBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface LayoutOptions {
  direction: TreeLayoutDirection;
  /** Gap between consecutive levels (parent → child). */
  depthSpacing: number;
  /** Gap between sibling subtrees. */
  breadthSpacing: number;
}

// Custom tree layout that ensures subtrees never overlap: each subtree gets
// its own band along the breadth axis sized to its total breadth, and every
// level is offset by the tallest (TB) / widest (LR) node of the previous one.
export function getLayoutedElements(
  nodes: Node[],
  edges: Edge[],
  nodeDimensions: Map<string, { width: number; height: number }>,
  { direction, depthSpacing, breadthSpacing }: LayoutOptions,
): { nodes: Node[]; edges: Edge[] } {
  if (nodes.length === 0) {
    return { nodes: [], edges };
  }

  const isHorizontal = direction === 'LR';
  const dimsOf = (id: string) => nodeDimensions.get(id) || { width: NODE_WIDTH, height: NODE_BASE_HEIGHT };
  const breadthOf = (id: string) => (isHorizontal ? dimsOf(id).height : dimsOf(id).width);
  const depthExtentOf = (id: string) => (isHorizontal ? dimsOf(id).width : dimsOf(id).height);

  // Build adjacency map: parent -> children
  const childrenMap = new Map<string, string[]>();
  const parentMap = new Map<string, string>();

  for (const edge of edges) {
    if (!childrenMap.has(edge.source)) {
      childrenMap.set(edge.source, []);
    }
    childrenMap.get(edge.source)!.push(edge.target);
    parentMap.set(edge.target, edge.source);
  }

  // Find root node (node with no parent)
  const rootId = nodes.find(n => !parentMap.has(n.id))?.id;
  if (!rootId) {
    // Fallback to dagre if we can't find root
    return fallbackDagreLayout(nodes, edges, nodeDimensions, direction);
  }

  // Breadth each subtree needs to display all of its descendants
  const subtreeBreadths = new Map<string, number>();

  function calculateSubtreeBreadth(nodeId: string): number {
    const own = breadthOf(nodeId);
    const children = childrenMap.get(nodeId) || [];

    if (children.length === 0) {
      subtreeBreadths.set(nodeId, own);
      return own;
    }

    let totalChildrenBreadth = 0;
    for (const childId of children) {
      totalChildrenBreadth += calculateSubtreeBreadth(childId);
    }
    totalChildrenBreadth += (children.length - 1) * breadthSpacing;

    const breadth = Math.max(own, totalChildrenBreadth);
    subtreeBreadths.set(nodeId, breadth);
    return breadth;
  }

  calculateSubtreeBreadth(rootId);

  // Assign depth and compute the largest depth-axis extent per level to avoid
  // overlaps when dynamic node content (e.g. predicate details) expands.
  const depthByNodeId = new Map<string, number>();
  const maxExtentByDepth = new Map<number, number>();

  function assignDepth(nodeId: string, depth: number): void {
    const existingDepth = depthByNodeId.get(nodeId);
    if (existingDepth !== undefined && existingDepth <= depth) return;

    depthByNodeId.set(nodeId, depth);
    maxExtentByDepth.set(depth, Math.max(maxExtentByDepth.get(depth) || 0, depthExtentOf(nodeId)));

    const children = childrenMap.get(nodeId) || [];
    for (const childId of children) {
      assignDepth(childId, depth + 1);
    }
  }

  assignDepth(rootId, 0);

  const levelOffsets = new Map<number, number>();
  levelOffsets.set(0, 0);
  const maxDepth = Math.max(...depthByNodeId.values(), 0);
  for (let depth = 1; depth <= maxDepth; depth++) {
    const prevOffset = levelOffsets.get(depth - 1) || 0;
    const prevExtent = maxExtentByDepth.get(depth - 1) || (isHorizontal ? NODE_WIDTH : NODE_BASE_HEIGHT);
    levelOffsets.set(depth, prevOffset + prevExtent + depthSpacing);
  }

  // Position nodes: each node is centred within its subtree's band
  const positions = new Map<string, { x: number; y: number }>();

  function positionNode(nodeId: string, bandStart: number): void {
    const own = breadthOf(nodeId);
    const subtreeBreadth = subtreeBreadths.get(nodeId) || own;
    const children = childrenMap.get(nodeId) || [];
    const depthOffset = levelOffsets.get(depthByNodeId.get(nodeId) || 0) || 0;

    const nodeStart = bandStart + (subtreeBreadth - own) / 2;
    positions.set(nodeId, isHorizontal ? { x: depthOffset, y: nodeStart } : { x: nodeStart, y: depthOffset });

    if (children.length === 0) return;

    if (children.length === 1) {
      // Single child: centre it on the parent (a straight edge). For equal
      // widths in the top-down layout this is the same column as the parent.
      const childId = children[0];
      const childOwn = breadthOf(childId);
      const childSubtreeBreadth = subtreeBreadths.get(childId) || childOwn;
      const childStart = nodeStart + (own - childOwn) / 2;
      positionNode(childId, childStart - (childSubtreeBreadth - childOwn) / 2);
      return;
    }

    // Multiple children: centre the group on the parent
    let totalChildrenBreadth = 0;
    for (const childId of children) {
      totalChildrenBreadth += subtreeBreadths.get(childId) || breadthOf(childId);
    }
    totalChildrenBreadth += (children.length - 1) * breadthSpacing;

    let childBand = nodeStart + own / 2 - totalChildrenBreadth / 2;
    for (const childId of children) {
      positionNode(childId, childBand);
      childBand += (subtreeBreadths.get(childId) || breadthOf(childId)) + breadthSpacing;
    }
  }

  positionNode(rootId, 0);

  const layoutedNodes = nodes.map((node) => {
    const pos = positions.get(node.id);
    return pos ? { ...node, position: { x: pos.x, y: pos.y } } : node;
  });

  return { nodes: layoutedNodes, edges };
}

// Fallback to dagre layout for non-tree graphs
function fallbackDagreLayout(
  nodes: Node[],
  edges: Edge[],
  nodeDimensions: Map<string, { width: number; height: number }>,
  direction: TreeLayoutDirection,
): { nodes: Node[]; edges: Edge[] } {
  const g = new dagre.graphlib.Graph();
  g.setGraph({ rankdir: direction, nodesep: direction === 'LR' ? 60 : 120, ranksep: 120 });
  g.setDefaultEdgeLabel(() => ({}));

  nodes.forEach((node) => {
    const dims = nodeDimensions.get(node.id) || { width: NODE_WIDTH, height: NODE_BASE_HEIGHT };
    g.setNode(node.id, { width: dims.width, height: dims.height });
  });

  edges.forEach((edge) => {
    g.setEdge(edge.source, edge.target);
  });

  dagre.layout(g);

  const layoutedNodes = nodes.map((node) => {
    const nodeWithPosition = g.node(node.id);
    const dims = nodeDimensions.get(node.id) || { width: NODE_WIDTH, height: NODE_BASE_HEIGHT };
    return {
      ...node,
      position: {
        x: nodeWithPosition.x - dims.width / 2,
        y: nodeWithPosition.y - dims.height / 2,
      },
    };
  });

  return { nodes: layoutedNodes, edges };
}
