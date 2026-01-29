import { useEffect, useRef, useMemo, useCallback, useState } from 'react';
import { sankey, sankeyLinkHorizontal } from 'd3-sankey';
import type { SankeyNode, SankeyLink } from 'd3-sankey';
import { usePlan } from '../../hooks/usePlanContext';
import { getOperationCategory } from '../../lib/types';
import type { PlanNode } from '../../lib/types';

interface SankeyNodeExtra {
  name: string;
  planNode: PlanNode;
  category: string;
}

interface SankeyLinkExtra {
  value: number;
}

type SNode = SankeyNode<SankeyNodeExtra, SankeyLinkExtra>;
type SLink = SankeyLink<SankeyNodeExtra, SankeyLinkExtra>;

const categoryColors: Record<string, string> = {
  'Table Access': '#f97316',
  'Index Operations': '#22c55e',
  'Join Operations': '#3b82f6',
  'Set Operations': '#a855f7',
  'Aggregation': '#ec4899',
  'Sort Operations': '#eab308',
  'Filter/View': '#06b6d4',
  'Partition': '#6366f1',
  'Other': '#6b7280',
};

export function SankeyView() {
  const svgRef = useRef<SVGSVGElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [dimensions, setDimensions] = useState({ width: 0, height: 0 });
  const [error, setError] = useState<string | null>(null);
  const { parsedPlan, selectedNodeId, selectNode, sankeyMetric, getFilteredNodes, theme } = usePlan();

  // Update dimensions on mount and resize
  useEffect(() => {
    const updateDimensions = () => {
      if (containerRef.current) {
        const { clientWidth, clientHeight } = containerRef.current;
        setDimensions({ width: clientWidth, height: clientHeight });
      }
    };

    updateDimensions();
    window.addEventListener('resize', updateDimensions);

    // Also update after a short delay to catch any layout shifts
    const timer = setTimeout(updateDimensions, 100);

    return () => {
      window.removeEventListener('resize', updateDimensions);
      clearTimeout(timer);
    };
  }, []);

  const filteredNodeIds = useMemo(() => {
    return new Set(getFilteredNodes().map((n) => n.id));
  }, [getFilteredNodes]);

  const sankeyData = useMemo(() => {
    if (!parsedPlan?.rootNode) {
      return null;
    }

    const nodes: SankeyNodeExtra[] = [];
    const links: { source: string; target: string; value: number }[] = [];

    function traverse(node: PlanNode) {
      nodes.push({
        name: `${node.id}: ${node.operation}${node.objectName ? ` (${node.objectName})` : ''}`,
        planNode: node,
        category: getOperationCategory(node.operation),
      });

      for (const child of node.children) {
        traverse(child);
      }
    }

    traverse(parsedPlan.rootNode);

    // Create links from parent to children using string IDs
    function createLinks(node: PlanNode) {
      for (const child of node.children) {
        let value: number;
        switch (sankeyMetric) {
          case 'rows':
            value = Math.max(child.rows || 1, 1);
            break;
          case 'cost':
            value = Math.max(child.cost || 1, 1);
            break;
          case 'actualRows':
            // A-Rows multiplied by Starts for total data volume
            const actualRows = child.actualRows || child.rows || 1;
            const starts = child.starts || 1;
            value = Math.max(actualRows * starts, 1);
            break;
          case 'actualTime':
            value = Math.max(child.actualTime || 1, 1);
            break;
          default:
            value = Math.max(child.rows || 1, 1);
        }

        links.push({
          source: node.id.toString(),
          target: child.id.toString(),
          value,
        });

        createLinks(child);
      }
    }

    createLinks(parsedPlan.rootNode);

    return { nodes, links };
  }, [parsedPlan, sankeyMetric]);

  const handleNodeClick = useCallback(
    (nodeId: number) => {
      selectNode(selectedNodeId === nodeId ? null : nodeId);
    },
    [selectNode, selectedNodeId]
  );

  useEffect(() => {
    if (!svgRef.current || !sankeyData) return;

    const { width, height } = dimensions;
    if (width < 100 || height < 100) return; // Don't render if too small

    setError(null);

    try {
      const margin = { top: 20, right: 20, bottom: 20, left: 20 };

      const svg = svgRef.current;
      svg.innerHTML = '';
      svg.setAttribute('width', width.toString());
      svg.setAttribute('height', height.toString());

      // Check if we have valid links
      if (sankeyData.links.length === 0) {
        // No links - just show nodes vertically
        const g = document.createElementNS('http://www.w3.org/2000/svg', 'g');
        svg.appendChild(g);

        const nodeHeight = Math.min(40, (height - 40) / sankeyData.nodes.length);
        sankeyData.nodes.forEach((node, i) => {
          const y = margin.top + i * (nodeHeight + 10);
          const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
          rect.setAttribute('x', margin.left.toString());
          rect.setAttribute('y', y.toString());
          rect.setAttribute('width', '20');
          rect.setAttribute('height', nodeHeight.toString());
          rect.setAttribute('fill', categoryColors[node.category] || '#6b7280');
          rect.setAttribute('rx', '3');
          g.appendChild(rect);

          const text = document.createElementNS('http://www.w3.org/2000/svg', 'text');
          text.setAttribute('x', (margin.left + 30).toString());
          text.setAttribute('y', (y + nodeHeight / 2).toString());
          text.setAttribute('dy', '0.35em');
          text.setAttribute('font-size', '12');
          text.setAttribute('fill', theme === 'dark' ? '#e5e7eb' : '#374151');
          text.textContent = node.name;
          g.appendChild(text);
        });
        return;
      }

      const sankeyGenerator = sankey<SankeyNodeExtra, SankeyLinkExtra>()
        .nodeId((d) => d.planNode.id.toString())
        .nodeWidth(20)
        .nodePadding(15)
        .extent([
          [margin.left, margin.top],
          [width - margin.right, height - margin.bottom],
        ]);

      const { nodes, links } = sankeyGenerator({
        nodes: sankeyData.nodes.map((d) => ({ ...d })),
        links: sankeyData.links.map((d) => ({ ...d })),
      });

      const isDark = theme === 'dark';

      const g = document.createElementNS('http://www.w3.org/2000/svg', 'g');
      svg.appendChild(g);

      // Draw links
      const linkGroup = document.createElementNS('http://www.w3.org/2000/svg', 'g');
      linkGroup.setAttribute('fill', 'none');
      g.appendChild(linkGroup);

      const linkPath = sankeyLinkHorizontal<SNode, SLink>();

      links.forEach((link) => {
        const sourceNode = link.source as SNode;
        const targetNode = link.target as SNode;
        const isFiltered = filteredNodeIds.has(sourceNode.planNode.id) && filteredNodeIds.has(targetNode.planNode.id);

        const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        const d = linkPath(link as SLink);
        if (d) {
          path.setAttribute('d', d);
          path.setAttribute('stroke', isFiltered ? (categoryColors[sourceNode.category] || '#6b7280') : (isDark ? '#4b5563' : '#d1d5db'));
          path.setAttribute('stroke-opacity', isFiltered ? '0.5' : '0.2');
          path.setAttribute('stroke-width', Math.max(1, link.width || 1).toString());
          linkGroup.appendChild(path);
        }
      });

      // Draw nodes
      const nodeGroup = document.createElementNS('http://www.w3.org/2000/svg', 'g');
      g.appendChild(nodeGroup);

      nodes.forEach((node) => {
        const sNode = node as SNode;
        const isFiltered = filteredNodeIds.has(sNode.planNode.id);
        const isSelected = selectedNodeId === sNode.planNode.id;

        const nodeWidth = (node.x1 || 0) - (node.x0 || 0);
        const nodeHeight = (node.y1 || 0) - (node.y0 || 0);

        if (nodeWidth <= 0 || nodeHeight <= 0) return;

        const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
        rect.setAttribute('x', (node.x0 || 0).toString());
        rect.setAttribute('y', (node.y0 || 0).toString());
        rect.setAttribute('width', nodeWidth.toString());
        rect.setAttribute('height', Math.max(1, nodeHeight).toString());
        rect.setAttribute('fill', isFiltered ? (categoryColors[sNode.category] || '#6b7280') : (isDark ? '#4b5563' : '#9ca3af'));
        rect.setAttribute('opacity', isFiltered ? '1' : '0.4');
        rect.setAttribute('rx', '3');
        rect.style.cursor = 'pointer';

        if (isSelected) {
          rect.setAttribute('stroke', '#3b82f6');
          rect.setAttribute('stroke-width', '3');
        }

        rect.addEventListener('click', () => {
          handleNodeClick(sNode.planNode.id);
        });

        nodeGroup.appendChild(rect);

        // Add label
        if (nodeHeight > 15) {
          const text = document.createElementNS('http://www.w3.org/2000/svg', 'text');
          const isLeft = (node.x0 || 0) < width / 2;
          text.setAttribute('x', (isLeft ? (node.x1 || 0) + 6 : (node.x0 || 0) - 6).toString());
          text.setAttribute('y', ((node.y0 || 0) + nodeHeight / 2).toString());
          text.setAttribute('dy', '0.35em');
          text.setAttribute('text-anchor', isLeft ? 'start' : 'end');
          text.setAttribute('font-size', '11');
          text.setAttribute('font-family', 'system-ui, sans-serif');
          text.setAttribute('fill', isDark ? '#e5e7eb' : '#374151');
          text.setAttribute('opacity', isFiltered ? '1' : '0.5');
          text.textContent = truncateText(sNode.name, 35);
          text.style.pointerEvents = 'none';

          nodeGroup.appendChild(text);
        }
      });
    } catch (err) {
      console.error('Sankey rendering error:', err);
      setError(err instanceof Error ? err.message : 'Failed to render Sankey diagram');
    }
  }, [sankeyData, selectedNodeId, filteredNodeIds, handleNodeClick, theme, dimensions]);

  if (!parsedPlan?.rootNode) {
    return (
      <div className="flex items-center justify-center h-full text-gray-500 dark:text-gray-400">
        No execution plan to display. Parse a plan to see the visualization.
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-center justify-center h-full text-red-500">
        Error: {error}
      </div>
    );
  }

  return (
    <div ref={containerRef} className="w-full h-full overflow-hidden" style={{ minHeight: '400px' }}>
      <svg ref={svgRef} className="w-full h-full" />
    </div>
  );
}

function truncateText(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text;
  return text.slice(0, maxLength - 3) + '...';
}
