import { useCallback, useEffect, useMemo, useRef } from 'react';
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

const nodeTypes: NodeTypes = {
  planNode: PlanNodeMemo as unknown as NodeTypes['planNode'],
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

    const nodes: Node[] = [];
    const edges: Edge[] = [];

    function traverse(node: PlanNode) {
      nodes.push({
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
        },
      });

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

    return getLayoutedElements(nodes, edges);
  }, [parsedPlan, selectedNodeId, filteredNodeIds, filters.animateEdges, filters.nodeDisplayOptions]);

  const [nodes, setNodes, onNodesChange] = useNodesState(layoutData.nodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(layoutData.edges);

  useEffect(() => {
    const updatedNodes = layoutData.nodes.map((node: Node) => ({
      ...node,
      data: {
        ...node.data,
        isSelected: parseInt(node.id) === selectedNodeId,
        isFiltered: filteredNodeIds.has(parseInt(node.id)),
        displayOptions: filters.nodeDisplayOptions,
      },
    }));
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
  }, [layoutData, selectedNodeId, filteredNodeIds, filters.animateEdges, filters.nodeDisplayOptions, setNodes, setEdges]);

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
