import { useCallback, useEffect, useMemo, useRef } from 'react';
import {
  ReactFlow,
  Background,
  Controls,
  useNodesState,
  useEdgesState,
  BackgroundVariant,
} from '@xyflow/react';
import type { Node, Edge, NodeTypes } from '@xyflow/react';
import { forceSimulation, forceLink, forceManyBody, forceCenter, forceCollide } from 'd3-force';
import type { SimulationNodeDatum, SimulationLinkDatum } from 'd3-force';
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

interface SimNode extends SimulationNodeDatum {
  id: string;
}

interface SimLink extends SimulationLinkDatum<SimNode> {
  id: string;
}

function getForceLayoutedElements(
  nodes: Node[],
  edges: Edge[],
  width: number,
  height: number
): { nodes: Node[]; edges: Edge[] } {
  if (nodes.length === 0) return { nodes, edges };

  const simNodes: SimNode[] = nodes.map((n) => ({
    id: n.id,
    x: width / 2 + (Math.random() - 0.5) * 200,
    y: height / 2 + (Math.random() - 0.5) * 200,
  }));

  const simLinks: SimLink[] = edges.map((e) => ({
    id: e.id,
    source: e.source,
    target: e.target,
  }));

  const simulation = forceSimulation(simNodes)
    .force(
      'link',
      forceLink<SimNode, SimLink>(simLinks)
        .id((d) => d.id)
        .distance(180)
        .strength(0.5)
    )
    .force('charge', forceManyBody().strength(-800))
    .force('center', forceCenter(width / 2, height / 2))
    .force('collision', forceCollide().radius(nodeWidth / 2 + 20));

  // Run simulation synchronously
  simulation.tick(300);
  simulation.stop();

  const nodeMap = new Map<string, SimNode>();
  simNodes.forEach((n) => nodeMap.set(n.id, n));

  const layoutedNodes = nodes.map((node) => {
    const simNode = nodeMap.get(node.id);
    return {
      ...node,
      position: {
        x: (simNode?.x || 0) - nodeWidth / 2,
        y: (simNode?.y || 0) - nodeHeight / 2,
      },
    };
  });

  return { nodes: layoutedNodes, edges };
}

export function ForceDirectedView() {
  const { parsedPlan, selectedNodeId, selectNode, getFilteredNodes, theme } = usePlan();
  const containerRef = useRef<HTMLDivElement>(null);

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
        },
      });

      for (const child of node.children) {
        edges.push({
          id: `e${node.id}-${child.id}`,
          source: node.id.toString(),
          target: child.id.toString(),
          animated: true,
          style: {
            stroke: filteredNodeIds.has(child.id) ? '#6366f1' : '#d1d5db',
            strokeWidth: 2,
          },
        });
        traverse(child);
      }
    }

    traverse(parsedPlan.rootNode);

    const width = containerRef.current?.clientWidth || 800;
    const height = containerRef.current?.clientHeight || 600;

    return getForceLayoutedElements(nodes, edges, width, height);
  }, [parsedPlan, selectedNodeId, filteredNodeIds]);

  const [nodes, setNodes, onNodesChange] = useNodesState(layoutData.nodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(layoutData.edges);

  useEffect(() => {
    setNodes(layoutData.nodes);
    setEdges(layoutData.edges);
  }, [layoutData, setNodes, setEdges]);

  useEffect(() => {
    setNodes((currentNodes) =>
      currentNodes.map((node) => ({
        ...node,
        data: {
          ...node.data,
          isSelected: parseInt(node.id) === selectedNodeId,
          isFiltered: filteredNodeIds.has(parseInt(node.id)),
        },
      }))
    );

    setEdges((currentEdges) =>
      currentEdges.map((edge) => ({
        ...edge,
        style: {
          ...edge.style,
          stroke: filteredNodeIds.has(parseInt(edge.target)) ? '#6366f1' : '#d1d5db',
        },
      }))
    );
  }, [selectedNodeId, filteredNodeIds, setNodes, setEdges]);

  const onNodeClick = useCallback(
    (_: React.MouseEvent, node: Node) => {
      selectNode(parseInt(node.id));
    },
    [selectNode]
  );

  const onPaneClick = useCallback(() => {
    selectNode(null);
  }, [selectNode]);

  if (!parsedPlan?.rootNode) {
    return (
      <div className="flex items-center justify-center h-full text-gray-500 dark:text-gray-400">
        No execution plan to display. Parse a plan to see the visualization.
      </div>
    );
  }

  return (
    <div ref={containerRef} className="w-full h-full" style={{ minHeight: '400px' }}>
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
        nodesDraggable={true}
      >
        <Background
          variant={BackgroundVariant.Cross}
          gap={30}
          size={2}
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
