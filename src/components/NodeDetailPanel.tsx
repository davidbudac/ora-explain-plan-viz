import { useState, useCallback, useMemo, type PointerEvent as ReactPointerEvent } from 'react';
import { usePlan } from '../hooks/usePlanContext';
import { getOperationCategory, getMetricColor, getOperationTooltip } from '../lib/types';
import { formatBytes, formatNumberShort, formatTimeCompact, formatTimeDetailed } from '../lib/format';
import type { PlanNode as PlanNodeType, NodeIndicatorMetric } from '../lib/types';
import { HighlightText } from './HighlightText';
import { FormattedPredicate } from './FormattedPredicate';
import { AnnotationEditor, BulkHighlightPicker } from './AnnotationEditor';
import { GroupAnnotationDialog } from './GroupAnnotationDialog';
import { HIGHLIGHT_COLORS } from '../lib/annotations';
import type { HighlightColor } from '../lib/annotations';
import { findObjectInBundle } from '../lib/metadata/lookup';
import { extractPredicateColumns } from '../lib/metadata/predicateColumns';
import { resolveIndexesForBlock, findUsedIndexKeys, type ResolvedIndex } from '../lib/metadata/indexes';
import { findCoverageWarning } from '../lib/metadata/dropClassify';
import type { TableStats, ColumnStats, TableObject, MetadataBundle } from '../lib/metadata/bundle';
import { GatherScriptModal } from './GatherScriptModal';
import { assessPartitionPruning, computeParallelSignals } from '../lib/planSignals';
import type { ParallelSignal } from '../lib/planSignals';
import { FindingsList, NodeFindings } from './FindingsPanel';

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
    filters, nodeIndicatorMetric, annotations,
    setNodeAnnotation, removeNodeAnnotation, setNodeHighlight, removeNodeHighlight,
    addAnnotationGroup, updateAnnotationGroup, removeAnnotationGroup,
    hotspotsEnabled, setHotspotsEnabled,
    detailPanelCollapsed: isCollapsed, setDetailPanelCollapsed: setIsCollapsed,
    highlightStyle, setHighlightStyle,
    metadataBundle, metadataBundleWarning,
    advisorReport,
  } = usePlan();
  const searchText = filters.searchText;
  const [showGroupDialog, setShowGroupDialog] = useState(false);
  const [editingGroupId, setEditingGroupId] = useState<string | null>(null);
  const isMultiSelection = selectedNodes.length > 1;
  const selectedNode = selectedNodes.length === 1 ? selectedNodes[0] : selectedPrimaryNode;
  const aggregateSelection = isMultiSelection ? computeAggregateSelection(selectedNodes) : null;

  // Compute worst nodes — must be before any early returns to satisfy Rules of Hooks
  const worstNodes = useMemo(() => {
    if (!parsedPlan) return { byCost: [], byTime: [] };

    const nonRoot = parsedPlan.allNodes.filter(n => n.parentId !== undefined);

    const byCost = [...nonRoot]
      .sort((a, b) => (b.cost || 0) - (a.cost || 0))
      .slice(0, 5);

    // Rank by SELF time (own work, excluding children) — cumulative A-Time
    // would surface one hot leaf plus its entire ancestor chain.
    const byTime = parsedPlan.hasActualStats
      ? [...nonRoot]
          .filter(n => (n.selfTime ?? n.actualTime) !== undefined)
          .sort((a, b) => (b.selfTime ?? b.actualTime ?? 0) - (a.selfTime ?? a.actualTime ?? 0))
          .slice(0, 5)
      : [];

    return { byCost, byTime };
  }, [parsedPlan]);

  const usedIndexKeys = useMemo(() => {
    if (!metadataBundle || !parsedPlan) return new Set<string>();
    return findUsedIndexKeys(metadataBundle, parsedPlan.allNodes);
  }, [metadataBundle, parsedPlan]);

  const parallelSignals = useMemo(() => {
    if (!parsedPlan) return [] as ParallelSignal[];
    return computeParallelSignals(parsedPlan);
  }, [parsedPlan]);

  if (isCollapsed) {
    return (
      <div className="bg-white dark:bg-slate-900 border-l border-slate-200 dark:border-slate-800 flex flex-col items-center py-4 px-1.5">
        <button
          onClick={() => setIsCollapsed(false)}
          className="h-9 w-9 flex items-center justify-center text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-md border border-slate-200 dark:border-slate-700 transition-colors"
          title="Show details"
        >
          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
        </button>
        <span className="text-[10px] font-semibold text-slate-400 dark:text-slate-500 mt-4 uppercase tracking-wider writing-mode-vertical whitespace-nowrap">Details</span>
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
          className="absolute left-0 top-0 z-10 h-full w-1 cursor-col-resize touch-none bg-transparent hover:bg-blue-500/40 transition-colors"
          aria-label="Resize details panel"
        />
        <div className="p-4 border-b border-slate-200 dark:border-slate-800">
          <div className="flex items-center justify-between">
             <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">Details</h3>
            <button
                onClick={() => setIsCollapsed(true)}
                className="p-1.5 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-md transition-colors text-slate-400 dark:text-slate-500"
                title="Collapse panel"
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M13 5l7 7-7 7M5 5l7 7-7 7" />
                </svg>
              </button>
          </div>
        </div>

        <div className="p-3 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between">
           <h3 className="text-[10px] font-semibold uppercase tracking-wider text-slate-400 dark:text-slate-500">Quick Analysis</h3>
           <div className="flex items-center gap-2">
              <span className="text-[10px] text-slate-400 dark:text-slate-500">Hotspots</span>
              <button
                role="switch"
                aria-checked={hotspotsEnabled}
                onClick={() => setHotspotsEnabled(!hotspotsEnabled)}
                className={`relative inline-flex h-4 w-7 items-center rounded-full transition-colors ${
                  hotspotsEnabled ? 'bg-red-500' : 'bg-slate-300 dark:bg-slate-700'
                }`}
              >
                <span className={`inline-block h-3 w-3 rounded-full bg-white transition-transform ${
                  hotspotsEnabled ? 'translate-x-3.5' : 'translate-x-0.5'
                }`} />
              </button>
           </div>
        </div>

        {advisorReport && advisorReport.findings.length > 0 && (
          <Accordion
            title="Findings"
            subtitle={`${advisorReport.findings.length}`}
          >
            <FindingsList />
          </Accordion>
        )}

        {hotspotsEnabled && (
          <>
            {/* Worst by A-Time */}
            {worstNodes.byTime.length > 0 && (
              <Accordion title="Slowest Ops" subtitle="by self time">
                <div className="space-y-1">
                  {worstNodes.byTime.map(n => {
                    const self = n.selfTime ?? n.actualTime;
                    const showTotal = n.selfTime !== undefined
                      && n.actualTime !== undefined
                      && n.actualTime > n.selfTime;
                    return (
                      <button
                        key={n.id}
                        onClick={() => selectNode(n.id)}
                        className="w-full text-left px-2 py-1.5 text-[11px] rounded hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors flex items-center justify-between gap-2 border border-transparent hover:border-slate-200 dark:hover:border-slate-700 font-mono"
                      >
                        <span className="flex items-center gap-1.5 truncate">
                          <span className="font-mono text-[11px] px-1.5 py-0.5 rounded border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-slate-500 shrink-0">#{n.id}</span>
                          <span className="truncate font-semibold">{n.operation}</span>
                        </span>
                        <span className="whitespace-nowrap shrink-0">
                          <span className="text-red-600 dark:text-red-400 font-semibold">{formatTimeCompact(self)}</span>
                          {showTotal && (
                            <span className="text-slate-400 dark:text-slate-500"> · {formatTimeCompact(n.actualTime)} total</span>
                          )}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </Accordion>
            )}

            {/* Worst by Cost */}
            {worstNodes.byCost.length > 0 && (
              <Accordion title="Highest Cost" defaultOpen={false}>
                <div className="space-y-1">
                  {worstNodes.byCost.map(n => (
                    <button
                      key={n.id}
                      onClick={() => selectNode(n.id)}
                      className="w-full text-left px-2 py-1.5 text-[11px] rounded hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors flex items-center justify-between gap-2 border border-transparent hover:border-slate-200 dark:hover:border-slate-700 font-mono"
                    >
                      <span className="flex items-center gap-1.5 truncate">
                        <span className="font-mono text-[11px] px-1.5 py-0.5 rounded border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-slate-500 shrink-0">#{n.id}</span>
                        <span className="truncate font-semibold">{n.operation}</span>
                      </span>
                      <span className="text-slate-600 dark:text-slate-400 font-semibold">{n.cost}</span>
                    </button>
                  ))}
                </div>
              </Accordion>
            )}

          </>
        )}

        {/* Bind Variables */}
        {parsedPlan?.bindVariables && parsedPlan.bindVariables.length > 0 && (
          <div className="p-3 border-b border-slate-200 dark:border-slate-800">
            <h4 className="text-[10px] font-semibold uppercase tracking-wider text-slate-400 dark:text-slate-500 mb-2">
              Bind Variables ({parsedPlan.bindVariables.length})
            </h4>
            <div className="space-y-1.5">
              {parsedPlan.bindVariables.map((bind, idx) => (
                <div key={bind.name + idx} className="flex items-start gap-2 text-xs">
                  <span className="font-mono text-blue-600 dark:text-blue-400 shrink-0">{bind.name}</span>
                  {bind.type && (
                    <span className="px-1.5 py-0.5 bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400 rounded text-[10px] font-medium shrink-0">
                      {bind.type}
                    </span>
                  )}
                  <span className="flex-1 min-w-0 flex items-center gap-1">
                    {bind.value === null ? (
                      <span className="italic text-slate-400 dark:text-slate-500">NULL</span>
                    ) : (
                      <>
                        <code className="font-mono text-slate-800 dark:text-slate-200 truncate block">{bind.value}</code>
                        <CopyButton text={bind.value} label={`Copy ${bind.name} value`} />
                      </>
                    )}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Annotation Groups */}
        {annotations.groups.length > 0 && (
          <div className="p-3">
            <h4 className="text-[10px] font-semibold uppercase tracking-wider text-slate-400 dark:text-slate-500 mb-2">Annotation Groups</h4>
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

        <div className="p-4 border-b border-slate-200 dark:border-slate-800">
          <div className="flex items-start justify-between">
            <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
              {selectedNodes.length} nodes selected
            </h3>
            <button
              onClick={() => selectNode(null)}
              className="p-1.5 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-md transition-colors text-slate-400"
              title="Clear selection"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
          <div className="mt-2 text-[11px] font-mono text-slate-500 dark:text-slate-400 break-all">
            <span className="text-slate-400 dark:text-slate-500 mr-1">IDs:</span> {selectedIdPreview}{hasMoreIds ? '...' : ''}
          </div>
        </div>

        {/* Bulk annotation controls */}
        <Accordion title="Bulk Annotate" defaultOpen={false}>
          <BulkHighlightPicker
            nodeIds={selectedNodeIds}
            onHighlightChange={setNodeHighlight}
            onHighlightRemove={removeNodeHighlight}
          />
          <button
            onClick={() => setShowGroupDialog(true)}
            className="mt-3 w-full px-3 py-2 text-[11px] font-medium text-blue-600 dark:text-blue-400 bg-blue-500/10 border border-blue-500/20 rounded-md hover:bg-blue-500/20 transition-colors"
          >
            Create Group
          </button>
        </Accordion>

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

        <Accordion title={indicator.title}>
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-mono font-semibold tabular-nums text-slate-900 dark:text-slate-100">{indicator.formattedValue}</span>
            <span className="text-[10px] text-slate-400 dark:text-slate-500">{indicator.percentText}% {indicator.referenceLabel}</span>
          </div>
          <div className="h-1 rounded-full bg-slate-200 dark:bg-slate-700">
            <div
              className={`h-full rounded-full ${indicator.color} transition-all duration-500 ease-out`}
              style={{ width: `${Math.min(100, indicator.ratio * 100)}%` }}
            />
          </div>
        </Accordion>

        {parsedPlan?.hasActualStats && (
          <Accordion title="Execution Stats (Sum)">
            <div className="grid grid-cols-2 gap-px bg-slate-200 dark:bg-slate-800 border border-slate-200 dark:border-slate-800 rounded-md overflow-hidden [&>*:last-child:nth-child(odd)]:col-span-2">
              <StatItem label="A-Rows" value={formatNumberShort(aggregateSelection.sumActualRows)} highlight="blue" />
              <StatItem label="A-Time" value={formatTimeDetailed(aggregateSelection.sumActualTime)} highlight="purple" />
              <StatItem label="Starts" value={formatNumberShort(aggregateSelection.sumStarts)} highlight="orange" />
              <StatItem label="Avg Activity" value={aggregateSelection.avgActivityPercent !== undefined ? `${aggregateSelection.avgActivityPercent.toFixed(1)}%` : undefined} />
            </div>
          </Accordion>
        )}

        <Accordion title="Plan Estimates (Sum)" defaultOpen={!parsedPlan?.hasActualStats}>
          <div className="grid grid-cols-2 gap-px bg-slate-200 dark:bg-slate-800 border border-slate-200 dark:border-slate-800 rounded-md overflow-hidden [&>*:last-child:nth-child(odd)]:col-span-2">
            <StatItem label={parsedPlan?.hasActualStats ? "E-Rows" : "Rows"} value={formatNumberShort(aggregateSelection.sumRows)} />
            <StatItem label="Bytes" value={formatBytes(aggregateSelection.sumBytes)} />
            <StatItem label="Cost" value={formatNumberShort(aggregateSelection.sumCost)} />
            <StatItem label="Avg CPU %" value={aggregateSelection.avgCpuPercent !== undefined ? `${aggregateSelection.avgCpuPercent.toFixed(1)}%` : undefined} />
            <StatItem label="Temp Space" value={aggregateSelection.sumTempSpace > 0 ? formatBytes(aggregateSelection.sumTempSpace) : undefined} />
          </div>
        </Accordion>

        {(aggregateSelection.sumMemoryUsed > 0 ||
          aggregateSelection.sumTempUsed > 0 ||
          aggregateSelection.sumPhysicalReads > 0 ||
          aggregateSelection.sumLogicalReads > 0) && (
          <Accordion title="Resources (Sum)" defaultOpen={false}>
            <div className="grid grid-cols-2 gap-px bg-slate-200 dark:bg-slate-800 border border-slate-200 dark:border-slate-800 rounded-md overflow-hidden [&>*:last-child:nth-child(odd)]:col-span-2">
              <StatItem label="Memory" value={aggregateSelection.sumMemoryUsed > 0 ? formatBytes(aggregateSelection.sumMemoryUsed) : undefined} />
              <StatItem label="Temp Used" value={aggregateSelection.sumTempUsed > 0 ? formatBytes(aggregateSelection.sumTempUsed) : undefined} />
              <StatItem label="Phys Reads" value={formatNumberShort(aggregateSelection.sumPhysicalReads)} />
              <StatItem label="Log Reads" value={formatNumberShort(aggregateSelection.sumLogicalReads)} />
            </div>
          </Accordion>
        )}
      </div>
    );
  }

  const node = selectedNode!;
  const category = getOperationCategory(node.operation);
  const indicator = computeNodeDetailIndicator(node, parsedPlan, nodeIndicatorMetric);
  const pruning = assessPartitionPruning(node);
  const nodeParallelSignals = parallelSignals.filter((s) => s.nodeId === node.id);

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
      <div className="p-4 border-b border-slate-200 dark:border-slate-800">
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-2">
             <span className="font-mono text-[11px] px-1.5 py-0.5 rounded border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-slate-500">
                #{node.id}
             </span>
             <span className="text-[10px] font-semibold text-blue-600 dark:text-blue-400">{category}</span>
          </div>
          <button
            onClick={() => selectNode(null)}
            className="p-1.5 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-md transition-colors text-slate-400"
            title="Clear selection"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100 leading-tight">
          <HighlightText text={node.operation} query={searchText} />
        </h3>

        {node.objectName && (
          <div className="mt-1 font-mono text-[11px] text-blue-600 dark:text-blue-400 break-all">
            <HighlightText text={node.objectName} query={searchText} />
          </div>
        )}

        {(node.queryBlock || node.objectAlias) && (
          <div className="mt-1 font-mono text-[11px] text-slate-400 dark:text-slate-500">
            {[node.queryBlock, node.objectAlias].filter(Boolean).join(' · ')}
          </div>
        )}

        {/* Operation tooltip */}
        {(() => {
          const tip = getOperationTooltip(node.operation);
          return tip ? (
            <div className="mt-2 text-[11px] italic text-slate-500 dark:text-slate-400">
              {tip}
            </div>
          ) : null;
        })()}
      </div>

      {/* Advisor findings for this node */}
      <NodeFindings nodeId={node.id} />

      {/* Node indicator */}
      <Accordion title={indicator.title}>
        <div className="flex items-center justify-between mb-2">
          <span className="text-xs font-mono font-semibold tabular-nums text-slate-900 dark:text-slate-100">{indicator.formattedValue}</span>
          <span className="text-[10px] text-slate-400 dark:text-slate-500">{indicator.percentText}% {indicator.referenceLabel}</span>
        </div>
        <div className="h-1 rounded-full bg-slate-200 dark:bg-slate-700">
          <div
            className={`h-full rounded-full ${indicator.color} transition-all duration-500 ease-out`}
            style={{ width: `${Math.min(100, indicator.ratio * 100)}%` }}
          />
        </div>
      </Accordion>

      {/* Actual Statistics (SQL Monitor) */}
      {parsedPlan?.hasActualStats && (
        <Accordion title="Execution Stats">
          <div className="grid grid-cols-2 gap-px bg-slate-200 dark:bg-slate-800 border border-slate-200 dark:border-slate-800 rounded-md overflow-hidden [&>*:last-child:nth-child(odd)]:col-span-2">
            <StatItem label="A-Rows" value={formatNumberShort(node.actualRows)} highlight="blue" />
            {node.selfTime !== undefined && (
              <StatItem label="Self Time" value={formatTimeDetailed(node.selfTime)} highlight="purple" />
            )}
            <StatItem label="A-Time (cumul.)" value={formatTimeDetailed(node.actualTime)} />
            <StatItem label="Starts" value={formatNumberShort(node.starts)} highlight="orange" />
            {node.activityPercent !== undefined && (
              <StatItem label="Activity" value={`${node.activityPercent.toFixed(1)}%`} />
            )}
          </div>
        </Accordion>
      )}

      {/* Estimated Statistics */}
      <Accordion title="Plan Estimates" defaultOpen={!parsedPlan?.hasActualStats}>
        <div className="grid grid-cols-2 gap-px bg-slate-200 dark:bg-slate-800 border border-slate-200 dark:border-slate-800 rounded-md overflow-hidden [&>*:last-child:nth-child(odd)]:col-span-2">
          <StatItem label={parsedPlan?.hasActualStats ? "E-Rows" : "Rows"} value={formatNumberShort(node.rows)} />
          <StatItem label="Bytes" value={formatBytes(node.bytes)} />
          <StatItem label="Cost" value={node.cost?.toString()} />
          <StatItem label="CPU %" value={node.cpuPercent ? `${node.cpuPercent}%` : undefined} />
          <StatItem label="Time" value={node.time} />
          <StatItem label="Temp Space" value={node.tempSpace ? formatBytes(node.tempSpace) : undefined} />
          <StatItem label="Pstart" value={node.pstart} />
          <StatItem label="Pstop" value={node.pstop} />
        </div>
        {pruning === 'static' && (
          <div className="mt-2 text-[11px] text-slate-500 dark:text-slate-400">Static pruning</div>
        )}
        {pruning === 'runtime' && (
          <div className="mt-2 text-[11px] text-slate-500 dark:text-slate-400">Runtime pruning (determined at execution time, e.g. bloom filter/bind)</div>
        )}
        {pruning === 'none' && (
          <div className="mt-2 text-[11px] font-semibold text-amber-700 dark:text-amber-300">No pruning — all partitions scanned</div>
        )}
      </Accordion>

      {/* Parallel Execution */}
      {(node.tq || node.inOut || node.pqDistrib) && (
        <Accordion title="Parallel Execution" defaultOpen={false}>
          <div className="grid grid-cols-2 gap-px bg-slate-200 dark:bg-slate-800 border border-slate-200 dark:border-slate-800 rounded-md overflow-hidden [&>*:last-child:nth-child(odd)]:col-span-2">
            <StatItem label="TQ" value={node.tq} />
            <StatItem label="IN-OUT" value={node.inOut} />
            <StatItem label="PQ Distrib" value={node.pqDistrib} />
          </div>
          {nodeParallelSignals.length > 0 && (
            <div className="mt-2 space-y-2">
              {nodeParallelSignals.map((signal, idx) => (
                <div
                  key={`${signal.kind}-${idx}`}
                  className="p-2 text-[11px] rounded border bg-rose-50 dark:bg-rose-950/30 border-rose-200 dark:border-rose-800 text-rose-700 dark:text-rose-300 leading-snug"
                >
                  {signal.reason}
                </div>
              ))}
            </div>
          )}
        </Accordion>
      )}

      {/* Predicates */}
      {(node.accessPredicates || node.filterPredicates) && (
        <Accordion title="Predicates">
          {node.accessPredicates && (
            <div className="mb-3">
              <div className="flex items-center gap-2 mb-1">
                <span className="text-[10px] font-semibold uppercase tracking-wider text-emerald-600 dark:text-emerald-400">
                  Access
                </span>
                <CopyButton text={node.accessPredicates} />
              </div>
              <code className="block text-[11px] font-mono bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-md p-2.5 text-slate-800 dark:text-slate-200 whitespace-pre-wrap break-words leading-relaxed">
                <FormattedPredicate text={node.accessPredicates} searchQuery={searchText} />
              </code>
            </div>
          )}

          {node.filterPredicates && (
            <div>
              <div className="flex items-center gap-2 mb-1">
                <span className="text-[10px] font-semibold uppercase tracking-wider text-amber-600 dark:text-amber-400">
                  Filter
                </span>
                <CopyButton text={node.filterPredicates} />
              </div>
              <code className="block text-[11px] font-mono bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-md p-2.5 text-slate-800 dark:text-slate-200 whitespace-pre-wrap break-words leading-relaxed">
                <FormattedPredicate text={node.filterPredicates} searchQuery={searchText} />
              </code>
            </div>
          )}
        </Accordion>
      )}

      {/* Annotation Editor */}
      <AnnotationEditor
        nodeId={node.id}
        annotationText={annotations.nodeAnnotations.get(node.id)?.text || ''}
        highlightColor={annotations.nodeHighlights.get(node.id)?.color}
        highlightStyle={highlightStyle}
        onHighlightStyleChange={setHighlightStyle}
        onTextChange={setNodeAnnotation}
        onTextRemove={removeNodeAnnotation}
        onHighlightChange={setNodeHighlight}
        onHighlightRemove={removeNodeHighlight}
      />

      {/* Metadata (schema bundle) */}
      <MetadataSection
        bundle={metadataBundle}
        bundleWarning={metadataBundleWarning}
        match={metadataBundle ? findObjectInBundle(metadataBundle, node.objectName) : null}
        objectName={node.objectName}
        accessPredicates={node.accessPredicates}
        filterPredicates={node.filterPredicates}
        usedIndexKeys={usedIndexKeys}
        planSqlId={parsedPlan?.sqlId}
      />

      {/* Memory & I/O */}
      {(node.memoryUsed !== undefined ||
        node.tempUsed !== undefined ||
        node.physicalReads !== undefined ||
        node.logicalReads !== undefined ||
        node.ioReadBytes !== undefined ||
        node.ioWriteBytes !== undefined ||
        node.ioReadRequests !== undefined ||
        node.ioWriteRequests !== undefined) && (
        <Accordion title="Resources (I/O)" defaultOpen={false}>
          <div className="grid grid-cols-2 gap-px bg-slate-200 dark:bg-slate-800 border border-slate-200 dark:border-slate-800 rounded-md overflow-hidden [&>*:last-child:nth-child(odd)]:col-span-2">
            <StatItem label="Memory" value={formatBytes(node.memoryUsed)} />
            <StatItem label="Temp Used" value={formatBytes(node.tempUsed)} />
            <StatItem label="IO Read" value={formatBytes(node.ioReadBytes || undefined)} />
            <StatItem label="IO Write" value={formatBytes(node.ioWriteBytes || undefined)} />
            <StatItem label="Read Reqs" value={formatNumberShort((node.ioReadRequests ?? node.physicalReads) || undefined)} />
            <StatItem label="Write Reqs" value={formatNumberShort(node.ioWriteRequests || undefined)} />
            <StatItem label="Buffer Gets" value={formatNumberShort(node.logicalReads || undefined)} />
          </div>
        </Accordion>
      )}

    </div>
  );
}

function StatItem({ label, value, highlight }: { label: string; value?: string; highlight?: 'blue' | 'purple' | 'orange' }) {
  if (!value) return null;

  const valueStyles = {
    blue: 'text-blue-600 dark:text-blue-400',
    purple: 'text-purple-600 dark:text-purple-400',
    orange: 'text-orange-600 dark:text-orange-400',
  };

  return (
    <div className="bg-white dark:bg-slate-900 px-2.5 py-2">
      <div className="text-[10px] text-slate-400 dark:text-slate-500 mb-1">{label}</div>
      <div className={`text-xs font-mono font-semibold tabular-nums leading-none ${highlight ? valueStyles[highlight] : 'text-slate-900 dark:text-slate-100'}`}>{value}</div>
    </div>
  );
}

function Accordion({ title, subtitle, children, defaultOpen = true }: { title: string; subtitle?: string; children: React.ReactNode; defaultOpen?: boolean }) {
  return (
    <details className="group border-b border-slate-200 dark:border-slate-800" open={defaultOpen}>
      <summary className="flex items-center justify-between px-4 py-2.5 cursor-pointer hover:bg-slate-50 dark:hover:bg-slate-900/50 transition-colors list-none select-none">
        <div className="flex items-center gap-2.5">
          <h4 className="text-[10px] font-semibold uppercase tracking-wider text-slate-400 dark:text-slate-500">{title}</h4>
          {subtitle && <span className="text-[9px] text-slate-400 dark:text-slate-500 lowercase tracking-normal font-medium">{subtitle}</span>}
        </div>
        <svg className="w-4 h-4 text-slate-300 group-open:rotate-180 transition-transform duration-200" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M19 9l-7 7-7-7" />
        </svg>
      </summary>
      <div className="px-4 pb-3 overflow-hidden">
        {children}
      </div>
    </details>
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

function MetadataSection({
  bundle,
  bundleWarning,
  match,
  objectName,
  accessPredicates,
  filterPredicates,
  usedIndexKeys,
  planSqlId,
}: {
  bundle: MetadataBundle | null;
  bundleWarning: string | null;
  match: ReturnType<typeof findObjectInBundle>;
  objectName: string | undefined;
  accessPredicates?: string;
  filterPredicates?: string;
  usedIndexKeys: Set<string>;
  planSqlId?: string;
}) {
  const [showGatherModal, setShowGatherModal] = useState(false);
  const warningBanner = bundleWarning ? (
    <div className="mb-2 p-2 text-[11px] rounded border bg-amber-50 dark:bg-amber-900/20 border-amber-200 dark:border-amber-800 text-amber-800 dark:text-amber-300 leading-snug">
      {bundleWarning}
    </div>
  ) : null;
  if (!bundle) {
    return (
      <Accordion title="Metadata">
        {warningBanner}
        <p className="text-[11px] text-slate-500 dark:text-slate-400 leading-relaxed mb-3">
          No metadata loaded for this plan. Run the gather script to collect schema details (tables, indexes, column stats) for better analysis.
        </p>
        <button
          type="button"
          onClick={() => setShowGatherModal(true)}
          className="w-full text-[11px] font-bold py-1.5 rounded-lg border border-indigo-200 dark:border-indigo-800 bg-indigo-50 dark:bg-indigo-950/40 text-indigo-700 dark:text-indigo-300 hover:bg-indigo-100 dark:hover:bg-indigo-900/60 transition-colors uppercase tracking-wider"
        >
          {planSqlId ? 'Generate gather script' : 'Manual gather script'}
        </button>
        {showGatherModal && (
          <GatherScriptModal
            initialSqlId={planSqlId}
            initialMode={planSqlId ? 'sqlid' : 'manual'}
            onClose={() => setShowGatherModal(false)}
          />
        )}
      </Accordion>
    );
  }

  if (!match) {
    const coverage = findCoverageWarning(bundle, objectName);
    return (
      <Accordion title="Metadata" defaultOpen={false}>
        {warningBanner}
        {coverage ? (
          <div className="p-2 text-[10px] rounded-lg border bg-amber-500/5 dark:bg-amber-950/20 border-amber-500/20 text-amber-700 dark:text-amber-400 leading-snug">
            <div className="font-bold uppercase tracking-tight mb-1">Stats not captured</div>
            <div className="font-mono break-all">
              {coverage.object}: {coverage.reason}
            </div>
          </div>
        ) : (
          <div className="p-2 text-[11px] rounded-lg border bg-slate-50 dark:bg-slate-900 border-slate-200 dark:border-slate-800 text-slate-700 dark:text-slate-300 leading-relaxed italic">
            {objectName ? (
              <>
                <code className="font-mono not-italic font-bold">{objectName}</code> is missing from the bundle.
              </>
            ) : (
              'This operation has no object reference.'
            )}
          </div>
        )}
      </Accordion>
    );
  }

  if (match.object.type === 'INDEX') {
    const indexBlock = resolveIndexesForBlock(match, bundle);
    return (
      <Accordion title="Metadata">
        {warningBanner}
        <IndexObjectBlock objectKey={match.key} index={match.object} />
        <IndexesBlock
          tableKey={indexBlock.tableKey}
          indexes={indexBlock.indexes}
          usedIndexKeys={usedIndexKeys}
          heading={indexBlock.tableKey ? `Other indexes on ${indexBlock.tableKey}` : 'Other indexes'}
        />
        {match.object.ddl && <DdlBlock ddl={match.object.ddl} />}
      </Accordion>
    );
  }

  const indexBlock = resolveIndexesForBlock(match, bundle);
  return (
    <Accordion title="Metadata">
      {warningBanner}
      <ObjectBlock objectKey={match.key} stats={match.object.stats} />
      <ColumnsBlock
        table={match.object}
        accessPredicates={accessPredicates}
        filterPredicates={filterPredicates}
      />
      <IndexesBlock
        tableKey={indexBlock.tableKey}
        indexes={indexBlock.indexes}
        usedIndexKeys={usedIndexKeys}
        heading="Indexes"
      />
      {match.object.ddl && <DdlBlock ddl={match.object.ddl} />}
    </Accordion>
  );
}

function DdlBlock({ ddl }: { ddl: string }) {
  if (!ddl || !ddl.trim()) return null;
  return (
    <details className="group mt-4 pt-4 border-t border-slate-200 dark:border-slate-800" open={false}>
      <summary className="flex items-center justify-between cursor-pointer list-none select-none mb-2">
        <div className="flex items-center gap-1.5">
          <svg className="w-3.5 h-3.5 text-slate-300 group-open:rotate-180 transition-transform duration-200" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M19 9l-7 7-7-7" />
          </svg>
          <h5 className="text-[10px] font-semibold uppercase tracking-wider text-slate-400 dark:text-slate-500">
            DDL
          </h5>
        </div>
        <span
          role="button"
          tabIndex={0}
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
          }}
          className="inline-flex"
        >
          <CopyButton text={ddl} label="Copy DDL" />
        </span>
      </summary>
      <pre className="text-[10px] leading-relaxed font-mono bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-md p-2.5 text-slate-800 dark:text-slate-200 whitespace-pre overflow-auto max-h-72">
        {ddl.trim()}
      </pre>
    </details>
  );
}

function ColumnsBlock({
  table,
  accessPredicates,
  filterPredicates,
}: {
  table: TableObject;
  accessPredicates?: string;
  filterPredicates?: string;
}) {
  const [showAll, setShowAll] = useState(false);
  const predicateColumns = useMemo(
    () => extractPredicateColumns(accessPredicates, filterPredicates),
    [accessPredicates, filterPredicates],
  );
  const tableColumnNames = useMemo(() => Object.keys(table.columns), [table.columns]);
  const resolvedPredicateColumns = useMemo(
    () => predicateColumns.filter((c) => Object.prototype.hasOwnProperty.call(table.columns, c)),
    [predicateColumns, table.columns],
  );
  const hasResolvedPredicateColumns = resolvedPredicateColumns.length > 0;

  if (!hasResolvedPredicateColumns && !showAll) return null;

  const columnsToShow = showAll ? tableColumnNames : resolvedPredicateColumns;
  const allButPredicate = showAll
    ? tableColumnNames.filter((c) => !resolvedPredicateColumns.includes(c)).length
    : 0;

  return (
    <div className="mt-4">
      <div className="flex items-center justify-between mb-3">
        <h5 className="text-[10px] font-semibold uppercase tracking-wider text-slate-400 dark:text-slate-500">
          Columns
          {hasResolvedPredicateColumns && (
            <span className="ml-1.5 font-mono text-[9px] text-blue-500 lowercase">
              ({resolvedPredicateColumns.length} refs{showAll && allButPredicate > 0 ? ` + ${allButPredicate} more` : ''})
            </span>
          )}
        </h5>
        {tableColumnNames.length > resolvedPredicateColumns.length && (
          <button
            type="button"
            onClick={() => setShowAll((v) => !v)}
            className="text-[9px] font-bold px-2 py-0.5 rounded border border-slate-200 dark:border-slate-700 text-slate-500 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-800 uppercase tracking-tighter transition-colors"
          >
            {showAll ? 'Refs Only' : `All (${tableColumnNames.length})`}
          </button>
        )}
      </div>
      {columnsToShow.length === 0 ? (
        <p className="text-[11px] text-slate-500 dark:text-slate-400 leading-snug">
          Bundle has no column stats for this table.
        </p>
      ) : (
        <div className="space-y-1.5">
          {columnsToShow.map((name) => (
            <ColumnRow
              key={name}
              name={name}
              stats={table.columns[name]}
              fromPredicate={resolvedPredicateColumns.includes(name)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function ColumnRow({
  name,
  stats,
  fromPredicate,
}: {
  name: string;
  stats: ColumnStats;
  fromPredicate: boolean;
}) {
  const histogramLabel = formatHistogramLabel(stats.histogram.type, stats.histogram.buckets);
  return (
    <div className="text-[10px] rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-900/60 p-2 shadow-sm">
      <div className="flex items-center justify-between mb-1.5">
        <code className="font-mono font-bold text-slate-800 dark:text-slate-200">{name}</code>
        <div className="flex items-center gap-1.5">
          {fromPredicate && (
            <span className="px-1.5 py-0.5 text-[8px] rounded font-bold bg-blue-500/10 text-blue-600 dark:text-blue-400 uppercase">
              ref
            </span>
          )}
          <span className="text-[9px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-tighter">
            {stats.data_type}
            {stats.nullable ? '' : ' • REQ'}
          </span>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-x-4 gap-y-1 font-mono text-slate-600 dark:text-slate-300">
        <span><span className="text-slate-400 dark:text-slate-500 text-[9px] uppercase tracking-tighter font-sans font-bold">Distinct:</span> {formatNumberShort(stats.num_distinct ?? undefined) ?? '—'}</span>
        <span><span className="text-slate-400 dark:text-slate-500 text-[9px] uppercase tracking-tighter font-sans font-bold">Nulls:</span> {formatNumberShort(stats.num_nulls ?? undefined) ?? '—'}</span>
        <span><span className="text-slate-400 dark:text-slate-500 text-[9px] uppercase tracking-tighter font-sans font-bold">Density:</span> {stats.density != null ? stats.density.toPrecision(2) : '—'}</span>
        <span className="truncate"><span className="text-slate-400 dark:text-slate-500 text-[9px] uppercase tracking-tighter font-sans font-bold">Hist:</span> {histogramLabel}</span>
      </div>
    </div>
  );
}

function formatHistogramLabel(type: ColumnStats['histogram']['type'], buckets: number): string {
  if (type === 'NONE') return 'None';
  const pretty: Record<Exclude<ColumnStats['histogram']['type'], 'NONE'>, string> = {
    FREQUENCY: 'Frequency',
    'HEIGHT BALANCED': 'Height balanced',
    HYBRID: 'Hybrid',
    'TOP-FREQUENCY': 'Top frequency',
  };
  return `${pretty[type]} (${buckets})`;
}

function ObjectBlock({ objectKey, stats }: { objectKey: string; stats: TableStats }) {
  const isStale = stats.stale_stats === 'YES';
  return (
    <div className="mb-4">
      <div className="flex items-center justify-between mb-3">
        <code className="text-[13px] font-mono font-bold text-blue-600 dark:text-blue-400 break-all">{objectKey}</code>
        {isStale && (
          <span className="px-2 py-0.5 text-[9px] font-bold rounded-full bg-amber-500 text-white border border-amber-600 shadow-sm animate-pulse">
            STALE
          </span>
        )}
      </div>
      <div className="grid grid-cols-2 gap-px bg-slate-200 dark:bg-slate-800 border border-slate-200 dark:border-slate-800 rounded-md overflow-hidden [&>*:last-child:nth-child(odd)]:col-span-2">
        <StatItem label="Table Rows" value={formatNumberShort(stats.num_rows ?? undefined)} />
        <StatItem label="Blocks" value={formatNumberShort(stats.blocks ?? undefined)} />
        <StatItem label="Analyzed" value={formatDateShort(stats.last_analyzed)} />
        <StatItem label="Partitioned" value={stats.partitioned ? 'YES' : 'NO'} />
      </div>
      {stats.partitioned && stats.partition_type && (
        <div className="mt-2 text-[10px] rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-900/60 p-2">
          <div className="text-slate-400 dark:text-slate-500 font-bold uppercase tracking-tighter mb-1">
            Partitioning
          </div>
          <div className="font-mono text-slate-700 dark:text-slate-300">
            {stats.partition_type}
            {stats.interval ? ' · INTERVAL' : ''}
            {stats.partition_key && stats.partition_key.length > 0 && (
              <span> ({stats.partition_key.join(', ')})</span>
            )}
          </div>
          {stats.subpartition_type && stats.subpartition_type !== 'NONE' && (
            <div className="mt-1 font-mono text-slate-700 dark:text-slate-300">
              <span className="text-slate-400 dark:text-slate-500 font-sans">Subpartition:</span>{' '}
              {stats.subpartition_type}
              {stats.subpartition_key && stats.subpartition_key.length > 0 && (
                <span> ({stats.subpartition_key.join(', ')})</span>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function formatDateShort(iso: string | null): string | undefined {
  if (!iso) return undefined;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toISOString().slice(0, 10);
}

function IndexObjectBlock({ objectKey, index }: { objectKey: string; index: import('../lib/metadata/bundle').IndexObject }) {
  const { stats } = index;
  return (
    <div className="mb-4">
      <div className="flex items-center justify-between mb-3">
        <code className="text-[13px] font-mono font-bold text-blue-600 dark:text-blue-400 break-all">{objectKey}</code>
        <span className="px-2 py-0.5 text-[9px] font-bold rounded-full bg-indigo-500 text-white border border-indigo-600 shadow-sm uppercase">
          INDEX
        </span>
      </div>
      <div className="mb-3 text-[11px] p-2 bg-slate-100 dark:bg-slate-800 rounded-lg border border-slate-200 dark:border-slate-700">
        <span className="text-[10px] text-slate-400 dark:text-slate-500 mr-2">Cols:</span>
        <code className="font-mono text-slate-700 dark:text-slate-300 font-bold">
          {index.columns.length > 0 ? index.columns.join(', ') : '—'}
        </code>
      </div>
      <div className="grid grid-cols-2 gap-px bg-slate-200 dark:bg-slate-800 border border-slate-200 dark:border-slate-800 rounded-md overflow-hidden [&>*:last-child:nth-child(odd)]:col-span-2">
        <StatItem label="Type" value={stats.index_type} />
        <StatItem label="Uniqueness" value={stats.uniqueness} />
        <StatItem label="Status" value={stats.status} highlight={stats.status === 'VALID' ? undefined : 'orange'} />
        <StatItem label="Visibility" value={stats.visibility} />
        <StatItem label="C-Factor" value={formatNumberShort(stats.clustering_factor ?? undefined)} />
        <StatItem label="B-Level" value={stats.blevel?.toString()} />
        {stats.partitioned && (
          <>
            <StatItem label="Locality" value={stats.locality ?? undefined} />
            <StatItem label="Partition Type" value={stats.partition_type ?? undefined} />
          </>
        )}
      </div>
      {stats.partitioned && stats.partition_key && stats.partition_key.length > 0 && (
        <div className="mt-2 text-[10px] rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-900/60 p-2">
          <span className="text-slate-400 dark:text-slate-500 font-bold uppercase tracking-tighter mr-1.5">
            Partition Key:
          </span>
          <code className="font-mono text-slate-700 dark:text-slate-300">
            ({stats.partition_key.join(', ')})
          </code>
        </div>
      )}
    </div>
  );
}

function IndexesBlock({
  tableKey,
  indexes,
  usedIndexKeys,
  heading,
}: {
  tableKey: string | null;
  indexes: ResolvedIndex[];
  usedIndexKeys: Set<string>;
  heading: string;
}) {
  const sorted = useMemo(() => {
    const used: ResolvedIndex[] = [];
    const rest: ResolvedIndex[] = [];
    for (const idx of indexes) {
      if (usedIndexKeys.has(idx.key)) used.push(idx);
      else rest.push(idx);
    }
    return [...used, ...rest];
  }, [indexes, usedIndexKeys]);
  if (!tableKey || indexes.length === 0) return null;

  return (
    <div className="mt-4 pt-4 border-t border-slate-200 dark:border-slate-800">
      <h5 className="text-[10px] font-semibold uppercase tracking-wider text-slate-400 dark:text-slate-500 mb-3">
        {heading}
        <span className="ml-1.5 font-mono text-[9px] text-blue-500 lowercase font-normal">
          ({indexes.length})
        </span>
      </h5>
      <div className="space-y-1.5">
        {sorted.map((idx) => (
          <IndexRow key={idx.key} index={idx} usedHere={usedIndexKeys.has(idx.key)} />
        ))}
      </div>
    </div>
  );
}

function IndexRow({ index, usedHere }: { index: ResolvedIndex; usedHere: boolean }) {
  const { stats } = index.object;
  const isUnusable = stats.status !== 'VALID' && stats.status !== 'N/A';
  const isInvisible = stats.visibility === 'INVISIBLE';
  return (
    <div className="text-[10px] rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-900/60 p-2 shadow-sm">
      <div className="flex items-center justify-between mb-1.5 gap-2">
        <code className="font-mono font-bold text-slate-800 dark:text-slate-200 truncate">{index.key}</code>
        <div className="flex items-center gap-1.5 shrink-0">
          {usedHere && (
            <span className="px-1.5 py-0.5 text-[8px] rounded font-bold bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 uppercase">
              active
            </span>
          )}
          {stats.partitioned && stats.locality && (
            <span className="px-1.5 py-0.5 text-[8px] rounded font-bold bg-indigo-500/10 text-indigo-600 dark:text-indigo-400 uppercase">
              {stats.locality}
            </span>
          )}
          {isUnusable && (
            <span className="px-1.5 py-0.5 text-[8px] rounded font-bold bg-red-500/10 text-red-600 dark:text-red-400 uppercase">
              {stats.status}
            </span>
          )}
          {isInvisible && (
            <span className="px-1.5 py-0.5 text-[8px] rounded font-bold bg-slate-200 dark:bg-slate-800 text-slate-500 dark:text-slate-400 uppercase">
              HIDDEN
            </span>
          )}
        </div>
      </div>
      <div className="mb-1.5 text-[10px]">
        <span className="text-slate-400 dark:text-slate-500 font-bold uppercase tracking-tighter mr-1.5">Cols:</span>
        <code className="font-mono text-slate-700 dark:text-slate-300 font-semibold italic">
          {index.object.columns.length > 0 ? index.object.columns.join(', ') : '—'}
        </code>
      </div>
      <div className="grid grid-cols-2 gap-x-4 gap-y-1 font-mono text-slate-600 dark:text-slate-300">
        <span><span className="text-slate-400 dark:text-slate-500 text-[8px] uppercase font-sans font-bold">Type:</span> {stats.index_type}</span>
        <span><span className="text-slate-400 dark:text-slate-500 text-[8px] uppercase font-sans font-bold">Uniq:</span> {stats.uniqueness}</span>
        <span><span className="text-slate-400 dark:text-slate-500 text-[8px] uppercase font-sans font-bold">CF:</span> {formatNumberShort(stats.clustering_factor ?? undefined) ?? '—'}</span>
        <span><span className="text-slate-400 dark:text-slate-500 text-[8px] uppercase font-sans font-bold">Level:</span> {stats.blevel ?? '0'}</span>
      </div>
    </div>
  );
}

function sumNumbers(values: Array<number | undefined>): number {
  return values.reduce<number>((total, value) => total + (value ?? 0), 0);
}

function averageNumbers(values: Array<number | undefined>): number | undefined {
  const definedValues = values.filter((value): value is number => value !== undefined);
  if (definedValues.length === 0) return undefined;
  return definedValues.reduce((total, value) => total + value, 0) / definedValues.length;
}
