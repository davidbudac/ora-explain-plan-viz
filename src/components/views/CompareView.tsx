import React, { useMemo } from 'react';
import { usePlan } from '../../hooks/usePlanContext';
import { matchNodes, computeComparisonSummary, getNodeMetricValue, getMetricLabel } from '../../lib/compare';
import type { NodeMatch, MatchType } from '../../lib/compare';
import { CompareMetricSelector } from '../CompareMetricSelector';
import { formatNumberShort, formatTimeShort } from '../../lib/format';

function formatMetricValue(value: number | undefined, metric: string): string {
  if (value === undefined) return '-';
  if (metric === 'actualTime') return formatTimeShort(value) ?? '-';
  if (metric === 'tempSpace' || metric === 'memoryUsed') {
    if (value >= 1048576) return (value / 1048576).toFixed(1) + ' MB';
    if (value >= 1024) return (value / 1024).toFixed(1) + ' KB';
    return value + ' B';
  }
  return formatNumberShort(value) ?? '-';
}

function DeltaCell({ valueA, valueB, metric }: { valueA?: number; valueB?: number; metric: string }) {
  if (valueA === undefined || valueB === undefined) {
    return <td className="px-2 py-1.5 text-center text-neutral-400 dark:text-neutral-500 text-xs">-</td>;
  }
  const delta = valueB - valueA;
  if (delta === 0) {
    return <td className="px-2 py-1.5 text-center text-neutral-500 dark:text-neutral-400 text-xs">=</td>;
  }
  // For cost and time, lower is better (negative delta = improvement)
  const lowerIsBetter = ['cost', 'actualTime', 'tempSpace'].includes(metric);
  const isImprovement = lowerIsBetter ? delta < 0 : delta > 0;

  const pct = valueA > 0 ? ((delta / valueA) * 100) : 0;
  const sign = delta > 0 ? '+' : '';
  const formatted = metric === 'actualTime'
    ? `${sign}${formatTimeShort(Math.abs(delta))}`
    : `${sign}${formatNumberShort(delta)}`;

  return (
    <td className={`px-2 py-1.5 text-center text-xs font-medium ${
      isImprovement
        ? 'text-green-600 dark:text-green-400'
        : 'text-red-600 dark:text-red-400'
    }`}>
      <span>{formatted}</span>
      {pct !== 0 && <span className="text-[10px] ml-0.5 opacity-70">({pct > 0 ? '+' : ''}{pct.toFixed(0)}%)</span>}
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
  const color = plan === 'A' ? 'blue' : 'violet';
  return (
    <div className={`flex-1 rounded-lg border border-${color}-200 dark:border-${color}-800 bg-${color}-50/50 dark:bg-${color}-950/30 p-3`}>
      <div className="flex items-center gap-2 mb-2">
        <span className={`text-xs font-bold text-${color}-600 dark:text-${color}-400`}>{label}</span>
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

export function CompareView() {
  const { plans, compareMetrics, setActivePlan, selectNode, setViewMode } = usePlan();

  const planA = plans[0]?.parsedPlan;
  const planB = plans[1]?.parsedPlan;

  const { matches, summary } = useMemo(() => {
    if (!planA || !planB) return { matches: [] as NodeMatch[], summary: null };
    const m = matchNodes(planA, planB);
    const s = computeComparisonSummary(planA, planB, m);
    return { matches: m, summary: s };
  }, [planA, planB]);

  if (!planA || !planB || !summary) {
    return (
      <div className="flex-1 flex items-center justify-center text-neutral-500 dark:text-neutral-400 p-8">
        <p>Both plans must be loaded to compare.</p>
      </div>
    );
  }

  const handleRowClick = (match: NodeMatch) => {
    if (match.planANode) {
      setActivePlan(0);
      selectNode(match.planANode.id);
    } else if (match.planBNode) {
      setActivePlan(1);
      selectNode(match.planBNode.id);
    }
    setViewMode('hierarchical');
  };

  return (
    <div className="flex-1 flex flex-col min-h-0 overflow-auto bg-neutral-50 dark:bg-neutral-950 p-4 gap-4">
      {/* Summary header */}
      <div className="flex items-center gap-3">
        <SummaryCard
          label="Plan A"
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
          label="Plan B"
          plan="B"
          cost={summary.totalCostB}
          time={summary.totalElapsedTimeB}
          nodeCount={planB.allNodes.length}
          phv={planB.planHashValue}
        />
      </div>

      {/* Match stats */}
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
                {compareMetrics.map(metric => (
                  <th key={`header-${metric}`} colSpan={3} className="px-2 py-2 text-center font-semibold text-neutral-600 dark:text-neutral-400 border-l border-neutral-200 dark:border-neutral-700">
                    {getMetricLabel(metric)}
                  </th>
                ))}
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
              {matches.map((match, i) => {
                const nodeA = match.planANode;
                const nodeB = match.planBNode;
                const operation = nodeA?.operation ?? nodeB?.operation ?? '';
                const objectName = nodeA?.objectName ?? nodeB?.objectName ?? '';
                return (
                  <tr
                    key={i}
                    onClick={() => handleRowClick(match)}
                    className="border-b border-neutral-100 dark:border-neutral-800 hover:bg-neutral-100 dark:hover:bg-neutral-800/60 cursor-pointer transition-colors"
                  >
                    <td className="px-2 py-1.5 text-center">
                      <MatchIcon type={match.matchType} />
                    </td>
                    <td className="px-2 py-1.5 font-mono text-neutral-600 dark:text-neutral-400">
                      {nodeA?.id ?? '-'}
                    </td>
                    <td className="px-2 py-1.5 font-mono text-neutral-600 dark:text-neutral-400">
                      {nodeB?.id ?? '-'}
                    </td>
                    <td className="px-2 py-1.5 font-medium text-neutral-800 dark:text-neutral-200 whitespace-nowrap">
                      {operation}
                    </td>
                    <td className="px-2 py-1.5 text-neutral-600 dark:text-neutral-400 whitespace-nowrap">
                      {objectName}
                    </td>
                    {compareMetrics.map(metric => {
                      const valA = nodeA ? getNodeMetricValue(nodeA, metric) : undefined;
                      const valB = nodeB ? getNodeMetricValue(nodeB, metric) : undefined;
                      return (
                        <React.Fragment key={`${i}-${metric}`}>
                          <td className="px-2 py-1.5 text-center text-neutral-700 dark:text-neutral-300 border-l border-neutral-100 dark:border-neutral-800">
                            {formatMetricValue(valA, metric)}
                          </td>
                          <td className="px-2 py-1.5 text-center text-neutral-700 dark:text-neutral-300">
                            {formatMetricValue(valB, metric)}
                          </td>
                          <DeltaCell valueA={valA} valueB={valB} metric={metric} />
                        </React.Fragment>
                      );
                    })}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
