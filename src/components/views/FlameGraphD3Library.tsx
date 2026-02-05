import { useEffect, useRef, useState, useMemo, useCallback } from 'react';
import { select } from 'd3-selection';
import { flamegraph } from 'd3-flame-graph';
import 'd3-flame-graph/dist/d3-flamegraph.css';
import { usePlan } from '../../hooks/usePlanContext';
import {
  transformToFlameGraph,
  getCategoryHexColor,
  type FlameGraphNode,
} from '../../lib/flameGraphUtils';

export function FlameGraphD3Library() {
  const containerRef = useRef<HTMLDivElement>(null);
  const [dimensions, setDimensions] = useState({ width: 0, height: 0 });

  const {
    parsedPlan,
    selectedNodeId,
    selectNode,
    sankeyMetric,
    getFilteredNodes,
    theme,
  } = usePlan();

  const filteredNodeIds = useMemo(
    () => new Set(getFilteredNodes().map((n) => n.id)),
    [getFilteredNodes]
  );

  const flameData = useMemo(() => {
    if (!parsedPlan?.rootNode) return null;
    return transformToFlameGraph(parsedPlan.rootNode, sankeyMetric, filteredNodeIds);
  }, [parsedPlan, sankeyMetric, filteredNodeIds]);

  // ResizeObserver
  useEffect(() => {
    if (!containerRef.current) return;

    const observer = new ResizeObserver((entries) => {
      const { width, height } = entries[0].contentRect;
      setDimensions({ width, height });
    });

    observer.observe(containerRef.current);
    return () => observer.disconnect();
  }, []);

  const handleClick = useCallback(
    (d: { data: FlameGraphNode }) => {
      const nodeId = d.data.id;
      selectNode(selectedNodeId === nodeId ? null : nodeId);
    },
    [selectNode, selectedNodeId]
  );

  // Create/update flame graph
  useEffect(() => {
    if (!containerRef.current || !flameData || dimensions.width < 100) return;

    // Clear previous content
    containerRef.current.innerHTML = '';

    // Create wrapper div for the chart
    const wrapper = document.createElement('div');
    wrapper.style.width = '100%';
    containerRef.current.appendChild(wrapper);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const chart = (flamegraph() as any)
      .width(dimensions.width)
      .inverted(true) // Icicle style (root at top)
      .cellHeight(28)
      .minFrameSize(3)
      .transitionDuration(300)
      .selfValue(false)
      .setColorMapper((d: { data: FlameGraphNode }) => {
        const node = d.data;
        if (!node.isFiltered) {
          return theme === 'dark' ? '#4b5563' : '#d1d5db';
        }
        return getCategoryHexColor(node.category, theme);
      })
      .onClick(handleClick);

    // Render
    select(wrapper)
      .datum(flameData)
      .call(chart as never);

    // Apply custom styles for filtered/selected state
    const svg = wrapper.querySelector('svg');
    if (svg) {
      // Style non-filtered nodes with lower opacity
      svg.querySelectorAll('rect.d3-flame-graph-rect').forEach((rect) => {
        const g = rect.parentElement;
        if (!g) return;

        // Get the data bound to this element (stored in __data__)
        const data = (g as unknown as { __data__?: { data: FlameGraphNode } }).__data__;
        if (data && !data.data.isFiltered) {
          (rect as SVGRectElement).style.opacity = '0.4';
        }
      });

      // Highlight selected node
      if (selectedNodeId !== null) {
        svg.querySelectorAll('g').forEach((g) => {
          const data = (g as unknown as { __data__?: { data: FlameGraphNode } }).__data__;
          if (data && data.data.id === selectedNodeId) {
            const rect = g.querySelector('rect');
            if (rect) {
              rect.setAttribute('stroke', '#3b82f6');
              rect.setAttribute('stroke-width', '2');
            }
          }
        });
      }
    }
  }, [flameData, dimensions.width, theme, handleClick, selectedNodeId]);

  if (!parsedPlan?.rootNode) {
    return (
      <div className="flex items-center justify-center h-full text-gray-500 dark:text-gray-400">
        No execution plan to display.
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      className="w-full h-full overflow-auto flamegraph-d3lib-container"
      style={{
        // Override d3-flame-graph default text colors for dark mode
        ['--fg-text-color' as string]: theme === 'dark' ? '#f3f4f6' : '#1f2937',
      }}
    />
  );
}
