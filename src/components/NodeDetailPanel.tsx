import { useState, type PointerEvent as ReactPointerEvent } from 'react';
import { usePlan } from '../hooks/usePlanContext';
import { getOperationCategory, COLOR_SCHEMES, getMetricColor } from '../lib/types';
import { formatBytes, formatNumberShort, formatTimeCompact, formatTimeDetailed } from '../lib/format';
import type { PlanNode as PlanNodeType, NodeIndicatorMetric } from '../lib/types';
import { HighlightText } from './HighlightText';

interface NodeDetailPanelProps {
  panelWidth: number;
  onResizeStart: (event: ReactPointerEvent<HTMLButtonElement>) => void;
}

export function NodeDetailPanel({ panelWidth, onResizeStart }: NodeDetailPanelProps) {
  const { selectedNode, parsedPlan, selectNode, colorScheme, filters, nodeIndicatorMetric } = usePlan();
  const [isCollapsed, setIsCollapsed] = useState(false);
  const node = selectedNode;
  const searchText = filters.searchText;

  if (isCollapsed) {
    return (
      <div className="bg-white dark:bg-slate-900 border-l border-slate-200 dark:border-slate-800 flex flex-col items-center py-3">
        <button
          onClick={() => setIsCollapsed(false)}
          className="h-8 w-8 flex items-center justify-center hover:bg-slate-100 dark:hover:bg-slate-800 rounded-md transition-colors border border-slate-200 dark:border-slate-700"
          title="Show details"
        >
          <svg className="w-4 h-4 text-slate-600 dark:text-slate-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
        </button>
        <span className="text-[11px] text-slate-500 dark:text-slate-400 mt-2 writing-mode-vertical">Details</span>
      </div>
    );
  }

  if (!node) {
    return (
      <div
        className="relative shrink-0 bg-white dark:bg-slate-900 border-l border-slate-200 dark:border-slate-800 p-3"
        style={{ width: panelWidth }}
      >
        <button
          type="button"
          onPointerDown={onResizeStart}
          className="absolute left-0 top-0 z-10 h-full w-2 cursor-col-resize touch-none bg-transparent hover:bg-slate-200/70 dark:hover:bg-slate-700/70 transition-colors"
          aria-label="Resize details panel"
          title="Resize details panel"
        />
        <div className="flex justify-end mb-2">
          <button
            onClick={() => setIsCollapsed(true)}
            className="p-1 hover:bg-slate-100 dark:hover:bg-slate-800 rounded transition-colors"
            title="Collapse panel"
          >
            <svg className="w-4 h-4 text-slate-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 5l7 7-7 7M5 5l7 7-7 7" />
            </svg>
          </button>
        </div>
        <div className="text-slate-500 dark:text-slate-400 text-center mt-8">
          <svg
            className="w-10 h-10 mx-auto mb-3 text-slate-400 dark:text-slate-600"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={1.5}
              d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
            />
          </svg>
          <p>Click on a node to see details</p>
        </div>
      </div>
    );
  }

  const category = getOperationCategory(node.operation);
  const schemeColors = COLOR_SCHEMES[colorScheme];
  const colors = schemeColors[category] || schemeColors['Other'];
  const indicator = computeNodeDetailIndicator(node, parsedPlan, nodeIndicatorMetric);

  return (
    <div
      className="relative shrink-0 bg-white dark:bg-slate-900 border-l border-slate-200 dark:border-slate-800 overflow-y-auto"
      style={{ width: panelWidth }}
    >
      <button
        type="button"
        onPointerDown={onResizeStart}
        className="absolute left-0 top-0 z-10 h-full w-2 cursor-col-resize touch-none bg-transparent hover:bg-slate-200/70 dark:hover:bg-slate-700/70 transition-colors"
        aria-label="Resize details panel"
        title="Resize details panel"
      />
      {/* Header */}
      <div className={`p-3 border-b border-slate-200 dark:border-slate-800 ${colors.bg}`}>
        <div className="flex items-start justify-between">
          <div>
            <span className={`inline-block px-2 py-0.5 rounded text-[11px] font-semibold ${colors.text} ${colors.bg} border ${colors.border}`}>
              {category}
            </span>
            <div className="mt-2 flex items-center gap-2">
              <span className="w-6 h-6 rounded-full bg-slate-700 dark:bg-slate-300 text-white dark:text-slate-900 text-xs font-bold flex items-center justify-center">
                {node.id}
              </span>
              <h3 className="font-semibold text-sm text-slate-900 dark:text-slate-100">
                <HighlightText text={node.operation} query={searchText} />
              </h3>
            </div>
          </div>
          <div className="flex items-center gap-1">
            <button
              onClick={() => setIsCollapsed(true)}
              className="p-1 hover:bg-slate-100 dark:hover:bg-slate-800 rounded"
              title="Collapse panel"
            >
              <svg className="w-4 h-4 text-slate-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 5l7 7-7 7M5 5l7 7-7 7" />
              </svg>
            </button>
            <button
              onClick={() => selectNode(null)}
              className="p-1 hover:bg-slate-100 dark:hover:bg-slate-800 rounded"
              title="Close"
            >
              <svg className="w-4 h-4 text-slate-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        </div>

        {node.objectName && (
          <div className="mt-2 font-mono text-xs text-slate-600 dark:text-slate-400">
            <HighlightText text={node.objectName} query={searchText} />
          </div>
        )}

        {(node.queryBlock || node.objectAlias) && (
          <div className="mt-2 flex flex-wrap gap-2">
            {node.queryBlock && (
              <span className="px-2 py-0.5 rounded text-xs font-medium bg-violet-100 dark:bg-violet-900/30 text-violet-700 dark:text-violet-300">
                {node.queryBlock}
              </span>
            )}
            {node.objectAlias && (
              <span className="px-2 py-0.5 rounded text-xs font-medium bg-slate-200 dark:bg-slate-700 text-slate-700 dark:text-slate-200">
                {node.objectAlias}
              </span>
            )}
          </div>
        )}
      </div>

      {/* Node indicator */}
      <div className="p-3 border-b border-slate-200 dark:border-slate-800">
        <div className="flex items-center justify-between mb-2">
          <span className="text-xs font-semibold text-slate-700 dark:text-slate-300 uppercase tracking-wide">{indicator.title}</span>
          <span className="text-xs text-slate-600 dark:text-slate-400">{indicator.percentText}% {indicator.referenceLabel}</span>
        </div>
        <div className="mb-2 text-xs font-medium text-slate-700 dark:text-slate-300">{indicator.formattedValue}</div>
        <div className="h-2.5 bg-slate-200 dark:bg-slate-700 rounded-full overflow-hidden">
          <div
            className={`h-full ${indicator.color} transition-all duration-300`}
            style={{ width: `${Math.min(100, indicator.ratio * 100)}%` }}
          />
        </div>
      </div>

      {/* Actual Statistics (SQL Monitor) */}
      {parsedPlan?.hasActualStats && (
        <div className="p-3 border-b border-slate-200 dark:border-slate-800">
          <h4 className="text-xs font-semibold text-slate-700 dark:text-slate-300 mb-2 uppercase tracking-wide">Actual Statistics</h4>
          <div className="grid grid-cols-2 gap-3">
            <StatItem label="A-Rows" value={formatNumberShort(node.actualRows)} highlight="blue" />
            <StatItem label="A-Time" value={formatTimeDetailed(node.actualTime)} highlight="purple" />
            <StatItem label="Starts" value={formatNumberShort(node.starts)} highlight="orange" />
            {node.activityPercent !== undefined && (
              <StatItem label="Activity %" value={`${node.activityPercent.toFixed(1)}%`} />
            )}
          </div>
        </div>
      )}

      {/* Estimated Statistics */}
      <div className="p-3 border-b border-slate-200 dark:border-slate-800">
        <h4 className="text-xs font-semibold text-slate-700 dark:text-slate-300 mb-2 uppercase tracking-wide">
          {parsedPlan?.hasActualStats ? 'Estimated Statistics' : 'Statistics'}
        </h4>
        <div className="grid grid-cols-2 gap-3">
          <StatItem label={parsedPlan?.hasActualStats ? "E-Rows" : "Rows"} value={formatNumberShort(node.rows)} />
          <StatItem label="Bytes" value={formatBytes(node.bytes)} />
          <StatItem label="Cost" value={node.cost?.toString()} />
          <StatItem label="CPU %" value={node.cpuPercent ? `${node.cpuPercent}%` : undefined} />
          <StatItem label="Time" value={node.time} />
          <StatItem label="Temp Space" value={node.tempSpace ? formatBytes(node.tempSpace) : undefined} />
        </div>
      </div>

      {/* Predicates */}
      {(node.accessPredicates || node.filterPredicates) && (
        <div className="p-3">
          <h4 className="text-xs font-semibold text-slate-700 dark:text-slate-300 mb-2 uppercase tracking-wide">Predicates</h4>

          {node.accessPredicates && (
            <div className="mb-3">
              <div className="flex items-center gap-2 mb-1">
                <span className="px-2 py-0.5 bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-300 text-xs rounded font-medium">
                  Access
                </span>
              </div>
              <code className="block text-xs bg-slate-50 dark:bg-slate-950 p-2 rounded border border-slate-200 dark:border-slate-700 text-slate-800 dark:text-slate-200 font-mono whitespace-pre-wrap break-all">
                <HighlightText text={node.accessPredicates} query={searchText} />
              </code>
            </div>
          )}

          {node.filterPredicates && (
            <div>
              <div className="flex items-center gap-2 mb-1">
                <span className="px-2 py-0.5 bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300 text-xs rounded font-medium">
                  Filter
                </span>
              </div>
              <code className="block text-xs bg-slate-50 dark:bg-slate-950 p-2 rounded border border-slate-200 dark:border-slate-700 text-slate-800 dark:text-slate-200 font-mono whitespace-pre-wrap break-all">
                <HighlightText text={node.filterPredicates} query={searchText} />
              </code>
            </div>
          )}
        </div>
      )}

      {/* Memory & I/O */}
      {(node.memoryUsed !== undefined ||
        node.tempUsed !== undefined ||
        node.physicalReads !== undefined ||
        node.logicalReads !== undefined) && (
        <div className="p-3 border-t border-slate-200 dark:border-slate-800">
          <h4 className="text-xs font-semibold text-slate-700 dark:text-slate-300 mb-2 uppercase tracking-wide">Memory & I/O</h4>
          <div className="grid grid-cols-2 gap-3">
            <StatItem label="Memory" value={formatBytes(node.memoryUsed)} />
            <StatItem label="Temp Used" value={formatBytes(node.tempUsed)} />
            <StatItem label="Phys Reads" value={formatNumberShort(node.physicalReads)} />
            <StatItem label="Log Reads" value={formatNumberShort(node.logicalReads)} />
          </div>
        </div>
      )}

    </div>
  );
}

function StatItem({ label, value, highlight }: { label: string; value?: string; highlight?: 'blue' | 'purple' | 'orange' }) {
  if (!value) return null;

  const highlightStyles = {
    blue: 'bg-blue-50 dark:bg-blue-900/30 border border-blue-200 dark:border-blue-800',
    purple: 'bg-purple-50 dark:bg-purple-900/30 border border-purple-200 dark:border-purple-800',
    orange: 'bg-orange-50 dark:bg-orange-900/30 border border-orange-200 dark:border-orange-800',
  };

  const valueStyles = {
    blue: 'text-blue-700 dark:text-blue-300',
    purple: 'text-purple-700 dark:text-purple-300',
    orange: 'text-orange-700 dark:text-orange-300',
  };

  return (
    <div className={`rounded-md p-2 border border-slate-200 dark:border-slate-700 ${highlight ? highlightStyles[highlight] : 'bg-slate-50 dark:bg-slate-950'}`}>
      <div className="text-[11px] text-slate-500 dark:text-slate-400 uppercase tracking-wide">{label}</div>
      <div className={`text-xs font-semibold ${highlight ? valueStyles[highlight] : 'text-slate-900 dark:text-slate-100'}`}>{value}</div>
    </div>
  );
}

interface NodeDetailIndicator {
  ratio: number;
  title: string;
  formattedValue: string;
  referenceLabel: string;
  percentText: string;
  color: string;
}

function computeNodeDetailIndicator(
  node: PlanNodeType,
  parsedPlan: { totalCost: number; maxActualRows?: number; maxStarts?: number; totalElapsedTime?: number } | null,
  metric: NodeIndicatorMetric,
): NodeDetailIndicator {
  const totalCost = parsedPlan?.totalCost || 0;
  const maxActualRows = parsedPlan?.maxActualRows || 0;
  const maxStarts = parsedPlan?.maxStarts || 0;
  const totalElapsedTime = parsedPlan?.totalElapsedTime || 0;

  let ratio = 0;
  let title = 'Cost Impact';
  let formattedValue = `Cost: ${node.cost || 0}`;
  let referenceLabel = 'of total';

  switch (metric) {
    case 'cost':
      ratio = totalCost > 0 ? (node.cost || 0) / totalCost : 0;
      title = 'Cost Impact';
      formattedValue = `Cost: ${node.cost || 0}`;
      referenceLabel = 'of total';
      break;
    case 'actualRows':
      ratio = maxActualRows > 0 ? (node.actualRows || 0) / maxActualRows : 0;
      title = 'A-Rows Impact';
      formattedValue = `A-Rows: ${formatNumberShort(node.actualRows || 0) ?? '0'}`;
      referenceLabel = 'of max';
      break;
    case 'actualTime':
      ratio = totalElapsedTime > 0 ? (node.actualTime || 0) / totalElapsedTime : 0;
      title = 'A-Time Impact';
      formattedValue = `A-Time: ${formatTimeCompact(node.actualTime || 0) ?? '0ms'}`;
      referenceLabel = 'of total';
      break;
    case 'starts':
      ratio = maxStarts > 0 ? (node.starts || 0) / maxStarts : 0;
      title = 'Starts Impact';
      formattedValue = `Starts: ${formatNumberShort(node.starts || 0) ?? '0'}`;
      referenceLabel = 'of max';
      break;
    case 'activityPercent':
      ratio = (node.activityPercent || 0) / 100;
      title = 'Activity Impact';
      formattedValue = `Activity: ${(node.activityPercent || 0).toFixed(1)}%`;
      referenceLabel = 'of total';
      break;
  }

  const clampedRatio = Math.max(0, Math.min(1, ratio));
  return {
    ratio: clampedRatio,
    title,
    formattedValue,
    referenceLabel,
    percentText: (clampedRatio * 100).toFixed(1),
    color: clampedRatio === 0 ? 'bg-gray-200 dark:bg-gray-700' : getMetricColor(clampedRatio),
  };
}
