import { Handle, Position } from '@xyflow/react';
import { getOperationCategory, CATEGORY_COLORS, getCostColor, formatNumber } from '../../lib/types';
import { usePlan } from '../../hooks/usePlanContext';
import type { PlanNode as PlanNodeType, NodeDisplayOptions } from '../../lib/types';

export interface PlanNodeData extends Record<string, unknown> {
  label: string;
  node: PlanNodeType;
  totalCost: number;
  isSelected: boolean;
  isFiltered: boolean;
  displayOptions?: NodeDisplayOptions;
  hasActualStats?: boolean;
}

interface PlanNodeProps {
  data: PlanNodeData;
}

function PlanNodeComponent({ data }: PlanNodeProps) {
  const { node, totalCost, isSelected, displayOptions, hasActualStats } = data;
  const { getFilteredNodes } = usePlan();

  // Compute isFiltered directly from context to ensure reactivity
  const filteredIds = new Set(getFilteredNodes().map(n => n.id));
  const isFiltered = filteredIds.has(node.id);
  const category = getOperationCategory(node.operation);
  const colors = CATEGORY_COLORS[category];
  const costColor = getCostColor(node.cost || 0, totalCost);

  const costPercentage = totalCost > 0 ? ((node.cost || 0) / totalCost * 100).toFixed(1) : '0';

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

  return (
    <div
      className={`
        relative min-w-[200px] max-w-[280px] rounded-lg border-2 shadow-md transition-all duration-200
        ${colors.bg} ${colors.border}
        ${isSelected ? 'ring-2 ring-blue-500 ring-offset-2 dark:ring-offset-gray-900 scale-105' : ''}
        ${isFiltered ? 'opacity-100' : 'opacity-40'}
      `}
    >
      <Handle type="target" position={Position.Top} className="!bg-gray-400 !w-3 !h-3" />

      {/* Cost indicator bar */}
      <div className="absolute top-0 left-0 right-0 h-1 rounded-t-md overflow-hidden bg-gray-200 dark:bg-gray-700">
        <div
          className={`h-full ${costColor} transition-all`}
          style={{ width: `${Math.min(100, parseFloat(costPercentage))}%` }}
        />
      </div>

      <div className="p-3 pt-4">
        {/* Operation ID badge */}
        <div className="absolute -top-2 -left-2 w-6 h-6 rounded-full bg-gray-700 dark:bg-gray-300 text-white dark:text-gray-900 text-xs font-bold flex items-center justify-center shadow">
          {node.id}
        </div>

        {/* Operation name */}
        <div className={`font-semibold text-sm leading-tight mb-1 ${colors.text}`}>
          {node.operation}
        </div>

        {/* Object name if present */}
        {options.showObjectName && node.objectName && (
          <div className="text-xs text-gray-600 dark:text-gray-400 font-mono mb-2 truncate">
            {node.objectName}
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
              {rowsLabel}: {formatNumber(node.rows)}
            </span>
          )}
          {options.showCost && node.cost !== undefined && (
            <span className="px-1.5 py-0.5 bg-white/50 dark:bg-black/20 rounded text-gray-700 dark:text-gray-300">
              Cost: {node.cost} ({costPercentage}%)
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
                A-Rows: {formatNumber(node.actualRows)}
              </span>
            )}
            {options.showActualTime && node.actualTime !== undefined && (
              <span className="px-1.5 py-0.5 bg-purple-100 dark:bg-purple-900/40 rounded text-purple-700 dark:text-purple-300 font-medium">
                A-Time: {formatTime(node.actualTime)}
              </span>
            )}
            {options.showStarts && node.starts !== undefined && (
              <span className="px-1.5 py-0.5 bg-orange-100 dark:bg-orange-900/40 rounded text-orange-700 dark:text-orange-300 font-medium">
                Starts: {formatNumber(node.starts)}
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
                <code className="text-gray-600 dark:text-gray-400 break-all">{node.accessPredicates}</code>
              </div>
            )}
            {node.filterPredicates && (
              <div className="text-xs">
                <span className="text-amber-700 dark:text-amber-300 font-medium">F: </span>
                <code className="text-gray-600 dark:text-gray-400 break-all">{node.filterPredicates}</code>
              </div>
            )}
          </div>
        )}
      </div>

      <Handle type="source" position={Position.Bottom} className="!bg-gray-400 !w-3 !h-3" />
    </div>
  );
}

function formatTime(ms: number): string {
  if (ms >= 60000) {
    const mins = Math.floor(ms / 60000);
    const secs = ((ms % 60000) / 1000).toFixed(1);
    return `${mins}m ${secs}s`;
  }
  if (ms >= 1000) {
    return (ms / 1000).toFixed(2) + 's';
  }
  return ms.toFixed(0) + 'ms';
}

function formatBytes(bytes: number): string {
  if (bytes >= 1073741824) {
    return (bytes / 1073741824).toFixed(1) + ' GB';
  }
  if (bytes >= 1048576) {
    return (bytes / 1048576).toFixed(1) + ' MB';
  }
  if (bytes >= 1024) {
    return (bytes / 1024).toFixed(1) + ' KB';
  }
  return bytes + ' B';
}

// No memo - we need to re-render when context changes (for filter state)
export const PlanNodeMemo = PlanNodeComponent;
