import { Handle, Position } from '@xyflow/react';
import { getOperationCategory, COLOR_SCHEMES, getMetricColor, getOperationTooltip } from '../../lib/types';
import { formatNumberShort, formatBytes, formatTimeCompact, formatCardinalityRatio, cardinalityRatioSeverity, computeCardinalityRatio } from '../../lib/format';
import type { PlanNode as PlanNodeType, NodeDisplayOptions, ColorScheme, NodeIndicatorMetric } from '../../lib/types';
import { HighlightText } from '../HighlightText';

export interface PlanNodeData extends Record<string, unknown> {
  label: string;
  node: PlanNodeType;
  totalCost: number;
  isSelected: boolean;
  isFiltered: boolean;
  isInFocusPath?: boolean;
  isFocusDimmed?: boolean;
  displayOptions?: NodeDisplayOptions;
  hasActualStats?: boolean;
  colorScheme?: ColorScheme;
  nodeIndicatorMetric?: NodeIndicatorMetric;
  maxActualRows?: number;
  maxStarts?: number;
  totalElapsedTime?: number;
  filterKey?: string; // Used to force re-renders when filters change
  searchText?: string;
  width?: number;
  height?: number;
  isHotNode?: boolean; // Node with highest A-Time
}

interface PlanNodeProps {
  data: PlanNodeData;
}

function PlanNodeComponent({ data }: PlanNodeProps) {
  const {
    node,
    totalCost,
    isSelected,
    isFiltered,
    isInFocusPath,
    isFocusDimmed,
    displayOptions,
    hasActualStats,
    colorScheme = 'muted',
    nodeIndicatorMetric = 'cost',
    maxActualRows,
    maxStarts,
    totalElapsedTime,
    searchText,
    isHotNode,
  } = data;
  const category = getOperationCategory(node.operation);
  const schemeColors = COLOR_SCHEMES[colorScheme];
  const colors = schemeColors[category] || schemeColors['Other'];
  const borderClass = colorScheme === 'professional' ? '' : 'border-2';

  const indicator = computeIndicatorMetric(node, nodeIndicatorMetric, totalCost, maxActualRows, maxStarts, totalElapsedTime);

  // Default display options if not provided
  const options = displayOptions || {
    showRows: true,
    showCost: true,
    showBytes: true,
    showObjectName: true,
    showPredicateIndicators: true,
    showPredicateDetails: false,
    showQueryBlockBadge: true,
    showQueryBlockGrouping: true,
    showActualRows: true,
    showActualTime: true,
    showStarts: true,
  };

  // Label for rows depends on whether we have actual stats
  const rowsLabel = hasActualStats ? 'E-Rows' : 'Rows';

  // Cardinality mismatch
  const cardinalityRatio = hasActualStats ? computeCardinalityRatio(node.rows, node.actualRows) : undefined;
  const cardSeverity = cardinalityRatioSeverity(cardinalityRatio);
  const cardLabel = formatCardinalityRatio(cardinalityRatio);

  // Spill detection
  const hasSpill = (node.tempUsed !== undefined && node.tempUsed > 0);

  // Operation tooltip
  const tooltip = getOperationTooltip(node.operation);

  let opacity = isFiltered ? 1 : 0.35;
  if (isFocusDimmed) {
    opacity = Math.min(opacity, 0.15);
  }
  if (isSelected) {
    opacity = 1;
  }

  return (
    <div
      className={`
        relative w-[260px] rounded-lg ${borderClass} shadow-md transition-all duration-200
        ${colors.bg} ${colors.border}
        ${isSelected ? 'ring-2 ring-blue-500 ring-offset-2 dark:ring-offset-gray-900 scale-105' : ''}
        ${isInFocusPath ? 'ring-1 ring-blue-300/60' : ''}
        ${isHotNode && !isSelected ? 'ring-2 ring-red-500/70 ring-offset-1 dark:ring-offset-gray-900' : ''}
      `}
      style={{ opacity }}
    >
      <Handle type="target" position={Position.Top} className="!bg-gray-400 !w-3 !h-3" />

      {/* Metric indicator bar */}
      <div
        className="absolute top-0 left-0 right-0 h-1 rounded-t-md overflow-hidden bg-gray-200 dark:bg-gray-700"
        title={
          nodeIndicatorMetric === 'cost'
            ? `${indicator.label}: ${indicator.formattedValue}`
            : `${indicator.label}: ${indicator.formattedValue} (${(indicator.ratio * 100).toFixed(1)}%)`
        }
      >
        <div
          className={`h-full ${indicator.color} transition-all`}
          style={{ width: `${Math.min(100, indicator.ratio * 100)}%` }}
        />
      </div>

      <div className="p-3 pt-4">
        {/* Operation ID badge */}
        <div className="absolute -top-2 -left-2 w-6 h-6 rounded-full bg-gray-700 dark:bg-gray-300 text-white dark:text-gray-900 text-xs font-bold flex items-center justify-center shadow">
          {node.id}
        </div>

        {/* Warning badges row (hot node, spill, cardinality) */}
        {(isHotNode || hasSpill || (cardSeverity !== 'good' && cardLabel)) && (
          <div className="flex flex-wrap gap-1 mb-1.5">
            {isHotNode && (
              <span className="px-1.5 py-0.5 bg-red-100 dark:bg-red-900/40 text-red-700 dark:text-red-300 text-[10px] rounded font-semibold flex items-center gap-0.5" title="Highest execution time in plan">
                <svg className="w-3 h-3" viewBox="0 0 20 20" fill="currentColor"><path fillRule="evenodd" d="M12.395 2.553a1 1 0 00-1.45-.385c-.345.23-.614.558-.822.88-.214.33-.403.713-.57 1.116-.334.804-.614 1.768-.84 2.734a31.365 31.365 0 00-.613 3.58 2.64 2.64 0 01-.945-1.067c-.328-.68-.398-1.534-.398-2.654A1 1 0 005.05 6.05 6.981 6.981 0 003 11a7 7 0 1011.95-4.95c-.592-.591-.98-.985-1.348-1.467-.363-.476-.724-1.063-1.207-2.03zM12.12 15.12A3 3 0 017 13s.879.5 2.5.5c0-1 .5-4 1.25-4.5.5 1 .786 1.293 1.371 1.879A2.99 2.99 0 0113 13a2.99 2.99 0 01-.879 2.121z" clipRule="evenodd" /></svg>
                Hotspot
              </span>
            )}
            {hasSpill && (
              <span className="px-1.5 py-0.5 bg-yellow-100 dark:bg-yellow-900/40 text-yellow-700 dark:text-yellow-300 text-[10px] rounded font-semibold" title="Spill to disk — temp space used">
                Spill
              </span>
            )}
            {cardSeverity !== 'good' && cardLabel && (
              <span
                className={`px-1.5 py-0.5 text-[10px] rounded font-semibold ${
                  cardSeverity === 'bad'
                    ? 'bg-red-100 dark:bg-red-900/40 text-red-700 dark:text-red-300'
                    : 'bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-300'
                }`}
                title={`Cardinality mismatch: E-Rows=${formatNumberShort(node.rows)} vs A-Rows=${formatNumberShort(node.actualRows)}`}
              >
                {cardLabel}
              </span>
            )}
          </div>
        )}

        {/* Operation name */}
        <div className={`font-semibold text-sm leading-tight mb-1 ${colors.text}`} title={tooltip}>
          <HighlightText text={node.operation} query={searchText} />
        </div>

        {/* Object name if present */}
        {options.showObjectName && node.objectName && (
          <div className="text-sm font-semibold font-mono text-slate-700 dark:text-slate-200 mb-2 truncate">
            <HighlightText text={node.objectName} query={searchText} />
          </div>
        )}

        {/* Query block badge */}
        {options.showQueryBlockBadge && node.queryBlock && (
          <div className="flex flex-wrap gap-1 mb-2">
            <span className="px-1.5 py-0.5 bg-violet-200 dark:bg-violet-800 text-violet-800 dark:text-violet-200 text-xs rounded font-mono">
              {node.queryBlock}
            </span>
            {node.objectAlias && (
              <span className="px-1.5 py-0.5 bg-slate-200 dark:bg-slate-700 text-slate-700 dark:text-slate-200 text-xs rounded font-mono">
                {node.objectAlias}
              </span>
            )}
          </div>
        )}

        {/* Stats row - Estimated statistics */}
        <div className="flex flex-wrap gap-2 text-xs">
          {options.showRows && node.rows !== undefined && (
            <span className="px-1.5 py-0.5 bg-white/50 dark:bg-black/20 rounded text-gray-700 dark:text-gray-300">
              {rowsLabel}: {formatNumberShort(node.rows)}
            </span>
          )}
          {options.showCost && node.cost !== undefined && (
            <span className="px-1.5 py-0.5 bg-white/50 dark:bg-black/20 rounded text-gray-700 dark:text-gray-300">
              Cost: {node.cost}
            </span>
          )}
          {options.showBytes && node.bytes !== undefined && (
            <span className="px-1.5 py-0.5 bg-white/50 dark:bg-black/20 rounded text-gray-700 dark:text-gray-300">
              {formatBytes(node.bytes)}
            </span>
          )}
        </div>

        {/* Actual runtime statistics (SQL Monitor) */}
        {hasActualStats && (
          <div className="flex flex-wrap gap-2 text-xs mt-1">
            {options.showActualRows && node.actualRows !== undefined && (
              <span className="px-1.5 py-0.5 bg-blue-100 dark:bg-blue-900/40 rounded text-blue-700 dark:text-blue-300 font-medium">
                A-Rows: {formatNumberShort(node.actualRows)}
              </span>
            )}
            {options.showActualTime && node.actualTime !== undefined && (
              <span className="px-1.5 py-0.5 bg-purple-100 dark:bg-purple-900/40 rounded text-purple-700 dark:text-purple-300 font-medium">
                A-Time: {formatTimeCompact(node.actualTime)}
              </span>
            )}
            {options.showStarts && node.starts !== undefined && (
              <span className={`px-1.5 py-0.5 rounded font-medium ${
                node.starts >= 1000
                  ? 'bg-red-100 dark:bg-red-900/40 text-red-700 dark:text-red-300'
                  : 'bg-orange-100 dark:bg-orange-900/40 text-orange-700 dark:text-orange-300'
              }`}>
                Starts: {formatNumberShort(node.starts)}
              </span>
            )}
          </div>
        )}

        {/* Predicate indicators */}
        {options.showPredicateIndicators && (node.accessPredicates || node.filterPredicates) && (
          <div className="flex gap-1 mt-2">
            {node.accessPredicates && (
              <span className="px-1.5 py-0.5 bg-green-200 dark:bg-green-800 text-green-800 dark:text-green-200 text-xs rounded">
                Access
              </span>
            )}
            {node.filterPredicates && (
              <span className="px-1.5 py-0.5 bg-amber-200 dark:bg-amber-800 text-amber-800 dark:text-amber-200 text-xs rounded">
                Filter
              </span>
            )}
          </div>
        )}

        {/* Predicate details */}
        {options.showPredicateDetails && (node.accessPredicates || node.filterPredicates) && (
          <div className="mt-2 space-y-1">
            {node.accessPredicates && (
              <div className="text-xs">
                <span className="text-green-700 dark:text-green-300 font-medium">A: </span>
                <code className="text-gray-600 dark:text-gray-400 break-all">
                  <HighlightText text={node.accessPredicates} query={searchText} />
                </code>
              </div>
            )}
            {node.filterPredicates && (
              <div className="text-xs">
                <span className="text-amber-700 dark:text-amber-300 font-medium">F: </span>
                <code className="text-gray-600 dark:text-gray-400 break-all">
                  <HighlightText text={node.filterPredicates} query={searchText} />
                </code>
              </div>
            )}
          </div>
        )}
      </div>

      <Handle type="source" position={Position.Bottom} className="!bg-gray-400 !w-3 !h-3" />
    </div>
  );
}

interface IndicatorResult {
  ratio: number;
  label: string;
  formattedValue: string;
  color: string;
}

function computeIndicatorMetric(
  node: PlanNodeType,
  metric: NodeIndicatorMetric,
  totalCost: number,
  maxActualRows?: number,
  maxStarts?: number,
  totalElapsedTime?: number,
): IndicatorResult {
  let ratio = 0;
  let label = '';
  let formattedValue = '';

  switch (metric) {
    case 'cost':
      ratio = totalCost > 0 ? (node.cost || 0) / totalCost : 0;
      label = 'Cost';
      formattedValue = `${node.cost || 0}`;
      break;
    case 'actualRows':
      ratio = maxActualRows && maxActualRows > 0 ? (node.actualRows || 0) / maxActualRows : 0;
      label = 'A-Rows';
      formattedValue = formatNumberShort(node.actualRows || 0) ?? '0';
      break;
    case 'actualTime':
      ratio = totalElapsedTime && totalElapsedTime > 0 ? (node.actualTime || 0) / totalElapsedTime : 0;
      label = 'A-Time';
      formattedValue = formatTimeCompact(node.actualTime || 0) ?? '0ms';
      break;
    case 'starts':
      ratio = maxStarts && maxStarts > 0 ? (node.starts || 0) / maxStarts : 0;
      label = 'Starts';
      formattedValue = formatNumberShort(node.starts || 0) ?? '0';
      break;
    case 'activityPercent':
      ratio = (node.activityPercent || 0) / 100;
      label = 'Activity %';
      formattedValue = `${(node.activityPercent || 0).toFixed(1)}%`;
      break;
  }

  return {
    ratio: Math.min(1, ratio),
    label,
    formattedValue,
    color: ratio === 0 ? 'bg-gray-200 dark:bg-gray-700' : getMetricColor(ratio),
  };
}

// No memo - we need to re-render when context changes (for filter state)
export const PlanNodeMemo = PlanNodeComponent;
