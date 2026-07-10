import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { usePlan } from '../../../hooks/usePlanContext';
import { COLOR_SCHEME_PALETTES, getOperationCategory } from '../../../lib/types';
import type { ActivitySample, PlanNode } from '../../../lib/types';
import { getWaitClassColor } from '../../../lib/ash';
import { formatTimeShort, formatTimeDetailed } from '../../../lib/format';
import { matchesSearch } from '../../../lib/filtering';
import { EmptyState } from './EmptyState';

const ROW_HEIGHT = 22;
const GUTTER = 240;
const RIGHT_PAD = 16;
const AXIS_H = 26;
const MIN_BAR = 3;

interface Tooltip {
  x: number;
  y: number;
  title: string;
  lines: string[];
}

function truncateText(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;
  return text.slice(0, Math.max(0, maxChars - 1)) + '…';
}

/** Pick a "nice" tick step (1/2/5 × 10^n) that yields roughly `target` ticks. */
function niceStep(range: number, target: number): number {
  if (range <= 0) return 1;
  const rough = range / target;
  const pow = Math.pow(10, Math.floor(Math.log10(rough)));
  const candidates = [1, 2, 5, 10].map((m) => m * pow);
  return candidates.find((c) => c >= rough) ?? candidates[candidates.length - 1];
}

export function TimelineView() {
  const {
    parsedPlan,
    selectedNodeIds,
    selectNode,
    filteredNodeIds,
    theme,
    colorScheme,
    filters,
  } = usePlan();

  const containerRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  const [tooltip, setTooltip] = useState<Tooltip | null>(null);
  const tooltipStateRef = useRef<Tooltip | null>(null);
  const pendingTooltipRef = useRef<Tooltip | null>(null);
  const rafRef = useRef<number | null>(null);

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

  useEffect(() => {
    const updateWidth = () => {
      if (containerRef.current) setWidth(containerRef.current.clientWidth);
    };
    updateWidth();
    window.addEventListener('resize', updateWidth);
    const timer = setTimeout(updateWidth, 100);
    return () => {
      window.removeEventListener('resize', updateWidth);
      clearTimeout(timer);
    };
  }, []);

  const nodes = parsedPlan?.allNodes ?? [];
  const hasTimingData = nodes.some((node) => node.firstActiveOffset !== undefined);

  const timeline = parsedPlan?.activityTimeline;

  // ASH samples grouped by plan line (== node id).
  const samplesByNode = useMemo(() => {
    const map = new Map<number, ActivitySample[]>();
    if (!timeline) return map;
    for (const sample of timeline.samples) {
      if (sample.line === undefined) continue;
      const arr = map.get(sample.line);
      if (arr) arr.push(sample);
      else map.set(sample.line, [sample]);
    }
    return map;
  }, [timeline]);

  const totalDuration = useMemo(() => {
    let max = parsedPlan?.monitorMetadata?.duration ?? 0;
    for (const node of nodes) {
      if (node.lastActiveOffset !== undefined) max = Math.max(max, node.lastActiveOffset);
    }
    if (timeline) max = Math.max(max, timeline.durationSecs);
    return max > 0 ? max : 1;
  }, [nodes, parsedPlan?.monitorMetadata?.duration, timeline]);

  const waitClassesPresent = useMemo(() => {
    const set = new Set<string>();
    if (timeline) {
      for (const sample of timeline.samples) {
        if (sample.line !== undefined) set.add(sample.waitClass);
      }
    }
    return Array.from(set);
  }, [timeline]);

  if (!parsedPlan?.rootNode || !hasTimingData) {
    return (
      <EmptyState
        title="No operation timing data"
        hint='Timeline view needs per-operation start times. Load a SQL Monitor report (e.g. the "Window Sort Spill" example) to see it.'
      />
    );
  }

  const chartWidth = Math.max(0, width - GUTTER - RIGHT_PAD);
  const xScale = (sec: number) => GUTTER + (sec / totalDuration) * chartWidth;
  const bucketW = timeline
    ? Math.max(2, (timeline.bucketIntervalSecs / totalDuration) * chartWidth)
    : 0;

  const step = niceStep(totalDuration, 6);
  const ticks: number[] = [];
  for (let t = 0; t <= totalDuration + 1e-9; t += step) ticks.push(t);

  const svgHeight = AXIS_H + nodes.length * ROW_HEIGHT;
  const palette = COLOR_SCHEME_PALETTES[colorScheme];

  const showTooltip = (event: React.MouseEvent, title: string, lines: string[]) => {
    const containerRect = containerRef.current?.getBoundingClientRect();
    scheduleTooltipUpdate({
      x: event.clientX - (containerRect?.left ?? 0),
      y: event.clientY - (containerRect?.top ?? 0),
      title,
      lines,
    });
  };
  const moveTooltip = (event: React.MouseEvent) => {
    const current = tooltipStateRef.current;
    if (!current) return;
    const containerRect = containerRef.current?.getBoundingClientRect();
    scheduleTooltipUpdate({
      ...current,
      x: event.clientX - (containerRect?.left ?? 0),
      y: event.clientY - (containerRect?.top ?? 0),
    });
  };

  const nodeTooltip = (node: PlanNode): { title: string; lines: string[] } => {
    const title = node.objectName ? `${node.operation} (${node.objectName})` : node.operation;
    const lines: string[] = [];
    if (node.firstActiveOffset !== undefined) {
      lines.push(`First active: ${formatTimeShort(node.firstActiveOffset * 1000) ?? '—'}`);
    }
    if (node.lastActiveOffset !== undefined) {
      lines.push(`Last active: ${formatTimeShort(node.lastActiveOffset * 1000) ?? '—'}`);
    }
    if (node.firstActiveOffset !== undefined && node.lastActiveOffset !== undefined) {
      const dur = Math.max(0, node.lastActiveOffset - node.firstActiveOffset);
      lines.push(`Active span: ${formatTimeDetailed(dur * 1000) ?? '0ms'}`);
    }
    return { title, lines };
  };

  return (
    <div className="relative w-full h-full" style={{ minHeight: '300px' }}>
      {/* Legend */}
      {waitClassesPresent.length > 0 && (
        <div className="absolute top-0 right-0 z-10 flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-1.5 text-[11px] text-slate-500 dark:text-slate-400">
          {waitClassesPresent.map((wc) => (
            <span key={wc} className="inline-flex items-center gap-1">
              <span
                className="inline-block w-2.5 h-2.5 rounded-sm"
                style={{ backgroundColor: getWaitClassColor(wc) }}
              />
              {wc}
            </span>
          ))}
        </div>
      )}

      <div ref={containerRef} className="absolute inset-0 overflow-auto">
        <svg width={Math.max(width, GUTTER + 120)} height={svgHeight} className="block">
          {/* Axis gridlines + labels */}
          {ticks.map((t) => {
            const x = xScale(t);
            return (
              <g key={`tick-${t}`}>
                <line
                  x1={x}
                  y1={AXIS_H}
                  x2={x}
                  y2={svgHeight}
                  stroke={isDark ? '#1e293b' : '#e2e8f0'}
                  strokeWidth={1}
                />
                <text
                  x={x}
                  y={AXIS_H - 8}
                  fontSize={10}
                  textAnchor="middle"
                  fill={isDark ? '#64748b' : '#94a3b8'}
                >
                  {formatTimeShort(t * 1000)}
                </text>
              </g>
            );
          })}

          {/* Rows */}
          {nodes.map((node, index) => {
            const y = AXIS_H + index * ROW_HEIGHT;
            const isFiltered = filteredNodeIds.has(node.id);
            const isSelected = selectedNodeIdSet.has(node.id);
            const isSearchMatch = searchText.trim() !== '' && matchesSearch(node, searchText);
            const category = getOperationCategory(node.operation);
            const catColor = palette[category] || '#6b7280';
            const labelColor = isFiltered
              ? isDark
                ? '#e2e8f0'
                : '#334155'
              : isDark
                ? '#475569'
                : '#cbd5e1';

            const hasSpan =
              node.firstActiveOffset !== undefined && node.lastActiveOffset !== undefined;
            const barX = hasSpan ? xScale(node.firstActiveOffset!) : 0;
            const barW = hasSpan
              ? Math.max(MIN_BAR, xScale(node.lastActiveOffset!) - xScale(node.firstActiveOffset!))
              : 0;

            const nodeSamples = samplesByNode.get(node.id) ?? [];
            // group samples by bucket for stacking within a row
            const byBucket = new Map<number, ActivitySample[]>();
            for (const s of nodeSamples) {
              const arr = byBucket.get(s.bucket);
              if (arr) arr.push(s);
              else byBucket.set(s.bucket, [s]);
            }

            const gutterCharBudget = Math.floor((GUTTER - 12 - node.depth * 10) / 6);

            return (
              <g
                key={node.id}
                className="cursor-pointer"
                onClick={(event) =>
                  selectNode(node.id, { additive: event.metaKey || event.ctrlKey })
                }
                onMouseEnter={(event) => {
                  const { title, lines } = nodeTooltip(node);
                  showTooltip(event, title, lines);
                }}
                onMouseMove={moveTooltip}
                onMouseLeave={() => scheduleTooltipUpdate(null)}
              >
                {/* row hover background / selection */}
                <rect
                  x={0}
                  y={y}
                  width={Math.max(width, GUTTER + 120)}
                  height={ROW_HEIGHT}
                  fill={isSelected ? (isDark ? '#1e3a5f' : '#eff6ff') : 'transparent'}
                />
                {/* label */}
                <text
                  x={8 + node.depth * 10}
                  y={y + ROW_HEIGHT / 2}
                  dy="0.35em"
                  fontSize={11}
                  fill={labelColor}
                  style={{ pointerEvents: 'none' }}
                >
                  {truncateText(
                    `${node.operation}${node.objectName ? ` ${node.objectName}` : ''}`,
                    Math.max(4, gutterCharBudget)
                  )}
                </text>

                {hasSpan ? (
                  <rect
                    x={barX}
                    y={y + 4}
                    width={barW}
                    height={ROW_HEIGHT - 8}
                    rx={2}
                    fill={catColor}
                    opacity={isFiltered ? 0.5 : 0.2}
                    stroke={
                      isSelected ? '#3b82f6' : isSearchMatch ? '#3b82f6' : 'none'
                    }
                    strokeWidth={isSelected ? 2 : isSearchMatch ? 1.5 : 0}
                    strokeDasharray={isSearchMatch && !isSelected ? '4 2' : undefined}
                  />
                ) : (
                  <text
                    x={GUTTER}
                    y={y + ROW_HEIGHT / 2}
                    dy="0.35em"
                    fontSize={11}
                    fill={isDark ? '#475569' : '#cbd5e1'}
                    style={{ pointerEvents: 'none' }}
                  >
                    —
                  </text>
                )}

                {/* wait-class cells on top of the base bar */}
                {Array.from(byBucket.entries()).map(([bucket, samples]) => {
                  const cellX = xScale((bucket - 1) * (timeline?.bucketIntervalSecs ?? 1));
                  const cellH = (ROW_HEIGHT - 8) / samples.length;
                  return samples.map((s, si) => (
                    <rect
                      key={`${bucket}-${si}`}
                      x={cellX}
                      y={y + 4 + si * cellH}
                      width={bucketW}
                      height={cellH}
                      fill={getWaitClassColor(s.waitClass)}
                      opacity={isFiltered ? 0.95 : 0.4}
                      onMouseEnter={(event) => {
                        event.stopPropagation();
                        showTooltip(
                          event,
                          node.objectName
                            ? `${node.operation} (${node.objectName})`
                            : node.operation,
                          [
                            `Wait: ${s.waitClass}${s.event ? ` — ${s.event}` : ''}`,
                            `Samples: ${s.count}`,
                          ]
                        );
                      }}
                      onMouseMove={(event) => {
                        event.stopPropagation();
                        moveTooltip(event);
                      }}
                    />
                  ));
                })}
              </g>
            );
          })}
        </svg>
      </div>

      {/* footer note */}
      <div className="absolute bottom-0 left-0 z-10 px-3 py-1 text-[11px] text-slate-400 dark:text-slate-500 bg-gradient-to-t from-white/90 dark:from-slate-950/90 to-transparent pointer-events-none">
        Bars = first → last active
        {timeline ? '; colored cells = ASH samples by wait class' : ''}
      </div>

      {tooltip && (
        <div
          className="absolute z-20 pointer-events-none bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-md shadow-lg px-3 py-2 text-xs text-gray-800 dark:text-gray-100"
          style={{ left: `${tooltip.x + 12}px`, top: `${tooltip.y + 12}px`, maxWidth: '280px' }}
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
