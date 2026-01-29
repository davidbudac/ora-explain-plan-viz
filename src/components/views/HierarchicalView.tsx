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
import type { PlanNode } from '../../lib/types';

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

const nodeWidth = 240;
const nodeHeight = 120;

function getLayoutedElements(
  nodes: Node[],
  edges: Edge[],
  direction: 'TB' | 'LR' = 'TB'
): { nodes: Node[]; edges: Edge[] } {
  const g = new dagre.graphlib.Graph();
  g.setGraph({ rankdir: direction, nodesep: 50, ranksep: 80 });
  g.setDefaultEdgeLabel(() => ({}));

  nodes.forEach((node) => {
    g.setNode(node.id, { width: nodeWidth, height: nodeHeight });
  });

  edges.forEach((edge) => {
    g.setEdge(edge.source, edge.target);
  });

  dagre.layout(g);

  const layoutedNodes = nodes.map((node) => {
    const nodeWithPosition = g.node(node.id);
    return {
      ...node,
      position: {
        x: nodeWithPosition.x - nodeWidth / 2,
        y: nodeWithPosition.y - nodeHeight / 2,
      },
    };
  });

  return { nodes: layoutedNodes, edges };
}

function HierarchicalViewContent() {
  const { parsedPlan, selectedNodeId, selectNode, getFilteredNodes, theme, filters } = usePlan();
  const containerRef = useRef<HTMLDivElement>(null);
  const { fitView } = useReactFlow();

  const filteredNodeIds = useMemo(() => {
    return new Set(getFilteredNodes().map((n) => n.id));
  }, [getFilteredNodes]);

  const layoutData = useMemo(() => {
    if (!parsedPlan?.rootNode) {
      return { nodes: [] as Node[], edges: [] as Edge[] };
    }

    const planNodes: Node[] = [];
    const edges: Edge[] = [];
    const nodeQueryBlocks: Map<string, string> = new Map();

    function traverse(node: PlanNode) {
      planNodes.push({
        id: node.id.toString(),
        type: 'planNode',
        position: { x: 0, y: 0 },
        data: {
          label: node.operation,
          node,
          totalCost: parsedPlan!.totalCost,
          isSelected: node.id === selectedNodeId,
          isFiltered: filteredNodeIds.has(node.id),
          displayOptions: filters.nodeDisplayOptions,
          hasActualStats: parsedPlan!.hasActualStats,
        },
      });

      if (node.queryBlock) {
        nodeQueryBlocks.set(node.id.toString(), node.queryBlock);
      }

      for (const child of node.children) {
        edges.push({
          id: `e${node.id}-${child.id}`,
          source: node.id.toString(),
          target: child.id.toString(),
          animated: filters.animateEdges,
          style: {
            stroke: filteredNodeIds.has(child.id) ? '#6366f1' : '#d1d5db',
            strokeWidth: 2,
          },
        });
        traverse(child);
      }
    }

    traverse(parsedPlan.rootNode);

    // Apply layout to plan nodes
    const layoutedResult = getLayoutedElements(planNodes, edges);

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

        // Calculate bounding box
        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
        for (const node of groupedNodes) {
          minX = Math.min(minX, node.position.x);
          minY = Math.min(minY, node.position.y);
          maxX = Math.max(maxX, node.position.x + nodeWidth);
          maxY = Math.max(maxY, node.position.y + nodeHeight);
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
      edges: layoutedResult.edges,
    };
  }, [parsedPlan, selectedNodeId, filteredNodeIds, filters.animateEdges, filters.nodeDisplayOptions]);

  const [nodes, setNodes, onNodesChange] = useNodesState(layoutData.nodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(layoutData.edges);

  useEffect(() => {
    const updatedNodes = layoutData.nodes.map((node: Node) => {
      // Group nodes don't need the same data updates
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
    });
    setNodes(updatedNodes);

    const updatedEdges = layoutData.edges.map((edge: Edge) => ({
      ...edge,
      animated: filters.animateEdges,
      style: {
        ...edge.style,
        stroke: filteredNodeIds.has(parseInt(edge.target)) ? '#6366f1' : '#d1d5db',
      },
    }));
    setEdges(updatedEdges);
  }, [layoutData, selectedNodeId, filteredNodeIds, filters.animateEdges, filters.nodeDisplayOptions, parsedPlan?.hasActualStats, setNodes, setEdges]);

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
