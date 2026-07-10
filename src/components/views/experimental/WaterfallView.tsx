import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { usePlan } from '../../../hooks/usePlanContext';
import { COLOR_SCHEME_PALETTES, getOperationCategory } from '../../../lib/types';
import { computeRowFlow } from '../../../lib/rowFlow';
import type { RowFlowEntry } from '../../../lib/rowFlow';
import { formatNumberShort } from '../../../lib/format';
import { matchesSearch } from '../../../lib/filtering';

interface Tooltip {
  x: number;
  y: number;
  title: string;
  lines: string[];
}

function factorLabel(entry: RowFlowEntry): { text: string; tone: 'amber' | 'red' } | null {
  if (entry.factor === undefined) return null;
  if (entry.factor < 0.1) {
    return { text: `▼ ${Math.round(1 / entry.factor)}× filter`, tone: 'amber' };
  }
  if (entry.factor > 10) {
    return { text: `▲ ${Math.round(entry.factor)}× blow-up`, tone: 'red' };
  }
  return null;
}

export function WaterfallView() {
  const { parsedPlan, selectedNodeIds, selectNode, filteredNodeIds, colorScheme, filters } =
    usePlan();

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

  const flow = useMemo(() => (parsedPlan ? computeRowFlow(parsedPlan) : null), [parsedPlan]);
  const maxOutput = useMemo(
    () => (flow ? flow.entries.reduce((m, e) => Math.max(m, e.output), 0) : 0),
    [flow]
  );

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
    const base = tooltipStateRef.current;
    if (!base) return;
    const containerRect = containerRef.current?.getBoundingClientRect();
    scheduleTooltipUpdate({
      ...base,
      x: event.clientX - (containerRect?.left ?? 0),
      y: event.clientY - (containerRect?.top ?? 0),
    });
  };

  if (!parsedPlan?.rootNode || !flow) {
    return (
      <div className="h-full flex items-center justify-center text-sm text-slate-400 dark:text-slate-500">
        No execution plan to display. Parse a plan to see the row-flow waterfall.
      </div>
    );
  }

  const wasted = flow.leafRowsRead - flow.rootRowsReturned;
  const wastedPct = flow.leafRowsRead > 0 ? (wasted / flow.leafRowsRead) * 100 : 0;
  const palette = COLOR_SCHEME_PALETTES[colorScheme];
  const logMax = Math.log10(maxOutput + 1) || 1;

  return (
    <div ref={containerRef} className="relative w-full h-full overflow-auto">
      {/* Header banner */}
      <div className="sticky top-0 z-10 px-3 py-2.5 bg-white/95 dark:bg-slate-950/95 border-b border-slate-100 dark:border-slate-800">
        <div className="rounded-md border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 px-3 py-2">
          <div className="text-sm text-slate-700 dark:text-slate-200">
            {!flow.hasActuals && (
              <span className="font-semibold text-slate-500 dark:text-slate-400">Estimated: </span>
            )}
            Read{' '}
            <span className="font-semibold tabular-nums">
              {formatNumberShort(flow.leafRowsRead, { empty: '0' })}
            </span>{' '}
            rows at the leaves →{' '}
            <span className="font-semibold tabular-nums">
              {formatNumberShort(flow.rootRowsReturned, { empty: '0' })}
            </span>{' '}
            returned
          </div>
          <div className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
            {wastedPct > 0
              ? `${wastedPct.toFixed(0)}% of rows read never reached the client`
              : 'Every row read reached the client'}
          </div>
        </div>
      </div>

      <div className="p-3 space-y-0.5">
        {flow.entries.map((entry) => {
          const node = entry.node;
          const isFiltered = filteredNodeIds.has(node.id);
          const isSelected = selectedNodeIdSet.has(node.id);
          const isSearchMatch = searchText.trim() !== '' && matchesSearch(node, searchText);
          const category = getOperationCategory(node.operation);
          const catColor = palette[category] || '#6b7280';
          const barShare = (Math.log10(entry.output + 1) / logMax) * 100;
          const chip = factorLabel(entry);
          const showEst = entry.outputIsEstimate && flow.hasActuals;

          return (
            <div
              key={node.id}
              className={`flex items-center gap-2 rounded px-1 py-0.5 cursor-pointer ${
                isSelected ? 'bg-blue-50 dark:bg-blue-950/40 ring-1 ring-blue-400' : ''
              } ${isFiltered ? '' : 'opacity-40'}`}
              onClick={(event) =>
                selectNode(node.id, { additive: event.metaKey || event.ctrlKey })
              }
              onMouseEnter={(event) =>
                showTooltip(
                  event,
                  node.objectName ? `${node.operation} (${node.objectName})` : node.operation,
                  [
                    `Input rows: ${formatNumberShort(entry.input, { empty: '—' })}`,
                    `Output rows: ${formatNumberShort(entry.output, { empty: '0' })}`,
                    entry.factor !== undefined
                      ? `Factor: ${entry.factor >= 1 ? `${entry.factor.toFixed(1)}×` : `${(1 / entry.factor).toFixed(1)}× smaller`}`
                      : 'Factor: —',
                    `Kind: ${entry.kind}`,
                  ]
                )
              }
              onMouseMove={moveTooltip}
              onMouseLeave={() => scheduleTooltipUpdate(null)}
            >
              <div
                className={`w-[230px] shrink-0 truncate text-xs ${
                  isFiltered
                    ? 'text-slate-700 dark:text-slate-200'
                    : 'text-slate-400 dark:text-slate-500'
                } ${isSearchMatch ? 'underline decoration-dashed decoration-blue-400' : ''}`}
                style={{ paddingLeft: `${node.depth * 12}px` }}
                title={`${node.operation}${node.objectName ? ` ${node.objectName}` : ''}`}
              >
                {node.operation}
                {node.objectName ? ` ${node.objectName}` : ''}
              </div>

              <div className="flex-1 min-w-0">
                <div
                  className="h-4 rounded-sm"
                  style={{
                    width: `${Math.max(barShare, entry.output > 0 ? 1.5 : 0)}%`,
                    backgroundColor: catColor,
                    outline: isSearchMatch && !isSelected ? '1.5px dashed #3b82f6' : undefined,
                  }}
                />
              </div>

              {chip && (
                <span
                  className={`shrink-0 text-[10px] font-semibold px-1.5 py-0.5 rounded ${
                    chip.tone === 'amber'
                      ? 'bg-amber-100 text-amber-700 dark:bg-amber-950/50 dark:text-amber-400'
                      : 'bg-red-100 text-red-700 dark:bg-red-950/50 dark:text-red-400'
                  }`}
                >
                  {chip.text}
                </span>
              )}

              <div className="w-[90px] shrink-0 text-right text-[11px] tabular-nums text-slate-600 dark:text-slate-300">
                {formatNumberShort(entry.output, { empty: '0' })}
                {showEst && (
                  <span className="ml-1 text-[9px] uppercase text-slate-400 dark:text-slate-500">
                    est
                  </span>
                )}
              </div>
            </div>
          );
        })}
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
