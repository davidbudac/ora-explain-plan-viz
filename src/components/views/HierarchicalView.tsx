import { useCallback, useEffect, useMemo, useRef, memo } from 'react';
import {
  ReactFlow,
  Background,
  Controls,
  useNodesState,
  useEdgesState,
  useReactFlow,
  ReactFlowProvider,
  BackgroundVariant,
} from '@xyflow/react';
import type { Node, Edge, NodeTypes } from '@xyflow/react';
import dagre from '@dagrejs/dagre';
import '@xyflow/react/dist/style.css';

import { usePlan } from '../../hooks/usePlanContext';
import { PlanNodeMemo } from '../nodes/PlanNode';
import { formatNumberShort, computeCardinalityRatio, cardinalityRatioSeverity } from '../../lib/format';
import type { PlanNode, NodeDisplayOptions } from '../../lib/types';
import { getHighlightColorDef } from '../../lib/annotations';

// Query block group component
interface QueryBlockGroupData extends Record<string, unknown> {
  label: string;
  width: number;
  height: number;
}

const QueryBlockGroupNode = memo(({ data }: { data: QueryBlockGroupData }) => {
  return (
    <div
      className="border-2 border-dashed border-violet-400 dark:border-violet-500 rounded-lg bg-violet-50/30 dark:bg-violet-900/10"
      style={{ width: data.width, height: data.height }}
    >
      <div className="absolute -top-3 left-3 px-2 bg-white dark:bg-gray-900 text-violet-600 dark:text-violet-400 text-xs font-mono">
        {data.label}
      </div>
    </div>
  );
});
QueryBlockGroupNode.displayName = 'QueryBlockGroupNode';

interface AnnotationGroupData extends Record<string, unknown> {
  label: string;
  width: number;
  height: number;
  borderClass: string;
  bgClass: string;
  note?: string;
}

const AnnotationGroupNode = memo(({ data }: { data: AnnotationGroupData }) => {
  return (
    <div
      className={`border-2 border-dashed rounded-lg ${data.borderClass} ${data.bgClass}`}
      style={{ width: data.width, height: data.height }}
    >
      <div className={`absolute -top-3 left-3 px-2 bg-white dark:bg-gray-900 text-xs font-medium`}>
        <span className="text-slate-700 dark:text-slate-300">{data.label}</span>
      </div>
      {data.note && (
        <div className="absolute -bottom-2.5 left-3 px-2 bg-white dark:bg-gray-900 text-[10px] text-slate-500 dark:text-slate-400 italic truncate max-w-[200px]">
          {data.note}
        </div>
      )}
    </div>
  );
});
AnnotationGroupNode.displayName = 'AnnotationGroupNode';

const nodeTypes: NodeTypes = {
  planNode: PlanNodeMemo as unknown as NodeTypes['planNode'],
  queryBlockGroup: QueryBlockGroupNode as unknown as NodeTypes['queryBlockGroup'],
  annotationGroup: AnnotationGroupNode as unknown as NodeTypes['annotationGroup'],
};

// Layout dimensions for dagre algorithm
const NODE_WIDTH = 260;
const NODE_BASE_HEIGHT = 60; // Base: operation name + ID badge + cost bar

// Calculate dynamic node height based on display options and node content
function calculateNodeHeight(
  node: PlanNode,
  displayOptions: NodeDisplayOptions,
  hasActualStats: boolean,
  hasAnnotation?: boolean,
): number {
  let height = NODE_BASE_HEIGHT;

  // Warning badges row (hotspot, spill, cardinality mismatch)
  const hasSpill = (node.tempUsed !== undefined && node.tempUsed > 0);
  const cardRatio = hasActualStats ? computeCardinalityRatio(node.rows, node.actualRows) : undefined;
  const hasCardBadge = cardinalityRatioSeverity(cardRatio) !== 'good';
  // We always add space for badges if there's a potential hot node (we don't know which is hottest at layout time)
  if (hasSpill || hasCardBadge || (hasActualStats && node.actualTime !== undefined)) {
    height += 24;
  }

  // Object name row
  if (displayOptions.showObjectName && node.objectName) {
    height += 20;
  }

  // Query block badge row
  if (displayOptions.showQueryBlockBadge && node.queryBlock) {
    height += 24;
  }

  // Estimated stats row (rows, cost, bytes)
  const hasEstimatedStats =
    (displayOptions.showRows && node.rows !== undefined) ||
    (displayOptions.showCost && node.cost !== undefined) ||
    (displayOptions.showBytes && node.bytes !== undefined);
  if (hasEstimatedStats) {
    height += 26;
  }

  // Actual stats row (A-Rows, A-Time, Starts)
  if (hasActualStats) {
    const hasActualStatsToShow =
      (displayOptions.showActualRows && node.actualRows !== undefined) ||
      (displayOptions.showActualTime && node.actualTime !== undefined) ||
      (displayOptions.showStarts && node.starts !== undefined);
    if (hasActualStatsToShow) {
      height += 26;
    }
  }

  // Predicate indicators row
  if (displayOptions.showPredicateIndicators && (node.accessPredicates || node.filterPredicates)) {
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


// Horizontal and vertical spacing between nodes
// Extra padding to ensure query block groups don't overlap
const NODE_H_SPACING = 80;
const NODE_V_SPACING = 80;

// Custom tree layout that ensures subtrees never overlap
// Each subtree gets its own horizontal region based on its total width
function getLayoutedElements(
  nodes: Node[],
  edges: Edge[],
  nodeDimensions: Map<string, { width: number; height: number }>
): { nodes: Node[]; edges: Edge[] } {
  if (nodes.length === 0) {
    return { nodes: [], edges };
  }

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
    return fallbackDagreLayout(nodes, edges, nodeDimensions);
  }

  // Calculate subtree width for each node (width needed to display all descendants)
  const subtreeWidths = new Map<string, number>();

  function calculateSubtreeWidth(nodeId: string): number {
    const dims = nodeDimensions.get(nodeId) || { width: NODE_WIDTH, height: NODE_BASE_HEIGHT };
    const children = childrenMap.get(nodeId) || [];

    if (children.length === 0) {
      // Leaf node: width is just the node width
      const width = dims.width;
      subtreeWidths.set(nodeId, width);
      return width;
    }

    // Sum of children subtree widths plus spacing between them
    let totalChildrenWidth = 0;
    for (const childId of children) {
      totalChildrenWidth += calculateSubtreeWidth(childId);
    }
    totalChildrenWidth += (children.length - 1) * NODE_H_SPACING;

    // Subtree width is max of node width and total children width
    const width = Math.max(dims.width, totalChildrenWidth);
    subtreeWidths.set(nodeId, width);
    return width;
  }

  calculateSubtreeWidth(rootId);

  // Assign depth and compute max node height per depth to avoid row overlaps
  // when dynamic node content (e.g. predicate details) expands.
  const depthByNodeId = new Map<string, number>();
  const maxHeightByDepth = new Map<number, number>();

  function assignDepth(nodeId: string, depth: number): void {
    const existingDepth = depthByNodeId.get(nodeId);
    if (existingDepth !== undefined && existingDepth <= depth) return;

    depthByNodeId.set(nodeId, depth);
    const dims = nodeDimensions.get(nodeId) || { width: NODE_WIDTH, height: NODE_BASE_HEIGHT };
    maxHeightByDepth.set(depth, Math.max(maxHeightByDepth.get(depth) || 0, dims.height));

    const children = childrenMap.get(nodeId) || [];
    for (const childId of children) {
      assignDepth(childId, depth + 1);
    }
  }

  assignDepth(rootId, 0);

  const levelYOffsets = new Map<number, number>();
  levelYOffsets.set(0, 0);
  const maxDepth = Math.max(...depthByNodeId.values(), 0);
  for (let depth = 1; depth <= maxDepth; depth++) {
    const prevY = levelYOffsets.get(depth - 1) || 0;
    const prevHeight = maxHeightByDepth.get(depth - 1) || NODE_BASE_HEIGHT;
    levelYOffsets.set(depth, prevY + prevHeight + NODE_V_SPACING);
  }

  // Position nodes: each node is centered over its subtree
  const positions = new Map<string, { x: number; y: number }>();

  function positionNode(nodeId: string, xStart: number): void {
    const dims = nodeDimensions.get(nodeId) || { width: NODE_WIDTH, height: NODE_BASE_HEIGHT };
    const subtreeWidth = subtreeWidths.get(nodeId) || dims.width;
    const children = childrenMap.get(nodeId) || [];
    const depth = depthByNodeId.get(nodeId) || 0;
    const y = levelYOffsets.get(depth) || 0;

    // Center the node within its allocated subtree width
    const nodeX = xStart + (subtreeWidth - dims.width) / 2;
    positions.set(nodeId, { x: nodeX, y });

    // Position children
    if (children.length > 0) {
      if (children.length === 1) {
        // Single child: align directly under parent (same X position)
        const childId = children[0];
        const childDims = nodeDimensions.get(childId) || { width: NODE_WIDTH, height: NODE_BASE_HEIGHT };
        // Calculate xStart such that child node ends up at same X as parent
        // childNodeX = childXStart + (childSubtreeWidth - childWidth) / 2 = nodeX
        // childXStart = nodeX - (childSubtreeWidth - childWidth) / 2
        const childSubtreeWidth = subtreeWidths.get(childId) || NODE_WIDTH;
        const childXStart = nodeX - (childSubtreeWidth - childDims.width) / 2;
        positionNode(childId, childXStart);
      } else {
        // Multiple children: center the group under the parent
        let totalChildrenWidth = 0;
        for (const childId of children) {
          totalChildrenWidth += subtreeWidths.get(childId) || NODE_WIDTH;
        }
        totalChildrenWidth += (children.length - 1) * NODE_H_SPACING;

        // Calculate parent's center position
        const parentCenterX = nodeX + dims.width / 2;

        // Start children such that their combined center aligns with parent's center
        let childX = parentCenterX - totalChildrenWidth / 2;

        for (const childId of children) {
          const childSubtreeWidth = subtreeWidths.get(childId) || NODE_WIDTH;
          positionNode(childId, childX);
          childX += childSubtreeWidth + NODE_H_SPACING;
        }
      }
    }
  }

  positionNode(rootId, 0);

  // Apply positions to nodes
  const layoutedNodes = nodes.map((node) => {
    const pos = positions.get(node.id);
    if (pos) {
      return {
        ...node,
        position: { x: pos.x, y: pos.y },
      };
    }
    return node;
  });

  return { nodes: layoutedNodes, edges };
}

// Fallback to dagre layout for non-tree graphs
function fallbackDagreLayout(
  nodes: Node[],
  edges: Edge[],
  nodeDimensions: Map<string, { width: number; height: number }>
): { nodes: Node[]; edges: Edge[] } {
  const g = new dagre.graphlib.Graph();
  g.setGraph({ rankdir: 'TB', nodesep: 120, ranksep: 120 });
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

function HierarchicalViewContent() {
  const { parsedPlan, selectedNodeId, selectedNodeIds, selectNode, theme, filters, colorScheme, nodeIndicatorMetric, filteredNodeIds, nodeById, hottestNodeId, annotations } = usePlan();
  const containerRef = useRef<HTMLDivElement>(null);
  const { fitView, setNodes: rfSetNodes } = useReactFlow();
  const selectedNodeIdSet = useMemo(() => new Set(selectedNodeIds), [selectedNodeIds]);

  // Destructure filter values for explicit dependency tracking
  const {
    operationTypes, minCost, maxCost, searchText, predicateTypes,
    minActualRows, maxActualRows, minActualTime, maxActualTime
  } = filters;

  // Create a filter key that changes when any filter value changes
  const filterKey = useMemo(() => {
    const maxCostKey = maxCost === Infinity ? 'inf' : maxCost;
    const maxActualRowsKey = maxActualRows === Infinity ? 'inf' : maxActualRows;
    const maxActualTimeKey = maxActualTime === Infinity ? 'inf' : maxActualTime;
    return [
      operationTypes.join('|'),
      minCost,
      maxCostKey,
      searchText,
      predicateTypes.join('|'),
      minActualRows,
      maxActualRowsKey,
      minActualTime,
      maxActualTimeKey,
    ].join('::');
  }, [operationTypes, minCost, maxCost, searchText, predicateTypes, minActualRows, maxActualRows, minActualTime, maxActualTime]);

  const selectionSets = useMemo(() => {
    const empty = {
      ancestorIds: new Set<number>(),
      descendantIds: new Set<number>(),
    };

    if (!parsedPlan || selectedNodeId === null || selectedNodeIds.length !== 1) return empty;

    const selected = nodeById.get(selectedNodeId);
    if (!selected) return empty;

    const ancestorIds = new Set<number>();
    let current: PlanNode | undefined = selected;
    ancestorIds.add(current.id);

    while (current?.parentId !== undefined) {
      const parent = nodeById.get(current.parentId);
      if (!parent) break;
      ancestorIds.add(parent.id);
      current = parent;
    }

    const descendantIds = new Set<number>();
    const addDescendants = (node: PlanNode) => {
      descendantIds.add(node.id);
      node.children.forEach(addDescendants);
    };
    addDescendants(selected);

    return { ancestorIds, descendantIds };
  }, [parsedPlan, selectedNodeId, selectedNodeIds.length, nodeById]);

  const layoutData = useMemo(() => {
    if (!parsedPlan?.rootNode) {
      return { nodes: [] as Node[], edges: [] as Edge[] };
    }

    const planNodes: Node[] = [];
    const edges: Edge[] = [];
    const nodeQueryBlocks: Map<string, string> = new Map();
    const nodeDimensions: Map<string, { width: number; height: number }> = new Map();
    const nodeGroupDimensions: Map<string, { width: number; height: number }> = new Map();

    function traverse(node: PlanNode) {
      const hasActualStats = parsedPlan!.hasActualStats || false;
      const hasAnnotation = annotations.nodeAnnotations.has(node.id);
      // Calculate dynamic height for this node
      const height = calculateNodeHeight(node, filters.nodeDisplayOptions, hasActualStats, hasAnnotation);
      nodeDimensions.set(node.id.toString(), { width: NODE_WIDTH, height });

      // Keep query block envelopes stable across predicate-detail toggles by
      // sizing groups against the expanded node-height baseline.
      const groupHeight = calculateNodeHeight(
        node,
        { ...filters.nodeDisplayOptions, showPredicateDetails: true },
        hasActualStats,
        hasAnnotation
      );
      nodeGroupDimensions.set(node.id.toString(), { width: NODE_WIDTH, height: groupHeight });

      planNodes.push({
        id: node.id.toString(),
        type: 'planNode',
        position: { x: 0, y: 0 },
        data: {
          label: node.operation,
          node,
          totalCost: parsedPlan!.totalCost,
          isSelected: false, // Updated by useEffect when selectedNodeId changes
          isFiltered: false,
          displayOptions: filters.nodeDisplayOptions,
          hasActualStats: parsedPlan!.hasActualStats,
          width: NODE_WIDTH,
          height,
        },
      });

      if (node.queryBlock) {
        nodeQueryBlocks.set(node.id.toString(), node.queryBlock);
      }

      for (const child of node.children) {
        // Calculate row flow for edge thickness
        let rowFlow: number;
        if (parsedPlan!.hasActualStats && child.actualRows !== undefined) {
          // Row flow = parent starts * child actual rows
          const parentStarts = node.starts || 1;
          rowFlow = parentStarts * child.actualRows;
        } else {
          // Fall back to estimated rows
          rowFlow = child.rows || 1;
        }

        edges.push({
          id: `e${node.id}-${child.id}`,
          source: node.id.toString(),
          target: child.id.toString(),
          animated: false,
          data: { rowFlow },
          style: {
            stroke: '#d1d5db',
            strokeWidth: 2,
          },
        });
        traverse(child);
      }
    }

    traverse(parsedPlan.rootNode);

    // Calculate min and max row flow for edge thickness normalization
    const rowFlows = edges.map(e => (e.data as { rowFlow: number })?.rowFlow || 1);
    const minRowFlow = Math.min(...rowFlows);
    const maxRowFlow = Math.max(...rowFlows);
    const rowFlowRange = maxRowFlow - minRowFlow;

    // Apply layout to plan nodes with dynamic dimensions
    const layoutedResult = getLayoutedElements(planNodes, edges, nodeDimensions);

    // Edge thickness range
    const MIN_STROKE_WIDTH = 2;
    const MAX_STROKE_WIDTH = 16;

    // Update edge stroke widths based on row flow and add labels
    const edgesWithThickness = layoutedResult.edges.map(edge => {
      const rowFlow = (edge.data as { rowFlow: number })?.rowFlow || 1;
      // Linear scale between min and max stroke width
      const normalizedFlow = rowFlowRange > 0 ? (rowFlow - minRowFlow) / rowFlowRange : 0.5;
      const strokeWidth = MIN_STROKE_WIDTH + normalizedFlow * (MAX_STROKE_WIDTH - MIN_STROKE_WIDTH);
      // Format row flow in human-readable format (e.g., 1.2M, 3.5K)
      const formattedRowFlow = formatNumberShort(rowFlow) ?? rowFlow.toString();
      return {
        ...edge,
        label: formattedRowFlow,
        labelStyle: { fill: '#6b7280', fontSize: 10, fontWeight: 500 },
        labelBgStyle: { fill: 'white', fillOpacity: 0.9 },
        labelBgPadding: [4, 2] as [number, number],
        labelBgBorderRadius: 4,
        style: {
          ...edge.style,
          strokeWidth,
        },
      };
    });

    // Create query block groups if enabled
    const groupNodes: Node[] = [];
    if (filters.nodeDisplayOptions.showQueryBlockGrouping && nodeQueryBlocks.size > 0) {
      // Group nodes by query block
      const queryBlockGroups = new Map<string, Node[]>();
      for (const node of layoutedResult.nodes) {
        const qb = nodeQueryBlocks.get(node.id);
        if (qb) {
          if (!queryBlockGroups.has(qb)) {
            queryBlockGroups.set(qb, []);
          }
          queryBlockGroups.get(qb)!.push(node);
        }
      }

      // Create group nodes with bounding boxes
      const padding = 20;
      // Keep query block groups visually stable even when node content is compact
      // (e.g. predicate details disabled) and nodes still have rings/shadows/scale.
      const visualBuffer = 14;
      queryBlockGroups.forEach((groupedNodes, queryBlock) => {
        if (groupedNodes.length === 0) return;

        // Calculate bounding box using actual node dimensions
        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
        for (const node of groupedNodes) {
          const dims = nodeGroupDimensions.get(node.id) || nodeDimensions.get(node.id) || { width: NODE_WIDTH, height: NODE_BASE_HEIGHT };
          minX = Math.min(minX, node.position.x - visualBuffer);
          minY = Math.min(minY, node.position.y - visualBuffer);
          maxX = Math.max(maxX, node.position.x + dims.width + visualBuffer);
          maxY = Math.max(maxY, node.position.y + dims.height + visualBuffer);
        }

        groupNodes.push({
          id: `group-${queryBlock}`,
          type: 'queryBlockGroup',
          position: { x: minX - padding, y: minY - padding },
          data: {
            label: queryBlock,
            width: maxX - minX + padding * 2,
            height: maxY - minY + padding * 2,
          },
          selectable: false,
          draggable: false,
          zIndex: -1,
        });
      });
    }

    // Annotation group overlay nodes
    const annotationGroupNodes: Node[] = [];
    if (annotations.groups.length > 0) {
      const padding = 20;
      const visualBuffer = 14;

      for (const group of annotations.groups) {
        // Find positioned plan nodes that belong to this group
        const memberNodes = group.nodeIds
          .map((id) => layoutedResult.nodes.find((n) => n.id === id.toString()))
          .filter((n): n is Node => Boolean(n));

        if (memberNodes.length === 0) continue;

        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
        for (const node of memberNodes) {
          const dims = nodeGroupDimensions.get(node.id) || nodeDimensions.get(node.id) || { width: NODE_WIDTH, height: NODE_BASE_HEIGHT };
          minX = Math.min(minX, node.position.x - visualBuffer);
          minY = Math.min(minY, node.position.y - visualBuffer);
          maxX = Math.max(maxX, node.position.x + dims.width + visualBuffer);
          maxY = Math.max(maxY, node.position.y + dims.height + visualBuffer);
        }

        const colorDef = getHighlightColorDef(group.color);
        annotationGroupNodes.push({
          id: `anngroup-${group.id}`,
          type: 'annotationGroup',
          position: { x: minX - padding, y: minY - padding },
          data: {
            label: group.name,
            width: maxX - minX + padding * 2,
            height: maxY - minY + padding * 2,
            borderClass: colorDef.groupBorder,
            bgClass: colorDef.groupBg,
            note: group.note,
          },
          selectable: false,
          draggable: false,
          zIndex: -1,
        });
      }
    }

    // Group nodes should be rendered first (behind plan nodes)
    return {
      nodes: [...groupNodes, ...annotationGroupNodes, ...layoutedResult.nodes],
      edges: edgesWithThickness,
    };
  }, [parsedPlan, filters.nodeDisplayOptions, annotations.groups, annotations.nodeAnnotations]);

  const [nodes, setNodes, onNodesChange] = useNodesState(layoutData.nodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(layoutData.edges);

  // Sync nodes with layout when layout changes
  useEffect(() => {
    setNodes(layoutData.nodes);
    setEdges(layoutData.edges);
  }, [layoutData, setNodes, setEdges]);

  // Re-fit viewport when layout changes (e.g. enabling predicate details expands nodes).
  useEffect(() => {
    const timer = setTimeout(() => {
      fitView({ padding: 0.2 });
    }, 50);
    return () => clearTimeout(timer);
  }, [layoutData, fitView]);

  // Update node data properties separately (selection, filtering, display options)
  // Use rfSetNodes from useReactFlow to ensure React Flow detects the change
  useEffect(() => {
    rfSetNodes((currentNodes) =>
      currentNodes.map((node) => {
        if (node.type === 'queryBlockGroup' || node.type === 'annotationGroup') {
          return node;
        }
        const focusEnabled = filters.focusSelection && selectedNodeId !== null && selectedNodeIds.length === 1;

        return {
          ...node,
          data: {
            ...node.data,
            isSelected: selectedNodeIdSet.has(parseInt(node.id)),
            isFiltered: filteredNodeIds.has(parseInt(node.id)),
            isInFocusPath:
              focusEnabled &&
              (selectionSets.ancestorIds.has(parseInt(node.id)) ||
                selectionSets.descendantIds.has(parseInt(node.id))),
            isFocusDimmed:
              focusEnabled &&
              !selectionSets.ancestorIds.has(parseInt(node.id)) &&
              !selectionSets.descendantIds.has(parseInt(node.id)),
            displayOptions: filters.nodeDisplayOptions,
            hasActualStats: parsedPlan?.hasActualStats,
            colorScheme,
            nodeIndicatorMetric,
            maxActualRows: parsedPlan?.maxActualRows,
            maxStarts: parsedPlan?.maxStarts,
            totalElapsedTime: parsedPlan?.totalElapsedTime,
            searchText,
            filterKey, // Include filterKey to force React Flow to detect changes
            isHotNode: hottestNodeId !== null && parseInt(node.id) === hottestNodeId,
            annotationText: annotations.nodeAnnotations.get(parseInt(node.id))?.text,
            highlightColor: annotations.nodeHighlights.get(parseInt(node.id))?.color,
          },
        };
      })
    );
  }, [
    selectedNodeId,
    selectedNodeIds.length,
    selectedNodeIdSet,
    filteredNodeIds,
    filters.nodeDisplayOptions,
    filters.focusSelection,
    parsedPlan?.hasActualStats,
    colorScheme,
    nodeIndicatorMetric,
    parsedPlan?.maxActualRows,
    parsedPlan?.maxStarts,
    parsedPlan?.totalElapsedTime,
    rfSetNodes,
    filterKey,
    selectionSets.ancestorIds,
    selectionSets.descendantIds,
    searchText,
    hottestNodeId,
    annotations.nodeAnnotations,
    annotations.nodeHighlights,
  ]);

  // Update edge styles separately - only create new objects when values change
  useEffect(() => {
    setEdges((currentEdges) =>
      currentEdges.map((edge) => {
        const activeEdgeStroke = theme === 'dark' ? '#4f46e5' : '#6366f1';
        const newStroke = filteredNodeIds.has(parseInt(edge.target)) ? activeEdgeStroke : '#d1d5db';
        const currentStroke = edge.style?.stroke;
        const currentAnimated = edge.animated;
        const currentStrokeWidth = edge.style?.strokeWidth;
        const currentStrokeOpacity = edge.style?.strokeOpacity;
        const currentLabelStyle = edge.labelStyle as { fill?: string; fontSize?: number; fontWeight?: number } | undefined;
        const currentLabelBgStyle = edge.labelBgStyle as { fill?: string; fillOpacity?: number } | undefined;
        const focusEnabled = filters.focusSelection && selectedNodeId !== null && selectedNodeIds.length === 1;

        const sourceId = parseInt(edge.source);
        const targetId = parseInt(edge.target);
        const isAncestorEdge = focusEnabled && selectionSets.ancestorIds.has(sourceId) && selectionSets.ancestorIds.has(targetId);
        const isDescendantEdge = focusEnabled && selectionSets.descendantIds.has(sourceId) && selectionSets.descendantIds.has(targetId);

        let stroke = newStroke;
        let strokeOpacity: number | undefined = undefined;
        const baseWidthRaw = edge.style?.strokeWidth ?? 2;
        const baseWidth = typeof baseWidthRaw === 'number' ? baseWidthRaw : parseFloat(baseWidthRaw.toString()) || 2;
        let strokeWidth = baseWidth;

        if (focusEnabled) {
          if (isAncestorEdge) {
            stroke = '#2563eb';
            strokeWidth = Math.max(baseWidth, 4);
            strokeOpacity = 0.95;
          } else if (isDescendantEdge) {
            stroke = activeEdgeStroke;
            strokeWidth = Math.max(baseWidth, 3);
            strokeOpacity = 0.7;
          } else {
            stroke = theme === 'dark' ? '#374151' : '#e5e7eb';
            strokeOpacity = 0.15;
          }
        }

        const labelFill = theme === 'dark' ? '#9ca3af' : '#6b7280';
        const labelBgFill = theme === 'dark' ? '#1f2937' : 'white';
        const labelStyle = { fill: labelFill, fontSize: 10, fontWeight: 500 };
        const labelBgStyle = { fill: labelBgFill, fillOpacity: 0.9 };

        // Only create new edge object if something changed
        if (
          currentStroke === stroke &&
          currentAnimated === filters.animateEdges &&
          currentStrokeWidth === strokeWidth &&
          currentStrokeOpacity === strokeOpacity &&
          currentLabelStyle?.fill === labelStyle.fill &&
          currentLabelStyle?.fontSize === labelStyle.fontSize &&
          currentLabelStyle?.fontWeight === labelStyle.fontWeight &&
          currentLabelBgStyle?.fill === labelBgStyle.fill &&
          currentLabelBgStyle?.fillOpacity === labelBgStyle.fillOpacity
        ) {
          return edge;
        }

        return {
          ...edge,
          animated: filters.animateEdges,
          labelStyle,
          labelBgStyle,
          style: {
            ...edge.style,
            stroke,
            strokeWidth,
            strokeOpacity,
          },
        };
      })
    );
  }, [filteredNodeIds, filters.animateEdges, filters.focusSelection, selectedNodeId, selectedNodeIds.length, selectionSets.ancestorIds, selectionSets.descendantIds, theme, setEdges]);

  const onNodeClick = useCallback(
    (event: React.MouseEvent, node: Node) => {
      // Ignore clicks on group overlay nodes — treat as pane click (deselect)
      if (node.type === 'queryBlockGroup' || node.type === 'annotationGroup') {
        selectNode(null);
        return;
      }
      const additive = event.metaKey || event.ctrlKey;
      selectNode(parseInt(node.id), { additive });
    },
    [selectNode]
  );

  const onPaneClick = useCallback(() => {
    selectNode(null);
  }, [selectNode]);

  // Keyboard navigation: arrow keys to move between nodes
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!parsedPlan || selectedNodeId === null) {
        // Escape clears selection regardless
        if (e.key === 'Escape') {
          selectNode(null);
        }
        return;
      }

      const node = nodeById.get(selectedNodeId);
      if (!node) return;

      let targetId: number | null = null;

      switch (e.key) {
        case 'Escape':
          selectNode(null);
          return;
        case 'ArrowUp': {
          // Go to parent
          if (node.parentId !== undefined) {
            targetId = node.parentId;
          }
          break;
        }
        case 'ArrowDown': {
          // Go to first child
          if (node.children.length > 0) {
            targetId = node.children[0].id;
          }
          break;
        }
        case 'ArrowLeft':
        case 'ArrowRight': {
          // Go to sibling
          if (node.parentId !== undefined) {
            const parent = nodeById.get(node.parentId);
            if (parent) {
              const siblings = parent.children;
              const idx = siblings.findIndex(s => s.id === node.id);
              if (idx >= 0) {
                const delta = e.key === 'ArrowLeft' ? -1 : 1;
                const newIdx = idx + delta;
                if (newIdx >= 0 && newIdx < siblings.length) {
                  targetId = siblings[newIdx].id;
                }
              }
            }
          }
          break;
        }
        default:
          return;
      }

      if (targetId !== null) {
        e.preventDefault();
        selectNode(targetId);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [parsedPlan, selectedNodeId, nodeById, selectNode]);

  // Handle container resize
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const resizeObserver = new ResizeObserver(() => {
      // Small delay to let the layout settle
      setTimeout(() => fitView({ padding: 0.2 }), 50);
    });

    resizeObserver.observe(container);
    return () => resizeObserver.disconnect();
  }, [fitView]);

  if (!parsedPlan?.rootNode) {
    return (
      <div className="flex items-center justify-center h-full text-gray-500 dark:text-gray-400">
        No execution plan to display. Parse a plan to see the visualization.
      </div>
    );
  }

  return (
    <div ref={containerRef} className="w-full h-full">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onNodeClick={onNodeClick}
        onPaneClick={onPaneClick}
        nodeTypes={nodeTypes}
        fitView
        fitViewOptions={{ padding: 0.2 }}
        minZoom={0.1}
        maxZoom={2}
        onlyRenderVisibleElements
      >
        <Background
          variant={BackgroundVariant.Dots}
          gap={20}
          size={1}
          color={theme === 'dark' ? '#374151' : '#e5e7eb'}
        />
        <Controls className="!bg-white dark:!bg-gray-800 !border-gray-200 dark:!border-gray-700" />
      </ReactFlow>
    </div>
  );
}

export function HierarchicalView() {
  const { parsedPlan } = usePlan();

  // Create a unique key that changes when the plan changes to force complete remount
  // This ensures useNodesState/useEdgesState hooks are reset with fresh state
  const planKey = parsedPlan
    ? `${parsedPlan.planHashValue ?? 'nohash'}-${parsedPlan.allNodes.length}-${parsedPlan.rootNode?.operation ?? ''}`
    : 'no-plan';

  return (
    <ReactFlowProvider key={planKey}>
      <HierarchicalViewContent />
    </ReactFlowProvider>
  );
}
