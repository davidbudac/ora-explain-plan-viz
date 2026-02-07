import { useMemo, useState } from 'react';
import { usePlan } from '../hooks/usePlanContext';
import { getOperationCategory, COLOR_SCHEMES, getCostColor } from '../lib/types';
import { formatBytes, formatNumberShort, formatTimeDetailed } from '../lib/format';
import type { PlanNode as PlanNodeType } from '../lib/types';
import { HighlightText } from './HighlightText';

export function NodeDetailPanel() {
  const { selectedNode, parsedPlan, selectNode, colorScheme, filters, nodeById } = usePlan();
  const [isCollapsed, setIsCollapsed] = useState(false);
  const node = selectedNode;
  const searchText = filters.searchText;

  const ancestry = useMemo(() => {
    if (!parsedPlan || !node) return [];
    const chain: PlanNodeType[] = [];
    let current = node;
    while (current.parentId !== undefined) {
      const parent = nodeById.get(current.parentId);
      if (!parent) break;
      chain.push(parent);
      current = parent;
    }
    return chain.reverse();
  }, [node, parsedPlan, nodeById]);

  if (isCollapsed) {
    return (
      <div className="bg-white dark:bg-gray-800 border-l border-gray-200 dark:border-gray-700 flex flex-col items-center py-4">
        <button
          onClick={() => setIsCollapsed(false)}
          className="p-2 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-md transition-colors"
          title="Show details"
        >
          <svg className="w-5 h-5 text-gray-600 dark:text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
        </button>
        <span className="text-xs text-gray-500 dark:text-gray-400 mt-2 writing-mode-vertical">Details</span>
      </div>
    );
  }

  if (!node) {
    return (
      <div className="w-80 bg-white dark:bg-gray-800 border-l border-gray-200 dark:border-gray-700 p-4">
        <div className="flex justify-end mb-2">
          <button
            onClick={() => setIsCollapsed(true)}
            className="p-1 hover:bg-gray-100 dark:hover:bg-gray-700 rounded transition-colors"
            title="Collapse panel"
          >
            <svg className="w-4 h-4 text-gray-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 5l7 7-7 7M5 5l7 7-7 7" />
            </svg>
          </button>
        </div>
        <div className="text-gray-500 dark:text-gray-400 text-center mt-8">
          <svg
            className="w-12 h-12 mx-auto mb-3 text-gray-400 dark:text-gray-600"
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
  const totalCost = parsedPlan?.totalCost || 0;
  const costPercentage = totalCost > 0 ? ((node.cost || 0) / totalCost * 100).toFixed(1) : '0';
  const costColor = getCostColor(node.cost || 0, totalCost);

  return (
    <div className="w-80 bg-white dark:bg-gray-800 border-l border-gray-200 dark:border-gray-700 overflow-y-auto">
      {/* Header */}
      <div className={`p-4 border-b border-gray-200 dark:border-gray-700 ${colors.bg}`}>
        <div className="flex items-start justify-between">
          <div>
            <span className={`inline-block px-2 py-0.5 rounded text-xs font-medium ${colors.text} ${colors.bg} border ${colors.border}`}>
              {category}
            </span>
            <div className="mt-2 flex items-center gap-2">
              <span className="w-7 h-7 rounded-full bg-gray-700 dark:bg-gray-300 text-white dark:text-gray-900 text-sm font-bold flex items-center justify-center">
                {node.id}
              </span>
              <h3 className="font-semibold text-gray-900 dark:text-gray-100">
                <HighlightText text={node.operation} query={searchText} />
              </h3>
            </div>
          </div>
          <div className="flex items-center gap-1">
            <button
              onClick={() => setIsCollapsed(true)}
              className="p-1 hover:bg-gray-200 dark:hover:bg-gray-700 rounded"
              title="Collapse panel"
            >
              <svg className="w-5 h-5 text-gray-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 5l7 7-7 7M5 5l7 7-7 7" />
              </svg>
            </button>
            <button
              onClick={() => selectNode(null)}
              className="p-1 hover:bg-gray-200 dark:hover:bg-gray-700 rounded"
              title="Close"
            >
              <svg className="w-5 h-5 text-gray-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        </div>

        {node.objectName && (
          <div className="mt-2 font-mono text-sm text-gray-600 dark:text-gray-400">
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

      {/* Cost indicator */}
      <div className="p-4 border-b border-gray-200 dark:border-gray-700">
        <div className="flex items-center justify-between mb-2">
          <span className="text-sm font-medium text-gray-700 dark:text-gray-300">Cost Impact</span>
          <span className="text-sm text-gray-600 dark:text-gray-400">{costPercentage}% of total</span>
        </div>
        <div className="h-3 bg-gray-200 dark:bg-gray-700 rounded-full overflow-hidden">
          <div
            className={`h-full ${costColor} transition-all duration-300`}
            style={{ width: `${Math.min(100, parseFloat(costPercentage))}%` }}
          />
        </div>
      </div>

      {/* Actual Statistics (SQL Monitor) */}
      {parsedPlan?.hasActualStats && (
        <div className="p-4 border-b border-gray-200 dark:border-gray-700">
          <h4 className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-3">Actual Statistics</h4>
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
      <div className="p-4 border-b border-gray-200 dark:border-gray-700">
        <h4 className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-3">
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
        <div className="p-4">
          <h4 className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-3">Predicates</h4>

          {node.accessPredicates && (
            <div className="mb-3">
              <div className="flex items-center gap-2 mb-1">
                <span className="px-2 py-0.5 bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-300 text-xs rounded font-medium">
                  Access
                </span>
              </div>
              <code className="block text-xs bg-gray-50 dark:bg-gray-900 p-2 rounded border border-gray-200 dark:border-gray-700 text-gray-800 dark:text-gray-200 font-mono whitespace-pre-wrap break-all">
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
              <code className="block text-xs bg-gray-50 dark:bg-gray-900 p-2 rounded border border-gray-200 dark:border-gray-700 text-gray-800 dark:text-gray-200 font-mono whitespace-pre-wrap break-all">
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
        <div className="p-4 border-t border-gray-200 dark:border-gray-700">
          <h4 className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-3">Memory & I/O</h4>
          <div className="grid grid-cols-2 gap-3">
            <StatItem label="Memory" value={formatBytes(node.memoryUsed)} />
            <StatItem label="Temp Used" value={formatBytes(node.tempUsed)} />
            <StatItem label="Phys Reads" value={formatNumberShort(node.physicalReads)} />
            <StatItem label="Log Reads" value={formatNumberShort(node.logicalReads)} />
          </div>
        </div>
      )}

      {/* Tree position info */}
      <div className="p-4 border-t border-gray-200 dark:border-gray-700">
        <h4 className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">Tree Position</h4>
        <div className="text-sm text-gray-600 dark:text-gray-400">
          <div>Depth: {node.depth}</div>
          <div>Children: {node.children.length}</div>
          {node.parentId !== undefined && <div>Parent ID: {node.parentId}</div>}
        </div>
      </div>

      {ancestry.length > 0 && (
        <div className="p-4 border-t border-gray-200 dark:border-gray-700">
          <h4 className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">Ancestry</h4>
          <div className="flex flex-wrap gap-2">
            {ancestry.map((ancestor) => (
              <button
                key={ancestor.id}
                onClick={() => selectNode(ancestor.id)}
                className="px-2 py-1 rounded text-xs bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-200 hover:bg-gray-200 dark:hover:bg-gray-600 transition-colors"
                title={ancestor.operation}
              >
                {ancestor.id}: {ancestor.operation}
              </button>
            ))}
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
    <div className={`rounded p-2 ${highlight ? highlightStyles[highlight] : 'bg-gray-50 dark:bg-gray-900'}`}>
      <div className="text-xs text-gray-500 dark:text-gray-400">{label}</div>
      <div className={`text-sm font-medium ${highlight ? valueStyles[highlight] : 'text-gray-900 dark:text-gray-100'}`}>{value}</div>
    </div>
  );
}
