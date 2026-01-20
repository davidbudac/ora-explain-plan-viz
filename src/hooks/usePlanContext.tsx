import { createContext, useContext, useReducer, useCallback, useEffect } from 'react';
import type { ReactNode } from 'react';
import type { ParsedPlan, PlanNode, FilterState, ViewMode, SankeyMetric, Theme, PredicateType } from '../lib/types';
import { parseExplainPlan } from '../lib/parser';

interface PlanState {
  rawInput: string;
  parsedPlan: ParsedPlan | null;
  selectedNodeId: number | null;
  viewMode: ViewMode;
  sankeyMetric: SankeyMetric;
  theme: Theme;
  filters: FilterState;
  error: string | null;
}

type PlanAction =
  | { type: 'SET_INPUT'; payload: string }
  | { type: 'SET_PARSED_PLAN'; payload: ParsedPlan }
  | { type: 'SELECT_NODE'; payload: number | null }
  | { type: 'SET_VIEW_MODE'; payload: ViewMode }
  | { type: 'SET_SANKEY_METRIC'; payload: SankeyMetric }
  | { type: 'SET_THEME'; payload: Theme }
  | { type: 'SET_FILTERS'; payload: Partial<FilterState> }
  | { type: 'SET_ERROR'; payload: string | null }
  | { type: 'CLEAR_PLAN' };

const initialFilters: FilterState = {
  operationTypes: [],
  minCost: 0,
  maxCost: Infinity,
  searchText: '',
  showPredicates: true,
  predicateTypes: [],
  animateEdges: false,
};

const getInitialTheme = (): Theme => {
  if (typeof window === 'undefined') return 'light';
  const stored = localStorage.getItem('theme');
  if (stored === 'dark' || stored === 'light') return stored;
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
};

const initialState: PlanState = {
  rawInput: '',
  parsedPlan: null,
  selectedNodeId: null,
  viewMode: 'hierarchical',
  sankeyMetric: 'rows',
  theme: 'light',
  filters: initialFilters,
  error: null,
};

function planReducer(state: PlanState, action: PlanAction): PlanState {
  switch (action.type) {
    case 'SET_INPUT':
      return { ...state, rawInput: action.payload, error: null };

    case 'SET_PARSED_PLAN':
      return {
        ...state,
        parsedPlan: action.payload,
        error: null,
        selectedNodeId: null,
      };

    case 'SELECT_NODE':
      return { ...state, selectedNodeId: action.payload };

    case 'SET_VIEW_MODE':
      return { ...state, viewMode: action.payload };

    case 'SET_SANKEY_METRIC':
      return { ...state, sankeyMetric: action.payload };

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
        error: null,
        filters: initialFilters,
      };

    default:
      return state;
  }
}

interface PlanContextValue extends PlanState {
  setInput: (input: string) => void;
  parsePlan: () => void;
  selectNode: (id: number | null) => void;
  setViewMode: (mode: ViewMode) => void;
  setSankeyMetric: (metric: SankeyMetric) => void;
  setTheme: (theme: Theme) => void;
  setFilters: (filters: Partial<FilterState>) => void;
  clearPlan: () => void;
  getSelectedNode: () => PlanNode | null;
  getFilteredNodes: () => PlanNode[];
}

const PlanContext = createContext<PlanContextValue | null>(null);

export function PlanProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(planReducer, {
    ...initialState,
    theme: getInitialTheme(),
  });

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

  const selectNode = useCallback((id: number | null) => {
    dispatch({ type: 'SELECT_NODE', payload: id });
  }, []);

  const setViewMode = useCallback((mode: ViewMode) => {
    dispatch({ type: 'SET_VIEW_MODE', payload: mode });
  }, []);

  const setSankeyMetric = useCallback((metric: SankeyMetric) => {
    dispatch({ type: 'SET_SANKEY_METRIC', payload: metric });
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

  const getSelectedNode = useCallback((): PlanNode | null => {
    if (!state.parsedPlan || state.selectedNodeId === null) return null;
    return (
      state.parsedPlan.allNodes.find((n) => n.id === state.selectedNodeId) || null
    );
  }, [state.parsedPlan, state.selectedNodeId]);

  const getFilteredNodes = useCallback((): PlanNode[] => {
    if (!state.parsedPlan) return [];

    return state.parsedPlan.allNodes.filter((node) => {
      const { operationTypes, minCost, maxCost, searchText, predicateTypes } = state.filters;

      // Filter by operation type
      if (operationTypes.length > 0) {
        const matches = operationTypes.some((type) =>
          node.operation.toUpperCase().includes(type.toUpperCase())
        );
        if (!matches) return false;
      }

      // Filter by cost
      const nodeCost = node.cost || 0;
      if (nodeCost < minCost || nodeCost > maxCost) return false;

      // Filter by predicate type
      if (predicateTypes.length > 0) {
        const hasAccess = !!node.accessPredicates;
        const hasFilter = !!node.filterPredicates;
        const hasNone = !hasAccess && !hasFilter;

        const matchesPredicate = predicateTypes.some((type: PredicateType) => {
          if (type === 'access') return hasAccess;
          if (type === 'filter') return hasFilter;
          if (type === 'none') return hasNone;
          return false;
        });
        if (!matchesPredicate) return false;
      }

      // Filter by search text
      if (searchText) {
        const searchLower = searchText.toLowerCase();
        const matchesOperation = node.operation.toLowerCase().includes(searchLower);
        const matchesObject = node.objectName?.toLowerCase().includes(searchLower);
        const matchesPredicates =
          node.accessPredicates?.toLowerCase().includes(searchLower) ||
          node.filterPredicates?.toLowerCase().includes(searchLower);
        if (!matchesOperation && !matchesObject && !matchesPredicates) {
          return false;
        }
      }

      return true;
    });
  }, [state.parsedPlan, state.filters]);

  const value: PlanContextValue = {
    ...state,
    setInput,
    parsePlan,
    selectNode,
    setViewMode,
    setSankeyMetric,
    setTheme,
    setFilters,
    clearPlan,
    getSelectedNode,
    getFilteredNodes,
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
