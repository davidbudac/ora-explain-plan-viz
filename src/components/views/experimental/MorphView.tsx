import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { usePlan } from '../../../hooks/usePlanContext';
import type { PlanNode } from '../../../lib/types';
import { computeFlameLayout } from '../../../lib/flameLayout';
import type { FlameRect } from '../../../lib/flameLayout';
import {
  cardinalityRatioSeverity,
  computeCardinalityRatio,
  formatCardinalityRatio,
  formatNumberShort,
} from '../../../lib/format';
import { matchesSearch } from '../../../lib/filtering';
import { EmptyState } from './EmptyState';

const ROW_HEIGHT = 24;
const MORPH_MS = 600;

const SEVERITY_FILL: Record<'good' | 'warn' | 'bad', string> = {
  good: '#64748b', // slate-500
  warn: '#f59e0b', // amber-500
  bad: '#ef4444', // red-500
};
const SELECTED_STROKE = '#3b82f6';

function truncateText(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;
  return text.slice(0, Math.max(0, maxChars - 3)) + '...';
}

function easeInOut(t: number): number {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

interface Tooltip {
  x: number;
  y: number;
  title: string;
  lines: string[];
}

export function MorphView() {
  const {
    parsedPlan,
    selectedNodeIds,
    selectNode,
    filteredNodeIds,
    theme,
    filters,
  } = usePlan();

  const containerRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  const [showActual, setShowActual] = useState(false);
  const [progress, setProgress] = useState(0); // 0 = estimated, 1 = actual
  const [tooltip, setTooltip] = useState<Tooltip | null>(null);

  const progressRef = useRef(0);
  const targetRef = useRef(0);
  const animStartRef = useRef<{ from: number; t0: number } | null>(null);
  const animRafRef = useRef<number | null>(null);

  const tooltipStateRef = useRef<Tooltip | null>(null);
  const tipRafRef = useRef<number | null>(null);
  const pendingTooltipRef = useRef<Tooltip | null>(null);

  const isDark = theme === 'dark';
  const searchText = filters.searchText;
  const selectedNodeIdSet = useMemo(() => new Set(selectedNodeIds), [selectedNodeIds]);

  useEffect(() => {
    tooltipStateRef.current = tooltip;
  }, [tooltip]);

  const scheduleTooltipUpdate = useCallback((next: Tooltip | null) => {
    pendingTooltipRef.current = next;
    if (tipRafRef.current !== null) return;
    tipRafRef.current = requestAnimationFrame(() => {
      tipRafRef.current = null;
      setTooltip(pendingTooltipRef.current);
    });
  }, []);

  useEffect(() => {
    return () => {
      if (tipRafRef.current !== null) cancelAnimationFrame(tipRafRef.current);
      if (animRafRef.current !== null) cancelAnimationFrame(animRafRef.current);
    };
  }, []);

  const animateTo = useCallback((to: number) => {
    targetRef.current = to;
    animStartRef.current = { from: progressRef.current, t0: performance.now() };
    if (animRafRef.current !== null) return; // existing loop picks up new target
    const tick = (now: number) => {
      const start = animStartRef.current;
      if (!start) {
        animRafRef.current = null;
        return;
      }
      const elapsed = now - start.t0;
      const t = Math.min(1, elapsed / MORPH_MS);
      const val = start.from + (targetRef.current - start.from) * easeInOut(t);
      progressRef.current = val;
      setProgress(val);
      if (t < 1) {
        animRafRef.current = requestAnimationFrame(tick);
      } else {
        progressRef.current = targetRef.current;
        setProgress(targetRef.current);
        animRafRef.current = null;
      }
    };
    animRafRef.current = requestAnimationFrame(tick);
  }, []);

  const setSide = useCallback((actual: boolean) => {
    setShowActual(actual);
    animateTo(actual ? 1 : 0);
  }, [animateTo]);

  const replay = useCallback(() => {
    setShowActual(false);
    progressRef.current = 0;
    setProgress(0);
    targetRef.current = 0;
    animStartRef.current = { from: 0, t0: performance.now() };
    window.setTimeout(() => {
      setShowActual(true);
      animateTo(1);
    }, 60);
  }, [animateTo]);

  // Escape deselects
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

  // Track container width
  useEffect(() => {
    const update = () => {
      if (containerRef.current) setWidth(containerRef.current.clientWidth);
    };
    update();
    window.addEventListener('resize', update);
    const timer = setTimeout(update, 100);
    return () => {
      window.removeEventListener('resize', update);
      clearTimeout(timer);
    };
  }, []);

  const estRects = useMemo((): FlameRect[] => {
    if (!parsedPlan?.rootNode || width < 50) return [];
    return computeFlameLayout(parsedPlan.rootNode, 'rows', { width });
  }, [parsedPlan, width]);

  const actRects = useMemo((): FlameRect[] => {
    if (!parsedPlan?.rootNode || width < 50) return [];
    return computeFlameLayout(parsedPlan.rootNode, 'actualRows', { width });
  }, [parsedPlan, width]);

  const actById = useMemo(() => {
    const m = new Map<number, FlameRect>();
    for (const r of actRects) m.set(r.node.id, r);
    return m;
  }, [actRects]);

  const maxDepth = useMemo(
    () => estRects.reduce((max, r) => Math.max(max, r.depth), 0),
    [estRects]
  );

  const handleClick = useCallback(
    (node: PlanNode, event: React.MouseEvent) => {
      selectNode(node.id, { additive: event.metaKey || event.ctrlKey });
    },
    [selectNode]
  );

  const buildTooltip = useCallback((node: PlanNode, clientX: number, clientY: number) => {
    const ratio = computeCardinalityRatio(node.rows, node.actualRows);
    const title = node.objectName ? `${node.operation} (${node.objectName})` : node.operation;
    const lines = [
      `E-Rows: ${formatNumberShort(node.rows, { empty: '—' })}`,
      `A-Rows: ${formatNumberShort(node.actualRows, { empty: '—' })}`,
      `Ratio: ${formatCardinalityRatio(ratio) ?? '—'}`,
    ];
    const rect = containerRef.current?.getBoundingClientRect();
    scheduleTooltipUpdate({
      x: clientX - (rect?.left ?? 0),
      y: clientY - (rect?.top ?? 0),
      title,
      lines,
    });
  }, [scheduleTooltipUpdate]);

  if (!parsedPlan?.hasActualStats) {
    return (
      <EmptyState
        title="No actual runtime statistics"
        hint='Morph view needs actual execution stats. Load a SQL Monitor report (e.g. the "Window Sort Spill" example) to see it.'
      />
    );
  }

  const svgHeight = (maxDepth + 1) * ROW_HEIGHT;
  const p = progress;

  return (
    <div className="relative w-full h-full flex flex-col bg-white dark:bg-slate-900">
      {/* Controls row */}
      <div className="flex items-center gap-3 px-3 py-1.5 border-b border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-900/90">
        <div className="flex bg-slate-200/60 dark:bg-slate-800/80 rounded-lg p-0.5 border border-slate-300/40 dark:border-slate-700/50">
          <button
            type="button"
            onClick={() => setSide(false)}
            className={`px-2.5 py-1 text-[11px] font-semibold rounded-md transition-all ${
              !showActual
                ? 'bg-white dark:bg-slate-700 text-slate-800 dark:text-slate-100 shadow-sm'
                : 'text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200'
            }`}
          >
            Estimated
          </button>
          <button
            type="button"
            onClick={() => setSide(true)}
            className={`px-2.5 py-1 text-[11px] font-semibold rounded-md transition-all ${
              showActual
                ? 'bg-white dark:bg-slate-700 text-slate-800 dark:text-slate-100 shadow-sm'
                : 'text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200'
            }`}
          >
            Actual
          </button>
        </div>
        <button
          type="button"
          onClick={replay}
          className="px-2.5 py-1 text-[11px] font-semibold rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700"
        >
          Replay
        </button>
        <span className="text-[11px] text-slate-400 dark:text-slate-500">
          Widths: <span className="font-semibold text-slate-600 dark:text-slate-300">{showActual ? 'A-Rows (actual)' : 'E-Rows (estimated)'}</span>
          {' · color = misestimate severity'}
        </span>
      </div>

      <div ref={containerRef} className="flex-1 min-h-0 relative overflow-auto">
        <svg width={width} height={svgHeight} className="block">
          {estRects.map((estRect) => {
            const node = estRect.node;
            const actRect = actById.get(node.id) ?? estRect;
            const x0 = estRect.x0 + (actRect.x0 - estRect.x0) * p;
            const x1 = estRect.x1 + (actRect.x1 - estRect.x1) * p;
            const rectWidth = Math.max(0, x1 - x0);
            const y = estRect.depth * ROW_HEIGHT;

            const inScope = filteredNodeIds.has(node.id);
            const isSelected = selectedNodeIdSet.has(node.id);
            const isSearchMatch = searchText.trim() !== '' && matchesSearch(node, searchText);
            const severity = cardinalityRatioSeverity(computeCardinalityRatio(node.rows, node.actualRows));

            const fill = inScope ? SEVERITY_FILL[severity] : isDark ? '#4b5563' : '#9ca3af';
            const opacity = inScope ? 0.9 : 0.4;

            let stroke = isDark ? '#0f172a' : '#ffffff';
            let strokeWidth = 1;
            let strokeDasharray: string | undefined;
            if (isSelected) {
              stroke = SELECTED_STROKE;
              strokeWidth = 2.5;
            } else if (isSearchMatch) {
              stroke = SELECTED_STROKE;
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
                  x={x0}
                  y={y}
                  width={rectWidth}
                  height={ROW_HEIGHT}
                  fill={fill}
                  opacity={opacity}
                  stroke={stroke}
                  strokeWidth={strokeWidth}
                  strokeDasharray={strokeDasharray}
                  className="cursor-pointer"
                  onClick={(event) => handleClick(node, event)}
                  onMouseEnter={(event) => buildTooltip(node, event.clientX, event.clientY)}
                  onMouseMove={(event) => {
                    if (!tooltipStateRef.current) return;
                    buildTooltip(node, event.clientX, event.clientY);
                  }}
                  onMouseLeave={() => scheduleTooltipUpdate(null)}
                />
                {label && (
                  <text
                    x={x0 + 4}
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

        {tooltip && (
          <div
            className="absolute z-10 pointer-events-none bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-md shadow-lg px-3 py-2 text-xs text-gray-800 dark:text-gray-100"
            style={{ left: `${tooltip.x + 12}px`, top: `${tooltip.y + 12}px`, maxWidth: '260px' }}
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
    </div>
  );
}
