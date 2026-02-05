import type { PlanNode, SankeyMetric, Theme } from './types';
import { getOperationCategory } from './types';

export interface FlameGraphNode {
  id: number;
  name: string;
  value: number;
  children: FlameGraphNode[];
  planNode: PlanNode;
  category: string;
  isFiltered: boolean;
}

// Hex colors for SVG/D3 rendering (Tailwind classes don't work in SVG)
export const CATEGORY_HEX_COLORS: Record<string, { light: string; dark: string }> = {
  'Table Access':     { light: '#fb923c', dark: '#ea580c' },
  'Index Operations': { light: '#4ade80', dark: '#22c55e' },
  'Join Operations':  { light: '#60a5fa', dark: '#3b82f6' },
  'Set Operations':   { light: '#c084fc', dark: '#a855f7' },
  'Aggregation':      { light: '#f472b6', dark: '#ec4899' },
  'Sort Operations':  { light: '#facc15', dark: '#eab308' },
  'Filter/View':      { light: '#22d3ee', dark: '#06b6d4' },
  'Partition':        { light: '#818cf8', dark: '#6366f1' },
  'Parallelism':      { light: '#fb7185', dark: '#f43f5e' },
  'Other':            { light: '#9ca3af', dark: '#6b7280' },
};

export function getCategoryHexColor(category: string, theme: Theme): string {
  const colors = CATEGORY_HEX_COLORS[category] || CATEGORY_HEX_COLORS['Other'];
  return theme === 'dark' ? colors.dark : colors.light;
}

function getNodeMetricValue(node: PlanNode, metric: SankeyMetric): number {
  switch (metric) {
    case 'rows':
      return node.rows ?? 1;
    case 'cost':
      return node.cost ?? 1;
    case 'actualRows':
      return (node.actualRows ?? node.rows ?? 1) * (node.starts ?? 1);
    case 'actualTime':
      return node.actualTime ?? 1;
    default:
      return node.rows ?? 1;
  }
}

export function transformToFlameGraph(
  rootNode: PlanNode,
  metric: SankeyMetric,
  filteredNodeIds: Set<number>
): FlameGraphNode {
  function transform(node: PlanNode): FlameGraphNode {
    const children = node.children.map(transform);

    const childrenValue = children.reduce((sum, c) => sum + c.value, 0);
    const selfValue = getNodeMetricValue(node, metric);

    // Parent value should be at least as large as children combined
    // This ensures visual containment in the flame graph
    const value = Math.max(selfValue, childrenValue);

    const objectPart = node.objectName ? ` (${node.objectName})` : '';

    return {
      id: node.id,
      name: `${node.id}: ${node.operation}${objectPart}`,
      value,
      children,
      planNode: node,
      category: getOperationCategory(node.operation),
      isFiltered: filteredNodeIds.has(node.id),
    };
  }

  return transform(rootNode);
}

export interface LayoutFrame {
  x: number;
  y: number;
  width: number;
  height: number;
  node: FlameGraphNode;
}

export interface FlameGraphLayout {
  frames: LayoutFrame[];
  totalHeight: number;
}

export function calculateFlameGraphLayout(
  flameData: FlameGraphNode,
  containerWidth: number,
  rowHeight: number = 28,
  padding: number = 1,
  margin = { top: 20, right: 20, bottom: 20, left: 20 }
): FlameGraphLayout {
  if (containerWidth < 100) {
    return { frames: [], totalHeight: 0 };
  }

  const contentWidth = containerWidth - margin.left - margin.right;
  const frames: LayoutFrame[] = [];
  let maxDepth = 0;

  function layoutNode(node: FlameGraphNode, x: number, width: number, depth: number) {
    maxDepth = Math.max(maxDepth, depth);

    frames.push({
      x: x + padding,
      y: depth * rowHeight + margin.top,
      width: Math.max(0, width - padding * 2),
      height: rowHeight - padding * 2,
      node,
    });

    let childX = x;
    const totalChildValue = node.children.reduce((sum, c) => sum + c.value, 0);

    for (const child of node.children) {
      const childWidth = totalChildValue > 0
        ? (child.value / totalChildValue) * width
        : width / node.children.length;
      layoutNode(child, childX, childWidth, depth + 1);
      childX += childWidth;
    }
  }

  layoutNode(flameData, margin.left, contentWidth, 0);

  const totalHeight = (maxDepth + 1) * rowHeight + margin.top + margin.bottom;

  return { frames, totalHeight };
}

export function truncateLabel(text: string, maxWidth: number, charWidth: number = 7): string {
  const maxChars = Math.floor((maxWidth - 8) / charWidth);
  if (maxChars <= 3) return '';
  if (text.length <= maxChars) return text;
  return text.slice(0, maxChars - 2) + '...';
}
