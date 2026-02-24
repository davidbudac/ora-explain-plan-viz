import { Handle, Position } from '@xyflow/react';
import { getOperationCategory, COLOR_SCHEMES, getMetricColor, getOperationTooltip } from '../../lib/types';
import { formatNumberShort, formatBytes, formatTimeCompact, formatCardinalityRatio, cardinalityRatioSeverity, computeCardinalityRatio } from '../../lib/format';
import type { PlanNode as PlanNodeType, NodeDisplayOptions, ColorScheme, NodeIndicatorMetric } from '../../lib/types';
import { HighlightText } from '../HighlightText';
import { getHighlightColorDef } from '../../lib/annotations';
import type { HighlightColor } from '../../lib/annotations';

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
  annotationText?: string;
  highlightColor?: HighlightColor;
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
    annotationText,
    highlightColor,
  } = data;
  const category = getOperationCategory(node.operation);
  const schemeColors = COLOR_SCHEMES[colorScheme];
  const colors = schemeColors[category] || schemeColors['Other'];
  const isMono = colorScheme === 'monochrome';
  const borderClass = colorScheme === 'professional' ? '' : isMono ? 'border' : 'border-2';

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
    showHotspotBadge: true,
    showSpillBadge: true,
    showCardinalityBadge: true,
    showAnnotations: true,
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

  // Effective visibility considering display options
  const showHot = isHotNode && options.showHotspotBadge;
  const showAnnotationsOverlay = options.showAnnotations;

  // Highlight ring priority: selected (blue) > hotNode (red) > highlight (color) > focusPath (faint blue)
  const highlightRingClass = highlightColor && showAnnotationsOverlay && !isSelected && !showHot
    ? getHighlightColorDef(highlightColor).ring
    : '';

  return (
    <div
      className={`
        relative w-[260px] rounded-lg ${borderClass} ${isMono ? 'shadow-sm' : 'shadow-md'} transition-all duration-200
        ${colors.bg} ${colors.border}
        ${isSelected ? 'ring-2 ring-blue-500 ring-offset-2 dark:ring-offset-gray-900 scale-105' : ''}
        ${isInFocusPath && !(highlightColor && showAnnotationsOverlay) ? 'ring-1 ring-blue-300/60' : ''}
        ${showHot && !isSelected ? 'ring-2 ring-red-500/70 ring-offset-1 dark:ring-offset-gray-900' : ''}
        ${highlightRingClass}
      `}
      style={{ opacity }}
    >
      <Handle type="target" position={Position.Top} className="!bg-emerald-500 !w-3 !h-3" />

      {/* Metric indicator bar */}
      <div
        className="absolute top-0 left-0 right-0 h-1 rounded-t-md overflow-hidden bg-[var(--border-color)]"
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
        <div className="absolute -top-2 -left-2 w-6 h-6 rounded-full bg-emerald-600 text-white text-xs font-bold flex items-center justify-center shadow">
          {node.id}
        </div>

        {/* Warning badges row (hot node, spill, cardinality) */}
        {(showHot || (hasSpill && options.showSpillBadge) || (options.showCardinalityBadge && cardSeverity !== 'good' && cardLabel)) && (
          <div className="flex flex-wrap gap-1 mb-1.5">
            {showHot && (
              <span className="px-1.5 py-0.5 bg-red-100 dark:bg-red-900/40 text-red-700 dark:text-red-300 text-[10px] rounded font-semibold flex items-center gap-0.5" title="Highest execution time in plan">
                <svg className="w-3 h-3" viewBox="0 0 20 20" fill="currentColor"><path fillRule="evenodd" d="M12.395 2.553a1 1 0 00-1.45-.385c-.345.23-.614.558-.822.88-.214.33-.403.713-.57 1.116-.334.804-.614 1.768-.84 2.734a31.365 31.365 0 00-.613 3.58 2.64 2.64 0 01-.945-1.067c-.328-.68-.398-1.534-.398-2.654A1 1 0 005.05 6.05 6.981 6.981 0 003 11a7 7 0 1011.95-4.95c-.592-.591-.98-.985-1.348-1.467-.363-.476-.724-1.063-1.207-2.03zM12.12 15.12A3 3 0 017 13s.879.5 2.5.5c0-1 .5-4 1.25-4.5.5 1 .786 1.293 1.371 1.879A2.99 2.99 0 0113 13a2.99 2.99 0 01-.879 2.121z" clipRule="evenodd" /></svg>
                Hotspot
              </span>
            )}
            {hasSpill && options.showSpillBadge && (
              <span className="px-1.5 py-0.5 bg-yellow-100 dark:bg-yellow-900/40 text-yellow-700 dark:text-yellow-300 text-[10px] rounded font-semibold" title="Spill to disk — temp space used">
                Spill
              </span>
            )}
            {options.showCardinalityBadge && cardSeverity !== 'good' && cardLabel && (
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
            <span className={`px-1.5 py-0.5 text-xs rounded font-mono ${
              isMono
                ? 'bg-slate-200 dark:bg-slate-700 text-slate-600 dark:text-slate-300'
                : 'bg-violet-200 dark:bg-violet-800 text-violet-800 dark:text-violet-200'
            }`}>
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
            <span className="px-1.5 py-0.5 bg-[var(--app-bg)]/60 rounded text-[var(--text-secondary)]">
              {rowsLabel}: {formatNumberShort(node.rows)}
            </span>
          )}
          {options.showCost && node.cost !== undefined && (
            <span className="px-1.5 py-0.5 bg-[var(--app-bg)]/60 rounded text-[var(--text-secondary)]">
              Cost: {node.cost}
            </span>
          )}
          {options.showBytes && node.bytes !== undefined && (
            <span className="px-1.5 py-0.5 bg-[var(--app-bg)]/60 rounded text-[var(--text-secondary)]">
              {formatBytes(node.bytes)}
            </span>
          )}
        </div>

        {/* Actual runtime statistics (SQL Monitor) */}
        {hasActualStats && (
          <div className="flex flex-wrap gap-2 text-xs mt-1">
            {options.showActualRows && node.actualRows !== undefined && (
              <span className={`px-1.5 py-0.5 rounded font-medium ${
                isMono
                  ? 'bg-[var(--app-bg)]/60 text-[var(--text-secondary)]'
                  : 'bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300'
              }`}>
                A-Rows: {formatNumberShort(node.actualRows)}
              </span>
            )}
            {options.showActualTime && node.actualTime !== undefined && (
              <span className={`px-1.5 py-0.5 rounded font-medium ${
                isMono
                  ? 'bg-[var(--app-bg)]/60 text-[var(--text-secondary)]'
                  : 'bg-purple-100 dark:bg-purple-900/40 text-purple-700 dark:text-purple-300'
              }`}>
                A-Time: {formatTimeCompact(node.actualTime)}
              </span>
            )}
            {options.showStarts && node.starts !== undefined && (
              <span className={`px-1.5 py-0.5 rounded font-medium ${
                isMono
                  ? 'bg-[var(--app-bg)]/60 text-[var(--text-secondary)]'
                  : node.starts >= 1000
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
              <span className={`px-1.5 py-0.5 text-xs rounded ${
                isMono
                  ? 'bg-slate-200 dark:bg-slate-700 text-slate-600 dark:text-slate-300'
                  : 'bg-green-200 dark:bg-green-800 text-green-800 dark:text-green-200'
              }`}>
                Access
              </span>
            )}
            {node.filterPredicates && (
              <span className={`px-1.5 py-0.5 text-xs rounded ${
                isMono
                  ? 'bg-slate-200 dark:bg-slate-700 text-slate-600 dark:text-slate-300'
                  : 'bg-amber-200 dark:bg-amber-800 text-amber-800 dark:text-amber-200'
              }`}>
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
                <span className={`font-medium ${isMono ? 'text-slate-500 dark:text-slate-400' : 'text-green-700 dark:text-green-300'}`}>A: </span>
                <code className="text-gray-600 dark:text-gray-400 break-all">
                  <HighlightText text={node.accessPredicates} query={searchText} />
                </code>
              </div>
            )}
            {node.filterPredicates && (
              <div className="text-xs">
                <span className={`font-medium ${isMono ? 'text-slate-500 dark:text-slate-400' : 'text-amber-700 dark:text-amber-300'}`}>F: </span>
                <code className="text-gray-600 dark:text-gray-400 break-all">
                  <HighlightText text={node.filterPredicates} query={searchText} />
                </code>
              </div>
            )}
          </div>
        )}

        {/* Annotation preview — shown as handwriting-style note in highlight color */}
        {showAnnotationsOverlay && annotationText && (
          <div
            className={`mt-2 text-[11px] italic truncate ${
              highlightColor ? getHighlightColorDef(highlightColor).text : 'text-[var(--text-muted)]'
            }`}
            style={{ fontFamily: 'Georgia, "Times New Roman", serif' }}
            title={annotationText}
          >
            {annotationText.length > 50 ? annotationText.slice(0, 50) + '\u2026' : annotationText}
          </div>
        )}
      </div>

      <Handle type="source" position={Position.Bottom} className="!bg-emerald-500 !w-3 !h-3" />
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
    color: ratio === 0 ? 'bg-[var(--border-color)]' : getMetricColor(ratio),
  };
}

// No memo - we need to re-render when context changes (for filter state)
export const PlanNodeMemo = PlanNodeComponent;
