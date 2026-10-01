/* eslint-disable react-refresh/only-export-components */
import { createContext, useContext, useReducer, useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import type { ReactNode } from 'react';
import type { ParsedPlan, PlanNode, FilterState, ViewMode, SankeyMetric, FlameMetric, ExperimentalSubView, NodeIndicatorMetric, Theme, ColorScheme, AppPalette } from '../lib/types';
import type { PlanSlot, CompareMetric } from '../lib/compare';
import { createEmptySlot, DEFAULT_COMPARE_METRICS, getPlanSlotLabel } from '../lib/compare';
import { parseExplainPlan, splitDbmsXplanPlanBatches, getSourceDisplayName } from '../lib/parser';
import { loadSettings, saveSettings, extractFilterSettings, applySettingsToFilters, defaultBehaviourOptions, defaultNodeDisplayOptions } from '../lib/settings';
import { matchesFilters } from '../lib/filtering';
import { computeHottestNodeId } from '../lib/analysis';
import { DENSITY_PRESETS, matchDensityPreset } from '../lib/density';
import type { DensityPreset, DensitySelection } from '../lib/density';
import { getPlanFromUrl, getGzipPlanParamFromHash, clearPlanFromUrl, buildShareLink, decodeGzipPlanParam, classifyDecodedPlanText, getSharedViewMode } from '../lib/url';
import type { SharePlanEntry, UrlPlanData } from '../lib/url';
import { describeParseFailure } from '../lib/formats';
import { looksLikeMetadataBundle } from '../lib/metadata/bundle';
import { planDrop, readDroppedFiles } from '../lib/dropFiles';
import {
  SESSION_KEY,
  loadSession,
  saveSession,
  clearSession,
  addRecentPlan,
  removeRecentPlan as removeRecentPlanFromStorage,
  subscribeRecentPlans,
  getRecentPlansSnapshot,
  getEmptyRecentPlans,
} from '../lib/session';
import type { RecentPlan, SavedSession } from '../lib/session';
import { useConfirm, useToast } from '../components/ui';
import type { AnnotationState, AnnotationGroup, HighlightBrush, HighlightColor, HighlightStyle, AnnotatedPlanExport } from '../lib/annotations';
import { createEmptyAnnotationState, hasAnnotations, serializeAnnotations, deserializeAnnotations, validateExport, downloadAnnotatedPlan, generateGroupId, highlightMatchesBrush } from '../lib/annotations';
import type { MetadataBundle } from '../lib/metadata/bundle';
import { parseBundle, emptyBundleWarning } from '../lib/metadata/bundle';
import { copyToClipboard } from '../lib/clipboard';
import { SAMPLE_PLANS_WITH_ORDER } from '../examples';
import type { SamplePlan } from '../examples';
import { runAdvisor } from '../lib/advisor';
import type { AdvisorReport } from '../lib/advisor';
import type { TreeLayoutDirection, TreeMinimapMode } from '../lib/settings';
import type { TreeViewActions, TreeViewState } from '../lib/treeCollapse';

function combineWarnings(...warnings: Array<string | null>): string | null {
  const present = warnings.filter((w): w is string => Boolean(w));
  return present.length > 0 ? present.join(' ') : null;
}
import { pairBundleWithSlots } from '../lib/metadata/pairing';

export type LoadMetadataBundleResult =
  | { ok: true; pairedSlotIndex: number; warning: string | null }
  | { ok: 'needs-choice'; bundle: MetadataBundle; reason: string; candidateIndices: number[] }
  | { ok: false; error: string };

/**
 * Warning for a bundle re-attached from a share link or saved session, where
 * the original pairing decision is no longer known.
 */
function restoredBundleWarning(bundle: MetadataBundle, plan: ParsedPlan | null): string | null {
  let warning: string | null = null;
  const bundleSqlId = bundle.plan_ref.sql_id;
  const bundlePlanHash = bundle.plan_ref.plan_hash_value;
  if (plan) {
    if (bundleSqlId && plan.sqlId && bundleSqlId !== plan.sqlId) {
      warning = `Manually attached — bundle SQL_ID ${bundleSqlId} differs from this plan's SQL_ID ${plan.sqlId}.`;
    } else if (bundlePlanHash !== null && plan.planHashValue !== undefined && plan.planHashValue !== String(bundlePlanHash)) {
      warning = `Metadata was captured for a different plan_hash of this SQL — stats may have changed (plan ${plan.planHashValue} vs. bundle ${bundlePlanHash}).`;
    }
  }
  return combineWarnings(warning, emptyBundleWarning(bundle));
}

/** The loaded slots as a saved session (empty/failed slots are skipped). */
function buildSavedSession(state: PlanState): SavedSession {
  const slots: SavedSession['slots'] = [];
  let activePlanIndex = 0;
  state.plans.forEach((slot, index) => {
    if (!slot.parsedPlan || !slot.rawInput) return;
    if (index === state.activePlanIndex) activePlanIndex = slots.length;
    slots.push({
      ...(slot.customLabel ? { customLabel: slot.customLabel } : {}),
      text: slot.rawInput,
      ...(slot.metadataBundle ? { metadataText: JSON.stringify(slot.metadataBundle) } : {}),
      ...(hasAnnotations(slot.annotations) ? { annotations: serializeAnnotations(slot.annotations) } : {}),
    });
  });
  return {
    version: 1,
    savedAt: new Date().toISOString(),
    activePlanIndex,
    viewMode: state.viewMode,
    slots,
  };
}

/** Plans + labels + bundles + annotations, ignoring the view and timestamp. */
function sessionContentSignature(session: SavedSession): string {
  return JSON.stringify(session.slots);
}

/** View modes worth restoring (AI tabs hold session-only state). */
function restorableViewMode(mode: ViewMode | null, parsedPlanCount: number): ViewMode | null {
  if (!mode || mode === 'ai' || mode === 'ai-report') return null;
  if (mode === 'compare' && parsedPlanCount < 2) return null;
  return mode;
}

interface ImportOptions {
  replaceAll?: boolean;
  metadataText?: string;
  /** Recent-plans entry options, or false to not record the load. */
  recent?: { label?: string } | false;
}

interface ImportOutcome {
  ok: boolean;
  /** What happened to `metadataText`, when one was passed. */
  bundle: 'none' | 'attached' | 'unmatched' | 'invalid';
}

function pluralize(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? '' : 's'}`;
}

/** "2 notes, 1 highlight and 1 group" (empty parts omitted). */
function summarizeAnnotations(annotations: AnnotationState): string {
  const parts = [
    annotations.nodeAnnotations.size > 0 ? pluralize(annotations.nodeAnnotations.size, 'note') : null,
    annotations.nodeHighlights.size > 0 ? pluralize(annotations.nodeHighlights.size, 'highlight') : null,
    annotations.groups.length > 0 ? pluralize(annotations.groups.length, 'group') : null,
  ].filter((p): p is string => p !== null);
  if (parts.length <= 1) return parts[0] ?? 'annotations';
  return `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`;
}

/** Slots a load of `input` will replace: all of them for a multi-plan paste, else the active one. */
function importTargetIndices(state: { plans: PlanSlot[]; activePlanIndex: number }, input: string): number[] {
  const batches = splitDbmsXplanPlanBatches(input).filter((batch) => batch.trim());
  return batches.length > 1 ? state.plans.map((_, index) => index) : [state.activePlanIndex];
}

interface PlanState {
  plans: PlanSlot[];
  activePlanIndex: number;
  comparePlanIndices: [number, number];
  compareMetrics: CompareMetric[];
  viewMode: ViewMode;
  treeCompareEnabled: boolean;
  sankeyMetric: SankeyMetric;
  flameMetric: FlameMetric;
  experimentalSubView: ExperimentalSubView;
  nodeIndicatorMetric: NodeIndicatorMetric;
  colorScheme: ColorScheme;
  palette: AppPalette;
  theme: Theme;
  filters: FilterState;
  // UI panel states (persisted)
  hotspotsEnabled: boolean;
  showAdvisorSuggestions: boolean;
  legendVisible: boolean;
  inputPanelCollapsed: boolean;
  filterPanelCollapsed: boolean;
  detailPanelCollapsed: boolean;
  focusMode: boolean;
  visualizationMaximized: boolean;
  _preMaxPanelState: { filter: boolean; detail: boolean } | null;
  // Highlight brush: `highlightStyle` is the brush style (and the render
  // fallback for legacy highlights saved without a style of their own).
  highlightStyle: HighlightStyle;
  highlightBrushColor: HighlightColor;
  // Metadata-bundle attach feedback (session-only)
  bundleNotice: BundleNotice | null;
  pendingBundleChoice: PendingBundleChoice | null;
}

type PlanAction =
  | { type: 'SET_BUNDLE_NOTICE'; payload: BundleNotice | null }
  | { type: 'SET_PENDING_BUNDLE_CHOICE'; payload: PendingBundleChoice | null }
  | { type: 'REPLACE_PLANS'; payload: { plans: PlanSlot[]; activePlanIndex?: number } }
  /** Sets the active slot's draft (the drawer textarea), not the loaded text. */
  | { type: 'SET_INPUT'; payload: string }
  /** Loads a parsed plan into the active slot; `text` becomes its rawInput and draft. */
  | { type: 'SET_PARSED_PLAN'; payload: { plan: ParsedPlan; text: string } }
  | { type: 'SELECT_NODE'; payload: { id: number | null; additive?: boolean } }
  | { type: 'SELECT_NODE_FOR_PLAN'; payload: { index: number; id: number | null; additive?: boolean } }
  | { type: 'SET_VIEW_MODE'; payload: ViewMode }
  | { type: 'SET_TREE_COMPARE_ENABLED'; payload: boolean }
  | { type: 'SET_SANKEY_METRIC'; payload: SankeyMetric }
  | { type: 'SET_FLAME_METRIC'; payload: FlameMetric }
  | { type: 'SET_EXPERIMENTAL_SUB_VIEW'; payload: ExperimentalSubView }
  | { type: 'SET_NODE_INDICATOR_METRIC'; payload: NodeIndicatorMetric }
  | { type: 'SET_COLOR_SCHEME'; payload: ColorScheme }
  | { type: 'SET_PALETTE'; payload: AppPalette }
  | { type: 'SET_THEME'; payload: Theme }
  | { type: 'SET_FILTERS'; payload: Partial<FilterState> }
  | { type: 'SET_ERROR'; payload: string | null }
  | { type: 'CLEAR_PLAN' }
  | { type: 'SET_HOTSPOTS_ENABLED'; payload: boolean }
  | { type: 'SET_ADVISOR_SUGGESTIONS'; payload: boolean }
  | { type: 'SET_LEGEND_VISIBLE'; payload: boolean }
  | { type: 'SET_INPUT_PANEL_COLLAPSED'; payload: boolean }
  | { type: 'SET_FILTER_PANEL_COLLAPSED'; payload: boolean }
  | { type: 'SET_DETAIL_PANEL_COLLAPSED'; payload: boolean }
  | { type: 'SET_FOCUS_MODE'; payload: boolean }
  | { type: 'SET_VISUALIZATION_MAXIMIZED'; payload: boolean }
  | { type: 'ADD_PLAN_SLOT' }
  | { type: 'REMOVE_PLAN_SLOT'; payload: number }
  | { type: 'RENAME_PLAN_SLOT'; payload: { index: number; customLabel: string } }
  | { type: 'SET_ACTIVE_PLAN'; payload: number }
  | { type: 'SET_COMPARE_PLAN_INDICES'; payload: [number, number] }
  | { type: 'SWAP_COMPARE_PLAN_INDICES' }
  | { type: 'SET_COMPARE_METRICS'; payload: CompareMetric[] }
  | { type: 'SET_HIGHLIGHT_STYLE'; payload: HighlightStyle }
  | { type: 'SET_HIGHLIGHT_BRUSH'; payload: Partial<HighlightBrush> }
  // Node-scoped annotation actions target `planIndex` (the tree-compare panes
  // each render their own plan); without it they act on the active plan.
  | { type: 'SET_NODE_ANNOTATION'; payload: { nodeId: number; text: string; planIndex?: number } }
  | { type: 'REMOVE_NODE_ANNOTATION'; payload: { nodeId: number; planIndex?: number } }
  | { type: 'SET_NODE_HIGHLIGHT'; payload: { nodeId: number; color: HighlightColor; style?: HighlightStyle; planIndex?: number } }
  | { type: 'REMOVE_NODE_HIGHLIGHT'; payload: { nodeId: number; planIndex?: number } }
  /** Toggle: clears the node's highlight if it already matches the brush, else paints the brush. */
  | { type: 'PAINT_NODE_HIGHLIGHT'; payload: { planIndex: number; nodeId: number } }
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
  ...defaultBehaviourOptions,
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
    case 'experimental':
    case 'lab':
      return 'experimental';
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
  const initialTheme = getInitialTheme();
  const settings = loadSettings(initialTheme);
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
    experimentalSubView: settings.experimentalSubView ?? 'scatter',
    nodeIndicatorMetric: settings.nodeIndicatorMetric,
    colorScheme: settings.colorScheme ?? 'semantic',
    palette: settings.palette,
    theme: initialTheme,
    filters: applySettingsToFilters(initialFilters, settings),
    highlightStyle: settings.highlightStyle ?? 'circle',
    highlightBrushColor: settings.highlightBrushColor ?? 'red',
    hotspotsEnabled: settings.hotspotsEnabled ?? true,
    showAdvisorSuggestions: settings.showAdvisorSuggestions ?? false,
    legendVisible: settings.legendVisible,
    inputPanelCollapsed: initialPlans.some((slot) => slot.parsedPlan) ? settings.inputPanelCollapsed : false,
    filterPanelCollapsed: settings.filterPanelCollapsed,
    detailPanelCollapsed: false,
    focusMode: settings.focusMode ?? false,
    visualizationMaximized: false,
    _preMaxPanelState: null,
    bundleNotice: null,
    pendingBundleChoice: null,
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

/** Updates `planIndex`'s slot, or the active one when no index is given. */
function updateTargetSlot(state: PlanState, planIndex: number | undefined, updater: (slot: PlanSlot) => PlanSlot): PlanState {
  return planIndex === undefined ? updateActiveSlot(state, updater) : updatePlanSlot(state, planIndex, updater);
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
    case 'SET_BUNDLE_NOTICE':
      return { ...state, bundleNotice: action.payload };

    case 'SET_PENDING_BUNDLE_CHOICE':
      return { ...state, pendingBundleChoice: action.payload };

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
      // The draft only: rawInput stays the loaded plan's source text so the
      // Plan Text view, Share, Save-annotated and reports keep working.
      return updateActiveSlot(state, slot => ({ ...slot, draftInput: action.payload, error: null }));

    case 'SET_PARSED_PLAN': {
      const { plan, text } = action.payload;
      // Default the node indicator to A-Time (or A-Rows) when the plan carries
      // actual runtime stats, otherwise fall back to Cost.
      const hasActualTime = plan.allNodes.some((n) => n.actualTime !== undefined);
      const hasActualRows = plan.hasActualStats || plan.maxActualRows !== undefined;
      const newMetric: NodeIndicatorMetric = hasActualTime
        ? 'actualTime'
        : hasActualRows
          ? 'actualRows'
          : 'cost';
      const nextState = updateActiveSlot(state, slot => ({
        ...slot,
        rawInput: text,
        draftInput: text,
        parsedPlan: plan,
        error: null,
        selectedNodeId: null,
        selectedNodeIds: [],
        annotations: createEmptyAnnotationState(),
        // A new plan belongs to a different SQL_ID/plan; drop any metadata
        // bundle attached to the previous plan so it can't bleed across queries.
        // Callers that want to keep a bundle re-attach it right after this.
        metadataBundle: null,
        metadataBundleWarning: null,
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

    case 'SET_EXPERIMENTAL_SUB_VIEW':
      return { ...state, experimentalSubView: action.payload };

    case 'SET_FLAME_METRIC':
      return { ...state, flameMetric: action.payload };

    case 'SET_NODE_INDICATOR_METRIC':
      return { ...state, nodeIndicatorMetric: action.payload };

    case 'SET_COLOR_SCHEME':
      return { ...state, colorScheme: action.payload };

    case 'SET_PALETTE':
      return { ...state, palette: action.payload };

    case 'SET_THEME':
      return { ...state, theme: action.payload };

    case 'SET_FILTERS':
      return {
        ...state,
        filters: { ...state.filters, ...action.payload },
      };

    case 'SET_ERROR': {
      const nextState = updateActiveSlot(state, slot => ({ ...slot, error: action.payload }));
      // Errors render inside the input drawer: open it so they are never
      // raised into a collapsed (invisible) panel.
      return action.payload ? { ...nextState, inputPanelCollapsed: false } : nextState;
    }

    case 'CLEAR_PLAN':
      {
        const nextState = updateActiveSlot(state, slot => ({
          ...slot,
          rawInput: '',
          draftInput: '',
          parsedPlan: null,
          selectedNodeId: null,
          selectedNodeIds: [],
          error: null,
          annotations: createEmptyAnnotationState(),
          // An emptied slot must not keep the previous plan's bundle.
          metadataBundle: null,
          metadataBundleWarning: null,
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

    case 'SET_HIGHLIGHT_BRUSH': {
      const { color, style } = action.payload;
      const nextColor = color ?? state.highlightBrushColor;
      const nextStyle = style ?? state.highlightStyle;
      if (nextColor === state.highlightBrushColor && nextStyle === state.highlightStyle) return state;
      return { ...state, highlightBrushColor: nextColor, highlightStyle: nextStyle };
    }

    case 'SET_HOTSPOTS_ENABLED':
      return { ...state, hotspotsEnabled: action.payload };

    case 'SET_ADVISOR_SUGGESTIONS':
      return { ...state, showAdvisorSuggestions: action.payload };

    case 'SET_LEGEND_VISIBLE':
      return { ...state, legendVisible: action.payload };

    case 'SET_INPUT_PANEL_COLLAPSED':
      return { ...state, inputPanelCollapsed: action.payload };

    case 'SET_FILTER_PANEL_COLLAPSED':
      return { ...state, filterPanelCollapsed: action.payload };

    case 'SET_DETAIL_PANEL_COLLAPSED':
      return { ...state, detailPanelCollapsed: action.payload };

    case 'SET_FOCUS_MODE':
      return { ...state, focusMode: action.payload };

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
      const { nodeId, text, planIndex } = action.payload;
      return updateTargetSlot(state, planIndex, slot => {
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
      return updateTargetSlot(state, action.payload.planIndex, slot => {
        const newAnnotations = new Map(slot.annotations.nodeAnnotations);
        newAnnotations.delete(action.payload.nodeId);
        return { ...slot, annotations: { ...slot.annotations, nodeAnnotations: newAnnotations } };
      });
    }

    case 'SET_NODE_HIGHLIGHT': {
      const { nodeId, color, style, planIndex } = action.payload;
      return updateTargetSlot(state, planIndex, slot => {
        const newHighlights = new Map(slot.annotations.nodeHighlights);
        // Every highlight remembers its own style: an explicit one wins, a
        // colour-only change keeps the node's current style, and a brand-new
        // highlight takes the brush style.
        const existing = newHighlights.get(nodeId);
        newHighlights.set(nodeId, { nodeId, color, style: style ?? existing?.style ?? state.highlightStyle });
        return { ...slot, annotations: { ...slot.annotations, nodeHighlights: newHighlights } };
      });
    }

    case 'REMOVE_NODE_HIGHLIGHT': {
      return updateTargetSlot(state, action.payload.planIndex, slot => {
        const newHighlights = new Map(slot.annotations.nodeHighlights);
        newHighlights.delete(action.payload.nodeId);
        return { ...slot, annotations: { ...slot.annotations, nodeHighlights: newHighlights } };
      });
    }

    case 'PAINT_NODE_HIGHLIGHT': {
      const { planIndex, nodeId } = action.payload;
      const brush: HighlightBrush = { color: state.highlightBrushColor, style: state.highlightStyle };
      return updatePlanSlot(state, planIndex, slot => {
        const newHighlights = new Map(slot.annotations.nodeHighlights);
        if (highlightMatchesBrush(newHighlights.get(nodeId), brush, state.highlightStyle)) {
          newHighlights.delete(nodeId);
        } else {
          newHighlights.set(nodeId, { nodeId, color: brush.color, style: brush.style });
        }
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

/**
 * Outcome of a share action, surfaced to the UI so it can react appropriately:
 * - `copied`  — link copied cleanly; a brief confirmation is enough.
 * - `warning` — copied, but the link is long enough that some clients may
 *               truncate it; show the full URL so the user can verify.
 * - `manual`  — the clipboard was blocked; the user must copy the shown URL.
 * - `error`   — the link could not be built (e.g. plan too large).
 */
export type ShareNotice =
  | { kind: 'copied'; url: string }
  | { kind: 'warning'; url: string; warning?: string }
  | { kind: 'manual'; url: string; warning?: string }
  | { kind: 'error'; message: string };

/** Feedback for metadata-bundle attach attempts (drawer / drop). */
export interface BundleNotice {
  tone: 'ok' | 'warn' | 'error';
  text: string;
}

/** A parsed bundle that matched several plan slots and needs the user to pick one. */
export interface PendingBundleChoice {
  bundle: MetadataBundle;
  reason: string;
  candidateIndices: number[];
  /** Reset the draft to the loaded plan's text after a successful attach. */
  resetDraft: boolean;
}

export interface LoadPlanOptions {
  /** Label for the Recent plans list (defaults to the SQL_ID). */
  label?: string;
  /** Remember the plan under Recent plans. Default true. */
  recordRecent?: boolean;
  /** Skip the "discard annotations?" confirmation. Default false. */
  skipConfirm?: boolean;
}

interface PlanContextValue {
  // Backward-compatible derived values from active plan
  /** Source text of the active slot's loaded plan (unchanged by typing in the drawer). */
  rawInput: string;
  /** What the drawer textarea holds for the active slot; Parse parses this. */
  draftInput: string;
  parsedPlan: ParsedPlan | null;
  selectedNodeId: number | null;
  selectedNodeIds: number[];
  error: string | null;
  metadataBundle: MetadataBundle | null;

  // Global state
  viewMode: ViewMode;
  sankeyMetric: SankeyMetric;
  flameMetric: FlameMetric;
  experimentalSubView: ExperimentalSubView;
  nodeIndicatorMetric: NodeIndicatorMetric;
  colorScheme: ColorScheme;
  palette: AppPalette;
  theme: Theme;
  filters: FilterState;
  legendVisible: boolean;
  inputPanelCollapsed: boolean;
  filterPanelCollapsed: boolean;
  detailPanelCollapsed: boolean;
  focusMode: boolean;
  treeCompareEnabled: boolean;
  visualizationMaximized: boolean;

  // Multi-plan state
  plans: PlanSlot[];
  activePlanIndex: number;
  comparePlanIndices: [number, number];
  hasMultiplePlans: boolean;
  compareMetrics: CompareMetric[];

  // Actions
  /** Update the active slot's draft (drawer textarea). */
  setInput: (input: string) => void;
  /**
   * Parse the active slot's draft (or `text` when given). Routes metadata
   * bundles to the attach flow, is a no-op for unchanged text, and asks before
   * discarding annotations.
   */
  parsePlan: (text?: string) => Promise<void>;
  /** Load plan text (e.g. from DB Connect). Asks before discarding annotations; resolves true when loaded. */
  loadAndParsePlan: (input: string, metadataText?: string, options?: LoadPlanOptions) => Promise<boolean>;
  /** Load a bundled example (not recorded under Recent plans). */
  loadExample: (sample: SamplePlan) => Promise<boolean>;
  /** Route dropped/picked files: plan, metadata bundle or annotated-plan export (multi-file aware). */
  loadFiles: (files: File[]) => Promise<void>;
  /**
   * Attach a metadata bundle given as text (asks before replacing an attached
   * bundle). Resolves true once attached — when the pairing chooser opens,
   * only after the user picks a plan there (false if they cancel).
   */
  attachBundleText: (text: string, options?: { resetDraft?: boolean }) => Promise<boolean>;
  bundleNotice: BundleNotice | null;
  dismissBundleNotice: () => void;
  pendingBundleChoice: PendingBundleChoice | null;
  /** Finish a needs-choice bundle attach: a slot index, or null to cancel. */
  resolveBundleChoice: (index: number | null) => Promise<void>;
  /** Guarded variants for UI entry points: confirm first, then act. Resolve true when done. */
  requestClearPlan: () => Promise<boolean>;
  requestClearAnnotations: () => Promise<boolean>;
  requestRemovePlanSlot: (index: number) => Promise<boolean>;
  // Recent plans (localStorage only)
  recentPlans: RecentPlan[];
  openRecentPlan: (entry: RecentPlan) => Promise<boolean>;
  removeRecentPlan: (id: string) => void;
  /** Drop the restored/saved session and start with an empty workspace. */
  startFresh: () => Promise<boolean>;
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
  setExperimentalSubView: (view: ExperimentalSubView) => void;
  setNodeIndicatorMetric: (metric: NodeIndicatorMetric) => void;
  setColorScheme: (scheme: ColorScheme) => void;
  setPalette: (palette: AppPalette) => void;
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
  /** Brush style — also the render fallback for legacy highlights without their own style. */
  highlightStyle: HighlightStyle;
  setHighlightStyle: (style: HighlightStyle) => void;
  /** The hover toolbar's highlight brush: colour (persisted) + style (`highlightStyle`). */
  highlightBrush: HighlightBrush;
  setHighlightBrush: (patch: Partial<HighlightBrush>) => void;
  hotspotsEnabled: boolean;
  setHotspotsEnabled: (enabled: boolean) => void;
  showAdvisorSuggestions: boolean;
  setShowAdvisorSuggestions: (enabled: boolean) => void;
  setLegendVisible: (visible: boolean) => void;
  // Density presets (derived from nodeDisplayOptions, never stored)
  densitySelection: DensitySelection;
  applyDensityPreset: (preset: DensityPreset) => void;
  // Session-only UI state (not persisted)
  commandPaletteOpen: boolean;
  setCommandPaletteOpen: (open: boolean) => void;
  shortcutsOverlayOpen: boolean;
  setShortcutsOverlayOpen: (open: boolean) => void;
  metadataPopoutOpen: boolean;
  setMetadataPopoutOpen: (open: boolean) => void;
  baselineDialogOpen: boolean;
  setBaselineDialogOpen: (open: boolean) => void;
  reportDialogOpen: boolean;
  setReportDialogOpen: (open: boolean) => void;
  connectPanelOpen: boolean;
  setConnectPanelOpen: (open: boolean) => void;
  setInputPanelCollapsed: (collapsed: boolean) => void;
  setFilterPanelCollapsed: (collapsed: boolean) => void;
  setDetailPanelCollapsed: (collapsed: boolean) => void;
  setFocusMode: (enabled: boolean) => void;
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

  // Annotation methods. The plain variants act on the active plan; the
  // `…ForPlan` variants address a specific plan (tree-compare panes each render
  // their own) without changing which plan is active.
  setNodeAnnotation: (nodeId: number, text: string) => void;
  removeNodeAnnotation: (nodeId: number) => void;
  /** Without `style`, a node keeps its current style (new highlights take the brush style). */
  setNodeHighlight: (nodeId: number, color: HighlightColor, style?: HighlightStyle) => void;
  removeNodeHighlight: (nodeId: number) => void;
  setNodeAnnotationForPlan: (planIndex: number, nodeId: number, text: string) => void;
  removeNodeAnnotationForPlan: (planIndex: number, nodeId: number) => void;
  setNodeHighlightForPlan: (planIndex: number, nodeId: number, color: HighlightColor, style?: HighlightStyle) => void;
  removeNodeHighlightForPlan: (planIndex: number, nodeId: number) => void;
  /** One-click brush: clears the node's highlight if it already matches the brush, else paints it. */
  paintNodeWithBrush: (planIndex: number, nodeId: number) => void;
  addAnnotationGroup: (group: Omit<AnnotationGroup, 'id'>) => void;
  updateAnnotationGroup: (group: AnnotationGroup) => void;
  removeAnnotationGroup: (id: string) => void;
  exportAnnotatedPlan: () => void;
  importAnnotatedPlan: (file: File) => Promise<void>;
  clearAnnotations: () => void;

  // Share URL
  sharePlan: () => Promise<{ ok: true; url: string; warning?: string; copied: boolean } | { ok: false; error: string }>;
  /** Build the share URL and publish the outcome as a dismissable notice. */
  share: () => Promise<void>;
  shareNotice: ShareNotice | null;
  dismissShareNotice: () => void;

  // Export PNG — HierarchicalView registers a capture function, Header calls it
  exportPngFnRef: React.MutableRefObject<(() => Promise<void>) | null>;

  // Tree view layout (persisted) + actions the mounted tree registers
  treeLayoutDirection: TreeLayoutDirection;
  setTreeLayoutDirection: (direction: TreeLayoutDirection) => void;
  treeMinimap: TreeMinimapMode;
  setTreeMinimap: (mode: TreeMinimapMode) => void;
  /** Expand/collapse all, fit, focus selected, redraw — null while no tree is mounted. */
  treeViewActionsRef: React.MutableRefObject<TreeViewActions | null>;
  /** Hidden count / collapsibility / minimap visibility the mounted tree publishes; null while none is. */
  treeViewState: TreeViewState | null;
  setTreeViewState: (state: TreeViewState | null) => void;
}

const PlanContext = createContext<PlanContextValue | null>(null);

export function PlanProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(planReducer, undefined, getInitialState);
  const saveTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const exportPngFnRef = useRef<(() => Promise<void>) | null>(null);
  // Session-only UI state (not persisted to settings)
  const [commandPaletteOpen, setCommandPaletteOpen] = useState(false);
  const [shortcutsOverlayOpen, setShortcutsOverlayOpen] = useState(false);
  const [metadataPopoutOpen, setMetadataPopoutOpen] = useState(false);
  const [baselineDialogOpen, setBaselineDialogOpen] = useState(false);
  const [reportDialogOpen, setReportDialogOpen] = useState(false);
  const [connectPanelOpen, setConnectPanelOpen] = useState(false);
  const [prevMetadataBundle, setPrevMetadataBundle] = useState<MetadataBundle | null>(null);
  const [shareNotice, setShareNotice] = useState<ShareNotice | null>(null);

  // Load pipeline feedback + session persistence (see lib/session.ts).
  const confirm = useConfirm();
  const toastApi = useToast();
  // Reducer-backed (not useState) so load paths that run from the startup
  // effect only ever dispatch.
  const { bundleNotice, pendingBundleChoice } = state;
  const setBundleNotice = useCallback(
    (notice: BundleNotice | null) => dispatch({ type: 'SET_BUNDLE_NOTICE', payload: notice }),
    [],
  );
  // Settles the `attachBundleText` promise that opened the current chooser
  // (true once attached, false when cancelled or superseded).
  const pendingBundleResolverRef = useRef<((attached: boolean) => void) | null>(null);
  const takePendingBundleResolver = useCallback(() => {
    const resolve = pendingBundleResolverRef.current;
    pendingBundleResolverRef.current = null;
    return resolve;
  }, []);
  const setPendingBundleChoice = useCallback(
    (choice: PendingBundleChoice | null) => {
      // A chooser that is replaced or cleared without going through
      // resolveBundleChoice did not attach anything.
      takePendingBundleResolver()?.(false);
      dispatch({ type: 'SET_PENDING_BUNDLE_CHOICE', payload: choice });
    },
    [takePendingBundleResolver],
  );
  const recentPlans = useSyncExternalStore(subscribeRecentPlans, getRecentPlansSnapshot, getEmptyRecentPlans);
  // Latest state for async flows (after an awaited confirm) and unload handlers.
  const stateRef = useRef(state);
  useEffect(() => {
    stateRef.current = state;
  }, [state]);
  // Autosave stays off until the startup effect has decided whether to restore.
  const sessionReadyRef = useRef(false);
  const lastSavedSessionRef = useRef<string | null>(null);
  // Content encoded by the share link currently in the address bar, if any.
  const sharedContentRef = useRef<string | null>(null);

  // Tree view layout preferences — self-contained state, persisted on change.
  const [treeLayoutDirection, setTreeLayoutDirectionState] = useState<TreeLayoutDirection>(
    () => loadSettings().treeLayoutDirection,
  );
  const [treeMinimap, setTreeMinimapState] = useState<TreeMinimapMode>(() => loadSettings().treeMinimap);
  const treeViewActionsRef = useRef<TreeViewActions | null>(null);
  // State (not a ref) so the toolbar re-renders when the tree's counts change.
  const [treeViewState, setTreeViewStateRaw] = useState<TreeViewState | null>(null);
  const setTreeViewState = useCallback((next: TreeViewState | null) => {
    setTreeViewStateRaw((prev) =>
      prev === next ||
      (prev !== null &&
        next !== null &&
        prev.hiddenCount === next.hiddenCount &&
        prev.canCollapse === next.canCollapse &&
        prev.minimapShown === next.minimapShown)
        ? prev
        : next
    );
  }, []);
  const setTreeLayoutDirection = useCallback((direction: TreeLayoutDirection) => {
    setTreeLayoutDirectionState(direction);
    saveSettings({ treeLayoutDirection: direction });
  }, []);
  const setTreeMinimap = useCallback((mode: TreeMinimapMode) => {
    setTreeMinimapState(mode);
    saveSettings({ treeMinimap: mode });
  }, []);

  const createPlanSlotFromInput = useCallback((input: string, index: number): PlanSlot => {
    const slot = createEmptySlot(index);

    try {
      const parsed = parseExplainPlan(input);
      // rawInput is only set for a plan that actually loaded; a failed slot
      // keeps the text as its draft so the user can fix it.
      return parsed.rootNode
        ? { ...slot, rawInput: input, draftInput: input, parsedPlan: parsed, error: null }
        : { ...slot, rawInput: '', draftInput: input, parsedPlan: null, error: describeParseFailure(input) };
    } catch (err) {
      return {
        ...slot,
        rawInput: '',
        draftInput: input,
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

  /**
   * Surface a load error. The reducer opens the drawer (where the banner
   * lives); when the drawer was hidden or the canvas maximized, also raise a
   * toast so the failure is never silent. `draft` puts the offending text in
   * the drawer without touching the loaded plan.
   */
  const reportError = useCallback((message: string, options?: { draft?: string }) => {
    const current = stateRef.current;
    const wasHidden = current.inputPanelCollapsed || current.visualizationMaximized;
    if (options?.draft !== undefined) dispatch({ type: 'SET_INPUT', payload: options.draft });
    dispatch({ type: 'SET_ERROR', payload: message });
    if (wasHidden) {
      toastApi.show({ tone: 'error', title: 'Could not load the plan', message });
    }
  }, [toastApi]);

  /**
   * Bundle feedback renders in the input panel; while the canvas is maximized
   * (no input panel) it is also toasted.
   */
  const showBundleNotice = useCallback((notice: BundleNotice) => {
    setBundleNotice(notice);
    if (stateRef.current.visualizationMaximized) {
      toastApi.show({
        tone: notice.tone === 'ok' ? 'success' : notice.tone === 'warn' ? 'warning' : 'error',
        message: notice.text,
      });
    }
  }, [toastApi, setBundleNotice]);

  const dismissBundleNotice = useCallback(() => setBundleNotice(null), [setBundleNotice]);

  const recordRecent = useCallback(
    (entry: { sqlId?: string; planHash?: string; source: ParsedPlan['source']; text: string; label?: string; metadataText?: string }) => {
      const fallback = entry.sqlId ? `SQL_ID ${entry.sqlId}` : `${getSourceDisplayName(entry.source)} plan`;
      // Writes storage and notifies the recent-plans store subscribers.
      addRecentPlan({
        sqlId: entry.sqlId || undefined,
        planHash: entry.planHash || undefined,
        label: entry.label?.trim() || fallback,
        text: entry.text,
        metadataText: entry.metadataText,
      });
    },
    [],
  );

  const importPlanInput = useCallback((input: string, options?: ImportOptions): ImportOutcome => {
    const splitInputs = splitDbmsXplanPlanBatches(input).filter((batch) => batch.trim());
    const shouldReplaceAll = options?.replaceAll ?? splitInputs.length > 1;
    const slots = buildPlanSlotsFromInputs(shouldReplaceAll ? splitInputs : [input]);
    const parsedSlots = slots.filter((slot) => slot.parsedPlan);

    // Curated examples may ship a metadata-bundle sidecar. Parse it once and
    // pair it against the freshly built slots (never the stale reducer state).
    let attachBundle: MetadataBundle | null = null;
    let bundle: ImportOutcome['bundle'] = 'none';
    if (options?.metadataText) {
      try {
        attachBundle = parseBundle(options.metadataText);
      } catch {
        attachBundle = null;
        bundle = 'invalid';
      }
    }

    // Nothing parsed: keep whatever plan is loaded (never overwrite its text)
    // and put the offending text in the drawer next to the error.
    if (parsedSlots.length === 0) {
      reportError(slots[0]?.error ?? describeParseFailure(input), { draft: input });
      return { ok: false, bundle };
    }

    const recent = options?.recent === false ? null : (options?.recent ?? {});

    if (shouldReplaceAll) {
      let plans = slots;
      if (attachBundle) {
        const decision = pairBundleWithSlots(attachBundle, slots);
        if (decision.kind === 'auto-attach') {
          const warning = combineWarnings(decision.warning, emptyBundleWarning(attachBundle));
          plans = slots.map((slot, i) =>
            i === decision.slotIndex
              ? { ...slot, metadataBundle: attachBundle, metadataBundleWarning: warning }
              : slot,
          );
          bundle = 'attached';
        } else {
          bundle = 'unmatched';
          if (decision.kind === 'needs-choice') {
            // Slot indices match: REPLACE_PLANS keeps the new slots in order.
            setPendingBundleChoice({
              bundle: attachBundle,
              reason: decision.reason,
              candidateIndices: decision.candidateIndices,
              resetDraft: false,
            });
          }
        }
      } else if (bundle === 'invalid') {
        showBundleNotice({ tone: 'warn', text: 'The metadata bundle is not valid; the plan loaded without it.' });
      }
      dispatch({ type: 'REPLACE_PLANS', payload: { plans, activePlanIndex: 0 } });
      dispatch({ type: 'CLEAR_ANNOTATIONS' });
      dispatch({ type: 'SET_INPUT_PANEL_COLLAPSED', payload: true });
      const first = parsedSlots[0].parsedPlan;
      if (recent && first) {
        // One entry for the whole paste so reopening restores every tab.
        recordRecent({
          sqlId: first.sqlId,
          planHash: parsedSlots.map((slot) => slot.parsedPlan?.planHashValue ?? '?').join('+'),
          source: first.source,
          text: input,
          label: recent.label ?? `${first.sqlId ? `SQL_ID ${first.sqlId}` : 'Plans'} (${parsedSlots.length} plans)`,
          metadataText: bundle === 'attached' ? options?.metadataText : undefined,
        });
      }
      clearPlanFromUrl({ includeDeepLinks: true });
      return { ok: true, bundle };
    }

    const [slot] = slots;
    if (!slot?.parsedPlan) {
      reportError(slot?.error ?? describeParseFailure(input), { draft: input });
      return { ok: false, bundle };
    }

    dispatch({ type: 'SET_PARSED_PLAN', payload: { plan: slot.parsedPlan, text: input } });
    dispatch({ type: 'SET_INPUT_PANEL_COLLAPSED', payload: true });

    // The single-plan path replaces the active slot's plan in place, so attach
    // the bundle to that same slot once the plan is confirmed to parse.
    if (attachBundle) {
      const decision = pairBundleWithSlots(attachBundle, [slot]);
      if (decision.kind === 'auto-attach') {
        const warning = combineWarnings(decision.warning, emptyBundleWarning(attachBundle));
        dispatch({
          type: 'ATTACH_METADATA_BUNDLE',
          payload: { index: state.activePlanIndex, bundle: attachBundle, warning },
        });
        bundle = 'attached';
      } else {
        bundle = 'unmatched';
        if (decision.kind === 'needs-choice') {
          // SQL_ID mismatch (or none): let the user attach it to this plan anyway.
          setPendingBundleChoice({
            bundle: attachBundle,
            reason: decision.reason,
            candidateIndices: [state.activePlanIndex],
            resetDraft: false,
          });
        }
      }
    } else if (bundle === 'invalid') {
      showBundleNotice({ tone: 'warn', text: 'The metadata bundle is not valid; the plan loaded without it.' });
    }

    if (recent) {
      recordRecent({
        sqlId: slot.parsedPlan.sqlId,
        planHash: slot.parsedPlan.planHashValue,
        source: slot.parsedPlan.source,
        text: input,
        label: recent.label,
        metadataText: bundle === 'attached' ? options?.metadataText : undefined,
      });
    }
    // A plan that came from a share link / deep link has been replaced: make
    // sure a reload does not bring the old one back.
    clearPlanFromUrl({ includeDeepLinks: true });
    return { ok: true, bundle };
  }, [buildPlanSlotsFromInputs, state.activePlanIndex, reportError, recordRecent, showBundleNotice, setPendingBundleChoice]);

  /**
   * Ask before a load discards annotations on the slots it will replace.
   * Resolves true when there is nothing to lose or the user agreed.
   */
  const confirmDiscardAnnotations = useCallback(
    async (slotIndices: number[], action: string): Promise<boolean> => {
      const { plans } = stateRef.current;
      const details = slotIndices
        .map((index) => ({ index, slot: plans[index] }))
        .filter(({ slot }) => slot && hasAnnotations(slot.annotations))
        .map(({ index, slot }) => {
          const label = slot.customLabel || slot.label || getPlanSlotLabel(index);
          const bundleNote = slot.metadataBundle ? ' plus its metadata bundle' : '';
          return `${label}'s ${summarizeAnnotations(slot.annotations)}${bundleNote}`;
        });
      if (details.length === 0) return true;
      return confirm({
        title: 'Discard annotations?',
        message: `${action} replaces the loaded plan and discards ${details.join('; ')}. Use "Save annotated plan" first if you want to keep them.`,
        confirmLabel: 'Discard and continue',
        tone: 'danger',
      });
    },
    [confirm],
  );

  const guardedImport = useCallback(
    async (input: string, action: string, options?: ImportOptions & { skipConfirm?: boolean }): Promise<ImportOutcome | null> => {
      if (!options?.skipConfirm) {
        const ok = await confirmDiscardAnnotations(importTargetIndices(stateRef.current, input), action);
        if (!ok) return null;
      }
      return importPlanInput(input, options);
    },
    [confirmDiscardAnnotations, importPlanInput],
  );

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

  // ---------------------------------------------------------------------------
  // Metadata-bundle attach flow shared by the drawer (paste/Parse), drops and
  // the attach chooser. Feedback goes to `bundleNotice` (see showBundleNotice).
  // ---------------------------------------------------------------------------

  const announceBundleAttached = useCallback((index: number, warning: string | null) => {
    const slot = stateRef.current.plans[index];
    const label = slot?.customLabel || slot?.label || `slot ${index + 1}`;
    showBundleNotice(
      warning
        ? { tone: 'warn', text: `Bundle attached to ${label}, but ${warning}` }
        : { tone: 'ok', text: `Metadata bundle attached to ${label}.` },
    );
  }, [showBundleNotice]);

  /** Put the active slot's draft back to its loaded plan text (after a bundle paste). */
  const resetDraftToLoaded = useCallback(() => {
    const { plans, activePlanIndex } = stateRef.current;
    dispatch({ type: 'SET_INPUT', payload: plans[activePlanIndex]?.rawInput ?? '' });
  }, []);

  /** Ask before a bundle replaces a different bundle already attached to the slot. */
  const confirmReplaceBundle = useCallback(async (index: number, bundle: MetadataBundle): Promise<boolean> => {
    const slot = stateRef.current.plans[index];
    const existing = slot?.metadataBundle;
    if (!slot || !existing) return true;
    if (existing.captured_at === bundle.captured_at && existing.plan_ref.sql_id === bundle.plan_ref.sql_id) {
      return true; // the same bundle again — nothing is lost
    }
    const label = slot.customLabel || slot.label;
    const captured = existing.captured_at ? ` (captured ${existing.captured_at})` : '';
    return confirm({
      title: 'Replace metadata bundle?',
      message: `${label} already has a metadata bundle${captured}. Attaching this one replaces it${
        hasAnnotations(slot.annotations) ? '; your annotations are kept' : ''
      }.`,
      confirmLabel: 'Replace bundle',
    });
  }, [confirm]);

  const attachBundleText = useCallback(
    async (text: string, options?: { resetDraft?: boolean }): Promise<boolean> => {
      let bundle: MetadataBundle;
      try {
        bundle = parseBundle(text);
      } catch (err) {
        showBundleNotice({ tone: 'error', text: err instanceof Error ? err.message : 'Could not parse metadata bundle.' });
        return false;
      }
      const decision = pairBundleWithSlots(bundle, stateRef.current.plans);
      if (decision.kind === 'no-targets') {
        showBundleNotice({ tone: 'error', text: decision.reason });
        return false;
      }
      if (decision.kind === 'needs-choice') {
        // Resolve once the user has picked a plan (or cancelled) in the
        // chooser, so callers can react to the real outcome.
        return new Promise<boolean>((resolve) => {
          setPendingBundleChoice({
            bundle,
            reason: decision.reason,
            candidateIndices: decision.candidateIndices,
            resetDraft: Boolean(options?.resetDraft),
          });
          pendingBundleResolverRef.current = resolve;
        });
      }
      if (!(await confirmReplaceBundle(decision.slotIndex, bundle))) {
        showBundleNotice({ tone: 'warn', text: 'Bundle attach cancelled.' });
        return false;
      }
      const warning = combineWarnings(decision.warning, emptyBundleWarning(bundle));
      dispatch({ type: 'ATTACH_METADATA_BUNDLE', payload: { index: decision.slotIndex, bundle, warning } });
      announceBundleAttached(decision.slotIndex, warning);
      if (options?.resetDraft) resetDraftToLoaded();
      return true;
    },
    [showBundleNotice, confirmReplaceBundle, announceBundleAttached, resetDraftToLoaded, setPendingBundleChoice],
  );

  const resolveBundleChoice = useCallback(
    async (index: number | null) => {
      const pending = pendingBundleChoice;
      if (!pending) return;
      // Taken before clearing the choice, so clearing does not settle it early.
      const settle = takePendingBundleResolver();
      setPendingBundleChoice(null);
      if (index === null) {
        showBundleNotice({ tone: 'warn', text: 'Bundle attach cancelled.' });
        settle?.(false);
        return;
      }
      if (!(await confirmReplaceBundle(index, pending.bundle))) {
        showBundleNotice({ tone: 'warn', text: 'Bundle attach cancelled.' });
        settle?.(false);
        return;
      }
      const result = attachMetadataBundleToSlot(pending.bundle, index);
      if (result.ok) {
        announceBundleAttached(index, result.warning);
        if (pending.resetDraft) resetDraftToLoaded();
      } else {
        showBundleNotice({ tone: 'error', text: result.error });
      }
      settle?.(result.ok);
    },
    [pendingBundleChoice, showBundleNotice, confirmReplaceBundle, attachMetadataBundleToSlot, announceBundleAttached, resetDraftToLoaded, setPendingBundleChoice, takePendingBundleResolver],
  );

  // Derive active slot values for backward compatibility
  const activeSlot = state.plans[state.activePlanIndex];
  const rawInput = activeSlot.rawInput;
  const draftInput = activeSlot.draftInput ?? activeSlot.rawInput;
  const parsedPlan = activeSlot.parsedPlan;
  const selectedNodeId = activeSlot.selectedNodeId;
  const selectedNodeIds = activeSlot.selectedNodeIds;
  const error = activeSlot.error;
  const metadataBundle = activeSlot.metadataBundle;
  const metadataBundleWarning = activeSlot.metadataBundleWarning;

  // The popout only makes sense while its active slot still carries a bundle
  // (detach, plan-slot switch to a bundle-less slot, or a fresh plan replacing
  // this one all qualify) — close it rather than leaving a stale placeholder.
  // Adjusted during render (not via useEffect+setState) by tracking the
  // previous value in state, per React's guidance for state that should
  // mirror another value ("you might not need an effect").
  if (metadataBundle !== prevMetadataBundle) {
    setPrevMetadataBundle(metadataBundle);
    if (metadataPopoutOpen && !metadataBundle) {
      setMetadataPopoutOpen(false);
    }
  }

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

  // Apply theme + app palette to document
  useEffect(() => {
    const root = document.documentElement;
    if (state.theme === 'dark') {
      root.classList.add('dark');
    } else {
      root.classList.remove('dark');
    }
    // 'slate' is the built-in look: drop the attribute so no palette block matches.
    if (state.palette === 'slate') {
      delete root.dataset.palette;
    } else {
      root.dataset.palette = state.palette;
    }
    localStorage.setItem('theme', state.theme);
  }, [state.theme, state.palette]);

  // Load plan from URL param or default example on first mount
  const hasLoadedDefaultRef = useRef(false);

  const applyUrlPlanData = useCallback((urlData: UrlPlanData) => {
    if (urlData.type === 'legacy') {
      importPlanInput(urlData.planText);
    } else {
      const { plans, annotations: legacyAnnotations } = urlData.payload;
      const restoredPlans = buildPlanSlotsFromInputs(plans.map((plan) => plan.rawInput));

      // Restore per-plan annotations and metadata bundles from URL
      for (let i = 0; i < restoredPlans.length && i < plans.length; i++) {
        const planAnnotations = plans[i].annotations;
        if (planAnnotations) {
          try {
            restoredPlans[i] = { ...restoredPlans[i], annotations: deserializeAnnotations(planAnnotations) };
          } catch {
            // Per-plan annotations failed to deserialize
          }
        }
        const sharedBundle = plans[i].metadataBundle;
        if (sharedBundle && restoredPlans[i].parsedPlan) {
          try {
            const bundle = parseBundle(JSON.stringify(sharedBundle));
            restoredPlans[i] = {
              ...restoredPlans[i],
              metadataBundle: bundle,
              metadataBundleWarning: restoredBundleWarning(bundle, restoredPlans[i].parsedPlan),
            };
          } catch {
            // A broken bundle must not block the shared plan itself.
          }
        }
      }

      dispatch({ type: 'REPLACE_PLANS', payload: { plans: restoredPlans, activePlanIndex: 0 } });
      const parsedCount = restoredPlans.filter((slot) => slot.parsedPlan).length;
      dispatch({
        type: 'SET_INPUT_PANEL_COLLAPSED',
        payload: parsedCount > 0,
      });
      const sharedView = restorableViewMode(getSharedViewMode(urlData.payload), parsedCount);
      if (sharedView) {
        dispatch({ type: 'SET_VIEW_MODE', payload: sharedView });
      }
      for (const slot of restoredPlans) {
        if (!slot.parsedPlan) continue;
        recordRecent({
          sqlId: slot.parsedPlan.sqlId,
          planHash: slot.parsedPlan.planHashValue,
          source: slot.parsedPlan.source,
          text: slot.rawInput,
          metadataText: slot.metadataBundle ? JSON.stringify(slot.metadataBundle) : undefined,
        });
      }

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
  }, [buildPlanSlotsFromInputs, importPlanInput, recordRecent]);

  // ---------------------------------------------------------------------------
  // Session autosave / restore (localStorage only; see lib/session.ts)
  // ---------------------------------------------------------------------------

  const restoreSession = useCallback((saved: SavedSession): boolean => {
    const slots: PlanSlot[] = [];
    let activeIndex = 0;
    saved.slots.forEach((savedSlot, savedIndex) => {
      const built = createPlanSlotFromInput(savedSlot.text, slots.length);
      if (!built.parsedPlan) return;
      if (savedIndex === saved.activePlanIndex) activeIndex = slots.length;
      let slot: PlanSlot = { ...built, customLabel: savedSlot.customLabel };
      if (savedSlot.annotations) {
        try {
          slot = { ...slot, annotations: deserializeAnnotations(savedSlot.annotations) };
        } catch {
          // keep the plan without its annotations
        }
      }
      if (savedSlot.metadataText) {
        try {
          const bundle = parseBundle(savedSlot.metadataText);
          slot = { ...slot, metadataBundle: bundle, metadataBundleWarning: restoredBundleWarning(bundle, slot.parsedPlan) };
        } catch {
          // keep the plan without its bundle
        }
      }
      slots.push(slot);
    });
    if (slots.length === 0) return false;
    dispatch({ type: 'REPLACE_PLANS', payload: { plans: slots, activePlanIndex: activeIndex } });
    dispatch({ type: 'SET_INPUT_PANEL_COLLAPSED', payload: true });
    const view = restorableViewMode(saved.viewMode, slots.length);
    if (view) dispatch({ type: 'SET_VIEW_MODE', payload: view });
    return true;
  }, [createPlanSlotFromInput]);

  const persistSessionNow = useCallback(() => {
    const session = buildSavedSession(stateRef.current);
    if (sharedContentRef.current !== null && sessionContentSignature(session) !== sharedContentRef.current) {
      sharedContentRef.current = null;
      clearPlanFromUrl();
    }
    // Compare without the timestamp so selection-only changes don't rewrite storage.
    const signature = JSON.stringify({ ...session, savedAt: '' });
    if (signature === lastSavedSessionRef.current) return;
    const result = saveSession(session);
    // Remember oversized payloads too, so the skip is logged once per change.
    if (result.ok || result.reason === 'too-large') lastSavedSessionRef.current = signature;
  }, []);

  /** Clear the workspace and the saved session ("Start fresh"). */
  const startFresh = useCallback(async (): Promise<boolean> => {
    const { plans } = stateRef.current;
    const ok = await confirmDiscardAnnotations(plans.map((_, index) => index), 'Starting fresh');
    if (!ok) return false;
    clearSession();
    lastSavedSessionRef.current = null;
    dispatch({ type: 'REPLACE_PLANS', payload: { plans: [], activePlanIndex: 0 } });
    clearPlanFromUrl({ includeDeepLinks: true });
    return true;
  }, [confirmDiscardAnnotations]);

  // Debounced autosave of plans, labels, bundles, annotations and the view.
  useEffect(() => {
    if (!sessionReadyRef.current) return;
    const timer = setTimeout(persistSessionNow, 1000);
    return () => clearTimeout(timer);
  }, [state.plans, state.activePlanIndex, state.viewMode, persistSessionNow]);

  // Flush pending changes when the page goes away (the debounce may not have fired).
  // Another tab of the app writing the same key invalidates our "already saved"
  // marker, so the flush re-asserts this tab's state: the tab you reload is the
  // one that comes back.
  useEffect(() => {
    const flush = () => {
      if (sessionReadyRef.current) persistSessionNow();
    };
    const onStorage = (event: StorageEvent) => {
      if (event.key === SESSION_KEY || event.key === null) lastSavedSessionRef.current = null;
    };
    window.addEventListener('pagehide', flush);
    window.addEventListener('storage', onStorage);
    return () => {
      window.removeEventListener('pagehide', flush);
      window.removeEventListener('storage', onStorage);
    };
  }, [persistSessionNow]);

  // Annotations are the one thing a reload can't rebuild from the plan text:
  // ask before leaving while any slot has some.
  const anySlotHasAnnotations = state.plans.some((slot) => hasAnnotations(slot.annotations));
  useEffect(() => {
    if (!anySlotHasAnnotations) return;
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      // Legacy browsers only show the prompt when returnValue is set.
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [anySlotHasAnnotations]);

  useEffect(() => {
    if (hasLoadedDefaultRef.current) return;
    hasLoadedDefaultRef.current = true;
    // From here on state changes are autosaved (restore below happens first).
    sessionReadyRef.current = true;

    // Check URL for shared plan first (legacy ?plan= wins for back-compat)
    const urlData = getPlanFromUrl();
    if (urlData) {
      clearPlanFromUrl();
      applyUrlPlanData(urlData);
      return;
    }

    // New gzip hash-fragment format. Effect stays synchronous; decode is a
    // guarded fire-and-forget promise. StrictMode double-mount is already
    // handled by hasLoadedDefaultRef being set before any async work.
    const gzParam = getGzipPlanParamFromHash();
    if (gzParam) {
      clearPlanFromUrl();
      void decodeGzipPlanParam(gzParam)
        .then((text) => applyUrlPlanData(classifyDecodedPlanText(text)))
        .catch(() => dispatch({
          type: 'SET_ERROR',
          payload: 'The shared plan link is corrupt or truncated. Ask for a fresh link or paste the plan text directly.',
        }));
      return;
    }

    // Marketing/deep-link params: `?example=<name>` and `?view=<tab>`.
    // Applied only when there's no shared-plan URL to restore (handled above).
    if (typeof window === 'undefined') return;
    const params = new URLSearchParams(window.location.search);

    let loadedFromUrl = false;
    const exampleParam = params.get('example');
    if (exampleParam) {
      const sample = findSampleByUrlParam(exampleParam);
      if (sample) {
        importPlanInput(sample.data, { metadataText: sample.metadata, recent: false });
        loadedFromUrl = true;
      }
      // No match: ignore silently, normal empty-state startup.
    }

    // No plan in the URL: bring back the previous session, if any.
    if (!loadedFromUrl) {
      const saved = loadSession();
      if (saved && restoreSession(saved)) {
        toastApi.show({
          tone: 'info',
          message: 'Restored your previous session',
          duration: 8000,
          action: { label: 'Start fresh', onClick: () => { void startFresh(); } },
        });
      }
    }

    const viewParam = params.get('view');
    if (viewParam) {
      const mode = parseViewModeFromUrlParam(viewParam);
      // `compare` requires two loaded plans and is intentionally not supported via URL param.
      if (mode && mode !== 'compare') {
        dispatch({ type: 'SET_VIEW_MODE', payload: mode });
      }
    }
  }, [applyUrlPlanData, importPlanInput, restoreSession, startFresh, toastApi]);

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
        experimentalSubView: state.experimentalSubView,
        nodeIndicatorMetric: state.nodeIndicatorMetric,
        colorScheme: state.colorScheme,
        palette: state.palette,
        highlightStyle: state.highlightStyle,
        highlightBrushColor: state.highlightBrushColor,
        hotspotsEnabled: state.hotspotsEnabled,
        showAdvisorSuggestions: state.showAdvisorSuggestions,
        legendVisible: state.legendVisible,
        inputPanelCollapsed: state.inputPanelCollapsed,
        filterPanelCollapsed: state.filterPanelCollapsed,
        focusMode: state.focusMode,
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
    state.experimentalSubView,
    state.nodeIndicatorMetric,
    state.colorScheme,
    state.palette,
    state.highlightStyle,
    state.highlightBrushColor,
    state.hotspotsEnabled,
    state.showAdvisorSuggestions,
    state.legendVisible,
    state.inputPanelCollapsed,
    state.filterPanelCollapsed,
    state.focusMode,
    state.compareMetrics,
    state.filters,
  ]);

  const setInput = useCallback((input: string) => {
    dispatch({ type: 'SET_INPUT', payload: input });
  }, []);

  const parsePlan = useCallback(async (text?: string) => {
    const { plans, activePlanIndex } = stateRef.current;
    const slot = plans[activePlanIndex];
    const draft = text ?? slot?.draftInput ?? slot?.rawInput ?? '';
    if (!draft.trim()) return;
    // A pasted gather-script output is not a plan — route it to the bundle
    // pipeline; on success the drawer goes back to showing the plan text.
    if (looksLikeMetadataBundle(draft)) {
      await attachBundleText(draft, { resetDraft: true });
      return;
    }
    // Unchanged text: nothing to re-parse, and nothing to throw away.
    if (slot?.parsedPlan && draft.trim() === slot.rawInput.trim()) {
      dispatch({ type: 'SET_ERROR', payload: null });
      dispatch({ type: 'SET_INPUT_PANEL_COLLAPSED', payload: true });
      return;
    }
    await guardedImport(draft, 'Parsing the new text');
  }, [attachBundleText, guardedImport]);

  const loadAndParsePlan = useCallback(
    async (input: string, metadataText?: string, options?: LoadPlanOptions): Promise<boolean> => {
      const outcome = await guardedImport(input, options?.label ? `Loading "${options.label}"` : 'Loading this plan', {
        metadataText,
        recent: options?.recordRecent === false ? false : { label: options?.label },
        skipConfirm: options?.skipConfirm,
      });
      return Boolean(outcome?.ok);
    },
    [guardedImport],
  );

  const loadExample = useCallback(async (sample: SamplePlan): Promise<boolean> => {
    const outcome = await guardedImport(sample.data, `Loading the "${sample.name}" example`, {
      metadataText: sample.metadata,
      recent: false,
    });
    return Boolean(outcome?.ok);
  }, [guardedImport]);

  const openRecentPlan = useCallback(async (entry: RecentPlan): Promise<boolean> => {
    const outcome = await guardedImport(entry.text, `Opening "${entry.label}"`, {
      metadataText: entry.metadataText,
      recent: { label: entry.label },
    });
    return Boolean(outcome?.ok);
  }, [guardedImport]);

  const removeRecentPlan = useCallback((id: string) => {
    removeRecentPlanFromStorage(id);
  }, []);

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

  const setExperimentalSubView = useCallback((view: ExperimentalSubView) => {
    dispatch({ type: 'SET_EXPERIMENTAL_SUB_VIEW', payload: view });
  }, []);

  const setNodeIndicatorMetric = useCallback((metric: NodeIndicatorMetric) => {
    dispatch({ type: 'SET_NODE_INDICATOR_METRIC', payload: metric });
  }, []);

  const setColorScheme = useCallback((scheme: ColorScheme) => {
    dispatch({ type: 'SET_COLOR_SCHEME', payload: scheme });
  }, []);

  const setPalette = useCallback((palette: AppPalette) => {
    dispatch({ type: 'SET_PALETTE', payload: palette });
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
    // Don't let a reload resurrect the cleared plan from a share/deep link.
    clearPlanFromUrl({ includeDeepLinks: true });
  }, []);

  const requestClearPlan = useCallback(async (): Promise<boolean> => {
    const { plans, activePlanIndex } = stateRef.current;
    const slot = plans[activePlanIndex];
    if (slot?.parsedPlan) {
      const label = slot.customLabel || slot.label;
      const annotated = hasAnnotations(slot.annotations);
      const extras = [
        annotated ? summarizeAnnotations(slot.annotations) : null,
        slot.metadataBundle ? 'its metadata bundle' : null,
      ].filter((part): part is string => part !== null);
      const ok = await confirm({
        title: `Clear ${label}?`,
        message: `This removes the loaded plan${extras.length > 0 ? ` together with ${extras.join(' and ')}` : ''} from the workspace.${
          annotated ? ' Use "Save annotated plan" first if you want to keep your annotations.' : ''
        }`,
        confirmLabel: 'Clear plan',
        tone: 'danger',
      });
      if (!ok) return false;
    }
    clearPlan();
    return true;
  }, [confirm, clearPlan]);

  const setHighlightStyle = useCallback((style: HighlightStyle) => {
    dispatch({ type: 'SET_HIGHLIGHT_STYLE', payload: style });
  }, []);

  const highlightBrush = useMemo<HighlightBrush>(
    () => ({ color: state.highlightBrushColor, style: state.highlightStyle }),
    [state.highlightBrushColor, state.highlightStyle],
  );

  const setHighlightBrush = useCallback((patch: Partial<HighlightBrush>) => {
    dispatch({ type: 'SET_HIGHLIGHT_BRUSH', payload: patch });
  }, []);

  const setHotspotsEnabled = useCallback((enabled: boolean) => {
    dispatch({ type: 'SET_HOTSPOTS_ENABLED', payload: enabled });
  }, []);

  const setShowAdvisorSuggestions = useCallback((enabled: boolean) => {
    dispatch({ type: 'SET_ADVISOR_SUGGESTIONS', payload: enabled });
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

  const setFocusMode = useCallback((enabled: boolean) => {
    dispatch({ type: 'SET_FOCUS_MODE', payload: enabled });
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
    dispatch({ type: 'REMOVE_NODE_ANNOTATION', payload: { nodeId } });
  }, []);

  const setNodeHighlight = useCallback((nodeId: number, color: HighlightColor, style?: HighlightStyle) => {
    dispatch({ type: 'SET_NODE_HIGHLIGHT', payload: { nodeId, color, style } });
  }, []);

  const removeNodeHighlight = useCallback((nodeId: number) => {
    dispatch({ type: 'REMOVE_NODE_HIGHLIGHT', payload: { nodeId } });
  }, []);

  const setNodeAnnotationForPlan = useCallback((planIndex: number, nodeId: number, text: string) => {
    dispatch({ type: 'SET_NODE_ANNOTATION', payload: { nodeId, text, planIndex } });
  }, []);

  const removeNodeAnnotationForPlan = useCallback((planIndex: number, nodeId: number) => {
    dispatch({ type: 'REMOVE_NODE_ANNOTATION', payload: { nodeId, planIndex } });
  }, []);

  const setNodeHighlightForPlan = useCallback(
    (planIndex: number, nodeId: number, color: HighlightColor, style?: HighlightStyle) => {
      dispatch({ type: 'SET_NODE_HIGHLIGHT', payload: { nodeId, color, style, planIndex } });
    },
    [],
  );

  const removeNodeHighlightForPlan = useCallback((planIndex: number, nodeId: number) => {
    dispatch({ type: 'REMOVE_NODE_HIGHLIGHT', payload: { nodeId, planIndex } });
  }, []);

  const paintNodeWithBrush = useCallback((planIndex: number, nodeId: number) => {
    dispatch({ type: 'PAINT_NODE_HIGHLIGHT', payload: { planIndex, nodeId } });
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

  const requestClearAnnotations = useCallback(async (): Promise<boolean> => {
    const { plans, activePlanIndex } = stateRef.current;
    const slot = plans[activePlanIndex];
    if (!slot || !hasAnnotations(slot.annotations)) return true;
    const ok = await confirm({
      title: 'Clear annotations?',
      message: `This removes ${summarizeAnnotations(slot.annotations)} from ${slot.customLabel || slot.label}.`,
      confirmLabel: 'Clear annotations',
      tone: 'danger',
    });
    if (ok) dispatch({ type: 'CLEAR_ANNOTATIONS' });
    return ok;
  }, [confirm]);

  const requestRemovePlanSlot = useCallback(async (index: number): Promise<boolean> => {
    const slot = stateRef.current.plans[index];
    if (!slot) return false;
    if (slot.parsedPlan) {
      const label = slot.customLabel || slot.label;
      const extras = [
        hasAnnotations(slot.annotations) ? summarizeAnnotations(slot.annotations) : null,
        slot.metadataBundle ? 'its metadata bundle' : null,
      ].filter((part): part is string => part !== null);
      const ok = await confirm({
        title: `Remove ${label}?`,
        message: `This closes the tab and discards its plan${extras.length > 0 ? ` together with ${extras.join(' and ')}` : ''}.`,
        confirmLabel: 'Remove plan',
        tone: 'danger',
      });
      if (!ok) return false;
    }
    dispatch({ type: 'REMOVE_PLAN_SLOT', payload: index });
    return true;
  }, [confirm]);

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

  /**
   * Load an already-validated annotated-plan export into the active slot (no
   * confirmation — callers ask first). `extraBundleText` is a bundle dropped
   * alongside an export that does not embed one.
   */
  const importAnnotatedData = useCallback(
    (data: AnnotatedPlanExport, options?: { label?: string; extraBundleText?: string }): boolean => {
      let parsed: ParsedPlan;
      try {
        parsed = parseExplainPlan(data.rawPlanText);
      } catch (err) {
        reportError(`Import error: ${err instanceof Error ? err.message : 'Unknown error'}`);
        return false;
      }
      if (!parsed.rootNode) {
        reportError(`Could not parse the plan inside the annotated file. ${describeParseFailure(data.rawPlanText)}`);
        return false;
      }
      dispatch({ type: 'SET_PARSED_PLAN', payload: { plan: parsed, text: data.rawPlanText } });
      dispatch({ type: 'SET_INPUT_PANEL_COLLAPSED', payload: true });
      // Load annotations after plan is set (SET_PARSED_PLAN clears them first)
      try {
        dispatch({ type: 'LOAD_ANNOTATIONS', payload: deserializeAnnotations(data.annotations) });
      } catch {
        showBundleNotice({ tone: 'warn', text: 'Imported the plan, but its annotations could not be read.' });
      }

      const index = state.activePlanIndex;
      let bundleText: string | undefined;
      if (data.version === 2 && data.metadataBundle !== undefined) {
        // v2+: embedded metadata bundle
        try {
          const bundle = parseBundle(JSON.stringify(data.metadataBundle));
          dispatch({ type: 'ATTACH_METADATA_BUNDLE', payload: { index, bundle, warning: null } });
          bundleText = JSON.stringify(data.metadataBundle);
        } catch (err) {
          reportError(
            `Imported plan, but embedded metadata bundle is invalid: ${err instanceof Error ? err.message : 'Unknown error'}`,
          );
        }
      } else if (options?.extraBundleText) {
        try {
          const bundle = parseBundle(options.extraBundleText);
          const decision = pairBundleWithSlots(bundle, [{ ...createEmptySlot(0), parsedPlan: parsed }]);
          if (decision.kind === 'auto-attach') {
            const warning = combineWarnings(decision.warning, emptyBundleWarning(bundle));
            dispatch({ type: 'ATTACH_METADATA_BUNDLE', payload: { index, bundle, warning } });
            bundleText = options.extraBundleText;
          } else if (decision.kind === 'needs-choice') {
            setPendingBundleChoice({ bundle, reason: decision.reason, candidateIndices: [index], resetDraft: false });
          }
        } catch (err) {
          showBundleNotice({ tone: 'warn', text: err instanceof Error ? err.message : 'Could not parse metadata bundle.' });
        }
      }

      recordRecent({
        sqlId: parsed.sqlId,
        planHash: parsed.planHashValue,
        source: parsed.source,
        text: data.rawPlanText,
        label: options?.label,
        metadataText: bundleText,
      });
      clearPlanFromUrl({ includeDeepLinks: true });
      return true;
    },
    [state.activePlanIndex, reportError, showBundleNotice, recordRecent, setPendingBundleChoice],
  );

  const importAnnotatedPlan = useCallback(async (file: File) => {
    let data: unknown;
    try {
      data = JSON.parse(await file.text());
    } catch (err) {
      reportError(`Import error: ${err instanceof Error ? err.message : 'Unknown error'}`);
      return;
    }
    if (!validateExport(data)) {
      reportError('Not a valid annotated-plan file. Expected the JSON exported via "Save annotated plan".');
      return;
    }
    const ok = await confirmDiscardAnnotations([stateRef.current.activePlanIndex], `Importing "${file.name}"`);
    if (!ok) return;
    importAnnotatedData(data, { label: file.name });
  }, [reportError, confirmDiscardAnnotations, importAnnotatedData]);

  /** Drop / file-picker entry point: plan, bundle, annotated export, or a mix. */
  const loadFiles = useCallback(async (files: File[]) => {
    if (files.length === 0) return;
    const { files: texts, errors } = await readDroppedFiles(files);
    if (texts.length === 0) {
      reportError(errors[0] ?? 'Could not read the dropped file.');
      return;
    }
    const drop = planDrop(texts);
    switch (drop.action) {
      case 'error':
        reportError(drop.message);
        return;
      case 'load-plan': {
        const outcome = await guardedImport(drop.text, `Loading "${drop.name}"`, {
          metadataText: drop.bundleText,
          recent: { label: drop.name },
        });
        if (!outcome?.ok) return;
        if (drop.bundleText && outcome.bundle === 'attached') {
          showBundleNotice({ tone: 'ok', text: `Loaded "${drop.name}" with metadata bundle "${drop.bundleName}".` });
        }
        break;
      }
      case 'import-annotated': {
        const ok = await confirmDiscardAnnotations([stateRef.current.activePlanIndex], `Importing "${drop.name}"`);
        if (!ok) return;
        const embedsBundle = drop.data.version === 2 && drop.data.metadataBundle !== undefined;
        if (!importAnnotatedData(drop.data, { label: drop.name, extraBundleText: embedsBundle ? undefined : drop.bundleText })) {
          return;
        }
        if (embedsBundle && drop.bundleName) drop.ignored.push(drop.bundleName);
        break;
      }
      case 'attach-bundle':
        await attachBundleText(drop.text);
        break;
    }
    const notes = [
      ...(drop.ignored.length > 0
        ? [`Not used: ${drop.ignored.join(', ')} — a drop loads one plan plus an optional metadata bundle.`]
        : []),
      ...errors,
    ];
    if (notes.length > 0) {
      toastApi.show({ tone: 'info', title: 'Some files were not used', message: notes.join(' ') });
    }
  }, [reportError, guardedImport, showBundleNotice, confirmDiscardAnnotations, importAnnotatedData, attachBundleText, toastApi]);

  const sharePlan = useCallback(async (): Promise<{ ok: true; url: string; warning?: string; copied: boolean } | { ok: false; error: string }> => {
    // Only loaded plans are shared (rawInput is the loaded text, never a draft).
    const slotsWithInput = state.plans.filter(slot => slot.rawInput && slot.parsedPlan);
    if (slotsWithInput.length === 0) {
      return { ok: false, error: 'No plan to share.' };
    }

    const entries: SharePlanEntry[] = slotsWithInput.map((slot) => ({
      rawInput: slot.rawInput,
      ...(hasAnnotations(slot.annotations) ? { annotations: serializeAnnotations(slot.annotations) } : {}),
      ...(slot.metadataBundle ? { metadataBundle: slot.metadataBundle } : {}),
    }));

    // Full payload (incl. bundles + active view) → without bundles when the
    // link would pass ~32k chars → stripped SQL Monitor XML as a last resort.
    const result = await buildShareLink(entries, { viewMode: state.viewMode });
    const warning = result.ok && result.warnings.length > 0 ? result.warnings.join(' ') : undefined;

    if (result.ok) {
      window.history.replaceState(null, '', result.url);
      // Remember what the address-bar link encodes; once the plans or their
      // annotations change, the autosave drops the (now stale) link so a
      // reload restores the session instead of the older shared snapshot.
      sharedContentRef.current = sessionContentSignature(buildSavedSession(stateRef.current));
      // Robust copy with an execCommand fallback for insecure (HTTP) origins and
      // unfocused documents. `copied` is surfaced so the UI can offer a reliable
      // manual-copy affordance instead of falsely claiming success.
      const copied = await copyToClipboard(result.url);
      return { ok: true, url: result.url, warning, copied };
    }
    return result;
  }, [state.plans, state.viewMode]);

  // Perform a share and publish the outcome as a dismissable notice, so every
  // entry point (header button, command palette) gives consistent, recoverable
  // feedback — especially when the clipboard write is blocked.
  const share = useCallback(async () => {
    const result = await sharePlan();
    if (!result.ok) {
      setShareNotice({ kind: 'error', message: result.error });
      return;
    }
    if (!result.copied) {
      setShareNotice({ kind: 'manual', url: result.url, warning: result.warning });
    } else if (result.warning) {
      setShareNotice({ kind: 'warning', url: result.url, warning: result.warning });
    } else {
      setShareNotice({ kind: 'copied', url: result.url });
    }
  }, [sharePlan]);

  const dismissShareNotice = useCallback(() => setShareNotice(null), []);

  // The clean "copied" confirmation is transient; manual/warning/error notices
  // stay put until dismissed, since the user still needs to act on them.
  useEffect(() => {
    if (shareNotice?.kind !== 'copied') return;
    const timer = setTimeout(() => setShareNotice(null), 2500);
    return () => clearTimeout(timer);
  }, [shareNotice]);

  const getSelectedNode = useCallback((): PlanNode | null => selectedNode, [selectedNode]);

  const getFilteredNodes = useCallback((): PlanNode[] => filteredNodes, [filteredNodes]);

  const value: PlanContextValue = {
    // Backward-compatible derived values
    rawInput,
    draftInput,
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
    experimentalSubView: state.experimentalSubView,
    nodeIndicatorMetric: state.nodeIndicatorMetric,
    colorScheme: state.colorScheme,
    palette: state.palette,
    theme: state.theme,
    filters: state.filters,
    legendVisible: state.legendVisible,
    inputPanelCollapsed: state.inputPanelCollapsed,
    filterPanelCollapsed: state.filterPanelCollapsed,
    detailPanelCollapsed: state.detailPanelCollapsed,
    focusMode: state.focusMode,
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
    loadExample,
    loadFiles,
    attachBundleText,
    bundleNotice,
    dismissBundleNotice,
    pendingBundleChoice,
    resolveBundleChoice,
    requestClearPlan,
    requestClearAnnotations,
    requestRemovePlanSlot,
    recentPlans,
    openRecentPlan,
    removeRecentPlan,
    startFresh,
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
    setExperimentalSubView,
    setNodeIndicatorMetric,
    setColorScheme,
    setPalette,
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
    highlightBrush,
    setHighlightBrush,
    hotspotsEnabled: state.hotspotsEnabled,
    setHotspotsEnabled,
    showAdvisorSuggestions: state.showAdvisorSuggestions,
    setShowAdvisorSuggestions,
    setLegendVisible,
    densitySelection,
    applyDensityPreset,
    commandPaletteOpen,
    setCommandPaletteOpen,
    shortcutsOverlayOpen,
    setShortcutsOverlayOpen,
    metadataPopoutOpen,
    setMetadataPopoutOpen,
    baselineDialogOpen,
    setBaselineDialogOpen,
    reportDialogOpen,
    setReportDialogOpen,
    connectPanelOpen,
    setConnectPanelOpen,
    setInputPanelCollapsed,
    setFilterPanelCollapsed,
    setDetailPanelCollapsed,
    setFocusMode,
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
    setNodeAnnotationForPlan,
    removeNodeAnnotationForPlan,
    setNodeHighlightForPlan,
    removeNodeHighlightForPlan,
    paintNodeWithBrush,
    addAnnotationGroup,
    updateAnnotationGroup,
    removeAnnotationGroup,
    exportAnnotatedPlan,
    importAnnotatedPlan,
    clearAnnotations,

    // Share URL
    sharePlan,
    share,
    shareNotice,
    dismissShareNotice,

    // Export PNG
    exportPngFnRef,

    // Tree view layout
    treeLayoutDirection,
    setTreeLayoutDirection,
    treeMinimap,
    setTreeMinimap,
    treeViewActionsRef,
    treeViewState,
    setTreeViewState,
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
