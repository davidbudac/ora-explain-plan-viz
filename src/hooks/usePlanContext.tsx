import { createContext, useContext, useReducer, useCallback, useEffect, useMemo, useRef } from 'react';
import type { ReactNode } from 'react';
import type { ParsedPlan, PlanNode, FilterState, ViewMode, SankeyMetric, NodeIndicatorMetric, Theme, ColorScheme } from '../lib/types';
import type { PlanSlot, CompareMetric } from '../lib/compare';
import { createEmptySlot, DEFAULT_COMPARE_METRICS } from '../lib/compare';
import { parseExplainPlan } from '../lib/parser';
import { loadSettings, saveSettings, extractFilterSettings, applySettingsToFilters } from '../lib/settings';
import { SAMPLE_PLANS } from '../examples';
import { matchesFilters } from '../lib/filtering';
import type { AnnotationState, AnnotationGroup, HighlightColor, AnnotatedPlanExport } from '../lib/annotations';
import { createEmptyAnnotationState, serializeAnnotations, deserializeAnnotations, validateExport, downloadAnnotatedPlan, generateGroupId } from '../lib/annotations';

interface PlanState {
  plans: PlanSlot[];
  activePlanIndex: number;
  compareMetrics: CompareMetric[];
  viewMode: ViewMode;
  sankeyMetric: SankeyMetric;
  nodeIndicatorMetric: NodeIndicatorMetric;
  colorScheme: ColorScheme;
  theme: Theme;
  filters: FilterState;
  // UI panel states (persisted)
  legendVisible: boolean;
  inputPanelCollapsed: boolean;
  filterPanelCollapsed: boolean;
  // Annotations (overlay, not persisted to localStorage)
  annotations: AnnotationState;
  hasUnsavedAnnotations: boolean;
}

type PlanAction =
  | { type: 'SET_INPUT'; payload: string }
  | { type: 'SET_PARSED_PLAN'; payload: ParsedPlan }
  | { type: 'SELECT_NODE'; payload: { id: number | null; additive?: boolean } }
  | { type: 'SET_VIEW_MODE'; payload: ViewMode }
  | { type: 'SET_SANKEY_METRIC'; payload: SankeyMetric }
  | { type: 'SET_NODE_INDICATOR_METRIC'; payload: NodeIndicatorMetric }
  | { type: 'SET_COLOR_SCHEME'; payload: ColorScheme }
  | { type: 'SET_THEME'; payload: Theme }
  | { type: 'SET_FILTERS'; payload: Partial<FilterState> }
  | { type: 'SET_ERROR'; payload: string | null }
  | { type: 'CLEAR_PLAN' }
  | { type: 'SET_LEGEND_VISIBLE'; payload: boolean }
  | { type: 'SET_INPUT_PANEL_COLLAPSED'; payload: boolean }
  | { type: 'SET_FILTER_PANEL_COLLAPSED'; payload: boolean }
  | { type: 'ADD_PLAN_SLOT' }
  | { type: 'REMOVE_PLAN_SLOT'; payload: number }
  | { type: 'SET_ACTIVE_PLAN'; payload: number }
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

const getInitialState = (): PlanState => {
  const settings = loadSettings();
  return {
    plans: [createEmptySlot(0)],
    activePlanIndex: 0,
    compareMetrics: settings.compareMetrics ?? DEFAULT_COMPARE_METRICS,
    viewMode: settings.viewMode,
    sankeyMetric: settings.sankeyMetric,
    nodeIndicatorMetric: settings.nodeIndicatorMetric,
    colorScheme: settings.colorScheme ?? 'muted',
    theme: getInitialTheme(),
    filters: applySettingsToFilters(initialFilters, settings),
    legendVisible: settings.legendVisible,
    inputPanelCollapsed: settings.inputPanelCollapsed,
    filterPanelCollapsed: settings.filterPanelCollapsed,
    annotations: createEmptyAnnotationState(),
    hasUnsavedAnnotations: false,
  };
};

function updateActiveSlot(state: PlanState, updater: (slot: PlanSlot) => PlanSlot): PlanState {
  const plans = state.plans.map((slot, i) =>
    i === state.activePlanIndex ? updater(slot) : slot
  );
  return { ...state, plans };
}

function planReducer(state: PlanState, action: PlanAction): PlanState {
  switch (action.type) {
    case 'SET_INPUT':
      return updateActiveSlot(state, slot => ({ ...slot, rawInput: action.payload, error: null }));

    case 'SET_PARSED_PLAN': {
      const newMetric = !action.payload.hasActualStats && state.nodeIndicatorMetric !== 'cost'
        ? 'cost' as NodeIndicatorMetric
        : state.nodeIndicatorMetric;
      return {
        ...updateActiveSlot(state, slot => ({
          ...slot,
          parsedPlan: action.payload,
          error: null,
          selectedNodeId: null,
          selectedNodeIds: [],
        })),
        nodeIndicatorMetric: newMetric,
        annotations: createEmptyAnnotationState(),
        hasUnsavedAnnotations: false,
      };
    }

    case 'SELECT_NODE': {
      const { id, additive } = action.payload;
      return updateActiveSlot(state, slot => {
        if (id === null) {
          return { ...slot, selectedNodeId: null, selectedNodeIds: [] };
        }
        if (!additive) {
          return { ...slot, selectedNodeId: id, selectedNodeIds: [id] };
        }
        const isAlreadySelected = slot.selectedNodeIds.includes(id);
        if (isAlreadySelected) {
          const nextSelectedNodeIds = slot.selectedNodeIds.filter(nodeId => nodeId !== id);
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
      });
    }

    case 'SET_VIEW_MODE':
      return { ...state, viewMode: action.payload };

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
      return {
        ...updateActiveSlot(state, slot => ({
          ...slot,
          rawInput: '',
          parsedPlan: null,
          selectedNodeId: null,
          selectedNodeIds: [],
          error: null,
        })),
        filters: applySettingsToFilters(initialFilters, loadSettings()),
        annotations: createEmptyAnnotationState(),
        hasUnsavedAnnotations: false,
      };

    case 'SET_LEGEND_VISIBLE':
      return { ...state, legendVisible: action.payload };

    case 'SET_INPUT_PANEL_COLLAPSED':
      return { ...state, inputPanelCollapsed: action.payload };

    case 'SET_FILTER_PANEL_COLLAPSED':
      return { ...state, filterPanelCollapsed: action.payload };

    case 'ADD_PLAN_SLOT': {
      if (state.plans.length >= 2) return state;
      const newSlot = createEmptySlot(1);
      return {
        ...state,
        plans: [...state.plans, newSlot],
        activePlanIndex: 1,
        inputPanelCollapsed: false,
      };
    }

    case 'REMOVE_PLAN_SLOT': {
      const removeIndex = action.payload;
      if (state.plans.length <= 1) return state;
      const newPlans = state.plans.filter((_, i) => i !== removeIndex);
      // Re-label remaining slots
      const relabeled = newPlans.map((slot, i) => ({
        ...slot,
        id: `plan-${i}`,
        label: i === 0 ? 'Plan A' : 'Plan B',
      }));
      let newActiveIndex = state.activePlanIndex;
      if (removeIndex <= state.activePlanIndex) {
        newActiveIndex = Math.max(0, state.activePlanIndex - 1);
      }
      newActiveIndex = Math.min(newActiveIndex, relabeled.length - 1);
      return {
        ...state,
        plans: relabeled,
        activePlanIndex: newActiveIndex,
        // Exit compare view if going back to single plan
        viewMode: relabeled.length < 2 && state.viewMode === 'compare'
          ? 'hierarchical'
          : state.viewMode,
      };
    }

    case 'SET_ACTIVE_PLAN':
      return { ...state, activePlanIndex: Math.min(action.payload, state.plans.length - 1) };

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

  // Multi-plan state
  plans: PlanSlot[];
  activePlanIndex: number;
  canAddPlan: boolean;
  hasMultiplePlans: boolean;
  compareMetrics: CompareMetric[];

  // Actions
  setInput: (input: string) => void;
  parsePlan: () => void;
  loadAndParsePlan: (input: string) => void;
  selectNode: (id: number | null, options?: { additive?: boolean }) => void;
  setViewMode: (mode: ViewMode) => void;
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
  setLegendVisible: (visible: boolean) => void;
  setInputPanelCollapsed: (collapsed: boolean) => void;
  setFilterPanelCollapsed: (collapsed: boolean) => void;

  // Annotations
  annotations: AnnotationState;
  hasUnsavedAnnotations: boolean;

  // Multi-plan actions
  addPlanSlot: () => void;
  removePlanSlot: (index: number) => void;
  setActivePlan: (index: number) => void;
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
}

const PlanContext = createContext<PlanContextValue | null>(null);

export function PlanProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(planReducer, undefined, getInitialState);
  const saveTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Derive active slot values for backward compatibility
  const activeSlot = state.plans[state.activePlanIndex];
  const rawInput = activeSlot.rawInput;
  const parsedPlan = activeSlot.parsedPlan;
  const selectedNodeId = activeSlot.selectedNodeId;
  const selectedNodeIds = activeSlot.selectedNodeIds;
  const error = activeSlot.error;

  const canAddPlan = state.plans.length < 2;
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
  }, [parsedPlan]);

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

  // Load default example on first mount
  const hasLoadedDefaultRef = useRef(false);
  useEffect(() => {
    if (hasLoadedDefaultRef.current) return;
    hasLoadedDefaultRef.current = true;

    // Find the default example and load it
    const defaultExample = SAMPLE_PLANS.find((p) => p.name === 'SQL Monitor XML (Nested Loops)');
    if (defaultExample) {
      dispatch({ type: 'SET_INPUT', payload: defaultExample.data });
      try {
        const parsed = parseExplainPlan(defaultExample.data);
        if (parsed.rootNode) {
          dispatch({ type: 'SET_PARSED_PLAN', payload: parsed });
          dispatch({ type: 'SET_INPUT_PANEL_COLLAPSED', payload: true });
        }
      } catch {
        // Silently fail - user can load manually
      }
    }
  }, []);

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
    state.legendVisible,
    state.inputPanelCollapsed,
    state.filterPanelCollapsed,
    state.compareMetrics,
    state.filters.animateEdges,
    state.filters.focusSelection,
    state.filters.nodeDisplayOptions,
    state.filters.predicateTypes,
    state.filters.operationTypes,
  ]);

  const setInput = useCallback((input: string) => {
    dispatch({ type: 'SET_INPUT', payload: input });
  }, []);

  const parsePlan = useCallback(() => {
    try {
      const parsed = parseExplainPlan(rawInput);
      if (!parsed.rootNode) {
        dispatch({
          type: 'SET_ERROR',
          payload: 'Could not parse the execution plan. Please check the format.',
        });
        return;
      }
      dispatch({ type: 'SET_PARSED_PLAN', payload: parsed });
    } catch (err) {
      dispatch({
        type: 'SET_ERROR',
        payload: `Parse error: ${err instanceof Error ? err.message : 'Unknown error'}`,
      });
    }
  }, [rawInput]);

  const loadAndParsePlan = useCallback((input: string) => {
    dispatch({ type: 'SET_INPUT', payload: input });
    try {
      const parsed = parseExplainPlan(input);
      if (!parsed.rootNode) {
        dispatch({
          type: 'SET_ERROR',
          payload: 'Could not parse the execution plan. Please check the format.',
        });
        return;
      }
      dispatch({ type: 'SET_PARSED_PLAN', payload: parsed });
    } catch (err) {
      dispatch({
        type: 'SET_ERROR',
        payload: `Parse error: ${err instanceof Error ? err.message : 'Unknown error'}`,
      });
    }
  }, []);

  const selectNode = useCallback((id: number | null, options?: { additive?: boolean }) => {
    dispatch({ type: 'SELECT_NODE', payload: { id, additive: options?.additive } });
  }, []);

  const setViewMode = useCallback((mode: ViewMode) => {
    dispatch({ type: 'SET_VIEW_MODE', payload: mode });
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

  const setLegendVisible = useCallback((visible: boolean) => {
    dispatch({ type: 'SET_LEGEND_VISIBLE', payload: visible });
  }, []);

  const setInputPanelCollapsed = useCallback((collapsed: boolean) => {
    dispatch({ type: 'SET_INPUT_PANEL_COLLAPSED', payload: collapsed });
  }, []);

  const setFilterPanelCollapsed = useCallback((collapsed: boolean) => {
    dispatch({ type: 'SET_FILTER_PANEL_COLLAPSED', payload: collapsed });
  }, []);

  const addPlanSlot = useCallback(() => {
    dispatch({ type: 'ADD_PLAN_SLOT' });
  }, []);

  const removePlanSlot = useCallback((index: number) => {
    dispatch({ type: 'REMOVE_PLAN_SLOT', payload: index });
  }, []);

  const setActivePlan = useCallback((index: number) => {
    dispatch({ type: 'SET_ACTIVE_PLAN', payload: index });
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

    // Multi-plan state
    plans: state.plans,
    activePlanIndex: state.activePlanIndex,
    canAddPlan,
    hasMultiplePlans,
    compareMetrics: state.compareMetrics,

    // Actions
    setInput,
    parsePlan,
    loadAndParsePlan,
    selectNode,
    setViewMode,
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
    setLegendVisible,
    setInputPanelCollapsed,
    setFilterPanelCollapsed,

    // Annotations
    annotations: state.annotations,
    hasUnsavedAnnotations: state.hasUnsavedAnnotations,

    // Multi-plan actions
    addPlanSlot,
    removePlanSlot,
    setActivePlan,
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
