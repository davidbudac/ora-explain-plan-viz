import React, { useEffect, useMemo, useState } from 'react';
import { usePlan } from '../../hooks/usePlanContext';
import {
  matchNodes,
  computeComparisonSummary,
  buildComparisonRows,
  rowHasVisibleChange,
  getMetricLabel,
  LOWER_IS_BETTER,
} from '../../lib/compare';
import type { NodeMatch, MatchType, CompareMetric, ComparisonRow, MetricDelta } from '../../lib/compare';
import { CompareMetricSelector } from '../CompareMetricSelector';
import { formatNumberShort, formatTimeShort } from '../../lib/format';

function formatMetricValue(value: number | undefined, metric: string): string {
  if (value === undefined) return '-';
  if (metric === 'actualTime' || metric === 'selfTime') return formatTimeShort(value) ?? '-';
  if (metric === 'tempSpace' || metric === 'memoryUsed') {
    if (value >= 1048576) return (value / 1048576).toFixed(1) + ' MB';
    if (value >= 1024) return (value / 1024).toFixed(1) + ' KB';
    return value + ' B';
  }
  return formatNumberShort(value) ?? '-';
}

/** Shared delta presentation for the table cell and the expanded panel. */
function formatDelta(delta: MetricDelta, metric: CompareMetric): { text: string; tone: 'neutral' | 'improvement' | 'regression' | 'none' } {
  if (delta.delta === undefined) return { text: '-', tone: 'none' };
  if (delta.delta === 0) return { text: '=', tone: 'neutral' };
  const lowerIsBetter = LOWER_IS_BETTER.has(metric);
  const isImprovement = lowerIsBetter ? delta.delta < 0 : delta.delta > 0;
  const sign = delta.delta > 0 ? '+' : '';
  const formatted = metric === 'actualTime' || metric === 'selfTime'
    ? `${delta.delta < 0 ? '-' : '+'}${formatTimeShort(Math.abs(delta.delta))}`
    : `${sign}${formatNumberShort(delta.delta)}`;
  const pct = delta.deltaPercent !== undefined && delta.deltaPercent !== 0
    ? ` (${delta.deltaPercent > 0 ? '+' : ''}${delta.deltaPercent.toFixed(0)}%)`
    : '';
  return { text: `${formatted}${pct}`, tone: isImprovement ? 'improvement' : 'regression' };
}

const DELTA_TONE_CLASS: Record<string, string> = {
  none: 'text-neutral-400 dark:text-neutral-500',
  neutral: 'text-neutral-500 dark:text-neutral-400',
  improvement: 'text-green-600 dark:text-green-400 font-medium',
  regression: 'text-red-600 dark:text-red-400 font-medium',
};

function DeltaCell({ delta, metric }: { delta: MetricDelta | undefined; metric: CompareMetric }) {
  const formatted = delta ? formatDelta(delta, metric) : { text: '-', tone: 'none' as const };
  return (
    <td className={`px-2 py-1.5 text-center text-xs ${DELTA_TONE_CLASS[formatted.tone]}`}>
      {formatted.text}
    </td>
  );
}

function MatchIcon({ type }: { type: MatchType }) {
  const colors: Record<MatchType, string> = {
    'exact-id': 'bg-green-500',
    'heuristic': 'bg-yellow-500',
    'unmatched': 'bg-neutral-400 dark:bg-neutral-500',
  };
  const titles: Record<MatchType, string> = {
    'exact-id': 'Exact ID match',
    'heuristic': 'Heuristic match (operation + object)',
    'unmatched': 'No match in other plan',
  };
  return (
    <span
      className={`inline-block w-2 h-2 rounded-full ${colors[type]}`}
      title={titles[type]}
    />
  );
}

function SummaryCard({ label, plan, cost, time, nodeCount, phv }: {
  label: string;
  plan: 'A' | 'B';
  cost: number;
  time?: number;
  nodeCount: number;
  phv?: string;
}) {
  const styles = plan === 'A'
    ? {
        panel: 'border-blue-200 dark:border-blue-800 bg-blue-50/50 dark:bg-blue-950/30',
        label: 'text-blue-600 dark:text-blue-400',
      }
    : {
        panel: 'border-violet-200 dark:border-violet-800 bg-violet-50/50 dark:bg-violet-950/30',
        label: 'text-violet-600 dark:text-violet-400',
      };
  return (
    <div className={`flex-1 rounded-lg border p-3 ${styles.panel}`}>
      <div className="flex items-center gap-2 mb-2">
        <span className={`text-xs font-bold ${styles.label}`}>{label}</span>
        {phv && <span className="text-[10px] font-mono text-neutral-500 dark:text-neutral-400">PHV: {phv}</span>}
      </div>
      <div className="grid grid-cols-3 gap-2 text-xs">
        <div>
          <div className="text-neutral-500 dark:text-neutral-400">Cost</div>
          <div className="font-semibold text-neutral-800 dark:text-neutral-200">{formatNumberShort(cost)}</div>
        </div>
        {time !== undefined && (
          <div>
            <div className="text-neutral-500 dark:text-neutral-400">A-Time</div>
            <div className="font-semibold text-neutral-800 dark:text-neutral-200">{formatTimeShort(time)}</div>
          </div>
        )}
        <div>
          <div className="text-neutral-500 dark:text-neutral-400">Nodes</div>
          <div className="font-semibold text-neutral-800 dark:text-neutral-200">{nodeCount}</div>
        </div>
      </div>
    </div>
  );
}

function DeltaArrow({ delta, deltaPercent, label, lowerIsBetter = true }: {
  delta: number;
  deltaPercent: number;
  label: string;
  lowerIsBetter?: boolean;
}) {
  const isImprovement = lowerIsBetter ? delta < 0 : delta > 0;
  const color = delta === 0
    ? 'text-neutral-500'
    : isImprovement
      ? 'text-green-600 dark:text-green-400'
      : 'text-red-600 dark:text-red-400';

  return (
    <div className={`flex flex-col items-center text-xs ${color}`}>
      <span className="text-[10px] text-neutral-500 dark:text-neutral-400">{label}</span>
      <span className="font-bold">
        {delta === 0 ? '=' : delta > 0 ? '+' : ''}{deltaPercent.toFixed(1)}%
      </span>
      {delta !== 0 && (
        <svg className={`w-4 h-4 ${delta > 0 ? '' : 'rotate-180'}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 15l7-7 7 7" />
        </svg>
      )}
    </div>
  );
}

/** Inline detail shown when a comparison row is expanded in place. */
function ExpandedRowDetail({ row, labelA, labelB, onViewInTree }: {
  row: ComparisonRow;
  labelA: string;
  labelB: string;
  onViewInTree: (plan: 'A' | 'B') => void;
}) {
  const { planANode: nodeA, planBNode: nodeB } = row.match;
  const metricsWithValues = (Object.keys(row.deltas) as CompareMetric[]).filter((metric) => {
    const d = row.deltas[metric];
    return d && (d.valueA !== undefined || d.valueB !== undefined);
  });
  const predicatesChanged = (kind: 'accessPredicates' | 'filterPredicates') =>
    (nodeA?.[kind] ?? null) !== (nodeB?.[kind] ?? null);
  const hasPredicates = !!(nodeA?.accessPredicates || nodeA?.filterPredicates || nodeB?.accessPredicates || nodeB?.filterPredicates);

  const nodeCard = (plan: 'A' | 'B', node: typeof nodeA, label: string) => {
    const styles = plan === 'A'
      ? 'border-blue-200 dark:border-blue-800 bg-blue-50/50 dark:bg-blue-950/30'
      : 'border-violet-200 dark:border-violet-800 bg-violet-50/50 dark:bg-violet-950/30';
    const labelStyle = plan === 'A' ? 'text-blue-600 dark:text-blue-400' : 'text-violet-600 dark:text-violet-400';
    return (
      <div className={`flex-1 rounded-lg border p-2.5 ${styles}`}>
        <div className={`text-[10px] font-bold uppercase tracking-wider mb-1.5 ${labelStyle}`}>{label}</div>
        {node ? (
          <div className="space-y-0.5 text-xs text-neutral-700 dark:text-neutral-300">
            <div><span className="text-neutral-400 dark:text-neutral-500">#{node.id}</span> <span className="font-semibold">{node.operation}</span></div>
            {node.objectName && <div className="font-mono text-[11px]">{node.objectName}</div>}
            <div className="text-[10px] text-neutral-500 dark:text-neutral-400">
              depth {node.depth}{node.queryBlock ? ` · ${node.queryBlock}` : ''}
            </div>
          </div>
        ) : (
          <div className="text-xs italic text-neutral-400 dark:text-neutral-500">Not present in this plan</div>
        )}
      </div>
    );
  };

  return (
    <div className="p-3 space-y-3">
      <div className="flex gap-3">
        {nodeCard('A', nodeA, labelA)}
        {nodeCard('B', nodeB, labelB)}
      </div>

      {metricsWithValues.length > 0 && (
        <div className="rounded-lg border border-neutral-200 dark:border-neutral-700 overflow-hidden">
          <table className="w-full text-xs">
            <thead>
              <tr className="bg-neutral-100 dark:bg-neutral-800/80 text-neutral-500 dark:text-neutral-400">
                <th className="px-2 py-1 text-left font-medium">Metric</th>
                <th className="px-2 py-1 text-center font-medium text-blue-600 dark:text-blue-400">A</th>
                <th className="px-2 py-1 text-center font-medium text-violet-600 dark:text-violet-400">B</th>
                <th className="px-2 py-1 text-center font-medium">Delta</th>
              </tr>
            </thead>
            <tbody>
              {metricsWithValues.map((metric) => {
                const delta = row.deltas[metric]!;
                const formatted = formatDelta(delta, metric);
                return (
                  <tr key={metric} className="border-t border-neutral-100 dark:border-neutral-800">
                    <td className="px-2 py-1 text-neutral-600 dark:text-neutral-400">{getMetricLabel(metric)}</td>
                    <td className="px-2 py-1 text-center text-neutral-700 dark:text-neutral-300">{formatMetricValue(delta.valueA, metric)}</td>
                    <td className="px-2 py-1 text-center text-neutral-700 dark:text-neutral-300">{formatMetricValue(delta.valueB, metric)}</td>
                    <td className={`px-2 py-1 text-center ${DELTA_TONE_CLASS[formatted.tone]}`}>{formatted.text}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {hasPredicates && (
        <div className="grid grid-cols-2 gap-3">
          {(['accessPredicates', 'filterPredicates'] as const).map((kind) => {
            const anyValue = nodeA?.[kind] || nodeB?.[kind];
            if (!anyValue) return null;
            const changed = predicatesChanged(kind);
            return (
              <div key={kind} className="col-span-2">
                <div className="flex items-center gap-2 mb-1">
                  <span className="text-[10px] font-bold uppercase tracking-wider text-neutral-500 dark:text-neutral-400">
                    {kind === 'accessPredicates' ? 'Access predicates' : 'Filter predicates'}
                  </span>
                  {changed && (
                    <span className="px-1.5 py-0.5 text-[9px] font-bold rounded bg-amber-500/10 text-amber-600 dark:text-amber-400 border border-amber-500/20 uppercase">
                      changed
                    </span>
                  )}
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <code className="block text-[11px] bg-neutral-100 dark:bg-neutral-900 p-2 rounded border border-neutral-200 dark:border-neutral-700 whitespace-pre-wrap break-words text-neutral-700 dark:text-neutral-300 min-h-[2rem]">
                    {nodeA?.[kind] ?? <span className="italic text-neutral-400">—</span>}
                  </code>
                  <code className="block text-[11px] bg-neutral-100 dark:bg-neutral-900 p-2 rounded border border-neutral-200 dark:border-neutral-700 whitespace-pre-wrap break-words text-neutral-700 dark:text-neutral-300 min-h-[2rem]">
                    {nodeB?.[kind] ?? <span className="italic text-neutral-400">—</span>}
                  </code>
                </div>
              </div>
            );
          })}
        </div>
      )}

      <div className="flex gap-2">
        <button
          type="button"
          disabled={!nodeA}
          onClick={(e) => { e.stopPropagation(); onViewInTree('A'); }}
          className="px-2.5 py-1 text-[11px] font-semibold rounded border border-blue-300 dark:border-blue-700 text-blue-700 dark:text-blue-300 bg-blue-50 dark:bg-blue-950/40 hover:bg-blue-100 dark:hover:bg-blue-900/50 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
        >
          View A in tree
        </button>
        <button
          type="button"
          disabled={!nodeB}
          onClick={(e) => { e.stopPropagation(); onViewInTree('B'); }}
          className="px-2.5 py-1 text-[11px] font-semibold rounded border border-violet-300 dark:border-violet-700 text-violet-700 dark:text-violet-300 bg-violet-50 dark:bg-violet-950/40 hover:bg-violet-100 dark:hover:bg-violet-900/50 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
        >
          View B in tree
        </button>
      </div>
    </div>
  );
}

type SortState = { metric: CompareMetric; direction: 'desc' | 'asc' } | null;

export function CompareView() {
  const { plans, compareMetrics, comparePlanIndices, setActivePlan, selectNodeForPlan, setTreeCompareEnabled, setViewMode, applyMetadataToAllSlots } = usePlan();

  const [leftIndex, rightIndex] = comparePlanIndices;
  const planA = plans[leftIndex]?.parsedPlan;
  const planB = plans[rightIndex]?.parsedPlan;
  const slotA = plans[leftIndex];
  const slotB = plans[rightIndex];

  // Session-only view state
  const [sort, setSort] = useState<SortState>(null);
  const [showChangedOnly, setShowChangedOnly] = useState(false);
  const [expandedKey, setExpandedKey] = useState<string | null>(null);

  const sharedBundleCandidate = useMemo(() => {
    if (!slotA?.parsedPlan || !slotB?.parsedPlan) return null;
    const sqlA = slotA.parsedPlan.sqlId;
    const sqlB = slotB.parsedPlan.sqlId;
    if (!sqlA || !sqlB || sqlA !== sqlB) return null;
    const aHas = !!slotA.metadataBundle;
    const bHas = !!slotB.metadataBundle;
    if (aHas === bHas) return null;
    return aHas
      ? { sourceIndex: leftIndex, targetIndex: rightIndex, bundle: slotA.metadataBundle! }
      : { sourceIndex: rightIndex, targetIndex: leftIndex, bundle: slotB.metadataBundle! };
  }, [slotA, slotB, leftIndex, rightIndex]);

  const { matches, summary } = useMemo(() => {
    if (!planA || !planB) return { matches: [] as NodeMatch[], summary: null };
    const m = matchNodes(planA, planB);
    const s = computeComparisonSummary(planA, planB, m);
    return { matches: m, summary: s };
  }, [planA, planB]);

  const rows = useMemo(() => buildComparisonRows(matches), [matches]);

  // Ignore the sort if its metric was deselected from the visible set
  const effectiveSort = sort && compareMetrics.includes(sort.metric) ? sort : null;

  const visibleRows = useMemo(() => {
    let result = showChangedOnly
      ? rows.filter((row) => rowHasVisibleChange(row, compareMetrics))
      : rows;
    if (effectiveSort) {
      const { metric, direction } = effectiveSort;
      result = [...result].sort((a, b) => {
        const da = a.deltas[metric]?.delta;
        const db = b.deltas[metric]?.delta;
        // Undefined deltas sink to the bottom regardless of direction
        if (da === undefined && db === undefined) return a.originalIndex - b.originalIndex;
        if (da === undefined) return 1;
        if (db === undefined) return -1;
        // Sort by |delta|: "biggest change first" regardless of sign
        const diff = Math.abs(db) - Math.abs(da);
        const signed = direction === 'desc' ? diff : -diff;
        return signed !== 0 ? signed : a.originalIndex - b.originalIndex;
      });
    }
    return result;
  }, [rows, showChangedOnly, compareMetrics, effectiveSort]);

  // Ignore the expansion if its row is filtered/sorted out of view
  const effectiveExpandedKey =
    expandedKey !== null && visibleRows.some((row) => row.key === expandedKey) ? expandedKey : null;

  // Escape closes the expanded row (keyboard parity with other views)
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || effectiveExpandedKey === null) return;
      const tag = (event.target as HTMLElement)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      event.preventDefault();
      setExpandedKey(null);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [effectiveExpandedKey]);

  if (!planA || !planB || !summary) {
    return (
      <div className="flex-1 flex items-center justify-center text-neutral-500 dark:text-neutral-400 p-8">
        <p>Both plans must be loaded to compare.</p>
      </div>
    );
  }

  const labelA = plans[leftIndex]?.customLabel || plans[leftIndex]?.label || 'Plan A';
  const labelB = plans[rightIndex]?.customLabel || plans[rightIndex]?.label || 'Plan B';

  const handleViewInTree = (match: NodeMatch, plan: 'A' | 'B') => {
    const node = plan === 'A' ? match.planANode : match.planBNode;
    const index = plan === 'A' ? leftIndex : rightIndex;
    if (!node) return;
    setActivePlan(index);
    selectNodeForPlan(index, node.id);
    setTreeCompareEnabled(false);
    setViewMode('hierarchical');
  };

  const toggleExpanded = (key: string) => {
    setExpandedKey((current) => (current === key ? null : key));
  };

  const cycleSort = (metric: CompareMetric) => {
    setSort((current) => {
      if (!current || current.metric !== metric) return { metric, direction: 'desc' };
      if (current.direction === 'desc') return { metric, direction: 'asc' };
      return null;
    });
  };

  const totalColumns = 5 + compareMetrics.length * 3;

  return (
    <div className="flex-1 flex flex-col min-h-0 overflow-auto bg-neutral-50 dark:bg-neutral-950 p-4 gap-4">
      {/* Summary header */}
      <div className="flex items-center gap-3">
        <SummaryCard
          label={labelA}
          plan="A"
          cost={summary.totalCostA}
          time={summary.totalElapsedTimeA}
          nodeCount={planA.allNodes.length}
          phv={planA.planHashValue}
        />
        <div className="flex flex-col items-center gap-1 px-2">
          <DeltaArrow delta={summary.costDelta} deltaPercent={summary.costDeltaPercent} label="Cost" />
          {summary.timeDelta !== undefined && summary.timeDeltaPercent !== undefined && (
            <DeltaArrow delta={summary.timeDelta} deltaPercent={summary.timeDeltaPercent} label="Time" />
          )}
        </div>
        <SummaryCard
          label={labelB}
          plan="B"
          cost={summary.totalCostB}
          time={summary.totalElapsedTimeB}
          nodeCount={planB.allNodes.length}
          phv={planB.planHashValue}
        />
      </div>

      {/* Apply-metadata-to-both affordance */}
      {sharedBundleCandidate && (
        <div className="flex items-start gap-3 p-2 rounded border border-indigo-200 dark:border-indigo-800 bg-indigo-50/60 dark:bg-indigo-950/40 text-[11px] text-indigo-800 dark:text-indigo-200">
          <span className="leading-snug">
            Both plans share SQL_ID <code className="font-mono">{slotA?.parsedPlan?.sqlId}</code>.
            A metadata bundle is loaded for plan{' '}
            <span className="font-semibold">
              {sharedBundleCandidate.sourceIndex === leftIndex ? 'A' : 'B'}
            </span>
            {' '}only — apply it to plan{' '}
            <span className="font-semibold">
              {sharedBundleCandidate.targetIndex === leftIndex ? 'A' : 'B'}
            </span>{' '}too?
          </span>
          <button
            type="button"
            onClick={() => applyMetadataToAllSlots(sharedBundleCandidate.bundle)}
            className="ml-auto whitespace-nowrap px-2 py-1 rounded border border-indigo-300 dark:border-indigo-700 bg-white dark:bg-neutral-900 hover:bg-indigo-100 dark:hover:bg-indigo-900/60"
          >
            Apply to both
          </button>
        </div>
      )}

      {/* Match stats + changed-only filter */}
      <div className="flex items-center gap-4 text-xs text-neutral-600 dark:text-neutral-400">
        <span className="flex items-center gap-1">
          <MatchIcon type="exact-id" />
          {summary.matchedCount - matches.filter(m => m.matchType === 'heuristic').length} exact
        </span>
        <span className="flex items-center gap-1">
          <MatchIcon type="heuristic" />
          {matches.filter(m => m.matchType === 'heuristic').length} heuristic
        </span>
        <span className="flex items-center gap-1">
          <MatchIcon type="unmatched" />
          {summary.unmatchedACount + summary.unmatchedBCount} unmatched
        </span>
        <button
          type="button"
          role="switch"
          aria-checked={showChangedOnly}
          onClick={() => setShowChangedOnly((v) => !v)}
          title="Compares only the currently selected metrics"
          className={`ml-auto px-2.5 py-1 rounded-full border text-[11px] font-semibold transition-colors ${
            showChangedOnly
              ? 'bg-blue-600 text-white border-blue-600 shadow-sm'
              : 'bg-white dark:bg-neutral-800 border-neutral-200 dark:border-neutral-700 text-neutral-600 dark:text-neutral-300 hover:bg-neutral-100 dark:hover:bg-neutral-700'
          }`}
        >
          Changed rows only ({visibleRows.length}/{rows.length})
        </button>
      </div>

      {/* Metric selector */}
      <CompareMetricSelector />

      {/* Comparison table */}
      <div className="rounded-lg border border-neutral-200 dark:border-neutral-700 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="bg-neutral-100 dark:bg-neutral-800/80 border-b border-neutral-200 dark:border-neutral-700">
                <th className="px-2 py-2 text-left font-semibold text-neutral-600 dark:text-neutral-400 w-6" />
                <th className="px-2 py-2 text-left font-semibold text-neutral-600 dark:text-neutral-400 w-10">ID(A)</th>
                <th className="px-2 py-2 text-left font-semibold text-neutral-600 dark:text-neutral-400 w-10">ID(B)</th>
                <th className="px-2 py-2 text-left font-semibold text-neutral-600 dark:text-neutral-400">Operation</th>
                <th className="px-2 py-2 text-left font-semibold text-neutral-600 dark:text-neutral-400">Object</th>
                {compareMetrics.map(metric => {
                  const active = effectiveSort?.metric === metric;
                  const ariaSort = active ? (effectiveSort!.direction === 'desc' ? 'descending' : 'ascending') : 'none';
                  return (
                    <th
                      key={`header-${metric}`}
                      colSpan={3}
                      aria-sort={ariaSort}
                      className="border-l border-neutral-200 dark:border-neutral-700 p-0"
                    >
                      <button
                        type="button"
                        onClick={() => cycleSort(metric)}
                        title={`Sort by ${getMetricLabel(metric)} delta (largest change first)`}
                        className={`w-full px-2 py-2 text-center font-semibold transition-colors hover:bg-neutral-200/60 dark:hover:bg-neutral-700/60 ${
                          active ? 'text-blue-600 dark:text-blue-400' : 'text-neutral-600 dark:text-neutral-400'
                        }`}
                      >
                        {getMetricLabel(metric)}
                        {active && <span className="ml-1">{effectiveSort!.direction === 'desc' ? '↓' : '↑'}</span>}
                      </button>
                    </th>
                  );
                })}
              </tr>
              <tr className="bg-neutral-50 dark:bg-neutral-800/40 border-b border-neutral-200 dark:border-neutral-700">
                <th colSpan={5} />
                {compareMetrics.map(metric => (
                  <React.Fragment key={`subheader-${metric}`}>
                    <th className="px-2 py-1 text-center text-[10px] font-medium text-blue-600 dark:text-blue-400 border-l border-neutral-200 dark:border-neutral-700">A</th>
                    <th className="px-2 py-1 text-center text-[10px] font-medium text-violet-600 dark:text-violet-400">B</th>
                    <th className="px-2 py-1 text-center text-[10px] font-medium text-neutral-500 dark:text-neutral-400">Delta</th>
                  </React.Fragment>
                ))}
              </tr>
            </thead>
            <tbody>
              {visibleRows.map((row) => {
                const { planANode: nodeA, planBNode: nodeB } = row.match;
                const operation = nodeA?.operation ?? nodeB?.operation ?? '';
                const objectName = nodeA?.objectName ?? nodeB?.objectName ?? '';
                const isExpanded = effectiveExpandedKey === row.key;
                return (
                  <React.Fragment key={row.key}>
                    <tr
                      onClick={() => toggleExpanded(row.key)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault();
                          toggleExpanded(row.key);
                        }
                      }}
                      tabIndex={0}
                      aria-expanded={isExpanded}
                      aria-controls={isExpanded ? `compare-detail-${row.key}` : undefined}
                      className={`border-b border-neutral-100 dark:border-neutral-800 cursor-pointer transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/60 ${
                        isExpanded
                          ? 'bg-blue-50/60 dark:bg-blue-950/25'
                          : 'hover:bg-neutral-100 dark:hover:bg-neutral-800/60'
                      }`}
                    >
                      <td className="px-2 py-1.5 text-center">
                        <MatchIcon type={row.match.matchType} />
                      </td>
                      <td className="px-2 py-1.5 font-mono text-neutral-600 dark:text-neutral-400">
                        {nodeA?.id ?? '-'}
                      </td>
                      <td className="px-2 py-1.5 font-mono text-neutral-600 dark:text-neutral-400">
                        {nodeB?.id ?? '-'}
                      </td>
                      <td className="px-2 py-1.5 font-medium text-neutral-800 dark:text-neutral-200 whitespace-nowrap">
                        <span className={`inline-block mr-1 text-neutral-400 dark:text-neutral-500 transition-transform ${isExpanded ? 'rotate-90' : ''}`}>▸</span>
                        {operation}
                      </td>
                      <td className="px-2 py-1.5 text-neutral-600 dark:text-neutral-400 whitespace-nowrap">
                        {objectName}
                      </td>
                      {compareMetrics.map(metric => {
                        const delta = row.deltas[metric];
                        return (
                          <React.Fragment key={`${row.key}-${metric}`}>
                            <td className="px-2 py-1.5 text-center text-neutral-700 dark:text-neutral-300 border-l border-neutral-100 dark:border-neutral-800">
                              {formatMetricValue(delta?.valueA, metric)}
                            </td>
                            <td className="px-2 py-1.5 text-center text-neutral-700 dark:text-neutral-300">
                              {formatMetricValue(delta?.valueB, metric)}
                            </td>
                            <DeltaCell delta={delta} metric={metric} />
                          </React.Fragment>
                        );
                      })}
                    </tr>
                    {isExpanded && (
                      <tr id={`compare-detail-${row.key}`} className="border-b border-neutral-200 dark:border-neutral-700 bg-neutral-50/80 dark:bg-neutral-900/60">
                        <td colSpan={totalColumns}>
                          <ExpandedRowDetail
                            row={row}
                            labelA={labelA}
                            labelB={labelB}
                            onViewInTree={(plan) => handleViewInTree(row.match, plan)}
                          />
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                );
              })}
              {visibleRows.length === 0 && (
                <tr>
                  <td colSpan={totalColumns} className="px-4 py-6 text-center text-neutral-500 dark:text-neutral-400">
                    No rows differ in the selected metrics.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
