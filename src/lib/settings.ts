import type { FilterState, ViewMode, SankeyMetric, FlameMetric, ExperimentalSubView, NodeIndicatorMetric, NodeDisplayOptions, ColorScheme } from './types';
import type { CompareMetric } from './compare';
import type { HighlightStyle } from './annotations';
import type { AiProviderId, AiSectionId } from './ai/types';
import { DEFAULT_ANTHROPIC_MODEL } from './ai/prompts';

const SETTINGS_KEY = 'ora-explain-viz-settings';
const SETTINGS_VERSION = 1;

/**
 * User settings that persist across sessions.
 * Note: We don't persist searchText, minCost slider values, operation/predicate
 * type filters, or raw input data since those are typically session-specific.
 */
export interface UserSettings {
  version: number;

  // View settings
  viewMode: ViewMode;
  sankeyMetric: SankeyMetric;
  flameMetric: FlameMetric;
  experimentalSubView: ExperimentalSubView;
  nodeIndicatorMetric: NodeIndicatorMetric;
  colorScheme: ColorScheme;

  // UI panel states
  legendVisible: boolean;
  inputPanelCollapsed: boolean;
  filterPanelCollapsed: boolean;

  // Filter display options (checkboxes)
  animateEdges: boolean;
  scaleEdgeWidth: boolean;
  focusSelection: boolean;
  nodeDisplayOptions: NodeDisplayOptions;

  // Hotspots
  hotspotsEnabled: boolean;

  // Advisor suggestion hints (the "consider…" recommendation lines on findings)
  showAdvisorSuggestions: boolean;

  // Comparison metrics
  compareMetrics: CompareMetric[];

  // Highlight style
  highlightStyle: HighlightStyle;

  // AI analysis (non-secret preferences; keys live in sessionStorage — see lib/ai/secrets.ts)
  aiProvider: AiProviderId;
  aiAnthropicModel: string;
  aiOpenAiBaseUrl: string;
  aiOpenAiModel: string;
  aiSections: Record<AiSectionId, boolean>;
}

export const defaultNodeDisplayOptions: NodeDisplayOptions = {
  showRows: true,
  showCost: true,
  showBytes: true,
  showObjectName: true,
  showPredicateIndicators: true,
  showPredicateDetails: true,
  showPartitionInfo: true,
  showQueryBlockBadge: true,
  showQueryBlockGrouping: true,
  showActualRows: true,
  showActualTime: true,
  showStarts: true,
  showHotspotBadge: true,
  showSpillBadge: true,
  showCardinalityBadge: true,
  showAdvisorBadge: true,
  showStaleStatsBadge: true,
  showMissingStatsBadge: true,
  showMismatchNoHistogramBadge: true,
  showAnnotations: true,
};

export const defaultAiSections: Record<AiSectionId, boolean> = {
  sql: true,
  predicates: true,
  notes: true,
  binds: true,
  monitorMeta: true,
  ash: true,
  signals: true,
  advisor: true,
  metadata: true,
};

const VALID_COLOR_SCHEMES: ColorScheme[] = ['contrast', 'semantic', 'estact', 'rail', 'ticker'];
const VALID_EXPERIMENTAL_SUB_VIEWS: ExperimentalSubView[] = ['scatter', 'timeline', 'waterfall', 'morph', 'waits'];

const defaultSettings: UserSettings = {
  version: SETTINGS_VERSION,
  viewMode: 'hierarchical',
  sankeyMetric: 'rows',
  flameMetric: 'actualTime',
  experimentalSubView: 'scatter',
  nodeIndicatorMetric: 'cost',
  colorScheme: 'semantic',
  hotspotsEnabled: true,
  showAdvisorSuggestions: false,
  legendVisible: false,
  inputPanelCollapsed: false,
  filterPanelCollapsed: false,
  animateEdges: false,
  scaleEdgeWidth: true,
  focusSelection: true,
  nodeDisplayOptions: defaultNodeDisplayOptions,
  compareMetrics: ['cost', 'actualRows', 'actualTime'],
  highlightStyle: 'circle',
  aiProvider: 'anthropic',
  aiAnthropicModel: DEFAULT_ANTHROPIC_MODEL,
  aiOpenAiBaseUrl: '',
  aiOpenAiModel: '',
  aiSections: defaultAiSections,
};

/**
 * Load user settings from localStorage, falling back to defaults.
 */
export function loadSettings(): UserSettings {
  if (typeof window === 'undefined') {
    return defaultSettings;
  }

  try {
    const stored = localStorage.getItem(SETTINGS_KEY);
    if (!stored) {
      return defaultSettings;
    }

    const parsed = JSON.parse(stored) as Partial<UserSettings>;

    // Drop color schemes that no longer exist (removed themes fall back to the default)
    if (parsed.colorScheme && !VALID_COLOR_SCHEMES.includes(parsed.colorScheme)) {
      delete parsed.colorScheme;
    }

    // Drop experimental sub-views that no longer exist (removed views fall back to the default)
    if (parsed.experimentalSubView && !VALID_EXPERIMENTAL_SUB_VIEWS.includes(parsed.experimentalSubView)) {
      delete parsed.experimentalSubView;
    }

    // Handle version migrations in the future
    if (parsed.version !== SETTINGS_VERSION) {
      // For now, just merge with defaults
      return { ...defaultSettings, ...parsed, version: SETTINGS_VERSION };
    }

    // Merge with defaults to handle any missing keys
    return {
      ...defaultSettings,
      ...parsed,
      nodeDisplayOptions: {
        ...defaultNodeDisplayOptions,
        ...parsed.nodeDisplayOptions,
      },
      aiSections: {
        ...defaultAiSections,
        ...parsed.aiSections,
      },
    };
  } catch {
    console.warn('Failed to load settings from localStorage');
    return defaultSettings;
  }
}

/**
 * Save user settings to localStorage.
 */
export function saveSettings(settings: Partial<UserSettings>): void {
  if (typeof window === 'undefined') {
    return;
  }

  try {
    const current = loadSettings();
    const updated: UserSettings = {
      ...current,
      ...settings,
      version: SETTINGS_VERSION,
      nodeDisplayOptions: settings.nodeDisplayOptions
        ? { ...current.nodeDisplayOptions, ...settings.nodeDisplayOptions }
        : current.nodeDisplayOptions,
      aiSections: settings.aiSections
        ? { ...current.aiSections, ...settings.aiSections }
        : current.aiSections,
    };
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(updated));
  } catch {
    console.warn('Failed to save settings to localStorage');
  }
}

/**
 * Extract persistable filter settings from FilterState.
 * Operation/predicate type filters are intentionally excluded — restoring them
 * on the next session would silently hide plan nodes.
 */
export function extractFilterSettings(
  filters: FilterState
): Pick<
  UserSettings,
  'animateEdges' | 'scaleEdgeWidth' | 'focusSelection' | 'nodeDisplayOptions'
> {
  return {
    animateEdges: filters.animateEdges,
    scaleEdgeWidth: filters.scaleEdgeWidth,
    focusSelection: filters.focusSelection,
    nodeDisplayOptions: filters.nodeDisplayOptions,
  };
}

/**
 * Apply saved settings to initial filter state.
 */
export function applySettingsToFilters(
  filters: FilterState,
  settings: UserSettings
): FilterState {
  return {
    ...filters,
    animateEdges: settings.animateEdges,
    scaleEdgeWidth: settings.scaleEdgeWidth,
    focusSelection: settings.focusSelection,
    nodeDisplayOptions: settings.nodeDisplayOptions,
  };
}
