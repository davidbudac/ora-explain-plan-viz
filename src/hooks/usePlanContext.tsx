import { createContext, useContext, useReducer, useCallback, useEffect, useMemo, useRef } from 'react';
import type { ReactNode } from 'react';
import type { ParsedPlan, PlanNode, FilterState, ViewMode, SankeyMetric, NodeIndicatorMetric, Theme, ColorScheme } from '../lib/types';
import { parseExplainPlan } from '../lib/parser';
import { loadSettings, saveSettings, extractFilterSettings, applySettingsToFilters } from '../lib/settings';
import { SAMPLE_PLANS } from '../examples';
import { matchesFilters } from '../lib/filtering';

interface PlanState {
  rawInput: string;
  parsedPlan: ParsedPlan | null;
  selectedNodeId: number | null;
  selectedNodeIds: number[];
  viewMode: ViewMode;
  sankeyMetric: SankeyMetric;
  nodeIndicatorMetric: NodeIndicatorMetric;
  colorScheme: ColorScheme;
  theme: Theme;
  filters: FilterState;
  error: string | null;
  // UI panel states (persisted)
  legendVisible: boolean;
  inputPanelCollapsed: boolean;
  filterPanelCollapsed: boolean;
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
  | { type: 'SET_FILTER_PANEL_COLLAPSED'; payload: boolean };

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
  },
  // SQL Monitor actual statistics filters
  minActualRows: 0,
  maxActualRows: Infinity,
  minActualTime: 0,
  maxActualTime: Infinity,
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
    rawInput: '',
    parsedPlan: null,
    selectedNodeId: null,
    selectedNodeIds: [],
    viewMode: settings.viewMode,
    sankeyMetric: settings.sankeyMetric,
    nodeIndicatorMetric: settings.nodeIndicatorMetric,
    colorScheme: settings.colorScheme ?? 'muted',
    theme: getInitialTheme(),
    filters: applySettingsToFilters(initialFilters, settings),
    error: null,
    legendVisible: settings.legendVisible,
    inputPanelCollapsed: settings.inputPanelCollapsed,
    filterPanelCollapsed: settings.filterPanelCollapsed,
  };
};

function planReducer(state: PlanState, action: PlanAction): PlanState {
  switch (action.type) {
    case 'SET_INPUT':
      return { ...state, rawInput: action.payload, error: null };

    case 'SET_PARSED_PLAN': {
      const newMetric = !action.payload.hasActualStats && state.nodeIndicatorMetric !== 'cost'
        ? 'cost' as NodeIndicatorMetric
        : state.nodeIndicatorMetric;
      return {
        ...state,
        parsedPlan: action.payload,
        error: null,
        selectedNodeId: null,
        selectedNodeIds: [],
        nodeIndicatorMetric: newMetric,
      };
    }

    case 'SELECT_NODE': {
      const { id, additive } = action.payload;

      if (id === null) {
        return { ...state, selectedNodeId: null, selectedNodeIds: [] };
      }

      if (!additive) {
        return { ...state, selectedNodeId: id, selectedNodeIds: [id] };
      }

      const isAlreadySelected = state.selectedNodeIds.includes(id);
      if (isAlreadySelected) {
        const nextSelectedNodeIds = state.selectedNodeIds.filter((nodeId) => nodeId !== id);
        const nextPrimaryId =
          nextSelectedNodeIds.length > 0 ? nextSelectedNodeIds[nextSelectedNodeIds.length - 1] : null;
        return {
          ...state,
          selectedNodeId: state.selectedNodeId === id ? nextPrimaryId : state.selectedNodeId,
          selectedNodeIds: nextSelectedNodeIds,
        };
      }

      return {
        ...state,
        selectedNodeId: id,
        selectedNodeIds: [...state.selectedNodeIds, id],
      };
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
      return { ...state, error: action.payload };

    case 'CLEAR_PLAN':
      return {
        ...state,
        rawInput: '',
        parsedPlan: null,
        selectedNodeId: null,
        selectedNodeIds: [],
        error: null,
        filters: applySettingsToFilters(initialFilters, loadSettings()),
      };

    case 'SET_LEGEND_VISIBLE':
      return { ...state, legendVisible: action.payload };

    case 'SET_INPUT_PANEL_COLLAPSED':
      return { ...state, inputPanelCollapsed: action.payload };

    case 'SET_FILTER_PANEL_COLLAPSED':
      return { ...state, filterPanelCollapsed: action.payload };

    default:
      return state;
  }
}

interface PlanContextValue extends PlanState {
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
  setLegendVisible: (visible: boolean) => void;
  setInputPanelCollapsed: (collapsed: boolean) => void;
  setFilterPanelCollapsed: (collapsed: boolean) => void;
}

const PlanContext = createContext<PlanContextValue | null>(null);

export function PlanProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(planReducer, undefined, getInitialState);
  const saveTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const nodeById = useMemo(() => {
    if (!state.parsedPlan) return new Map<number, PlanNode>();
    return new Map(state.parsedPlan.allNodes.map((node) => [node.id, node]));
  }, [state.parsedPlan]);

  const filteredNodes = useMemo((): PlanNode[] => {
    if (!state.parsedPlan) return [];
    const hasActualStats = state.parsedPlan.hasActualStats ?? false;
    return state.parsedPlan.allNodes.filter((node) => matchesFilters(node, state.filters, hasActualStats));
  }, [state.parsedPlan, state.filters]);

  const filteredNodeIds = useMemo(() => {
    return new Set(filteredNodes.map((node) => node.id));
  }, [filteredNodes]);

  const selectedNode = useMemo((): PlanNode | null => {
    if (!state.parsedPlan || state.selectedNodeId === null) return null;
    return nodeById.get(state.selectedNodeId) || null;
  }, [state.parsedPlan, state.selectedNodeId, nodeById]);

  const selectedNodes = useMemo((): PlanNode[] => {
    if (!state.parsedPlan || state.selectedNodeIds.length === 0) return [];
    return state.selectedNodeIds
      .map((id) => nodeById.get(id))
      .filter((node): node is PlanNode => Boolean(node));
  }, [state.parsedPlan, state.selectedNodeIds, nodeById]);

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

    // Find the "SQL Monitor" example and load it
    const defaultExample = SAMPLE_PLANS.find((p) => p.name === 'SQL Monitor');
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
        viewMode: state.viewMode,
        sankeyMetric: state.sankeyMetric,
        nodeIndicatorMetric: state.nodeIndicatorMetric,
        colorScheme: state.colorScheme,
        legendVisible: state.legendVisible,
        inputPanelCollapsed: state.inputPanelCollapsed,
        filterPanelCollapsed: state.filterPanelCollapsed,
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
      const parsed = parseExplainPlan(state.rawInput);
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
  }, [state.rawInput]);

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

  const getSelectedNode = useCallback((): PlanNode | null => selectedNode, [selectedNode]);

  const getFilteredNodes = useCallback((): PlanNode[] => filteredNodes, [filteredNodes]);

  const value: PlanContextValue = {
    ...state,
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
    setLegendVisible,
    setInputPanelCollapsed,
    setFilterPanelCollapsed,
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
