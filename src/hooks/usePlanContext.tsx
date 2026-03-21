/* eslint-disable react-refresh/only-export-components */
import { createContext, useContext, useReducer, useCallback, useEffect, useMemo, useRef } from 'react';
import type { ReactNode } from 'react';
import type { ParsedPlan, PlanNode, FilterState, ViewMode, SankeyMetric, NodeIndicatorMetric, Theme, ColorScheme } from '../lib/types';
import type { PlanSlot, CompareMetric } from '../lib/compare';
import { createEmptySlot, DEFAULT_COMPARE_METRICS, getPlanSlotLabel } from '../lib/compare';
import { parseExplainPlan, splitDbmsXplanPlanBatches } from '../lib/parser';
import { loadSettings, saveSettings, extractFilterSettings, applySettingsToFilters } from '../lib/settings';
import { matchesFilters } from '../lib/filtering';
import { getPlanFromUrl, clearPlanFromUrl, buildShareUrl } from '../lib/url';
import type { SharePayload } from '../lib/url';
import type { AnnotationState, AnnotationGroup, HighlightColor, AnnotatedPlanExport } from '../lib/annotations';
import { createEmptyAnnotationState, hasAnnotations, serializeAnnotations, deserializeAnnotations, validateExport, downloadAnnotatedPlan, generateGroupId } from '../lib/annotations';

interface PlanState {
  plans: PlanSlot[];
  activePlanIndex: number;
  comparePlanIndices: [number, number];
  compareMetrics: CompareMetric[];
  viewMode: ViewMode;
  treeCompareEnabled: boolean;
  sankeyMetric: SankeyMetric;
  nodeIndicatorMetric: NodeIndicatorMetric;
  colorScheme: ColorScheme;
  theme: Theme;
  filters: FilterState;
  // UI panel states (persisted)
  hotspotsEnabled: boolean;
  legendVisible: boolean;
  inputPanelCollapsed: boolean;
  filterPanelCollapsed: boolean;
  detailPanelCollapsed: boolean;
  visualizationMaximized: boolean;
  _preMaxPanelState: { filter: boolean; detail: boolean } | null;
  // Annotations (overlay, not persisted to localStorage)
  annotations: AnnotationState;
  hasUnsavedAnnotations: boolean;
}

type PlanAction =
  | { type: 'REPLACE_PLANS'; payload: { plans: PlanSlot[]; activePlanIndex?: number } }
  | { type: 'SET_INPUT'; payload: string }
  | { type: 'SET_PARSED_PLAN'; payload: ParsedPlan }
  | { type: 'SELECT_NODE'; payload: { id: number | null; additive?: boolean } }
  | { type: 'SELECT_NODE_FOR_PLAN'; payload: { index: number; id: number | null; additive?: boolean } }
  | { type: 'SET_VIEW_MODE'; payload: ViewMode }
  | { type: 'SET_TREE_COMPARE_ENABLED'; payload: boolean }
  | { type: 'SET_SANKEY_METRIC'; payload: SankeyMetric }
  | { type: 'SET_NODE_INDICATOR_METRIC'; payload: NodeIndicatorMetric }
  | { type: 'SET_COLOR_SCHEME'; payload: ColorScheme }
  | { type: 'SET_THEME'; payload: Theme }
  | { type: 'SET_FILTERS'; payload: Partial<FilterState> }
  | { type: 'SET_ERROR'; payload: string | null }
  | { type: 'CLEAR_PLAN' }
  | { type: 'SET_HOTSPOTS_ENABLED'; payload: boolean }
  | { type: 'SET_LEGEND_VISIBLE'; payload: boolean }
  | { type: 'SET_INPUT_PANEL_COLLAPSED'; payload: boolean }
  | { type: 'SET_FILTER_PANEL_COLLAPSED'; payload: boolean }
  | { type: 'SET_DETAIL_PANEL_COLLAPSED'; payload: boolean }
  | { type: 'SET_VISUALIZATION_MAXIMIZED'; payload: boolean }
  | { type: 'REMOVE_PLAN_SLOT'; payload: number }
  | { type: 'RENAME_PLAN_SLOT'; payload: { index: number; customLabel: string } }
  | { type: 'SET_ACTIVE_PLAN'; payload: number }
  | { type: 'SET_COMPARE_PLAN_INDICES'; payload: [number, number] }
  | { type: 'SWAP_COMPARE_PLAN_INDICES' }
  | { type: 'SET_COMPARE_METRICS'; payload: CompareMetric[] }
  | { type: 'SET_NODE_ANNOTATION'; payload: { nodeId: number; text: string } }
  | { type: 'REMOVE_NODE_ANNOTATION'; payload: number }
  | { type: 'SET_NODE_HIGHLIGHT'; payload: { nodeId: number; color: HighlightColor } }
  | { type: 'REMOVE_NODE_HIGHLIGHT'; payload: number }
  | { type: 'ADD_ANNOTATION_GROUP'; payload: Omit<AnnotationGroup, 'id'> }
  | { type: 'UPDATE_ANNOTATION_GROUP'; payload: AnnotationGroup }
  | { type: 'REMOVE_ANNOTATION_GROUP'; payload: string }
  | { type: 'LOAD_ANNOTATIONS'; payload: AnnotationState }
  | { type: 'CLEAR_ANNOTATIONS' };

const initialFilters: FilterState = {
  operationTypes: [],
  minCost: 0,
  maxCost: Infinity,
  searchText: '',
  showPredicates: true,
  predicateTypes: [],
  animateEdges: false,
  focusSelection: false,
  nodeDisplayOptions: {
    showRows: true,
    showCost: true,
    showBytes: true,
    showObjectName: true,
    showPredicateIndicators: true,
    showPredicateDetails: false,
    showQueryBlockBadge: true,
    showQueryBlockGrouping: true,
    // SQL Monitor actual statistics (shown by default when available)
    showActualRows: true,
    showActualTime: true,
    showStarts: true,
    // Warning badges
    showHotspotBadge: true,
    showSpillBadge: true,
    showCardinalityBadge: true,
    // Annotations overlay
    showAnnotations: true,
  },
  // SQL Monitor actual statistics filters
  minActualRows: 0,
  maxActualRows: Infinity,
  minActualTime: 0,
  maxActualTime: Infinity,
  // Cardinality mismatch filter
  minCardinalityMismatch: 0,
};

const getInitialTheme = (): Theme => {
  if (typeof window === 'undefined') return 'light';
  const stored = localStorage.getItem('theme');
  if (stored === 'dark' || stored === 'light') return stored;
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
};

function getParsedPlanIndices(plans: PlanSlot[]): number[] {
  return plans.reduce<number[]>((indices, slot, index) => {
    if (slot.parsedPlan) {
      indices.push(index);
    }
    return indices;
  }, []);
}

function relabelPlanSlots(plans: PlanSlot[]): PlanSlot[] {
  return plans.map((slot, index) => ({
    ...slot,
    id: `plan-${index}`,
    label: getPlanSlotLabel(index),
    customLabel: slot.customLabel,
  }));
}

function normalizePlanState(
  nextState: PlanState,
  options?: { preserveTreeCompare?: boolean }
): PlanState {
  const plans = relabelPlanSlots(nextState.plans);
  const activePlanIndex = Math.min(nextState.activePlanIndex, Math.max(0, plans.length - 1));
  const parsedPlanIndices = getParsedPlanIndices(plans);
  const comparePlanIndices = normalizeComparePlanIndices(plans, nextState.comparePlanIndices);
  const hasComparablePair = parsedPlanIndices.length >= 2;

  return {
    ...nextState,
    plans,
    activePlanIndex,
    comparePlanIndices,
    treeCompareEnabled: hasComparablePair && (options?.preserveTreeCompare ?? nextState.treeCompareEnabled),
    viewMode: hasComparablePair || nextState.viewMode !== 'compare' ? nextState.viewMode : 'hierarchical',
  };
}

function getDefaultComparePlanIndices(plans: PlanSlot[]): [number, number] {
  const parsedPlanIndices = getParsedPlanIndices(plans);

  if (parsedPlanIndices.length >= 2) {
    return [parsedPlanIndices[0], parsedPlanIndices[1]];
  }

  if (plans.length >= 2) {
    return [0, 1];
  }

  return [0, 0];
}

function normalizeComparePlanIndices(
  plans: PlanSlot[],
  comparePlanIndices: [number, number]
): [number, number] {
  if (plans.length === 0) {
    return [0, 0];
  }

  const parsedPlanIndices = getParsedPlanIndices(plans);
  const availableIndices = parsedPlanIndices.length >= 2
    ? parsedPlanIndices
    : plans.map((_, index) => index);

  if (availableIndices.length < 2) {
    return [availableIndices[0] ?? 0, availableIndices[0] ?? 0];
  }

  let [leftIndex, rightIndex] = comparePlanIndices;

  if (!availableIndices.includes(leftIndex)) {
    leftIndex = availableIndices[0];
  }

  if (!availableIndices.includes(rightIndex) || rightIndex === leftIndex) {
    rightIndex = availableIndices.find((index) => index !== leftIndex) ?? availableIndices[0];
  }

  if (leftIndex === rightIndex) {
    return getDefaultComparePlanIndices(plans);
  }

  return [leftIndex, rightIndex];
}

const getInitialState = (): PlanState => {
  const settings = loadSettings();
  const initialPlans = [createEmptySlot(0)];
  return {
    plans: initialPlans,
    activePlanIndex: 0,
    comparePlanIndices: getDefaultComparePlanIndices(initialPlans),
    compareMetrics: settings.compareMetrics ?? DEFAULT_COMPARE_METRICS,
    viewMode: settings.viewMode,
    treeCompareEnabled: false,
    sankeyMetric: settings.sankeyMetric,
    nodeIndicatorMetric: settings.nodeIndicatorMetric,
    colorScheme: settings.colorScheme ?? 'muted',
    theme: getInitialTheme(),
    filters: applySettingsToFilters(initialFilters, settings),
    hotspotsEnabled: settings.hotspotsEnabled ?? true,
    legendVisible: settings.legendVisible,
    inputPanelCollapsed: initialPlans.some((slot) => slot.parsedPlan) ? settings.inputPanelCollapsed : false,
    filterPanelCollapsed: settings.filterPanelCollapsed,
    detailPanelCollapsed: false,
    visualizationMaximized: false,
    _preMaxPanelState: null,
    annotations: createEmptyAnnotationState(),
    hasUnsavedAnnotations: false,
  };
};

function updateActiveSlot(state: PlanState, updater: (slot: PlanSlot) => PlanSlot): PlanState {
  const plans = state.plans.map((slot, index) =>
    index === state.activePlanIndex ? updater(slot) : slot
  );
  return { ...state, plans };
}

function updatePlanSlot(state: PlanState, index: number, updater: (slot: PlanSlot) => PlanSlot): PlanState {
  const plans = state.plans.map((slot, slotIndex) =>
    slotIndex === index ? updater(slot) : slot
  );
  return { ...state, plans };
}

function updateSlotSelection(slot: PlanSlot, id: number | null, additive?: boolean): PlanSlot {
  if (id === null) {
    return { ...slot, selectedNodeId: null, selectedNodeIds: [] };
  }

  if (!additive) {
    return { ...slot, selectedNodeId: id, selectedNodeIds: [id] };
  }

  const isAlreadySelected = slot.selectedNodeIds.includes(id);
  if (isAlreadySelected) {
    const nextSelectedNodeIds = slot.selectedNodeIds.filter((nodeId) => nodeId !== id);
    const nextPrimaryId = nextSelectedNodeIds.length > 0
      ? nextSelectedNodeIds[nextSelectedNodeIds.length - 1]
      : null;
    return {
      ...slot,
      selectedNodeId: slot.selectedNodeId === id ? nextPrimaryId : slot.selectedNodeId,
      selectedNodeIds: nextSelectedNodeIds,
    };
  }

  return {
    ...slot,
    selectedNodeId: id,
    selectedNodeIds: [...slot.selectedNodeIds, id],
  };
}

function planReducer(state: PlanState, action: PlanAction): PlanState {
  switch (action.type) {
    case 'REPLACE_PLANS': {
      const incomingPlans = action.payload.plans.length > 0 ? action.payload.plans : [createEmptySlot(0)];
      return normalizePlanState({
        ...state,
        plans: incomingPlans,
        activePlanIndex: action.payload.activePlanIndex ?? 0,
        comparePlanIndices: getDefaultComparePlanIndices(incomingPlans),
        inputPanelCollapsed: incomingPlans.some((slot) => slot.parsedPlan) ? state.inputPanelCollapsed : false,
        annotations: createEmptyAnnotationState(),
        hasUnsavedAnnotations: false,
      });
    }

    case 'SET_INPUT':
      return updateActiveSlot(state, slot => ({ ...slot, rawInput: action.payload, error: null }));

    case 'SET_PARSED_PLAN': {
      const newMetric = !action.payload.hasActualStats && state.nodeIndicatorMetric !== 'cost'
        ? 'cost' as NodeIndicatorMetric
        : state.nodeIndicatorMetric;
      const nextState = updateActiveSlot(state, slot => ({
        ...slot,
        parsedPlan: action.payload,
        error: null,
        selectedNodeId: null,
        selectedNodeIds: [],
      }));
      const comparePlanIndices = normalizeComparePlanIndices(nextState.plans, state.comparePlanIndices);
      const parsedPlanCount = nextState.plans.filter((slot) => slot.parsedPlan).length;
      return {
        ...nextState,
        nodeIndicatorMetric: newMetric,
        comparePlanIndices,
        treeCompareEnabled: parsedPlanCount >= 2 && state.treeCompareEnabled,
        annotations: createEmptyAnnotationState(),
        hasUnsavedAnnotations: false,
      };
    }

    case 'SELECT_NODE': {
      const { id, additive } = action.payload;
      return updateActiveSlot(state, slot => updateSlotSelection(slot, id, additive));
    }

    case 'SELECT_NODE_FOR_PLAN': {
      const { index, id, additive } = action.payload;
      return updatePlanSlot(state, index, (slot) => updateSlotSelection(slot, id, additive));
    }

    case 'SET_VIEW_MODE':
      return { ...state, viewMode: action.payload };

    case 'SET_TREE_COMPARE_ENABLED':
      return {
        ...state,
        treeCompareEnabled: action.payload && getParsedPlanIndices(state.plans).length >= 2,
      };

    case 'SET_SANKEY_METRIC':
      return { ...state, sankeyMetric: action.payload };

    case 'SET_NODE_INDICATOR_METRIC':
      return { ...state, nodeIndicatorMetric: action.payload };

    case 'SET_COLOR_SCHEME':
      return { ...state, colorScheme: action.payload };

    case 'SET_THEME':
      return { ...state, theme: action.payload };

    case 'SET_FILTERS':
      return {
        ...state,
        filters: { ...state.filters, ...action.payload },
      };

    case 'SET_ERROR':
      return updateActiveSlot(state, slot => ({ ...slot, error: action.payload }));

    case 'CLEAR_PLAN':
      {
        const nextState = updateActiveSlot(state, slot => ({
          ...slot,
          rawInput: '',
          parsedPlan: null,
          selectedNodeId: null,
          selectedNodeIds: [],
          error: null,
        }));
        const parsedPlanCount = nextState.plans.filter((slot) => slot.parsedPlan).length;
        return {
          ...nextState,
          comparePlanIndices: normalizeComparePlanIndices(nextState.plans, state.comparePlanIndices),
          treeCompareEnabled: parsedPlanCount >= 2 && state.treeCompareEnabled,
          viewMode: parsedPlanCount < 2 && state.viewMode === 'compare'
            ? 'hierarchical'
            : state.viewMode,
          filters: applySettingsToFilters(initialFilters, loadSettings()),
          annotations: createEmptyAnnotationState(),
          hasUnsavedAnnotations: false,
        };
      }

    case 'SET_HOTSPOTS_ENABLED':
      return { ...state, hotspotsEnabled: action.payload };

    case 'SET_LEGEND_VISIBLE':
      return { ...state, legendVisible: action.payload };

    case 'SET_INPUT_PANEL_COLLAPSED':
      return { ...state, inputPanelCollapsed: action.payload };

    case 'SET_FILTER_PANEL_COLLAPSED':
      return { ...state, filterPanelCollapsed: action.payload };

    case 'SET_DETAIL_PANEL_COLLAPSED':
      return { ...state, detailPanelCollapsed: action.payload };

    case 'SET_VISUALIZATION_MAXIMIZED': {
      if (action.payload) {
        return {
          ...state,
          visualizationMaximized: true,
          _preMaxPanelState: { filter: state.filterPanelCollapsed, detail: state.detailPanelCollapsed },
          filterPanelCollapsed: true,
          detailPanelCollapsed: true,
        };
      }
      const saved = state._preMaxPanelState;
      return {
        ...state,
        visualizationMaximized: false,
        filterPanelCollapsed: saved?.filter ?? state.filterPanelCollapsed,
        detailPanelCollapsed: saved?.detail ?? state.detailPanelCollapsed,
        _preMaxPanelState: null,
      };
    }

    case 'RENAME_PLAN_SLOT': {
      const { index, customLabel } = action.payload;
      if (index < 0 || index >= state.plans.length) return state;
      return updatePlanSlot(state, index, (slot) => ({
        ...slot,
        customLabel: customLabel.trim() || undefined,
      }));
    }

    case 'REMOVE_PLAN_SLOT': {
      const removeIndex = action.payload;
      if (state.plans.length <= 1) return state;
      const newPlans = state.plans.filter((_, i) => i !== removeIndex);
      const relabeled = newPlans.map((slot, i) => ({
        ...slot,
        id: `plan-${i}`,
        label: getPlanSlotLabel(i),
        customLabel: slot.customLabel,
      }));
      let newActiveIndex = state.activePlanIndex;
      if (removeIndex <= state.activePlanIndex) {
        newActiveIndex = Math.max(0, state.activePlanIndex - 1);
      }
      newActiveIndex = Math.min(newActiveIndex, relabeled.length - 1);
      return normalizePlanState({
        ...state,
        plans: relabeled,
        activePlanIndex: newActiveIndex,
        comparePlanIndices: state.comparePlanIndices.map((index) => {
          if (index === removeIndex) return -1;
          return index > removeIndex ? index - 1 : index;
        }) as [number, number],
      });
    }

    case 'SET_ACTIVE_PLAN':
      return { ...state, activePlanIndex: Math.max(0, Math.min(action.payload, state.plans.length - 1)) };

    case 'SET_COMPARE_PLAN_INDICES':
      return { ...state, comparePlanIndices: normalizeComparePlanIndices(state.plans, action.payload) };

    case 'SWAP_COMPARE_PLAN_INDICES':
      return { ...state, comparePlanIndices: [state.comparePlanIndices[1], state.comparePlanIndices[0]] };

    case 'SET_COMPARE_METRICS':
      return { ...state, compareMetrics: action.payload };

    case 'SET_NODE_ANNOTATION': {
      const { nodeId, text } = action.payload;
      const newAnnotations = new Map(state.annotations.nodeAnnotations);
      const now = new Date().toISOString();
      const existing = newAnnotations.get(nodeId);
      newAnnotations.set(nodeId, {
        nodeId,
        text,
        createdAt: existing?.createdAt || now,
        updatedAt: now,
      });
      return {
        ...state,
        annotations: { ...state.annotations, nodeAnnotations: newAnnotations },
        hasUnsavedAnnotations: true,
      };
    }

    case 'REMOVE_NODE_ANNOTATION': {
      const newAnnotations = new Map(state.annotations.nodeAnnotations);
      newAnnotations.delete(action.payload);
      return {
        ...state,
        annotations: { ...state.annotations, nodeAnnotations: newAnnotations },
        hasUnsavedAnnotations: true,
      };
    }

    case 'SET_NODE_HIGHLIGHT': {
      const { nodeId, color } = action.payload;
      const newHighlights = new Map(state.annotations.nodeHighlights);
      newHighlights.set(nodeId, { nodeId, color });
      return {
        ...state,
        annotations: { ...state.annotations, nodeHighlights: newHighlights },
        hasUnsavedAnnotations: true,
      };
    }

    case 'REMOVE_NODE_HIGHLIGHT': {
      const newHighlights = new Map(state.annotations.nodeHighlights);
      newHighlights.delete(action.payload);
      return {
        ...state,
        annotations: { ...state.annotations, nodeHighlights: newHighlights },
        hasUnsavedAnnotations: true,
      };
    }

    case 'ADD_ANNOTATION_GROUP': {
      const newGroup: AnnotationGroup = {
        ...action.payload,
        id: generateGroupId(),
      };
      return {
        ...state,
        annotations: {
          ...state.annotations,
          groups: [...state.annotations.groups, newGroup],
        },
        hasUnsavedAnnotations: true,
      };
    }

    case 'UPDATE_ANNOTATION_GROUP': {
      return {
        ...state,
        annotations: {
          ...state.annotations,
          groups: state.annotations.groups.map((g) =>
            g.id === action.payload.id ? action.payload : g
          ),
        },
        hasUnsavedAnnotations: true,
      };
    }

    case 'REMOVE_ANNOTATION_GROUP': {
      return {
        ...state,
        annotations: {
          ...state.annotations,
          groups: state.annotations.groups.filter((g) => g.id !== action.payload),
        },
        hasUnsavedAnnotations: true,
      };
    }

    case 'LOAD_ANNOTATIONS':
      return {
        ...state,
        annotations: action.payload,
        hasUnsavedAnnotations: false,
      };

    case 'CLEAR_ANNOTATIONS':
      return {
        ...state,
        annotations: createEmptyAnnotationState(),
        hasUnsavedAnnotations: false,
      };

    default:
      return state;
  }
}

interface PlanContextValue {
  // Backward-compatible derived values from active plan
  rawInput: string;
  parsedPlan: ParsedPlan | null;
  selectedNodeId: number | null;
  selectedNodeIds: number[];
  error: string | null;

  // Global state
  viewMode: ViewMode;
  sankeyMetric: SankeyMetric;
  nodeIndicatorMetric: NodeIndicatorMetric;
  colorScheme: ColorScheme;
  theme: Theme;
  filters: FilterState;
  legendVisible: boolean;
  inputPanelCollapsed: boolean;
  filterPanelCollapsed: boolean;
  detailPanelCollapsed: boolean;
  treeCompareEnabled: boolean;
  visualizationMaximized: boolean;

  // Multi-plan state
  plans: PlanSlot[];
  activePlanIndex: number;
  comparePlanIndices: [number, number];
  hasMultiplePlans: boolean;
  compareMetrics: CompareMetric[];

  // Actions
  setInput: (input: string) => void;
  parsePlan: () => void;
  loadAndParsePlan: (input: string) => void;
  selectNode: (id: number | null, options?: { additive?: boolean }) => void;
  selectNodeForPlan: (index: number, id: number | null, options?: { additive?: boolean }) => void;
  setViewMode: (mode: ViewMode) => void;
  setTreeCompareEnabled: (enabled: boolean) => void;
  setSankeyMetric: (metric: SankeyMetric) => void;
  setNodeIndicatorMetric: (metric: NodeIndicatorMetric) => void;
  setColorScheme: (scheme: ColorScheme) => void;
  setTheme: (theme: Theme) => void;
  setFilters: (filters: Partial<FilterState>) => void;
  clearPlan: () => void;
  getSelectedNode: () => PlanNode | null;
  getFilteredNodes: () => PlanNode[];
  selectedNode: PlanNode | null;
  selectedNodes: PlanNode[];
  filteredNodes: PlanNode[];
  filteredNodeIds: Set<number>;
  nodeById: Map<number, PlanNode>;
  hottestNodeId: number | null;
  hotspotsEnabled: boolean;
  setHotspotsEnabled: (enabled: boolean) => void;
  setLegendVisible: (visible: boolean) => void;
  setInputPanelCollapsed: (collapsed: boolean) => void;
  setFilterPanelCollapsed: (collapsed: boolean) => void;
  setDetailPanelCollapsed: (collapsed: boolean) => void;
  setVisualizationMaximized: (maximized: boolean) => void;

  // Annotations
  annotations: AnnotationState;
  hasUnsavedAnnotations: boolean;

  // Multi-plan actions
  removePlanSlot: (index: number) => void;
  renamePlanSlot: (index: number, customLabel: string) => void;
  setActivePlan: (index: number) => void;
  setComparePlanIndices: (indices: [number, number]) => void;
  swapComparePlans: () => void;
  setCompareMetrics: (metrics: CompareMetric[]) => void;

  // Annotation methods
  setNodeAnnotation: (nodeId: number, text: string) => void;
  removeNodeAnnotation: (nodeId: number) => void;
  setNodeHighlight: (nodeId: number, color: HighlightColor) => void;
  removeNodeHighlight: (nodeId: number) => void;
  addAnnotationGroup: (group: Omit<AnnotationGroup, 'id'>) => void;
  updateAnnotationGroup: (group: AnnotationGroup) => void;
  removeAnnotationGroup: (id: string) => void;
  exportAnnotatedPlan: () => void;
  importAnnotatedPlan: (file: File) => Promise<void>;
  clearAnnotations: () => void;

  // Share URL
  sharePlan: () => Promise<{ ok: true; url: string } | { ok: false; error: string }>;

  // Export PNG — HierarchicalView registers a capture function, Header calls it
  exportPngFnRef: React.MutableRefObject<(() => Promise<void>) | null>;
}

const PlanContext = createContext<PlanContextValue | null>(null);

export function PlanProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(planReducer, undefined, getInitialState);
  const saveTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const exportPngFnRef = useRef<(() => Promise<void>) | null>(null);

  const createPlanSlotFromInput = useCallback((input: string, index: number): PlanSlot => {
    const slot = createEmptySlot(index);

    try {
      const parsed = parseExplainPlan(input);
      return {
        ...slot,
        rawInput: input,
        parsedPlan: parsed.rootNode ? parsed : null,
        error: parsed.rootNode ? null : 'Could not parse the execution plan. Please check the format.',
      };
    } catch (err) {
      return {
        ...slot,
        rawInput: input,
        error: `Parse error: ${err instanceof Error ? err.message : 'Unknown error'}`,
      };
    }
  }, []);

  const buildPlanSlotsFromInputs = useCallback((inputs: string[]): PlanSlot[] => {
    const meaningfulInputs = inputs
      .map((input) => input.trim())
      .filter(Boolean);

    if (meaningfulInputs.length === 0) {
      return [createEmptySlot(0)];
    }

    return meaningfulInputs.map((input, index) => createPlanSlotFromInput(input, index));
  }, [createPlanSlotFromInput]);

  const importPlanInput = useCallback((input: string, options?: { replaceAll?: boolean }) => {
    const splitInputs = splitDbmsXplanPlanBatches(input).filter((batch) => batch.trim());
    const shouldReplaceAll = options?.replaceAll ?? splitInputs.length > 1;
    const slots = buildPlanSlotsFromInputs(shouldReplaceAll ? splitInputs : [input]);
    const parsedPlanCount = slots.filter((slot) => slot.parsedPlan).length;

    if (shouldReplaceAll) {
      dispatch({ type: 'REPLACE_PLANS', payload: { plans: slots, activePlanIndex: 0 } });
      dispatch({ type: 'CLEAR_ANNOTATIONS' });
      dispatch({ type: 'SET_INPUT_PANEL_COLLAPSED', payload: parsedPlanCount > 0 });
      if (parsedPlanCount === 0) {
        dispatch({
          type: 'SET_ERROR',
          payload: 'Could not parse any execution plans from the input. Please check the format.',
        });
      }
      return;
    }

    const [slot] = slots;
    dispatch({ type: 'SET_INPUT', payload: input });

    if (!slot?.parsedPlan) {
      dispatch({
        type: 'SET_ERROR',
        payload: slot?.error ?? 'Could not parse the execution plan. Please check the format.',
      });
      return;
    }

    dispatch({ type: 'SET_PARSED_PLAN', payload: slot.parsedPlan });
    dispatch({ type: 'SET_INPUT_PANEL_COLLAPSED', payload: true });
  }, [buildPlanSlotsFromInputs]);

  // Derive active slot values for backward compatibility
  const activeSlot = state.plans[state.activePlanIndex];
  const rawInput = activeSlot.rawInput;
  const parsedPlan = activeSlot.parsedPlan;
  const selectedNodeId = activeSlot.selectedNodeId;
  const selectedNodeIds = activeSlot.selectedNodeIds;
  const error = activeSlot.error;

  const hasMultiplePlans = state.plans.length > 1;

  const nodeById = useMemo(() => {
    if (!parsedPlan) return new Map<number, PlanNode>();
    return new Map(parsedPlan.allNodes.map((node) => [node.id, node]));
  }, [parsedPlan]);

  const filteredNodes = useMemo((): PlanNode[] => {
    if (!parsedPlan) return [];
    const hasActualStats = parsedPlan.hasActualStats ?? false;
    return parsedPlan.allNodes.filter((node) => matchesFilters(node, state.filters, hasActualStats));
  }, [parsedPlan, state.filters]);

  const filteredNodeIds = useMemo(() => {
    return new Set(filteredNodes.map((node) => node.id));
  }, [filteredNodes]);

  const selectedNode = useMemo((): PlanNode | null => {
    if (!parsedPlan || selectedNodeId === null) return null;
    return nodeById.get(selectedNodeId) || null;
  }, [parsedPlan, selectedNodeId, nodeById]);

  const selectedNodes = useMemo((): PlanNode[] => {
    if (!parsedPlan || selectedNodeIds.length === 0) return [];
    return selectedNodeIds
      .map((id) => nodeById.get(id))
      .filter((node): node is PlanNode => Boolean(node));
  }, [parsedPlan, selectedNodeIds, nodeById]);

  // Hottest node: the non-root node with the highest A-Time
  const hottestNodeId = useMemo((): number | null => {
    if (!state.hotspotsEnabled) return null;
    if (!parsedPlan?.hasActualStats) return null;
    let maxTime = 0;
    let hotId: number | null = null;
    for (const node of parsedPlan.allNodes) {
      // Skip root SELECT/UPDATE/etc. statements — they always have the total time
      if (node.parentId === undefined) continue;
      if (node.actualTime !== undefined && node.actualTime > maxTime) {
        maxTime = node.actualTime;
        hotId = node.id;
      }
    }
    return hotId;
  }, [parsedPlan, state.hotspotsEnabled]);

  // Apply theme to document
  useEffect(() => {
    const root = document.documentElement;
    if (state.theme === 'dark') {
      root.classList.add('dark');
    } else {
      root.classList.remove('dark');
    }
    localStorage.setItem('theme', state.theme);
  }, [state.theme]);

  // Load plan from URL param or default example on first mount
  const hasLoadedDefaultRef = useRef(false);
  useEffect(() => {
    if (hasLoadedDefaultRef.current) return;
    hasLoadedDefaultRef.current = true;

    // Check URL for shared plan first
    const urlData = getPlanFromUrl();
    if (urlData) {
      clearPlanFromUrl();

      if (urlData.type === 'legacy') {
        importPlanInput(urlData.planText);
      } else {
        const { plans, annotations } = urlData.payload;
        const restoredPlans = buildPlanSlotsFromInputs(plans.map((plan) => plan.rawInput));
        dispatch({ type: 'REPLACE_PLANS', payload: { plans: restoredPlans, activePlanIndex: 0 } });
        dispatch({
          type: 'SET_INPUT_PANEL_COLLAPSED',
          payload: restoredPlans.some((slot) => slot.parsedPlan),
        });

        // Restore annotations (if present)
        if (annotations) {
          try {
            const annotationState = deserializeAnnotations(annotations);
            dispatch({ type: 'LOAD_ANNOTATIONS', payload: annotationState });
          } catch {
            // Annotations from URL failed to deserialize
          }
        }
      }
      return;
    }
  }, [buildPlanSlotsFromInputs, importPlanInput]);

  // Persist settings when they change (debounced)
  useEffect(() => {
    if (saveTimeoutRef.current) {
      clearTimeout(saveTimeoutRef.current);
    }
    saveTimeoutRef.current = setTimeout(() => {
      saveSettings({
        viewMode: state.viewMode === 'compare' ? 'hierarchical' : state.viewMode,
        sankeyMetric: state.sankeyMetric,
        nodeIndicatorMetric: state.nodeIndicatorMetric,
        colorScheme: state.colorScheme,
        hotspotsEnabled: state.hotspotsEnabled,
        legendVisible: state.legendVisible,
        inputPanelCollapsed: state.inputPanelCollapsed,
        filterPanelCollapsed: state.filterPanelCollapsed,
        compareMetrics: state.compareMetrics,
        ...extractFilterSettings(state.filters),
      });
    }, 300);

    return () => {
      if (saveTimeoutRef.current) {
        clearTimeout(saveTimeoutRef.current);
      }
    };
  }, [
    state.viewMode,
    state.sankeyMetric,
    state.nodeIndicatorMetric,
    state.colorScheme,
    state.hotspotsEnabled,
    state.legendVisible,
    state.inputPanelCollapsed,
    state.filterPanelCollapsed,
    state.compareMetrics,
    state.filters,
  ]);

  const setInput = useCallback((input: string) => {
    dispatch({ type: 'SET_INPUT', payload: input });
  }, []);

  const parsePlan = useCallback(() => {
    importPlanInput(rawInput);
  }, [importPlanInput, rawInput]);

  const loadAndParsePlan = useCallback((input: string) => {
    importPlanInput(input);
  }, [importPlanInput]);

  const selectNode = useCallback((id: number | null, options?: { additive?: boolean }) => {
    dispatch({ type: 'SELECT_NODE', payload: { id, additive: options?.additive } });
  }, []);

  const selectNodeForPlan = useCallback((index: number, id: number | null, options?: { additive?: boolean }) => {
    dispatch({ type: 'SELECT_NODE_FOR_PLAN', payload: { index, id, additive: options?.additive } });
  }, []);

  const setViewMode = useCallback((mode: ViewMode) => {
    dispatch({ type: 'SET_VIEW_MODE', payload: mode });
  }, []);

  const setTreeCompareEnabled = useCallback((enabled: boolean) => {
    dispatch({ type: 'SET_TREE_COMPARE_ENABLED', payload: enabled });
  }, []);

  const setSankeyMetric = useCallback((metric: SankeyMetric) => {
    dispatch({ type: 'SET_SANKEY_METRIC', payload: metric });
  }, []);

  const setNodeIndicatorMetric = useCallback((metric: NodeIndicatorMetric) => {
    dispatch({ type: 'SET_NODE_INDICATOR_METRIC', payload: metric });
  }, []);

  const setColorScheme = useCallback((scheme: ColorScheme) => {
    dispatch({ type: 'SET_COLOR_SCHEME', payload: scheme });
  }, []);

  const setTheme = useCallback((theme: Theme) => {
    dispatch({ type: 'SET_THEME', payload: theme });
  }, []);

  const setFilters = useCallback((filters: Partial<FilterState>) => {
    dispatch({ type: 'SET_FILTERS', payload: filters });
  }, []);

  const clearPlan = useCallback(() => {
    dispatch({ type: 'CLEAR_PLAN' });
  }, []);

  const setHotspotsEnabled = useCallback((enabled: boolean) => {
    dispatch({ type: 'SET_HOTSPOTS_ENABLED', payload: enabled });
  }, []);

  const setLegendVisible = useCallback((visible: boolean) => {
    dispatch({ type: 'SET_LEGEND_VISIBLE', payload: visible });
  }, []);

  const setInputPanelCollapsed = useCallback((collapsed: boolean) => {
    dispatch({ type: 'SET_INPUT_PANEL_COLLAPSED', payload: collapsed });
  }, []);

  const setFilterPanelCollapsed = useCallback((collapsed: boolean) => {
    dispatch({ type: 'SET_FILTER_PANEL_COLLAPSED', payload: collapsed });
  }, []);

  const setDetailPanelCollapsed = useCallback((collapsed: boolean) => {
    dispatch({ type: 'SET_DETAIL_PANEL_COLLAPSED', payload: collapsed });
  }, []);

  const setVisualizationMaximized = useCallback((maximized: boolean) => {
    dispatch({ type: 'SET_VISUALIZATION_MAXIMIZED', payload: maximized });
  }, []);

  const removePlanSlot = useCallback((index: number) => {
    dispatch({ type: 'REMOVE_PLAN_SLOT', payload: index });
  }, []);

  const renamePlanSlot = useCallback((index: number, customLabel: string) => {
    dispatch({ type: 'RENAME_PLAN_SLOT', payload: { index, customLabel } });
  }, []);

  const setActivePlan = useCallback((index: number) => {
    dispatch({ type: 'SET_ACTIVE_PLAN', payload: index });
  }, []);

  const setComparePlanIndices = useCallback((indices: [number, number]) => {
    dispatch({ type: 'SET_COMPARE_PLAN_INDICES', payload: indices });
  }, []);

  const swapComparePlans = useCallback(() => {
    dispatch({ type: 'SWAP_COMPARE_PLAN_INDICES' });
  }, []);

  const setCompareMetrics = useCallback((metrics: CompareMetric[]) => {
    dispatch({ type: 'SET_COMPARE_METRICS', payload: metrics });
  }, []);

  const setNodeAnnotation = useCallback((nodeId: number, text: string) => {
    dispatch({ type: 'SET_NODE_ANNOTATION', payload: { nodeId, text } });
  }, []);

  const removeNodeAnnotation = useCallback((nodeId: number) => {
    dispatch({ type: 'REMOVE_NODE_ANNOTATION', payload: nodeId });
  }, []);

  const setNodeHighlight = useCallback((nodeId: number, color: HighlightColor) => {
    dispatch({ type: 'SET_NODE_HIGHLIGHT', payload: { nodeId, color } });
  }, []);

  const removeNodeHighlight = useCallback((nodeId: number) => {
    dispatch({ type: 'REMOVE_NODE_HIGHLIGHT', payload: nodeId });
  }, []);

  const addAnnotationGroup = useCallback((group: Omit<AnnotationGroup, 'id'>) => {
    dispatch({ type: 'ADD_ANNOTATION_GROUP', payload: group });
  }, []);

  const updateAnnotationGroup = useCallback((group: AnnotationGroup) => {
    dispatch({ type: 'UPDATE_ANNOTATION_GROUP', payload: group });
  }, []);

  const removeAnnotationGroup = useCallback((id: string) => {
    dispatch({ type: 'REMOVE_ANNOTATION_GROUP', payload: id });
  }, []);

  const clearAnnotations = useCallback(() => {
    dispatch({ type: 'CLEAR_ANNOTATIONS' });
  }, []);

  const exportAnnotatedPlan = useCallback(() => {
    if (!parsedPlan) return;
    const exportData: AnnotatedPlanExport = {
      version: 1,
      exportedAt: new Date().toISOString(),
      rawPlanText: rawInput,
      planSource: parsedPlan.source,
      planHashValue: parsedPlan.planHashValue,
      sqlId: parsedPlan.sqlId,
      annotations: serializeAnnotations(state.annotations),
    };
    downloadAnnotatedPlan(exportData);
  }, [parsedPlan, rawInput, state.annotations]);

  const importAnnotatedPlan = useCallback(async (file: File) => {
    try {
      const text = await file.text();
      const data = JSON.parse(text);
      if (!validateExport(data)) {
        dispatch({ type: 'SET_ERROR', payload: 'Invalid annotated plan file. Please check the format.' });
        return;
      }
      // Parse the plan text from the file
      dispatch({ type: 'SET_INPUT', payload: data.rawPlanText });
      const parsed = parseExplainPlan(data.rawPlanText);
      if (!parsed.rootNode) {
        dispatch({ type: 'SET_ERROR', payload: 'Could not parse the plan from the file.' });
        return;
      }
      dispatch({ type: 'SET_PARSED_PLAN', payload: parsed });
      // Load annotations after plan is set (SET_PARSED_PLAN clears them first)
      const annotations = deserializeAnnotations(data.annotations);
      dispatch({ type: 'LOAD_ANNOTATIONS', payload: annotations });
    } catch (err) {
      dispatch({
        type: 'SET_ERROR',
        payload: `Import error: ${err instanceof Error ? err.message : 'Unknown error'}`,
      });
    }
  }, []);

  const sharePlan = useCallback(async (): Promise<{ ok: true; url: string } | { ok: false; error: string }> => {
    // Need at least one plan with input
    const hasAnyInput = state.plans.some(slot => slot.rawInput);
    if (!hasAnyInput) {
      return { ok: false, error: 'No plan to share.' };
    }

    // Build payload with all plan slots that have input
    const payload: SharePayload = {
      plans: state.plans
        .filter(slot => slot.rawInput)
        .map(slot => ({ rawInput: slot.rawInput })),
    };

    // Include annotations if any exist
    if (hasAnnotations(state.annotations)) {
      payload.annotations = serializeAnnotations(state.annotations);
    }

    const result = buildShareUrl(payload);
    if (result.ok) {
      window.history.replaceState(null, '', result.url);
      try {
        await navigator.clipboard.writeText(result.url);
      } catch {
        // Clipboard write may fail in some contexts — URL is still in address bar
      }
    }
    return result;
  }, [state.plans, state.annotations]);

  const getSelectedNode = useCallback((): PlanNode | null => selectedNode, [selectedNode]);

  const getFilteredNodes = useCallback((): PlanNode[] => filteredNodes, [filteredNodes]);

  const value: PlanContextValue = {
    // Backward-compatible derived values
    rawInput,
    parsedPlan,
    selectedNodeId,
    selectedNodeIds,
    error,

    // Global state
    viewMode: state.viewMode,
    sankeyMetric: state.sankeyMetric,
    nodeIndicatorMetric: state.nodeIndicatorMetric,
    colorScheme: state.colorScheme,
    theme: state.theme,
    filters: state.filters,
    legendVisible: state.legendVisible,
    inputPanelCollapsed: state.inputPanelCollapsed,
    filterPanelCollapsed: state.filterPanelCollapsed,
    detailPanelCollapsed: state.detailPanelCollapsed,
    treeCompareEnabled: state.treeCompareEnabled,
    visualizationMaximized: state.visualizationMaximized,

    // Multi-plan state
    plans: state.plans,
    activePlanIndex: state.activePlanIndex,
    comparePlanIndices: state.comparePlanIndices,
    hasMultiplePlans,
    compareMetrics: state.compareMetrics,

    // Actions
    setInput,
    parsePlan,
    loadAndParsePlan,
    selectNode,
    selectNodeForPlan,
    setViewMode,
    setTreeCompareEnabled,
    setSankeyMetric,
    setNodeIndicatorMetric,
    setColorScheme,
    setTheme,
    setFilters,
    clearPlan,
    getSelectedNode,
    getFilteredNodes,
    selectedNode,
    selectedNodes,
    filteredNodes,
    filteredNodeIds,
    nodeById,
    hottestNodeId,
    hotspotsEnabled: state.hotspotsEnabled,
    setHotspotsEnabled,
    setLegendVisible,
    setInputPanelCollapsed,
    setFilterPanelCollapsed,
    setDetailPanelCollapsed,
    setVisualizationMaximized,

    // Annotations
    annotations: state.annotations,
    hasUnsavedAnnotations: state.hasUnsavedAnnotations,

    // Multi-plan actions
    removePlanSlot,
    renamePlanSlot,
    setActivePlan,
    setComparePlanIndices,
    swapComparePlans,
    setCompareMetrics,

    // Annotation methods
    setNodeAnnotation,
    removeNodeAnnotation,
    setNodeHighlight,
    removeNodeHighlight,
    addAnnotationGroup,
    updateAnnotationGroup,
    removeAnnotationGroup,
    exportAnnotatedPlan,
    importAnnotatedPlan,
    clearAnnotations,

    // Share URL
    sharePlan,

    // Export PNG
    exportPngFnRef,
  };

  return <PlanContext.Provider value={value}>{children}</PlanContext.Provider>;
}

export function usePlan() {
  const context = useContext(PlanContext);
  if (!context) {
    throw new Error('usePlan must be used within a PlanProvider');
  }
  return context;
}
