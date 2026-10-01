import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, memo } from 'react';
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  Panel,
  useNodesState,
  useEdgesState,
  useReactFlow,
  ReactFlowProvider,
  BackgroundVariant,
  getNodesBounds,
  getViewportForBounds,
} from '@xyflow/react';
import type { Node, Edge, NodeTypes } from '@xyflow/react';
import { toPng } from 'html-to-image';
import '@xyflow/react/dist/style.css';

import { usePlan } from '../../hooks/usePlanContext';
import { matchDensityPreset } from '../../lib/density';
import { PlanNodeMemo } from '../nodes/PlanNode';
import type { PlanNodeData } from '../nodes/PlanNode';
import { prefersReducedMotion, usePrefersReducedMotion } from '../nodes/usePrefersReducedMotion';
import { TreeLayoutControls } from './TreeLayoutControls';
import { SelectionBreadcrumb } from '../SelectionBreadcrumb';
import type { Crumb } from '../../lib/breadcrumb';
import { formatNumberShort, nodeCardinalityRatio, cardinalityRatioSeverity } from '../../lib/format';
import type { PlanNode } from '../../lib/types';
import { EDGE_SCHEME_COLORS } from '../../lib/types';
import type { TreeLayoutDirection } from '../../lib/settings';
import { createEmptyAnnotationState, getHighlightColorDef } from '../../lib/annotations';
import { matchesFilters } from '../../lib/filtering';
import { computeHottestNodeId } from '../../lib/analysis';
import { findObjectInBundle } from '../../lib/metadata/lookup';
import { evaluateBadges } from '../../lib/metadata/badges';
import type { MetadataBadge } from '../../lib/metadata/badges';
import { extractPredicateColumns } from '../../lib/metadata/predicateColumns';
import { assessPartitionPruning, computeParallelSignals } from '../../lib/planSignals';
import type { ParallelSignal } from '../../lib/planSignals';
import { runAdvisor } from '../../lib/advisor';
import {
  EMPTY_COLLAPSED,
  collapseAllIds,
  computeHiddenNodeIds,
  countDescendants,
  countHiddenMatches,
  expandAncestors,
  getAncestorIds,
  recallCollapsed,
  rememberCollapsed,
  setNodeCollapsed,
} from '../../lib/treeCollapse';
import type { TreeViewActions } from '../../lib/treeCollapse';
import { planNodeAriaLabel } from '../../lib/nodeAriaLabel';
import { buildDepthIndex, stepAtSameDepth } from '../../lib/treeNavigation';
import {
  COMPACT_NODE_WIDTH,
  COMPACT_TB_DEPTH_SPACING,
  LR_BREADTH_SPACING,
  LR_DEPTH_SPACING,
  NODE_BASE_HEIGHT,
  NODE_H_SPACING,
  NODE_V_SPACING,
  NODE_WIDTH,
  calculateNodeHeight,
  getLayoutedElements,
} from '../../lib/treeLayout';
import type { LayoutOptions, NodeBox } from '../../lib/treeLayout';

// Query block group component
interface QueryBlockGroupData extends Record<string, unknown> {
  label: string;
  width: number;
  height: number;
}

const QueryBlockGroupNode = memo(({ data }: { data: QueryBlockGroupData }) => {
  return (
    <div
      className="border border-dashed border-slate-400/80 dark:border-slate-600/50 rounded-lg bg-slate-500/[0.06] dark:bg-slate-400/[0.03] pointer-events-none"
      style={{ width: data.width, height: data.height }}
    >
      <div className="query-block-drag-handle absolute -top-3 left-3 px-2 py-0.5 bg-white dark:bg-slate-900 text-slate-500 dark:text-slate-500 text-xs font-mono cursor-grab active:cursor-grabbing select-none pointer-events-auto">
        ⠿ {data.label}
      </div>
    </div>
  );
});
QueryBlockGroupNode.displayName = 'QueryBlockGroupNode';

interface AnnotationGroupData extends Record<string, unknown> {
  label: string;
  width: number;
  height: number;
  borderClass: string;
  bgClass: string;
  note?: string;
}

const AnnotationGroupNode = memo(({ data }: { data: AnnotationGroupData }) => {
  return (
    <div
      className={`border-2 border-dashed rounded-lg ${data.borderClass} ${data.bgClass}`}
      style={{ width: data.width, height: data.height }}
    >
      <div className={`absolute -top-3 left-3 px-2 bg-white dark:bg-slate-900 text-xs font-medium`}>
        <span className="text-slate-700 dark:text-slate-300">{data.label}</span>
      </div>
      {data.note && (
        <div className="absolute -bottom-2.5 left-3 px-2 bg-white dark:bg-slate-900 text-[10px] text-slate-500 dark:text-slate-400 italic truncate max-w-[200px]">
          {data.note}
        </div>
      )}
    </div>
  );
});
AnnotationGroupNode.displayName = 'AnnotationGroupNode';

const nodeTypes: NodeTypes = {
  planNode: PlanNodeMemo as unknown as NodeTypes['planNode'],
  queryBlockGroup: QueryBlockGroupNode as unknown as NodeTypes['queryBlockGroup'],
  annotationGroup: AnnotationGroupNode as unknown as NodeTypes['annotationGroup'],
};

// Canvas backdrop — a solid surface from a CSS variable (index.css) so theme
// *and* app palette can restyle it.
const CANVAS_BACKDROP = 'var(--canvas-bg)';

const EMPTY_SELECTED_NODE_IDS: number[] = [];

/** One padding for every whole-tree fit (initial, refit, resize, redraw). */
const FIT_PADDING = 0.12;
const RESIZE_REFIT_DEBOUNCE_MS = 120;
/** Auto-centre on an external selection: below this zoom text is unreadable… */
const READABLE_ZOOM_THRESHOLD = 0.6;
/** …so zoom in to this level, centred on the node. */
const READABLE_ZOOM = 0.9;
/** "Focus selected" keeps the old fit-the-node zoom band. */
const FOCUS_MIN_ZOOM = 0.85;
const FOCUS_MAX_ZOOM = 1.2;
const FOCUS_NODE_PADDING = 0.3;
const VIEWPORT_MARGIN = 24;
const CENTER_DURATION_MS = 300;
/** 'auto' minimap appears once more than this many operations are on the canvas. */
const MINIMAP_AUTO_THRESHOLD = 12;

/** Rows flowing out of a child into its parent — drives edge thickness + label. */
function rowFlowOf(child: PlanNode, hasActualStats: boolean): number {
  if (hasActualStats && child.actualRows !== undefined) return child.actualRows;
  return child.rows || 1;
}

type CollapseUpdater = (prev: ReadonlySet<number>) => ReadonlySet<number>;

interface HierarchicalViewContentProps {
  planIndex: number;
  registerExport: boolean;
  showAnnotations: boolean;
  layoutDirection: TreeLayoutDirection;
  /** Nodes whose subtrees are collapsed (owned by the outer view, per plan). */
  collapsedIds: ReadonlySet<number>;
  updateCollapsed: (updater: CollapseUpdater) => void;
  /**
   * Set when the direction was switched from the in-canvas strip: the switch
   * remounts this component, so the new instance hands focus back to the
   * (now pressed) direction button. Lives outside the keyed subtree.
   */
  directionFocusRef: React.MutableRefObject<boolean>;
}

/** Where a selection came from: canvas clicks never move the viewport. */
type SelectionSource = 'canvas' | 'keyboard';
/**
 * - `if-needed`: pan only when the node is not fully on screen (keyboard nav)
 * - `if-needed-readable`: also zoom in to a readable level (external selection)
 * - `focus`: always centre, at the "Focus selected" zoom band
 */
type RevealMode = 'if-needed' | 'if-needed-readable' | 'focus';

const EMPTY_COUNTS: ReadonlyMap<number, number> = new Map();
const EMPTY_BOXES: ReadonlyMap<string, NodeBox> = new Map();

/** html-to-image filter: keep canvas chrome and node controls out of the PNG. */
function includeInExport(domNode: HTMLElement): boolean {
  if (!(domNode instanceof Element)) return true;
  if (domNode.hasAttribute('data-export-exclude')) return false;
  const { classList } = domNode;
  return !(
    classList.contains('react-flow__minimap') ||
    classList.contains('react-flow__controls') ||
    classList.contains('react-flow__panel')
  );
}

function HierarchicalViewContent({
  planIndex,
  registerExport,
  showAnnotations,
  layoutDirection,
  collapsedIds,
  updateCollapsed,
  directionFocusRef,
}: HierarchicalViewContentProps) {
  const {
    plans,
    activePlanIndex,
    selectNodeForPlan,
    setActivePlan,
    theme,
    filters,
    colorScheme,
    nodeIndicatorMetric,
    getAnnotationsForPlan,
    exportPngFnRef,
    hotspotsEnabled,
    highlightStyle,
    treeMinimap,
    setTreeMinimap,
    setTreeLayoutDirection,
    treeViewActionsRef,
    setTreeViewState,
  } = usePlan();
  const resolvedPlanIndex = planIndex;
  const slot = plans[resolvedPlanIndex];
  const parsedPlan = slot?.parsedPlan ?? null;
  const selectedNodeId = slot?.selectedNodeId ?? null;
  const selectedNodeIds = slot?.selectedNodeIds ?? EMPTY_SELECTED_NODE_IDS;
  const containerRef = useRef<HTMLDivElement>(null);
  const { fitView, getNodes, setCenter, setViewport, getViewport, getInternalNode } = useReactFlow();
  const reducedMotion = usePrefersReducedMotion();
  const isHorizontal = layoutDirection === 'LR';
  const rootNode = parsedPlan?.rootNode ?? null;
  const nodeById = useMemo(() => {
    if (!parsedPlan) return new Map<number, PlanNode>();
    return new Map(parsedPlan.allNodes.map((node) => [node.id, node]));
  }, [parsedPlan]);
  const parentOf = useCallback((id: number) => nodeById.get(id)?.parentId, [nodeById]);
  const filteredNodeIds = useMemo(() => {
    if (!parsedPlan) return new Set<number>();
    const hasActualStats = parsedPlan.hasActualStats ?? false;
    return new Set(
      parsedPlan.allNodes
        .filter((node) => matchesFilters(node, filters, hasActualStats))
        .map((node) => node.id)
    );
  }, [parsedPlan, filters]);
  const hottestNodeId = useMemo(
    (): number | null => (hotspotsEnabled ? computeHottestNodeId(parsedPlan) : null),
    [parsedPlan, hotspotsEnabled]
  );
  // `runAdvisor` memoizes per plan object + bundle, so this shares one run with
  // the context's `advisorReport` (and works for the non-active compare pane).
  const advisorReport = useMemo(
    () => (parsedPlan ? runAdvisor(parsedPlan, slot?.metadataBundle ?? null) : null),
    [parsedPlan, slot?.metadataBundle]
  );
  // Plan-wide, so a collapse toggle or a note edit re-lays-out without redoing it.
  const parallelSignalsByNode = useMemo(() => {
    const byNode = new Map<number, ParallelSignal[]>();
    if (!parsedPlan) return byNode;
    for (const sig of computeParallelSignals(parsedPlan)) {
      const arr = byNode.get(sig.nodeId) ?? [];
      arr.push(sig);
      byNode.set(sig.nodeId, arr);
    }
    return byNode;
  }, [parsedPlan]);
  const planAnnotations = getAnnotationsForPlan(resolvedPlanIndex);
  const effectiveAnnotations = useMemo(
    () => (showAnnotations ? planAnnotations : createEmptyAnnotationState()),
    [planAnnotations, showAnnotations]
  );

  // Collapsed subtrees: hidden descendants are dropped from layout and edges.
  const hiddenNodeIds = useMemo(() => computeHiddenNodeIds(rootNode, collapsedIds), [rootNode, collapsedIds]);
  const descendantCounts = useMemo(() => countDescendants(rootNode), [rootNode]);
  const collapseAllTarget = useMemo(() => collapseAllIds(rootNode), [rootNode]);
  const visibleNodeCount = (parsedPlan?.allNodes.length ?? 0) - hiddenNodeIds.size;
  // Same-depth lists for the arrow keys, rebuilt only when the plan or the collapsed set changes.
  const depthIndex = useMemo(
    () => buildDepthIndex(parsedPlan?.allNodes ?? [], hiddenNodeIds),
    [parsedPlan, hiddenNodeIds]
  );

  // Layout only needs to know *which* nodes carry a note (they get a taller
  // card), not the text: key it on the id list so typing a note re-renders the
  // preview (data effect below) without re-running the layout per keystroke.
  const annotatedNodeKey = useMemo(
    () => [...effectiveAnnotations.nodeAnnotations.keys()].sort((a, b) => a - b).join(','),
    [effectiveAnnotations.nodeAnnotations]
  );
  const annotatedNodeIds = useMemo(
    () => new Set(annotatedNodeKey ? annotatedNodeKey.split(',').map(Number) : []),
    [annotatedNodeKey]
  );

  // Stable callback handed to every node (so it never invalidates the layout);
  // the latest handler is swapped in via a ref after each commit.
  const toggleCollapseRef = useRef<(nodeId: number) => void>(() => {});
  const onToggleCollapse = useCallback((nodeId: number) => toggleCollapseRef.current(nodeId), []);

  // Selection bookkeeping for auto-centring (see the selection effect below)
  const selectionSourceRef = useRef<{ source: SelectionSource; id: number; at: number } | null>(null);
  const markSelectionSource = useCallback((source: SelectionSource, id: number) => {
    selectionSourceRef.current = { source, id, at: performance.now() };
  }, []);
  const pendingRevealRef = useRef<{ id: number; mode: RevealMode } | null>(null);
  const pendingFitRef = useRef(false);
  const pendingAnchorRef = useRef<{ id: number; screenX: number; screenY: number } | null>(null);
  const layoutBoxesRef = useRef<ReadonlyMap<string, NodeBox>>(EMPTY_BOXES);

  // PNG export state: when true, onlyRenderVisibleElements is disabled so all nodes render
  const [isExporting, setIsExporting] = useState(false);
  const exportResolveRef = useRef<(() => void) | null>(null);

  // Register the full-graph PNG export function so the Header button can call it
  useEffect(() => {
    if (!registerExport) {
      return;
    }

    exportPngFnRef.current = async () => {
      // Phase 1: disable virtualization so all nodes render in the DOM
      await new Promise<void>((resolve) => {
        exportResolveRef.current = resolve;
        setIsExporting(true);
      });

      // Phase 2: all nodes are now in the DOM — capture the full graph
      try {
        const allNodes = getNodes();
        const nodesBounds = getNodesBounds(allNodes);
        const padding = 50;
        const imageWidth = nodesBounds.width + padding * 2;
        const imageHeight = nodesBounds.height + padding * 2;
        const viewport = getViewportForBounds(nodesBounds, imageWidth, imageHeight, 0.5, 2, padding);

        const viewportEl = containerRef.current?.querySelector<HTMLElement>('.react-flow__viewport') ?? null;
        // Reject rather than resolve: the caller's "PNG downloaded" toast
        // must never report an image that was not produced.
        if (!viewportEl) throw new Error('The tree canvas is not on screen, so there is nothing to capture.');

        // Matches the canvas backdrop, read live so the export follows the
        // active theme *and* app palette.
        const canvasBg = getComputedStyle(document.documentElement)
          .getPropertyValue('--canvas-bg')
          .trim();
        const bgColor = canvasBg || (theme === 'dark' ? '#0e1526' : '#ffffff');
        const dataUrl = await toPng(viewportEl, {
          backgroundColor: bgColor,
          width: imageWidth,
          height: imageHeight,
          // The capture root is the flow viewport, so the minimap / controls /
          // overlay panels are already outside it; the filter also drops the
          // per-node collapse chevrons (and guards against a wider root later).
          filter: includeInExport,
          style: {
            width: `${imageWidth}px`,
            height: `${imageHeight}px`,
            transform: `translate(${viewport.x}px, ${viewport.y}px) scale(${viewport.zoom})`,
          },
        });
        const link = document.createElement('a');
        link.download = `plan-${Date.now()}.png`;
        link.href = dataUrl;
        link.click();
      } finally {
        setIsExporting(false);
      }
    };
    return () => { exportPngFnRef.current = null; };
  }, [exportPngFnRef, getNodes, registerExport, theme]);

  // When isExporting flips to true and React has rendered, resolve the promise
  useEffect(() => {
    if (isExporting && exportResolveRef.current) {
      // Wait one frame to ensure React Flow has rendered all nodes
      requestAnimationFrame(() => {
        exportResolveRef.current?.();
        exportResolveRef.current = null;
      });
    }
  }, [isExporting]);

  const selectedNodeIdSet = useMemo(() => new Set(selectedNodeIds), [selectedNodeIds]);

  // Destructure filter values for explicit dependency tracking
  const {
    operationTypes, minCost, maxCost, searchText, predicateTypes,
    minActualRows, maxActualRows, minActualTime, maxActualTime
  } = filters;

  // Create a filter key that changes when any filter value changes
  const filterKey = useMemo(() => {
    const maxCostKey = maxCost === Infinity ? 'inf' : maxCost;
    const maxActualRowsKey = maxActualRows === Infinity ? 'inf' : maxActualRows;
    const maxActualTimeKey = maxActualTime === Infinity ? 'inf' : maxActualTime;
    return [
      operationTypes.join('|'),
      minCost,
      maxCostKey,
      searchText,
      predicateTypes.join('|'),
      minActualRows,
      maxActualRowsKey,
      minActualTime,
      maxActualTimeKey,
    ].join('::');
  }, [operationTypes, minCost, maxCost, searchText, predicateTypes, minActualRows, maxActualRows, minActualTime, maxActualTime]);

  // Collapsed stubs flag how many hidden descendants match the active search
  const hiddenMatchCounts = useMemo((): ReadonlyMap<number, number> => {
    if (!searchText.trim() || collapsedIds.size === 0) return EMPTY_COUNTS;
    return countHiddenMatches(rootNode, collapsedIds, (id) => filteredNodeIds.has(id));
  }, [searchText, collapsedIds, rootNode, filteredNodeIds]);

  const selectionSets = useMemo(() => {
    const empty = {
      ancestorIds: new Set<number>(),
      descendantIds: new Set<number>(),
    };

    if (!parsedPlan || selectedNodeId === null || selectedNodeIds.length !== 1) return empty;

    const selected = nodeById.get(selectedNodeId);
    if (!selected) return empty;

    const ancestorIds = new Set<number>();
    let current: PlanNode | undefined = selected;
    ancestorIds.add(current.id);

    while (current?.parentId !== undefined) {
      const parent = nodeById.get(current.parentId);
      if (!parent) break;
      ancestorIds.add(parent.id);
      current = parent;
    }

    const descendantIds = new Set<number>();
    const addDescendants = (node: PlanNode) => {
      descendantIds.add(node.id);
      node.children.forEach(addDescendants);
    };
    addDescendants(selected);

    return { ancestorIds, descendantIds };
  }, [parsedPlan, selectedNodeId, selectedNodeIds.length, nodeById]);

  // When Quick Analysis is disabled, also hide cardinality mismatch badges on nodes
  const effectiveDisplayOptions = useMemo(() => {
    if (hotspotsEnabled) return filters.nodeDisplayOptions;
    return { ...filters.nodeDisplayOptions, showCardinalityBadge: false };
  }, [filters.nodeDisplayOptions, hotspotsEnabled]);

  const layoutData = useMemo(() => {
    if (!parsedPlan?.rootNode) {
      return { nodes: [] as Node[], edges: [] as Edge[], boxes: EMPTY_BOXES };
    }

    const isRail = colorScheme === 'rail';
    const isTicker = colorScheme === 'ticker';
    // Schemes that render stats as the Est ⇄ Act comparison grid (mirrors PlanNode)
    const usesGrid = ['estact', 'rail', 'contrast', 'semantic', 'stripe', 'tinted', 'terminal'].includes(colorScheme);
    // Minimal density narrows the card; tree spacing keeps the wider gaps (extra air is fine)
    const isCompactNode = effectiveDisplayOptions.compactStats;
    const effectiveNodeWidth = isCompactNode ? COMPACT_NODE_WIDTH : isTicker ? 240 : NODE_WIDTH;
    const hasActualStats = parsedPlan.hasActualStats || false;

    const planNodes: Node[] = [];
    const edges: Edge[] = [];
    const nodeQueryBlocks: Map<string, string> = new Map();
    const nodeDimensions: Map<string, { width: number; height: number }> = new Map();
    const nodeGroupDimensions: Map<string, { width: number; height: number }> = new Map();

    const bundle = slot?.metadataBundle ?? null;
    const enabledMetadata = {
      'stale-stats': effectiveDisplayOptions.showStaleStatsBadge,
      'missing-stats': effectiveDisplayOptions.showMissingStatsBadge,
      'mismatch-no-histogram': effectiveDisplayOptions.showMismatchNoHistogramBadge,
    } as const;

    function traverse(node: PlanNode) {
      const hasAnnotation = annotatedNodeIds.has(node.id);
      const nodeFindings = advisorReport?.findingsByNodeId.get(node.id);
      const advisorSeverity = advisorReport?.maxSeverityByNodeId.get(node.id);
      const advisorTitles = nodeFindings?.map((f) => f.title);
      const hasAdvisorBadge = effectiveDisplayOptions.showAdvisorBadge && !!advisorSeverity;
      // Calculate dynamic height for this node
      const height = calculateNodeHeight(node, effectiveDisplayOptions, hasActualStats, hasAnnotation, usesGrid, isRail, isTicker, hasAdvisorBadge);
      nodeDimensions.set(node.id.toString(), { width: effectiveNodeWidth, height });
      const match = bundle ? findObjectInBundle(bundle, node.objectName) : null;
      const cardSeverity = hasActualStats
        ? cardinalityRatioSeverity(nodeCardinalityRatio(node))
        : 'good';
      const predicateColumns = extractPredicateColumns(node.accessPredicates, node.filterPredicates);
      const metadataBadges: MetadataBadge[] = bundle
        ? evaluateBadges({
            match,
            enabled: enabledMetadata,
            cardinalitySeverity: cardSeverity,
            predicateColumns,
          })
        : [];
      const partitionPruning = assessPartitionPruning(node);
      const nodeParallelSignals = parallelSignalsByNode.get(node.id);
      const isCollapsed = node.children.length > 0 && collapsedIds.has(node.id);

      // Keep query block envelopes stable across predicate-detail toggles by
      // sizing groups against the expanded node-height baseline.
      const groupHeight = calculateNodeHeight(
        node,
        { ...effectiveDisplayOptions, showPredicateDetails: true },
        hasActualStats,
        hasAnnotation,
        usesGrid,
        isRail,
        isTicker,
        hasAdvisorBadge,
      );
      nodeGroupDimensions.set(node.id.toString(), { width: effectiveNodeWidth, height: groupHeight });

      planNodes.push({
        id: node.id.toString(),
        type: 'planNode',
        position: { x: 0, y: 0 },
        data: {
          label: node.operation,
          node,
          totalCost: parsedPlan!.totalCost,
          isSelected: false, // Updated by useEffect when selectedNodeId changes
          isFiltered: false,
          displayOptions: effectiveDisplayOptions,
          hasActualStats: parsedPlan!.hasActualStats,
          width: effectiveNodeWidth,
          height,
          metadataBadges,
          partitionPruning,
          parallelSignals: nodeParallelSignals,
          advisorSeverity,
          advisorCount: nodeFindings?.length,
          advisorTitles,
          layoutDirection,
          isCollapsed,
          hiddenCount: isCollapsed ? descendantCounts.get(node.id) ?? 0 : 0,
          onToggleCollapse,
          planIndex: resolvedPlanIndex,
        },
      });

      if (node.queryBlock) {
        nodeQueryBlocks.set(node.id.toString(), node.queryBlock);
      }

      // A collapsed node keeps its card; its whole subtree leaves the canvas.
      if (isCollapsed) return;

      for (const child of node.children) {
        edges.push({
          id: `e${node.id}-${child.id}`,
          source: node.id.toString(),
          target: child.id.toString(),
          animated: false,
          data: { rowFlow: rowFlowOf(child, hasActualStats) },
          style: {
            stroke: EDGE_SCHEME_COLORS[colorScheme].light.default,
            strokeWidth: 2,
          },
        });
        traverse(child);
      }
    }

    traverse(parsedPlan.rootNode);

    // Edge thickness is normalised across the *whole* plan so it stays stable
    // while subtrees are collapsed and expanded.
    const rowFlows = parsedPlan.allNodes
      .filter((node) => node.parentId !== undefined)
      .map((node) => rowFlowOf(node, hasActualStats));
    const minRowFlow = rowFlows.length > 0 ? Math.min(...rowFlows) : 1;
    const maxRowFlow = rowFlows.length > 0 ? Math.max(...rowFlows) : 1;
    const rowFlowRange = maxRowFlow - minRowFlow;

    // Apply layout to plan nodes with dynamic dimensions
    const groupsQueryBlocks = effectiveDisplayOptions.showQueryBlockGrouping && nodeQueryBlocks.size > 0;
    const layoutOptions: LayoutOptions = isHorizontal
      ? {
          direction: 'LR',
          depthSpacing: LR_DEPTH_SPACING,
          breadthSpacing: groupsQueryBlocks ? NODE_H_SPACING : LR_BREADTH_SPACING,
        }
      : {
          direction: 'TB',
          depthSpacing: matchDensityPreset(effectiveDisplayOptions) === 'compact' ? COMPACT_TB_DEPTH_SPACING : NODE_V_SPACING,
          breadthSpacing: NODE_H_SPACING,
        };
    const layoutedResult = getLayoutedElements(planNodes, edges, nodeDimensions, layoutOptions);

    // Absolute boxes of every visible plan node (before query-block re-parenting)
    const boxes = new Map<string, NodeBox>();
    for (const node of layoutedResult.nodes) {
      const dims = nodeDimensions.get(node.id) || { width: NODE_WIDTH, height: NODE_BASE_HEIGHT };
      boxes.set(node.id, { x: node.position.x, y: node.position.y, width: dims.width, height: dims.height });
    }

    // Edge thickness range
    const MIN_STROKE_WIDTH = 2;
    const MAX_STROKE_WIDTH = 16;

    // Update edge stroke widths based on row flow and add labels
    const edgesWithThickness = layoutedResult.edges.map(edge => {
      const rowFlow = (edge.data as { rowFlow: number })?.rowFlow || 1;
      // Linear scale between min and max stroke width (when scaling enabled)
      const normalizedFlow = rowFlowRange > 0 ? (rowFlow - minRowFlow) / rowFlowRange : 0.5;
      const strokeWidth = filters.scaleEdgeWidth
        ? MIN_STROKE_WIDTH + normalizedFlow * (MAX_STROKE_WIDTH - MIN_STROKE_WIDTH)
        : MIN_STROKE_WIDTH;
      // Format row flow in human-readable format (e.g., 1.2M, 3.5K)
      const formattedRowFlow = formatNumberShort(rowFlow) ?? rowFlow.toString();
      return {
        ...edge,
        label: formattedRowFlow,
        labelStyle: { fill: '#a1a1aa', fontSize: 10, fontWeight: 500 },
        labelBgStyle: { fill: 'transparent', fillOpacity: 0 },
        labelBgPadding: [4, 2] as [number, number],
        labelBgBorderRadius: 4,
        style: {
          ...edge.style,
          strokeWidth,
        },
      };
    });

    // Create query block groups if enabled
    const groupNodes: Node[] = [];
    const nodeParentInfo = new Map<string, { parentId: string; offsetX: number; offsetY: number }>();
    if (groupsQueryBlocks) {
      // Group nodes by query block
      const queryBlockGroups = new Map<string, Node[]>();
      for (const node of layoutedResult.nodes) {
        const qb = nodeQueryBlocks.get(node.id);
        if (qb) {
          if (!queryBlockGroups.has(qb)) {
            queryBlockGroups.set(qb, []);
          }
          queryBlockGroups.get(qb)!.push(node);
        }
      }

      // Create group nodes with bounding boxes
      const padding = 20;
      // Keep query block groups visually stable even when node content is compact
      // (e.g. predicate details disabled) and nodes still have rings/shadows/scale.
      const visualBuffer = 14;
      queryBlockGroups.forEach((groupedNodes, queryBlock) => {
        if (groupedNodes.length === 0) return;

        // Calculate bounding box using actual node dimensions
        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
        for (const node of groupedNodes) {
          const dims = nodeGroupDimensions.get(node.id) || nodeDimensions.get(node.id) || { width: NODE_WIDTH, height: NODE_BASE_HEIGHT };
          minX = Math.min(minX, node.position.x - visualBuffer);
          minY = Math.min(minY, node.position.y - visualBuffer);
          maxX = Math.max(maxX, node.position.x + dims.width + visualBuffer);
          maxY = Math.max(maxY, node.position.y + dims.height + visualBuffer);
        }

        const groupId = `group-${queryBlock}`;
        const groupX = minX - padding;
        const groupY = minY - padding;

        groupNodes.push({
          id: groupId,
          type: 'queryBlockGroup',
          position: { x: groupX, y: groupY },
          data: {
            label: queryBlock,
            width: maxX - minX + padding * 2,
            height: maxY - minY + padding * 2,
          },
          selectable: false,
          draggable: true,
          dragHandle: '.query-block-drag-handle',
          zIndex: 0,
        });

        // Record parent info so member nodes get relative positions
        for (const node of groupedNodes) {
          nodeParentInfo.set(node.id, { parentId: groupId, offsetX: groupX, offsetY: groupY });
        }
      });
    }

    // Annotation group overlay nodes (members hidden in a collapsed subtree drop out)
    const annotationGroupNodes: Node[] = [];
    if (effectiveAnnotations.groups.length > 0) {
      const layoutedById = new Map(layoutedResult.nodes.map((n) => [n.id, n]));
      const padding = 20;
      const visualBuffer = 14;

      for (const group of effectiveAnnotations.groups) {
        // Find positioned plan nodes that belong to this group
        const memberNodes = group.nodeIds
          .map((id) => layoutedById.get(id.toString()))
          .filter((n): n is Node => Boolean(n));

        if (memberNodes.length === 0) continue;

        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
        for (const node of memberNodes) {
          const dims = nodeGroupDimensions.get(node.id) || nodeDimensions.get(node.id) || { width: NODE_WIDTH, height: NODE_BASE_HEIGHT };
          minX = Math.min(minX, node.position.x - visualBuffer);
          minY = Math.min(minY, node.position.y - visualBuffer);
          maxX = Math.max(maxX, node.position.x + dims.width + visualBuffer);
          maxY = Math.max(maxY, node.position.y + dims.height + visualBuffer);
        }

        const colorDef = getHighlightColorDef(group.color);
        annotationGroupNodes.push({
          id: `anngroup-${group.id}`,
          type: 'annotationGroup',
          position: { x: minX - padding, y: minY - padding },
          data: {
            label: group.name,
            width: maxX - minX + padding * 2,
            height: maxY - minY + padding * 2,
            borderClass: colorDef.groupBorder,
            bgClass: colorDef.groupBg,
            note: group.note,
          },
          selectable: false,
          draggable: false,
          zIndex: -1,
        });
      }
    }

    // Adjust plan nodes that belong to query block groups:
    // set parentId and convert positions to be relative to the group
    const adjustedPlanNodes = layoutedResult.nodes.map(node => {
      const parentInfo = nodeParentInfo.get(node.id);
      if (parentInfo) {
        return {
          ...node,
          parentId: parentInfo.parentId,
          position: {
            x: node.position.x - parentInfo.offsetX,
            y: node.position.y - parentInfo.offsetY,
          },
        };
      }
      return node;
    });

    // Group nodes should be rendered first (behind plan nodes)
    return {
      nodes: [...groupNodes, ...annotationGroupNodes, ...adjustedPlanNodes],
      edges: edgesWithThickness,
      boxes,
    };
  }, [
    effectiveAnnotations.groups,
    annotatedNodeIds,
    effectiveDisplayOptions,
    parsedPlan,
    colorScheme,
    filters.scaleEdgeWidth,
    slot?.metadataBundle,
    advisorReport?.findingsByNodeId,
    advisorReport?.maxSeverityByNodeId,
    parallelSignalsByNode,
    collapsedIds,
    descendantCounts,
    isHorizontal,
    layoutDirection,
    onToggleCollapse,
    resolvedPlanIndex,
  ]);

  const [nodes, setNodes, onNodesChange] = useNodesState(layoutData.nodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(layoutData.edges);
  // "Redraw layout" bumps this to re-apply computed positions (dropping drags)
  const [redrawEpoch, setRedrawEpoch] = useState(0);

  // Sync nodes with layout when layout changes (or on redraw). The data / edge
  // style effects below list the same triggers so decorations are re-applied
  // on top of the fresh layout objects in the same commit.
  useEffect(() => {
    layoutBoxesRef.current = layoutData.boxes;
    setNodes(layoutData.nodes);
    setEdges(layoutData.edges);
  }, [layoutData, redrawEpoch, setNodes, setEdges]);

  // React Flow paints edges a frame or two before the nodes have positions, so
  // the first mount flashes a ghost frame of stray edges. Stay invisible until
  // the initial layout has been fitted, then fade in. Only the first fit gates
  // opacity — later re-layouts never hide the canvas again.
  const [layoutReady, setLayoutReady] = useState(false);
  const layoutReadyRef = useRef(false);

  /** Where a node is now: the live (possibly dragged) position, else the computed layout box. */
  const getNodeBox = useCallback((id: number): NodeBox | null => {
    const key = String(id);
    const layoutBox = layoutBoxesRef.current.get(key);
    if (!layoutBox) return null;
    const internal = getInternalNode(key);
    if (!internal) return layoutBox;
    const abs = internal.internals.positionAbsolute;
    return {
      x: abs.x,
      y: abs.y,
      width: internal.measured?.width ?? layoutBox.width,
      height: internal.measured?.height ?? layoutBox.height,
    };
  }, [getInternalNode]);

  /** The single place that moves the viewport onto one node. */
  const centerOnNode = useCallback((id: number, mode: RevealMode): boolean => {
    const container = containerRef.current;
    const box = getNodeBox(id);
    if (!container || !box) return false;
    const { width: canvasWidth, height: canvasHeight } = container.getBoundingClientRect();
    if (canvasWidth === 0 || canvasHeight === 0) return false;
    const { x: vx, y: vy, zoom } = getViewport();

    let targetZoom = zoom;
    if (mode === 'focus') {
      const fitZoom = Math.min(
        canvasWidth / (box.width * (1 + 2 * FOCUS_NODE_PADDING)),
        canvasHeight / (box.height * (1 + 2 * FOCUS_NODE_PADDING)),
      );
      targetZoom = Math.min(FOCUS_MAX_ZOOM, Math.max(FOCUS_MIN_ZOOM, fitZoom));
    } else if (mode === 'if-needed-readable' && zoom < READABLE_ZOOM_THRESHOLD) {
      targetZoom = READABLE_ZOOM;
    }

    if (mode !== 'focus' && targetZoom === zoom) {
      const sx = box.x * zoom + vx;
      const sy = box.y * zoom + vy;
      const fullyVisible =
        sx >= VIEWPORT_MARGIN &&
        sy >= VIEWPORT_MARGIN &&
        sx + box.width * zoom <= canvasWidth - VIEWPORT_MARGIN &&
        sy + box.height * zoom <= canvasHeight - VIEWPORT_MARGIN;
      if (fullyVisible) return true;
    }

    void setCenter(box.x + box.width / 2, box.y + box.height / 2, {
      zoom: targetZoom,
      duration: prefersReducedMotion() ? 0 : CENTER_DURATION_MS,
    });
    return true;
  }, [getNodeBox, getViewport, setCenter]);

  // Re-fit viewport when the layout changes for a structural reason (new plan,
  // display options / color scheme, metadata or advisor badges). Annotations are
  // deliberately NOT a trigger: re-fitting while typing a note would yank the
  // user's zoom out from under them. Collapse/expand is not a trigger either —
  // single toggles keep the toggled node anchored, Expand/Collapse all refit
  // explicitly. (Layout direction remounts the view, so it refits on mount.)
  const fitKey = useMemo(
    () => ({ parsedPlan, effectiveDisplayOptions, colorScheme, bundle: slot?.metadataBundle, advisorReport }),
    [parsedPlan, effectiveDisplayOptions, colorScheme, slot?.metadataBundle, advisorReport]
  );
  useEffect(() => {
    const timer = setTimeout(() => {
      void Promise.resolve(fitView({ padding: FIT_PADDING })).then(() => {
        if (layoutReadyRef.current) return;
        layoutReadyRef.current = true;
        requestAnimationFrame(() => setLayoutReady(true));
        // A selection made before the tree mounted (e.g. from the Tabular view)
        // is revealed once the initial fit has settled.
        const pending = pendingRevealRef.current;
        if (pending && layoutBoxesRef.current.has(String(pending.id))) {
          pendingRevealRef.current = null;
          centerOnNode(pending.id, pending.mode);
        }
      });
    }, 50);
    return () => clearTimeout(timer);
  }, [fitKey, fitView, centerOnNode]);

  // The one fit-on-resize observer. Panels opening/closing and responsive
  // breakpoints change the canvas size without changing the plan: refit once
  // resizing settles instead of leaving the old viewport clipped.
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    let previousWidth = container.clientWidth;
    let previousHeight = container.clientHeight;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const observer = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect;
      if (width === previousWidth && height === previousHeight) return;
      previousWidth = width;
      previousHeight = height;
      clearTimeout(timer);
      if (width > 0 && height > 0) {
        timer = setTimeout(() => { void fitView({ padding: FIT_PADDING }); }, RESIZE_REFIT_DEBOUNCE_MS);
      }
    });
    observer.observe(container);
    return () => { observer.disconnect(); clearTimeout(timer); };
  }, [fitView]);

  // After a collapse-driven re-layout: Expand/Collapse all refit the tree; a
  // single toggle keeps the toggled node where it was on screen.
  useEffect(() => {
    if (pendingFitRef.current) {
      pendingFitRef.current = false;
      pendingAnchorRef.current = null;
      const timer = setTimeout(() => {
        void fitView({ padding: FIT_PADDING, duration: prefersReducedMotion() ? 0 : 250 });
      }, 50);
      return () => clearTimeout(timer);
    }
    const anchor = pendingAnchorRef.current;
    if (!anchor) return;
    pendingAnchorRef.current = null;
    const box = layoutData.boxes.get(String(anchor.id));
    if (!box) return;
    const { zoom } = getViewport();
    void setViewport({ x: anchor.screenX - box.x * zoom, y: anchor.screenY - box.y * zoom, zoom });
  }, [layoutData, fitView, getViewport, setViewport]);

  // Selection changes. Canvas clicks are left alone (the node is on screen);
  // keyboard navigation pans only when the node is off-screen; anything else —
  // details-panel lists, findings, tabular sync, search — is an external
  // selection: its collapsed ancestors are expanded, then the viewport pans
  // (and zooms in from an unreadable zoom) onto it.
  const selectionKey = selectedNodeIds.join(',');
  const prevSelectionKeyRef = useRef<string | null>(null);
  useEffect(() => {
    if (prevSelectionKeyRef.current === selectionKey) return;
    prevSelectionKeyRef.current = selectionKey;
    const mark = selectionSourceRef.current;
    selectionSourceRef.current = null;
    const source: SelectionSource | 'external' =
      mark && mark.id === selectedNodeId && performance.now() - mark.at < 2000 ? mark.source : 'external';

    const hiddenSelected = selectedNodeIds.filter((id) => hiddenNodeIds.has(id));
    if (hiddenSelected.length > 0) {
      updateCollapsed((prev) => expandAncestors(prev, hiddenSelected, parentOf));
    }

    if (selectedNodeId === null || selectedNodeIds.length !== 1 || source === 'canvas') {
      pendingRevealRef.current = null;
      return;
    }
    pendingRevealRef.current = {
      id: selectedNodeId,
      mode: source === 'keyboard' ? 'if-needed' : 'if-needed-readable',
    };
  }, [selectionKey, selectedNodeId, selectedNodeIds, hiddenNodeIds, parentOf, updateCollapsed]);

  // Fulfil a pending reveal once the node is on the canvas (immediately, or
  // after the re-layout that expanded its ancestors) and the first fit is done.
  useEffect(() => {
    const pending = pendingRevealRef.current;
    if (!pending || !layoutReadyRef.current) return;
    if (!layoutData.boxes.has(String(pending.id))) return;
    pendingRevealRef.current = null;
    centerOnNode(pending.id, pending.mode);
  }, [layoutData, selectionKey, centerOnNode]);

  const focusSelected = useCallback(() => {
    if (selectedNodeId !== null) centerOnNode(selectedNodeId, 'focus');
  }, [selectedNodeId, centerOnNode]);

  const fitTree = useCallback(() => {
    void fitView({ padding: FIT_PADDING, duration: prefersReducedMotion() ? 0 : 250 });
  }, [fitView]);

  // Reset all nodes/edges back to the computed layout positions, then refit
  const resetLayout = useCallback(() => {
    setRedrawEpoch((epoch) => epoch + 1);
    setTimeout(() => { void fitView({ padding: FIT_PADDING }); }, 50);
  }, [fitView]);

  const handleToggleCollapse = useCallback((nodeId: number) => {
    const willCollapse = !collapsedIds.has(nodeId);
    const box = getNodeBox(nodeId);
    if (box) {
      const { x: vx, y: vy, zoom } = getViewport();
      pendingAnchorRef.current = { id: nodeId, screenX: box.x * zoom + vx, screenY: box.y * zoom + vy };
    }
    updateCollapsed((prev) => setNodeCollapsed(prev, nodeId, willCollapse));
    // Collapsing over the selection moves it onto the collapsed stub, so the
    // selected operation never silently disappears from the canvas.
    if (
      willCollapse &&
      selectedNodeId !== null &&
      selectedNodeId !== nodeId &&
      getAncestorIds(selectedNodeId, parentOf).includes(nodeId)
    ) {
      markSelectionSource('canvas', nodeId);
      selectNodeForPlan(resolvedPlanIndex, nodeId);
    }
  }, [collapsedIds, getNodeBox, getViewport, updateCollapsed, selectedNodeId, parentOf, markSelectionSource, selectNodeForPlan, resolvedPlanIndex]);

  useLayoutEffect(() => {
    toggleCollapseRef.current = handleToggleCollapse;
  }, [handleToggleCollapse]);

  const expandAll = useCallback(() => {
    if (collapsedIds.size === 0) return;
    pendingFitRef.current = true;
    updateCollapsed(() => EMPTY_COLLAPSED);
  }, [collapsedIds, updateCollapsed]);

  // Collapse every subtree below the root, but keep the path to the selected
  // operation open so the selection stays on the canvas.
  const collapseAll = useCallback(() => {
    const next = selectedNodeId !== null
      ? expandAncestors(collapseAllTarget, [selectedNodeId], parentOf)
      : collapseAllTarget;
    if (next.size === collapsedIds.size && [...next].every((id) => collapsedIds.has(id))) return;
    pendingFitRef.current = true;
    updateCollapsed(() => next);
  }, [collapseAllTarget, selectedNodeId, parentOf, collapsedIds, updateCollapsed]);

  const changeDirection = useCallback((direction: TreeLayoutDirection) => {
    if (direction === layoutDirection) return;
    directionFocusRef.current = !!containerRef.current?.contains(document.activeElement);
    setTreeLayoutDirection(direction);
  }, [layoutDirection, directionFocusRef, setTreeLayoutDirection]);

  // After a direction switch remounted the canvas, return keyboard focus to
  // the direction control instead of dropping it on <body>.
  useEffect(() => {
    if (!directionFocusRef.current) return;
    directionFocusRef.current = false;
    containerRef.current
      ?.querySelector<HTMLButtonElement>('[data-tree-direction][aria-pressed="true"]')
      ?.focus({ preventScroll: true });
  }, [directionFocusRef]);

  // Let chrome outside the canvas (toolbar, command palette) drive the tree
  useEffect(() => {
    if (!registerExport) return;
    const actions: TreeViewActions = { expandAll, collapseAll, fitView: fitTree, focusSelected, resetLayout };
    treeViewActionsRef.current = actions;
    return () => {
      if (treeViewActionsRef.current === actions) treeViewActionsRef.current = null;
    };
  }, [registerExport, treeViewActionsRef, expandAll, collapseAll, fitTree, focusSelected, resetLayout]);

  // Decorate the freshly laid-out nodes with everything that does NOT depend on
  // the selection: filtering, display options, search, hotspot, annotations,
  // and the accessible name. Selection is applied by the cheap effect below, so
  // a selection change never rebuilds aria labels or reallocates node data.
  // Must use the React state setter (not useReactFlow's setNodes): the store-based
  // setter reads stale pre-layout nodes when this effect runs in the same commit as
  // the layout sync above, clobbering freshly computed positions (e.g. on density
  // preset changes) until a manual redraw.
  useEffect(() => {
    setNodes((currentNodes) =>
      currentNodes.map((node) => {
        if (node.type === 'queryBlockGroup' || node.type === 'annotationGroup') {
          return node;
        }
        const id = parseInt(node.id);
        const data = node.data as PlanNodeData;
        const isHotNode = hottestNodeId !== null && id === hottestNodeId;

        return {
          ...node,
          // Accessible name on the focusable React Flow node wrapper
          ariaLabel: planNodeAriaLabel(data.node, {
            hasActualStats: parsedPlan?.hasActualStats,
            isHotspot: isHotNode && effectiveDisplayOptions.showHotspotBadge,
            findingCount: effectiveDisplayOptions.showAdvisorBadge ? data.advisorCount : undefined,
            hiddenCount: data.hiddenCount,
          }),
          data: {
            ...node.data,
            isFiltered: filteredNodeIds.has(id),
            displayOptions: effectiveDisplayOptions,
            hasActualStats: parsedPlan?.hasActualStats,
            colorScheme,
            nodeIndicatorMetric,
            maxActualRows: parsedPlan?.maxActualRows,
            maxStarts: parsedPlan?.maxStarts,
            totalElapsedTime: parsedPlan?.totalElapsedTime,
            searchText,
            filterKey, // Include filterKey to force React Flow to detect changes
            isHotNode,
            annotationText: effectiveAnnotations.nodeAnnotations.get(id)?.text,
            highlightColor: effectiveAnnotations.nodeHighlights.get(id)?.color,
            // Each highlight carries its own style; legacy ones fall back to the global setting
            highlightStyle: effectiveAnnotations.nodeHighlights.get(id)?.style ?? highlightStyle,
            hiddenMatchCount: hiddenMatchCounts.get(id) ?? 0,
          },
        };
      })
    );
  }, [
    layoutData,
    redrawEpoch,
    filteredNodeIds,
    effectiveDisplayOptions,
    parsedPlan?.hasActualStats,
    colorScheme,
    nodeIndicatorMetric,
    parsedPlan?.maxActualRows,
    parsedPlan?.maxStarts,
    parsedPlan?.totalElapsedTime,
    setNodes,
    filterKey,
    searchText,
    hottestNodeId,
    effectiveAnnotations.nodeAnnotations,
    effectiveAnnotations.nodeHighlights,
    highlightStyle,
    hiddenMatchCounts,
  ]);

  // Selection / focus-path flags only. Declared after the effect above so that,
  // on a fresh layout, it runs on top of the decorated nodes in the same commit.
  // Nodes whose three flags are unchanged keep their object (and `data`), so a
  // selection change touches only the nodes entering or leaving the selection
  // (or the focus path) instead of rebuilding all of them.
  useEffect(() => {
    const focusEnabled = filters.focusSelection && selectedNodeId !== null && selectedNodeIds.length === 1;
    setNodes((currentNodes) =>
      currentNodes.map((node) => {
        if (node.type === 'queryBlockGroup' || node.type === 'annotationGroup') {
          return node;
        }
        const id = parseInt(node.id);
        const data = node.data as PlanNodeData;
        const isSelected = selectedNodeIdSet.has(id);
        const isInFocusPath =
          focusEnabled && (selectionSets.ancestorIds.has(id) || selectionSets.descendantIds.has(id));
        const isFocusDimmed = focusEnabled && !isInFocusPath;
        if (
          !!data.isSelected === isSelected &&
          !!data.isInFocusPath === isInFocusPath &&
          !!data.isFocusDimmed === isFocusDimmed
        ) {
          return node;
        }
        return { ...node, data: { ...node.data, isSelected, isInFocusPath, isFocusDimmed } };
      })
    );
  }, [
    layoutData,
    redrawEpoch,
    selectedNodeId,
    selectedNodeIds.length,
    selectedNodeIdSet,
    filters.focusSelection,
    selectionSets.ancestorIds,
    selectionSets.descendantIds,
    setNodes,
  ]);

  // Update edge styles separately - only create new objects when values change
  useEffect(() => {
    // Marching-ants edges are motion: off under prefers-reduced-motion
    const animated = filters.animateEdges && !reducedMotion;
    setEdges((currentEdges) =>
      currentEdges.map((edge) => {
        const edgeColors = EDGE_SCHEME_COLORS[colorScheme][theme === 'dark' ? 'dark' : 'light'];
        const newStroke = filteredNodeIds.has(parseInt(edge.target)) ? edgeColors.active : edgeColors.default;
        const currentStroke = edge.style?.stroke;
        const currentAnimated = edge.animated;
        const currentStrokeWidth = edge.style?.strokeWidth;
        const currentStrokeOpacity = edge.style?.strokeOpacity;
        const currentLabelStyle = edge.labelStyle as { fill?: string; fontSize?: number; fontWeight?: number } | undefined;
        const currentLabelBgStyle = edge.labelBgStyle as { fill?: string; fillOpacity?: number } | undefined;
        const focusEnabled = filters.focusSelection && selectedNodeId !== null && selectedNodeIds.length === 1;

        const sourceId = parseInt(edge.source);
        const targetId = parseInt(edge.target);
        const isAncestorEdge = focusEnabled && selectionSets.ancestorIds.has(sourceId) && selectionSets.ancestorIds.has(targetId);
        const isDescendantEdge = focusEnabled && selectionSets.descendantIds.has(sourceId) && selectionSets.descendantIds.has(targetId);

        let stroke = newStroke;
        let strokeOpacity: number | undefined = undefined;
        const baseWidthRaw = edge.style?.strokeWidth ?? 2;
        const baseWidth = typeof baseWidthRaw === 'number' ? baseWidthRaw : parseFloat(baseWidthRaw.toString()) || 2;
        let strokeWidth = baseWidth;

        if (focusEnabled) {
          if (isAncestorEdge) {
            stroke = edgeColors.focus;
            strokeWidth = Math.max(baseWidth, 4);
            strokeOpacity = 0.85;
          } else if (isDescendantEdge) {
            stroke = edgeColors.focus;
            strokeWidth = Math.max(baseWidth, 3);
            strokeOpacity = 0.6;
          } else {
            stroke = edgeColors.dimmed;
            strokeOpacity = 0.3;
          }
        }

        const labelFill = theme === 'dark' ? '#a3a3a3' : '#737373';
        // Tuned to the staged canvas backdrop so edge labels don't read as chips.
        // A CSS variable, so it tracks both the theme and the active app palette
        // (a fixed navy would clash with the warm graphite/paper canvases).
        const labelBgFill = 'var(--canvas-label-bg)';
        const labelStyle = { fill: labelFill, fontSize: 10, fontWeight: 500 };
        const labelBgStyle = { fill: labelBgFill, fillOpacity: 0.9 };

        // Only create new edge object if something changed
        if (
          currentStroke === stroke &&
          currentAnimated === animated &&
          currentStrokeWidth === strokeWidth &&
          currentStrokeOpacity === strokeOpacity &&
          currentLabelStyle?.fill === labelStyle.fill &&
          currentLabelStyle?.fontSize === labelStyle.fontSize &&
          currentLabelStyle?.fontWeight === labelStyle.fontWeight &&
          currentLabelBgStyle?.fill === labelBgStyle.fill &&
          currentLabelBgStyle?.fillOpacity === labelBgStyle.fillOpacity
        ) {
          return edge;
        }

        return {
          ...edge,
          animated,
          labelStyle,
          labelBgStyle,
          style: {
            ...edge.style,
            stroke,
            strokeWidth,
            strokeOpacity,
          },
        };
      })
    );
  }, [layoutData, redrawEpoch, filteredNodeIds, filters.animateEdges, reducedMotion, filters.focusSelection, selectedNodeId, selectedNodeIds.length, selectionSets.ancestorIds, selectionSets.descendantIds, theme, colorScheme, setEdges]);

  const onNodeClick = useCallback(
    (event: React.MouseEvent, node: Node) => {
      // Ignore clicks on group overlay nodes — treat as pane click (deselect)
      if (node.type === 'queryBlockGroup' || node.type === 'annotationGroup') {
        selectNodeForPlan(resolvedPlanIndex, null);
        return;
      }
      const additive = event.metaKey || event.ctrlKey;
      const id = parseInt(node.id);
      markSelectionSource('canvas', id);
      setActivePlan(resolvedPlanIndex);
      selectNodeForPlan(resolvedPlanIndex, id, { additive });
    },
    [resolvedPlanIndex, selectNodeForPlan, setActivePlan, markSelectionSource]
  );

  const onPaneClick = useCallback(() => {
    selectNodeForPlan(resolvedPlanIndex, null);
  }, [resolvedPlanIndex, selectNodeForPlan]);

  // Keyboard navigation. Top-down: Up = parent, Down = first child, Left/Right
  // = previous/next operation at the same depth. Left-to-right rotates the
  // mapping (Left = parent, Right = first child, Up/Down = same depth).
  // Stepping into a collapsed subtree expands it (via the selection effect).
  useEffect(() => {
    if (resolvedPlanIndex !== activePlanIndex) {
      return undefined;
    }

    const parentKey = isHorizontal ? 'ArrowLeft' : 'ArrowUp';
    const childKey = isHorizontal ? 'ArrowRight' : 'ArrowDown';
    const previousKey = isHorizontal ? 'ArrowUp' : 'ArrowLeft';
    const nextKey = isHorizontal ? 'ArrowDown' : 'ArrowRight';

    const handleKeyDown = (e: KeyboardEvent) => {
      // Don't hijack keys while the user is typing in an input (search box,
      // annotation editor, command palette, rename field, ...)
      const target = e.target as HTMLElement | null;
      const tag = target?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target?.isContentEditable) {
        return;
      }
      const isArrow = e.key === 'ArrowUp' || e.key === 'ArrowDown' || e.key === 'ArrowLeft' || e.key === 'ArrowRight';

      if (!parsedPlan || selectedNodeId === null) {
        // Escape clears selection regardless
        if (e.key === 'Escape') {
          selectNodeForPlan(resolvedPlanIndex, null);
          return;
        }
        // With nothing selected, an arrow key starts navigation at the root
        if (parsedPlan?.rootNode && isArrow) {
          e.preventDefault();
          markSelectionSource('keyboard', parsedPlan.rootNode.id);
          selectNodeForPlan(resolvedPlanIndex, parsedPlan.rootNode.id);
        }
        return;
      }

      const node = nodeById.get(selectedNodeId);
      if (!node) return;

      let targetId: number | null = null;

      if (e.key === 'Escape') {
        selectNodeForPlan(resolvedPlanIndex, null);
        return;
      } else if (e.key === parentKey) {
        if (node.parentId !== undefined) targetId = node.parentId;
      } else if (e.key === childKey) {
        if (node.children.length > 0) targetId = node.children[0].id;
      } else if (e.key === previousKey || e.key === nextKey) {
        // Previous/next *visible* node at the same depth, anywhere in the
        // tree (siblings first, since they are adjacent in plan order)
        targetId = stepAtSameDepth(depthIndex, node, e.key === previousKey ? -1 : 1);
      } else {
        return;
      }

      if (targetId !== null) {
        e.preventDefault();
        markSelectionSource('keyboard', targetId);
        selectNodeForPlan(resolvedPlanIndex, targetId);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [activePlanIndex, nodeById, parsedPlan, resolvedPlanIndex, selectNodeForPlan, selectedNodeId, isHorizontal, depthIndex, markSelectionSource]);

  // Root → selected path for the breadcrumb (single selection, single-plan tree).
  const breadcrumbPath = useMemo((): Crumb[] => {
    if (selectedNodeId === null || selectedNodeIds.length !== 1) return [];
    const ids = [...getAncestorIds(selectedNodeId, parentOf).reverse(), selectedNodeId];
    return ids.flatMap((id) => {
      const node = nodeById.get(id);
      return node ? [{ id, operation: node.operation, objectName: node.objectName }] : [];
    });
  }, [selectedNodeId, selectedNodeIds, parentOf, nodeById]);
  const selectBreadcrumbNode = useCallback(
    (id: number) => selectNodeForPlan(resolvedPlanIndex, id),
    [selectNodeForPlan, resolvedPlanIndex],
  );

  const minimapWanted =
    treeMinimap === 'on' || (treeMinimap === 'auto' && visibleNodeCount > MINIMAP_AUTO_THRESHOLD);
  const showMinimap = !isExporting && minimapWanted;

  // Publish what the toolbar's layout strip shows (hidden count for "Expand
  // all", whether anything can collapse, whether the 'auto' map is on screen).
  // Only the single-plan tree does; compare panes keep their own overlay strip.
  // (`minimapWanted`, not `showMinimap`: the PNG export briefly hides the map
  // and the toolbar should not flicker for it.)
  const hiddenCount = hiddenNodeIds.size;
  const canCollapse = collapseAllTarget.size > 0;
  useEffect(() => {
    if (!registerExport) return;
    setTreeViewState({ hiddenCount, canCollapse, minimapShown: minimapWanted });
  }, [registerExport, hiddenCount, canCollapse, minimapWanted, setTreeViewState]);
  useEffect(() => {
    if (!registerExport) return;
    return () => setTreeViewState(null);
  }, [registerExport, setTreeViewState]);
  const minimapNodeColor = useCallback((node: Node): string => {
    if (node.type !== 'planNode') return 'transparent';
    const data = node.data as PlanNodeData;
    const dark = theme === 'dark';
    if (data.isSelected) return dark ? '#60a5fa' : '#2563eb';
    if (data.isHotNode) return dark ? '#f87171' : '#dc2626';
    if (!data.isFiltered) return dark ? 'rgba(100,116,139,0.35)' : 'rgba(148,163,184,0.45)';
    if (data.isCollapsed) return dark ? '#818cf8' : '#6366f1';
    return dark ? '#64748b' : '#94a3b8';
  }, [theme]);

  if (!parsedPlan?.rootNode) {
    return (
      <div className="flex items-center justify-center h-full text-slate-500 dark:text-slate-400">
        No plan loaded yet. Paste an execution plan in the input panel and press Parse.
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      data-tour="tree"
      className={`relative w-full h-full min-h-[320px] min-w-0 overflow-hidden motion-safe:transition-opacity motion-safe:duration-150 ${
        layoutReady ? 'opacity-100' : 'opacity-0'
      }`}
    >
      {/* Staged canvas backdrop: the tree sits in a soft pool of light.
          One layer — the gradient stops are CSS variables that follow the
          .dark root class and the active app palette. */}
      <div
        aria-hidden
        className="absolute inset-0 pointer-events-none"
        style={{ background: CANVAS_BACKDROP }}
      />
      <ReactFlow
        className="!bg-transparent"
        nodes={nodes}
        edges={edges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onNodeClick={onNodeClick}
        onPaneClick={onPaneClick}
        nodeTypes={nodeTypes}
        fitView
        fitViewOptions={{ padding: FIT_PADDING }}
        minZoom={0.1}
        maxZoom={2}
        onlyRenderVisibleElements={!isExporting}
      >
        {/* Transparent so the staged gradient behind the flow shows through
            (index.css paints .react-flow__background flat in dark mode). */}
        <Background
          variant={BackgroundVariant.Dots}
          gap={20}
          size={1}
          className="!bg-transparent"
          color={theme === 'dark' ? 'rgba(148,163,184,0.16)' : 'rgba(100,116,139,0.16)'}
        />
        <Controls className="!bg-transparent !border-none !shadow-none [&_button]:!bg-white/80 [&_button]:!border-slate-200/80 [&_button]:!text-slate-600 [&_button]:backdrop-blur-sm dark:[&_button]:!bg-slate-800/70 dark:[&_button]:!border-slate-700/70 dark:[&_button]:!text-slate-300 [&_button:hover]:!bg-white dark:[&_button:hover]:!bg-slate-700/80" />
        {/* Overview map: bottom-right, clear of the bottom-left Controls */}
        {showMinimap && (
          <MiniMap
            position="bottom-right"
            pannable
            zoomable
            ariaLabel="Plan overview map"
            className="overflow-hidden rounded-lg border border-slate-200/80 dark:border-slate-700/70 shadow-sm"
            style={{ width: 176, height: 120 }}
            bgColor="var(--canvas-bg)"
            maskColor={theme === 'dark' ? 'rgba(2, 6, 23, 0.55)' : 'rgba(241, 245, 249, 0.7)'}
            maskStrokeColor={theme === 'dark' ? '#60a5fa' : '#2563eb'}
            maskStrokeWidth={1.5}
            nodeColor={minimapNodeColor}
            nodeStrokeColor="transparent"
            nodeBorderRadius={6}
          />
        )}
        {/* The single-plan tree's layout strip lives in the workspace toolbar
            (and focus mode's View chip), wired through the context. Compare
            panes have no toolbar strip — the toolbar cannot address one pane —
            so they keep this per-pane overlay. */}
        {registerExport && breadcrumbPath.length > 0 && (
          <Panel position="top-left" style={{ maxWidth: 'calc(100% - 7rem)' }}>
            <SelectionBreadcrumb path={breadcrumbPath} onSelect={selectBreadcrumbNode} onReturn={focusSelected} />
          </Panel>
        )}
        {!registerExport && (
          <Panel position="top-left">
            <TreeLayoutControls
              direction={layoutDirection}
              onDirectionChange={changeDirection}
              minimap={treeMinimap}
              onMinimapChange={setTreeMinimap}
              minimapShown={showMinimap}
              onExpandAll={expandAll}
              onCollapseAll={collapseAll}
              hiddenCount={hiddenCount}
              canCollapse={canCollapse}
              onFocusSelected={focusSelected}
              canFocusSelected={selectedNodeId !== null}
              onRedraw={resetLayout}
            />
          </Panel>
        )}
      </ReactFlow>
    </div>
  );
}

interface HierarchicalViewProps {
  planIndex?: number;
  registerExport?: boolean;
  showAnnotations?: boolean;
}

export function HierarchicalView({
  planIndex,
  registerExport = true,
  showAnnotations = true,
}: HierarchicalViewProps) {
  const { plans, activePlanIndex, colorScheme, treeLayoutDirection } = usePlan();
  const resolvedPlanIndex = planIndex ?? activePlanIndex;
  const parsedPlan = plans[resolvedPlanIndex]?.parsedPlan ?? null;

  // Collapsed subtrees, per plan and in memory only. Held out here (not in the
  // keyed content below) so layout-direction / colour-scheme remounts keep it;
  // the plan-keyed memory in treeCollapse.ts also carries it across view
  // switches. A different plan (new parsed object) starts fully expanded.
  const [collapse, setCollapse] = useState(() => ({ plan: parsedPlan, ids: recallCollapsed(parsedPlan) }));
  const collapsedIds = collapse.plan === parsedPlan ? collapse.ids : recallCollapsed(parsedPlan);
  const updateCollapsed = useCallback((updater: CollapseUpdater) => {
    setCollapse((prev) => {
      const base = prev.plan === parsedPlan ? prev.ids : recallCollapsed(parsedPlan);
      const next = updater(base);
      if (next === base && prev.plan === parsedPlan) return prev;
      rememberCollapsed(parsedPlan, next);
      return { plan: parsedPlan, ids: next };
    });
  }, [parsedPlan]);
  const directionFocusRef = useRef(false);

  // Create a unique key that changes when the plan, color scheme or layout
  // direction changes to force a complete remount. This resets
  // useNodesState/useEdgesState with fresh state, recalculates node dimensions
  // and handle positions from scratch, and refits the new layout.
  const planKey = parsedPlan
    ? `${parsedPlan.planHashValue ?? 'nohash'}-${parsedPlan.allNodes.length}-${parsedPlan.rootNode?.operation ?? ''}-${colorScheme}-${treeLayoutDirection}`
    : `no-plan-${colorScheme}-${treeLayoutDirection}`;

  return (
    <ReactFlowProvider key={planKey}>
      <HierarchicalViewContent
        planIndex={resolvedPlanIndex}
        registerExport={registerExport}
        showAnnotations={showAnnotations}
        layoutDirection={treeLayoutDirection}
        collapsedIds={collapsedIds}
        updateCollapsed={updateCollapsed}
        directionFocusRef={directionFocusRef}
      />
    </ReactFlowProvider>
  );
}
