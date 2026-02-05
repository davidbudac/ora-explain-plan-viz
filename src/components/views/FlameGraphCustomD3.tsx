import { useEffect, useRef, useState, useMemo } from 'react';
import { usePlan } from '../../hooks/usePlanContext';
import {
  transformToFlameGraph,
  calculateFlameGraphLayout,
  getCategoryHexColor,
  truncateLabel,
} from '../../lib/flameGraphUtils';

export function FlameGraphCustomD3() {
  const svgRef = useRef<SVGSVGElement>(null);
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

  // D3-style DOM manipulation for rendering
  useEffect(() => {
    if (!svgRef.current || layout.frames.length === 0) return;

    const svg = svgRef.current;
    const ns = 'http://www.w3.org/2000/svg';

    // Clear previous content
    while (svg.firstChild) {
      svg.removeChild(svg.firstChild);
    }

    svg.setAttribute('width', String(dimensions.width));
    svg.setAttribute('height', String(layout.totalHeight || dimensions.height));

    const g = document.createElementNS(ns, 'g');
    svg.appendChild(g);

    // Background click handler
    const background = document.createElementNS(ns, 'rect');
    background.setAttribute('width', String(dimensions.width));
    background.setAttribute('height', String(layout.totalHeight || dimensions.height));
    background.setAttribute('fill', 'transparent');
    background.style.cursor = 'default';
    background.addEventListener('click', () => selectNode(null));
    g.appendChild(background);

    const textColor = theme === 'dark' ? '#f3f4f6' : '#1f2937';

    // Render frames
    for (const frame of layout.frames) {
      if (frame.width < 1) continue;

      const { x, y, width, height, node } = frame;
      const isSelected = selectedNodeId === node.id;

      const fill = node.isFiltered
        ? getCategoryHexColor(node.category, theme)
        : (theme === 'dark' ? '#4b5563' : '#d1d5db');

      // Rectangle
      const rect = document.createElementNS(ns, 'rect');
      rect.setAttribute('x', String(x));
      rect.setAttribute('y', String(y));
      rect.setAttribute('width', String(width));
      rect.setAttribute('height', String(height));
      rect.setAttribute('rx', '3');
      rect.setAttribute('fill', fill);
      rect.setAttribute('opacity', node.isFiltered ? '1' : '0.4');
      rect.style.cursor = 'pointer';

      if (isSelected) {
        rect.setAttribute('stroke', '#3b82f6');
        rect.setAttribute('stroke-width', '2');
      }

      rect.addEventListener('click', (e) => {
        e.stopPropagation();
        selectNode(selectedNodeId === node.id ? null : node.id);
      });

      // Tooltip
      const title = document.createElementNS(ns, 'title');
      title.textContent = node.name;
      rect.appendChild(title);

      g.appendChild(rect);

      // Text label
      const label = truncateLabel(node.name, width);
      if (label) {
        const text = document.createElementNS(ns, 'text');
        text.setAttribute('x', String(x + 4));
        text.setAttribute('y', String(y + height / 2));
        text.setAttribute('dy', '0.35em');
        text.setAttribute('font-size', '11');
        text.setAttribute('fill', textColor);
        text.style.pointerEvents = 'none';
        text.textContent = label;
        g.appendChild(text);
      }
    }
  }, [layout, dimensions, selectedNodeId, theme, selectNode]);

  if (!parsedPlan?.rootNode) {
    return (
      <div className="flex items-center justify-center h-full text-gray-500 dark:text-gray-400">
        No execution plan to display.
      </div>
    );
  }

  return (
    <div ref={containerRef} className="w-full h-full overflow-auto">
      <svg ref={svgRef} />
    </div>
  );
}
