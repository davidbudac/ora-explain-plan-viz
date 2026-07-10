import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { usePlan } from '../../../hooks/usePlanContext';
import type { PlanNode } from '../../../lib/types';
import {
  cardinalityRatioSeverity,
  computeCardinalityRatio,
  formatCardinalityRatio,
  formatNumberShort,
  formatTimeDetailed,
} from '../../../lib/format';
import { matchesSearch } from '../../../lib/filtering';
import { EmptyState } from './EmptyState';

// Severity fills — same hues as the app's cardinality badges (amber / red family).
const SEVERITY_FILL: Record<'good' | 'warn' | 'bad', string> = {
  good: '#64748b', // slate-500
  warn: '#f59e0b', // amber-500
  bad: '#ef4444', // red-500
};
const SELECTED_STROKE = '#3b82f6';

const PAD_L = 56;
const PAD_R = 18;
const PAD_T = 16;
const PAD_B = 40;

interface Tooltip {
  x: number;
  y: number;
  title: string;
  lines: string[];
}

export function ScatterView() {
  const {
    parsedPlan,
    selectedNodeIds,
    selectNode,
    filteredNodeIds,
    theme,
    filters,
  } = usePlan();

  const containerRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  const [tooltip, setTooltip] = useState<Tooltip | null>(null);
  const tooltipStateRef = useRef<Tooltip | null>(null);
  const rafRef = useRef<number | null>(null);
  const pendingTooltipRef = useRef<Tooltip | null>(null);

  const isDark = theme === 'dark';
  const searchText = filters.searchText;
  const selectedNodeIdSet = useMemo(() => new Set(selectedNodeIds), [selectedNodeIds]);

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
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    };
  }, []);

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

  // Track container size (width + height)
  useEffect(() => {
    const update = () => {
      if (containerRef.current) {
        setSize({ w: containerRef.current.clientWidth, h: containerRef.current.clientHeight });
      }
    };
    update();
    window.addEventListener('resize', update);
    const timer = setTimeout(update, 100);
    return () => {
      window.removeEventListener('resize', update);
      clearTimeout(timer);
    };
  }, []);

  const points = useMemo(() => {
    if (!parsedPlan) return [] as { node: PlanNode; x: number; y: number }[];
    return parsedPlan.allNodes
      .filter((n) => n.rows !== undefined && n.actualRows !== undefined)
      .map((n) => ({ node: n, x: Math.max(n.rows as number, 1), y: Math.max(n.actualRows as number, 1) }));
  }, [parsedPlan]);

  // Shared log domain across both axes → the diagonal is meaningful.
  const domain = useMemo(() => {
    if (points.length === 0) return { lo: 0, hi: 1 };
    let dataMin = Infinity;
    let dataMax = -Infinity;
    for (const p of points) {
      dataMin = Math.min(dataMin, p.x, p.y);
      dataMax = Math.max(dataMax, p.x, p.y);
    }
    const lo = Math.floor(Math.log10(dataMin));
    let hi = Math.ceil(Math.log10(dataMax));
    if (hi <= lo) hi = lo + 1;
    return { lo, hi };
  }, [points]);

  const maxSelf = useMemo(
    () => points.reduce((m, p) => Math.max(m, p.node.selfTime ?? 0), 0),
    [points]
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
      `Self time: ${formatTimeDetailed(node.selfTime, { empty: '—' })}`,
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
        hint='Scatter view needs actual execution stats. Load a SQL Monitor report (e.g. the "Window Sort Spill" example) to see it.'
      />
    );
  }

  const { w, h } = size;
  const plotW = w - PAD_L - PAD_R;
  const plotH = h - PAD_B - PAD_T;
  const ready = points.length > 0 && plotW > 40 && plotH > 40;

  const gridColor = isDark ? '#334155' : '#e2e8f0';
  const axisColor = isDark ? '#64748b' : '#94a3b8';
  const textColor = isDark ? '#cbd5e1' : '#475569';

  const { lo, hi } = domain;
  const span = hi - lo;
  const sx = (v: number) => PAD_L + ((Math.log10(v) - lo) / span) * plotW;
  const syPix = (v: number) => PAD_T + plotH - ((Math.log10(v) - lo) / span) * plotH;
  const pxFor = (factor: number) => (Math.log10(factor) / span) * plotH;

  const radiusFor = (selfTime?: number) => {
    if (maxSelf <= 0) return 3.5;
    const r = 3.5 + (Math.sqrt(selfTime ?? 0) / Math.sqrt(maxSelf)) * (14 - 3.5);
    return Math.max(3.5, Math.min(14, r));
  };

  const decades: number[] = [];
  for (let i = lo; i <= hi; i++) decades.push(i);

  // Deviation band polygons (clipped to the plot). Concentric: bad (whole plot)
  // < warn (within 10x) < good (within 3x).
  const bandPolygon = (factor: number) => {
    const d = pxFor(factor);
    const x0 = PAD_L;
    const x1 = PAD_L + plotW;
    const yb = PAD_T + plotH; // bottom (value = 10^lo)
    const yt = PAD_T; // top (value = 10^hi)
    return `${x0},${yb - d} ${x1},${yt - d} ${x1},${yt + d} ${x0},${yb + d}`;
  };

  const clipId = 'scatter-plot-clip';

  return (
    <div className="relative w-full h-full flex flex-col bg-white dark:bg-slate-900">
      {/* Legend row */}
      <div className="flex items-center flex-wrap gap-x-4 gap-y-1 px-3 py-1.5 border-b border-slate-200 dark:border-slate-800 text-[11px] text-slate-500 dark:text-slate-400">
        <span className="flex items-center gap-1.5">
          <span className="inline-block w-2.5 h-2.5 rounded-full" style={{ background: SEVERITY_FILL.good }} />
          Accurate (&lt;3x)
        </span>
        <span className="flex items-center gap-1.5">
          <span className="inline-block w-2.5 h-2.5 rounded-full" style={{ background: SEVERITY_FILL.warn }} />
          Off 3–10x
        </span>
        <span className="flex items-center gap-1.5">
          <span className="inline-block w-2.5 h-2.5 rounded-full" style={{ background: SEVERITY_FILL.bad }} />
          Off &gt;10x
        </span>
        <span className="text-slate-400 dark:text-slate-500">size = self time</span>
      </div>

      <div ref={containerRef} className="flex-1 min-h-0 relative overflow-hidden">
        {!ready ? (
          <div className="h-full flex items-center justify-center text-xs text-slate-400 dark:text-slate-500">
            {points.length === 0
              ? 'No nodes have both estimated and actual row counts.'
              : 'Sizing…'}
          </div>
        ) : (
          <svg width={w} height={h} className="block">
            <defs>
              <clipPath id={clipId}>
                <rect x={PAD_L} y={PAD_T} width={plotW} height={plotH} />
              </clipPath>
            </defs>

            {/* Deviation bands (concentric) */}
            <g clipPath={`url(#${clipId})`}>
              <rect x={PAD_L} y={PAD_T} width={plotW} height={plotH} fill={SEVERITY_FILL.bad} opacity={0.05} />
              <polygon points={bandPolygon(10)} fill={SEVERITY_FILL.warn} opacity={0.06} />
              <polygon points={bandPolygon(3)} fill={SEVERITY_FILL.good} opacity={0.06} />
            </g>

            {/* Grid + ticks at decades */}
            {decades.map((i) => {
              const v = Math.pow(10, i);
              const gx = sx(v);
              const gy = syPix(v);
              const label = formatNumberShort(v);
              return (
                <g key={`decade-${i}`}>
                  <line x1={gx} y1={PAD_T} x2={gx} y2={PAD_T + plotH} stroke={gridColor} strokeWidth={1} />
                  <line x1={PAD_L} y1={gy} x2={PAD_L + plotW} y2={gy} stroke={gridColor} strokeWidth={1} />
                  <text x={gx} y={PAD_T + plotH + 16} fontSize={10} fill={textColor} textAnchor="middle">
                    {label}
                  </text>
                  <text x={PAD_L - 8} y={gy} dy="0.32em" fontSize={10} fill={textColor} textAnchor="end">
                    {label}
                  </text>
                </g>
              );
            })}

            {/* Diagonal y = x reference line */}
            <line
              x1={sx(Math.pow(10, lo))}
              y1={syPix(Math.pow(10, lo))}
              x2={sx(Math.pow(10, hi))}
              y2={syPix(Math.pow(10, hi))}
              stroke={axisColor}
              strokeWidth={1.5}
              strokeDasharray="5 3"
              clipPath={`url(#${clipId})`}
            />

            {/* Axis borders */}
            <line x1={PAD_L} y1={PAD_T} x2={PAD_L} y2={PAD_T + plotH} stroke={axisColor} strokeWidth={1} />
            <line x1={PAD_L} y1={PAD_T + plotH} x2={PAD_L + plotW} y2={PAD_T + plotH} stroke={axisColor} strokeWidth={1} />

            {/* Axis titles */}
            <text
              x={PAD_L + plotW / 2}
              y={h - 4}
              fontSize={11}
              fill={textColor}
              textAnchor="middle"
              fontWeight={600}
            >
              E-Rows (estimated)
            </text>
            <text
              x={14}
              y={PAD_T + plotH / 2}
              fontSize={11}
              fill={textColor}
              textAnchor="middle"
              fontWeight={600}
              transform={`rotate(-90 14 ${PAD_T + plotH / 2})`}
            >
              A-Rows (actual)
            </text>

            {/* Points */}
            <g clipPath={`url(#${clipId})`}>
              {points.map(({ node }) => {
                const cx = sx(Math.max(node.rows as number, 1));
                const cy = syPix(Math.max(node.actualRows as number, 1));
                const r = radiusFor(node.selfTime);
                const inScope = filteredNodeIds.has(node.id);
                const isSelected = selectedNodeIdSet.has(node.id);
                const isSearchMatch = searchText.trim() !== '' && matchesSearch(node, searchText);
                const severity = cardinalityRatioSeverity(computeCardinalityRatio(node.rows, node.actualRows));

                const fill = inScope ? SEVERITY_FILL[severity] : isDark ? '#4b5563' : '#9ca3af';
                const fillOpacity = inScope ? 0.8 : 0.28;

                let stroke = isDark ? '#0f172a' : '#ffffff';
                let strokeWidth = 1;
                let strokeDasharray: string | undefined;
                if (isSelected) {
                  stroke = SELECTED_STROKE;
                  strokeWidth = 2.5;
                } else if (isSearchMatch) {
                  stroke = SELECTED_STROKE;
                  strokeWidth = 1.5;
                  strokeDasharray = '3 2';
                }

                return (
                  <circle
                    key={node.id}
                    cx={cx}
                    cy={cy}
                    r={r}
                    fill={fill}
                    fillOpacity={fillOpacity}
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
                );
              })}
            </g>
          </svg>
        )}

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
