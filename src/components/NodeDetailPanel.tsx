import { useState, useCallback, useMemo, type PointerEvent as ReactPointerEvent } from 'react';
import { usePlan } from '../hooks/usePlanContext';
import { getOperationCategory, COLOR_SCHEMES, getMetricColor, getOperationTooltip } from '../lib/types';
import { formatBytes, formatNumberShort, formatTimeCompact, formatTimeDetailed, computeCardinalityRatio, formatCardinalityRatio, cardinalityRatioSeverity } from '../lib/format';
import type { PlanNode as PlanNodeType, NodeIndicatorMetric } from '../lib/types';
import { HighlightText } from './HighlightText';
import { AnnotationEditor, BulkHighlightPicker } from './AnnotationEditor';
import { GroupAnnotationDialog } from './GroupAnnotationDialog';
import { HIGHLIGHT_COLORS } from '../lib/annotations';
import type { HighlightColor } from '../lib/annotations';

const HIGHLIGHT_COLORS_MAP: Record<HighlightColor, string> = Object.fromEntries(
  HIGHLIGHT_COLORS.map((c) => [c.name, c.chip])
) as Record<HighlightColor, string>;

interface NodeDetailPanelProps {
  panelWidth: number;
  onResizeStart: (event: ReactPointerEvent<HTMLButtonElement>) => void;
}

export function NodeDetailPanel({ panelWidth, onResizeStart }: NodeDetailPanelProps) {
  const {
    selectedNode: selectedPrimaryNode, selectedNodes, selectedNodeIds, parsedPlan, selectNode,
    colorScheme, filters, nodeIndicatorMetric, annotations,
    setNodeAnnotation, removeNodeAnnotation, setNodeHighlight, removeNodeHighlight,
    addAnnotationGroup, updateAnnotationGroup, removeAnnotationGroup,
  } = usePlan();
  const [isCollapsed, setIsCollapsed] = useState(false);
  const searchText = filters.searchText;
  const [showGroupDialog, setShowGroupDialog] = useState(false);
  const [editingGroupId, setEditingGroupId] = useState<string | null>(null);
  const isMultiSelection = selectedNodes.length > 1;
  const selectedNode = selectedNodes.length === 1 ? selectedNodes[0] : selectedPrimaryNode;
  const aggregateSelection = isMultiSelection ? computeAggregateSelection(selectedNodes) : null;

  // Compute worst nodes — must be before any early returns to satisfy Rules of Hooks
  const worstNodes = useMemo(() => {
    if (!parsedPlan) return { byCost: [], byTime: [], byCardinalityMismatch: [] };

    const nonRoot = parsedPlan.allNodes.filter(n => n.parentId !== undefined);

    const byCost = [...nonRoot]
      .sort((a, b) => (b.cost || 0) - (a.cost || 0))
      .slice(0, 5);

    const byTime = parsedPlan.hasActualStats
      ? [...nonRoot]
          .filter(n => n.actualTime !== undefined)
          .sort((a, b) => (b.actualTime || 0) - (a.actualTime || 0))
          .slice(0, 5)
      : [];

    const byCardinalityMismatch = parsedPlan.hasActualStats
      ? [...nonRoot]
          .map(n => ({
            node: n,
            ratio: computeCardinalityRatio(n.rows, n.actualRows),
          }))
          .filter(item => item.ratio !== undefined && item.ratio !== 1)
          .sort((a, b) => {
            const devA = (a.ratio! >= 1 ? a.ratio! : 1 / a.ratio!);
            const devB = (b.ratio! >= 1 ? b.ratio! : 1 / b.ratio!);
            return devB - devA;
          })
          .slice(0, 5)
      : [];

    return { byCost, byTime, byCardinalityMismatch };
  }, [parsedPlan]);

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

  if (selectedNodes.length === 0) {
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
        <div className="p-3 border-b border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950/40">
          <div className="flex items-center justify-between">
            <h3 className="font-semibold text-sm text-slate-900 dark:text-slate-100">Hotspots</h3>
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
          <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-1">Click a row to select, or Cmd/Ctrl-click nodes for multi-select</p>
        </div>

        {/* Worst by A-Time */}
        {worstNodes.byTime.length > 0 && (
          <div className="p-3 border-b border-slate-200 dark:border-slate-800">
            <h4 className="text-xs font-semibold text-slate-700 dark:text-slate-300 mb-2 uppercase tracking-wide flex items-center gap-1">
              <svg className="w-3.5 h-3.5 text-red-500" viewBox="0 0 20 20" fill="currentColor"><path fillRule="evenodd" d="M12.395 2.553a1 1 0 00-1.45-.385c-.345.23-.614.558-.822.88-.214.33-.403.713-.57 1.116-.334.804-.614 1.768-.84 2.734a31.365 31.365 0 00-.613 3.58 2.64 2.64 0 01-.945-1.067c-.328-.68-.398-1.534-.398-2.654A1 1 0 005.05 6.05 6.981 6.981 0 003 11a7 7 0 1011.95-4.95c-.592-.591-.98-.985-1.348-1.467-.363-.476-.724-1.063-1.207-2.03zM12.12 15.12A3 3 0 017 13s.879.5 2.5.5c0-1 .5-4 1.25-4.5.5 1 .786 1.293 1.371 1.879A2.99 2.99 0 0113 13a2.99 2.99 0 01-.879 2.121z" clipRule="evenodd" /></svg>
              Slowest by A-Time
            </h4>
            <div className="space-y-1">
              {worstNodes.byTime.map(n => (
                <button
                  key={n.id}
                  onClick={() => selectNode(n.id)}
                  className="w-full text-left px-2 py-1.5 text-xs rounded hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors flex items-center justify-between gap-2"
                >
                  <span className="flex items-center gap-1.5 truncate">
                    <span className="w-5 h-5 rounded-full bg-slate-700 dark:bg-slate-300 text-white dark:text-slate-900 text-[10px] font-bold flex items-center justify-center shrink-0">{n.id}</span>
                    <span className="truncate text-slate-700 dark:text-slate-300">{n.operation}</span>
                  </span>
                  <span className="text-purple-600 dark:text-purple-400 font-medium whitespace-nowrap">{formatTimeCompact(n.actualTime)}</span>
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Worst by Cost */}
        {worstNodes.byCost.length > 0 && (
          <div className="p-3 border-b border-slate-200 dark:border-slate-800">
            <h4 className="text-xs font-semibold text-slate-700 dark:text-slate-300 mb-2 uppercase tracking-wide">Highest Cost</h4>
            <div className="space-y-1">
              {worstNodes.byCost.map(n => (
                <button
                  key={n.id}
                  onClick={() => selectNode(n.id)}
                  className="w-full text-left px-2 py-1.5 text-xs rounded hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors flex items-center justify-between gap-2"
                >
                  <span className="flex items-center gap-1.5 truncate">
                    <span className="w-5 h-5 rounded-full bg-slate-700 dark:bg-slate-300 text-white dark:text-slate-900 text-[10px] font-bold flex items-center justify-center shrink-0">{n.id}</span>
                    <span className="truncate text-slate-700 dark:text-slate-300">{n.operation}</span>
                  </span>
                  <span className="text-slate-600 dark:text-slate-400 font-medium whitespace-nowrap">{n.cost}</span>
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Worst Cardinality Mismatches */}
        {worstNodes.byCardinalityMismatch.length > 0 && (
          <div className="p-3 border-b border-slate-200 dark:border-slate-800">
            <h4 className="text-xs font-semibold text-slate-700 dark:text-slate-300 mb-2 uppercase tracking-wide">Worst Cardinality Mismatches</h4>
            <div className="space-y-1">
              {worstNodes.byCardinalityMismatch.map(({ node: n, ratio }) => {
                const severity = cardinalityRatioSeverity(ratio);
                const label = formatCardinalityRatio(ratio);
                return (
                  <button
                    key={n.id}
                    onClick={() => selectNode(n.id)}
                    className="w-full text-left px-2 py-1.5 text-xs rounded hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors flex items-center justify-between gap-2"
                  >
                    <span className="flex items-center gap-1.5 truncate">
                      <span className="w-5 h-5 rounded-full bg-slate-700 dark:bg-slate-300 text-white dark:text-slate-900 text-[10px] font-bold flex items-center justify-center shrink-0">{n.id}</span>
                      <span className="truncate text-slate-700 dark:text-slate-300">{n.operation}</span>
                    </span>
                    <span className={`font-medium whitespace-nowrap ${
                      severity === 'bad' ? 'text-red-600 dark:text-red-400' : 'text-amber-600 dark:text-amber-400'
                    }`}>{label}</span>
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {/* Annotation Groups */}
        {annotations.groups.length > 0 && (
          <div className="p-3">
            <h4 className="text-xs font-semibold text-slate-700 dark:text-slate-300 mb-2 uppercase tracking-wide">Annotation Groups</h4>
            <div className="space-y-1">
              {annotations.groups.map((group) => {
                const colorDef = HIGHLIGHT_COLORS_MAP[group.color];
                return (
                  <div
                    key={group.id}
                    className="flex items-center justify-between px-2 py-1.5 text-xs rounded hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
                  >
                    <span className="flex items-center gap-1.5 truncate">
                      <span className={`w-3 h-3 rounded-full shrink-0 ${colorDef}`} />
                      <span className="truncate text-slate-700 dark:text-slate-300">{group.name}</span>
                      <span className="text-[10px] text-slate-400">({group.nodeIds.length})</span>
                    </span>
                    <button
                      onClick={() => setEditingGroupId(group.id)}
                      className="p-0.5 hover:bg-slate-200 dark:hover:bg-slate-700 rounded"
                      title="Edit group"
                    >
                      <svg className="w-3 h-3 text-slate-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                      </svg>
                    </button>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {editingGroupId && (() => {
          const group = annotations.groups.find((g) => g.id === editingGroupId);
          if (!group) return null;
          return (
            <GroupAnnotationDialog
              nodeIds={group.nodeIds}
              existingGroup={group}
              onSave={(data) => {
                updateAnnotationGroup({ ...group, ...data });
                setEditingGroupId(null);
              }}
              onDelete={() => {
                removeAnnotationGroup(group.id);
                setEditingGroupId(null);
              }}
              onClose={() => setEditingGroupId(null)}
            />
          );
        })()}
      </div>
    );
  }

  if (isMultiSelection && aggregateSelection) {
    const indicator = computeNodeDetailIndicator(aggregateSelection.indicatorNode, parsedPlan, nodeIndicatorMetric);
    const selectedIdPreview = selectedNodeIds.slice(0, 12).join(', ');
    const hasMoreIds = selectedNodeIds.length > 12;

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

        <div className="p-3 border-b border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950/40">
          <div className="flex items-start justify-between">
            <div>
              <span className="inline-block px-2 py-0.5 rounded text-[11px] font-semibold border border-slate-300 dark:border-slate-700 text-slate-700 dark:text-slate-300 bg-white dark:bg-slate-900">
                Multi Selection
              </span>
              <h3 className="mt-2 font-semibold text-sm text-slate-900 dark:text-slate-100">
                {selectedNodes.length} nodes selected
              </h3>
              <div className="mt-1 text-[11px] text-slate-600 dark:text-slate-400 break-all">
                IDs: {selectedIdPreview}{hasMoreIds ? ', ...' : ''}
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
                title="Clear selection"
              >
                <svg className="w-4 h-4 text-slate-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
          </div>
        </div>

        {/* Bulk annotation controls */}
        <div className="p-3 border-b border-slate-200 dark:border-slate-800">
          <h4 className="text-xs font-semibold text-slate-700 dark:text-slate-300 mb-2 uppercase tracking-wide">Annotate</h4>
          <BulkHighlightPicker
            nodeIds={selectedNodeIds}
            onHighlightChange={setNodeHighlight}
            onHighlightRemove={removeNodeHighlight}
          />
          <button
            onClick={() => setShowGroupDialog(true)}
            className="mt-2 w-full px-2.5 py-1.5 text-xs font-medium text-blue-700 dark:text-blue-300 bg-blue-50 dark:bg-blue-900/30 border border-blue-200 dark:border-blue-800 rounded-md hover:bg-blue-100 dark:hover:bg-blue-900/50 transition-colors"
          >
            Create Group from Selection
          </button>
        </div>

        {showGroupDialog && (
          <GroupAnnotationDialog
            nodeIds={selectedNodeIds}
            onSave={(data) => {
              addAnnotationGroup(data);
              setShowGroupDialog(false);
            }}
            onClose={() => setShowGroupDialog(false)}
          />
        )}

        {editingGroupId && (() => {
          const group = annotations.groups.find((g) => g.id === editingGroupId);
          if (!group) return null;
          return (
            <GroupAnnotationDialog
              nodeIds={group.nodeIds}
              existingGroup={group}
              onSave={(data) => {
                updateAnnotationGroup({ ...group, ...data });
                setEditingGroupId(null);
              }}
              onDelete={() => {
                removeAnnotationGroup(group.id);
                setEditingGroupId(null);
              }}
              onClose={() => setEditingGroupId(null)}
            />
          );
        })()}

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

        {parsedPlan?.hasActualStats && (
          <div className="p-3 border-b border-slate-200 dark:border-slate-800">
            <h4 className="text-xs font-semibold text-slate-700 dark:text-slate-300 mb-2 uppercase tracking-wide">Actual Statistics (Selection)</h4>
            <div className="grid grid-cols-2 gap-3">
              <StatItem label="A-Rows" value={formatNumberShort(aggregateSelection.sumActualRows)} highlight="blue" />
              <StatItem label="A-Time" value={formatTimeDetailed(aggregateSelection.sumActualTime)} highlight="purple" />
              <StatItem label="Starts" value={formatNumberShort(aggregateSelection.sumStarts)} highlight="orange" />
              <StatItem label="Avg Activity %" value={aggregateSelection.avgActivityPercent !== undefined ? `${aggregateSelection.avgActivityPercent.toFixed(1)}%` : undefined} />
            </div>
          </div>
        )}

        <div className="p-3 border-b border-slate-200 dark:border-slate-800">
          <h4 className="text-xs font-semibold text-slate-700 dark:text-slate-300 mb-2 uppercase tracking-wide">
            {parsedPlan?.hasActualStats ? 'Estimated Statistics (Selection)' : 'Statistics (Selection)'}
          </h4>
          <div className="grid grid-cols-2 gap-3">
            <StatItem label={parsedPlan?.hasActualStats ? "E-Rows" : "Rows"} value={formatNumberShort(aggregateSelection.sumRows)} />
            <StatItem label="Bytes" value={formatBytes(aggregateSelection.sumBytes)} />
            <StatItem label="Cost" value={formatNumberShort(aggregateSelection.sumCost)} />
            <StatItem label="Avg CPU %" value={aggregateSelection.avgCpuPercent !== undefined ? `${aggregateSelection.avgCpuPercent.toFixed(1)}%` : undefined} />
            <StatItem label="Temp Space" value={aggregateSelection.sumTempSpace > 0 ? formatBytes(aggregateSelection.sumTempSpace) : undefined} />
          </div>
        </div>

        {(aggregateSelection.sumMemoryUsed > 0 ||
          aggregateSelection.sumTempUsed > 0 ||
          aggregateSelection.sumPhysicalReads > 0 ||
          aggregateSelection.sumLogicalReads > 0) && (
          <div className="p-3 border-t border-slate-200 dark:border-slate-800">
            <h4 className="text-xs font-semibold text-slate-700 dark:text-slate-300 mb-2 uppercase tracking-wide">Memory & I/O (Selection)</h4>
            <div className="grid grid-cols-2 gap-3">
              <StatItem label="Memory" value={aggregateSelection.sumMemoryUsed > 0 ? formatBytes(aggregateSelection.sumMemoryUsed) : undefined} />
              <StatItem label="Temp Used" value={aggregateSelection.sumTempUsed > 0 ? formatBytes(aggregateSelection.sumTempUsed) : undefined} />
              <StatItem label="Phys Reads" value={formatNumberShort(aggregateSelection.sumPhysicalReads)} />
              <StatItem label="Log Reads" value={formatNumberShort(aggregateSelection.sumLogicalReads)} />
            </div>
          </div>
        )}
      </div>
    );
  }

  const node = selectedNode!;
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

        {/* Operation tooltip */}
        {(() => {
          const tip = getOperationTooltip(node.operation);
          return tip ? (
            <div className="mt-2 text-[11px] text-slate-500 dark:text-slate-400 italic leading-snug">
              {tip}
            </div>
          ) : null;
        })()}
      </div>

      {/* Annotation Editor */}
      <AnnotationEditor
        nodeId={node.id}
        annotationText={annotations.nodeAnnotations.get(node.id)?.text || ''}
        highlightColor={annotations.nodeHighlights.get(node.id)?.color}
        onTextChange={setNodeAnnotation}
        onTextRemove={removeNodeAnnotation}
        onHighlightChange={setNodeHighlight}
        onHighlightRemove={removeNodeHighlight}
      />

      {/* Cardinality Mismatch */}
      {(() => {
        const ratio = computeCardinalityRatio(node.rows, node.actualRows);
        const severity = cardinalityRatioSeverity(ratio);
        const label = formatCardinalityRatio(ratio);
        if (severity === 'good' || !label) return null;
        return (
          <div className={`p-3 border-b border-slate-200 dark:border-slate-800 ${
            severity === 'bad'
              ? 'bg-red-50 dark:bg-red-950/30'
              : 'bg-amber-50 dark:bg-amber-950/30'
          }`}>
            <div className="flex items-center justify-between mb-1">
              <span className={`text-xs font-semibold uppercase tracking-wide ${
                severity === 'bad'
                  ? 'text-red-700 dark:text-red-300'
                  : 'text-amber-700 dark:text-amber-300'
              }`}>Cardinality Mismatch</span>
              <span className={`text-xs font-bold ${
                severity === 'bad'
                  ? 'text-red-600 dark:text-red-400'
                  : 'text-amber-600 dark:text-amber-400'
              }`}>{label}</span>
            </div>
            <div className="text-xs text-slate-600 dark:text-slate-400">
              E-Rows: {formatNumberShort(node.rows)} → A-Rows: {formatNumberShort(node.actualRows)}
            </div>
          </div>
        );
      })()}

      {/* Spill Warning */}
      {node.tempUsed !== undefined && node.tempUsed > 0 && (
        <div className="p-3 border-b border-slate-200 dark:border-slate-800 bg-yellow-50 dark:bg-yellow-950/30">
          <div className="flex items-center gap-1.5">
            <span className="text-xs font-semibold uppercase tracking-wide text-yellow-700 dark:text-yellow-300">
              Spill to Disk
            </span>
            <span className="text-xs text-yellow-600 dark:text-yellow-400">
              {formatBytes(node.tempUsed)} temp space used
            </span>
          </div>
        </div>
      )}

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
                <CopyButton text={node.accessPredicates} label="Copy access predicate" />
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
                <CopyButton text={node.filterPredicates} label="Copy filter predicate" />
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

function CopyButton({ text, label }: { text: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  const handleCopy = useCallback(() => {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  }, [text]);

  return (
    <button
      onClick={handleCopy}
      className="p-1 hover:bg-slate-200 dark:hover:bg-slate-700 rounded transition-colors"
      title={label || 'Copy to clipboard'}
    >
      {copied ? (
        <svg className="w-3.5 h-3.5 text-green-600 dark:text-green-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
        </svg>
      ) : (
        <svg className="w-3.5 h-3.5 text-slate-500 dark:text-slate-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
        </svg>
      )}
    </button>
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

interface AggregateSelectionStats {
  indicatorNode: PlanNodeType;
  sumRows: number;
  sumBytes: number;
  sumCost: number;
  sumActualRows: number;
  sumActualTime: number;
  sumStarts: number;
  avgActivityPercent: number | undefined;
  avgCpuPercent: number | undefined;
  sumTempSpace: number;
  sumMemoryUsed: number;
  sumTempUsed: number;
  sumPhysicalReads: number;
  sumLogicalReads: number;
}

function computeAggregateSelection(nodes: PlanNodeType[]): AggregateSelectionStats {
  const sumRows = sumNumbers(nodes.map((n) => n.rows));
  const sumBytes = sumNumbers(nodes.map((n) => n.bytes));
  const sumCost = sumNumbers(nodes.map((n) => n.cost));
  const sumActualRows = sumNumbers(nodes.map((n) => n.actualRows));
  const sumActualTime = sumNumbers(nodes.map((n) => n.actualTime));
  const sumStarts = sumNumbers(nodes.map((n) => n.starts));
  const avgActivityPercent = averageNumbers(nodes.map((n) => n.activityPercent));
  const avgCpuPercent = averageNumbers(nodes.map((n) => n.cpuPercent));
  const sumTempSpace = sumNumbers(nodes.map((n) => n.tempSpace));
  const sumMemoryUsed = sumNumbers(nodes.map((n) => n.memoryUsed));
  const sumTempUsed = sumNumbers(nodes.map((n) => n.tempUsed));
  const sumPhysicalReads = sumNumbers(nodes.map((n) => n.physicalReads));
  const sumLogicalReads = sumNumbers(nodes.map((n) => n.logicalReads));

  return {
    indicatorNode: {
      id: -1,
      depth: 0,
      operation: `${nodes.length} nodes`,
      children: [],
      cost: sumCost,
      actualRows: sumActualRows,
      actualTime: sumActualTime,
      starts: sumStarts,
      activityPercent: avgActivityPercent,
    },
    sumRows,
    sumBytes,
    sumCost,
    sumActualRows,
    sumActualTime,
    sumStarts,
    avgActivityPercent,
    avgCpuPercent,
    sumTempSpace,
    sumMemoryUsed,
    sumTempUsed,
    sumPhysicalReads,
    sumLogicalReads,
  };
}

function sumNumbers(values: Array<number | undefined>): number {
  return values.reduce<number>((total, value) => total + (value ?? 0), 0);
}

function averageNumbers(values: Array<number | undefined>): number | undefined {
  const definedValues = values.filter((value): value is number => value !== undefined);
  if (definedValues.length === 0) return undefined;
  return definedValues.reduce((total, value) => total + value, 0) / definedValues.length;
}
