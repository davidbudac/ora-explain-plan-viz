import type { FilterState, ViewMode, SankeyMetric, FlameMetric, ExperimentalSubView, NodeIndicatorMetric, NodeDisplayOptions, ColorScheme, AppPalette, Theme } from './types';
import { APP_PALETTE_ORDER } from './types';
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
  /** App palette: re-skins neutral surfaces + accent (see index.css). */
  palette: AppPalette;

  // UI panel states
  legendVisible: boolean;
  inputPanelCollapsed: boolean;
  filterPanelCollapsed: boolean;
  /** Focus mode: docked side panels give way to floating instruments. */
  focusMode: boolean;

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
  compactStats: false,
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

const VALID_COLOR_SCHEMES: ColorScheme[] = ['contrast', 'semantic', 'estact', 'rail', 'ticker', 'stripe', 'tinted', 'terminal'];
const VALID_PALETTES: AppPalette[] = APP_PALETTE_ORDER;
const VALID_EXPERIMENTAL_SUB_VIEWS: ExperimentalSubView[] = ['scatter', 'timeline', 'waterfall', 'morph', 'waits'];

const defaultSettings: UserSettings = {
  version: SETTINGS_VERSION,
  viewMode: 'hierarchical',
  sankeyMetric: 'rows',
  flameMetric: 'actualTime',
  experimentalSubView: 'scatter',
  nodeIndicatorMetric: 'cost',
  colorScheme: 'semantic',
  palette: 'slate',
  hotspotsEnabled: true,
  showAdvisorSuggestions: false,
  legendVisible: false,
  inputPanelCollapsed: false,
  filterPanelCollapsed: false,
  focusMode: false,
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
 * Default app palette for a given theme. Dark theme defaults to Graphite;
 * light theme keeps the built-in Slate look. Only applies when the user
 * hasn't already saved a palette choice.
 */
function getDefaultPalette(theme?: Theme): AppPalette {
  return theme === 'dark' ? 'graphite' : 'slate';
}

/**
 * Load user settings from localStorage, falling back to defaults.
 * Pass the current theme so an unset palette defaults appropriately
 * (Graphite for dark, Slate for light).
 */
export function loadSettings(theme?: Theme): UserSettings {
  const themedDefaults: UserSettings = { ...defaultSettings, palette: getDefaultPalette(theme) };

  if (typeof window === 'undefined') {
    return themedDefaults;
  }

  try {
    const stored = localStorage.getItem(SETTINGS_KEY);
    if (!stored) {
      return themedDefaults;
    }

    const parsed = JSON.parse(stored) as Partial<UserSettings>;

    // Drop color schemes that no longer exist (removed themes fall back to the default)
    if (parsed.colorScheme && !VALID_COLOR_SCHEMES.includes(parsed.colorScheme)) {
      delete parsed.colorScheme;
    }

    // Drop palettes that no longer exist (removed palettes fall back to the default)
    if (parsed.palette && !VALID_PALETTES.includes(parsed.palette)) {
      delete parsed.palette;
    }

    // Drop experimental sub-views that no longer exist (removed views fall back to the default)
    if (parsed.experimentalSubView && !VALID_EXPERIMENTAL_SUB_VIEWS.includes(parsed.experimentalSubView)) {
      delete parsed.experimentalSubView;
    }

    // Handle version migrations in the future
    if (parsed.version !== SETTINGS_VERSION) {
      // For now, just merge with defaults
      return { ...themedDefaults, ...parsed, version: SETTINGS_VERSION };
    }

    // Merge with defaults to handle any missing keys
    return {
      ...themedDefaults,
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
    return themedDefaults;
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
