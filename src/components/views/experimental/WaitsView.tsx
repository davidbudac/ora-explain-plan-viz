import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { usePlan } from '../../../hooks/usePlanContext';
import { aggregateActivityByLine, getWaitClassColor } from '../../../lib/ash';
import { matchesSearch } from '../../../lib/filtering';
import { EmptyState } from './EmptyState';

interface Tooltip {
  x: number;
  y: number;
  title: string;
  lines: string[];
}

export function WaitsView() {
  const { parsedPlan, selectedNodeIds, selectNode, filteredNodeIds, nodeById, filters } = usePlan();

  const containerRef = useRef<HTMLDivElement>(null);
  const [tooltip, setTooltip] = useState<Tooltip | null>(null);
  const tooltipStateRef = useRef<Tooltip | null>(null);
  const pendingTooltipRef = useRef<Tooltip | null>(null);
  const rafRef = useRef<number | null>(null);

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

  const timeline = parsedPlan?.activityTimeline;
  const lineActivity = useMemo(
    () => (timeline ? aggregateActivityByLine(timeline) : []),
    [timeline]
  );

  const totalSamples = useMemo(
    () => lineActivity.reduce((sum, la) => sum + la.total, 0),
    [lineActivity]
  );
  const maxLineTotal = lineActivity.length > 0 ? lineActivity[0].total : 0;

  const classesPresent = useMemo(() => {
    const set = new Set<string>();
    for (const la of lineActivity) for (const c of la.byClass) set.add(c.waitClass);
    return Array.from(set);
  }, [lineActivity]);

  const moveTooltip = (event: React.MouseEvent) => {
    const containerRect = containerRef.current?.getBoundingClientRect();
    const base = tooltipStateRef.current;
    if (!base) return;
    scheduleTooltipUpdate({
      ...base,
      x: event.clientX - (containerRect?.left ?? 0),
      y: event.clientY - (containerRect?.top ?? 0),
    });
  };
  const showTooltip = (event: React.MouseEvent, title: string, lines: string[]) => {
    const containerRect = containerRef.current?.getBoundingClientRect();
    scheduleTooltipUpdate({
      x: event.clientX - (containerRect?.left ?? 0),
      y: event.clientY - (containerRect?.top ?? 0),
      title,
      lines,
    });
  };

  if (!timeline || lineActivity.length === 0) {
    return (
      <EmptyState
        title="No wait event activity data"
        hint='Waits view needs ASH activity samples from a SQL Monitor report. Load a report with activity details (e.g. the "Window Sort Spill" example) to see it.'
      />
    );
  }

  return (
    <div ref={containerRef} className="relative w-full h-full overflow-auto">
      {/* Legend */}
      <div className="sticky top-0 z-10 flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2 bg-white/95 dark:bg-slate-950/95 border-b border-slate-100 dark:border-slate-800 text-[11px] text-slate-500 dark:text-slate-400">
        {classesPresent.map((wc) => (
          <span key={wc} className="inline-flex items-center gap-1">
            <span
              className="inline-block w-2.5 h-2.5 rounded-sm"
              style={{ backgroundColor: getWaitClassColor(wc) }}
            />
            {wc}
          </span>
        ))}
      </div>

      <div className="p-3 space-y-1">
        {lineActivity.map((la) => {
          const node = nodeById.get(la.line);
          const isFiltered = node ? filteredNodeIds.has(node.id) : true;
          const isSelected = selectedNodeIdSet.has(la.line);
          const isSearchMatch =
            node !== undefined && searchText.trim() !== '' && matchesSearch(node, searchText);
          const barShare = maxLineTotal > 0 ? la.total / maxLineTotal : 0;
          const pct = totalSamples > 0 ? (la.total / totalSamples) * 100 : 0;
          const labelText = node
            ? `#${la.line} ${node.operation}${node.objectName ? ` ${node.objectName}` : ''}`
            : `#${la.line}`;

          return (
            <div
              key={la.line}
              className={`flex items-center gap-2 rounded px-1 py-0.5 cursor-pointer ${
                isSelected ? 'bg-blue-50 dark:bg-blue-950/40 ring-1 ring-blue-400' : ''
              } ${isFiltered ? '' : 'opacity-40'}`}
              onClick={(event) =>
                selectNode(la.line, { additive: event.metaKey || event.ctrlKey })
              }
            >
              <div
                className={`w-[260px] shrink-0 truncate text-xs ${
                  isFiltered
                    ? 'text-slate-700 dark:text-slate-200'
                    : 'text-slate-400 dark:text-slate-500'
                } ${isSearchMatch ? 'underline decoration-dashed decoration-blue-400' : ''}`}
                title={labelText}
              >
                {labelText}
              </div>

              <div className="flex-1 min-w-0">
                <div
                  className="flex h-4 rounded-sm overflow-hidden"
                  style={{ width: `${Math.max(barShare * 100, la.total > 0 ? 2 : 0)}%` }}
                >
                  {la.byClass.map((c) => (
                    <div
                      key={c.waitClass}
                      style={{
                        width: `${(c.count / la.total) * 100}%`,
                        backgroundColor: getWaitClassColor(c.waitClass),
                      }}
                      onMouseEnter={(event) => {
                        event.stopPropagation();
                        showTooltip(event, `${c.waitClass} — ${c.count} sample${c.count === 1 ? '' : 's'}`, [
                          labelText,
                          ...(c.events.length > 0
                            ? c.events.map((e) => `${e.event}: ${e.count}`)
                            : ['(no event detail)']),
                        ]);
                      }}
                      onMouseMove={(event) => {
                        event.stopPropagation();
                        moveTooltip(event);
                      }}
                      onMouseLeave={() => scheduleTooltipUpdate(null)}
                    />
                  ))}
                </div>
              </div>

              <div className="w-[150px] shrink-0 text-right text-[11px] tabular-nums text-slate-500 dark:text-slate-400">
                {la.total} sample{la.total === 1 ? '' : 's'} ({pct.toFixed(0)}%)
              </div>
            </div>
          );
        })}
      </div>

      <div className="px-3 py-2 text-[11px] text-slate-400 dark:text-slate-500 border-t border-slate-100 dark:border-slate-800">
        {totalSamples} ASH sample{totalSamples === 1 ? '' : 's'} across {lineActivity.length}{' '}
        line{lineActivity.length === 1 ? '' : 's'}. 1 sample ≈ 1 second of DB time.
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
