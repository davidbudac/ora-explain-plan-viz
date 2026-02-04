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
import { CollapsibleMiniMap } from '../CollapsibleMiniMap';
import { formatNumber } from '../../lib/types';
import type { PlanNode, NodeDisplayOptions, PredicateType } from '../../lib/types';

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

const nodeTypes: NodeTypes = {
  planNode: PlanNodeMemo as unknown as NodeTypes['planNode'],
  queryBlockGroup: QueryBlockGroupNode as unknown as NodeTypes['queryBlockGroup'],
};

// Layout dimensions for dagre algorithm
const NODE_WIDTH = 260;
const NODE_BASE_HEIGHT = 60; // Base: operation name + ID badge + cost bar

// Calculate dynamic node height based on display options and node content
function calculateNodeHeight(
  node: PlanNode,
  displayOptions: NodeDisplayOptions,
  hasActualStats: boolean
): number {
  let height = NODE_BASE_HEIGHT;

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

  return height;
}


function getLayoutedElements(
  nodes: Node[],
  edges: Edge[],
  nodeDimensions: Map<string, { width: number; height: number }>,
  direction: 'TB' | 'LR' = 'TB'
): { nodes: Node[]; edges: Edge[] } {
  const g = new dagre.graphlib.Graph();
  g.setGraph({ rankdir: direction, nodesep: 60, ranksep: 100 });
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
  const { parsedPlan, selectedNodeId, selectNode, theme, filters } = usePlan();
  const containerRef = useRef<HTMLDivElement>(null);
  const { fitView } = useReactFlow();

  // Destructure filter values for explicit dependency tracking
  const {
    operationTypes, minCost, maxCost, searchText, predicateTypes,
    minActualRows, maxActualRows, minActualTime, maxActualTime
  } = filters;

  // Compute filtered node IDs with explicit primitive dependencies
  const filteredNodeIds = useMemo(() => {
    if (!parsedPlan) return new Set<number>();

    const filtered = parsedPlan.allNodes.filter((node) => {
      // Filter by operation type
      if (operationTypes.length > 0) {
        const matches = operationTypes.some((type) =>
          node.operation.toUpperCase().includes(type.toUpperCase())
        );
        if (!matches) return false;
      }

      // Filter by cost
      const nodeCost = node.cost || 0;
      if (nodeCost < minCost || nodeCost > maxCost) return false;

      // Filter by actual rows (SQL Monitor)
      if (parsedPlan.hasActualStats && node.actualRows !== undefined) {
        if (node.actualRows < minActualRows || node.actualRows > maxActualRows) return false;
      }

      // Filter by actual time (SQL Monitor)
      if (parsedPlan.hasActualStats && node.actualTime !== undefined) {
        if (node.actualTime < minActualTime || node.actualTime > maxActualTime) return false;
      }

      // Filter by predicate type
      if (predicateTypes.length > 0) {
        const hasAccess = !!node.accessPredicates;
        const hasFilter = !!node.filterPredicates;
        const hasNone = !hasAccess && !hasFilter;

        const matchesPredicate = predicateTypes.some((type: PredicateType) => {
          if (type === 'access') return hasAccess;
          if (type === 'filter') return hasFilter;
          if (type === 'none') return hasNone;
          return false;
        });
        if (!matchesPredicate) return false;
      }

      // Filter by search text
      if (searchText) {
        const searchLower = searchText.toLowerCase();
        const matchesOperation = node.operation.toLowerCase().includes(searchLower);
        const matchesObject = node.objectName?.toLowerCase().includes(searchLower);
        const matchesPredicates =
          node.accessPredicates?.toLowerCase().includes(searchLower) ||
          node.filterPredicates?.toLowerCase().includes(searchLower);
        if (!matchesOperation && !matchesObject && !matchesPredicates) {
          return false;
        }
      }

      return true;
    });

    return new Set(filtered.map((n) => n.id));
  }, [parsedPlan, operationTypes, minCost, maxCost, searchText, predicateTypes, minActualRows, maxActualRows, minActualTime, maxActualTime]);

  const layoutData = useMemo(() => {
    if (!parsedPlan?.rootNode) {
      return { nodes: [] as Node[], edges: [] as Edge[] };
    }

    const planNodes: Node[] = [];
    const edges: Edge[] = [];
    const nodeQueryBlocks: Map<string, string> = new Map();
    const nodeDimensions: Map<string, { width: number; height: number }> = new Map();

    function traverse(node: PlanNode) {
      // Calculate dynamic height for this node
      const height = calculateNodeHeight(node, filters.nodeDisplayOptions, parsedPlan!.hasActualStats || false);
      nodeDimensions.set(node.id.toString(), { width: NODE_WIDTH, height });

      planNodes.push({
        id: node.id.toString(),
        type: 'planNode',
        position: { x: 0, y: 0 },
        data: {
          label: node.operation,
          node,
          totalCost: parsedPlan!.totalCost,
          isSelected: false, // Updated by useEffect when selectedNodeId changes
          isFiltered: filteredNodeIds.has(node.id),
          displayOptions: filters.nodeDisplayOptions,
          hasActualStats: parsedPlan!.hasActualStats,
        },
      });

      if (node.queryBlock) {
        nodeQueryBlocks.set(node.id.toString(), node.queryBlock);
      }

      for (const child of node.children) {
        // Calculate row flow for edge thickness
        let rowFlow: number;
        if (parsedPlan!.hasActualStats && child.actualRows !== undefined) {
          // Use actual rows * starts for SQL Monitor plans
          const starts = child.starts || 1;
          rowFlow = child.actualRows * starts;
        } else {
          // Fall back to estimated rows
          rowFlow = child.rows || 1;
        }

        edges.push({
          id: `e${node.id}-${child.id}`,
          source: node.id.toString(),
          target: child.id.toString(),
          animated: filters.animateEdges,
          data: { rowFlow },
          style: {
            stroke: filteredNodeIds.has(child.id) ? '#6366f1' : '#d1d5db',
            strokeWidth: 2,
          },
        });
        traverse(child);
      }
    }

    traverse(parsedPlan.rootNode);

    // Calculate max row flow for edge thickness normalization
    const maxRowFlow = Math.max(...edges.map(e => (e.data as { rowFlow: number })?.rowFlow || 1), 1);

    // Apply layout to plan nodes with dynamic dimensions
    const layoutedResult = getLayoutedElements(planNodes, edges, nodeDimensions);

    // Update edge stroke widths based on row flow and add labels
    const edgesWithThickness = layoutedResult.edges.map(edge => {
      const rowFlow = (edge.data as { rowFlow: number })?.rowFlow || 1;
      // Scale stroke width: min 1px, max 12px, logarithmic scale for better visualization
      const normalizedFlow = Math.log(rowFlow + 1) / Math.log(maxRowFlow + 1);
      const strokeWidth = Math.max(1, Math.min(12, 1 + normalizedFlow * 11));
      // Format row flow in human-readable format (e.g., 1.2M, 3.5K)
      const formattedRowFlow = formatNumber(rowFlow);
      const isDark = theme === 'dark';
      return {
        ...edge,
        label: formattedRowFlow,
        labelStyle: { fill: isDark ? '#9ca3af' : '#6b7280', fontSize: 10, fontWeight: 500 },
        labelBgStyle: { fill: isDark ? '#1f2937' : 'white', fillOpacity: 0.9 },
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
      queryBlockGroups.forEach((groupedNodes, queryBlock) => {
        if (groupedNodes.length === 0) return;

        // Calculate bounding box using actual node dimensions
        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
        for (const node of groupedNodes) {
          const dims = nodeDimensions.get(node.id) || { width: NODE_WIDTH, height: NODE_BASE_HEIGHT };
          minX = Math.min(minX, node.position.x);
          minY = Math.min(minY, node.position.y);
          maxX = Math.max(maxX, node.position.x + dims.width);
          maxY = Math.max(maxY, node.position.y + dims.height);
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

    // Group nodes should be rendered first (behind plan nodes)
    return {
      nodes: [...groupNodes, ...layoutedResult.nodes],
      edges: edgesWithThickness,
    };
  }, [parsedPlan, filteredNodeIds, filters.animateEdges, filters.nodeDisplayOptions, theme]);

  const [nodes, setNodes, onNodesChange] = useNodesState(layoutData.nodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(layoutData.edges);

  // Sync nodes with layout when layout changes
  useEffect(() => {
    setNodes(layoutData.nodes);
    setEdges(layoutData.edges);
  }, [layoutData, setNodes, setEdges]);

  // Update node data properties separately (selection, filtering, display options)
  useEffect(() => {
    setNodes((currentNodes) =>
      currentNodes.map((node) => {
        if (node.type === 'queryBlockGroup') {
          return node;
        }
        return {
          ...node,
          data: {
            ...node.data,
            isSelected: parseInt(node.id) === selectedNodeId,
            isFiltered: filteredNodeIds.has(parseInt(node.id)),
            displayOptions: filters.nodeDisplayOptions,
            hasActualStats: parsedPlan?.hasActualStats,
          },
        };
      })
    );
  }, [selectedNodeId, filteredNodeIds, filters.nodeDisplayOptions, parsedPlan?.hasActualStats, setNodes]);

  // Update edge styles separately
  useEffect(() => {
    setEdges((currentEdges) =>
      currentEdges.map((edge) => ({
        ...edge,
        animated: filters.animateEdges,
        style: {
          ...edge.style,
          stroke: filteredNodeIds.has(parseInt(edge.target)) ? '#6366f1' : '#d1d5db',
        },
      }))
    );
  }, [filteredNodeIds, filters.animateEdges, setEdges]);

  const onNodeClick = useCallback(
    (_: React.MouseEvent, node: Node) => {
      selectNode(parseInt(node.id));
    },
    [selectNode]
  );

  const onPaneClick = useCallback(() => {
    selectNode(null);
  }, [selectNode]);

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
      >
        <Background
          variant={BackgroundVariant.Dots}
          gap={20}
          size={1}
          color={theme === 'dark' ? '#374151' : '#e5e7eb'}
        />
        <Controls className="!bg-white dark:!bg-gray-800 !border-gray-200 dark:!border-gray-700" />
        <CollapsibleMiniMap
          nodeColor={(node) => {
            const isFiltered = filteredNodeIds.has(parseInt(node.id));
            return isFiltered ? '#6366f1' : '#d1d5db';
          }}
          maskColor={theme === 'dark' ? 'rgba(0, 0, 0, 0.7)' : 'rgba(255, 255, 255, 0.7)'}
          className="!bg-gray-100 dark:!bg-gray-800 !border-gray-200 dark:!border-gray-700"
        />
      </ReactFlow>
    </div>
  );
}

export function HierarchicalView() {
  return (
    <ReactFlowProvider>
      <HierarchicalViewContent />
    </ReactFlowProvider>
  );
}
