import { useEffect, useMemo, useRef, useCallback, useState } from 'react';
import { usePlan } from '../../hooks/usePlanContext';
import { getCategoryPaint, getOperationCategory } from '../../lib/types';
import type { PlanNode } from '../../lib/types';
import { computeFlameLayout, getEffectiveFlameMetric } from '../../lib/flameLayout';
import type { FlameRect } from '../../lib/flameLayout';
import { formatNumberShort, formatTimeCompact } from '../../lib/format';
import { matchesSearch } from '../../lib/filtering';
import { FOCUS_RING } from '../ui';

/** Rows never get thinner than this — deep plans stay compact and scroll. */
const MIN_ROW_HEIGHT = 28;
/** …and never taller than this, so a 3-op plan doesn't become slab art. */
const MAX_ROW_HEIGHT = 56;

const HINT_DISMISSED_KEY = 'ora-explain-viz-flame-zoom-hint-dismissed';

function readHintDismissed(): boolean {
  try {
    return localStorage.getItem(HINT_DISMISSED_KEY) === '1';
  } catch {
    return false;
  }
}

/** True when the element is focused the way a keyboard user focuses it (not a mouse click). */
function isKeyboardFocus(el: Element): boolean {
  try {
    return el.matches(':focus-visible');
  } catch {
    return true;
  }
}

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
  const [height, setHeight] = useState(0);
  const [zoomNodeId, setZoomNodeId] = useState<number | null>(null);
  const [tooltip, setTooltip] = useState<Tooltip | null>(null);
  // Node id whose bar has keyboard focus (draws the focus outline)
  const [focusedNodeId, setFocusedNodeId] = useState<number | null>(null);
  const [hintDismissed, setHintDismissed] = useState(readHintDismissed);
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

  // Escape resets the zoom first; with nothing zoomed it deselects, like the other views
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      const tag = (event.target as HTMLElement)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      if ((event.target as HTMLElement)?.isContentEditable) return;
      if (zoomNodeId !== null) {
        event.preventDefault();
        setZoomNodeId(null);
        return;
      }
      if (selectedNodeIds.length === 0) return;
      event.preventDefault();
      selectNode(null);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [zoomNodeId, selectedNodeIds.length, selectNode]);

  // Update width/height on mount and resize. The container only exists once a
  // plan is loaded, so re-attach when that changes.
  const hasPlan = Boolean(parsedPlan?.rootNode);
  useEffect(() => {
    const updateSize = () => {
      if (containerRef.current) {
        setWidth(containerRef.current.clientWidth);
        setHeight(containerRef.current.clientHeight);
      }
    };

    updateSize();
    window.addEventListener('resize', updateSize);
    const timer = setTimeout(updateSize, 100);
    const observer =
      typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(updateSize);
    if (observer && containerRef.current) observer.observe(containerRef.current);

    return () => {
      window.removeEventListener('resize', updateSize);
      clearTimeout(timer);
      observer?.disconnect();
    };
  }, [hasPlan]);

  // Reset zoom if the zoomed node no longer exists (e.g. new plan loaded)
  const [prevZoomCheckPlan, setPrevZoomCheckPlan] = useState(parsedPlan);
  const [prevZoomCheckId, setPrevZoomCheckId] = useState(zoomNodeId);
  if (parsedPlan !== prevZoomCheckPlan || zoomNodeId !== prevZoomCheckId) {
    setPrevZoomCheckPlan(parsedPlan);
    setPrevZoomCheckId(zoomNodeId);
    if (zoomNodeId !== null) {
      if (!parsedPlan?.rootNode) {
        setZoomNodeId(null);
      } else if (!findNodeById(parsedPlan.rootNode, zoomNodeId)) {
        setZoomNodeId(null);
      }
    }
  }

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

  // A focused bar that leaves the layout (zoomed away) takes its focus ring with it,
  // instead of the ring reappearing on a bar that no longer has focus.
  if (focusedNodeId !== null && !rects.some((r) => r.node.id === focusedNodeId)) {
    setFocusedNodeId(null);
  }

  const rootValue = rects.length > 0 ? rects[0].value : 0;

  const maxDepth = useMemo(() => {
    return rects.reduce((max, r) => Math.max(max, r.depth), 0);
  }, [rects]);

  const ancestorRowCount = ancestorChain.length;
  const totalRows = ancestorRowCount + maxDepth + 1;

  // Shallow plans stretch their rows to fill the pane instead of leaving a
  // thin strip over a void; deep plans fall back to MIN_ROW_HEIGHT and scroll.
  const rowHeight = useMemo(() => {
    if (height <= 0 || totalRows <= 0) return MIN_ROW_HEIGHT;
    const fitted = Math.floor(height / totalRows);
    return Math.max(MIN_ROW_HEIGHT, Math.min(MAX_ROW_HEIGHT, fitted));
  }, [height, totalRows]);

  const svgHeight = totalRows * rowHeight;
  const fontSize = rowHeight >= 40 ? 12 : 11;
  const charWidth = fontSize * 0.6;

  const handleRectClick = useCallback(
    (node: PlanNode, event: React.MouseEvent) => {
      const additive = event.metaKey || event.ctrlKey;
      selectNode(node.id, { additive });
    },
    [selectNode]
  );

  const dismissHint = useCallback(() => {
    setHintDismissed(true);
    try {
      localStorage.setItem(HINT_DISMISSED_KEY, '1');
    } catch {
      // Storage unavailable (private window etc.) — the hint just reappears next visit
    }
  }, []);

  const handleRectDoubleClick = useCallback(
    (node: PlanNode) => {
      setZoomNodeId(node.id);
      // The layout is about to change, so the current tooltip's figures would be stale
      scheduleTooltipUpdate(null);
      // They found the gesture; the hint has done its job
      dismissHint();
    },
    [dismissHint, scheduleTooltipUpdate]
  );

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
      if (node.inactive) lines.push('Inactive (adaptive plan): not used by the optimizer');

      return { title, lines };
    },
    [effectiveMetric, rootValue]
  );

  // Accessible names, e.g. "#4 TABLE ACCESS FULL (ORDERS), A-Time: 1.2s, Self: 1.1s, % of total: 41.0%".
  // Memoized: the tooltip re-renders this view on every mouse move.
  const ariaLabels = useMemo(() => {
    const labels = new Map<number, string>();
    for (const rect of rects) {
      const { title, lines } = buildTooltipLines(rect);
      labels.set(rect.node.id, `#${rect.node.id} ${title}, ${lines.join(', ')}. Enter selects, Shift+Enter zooms in.`);
    }
    return labels;
  }, [rects, buildTooltipLines]);

  const focusedRect = focusedNodeId === null ? null : rects.find((r) => r.node.id === focusedNodeId) ?? null;

  if (!parsedPlan?.rootNode) {
    return (
      <div className="flex items-center justify-center h-full text-slate-500 dark:text-slate-400">
        No plan loaded yet. Paste an execution plan in the input panel and press Parse.
      </div>
    );
  }

  return (
    <div className="relative w-full h-full" style={{ minHeight: '400px' }}>
      <div ref={containerRef} className="absolute inset-0 overflow-y-auto overflow-x-hidden">
        <svg width={width} height={svgHeight} className="block">
          {/* Ancestor chain (when zoomed in) — full-width muted bars above row 0 */}
          {ancestorChain.map((ancestor, i) => {
            const y = i * rowHeight;
            const isTopmost = i === 0;
            return (
              <g
                key={`ancestor-${ancestor.id}`}
                className="cursor-pointer"
                role="button"
                tabIndex={0}
                aria-label={`Zoom out to ${ancestor.operation}${ancestor.objectName ? ` ${ancestor.objectName}` : ''}`}
                onClick={() => setZoomNodeId(isTopmost ? null : ancestor.id)}
                onKeyDown={(event) => {
                  if (event.key !== 'Enter' && event.key !== ' ') return;
                  event.preventDefault();
                  setZoomNodeId(isTopmost ? null : ancestor.id);
                }}
                style={{ outline: 'none' }}
              >
                <rect
                  x={0}
                  y={y}
                  width={width}
                  height={rowHeight}
                  fill={isDark ? '#334155' : '#cbd5e1'}
                  stroke={isDark ? '#0f172a' : '#ffffff'}
                  strokeWidth={1}
                  opacity={0.7}
                />
                {width > 40 && (
                  <text
                    x={6}
                    y={y + rowHeight / 2}
                    dy="0.35em"
                    fontSize={fontSize}
                    fill={isDark ? '#e2e8f0' : '#334155'}
                    style={{ pointerEvents: 'none' }}
                  >
                    {truncateText(
                      `${ancestor.operation}${ancestor.objectName ? ` ${ancestor.objectName}` : ''}`,
                      Math.floor((width - 12) / charWidth)
                    )}
                  </text>
                )}
              </g>
            );
          })}

          {/* Flame/icicle rects */}
          {rects.map((rect) => {
            const node = rect.node;
            const y = (ancestorRowCount + rect.depth) * rowHeight;
            const rawWidth = rect.x1 - rect.x0;
            const isSelected = selectedNodeIdSet.has(node.id);
            // Sub-half-pixel bars are invisible and only cost DOM nodes on big
            // plans; a selected one is still drawn so the selection never vanishes.
            if (rawWidth < 0.5 && !isSelected) return null;
            const rectWidth = Math.max(0.5, rawWidth);
            const isFiltered = filteredNodeIds.has(node.id);
            const isSearchMatch = searchText.trim() !== '' && matchesSearch(node, searchText);

            const category = getOperationCategory(node.operation);
            const paint = getCategoryPaint(category, colorScheme, isDark);
            const baseFill = isFiltered
              ? paint.fill
              : (isDark ? '#475569' : '#94a3b8');
            const opacity = isFiltered ? (node.inactive ? 0.5 : 1) : 0.4;

            // Dark mode: the bar is a tinted surface, so its own hue carries the
            // outline. Light mode keeps the paper-coloured separator.
            let stroke = isDark
              ? (isFiltered ? paint.stroke : '#0f172a')
              : '#ffffff';
            let strokeWidth = 1;
            let strokeDasharray: string | undefined = node.inactive ? '3 2' : undefined;

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
                  Math.floor((rectWidth - 8) / charWidth)
                )
              : null;

            return (
              <g key={node.id}>
                <rect
                  x={rect.x0}
                  y={y}
                  width={rectWidth}
                  height={rowHeight}
                  fill={baseFill}
                  opacity={opacity}
                  stroke={stroke}
                  strokeWidth={strokeWidth}
                  strokeDasharray={strokeDasharray}
                  className="cursor-pointer"
                  data-node-id={node.id}
                  tabIndex={0}
                  role="button"
                  aria-pressed={isSelected}
                  aria-label={ariaLabels.get(node.id)}
                  style={{ outline: 'none' }}
                  onClick={(event) => handleRectClick(node, event)}
                  onDoubleClick={() => handleRectDoubleClick(node)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' && event.shiftKey) {
                      // Keyboard equivalent of double-click
                      event.preventDefault();
                      handleRectDoubleClick(node);
                    } else if (event.key === 'Enter' || event.key === ' ') {
                      event.preventDefault();
                      selectNode(node.id, { additive: event.metaKey || event.ctrlKey });
                    }
                  }}
                  onFocus={(event) => {
                    if (!isKeyboardFocus(event.currentTarget)) return;
                    setFocusedNodeId(node.id);
                    const { title, lines } = buildTooltipLines(rect);
                    const box = event.currentTarget.getBoundingClientRect();
                    const containerRect = containerRef.current?.getBoundingClientRect();
                    scheduleTooltipUpdate({
                      x: Math.min(
                        box.left - (containerRect?.left ?? 0) + 8,
                        Math.max(0, (containerRect?.width ?? 0) - 300)
                      ),
                      y: box.top - (containerRect?.top ?? 0) + rowHeight / 2,
                      title,
                      lines,
                    });
                  }}
                  onBlur={() => {
                    setFocusedNodeId((current) => (current === node.id ? null : current));
                    scheduleTooltipUpdate(null);
                  }}
                  onMouseEnter={(event) => {
                    const { title, lines } = buildTooltipLines(rect);
                    const containerRect = containerRef.current?.getBoundingClientRect();
                    scheduleTooltipUpdate({
                      x: event.clientX - (containerRect?.left ?? 0),
                      y: event.clientY - (containerRect?.top ?? 0),
                      title,
                      lines,
                    });
                  }}
                  onMouseMove={(event) => {
                    const current = tooltipStateRef.current;
                    if (!current) return;
                    const containerRect = containerRef.current?.getBoundingClientRect();
                    scheduleTooltipUpdate({
                      ...current,
                      x: event.clientX - (containerRect?.left ?? 0),
                      y: event.clientY - (containerRect?.top ?? 0),
                    });
                  }}
                  onMouseLeave={() => scheduleTooltipUpdate(null)}
                />
                {label && (
                  <text
                    x={rect.x0 + 4}
                    y={y + rowHeight / 2}
                    dy="0.35em"
                    fontSize={fontSize}
                    fill={isDark ? '#e2e8f0' : '#1e293b'}
                    style={{ pointerEvents: 'none' }}
                  >
                    {label}
                  </text>
                )}
              </g>
            );
          })}

          {/* Keyboard focus outline, drawn on top of the bars */}
          {focusedRect && (
            <rect
              x={focusedRect.x0 + 1}
              y={(ancestorRowCount + focusedRect.depth) * rowHeight + 1}
              width={Math.max(2, focusedRect.x1 - focusedRect.x0 - 2)}
              height={rowHeight - 2}
              fill="none"
              stroke={isDark ? '#93c5fd' : '#1d4ed8'}
              strokeWidth={2}
              pointerEvents="none"
            />
          )}
        </svg>
      </div>

      {/* One-time discoverability hint for the (otherwise invisible) zoom gesture */}
      {!hintDismissed && zoomNodeId === null && (
        <div className="absolute bottom-3 left-3 z-20 flex items-center gap-2 rounded-md border border-slate-200 dark:border-slate-700 bg-white/95 dark:bg-slate-800/95 pl-2.5 pr-1 py-1 text-xs text-slate-600 dark:text-slate-300 shadow-sm">
          <span>Double-click a bar to zoom in · Esc resets</span>
          <button
            type="button"
            onClick={dismissHint}
            aria-label="Dismiss hint"
            title="Dismiss"
            className={`flex h-5 w-5 items-center justify-center rounded text-slate-500 hover:bg-slate-100 hover:text-slate-800 dark:text-slate-400 dark:hover:bg-slate-700 dark:hover:text-slate-100 ${FOCUS_RING}`}
          >
            <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
              <path d="M2 2l6 6M8 2L2 8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
          </button>
        </div>
      )}

      {/* Estimate-only notice + reset zoom control (bottom-right stack) */}
      <div className="absolute bottom-3 right-3 z-20 flex flex-col items-end gap-2">
        {!parsedPlan.hasActualStats && (
          <div className="px-2.5 py-1.5 rounded-md border border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/70 text-amber-800 dark:text-amber-200 text-xs shadow-sm pointer-events-none">
            Showing optimizer cost estimates — widths reflect predicted, not actual, work
          </div>
        )}
        {zoomNodeId !== null && (
          <button
            type="button"
            onClick={() => setZoomNodeId(null)}
            className={`px-2.5 h-7 flex items-center justify-center rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700 shadow-sm text-xs font-semibold ${FOCUS_RING}`}
            title="Reset zoom to full plan (Esc)"
          >
            Reset zoom
          </button>
        )}
      </div>

      {tooltip && (
        <div
          className="absolute z-10 pointer-events-none bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-md shadow-lg px-3 py-2 text-xs text-slate-800 dark:text-slate-100"
          style={{
            left: `${tooltip.x + 12}px`,
            top: `${tooltip.y + 12}px`,
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
