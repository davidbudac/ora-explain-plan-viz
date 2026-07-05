/* eslint-disable react-refresh/only-export-components */
import { createContext, useContext, useReducer, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import type { ParsedPlan, PlanNode, FilterState, ViewMode, SankeyMetric, FlameMetric, NodeIndicatorMetric, Theme, ColorScheme } from '../lib/types';
import type { PlanSlot, CompareMetric } from '../lib/compare';
import { createEmptySlot, DEFAULT_COMPARE_METRICS, getPlanSlotLabel } from '../lib/compare';
import { parseExplainPlan, splitDbmsXplanPlanBatches } from '../lib/parser';
import { loadSettings, saveSettings, extractFilterSettings, applySettingsToFilters, defaultNodeDisplayOptions } from '../lib/settings';
import { matchesFilters } from '../lib/filtering';
import { computeHottestNodeId } from '../lib/analysis';
import { DENSITY_PRESETS, matchDensityPreset } from '../lib/density';
import type { DensityPreset, DensitySelection } from '../lib/density';
import { getPlanFromUrl, clearPlanFromUrl, buildShareUrl, stripUnusedXmlSections } from '../lib/url';
import type { SharePayload } from '../lib/url';
import type { AnnotationState, AnnotationGroup, HighlightColor, HighlightStyle, AnnotatedPlanExport } from '../lib/annotations';
import { createEmptyAnnotationState, hasAnnotations, serializeAnnotations, deserializeAnnotations, validateExport, downloadAnnotatedPlan, generateGroupId } from '../lib/annotations';
import type { MetadataBundle } from '../lib/metadata/bundle';
import { parseBundle, emptyBundleWarning } from '../lib/metadata/bundle';
import { SAMPLE_PLANS_WITH_ORDER } from '../examples';
import type { SamplePlan } from '../examples';
import { runAdvisor } from '../lib/advisor';
import type { AdvisorReport } from '../lib/advisor';

function combineWarnings(...warnings: Array<string | null>): string | null {
  const present = warnings.filter((w): w is string => Boolean(w));
  return present.length > 0 ? present.join(' ') : null;
}
import { pairBundleWithSlots } from '../lib/metadata/pairing';

export type LoadMetadataBundleResult =
  | { ok: true; pairedSlotIndex: number; warning: string | null }
  | { ok: 'needs-choice'; bundle: MetadataBundle; reason: string; candidateIndices: number[] }
  | { ok: false; error: string };

interface PlanState {
  plans: PlanSlot[];
  activePlanIndex: number;
  comparePlanIndices: [number, number];
  compareMetrics: CompareMetric[];
  viewMode: ViewMode;
  treeCompareEnabled: boolean;
  sankeyMetric: SankeyMetric;
  flameMetric: FlameMetric;
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
  // Highlight style
  highlightStyle: HighlightStyle;
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
  | { type: 'SET_FLAME_METRIC'; payload: FlameMetric }
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
  | { type: 'ADD_PLAN_SLOT' }
  | { type: 'REMOVE_PLAN_SLOT'; payload: number }
  | { type: 'RENAME_PLAN_SLOT'; payload: { index: number; customLabel: string } }
  | { type: 'SET_ACTIVE_PLAN'; payload: number }
  | { type: 'SET_COMPARE_PLAN_INDICES'; payload: [number, number] }
  | { type: 'SWAP_COMPARE_PLAN_INDICES' }
  | { type: 'SET_COMPARE_METRICS'; payload: CompareMetric[] }
  | { type: 'SET_HIGHLIGHT_STYLE'; payload: HighlightStyle }
  | { type: 'SET_NODE_ANNOTATION'; payload: { nodeId: number; text: string } }
  | { type: 'REMOVE_NODE_ANNOTATION'; payload: number }
  | { type: 'SET_NODE_HIGHLIGHT'; payload: { nodeId: number; color: HighlightColor } }
  | { type: 'REMOVE_NODE_HIGHLIGHT'; payload: number }
  | { type: 'ADD_ANNOTATION_GROUP'; payload: Omit<AnnotationGroup, 'id'> }
  | { type: 'UPDATE_ANNOTATION_GROUP'; payload: AnnotationGroup }
  | { type: 'REMOVE_ANNOTATION_GROUP'; payload: string }
  | { type: 'LOAD_ANNOTATIONS'; payload: AnnotationState }
  | { type: 'CLEAR_ANNOTATIONS' }
  | { type: 'ATTACH_METADATA_BUNDLE'; payload: { index: number; bundle: MetadataBundle; warning: string | null } }
  | { type: 'DETACH_METADATA_BUNDLE'; payload: number };

const initialFilters: FilterState = {
  operationTypes: [],
  minCost: 0,
  maxCost: Infinity,
  searchText: '',
  showPredicates: true,
  predicateTypes: [],
  animateEdges: false,
  scaleEdgeWidth: true,
  focusSelection: true,
  nodeDisplayOptions: defaultNodeDisplayOptions,
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

// Matches `?example=<name>` against the bundled sample plans.
// Accepts (case-insensitively): the display name, a URL-encoded display name,
// or the two-digit NN order prefix from the example's filename (e.g. "22").
function findSampleByUrlParam(rawValue: string): SamplePlan | null {
  let decoded: string;
  try {
    decoded = decodeURIComponent(rawValue);
  } catch {
    decoded = rawValue;
  }
  const normalized = decoded.trim().toLowerCase();
  if (!normalized) return null;

  // Try matching by exact (case-insensitive) display name first.
  const byName = SAMPLE_PLANS_WITH_ORDER.find((plan) => plan.name.trim().toLowerCase() === normalized);
  if (byName) return byName;

  // Fall back to matching by the two-digit NN order prefix, if numeric.
  if (/^\d+$/.test(normalized)) {
    const order = parseInt(normalized, 10);
    const byOrder = SAMPLE_PLANS_WITH_ORDER.find((plan) => plan.order === order);
    if (byOrder) return byOrder;
  }

  return null;
}

// `?view=` accepts a few friendly aliases in addition to the canonical ViewMode values.
// The `compare` view requires two loaded plans and is intentionally not supported here.
function parseViewModeFromUrlParam(rawValue: string): ViewMode | null {
  const normalized = rawValue.trim().toLowerCase();
  switch (normalized) {
    case 'hierarchical':
    case 'tree':
      return 'hierarchical';
    case 'sankey':
      return 'sankey';
    case 'flame':
    case 'icicle':
    case 'flamegraph':
      return 'flame';
    case 'text':
    case 'plantext':
    case 'plan-text':
    case 'plan_text':
      return 'text';
    case 'tabular':
    case 'table':
      return 'tabular';
    case 'sql':
      return 'sql';
    case 'monitor':
      return 'monitor';
    default:
      return null;
  }
}

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
    flameMetric: settings.flameMetric ?? 'actualTime',
    nodeIndicatorMetric: settings.nodeIndicatorMetric,
    colorScheme: settings.colorScheme ?? 'semantic',
    theme: getInitialTheme(),
    filters: applySettingsToFilters(initialFilters, settings),
    highlightStyle: settings.highlightStyle ?? 'circle',
    hotspotsEnabled: settings.hotspotsEnabled ?? true,
    legendVisible: settings.legendVisible,
    inputPanelCollapsed: initialPlans.some((slot) => slot.parsedPlan) ? settings.inputPanelCollapsed : false,
    filterPanelCollapsed: settings.filterPanelCollapsed,
    detailPanelCollapsed: false,
    visualizationMaximized: false,
    _preMaxPanelState: null,
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
      });
    }

    case 'SET_INPUT':
      return updateActiveSlot(state, slot => ({ ...slot, rawInput: action.payload, error: null }));

    case 'SET_PARSED_PLAN': {
      // Default the node indicator to A-Time (or A-Rows) when the plan carries
      // actual runtime stats, otherwise fall back to Cost.
      const hasActualTime = action.payload.allNodes.some((n) => n.actualTime !== undefined);
      const hasActualRows = action.payload.hasActualStats || action.payload.maxActualRows !== undefined;
      const newMetric: NodeIndicatorMetric = hasActualTime
        ? 'actualTime'
        : hasActualRows
          ? 'actualRows'
          : 'cost';
      const nextState = updateActiveSlot(state, slot => ({
        ...slot,
        parsedPlan: action.payload,
        error: null,
        selectedNodeId: null,
        selectedNodeIds: [],
        annotations: createEmptyAnnotationState(),
      }));
      const comparePlanIndices = normalizeComparePlanIndices(nextState.plans, state.comparePlanIndices);
      const parsedPlanCount = nextState.plans.filter((slot) => slot.parsedPlan).length;
      return {
        ...nextState,
        nodeIndicatorMetric: newMetric,
        comparePlanIndices,
        treeCompareEnabled: parsedPlanCount >= 2 && state.treeCompareEnabled,
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

    case 'SET_FLAME_METRIC':
      return { ...state, flameMetric: action.payload };

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
          annotations: createEmptyAnnotationState(),
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
        };
      }

    case 'SET_HIGHLIGHT_STYLE':
      return { ...state, highlightStyle: action.payload };

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

    case 'ADD_PLAN_SLOT': {
      const newIndex = state.plans.length;
      const newSlot = createEmptySlot(newIndex);
      return normalizePlanState({
        ...state,
        plans: [...state.plans, newSlot],
        activePlanIndex: newIndex,
        viewMode: state.viewMode === 'compare' ? 'hierarchical' : state.viewMode,
      });
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
      return updateActiveSlot(state, slot => {
        const newAnnotations = new Map(slot.annotations.nodeAnnotations);
        const now = new Date().toISOString();
        const existing = newAnnotations.get(nodeId);
        newAnnotations.set(nodeId, {
          nodeId,
          text,
          createdAt: existing?.createdAt || now,
          updatedAt: now,
        });
        return { ...slot, annotations: { ...slot.annotations, nodeAnnotations: newAnnotations } };
      });
    }

    case 'REMOVE_NODE_ANNOTATION': {
      return updateActiveSlot(state, slot => {
        const newAnnotations = new Map(slot.annotations.nodeAnnotations);
        newAnnotations.delete(action.payload);
        return { ...slot, annotations: { ...slot.annotations, nodeAnnotations: newAnnotations } };
      });
    }

    case 'SET_NODE_HIGHLIGHT': {
      const { nodeId, color } = action.payload;
      return updateActiveSlot(state, slot => {
        const newHighlights = new Map(slot.annotations.nodeHighlights);
        newHighlights.set(nodeId, { nodeId, color });
        return { ...slot, annotations: { ...slot.annotations, nodeHighlights: newHighlights } };
      });
    }

    case 'REMOVE_NODE_HIGHLIGHT': {
      return updateActiveSlot(state, slot => {
        const newHighlights = new Map(slot.annotations.nodeHighlights);
        newHighlights.delete(action.payload);
        return { ...slot, annotations: { ...slot.annotations, nodeHighlights: newHighlights } };
      });
    }

    case 'ADD_ANNOTATION_GROUP': {
      const newGroup: AnnotationGroup = {
        ...action.payload,
        id: generateGroupId(),
      };
      return updateActiveSlot(state, slot => ({
        ...slot,
        annotations: {
          ...slot.annotations,
          groups: [...slot.annotations.groups, newGroup],
        },
      }));
    }

    case 'UPDATE_ANNOTATION_GROUP': {
      return updateActiveSlot(state, slot => ({
        ...slot,
        annotations: {
          ...slot.annotations,
          groups: slot.annotations.groups.map((g) =>
            g.id === action.payload.id ? action.payload : g
          ),
        },
      }));
    }

    case 'REMOVE_ANNOTATION_GROUP': {
      return updateActiveSlot(state, slot => ({
        ...slot,
        annotations: {
          ...slot.annotations,
          groups: slot.annotations.groups.filter((g) => g.id !== action.payload),
        },
      }));
    }

    case 'LOAD_ANNOTATIONS':
      return updateActiveSlot(state, slot => ({
        ...slot,
        annotations: action.payload,
      }));

    case 'CLEAR_ANNOTATIONS':
      return updateActiveSlot(state, slot => ({
        ...slot,
        annotations: createEmptyAnnotationState(),
      }));

    case 'ATTACH_METADATA_BUNDLE': {
      const { index, bundle, warning } = action.payload;
      return updatePlanSlot(state, index, (slot) => ({
        ...slot,
        metadataBundle: bundle,
        metadataBundleWarning: warning,
        error: null,
      }));
    }

    case 'DETACH_METADATA_BUNDLE':
      return updatePlanSlot(state, action.payload, (slot) => ({
        ...slot,
        metadataBundle: null,
        metadataBundleWarning: null,
      }));

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
  metadataBundle: MetadataBundle | null;

  // Global state
  viewMode: ViewMode;
  sankeyMetric: SankeyMetric;
  flameMetric: FlameMetric;
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
  loadMetadataBundle: (text: string) => LoadMetadataBundleResult;
  attachMetadataBundleToSlot: (bundle: MetadataBundle, index: number) => { ok: true; warning: string | null } | { ok: false; error: string };
  applyMetadataToAllSlots: (bundle: MetadataBundle) => Array<{ index: number; warning: string | null }>;
  metadataBundleWarning: string | null;
  detachMetadataBundle: (index: number) => void;
  selectNode: (id: number | null, options?: { additive?: boolean }) => void;
  selectNodeForPlan: (index: number, id: number | null, options?: { additive?: boolean }) => void;
  setViewMode: (mode: ViewMode) => void;
  setTreeCompareEnabled: (enabled: boolean) => void;
  setSankeyMetric: (metric: SankeyMetric) => void;
  setFlameMetric: (metric: FlameMetric) => void;
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
  advisorReport: AdvisorReport | null;
  highlightStyle: HighlightStyle;
  setHighlightStyle: (style: HighlightStyle) => void;
  hotspotsEnabled: boolean;
  setHotspotsEnabled: (enabled: boolean) => void;
  setLegendVisible: (visible: boolean) => void;
  // Density presets (derived from nodeDisplayOptions, never stored)
  densitySelection: DensitySelection;
  applyDensityPreset: (preset: DensityPreset) => void;
  // Session-only UI state (not persisted)
  commandPaletteOpen: boolean;
  setCommandPaletteOpen: (open: boolean) => void;
  shortcutsOverlayOpen: boolean;
  setShortcutsOverlayOpen: (open: boolean) => void;
  setInputPanelCollapsed: (collapsed: boolean) => void;
  setFilterPanelCollapsed: (collapsed: boolean) => void;
  setDetailPanelCollapsed: (collapsed: boolean) => void;
  setVisualizationMaximized: (maximized: boolean) => void;

  // Annotations
  annotations: AnnotationState;
  hasUnsavedAnnotations: boolean;
  getAnnotationsForPlan: (index: number) => AnnotationState;

  // Multi-plan actions
  addPlanSlot: () => void;
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
  sharePlan: () => Promise<{ ok: true; url: string; warning?: string } | { ok: false; error: string }>;

  // Export PNG — HierarchicalView registers a capture function, Header calls it
  exportPngFnRef: React.MutableRefObject<(() => Promise<void>) | null>;
}

const PlanContext = createContext<PlanContextValue | null>(null);

export function PlanProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(planReducer, undefined, getInitialState);
  const saveTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const exportPngFnRef = useRef<(() => Promise<void>) | null>(null);
  // Session-only UI state (not persisted to settings)
  const [commandPaletteOpen, setCommandPaletteOpen] = useState(false);
  const [shortcutsOverlayOpen, setShortcutsOverlayOpen] = useState(false);

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

  const loadMetadataBundle = useCallback(
    (text: string): LoadMetadataBundleResult => {
      let bundle: MetadataBundle;
      try {
        bundle = parseBundle(text);
      } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : 'Could not parse metadata bundle.' };
      }
      const decision = pairBundleWithSlots(bundle, state.plans);
      if (decision.kind === 'no-targets') {
        return { ok: false, error: decision.reason };
      }
      if (decision.kind === 'needs-choice') {
        return {
          ok: 'needs-choice',
          bundle,
          reason: decision.reason,
          candidateIndices: decision.candidateIndices,
        };
      }
      const warning = combineWarnings(decision.warning, emptyBundleWarning(bundle));
      dispatch({
        type: 'ATTACH_METADATA_BUNDLE',
        payload: { index: decision.slotIndex, bundle, warning },
      });
      return { ok: true, pairedSlotIndex: decision.slotIndex, warning };
    },
    [state.plans],
  );

  const attachMetadataBundleToSlot = useCallback(
    (bundle: MetadataBundle, index: number): { ok: true; warning: string | null } | { ok: false; error: string } => {
      const slot = state.plans[index];
      if (!slot || !slot.parsedPlan) {
        return { ok: false, error: 'Selected slot has no loaded plan.' };
      }
      const decision = pairBundleWithSlots(bundle, state.plans);
      let warning: string | null = null;
      if (decision.kind === 'auto-attach' && decision.slotIndex === index) {
        warning = decision.warning;
      } else {
        const bundlePlanHash = bundle.plan_ref.plan_hash_value;
        const slotPlanHash = slot.parsedPlan.planHashValue;
        const bundleSqlId = bundle.plan_ref.sql_id;
        const slotSqlId = slot.parsedPlan.sqlId;
        if (bundleSqlId && slotSqlId && bundleSqlId !== slotSqlId) {
          warning = `Manually attached — bundle SQL_ID ${bundleSqlId} differs from this plan's SQL_ID ${slotSqlId}.`;
        } else if (
          bundlePlanHash !== null &&
          slotPlanHash !== undefined &&
          slotPlanHash !== String(bundlePlanHash)
        ) {
          warning = `Metadata was captured for a different plan_hash of this SQL — stats may have changed (plan ${slotPlanHash} vs. bundle ${bundlePlanHash}).`;
        }
      }
      warning = combineWarnings(warning, emptyBundleWarning(bundle));
      dispatch({ type: 'ATTACH_METADATA_BUNDLE', payload: { index, bundle, warning } });
      return { ok: true, warning };
    },
    [state.plans],
  );

  const detachMetadataBundle = useCallback((index: number) => {
    dispatch({ type: 'DETACH_METADATA_BUNDLE', payload: index });
  }, []);

  const applyMetadataToAllSlots = useCallback(
    (bundle: MetadataBundle): Array<{ index: number; warning: string | null }> => {
      const results: Array<{ index: number; warning: string | null }> = [];
      const bundleSqlId = bundle.plan_ref.sql_id;
      const bundlePlanHash = bundle.plan_ref.plan_hash_value;
      state.plans.forEach((slot, index) => {
        if (!slot.parsedPlan) return;
        let warning: string | null = null;
        const slotSqlId = slot.parsedPlan.sqlId;
        const slotPlanHash = slot.parsedPlan.planHashValue;
        if (bundleSqlId && slotSqlId && bundleSqlId !== slotSqlId) {
          warning = `Bundle SQL_ID ${bundleSqlId} differs from this plan's SQL_ID ${slotSqlId}.`;
        } else if (
          bundlePlanHash !== null &&
          slotPlanHash !== undefined &&
          slotPlanHash !== String(bundlePlanHash)
        ) {
          warning = `Metadata was captured for a different plan_hash of this SQL — stats may have changed (plan ${slotPlanHash} vs. bundle ${bundlePlanHash}).`;
        }
        dispatch({ type: 'ATTACH_METADATA_BUNDLE', payload: { index, bundle, warning } });
        results.push({ index, warning });
      });
      return results;
    },
    [state.plans],
  );

  // Derive active slot values for backward compatibility
  const activeSlot = state.plans[state.activePlanIndex];
  const rawInput = activeSlot.rawInput;
  const parsedPlan = activeSlot.parsedPlan;
  const selectedNodeId = activeSlot.selectedNodeId;
  const selectedNodeIds = activeSlot.selectedNodeIds;
  const error = activeSlot.error;
  const metadataBundle = activeSlot.metadataBundle;
  const metadataBundleWarning = activeSlot.metadataBundleWarning;

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

  // Hottest node: the non-root node with the highest self time
  const hottestNodeId = useMemo(
    (): number | null => (state.hotspotsEnabled ? computeHottestNodeId(parsedPlan) : null),
    [parsedPlan, state.hotspotsEnabled]
  );

  const advisorReport = useMemo(
    (): AdvisorReport | null => (parsedPlan ? runAdvisor(parsedPlan, metadataBundle ?? null) : null),
    [parsedPlan, metadataBundle]
  );

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
        const { plans, annotations: legacyAnnotations } = urlData.payload;
        const restoredPlans = buildPlanSlotsFromInputs(plans.map((plan) => plan.rawInput));

        // Restore per-plan annotations from URL
        for (let i = 0; i < restoredPlans.length && i < plans.length; i++) {
          const planAnnotations = plans[i].annotations;
          if (planAnnotations) {
            try {
              restoredPlans[i] = { ...restoredPlans[i], annotations: deserializeAnnotations(planAnnotations) };
            } catch {
              // Per-plan annotations failed to deserialize
            }
          }
        }

        dispatch({ type: 'REPLACE_PLANS', payload: { plans: restoredPlans, activePlanIndex: 0 } });
        dispatch({
          type: 'SET_INPUT_PANEL_COLLAPSED',
          payload: restoredPlans.some((slot) => slot.parsedPlan),
        });

        // Legacy: restore global annotations to active plan (older share URLs)
        if (legacyAnnotations && !plans.some(p => p.annotations)) {
          try {
            const annotationState = deserializeAnnotations(legacyAnnotations);
            dispatch({ type: 'LOAD_ANNOTATIONS', payload: annotationState });
          } catch {
            // Annotations from URL failed to deserialize
          }
        }
      }
      return;
    }

    // Marketing/deep-link params: `?example=<name>` and `?view=<tab>`.
    // Applied only when there's no shared-plan URL to restore (handled above).
    if (typeof window === 'undefined') return;
    const params = new URLSearchParams(window.location.search);

    const exampleParam = params.get('example');
    if (exampleParam) {
      const sample = findSampleByUrlParam(exampleParam);
      if (sample) {
        importPlanInput(sample.data);
      }
      // No match: ignore silently, normal empty-state startup.
    }

    const viewParam = params.get('view');
    if (viewParam) {
      const mode = parseViewModeFromUrlParam(viewParam);
      // `compare` requires two loaded plans and is intentionally not supported via URL param.
      if (mode && mode !== 'compare') {
        dispatch({ type: 'SET_VIEW_MODE', payload: mode });
      }
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
        flameMetric: state.flameMetric,
        nodeIndicatorMetric: state.nodeIndicatorMetric,
        colorScheme: state.colorScheme,
        highlightStyle: state.highlightStyle,
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
    state.flameMetric,
    state.nodeIndicatorMetric,
    state.colorScheme,
    state.highlightStyle,
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

  const setFlameMetric = useCallback((metric: FlameMetric) => {
    dispatch({ type: 'SET_FLAME_METRIC', payload: metric });
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

  // Density presets: derived from the current display options, applied via filters
  const densitySelection = useMemo(
    () => matchDensityPreset(state.filters.nodeDisplayOptions),
    [state.filters.nodeDisplayOptions]
  );
  const applyDensityPreset = useCallback((preset: DensityPreset) => {
    dispatch({ type: 'SET_FILTERS', payload: { nodeDisplayOptions: { ...DENSITY_PRESETS[preset] } } });
  }, []);

  const clearPlan = useCallback(() => {
    dispatch({ type: 'CLEAR_PLAN' });
  }, []);

  const setHighlightStyle = useCallback((style: HighlightStyle) => {
    dispatch({ type: 'SET_HIGHLIGHT_STYLE', payload: style });
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

  const addPlanSlot = useCallback(() => {
    dispatch({ type: 'ADD_PLAN_SLOT' });
    dispatch({ type: 'SET_INPUT_PANEL_COLLAPSED', payload: false });
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

  const getAnnotationsForPlan = useCallback((index: number): AnnotationState => {
    return state.plans[index]?.annotations ?? createEmptyAnnotationState();
  }, [state.plans]);

  const exportAnnotatedPlan = useCallback(() => {
    if (!parsedPlan) return;
    const activeBundle = state.plans[state.activePlanIndex]?.metadataBundle ?? null;
    const exportData: AnnotatedPlanExport = {
      version: activeBundle ? 2 : 1,
      exportedAt: new Date().toISOString(),
      rawPlanText: rawInput,
      planSource: parsedPlan.source,
      planHashValue: parsedPlan.planHashValue,
      sqlId: parsedPlan.sqlId,
      annotations: serializeAnnotations(state.plans[state.activePlanIndex]?.annotations ?? createEmptyAnnotationState()),
      ...(activeBundle ? { metadataBundle: activeBundle } : {}),
    };
    downloadAnnotatedPlan(exportData);
  }, [parsedPlan, rawInput, state.plans, state.activePlanIndex]);

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
      // v2+: embedded metadata bundle
      if (data.version === 2 && data.metadataBundle !== undefined) {
        try {
          const bundle = parseBundle(JSON.stringify(data.metadataBundle));
          dispatch({
            type: 'ATTACH_METADATA_BUNDLE',
            payload: { index: state.activePlanIndex, bundle, warning: null },
          });
        } catch (err) {
          dispatch({
            type: 'SET_ERROR',
            payload: `Imported plan, but embedded metadata bundle is invalid: ${
              err instanceof Error ? err.message : 'Unknown error'
            }`,
          });
        }
      }
    } catch (err) {
      dispatch({
        type: 'SET_ERROR',
        payload: `Import error: ${err instanceof Error ? err.message : 'Unknown error'}`,
      });
    }
  }, [state.activePlanIndex]);

  const sharePlan = useCallback(async (): Promise<{ ok: true; url: string; warning?: string } | { ok: false; error: string }> => {
    // Need at least one plan with input
    const hasAnyInput = state.plans.some(slot => slot.rawInput);
    if (!hasAnyInput) {
      return { ok: false, error: 'No plan to share.' };
    }

    const slotsWithInput = state.plans.filter(slot => slot.rawInput);

    const buildPayload = (rawInputs: string[]): SharePayload => ({
      plans: slotsWithInput.map((slot, i) => {
        const entry: SharePayload['plans'][number] = { rawInput: rawInputs[i] };
        if (hasAnnotations(slot.annotations)) {
          entry.annotations = serializeAnnotations(slot.annotations);
        }
        return entry;
      }),
    });

    // Try full input first
    const fullInputs = slotsWithInput.map(slot => slot.rawInput);
    let result = buildShareUrl(buildPayload(fullInputs));

    // If too large, retry with stripped XML
    let warning: string | undefined;
    if (!result.ok) {
      const strippedInputs = fullInputs.map(stripUnusedXmlSections);
      const strippedResult = buildShareUrl(buildPayload(strippedInputs));
      if (strippedResult.ok) {
        result = strippedResult;
        warning = 'Some non-essential data was stripped to fit the URL size limit.';
      } else {
        return strippedResult;
      }
    }

    if (result.ok) {
      window.history.replaceState(null, '', result.url);
      try {
        await navigator.clipboard.writeText(result.url);
      } catch {
        // Clipboard write may fail in some contexts — URL is still in address bar
      }
      return { ...result, warning };
    }
    return result;
  }, [state.plans]);

  const getSelectedNode = useCallback((): PlanNode | null => selectedNode, [selectedNode]);

  const getFilteredNodes = useCallback((): PlanNode[] => filteredNodes, [filteredNodes]);

  const value: PlanContextValue = {
    // Backward-compatible derived values
    rawInput,
    parsedPlan,
    selectedNodeId,
    selectedNodeIds,
    error,
    metadataBundle,
    metadataBundleWarning,

    // Global state
    viewMode: state.viewMode,
    sankeyMetric: state.sankeyMetric,
    flameMetric: state.flameMetric,
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
    loadMetadataBundle,
    attachMetadataBundleToSlot,
    applyMetadataToAllSlots,
    detachMetadataBundle,
    selectNode,
    selectNodeForPlan,
    setViewMode,
    setTreeCompareEnabled,
    setSankeyMetric,
    setFlameMetric,
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
    advisorReport,
    highlightStyle: state.highlightStyle,
    setHighlightStyle,
    hotspotsEnabled: state.hotspotsEnabled,
    setHotspotsEnabled,
    setLegendVisible,
    densitySelection,
    applyDensityPreset,
    commandPaletteOpen,
    setCommandPaletteOpen,
    shortcutsOverlayOpen,
    setShortcutsOverlayOpen,
    setInputPanelCollapsed,
    setFilterPanelCollapsed,
    setDetailPanelCollapsed,
    setVisualizationMaximized,

    // Annotations (derived from active plan slot)
    annotations: state.plans[state.activePlanIndex]?.annotations ?? createEmptyAnnotationState(),
    hasUnsavedAnnotations: state.plans.some(slot => hasAnnotations(slot.annotations)),
    getAnnotationsForPlan,

    // Multi-plan actions
    addPlanSlot,
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
