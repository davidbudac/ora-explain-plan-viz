import { usePlan } from '../hooks/usePlanContext';
import { getOperationCategory, CATEGORY_COLORS, getCostColor } from '../lib/types';

export function NodeDetailPanel() {
  const { getSelectedNode, parsedPlan, selectNode } = usePlan();
  const node = getSelectedNode();

  if (!node) {
    return (
      <div className="w-80 bg-white dark:bg-gray-800 border-l border-gray-200 dark:border-gray-700 p-4">
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
  const colors = CATEGORY_COLORS[category];
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
                {node.operation}
              </h3>
            </div>
          </div>
          <button
            onClick={() => selectNode(null)}
            className="p-1 hover:bg-gray-200 dark:hover:bg-gray-700 rounded"
          >
            <svg className="w-5 h-5 text-gray-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {node.objectName && (
          <div className="mt-2 font-mono text-sm text-gray-600 dark:text-gray-400">
            {node.objectName}
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

      {/* Statistics */}
      <div className="p-4 border-b border-gray-200 dark:border-gray-700">
        <h4 className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-3">Statistics</h4>
        <div className="grid grid-cols-2 gap-3">
          <StatItem label="Rows" value={formatNumber(node.rows)} />
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
                {node.accessPredicates}
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
                {node.filterPredicates}
              </code>
            </div>
          )}
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
    </div>
  );
}

function StatItem({ label, value }: { label: string; value?: string }) {
  if (!value) return null;

  return (
    <div className="bg-gray-50 dark:bg-gray-900 rounded p-2">
      <div className="text-xs text-gray-500 dark:text-gray-400">{label}</div>
      <div className="text-sm font-medium text-gray-900 dark:text-gray-100">{value}</div>
    </div>
  );
}

function formatNumber(num?: number): string | undefined {
  if (num === undefined) return undefined;
  if (num >= 1000000) {
    return (num / 1000000).toFixed(1) + 'M';
  }
  if (num >= 1000) {
    return (num / 1000).toFixed(1) + 'K';
  }
  return num.toString();
}

function formatBytes(bytes?: number): string | undefined {
  if (bytes === undefined) return undefined;
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
