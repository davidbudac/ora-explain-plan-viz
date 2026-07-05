import { useEffect, useMemo, useRef, useCallback, useState } from 'react';
import { usePlan } from '../../hooks/usePlanContext';
import { COLOR_SCHEME_PALETTES, getOperationCategory } from '../../lib/types';
import type { PlanNode } from '../../lib/types';
import { computeFlameLayout, getEffectiveFlameMetric } from '../../lib/flameLayout';
import type { FlameRect } from '../../lib/flameLayout';
import { formatNumberShort, formatTimeCompact } from '../../lib/format';
import { matchesSearch } from '../../lib/filtering';

const ROW_HEIGHT = 24;

/** Finds a node by id anywhere in the plan tree. */
function findNodeById(root: PlanNode, id: number): PlanNode | null {
  if (root.id === id) return root;
  for (const child of root.children) {
    const found = findNodeById(child, id);
    if (found) return found;
  }
  return null;
}

/** Builds the ancestor chain from the plan root down to (but not including) `node`. */
function getAncestorChain(root: PlanNode, node: PlanNode): PlanNode[] {
  const chain: PlanNode[] = [];

  function visit(current: PlanNode, path: PlanNode[]): boolean {
    if (current.id === node.id) {
      chain.push(...path);
      return true;
    }
    for (const child of current.children) {
      if (visit(child, [...path, current])) return true;
    }
    return false;
  }

  visit(root, []);
  return chain;
}

function truncateText(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;
  return text.slice(0, Math.max(0, maxChars - 3)) + '...';
}

interface Tooltip {
  x: number;
  y: number;
  title: string;
  lines: string[];
}

export function FlameView() {
  const containerRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  const [zoomNodeId, setZoomNodeId] = useState<number | null>(null);
  const [tooltip, setTooltip] = useState<Tooltip | null>(null);
  const tooltipStateRef = useRef<Tooltip | null>(null);
  const rafRef = useRef<number | null>(null);
  const pendingTooltipRef = useRef<Tooltip | null>(null);

  const {
    parsedPlan,
    selectedNodeIds,
    selectNode,
    filteredNodeIds,
    theme,
    colorScheme,
    filters,
    flameMetric,
  } = usePlan();

  const selectedNodeIdSet = useMemo(() => new Set(selectedNodeIds), [selectedNodeIds]);
  const searchText = filters.searchText;
  const isDark = theme === 'dark';

  useEffect(() => {
    tooltipStateRef.current = tooltip;
  }, [tooltip]);

  const scheduleTooltipUpdate = useCallback((next: Tooltip | null) => {
    pendingTooltipRef.current = next;
    if (rafRef.current !== null) return;
    rafRef.current = requestAnimationFrame(() => {
      rafRef.current = null;
      setTooltip(pendingTooltipRef.current);
    });
  }, []);

  useEffect(() => {
    return () => {
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current);
      }
    };
  }, []);

  // Escape deselects — same behavior as the other views
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      const tag = (event.target as HTMLElement)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      if ((event.target as HTMLElement)?.isContentEditable) return;
      if (selectedNodeIds.length === 0) return;
      event.preventDefault();
      selectNode(null);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [selectedNodeIds.length, selectNode]);

  // Update width on mount and resize
  useEffect(() => {
    const updateWidth = () => {
      if (containerRef.current) {
        setWidth(containerRef.current.clientWidth);
      }
    };

    updateWidth();
    window.addEventListener('resize', updateWidth);
    const timer = setTimeout(updateWidth, 100);

    return () => {
      window.removeEventListener('resize', updateWidth);
      clearTimeout(timer);
    };
  }, []);

  // Reset zoom if the zoomed node no longer exists (e.g. new plan loaded)
  useEffect(() => {
    if (zoomNodeId === null) return;
    if (!parsedPlan?.rootNode) {
      setZoomNodeId(null);
      return;
    }
    if (!findNodeById(parsedPlan.rootNode, zoomNodeId)) {
      setZoomNodeId(null);
    }
  }, [parsedPlan, zoomNodeId]);

  const effectiveMetric = useMemo(
    () => getEffectiveFlameMetric(flameMetric, parsedPlan?.hasActualStats ?? false),
    [flameMetric, parsedPlan?.hasActualStats]
  );

  const zoomRoot = useMemo(() => {
    if (!parsedPlan?.rootNode) return null;
    if (zoomNodeId === null) return parsedPlan.rootNode;
    return findNodeById(parsedPlan.rootNode, zoomNodeId) ?? parsedPlan.rootNode;
  }, [parsedPlan, zoomNodeId]);

  const ancestorChain = useMemo(() => {
    if (!parsedPlan?.rootNode || !zoomRoot || zoomRoot.id === parsedPlan.rootNode.id) return [];
    return getAncestorChain(parsedPlan.rootNode, zoomRoot);
  }, [parsedPlan, zoomRoot]);

  const rects = useMemo((): FlameRect[] => {
    if (!zoomRoot || width < 50) return [];
    return computeFlameLayout(zoomRoot, effectiveMetric, { width });
  }, [zoomRoot, effectiveMetric, width]);

  const rootValue = rects.length > 0 ? rects[0].value : 0;

  const maxDepth = useMemo(() => {
    return rects.reduce((max, r) => Math.max(max, r.depth), 0);
  }, [rects]);

  const ancestorRowCount = ancestorChain.length;
  const svgHeight = (ancestorRowCount + maxDepth + 1) * ROW_HEIGHT;

  const handleRectClick = useCallback(
    (node: PlanNode, event: React.MouseEvent) => {
      const additive = event.metaKey || event.ctrlKey;
      selectNode(node.id, { additive });
    },
    [selectNode]
  );

  const handleRectDoubleClick = useCallback((node: PlanNode) => {
    setZoomNodeId(node.id);
  }, []);

  const buildTooltipLines = useCallback(
    (rect: FlameRect): { title: string; lines: string[] } => {
      const node = rect.node;
      const title = node.objectName ? `${node.operation} (${node.objectName})` : node.operation;
      const lines: string[] = [];
      const pct = rootValue > 0 ? ((rect.value / rootValue) * 100).toFixed(1) : '0.0';

      if (effectiveMetric === 'actualTime') {
        lines.push(`A-Time: ${formatTimeCompact(rect.value) ?? '—'}`);
        lines.push(`Self: ${formatTimeCompact(rect.selfValue) ?? '—'}`);
      } else if (effectiveMetric === 'cost') {
        lines.push(`Cost: ${formatNumberShort(rect.value, { empty: '—' })}`);
        lines.push(`Self: ${formatNumberShort(rect.selfValue, { empty: '—' })}`);
      } else {
        lines.push(`Rows: ${formatNumberShort(rect.value, { empty: '—' })}`);
        lines.push(`Self: ${formatNumberShort(rect.selfValue, { empty: '—' })}`);
      }
      lines.push(`% of total: ${pct}%`);

      return { title, lines };
    },
    [effectiveMetric, rootValue]
  );

  if (!parsedPlan?.rootNode) {
    return (
      <div className="flex items-center justify-center h-full text-gray-500 dark:text-gray-400">
        No execution plan to display. Parse a plan to see the visualization.
      </div>
    );
  }

  return (
    <div className="relative w-full h-full" style={{ minHeight: '400px' }}>
      <div ref={containerRef} className="absolute inset-0 overflow-y-auto overflow-x-hidden">
        <svg width={width} height={svgHeight} className="block">
          {/* Ancestor chain (when zoomed in) — full-width muted bars above row 0 */}
          {ancestorChain.map((ancestor, i) => {
            const y = i * ROW_HEIGHT;
            const isTopmost = i === 0;
            return (
              <g
                key={`ancestor-${ancestor.id}`}
                className="cursor-pointer"
                onClick={() => setZoomNodeId(isTopmost ? null : ancestor.id)}
              >
                <rect
                  x={0}
                  y={y}
                  width={width}
                  height={ROW_HEIGHT}
                  fill={isDark ? '#334155' : '#cbd5e1'}
                  stroke={isDark ? '#0f172a' : '#ffffff'}
                  strokeWidth={1}
                  opacity={0.7}
                />
                {width > 40 && (
                  <text
                    x={6}
                    y={y + ROW_HEIGHT / 2}
                    dy="0.35em"
                    fontSize={11}
                    fill={isDark ? '#e2e8f0' : '#334155'}
                    style={{ pointerEvents: 'none' }}
                  >
                    {truncateText(
                      `${ancestor.operation}${ancestor.objectName ? ` ${ancestor.objectName}` : ''}`,
                      Math.floor((width - 12) / 6.5)
                    )}
                  </text>
                )}
              </g>
            );
          })}

          {/* Flame/icicle rects */}
          {rects.map((rect) => {
            const node = rect.node;
            const y = (ancestorRowCount + rect.depth) * ROW_HEIGHT;
            const rectWidth = Math.max(0.5, rect.x1 - rect.x0);
            const isFiltered = filteredNodeIds.has(node.id);
            const isSelected = selectedNodeIdSet.has(node.id);
            const isSearchMatch = searchText.trim() !== '' && matchesSearch(node, searchText);

            const palette = COLOR_SCHEME_PALETTES[colorScheme];
            const category = getOperationCategory(node.operation);
            const baseFill = isFiltered
              ? palette[category] || '#6b7280'
              : (isDark ? '#4b5563' : '#9ca3af');
            const opacity = isFiltered ? 1 : 0.4;

            let stroke = isDark ? '#0f172a' : '#ffffff';
            let strokeWidth = 1;
            let strokeDasharray: string | undefined;

            if (isSelected) {
              stroke = '#3b82f6';
              strokeWidth = 2.5;
            } else if (isSearchMatch) {
              stroke = '#3b82f6';
              strokeWidth = 1.5;
              strokeDasharray = '4 2';
            }

            const canLabel = rectWidth > 40;
            const label = canLabel
              ? truncateText(
                  `${node.operation}${node.objectName ? ` ${node.objectName}` : ''}`,
                  Math.floor((rectWidth - 8) / 6.5)
                )
              : null;

            return (
              <g key={node.id}>
                <rect
                  x={rect.x0}
                  y={y}
                  width={rectWidth}
                  height={ROW_HEIGHT}
                  fill={baseFill}
                  opacity={opacity}
                  stroke={stroke}
                  strokeWidth={strokeWidth}
                  strokeDasharray={strokeDasharray}
                  className="cursor-pointer"
                  onClick={(event) => handleRectClick(node, event)}
                  onDoubleClick={() => handleRectDoubleClick(node)}
                  onMouseEnter={(event) => {
                    const { title, lines } = buildTooltipLines(rect);
                    scheduleTooltipUpdate({ x: event.clientX, y: event.clientY, title, lines });
                  }}
                  onMouseMove={(event) => {
                    const current = tooltipStateRef.current;
                    if (!current) return;
                    scheduleTooltipUpdate({ ...current, x: event.clientX, y: event.clientY });
                  }}
                  onMouseLeave={() => scheduleTooltipUpdate(null)}
                />
                {label && (
                  <text
                    x={rect.x0 + 4}
                    y={y + ROW_HEIGHT / 2}
                    dy="0.35em"
                    fontSize={11}
                    fill={isDark ? '#f1f5f9' : '#1e293b'}
                    style={{ pointerEvents: 'none' }}
                  >
                    {label}
                  </text>
                )}
              </g>
            );
          })}
        </svg>
      </div>

      {/* Reset zoom control */}
      {zoomNodeId !== null && (
        <div className="absolute bottom-3 right-3 z-20">
          <button
            type="button"
            onClick={() => setZoomNodeId(null)}
            className="px-2.5 h-7 flex items-center justify-center rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700 shadow-sm text-xs font-semibold"
            title="Reset zoom to full plan"
          >
            Reset zoom
          </button>
        </div>
      )}

      {tooltip && containerRef.current && (
        <div
          className="absolute z-10 pointer-events-none bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-md shadow-lg px-3 py-2 text-xs text-gray-800 dark:text-gray-100"
          style={{
            left: `${tooltip.x - containerRef.current.getBoundingClientRect().left + 12}px`,
            top: `${tooltip.y - containerRef.current.getBoundingClientRect().top + 12}px`,
            maxWidth: '280px',
          }}
        >
          <div className="font-semibold mb-1">{tooltip.title}</div>
          <div className="space-y-0.5">
            {tooltip.lines.map((line, index) => (
              <div key={`${line}-${index}`}>{line}</div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
