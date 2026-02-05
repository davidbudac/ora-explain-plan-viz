import { useMemo, useRef, useEffect, useState, useCallback } from 'react';
import { usePlan } from '../../hooks/usePlanContext';
import {
  transformToFlameGraph,
  calculateFlameGraphLayout,
  getCategoryHexColor,
  truncateLabel,
  type LayoutFrame,
} from '../../lib/flameGraphUtils';
import type { Theme } from '../../lib/types';

interface FrameProps {
  frame: LayoutFrame;
  isSelected: boolean;
  theme: Theme;
  onClick: () => void;
}

function Frame({ frame, isSelected, theme, onClick }: FrameProps) {
  const { x, y, width, height, node } = frame;

  if (width < 1) return null;

  const fill = node.isFiltered
    ? getCategoryHexColor(node.category, theme)
    : (theme === 'dark' ? '#4b5563' : '#d1d5db');

  const label = truncateLabel(node.name, width);
  const textColor = theme === 'dark' ? '#f3f4f6' : '#1f2937';

  return (
    <g>
      <rect
        x={x}
        y={y}
        width={width}
        height={height}
        rx={3}
        fill={fill}
        opacity={node.isFiltered ? 1 : 0.4}
        stroke={isSelected ? '#3b82f6' : 'transparent'}
        strokeWidth={isSelected ? 2 : 0}
        style={{ cursor: 'pointer' }}
        onClick={onClick}
      >
        <title>{node.name}</title>
      </rect>
      {label && (
        <text
          x={x + 4}
          y={y + height / 2}
          dy="0.35em"
          fontSize={11}
          fill={textColor}
          style={{ pointerEvents: 'none' }}
        >
          {label}
        </text>
      )}
    </g>
  );
}

export function FlameGraphReact() {
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

  const layout = useMemo(() => {
    if (!flameData) return { frames: [], totalHeight: 0 };
    return calculateFlameGraphLayout(flameData, dimensions.width);
  }, [flameData, dimensions.width]);

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

  const handleFrameClick = useCallback(
    (nodeId: number) => {
      selectNode(selectedNodeId === nodeId ? null : nodeId);
    },
    [selectNode, selectedNodeId]
  );

  const handleBackgroundClick = useCallback(() => {
    selectNode(null);
  }, [selectNode]);

  if (!parsedPlan?.rootNode) {
    return (
      <div className="flex items-center justify-center h-full text-gray-500 dark:text-gray-400">
        No execution plan to display.
      </div>
    );
  }

  return (
    <div ref={containerRef} className="w-full h-full overflow-auto">
      <svg
        width={dimensions.width}
        height={layout.totalHeight || dimensions.height}
        onClick={handleBackgroundClick}
      >
        {layout.frames.map((frame) => (
          <Frame
            key={frame.node.id}
            frame={frame}
            isSelected={selectedNodeId === frame.node.id}
            theme={theme}
            onClick={() => handleFrameClick(frame.node.id)}
          />
        ))}
      </svg>
    </div>
  );
}
