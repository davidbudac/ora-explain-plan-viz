import type { FilterState, ViewMode, SankeyMetric, NodeDisplayOptions, ColorScheme } from './types';

const SETTINGS_KEY = 'ora-explain-viz-settings';
const SETTINGS_VERSION = 1;

/**
 * User settings that persist across sessions.
 * Note: We don't persist searchText, minCost slider values, or raw input data
 * since those are typically session-specific.
 */
export interface UserSettings {
  version: number;

  // View settings
  viewMode: ViewMode;
  sankeyMetric: SankeyMetric;
  colorScheme: ColorScheme;

  // UI panel states
  legendVisible: boolean;
  inputPanelCollapsed: boolean;
  filterPanelCollapsed: boolean;

  // Filter display options (checkboxes)
  animateEdges: boolean;
  focusSelection: boolean;
  nodeDisplayOptions: NodeDisplayOptions;

  // Predicate type filters
  predicateTypes: string[];

  // Operation type filters
  operationTypes: string[];
}

const defaultNodeDisplayOptions: NodeDisplayOptions = {
  showRows: true,
  showCost: true,
  showBytes: true,
  showObjectName: true,
  showPredicateIndicators: true,
  showPredicateDetails: false,
  showQueryBlockBadge: true,
  showQueryBlockGrouping: true,
  showActualRows: true,
  showActualTime: true,
  showStarts: true,
};

const defaultSettings: UserSettings = {
  version: SETTINGS_VERSION,
  viewMode: 'hierarchical',
  sankeyMetric: 'rows',
  colorScheme: 'muted',
  legendVisible: false,
  inputPanelCollapsed: false,
  filterPanelCollapsed: false,
  animateEdges: false,
  focusSelection: false,
  nodeDisplayOptions: defaultNodeDisplayOptions,
  predicateTypes: [],
  operationTypes: [],
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
    };
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(updated));
  } catch {
    console.warn('Failed to save settings to localStorage');
  }
}

/**
 * Extract persistable filter settings from FilterState.
 */
export function extractFilterSettings(
  filters: FilterState
): Pick<
  UserSettings,
  'animateEdges' | 'focusSelection' | 'nodeDisplayOptions' | 'predicateTypes' | 'operationTypes'
> {
  return {
    animateEdges: filters.animateEdges,
    focusSelection: filters.focusSelection,
    nodeDisplayOptions: filters.nodeDisplayOptions,
    predicateTypes: filters.predicateTypes,
    operationTypes: filters.operationTypes,
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
    focusSelection: settings.focusSelection,
    nodeDisplayOptions: settings.nodeDisplayOptions,
    predicateTypes: settings.predicateTypes as FilterState['predicateTypes'],
    operationTypes: settings.operationTypes,
  };
}
