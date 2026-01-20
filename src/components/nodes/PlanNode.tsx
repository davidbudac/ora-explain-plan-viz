import { memo } from 'react';
import { Handle, Position } from '@xyflow/react';
import { getOperationCategory, CATEGORY_COLORS, getCostColor } from '../../lib/types';
import type { PlanNode as PlanNodeType, NodeDisplayOptions } from '../../lib/types';

export interface PlanNodeData extends Record<string, unknown> {
  label: string;
  node: PlanNodeType;
  totalCost: number;
  isSelected: boolean;
  isFiltered: boolean;
  displayOptions?: NodeDisplayOptions;
}

interface PlanNodeProps {
  data: PlanNodeData;
}

function PlanNodeComponent({ data }: PlanNodeProps) {
  const { node, totalCost, isSelected, isFiltered, displayOptions } = data;
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
  };

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

        {/* Stats row */}
        <div className="flex flex-wrap gap-2 text-xs">
          {options.showRows && node.rows !== undefined && (
            <span className="px-1.5 py-0.5 bg-white/50 dark:bg-black/20 rounded text-gray-700 dark:text-gray-300">
              Rows: {formatNumber(node.rows)}
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

function formatNumber(num: number): string {
  if (num >= 1000000) {
    return (num / 1000000).toFixed(1) + 'M';
  }
  if (num >= 1000) {
    return (num / 1000).toFixed(1) + 'K';
  }
  return num.toString();
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

export const PlanNodeMemo = memo(PlanNodeComponent);
