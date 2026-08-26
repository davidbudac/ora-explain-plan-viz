import { useEffect, useMemo, useRef, useState, useCallback, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { OutlineIcon, ViewIcon } from './viewIcons';
import { usePlan } from '../hooks/usePlanContext';
import type { ViewMode, SankeyMetric, NodeIndicatorMetric, ColorScheme, NodeDisplayOptions } from '../lib/types';
import type { HighlightStyle } from '../lib/annotations';
import { hasAnnotations } from '../lib/annotations';
import { DENSITY_PRESET_LABELS, DENSITY_PRESET_ORDER } from '../lib/density';
import { isDbAgentEnabled } from '../lib/agent/client';

type CommandCategory =
  | 'View'
  | 'Node Display'
  | 'Runtime Display'
  | 'Warnings'
  | 'Metadata'
  | 'Behavior'
  | 'Theme'
  | 'Export & Share'
  | 'Panels'
  | 'Metrics'
  | 'Annotations';

/**
 * Fallback glyph per category, so every row carries an icon rather than a
 * checkbox — the palette lists commands, it isn't a multi-select form.
 */
const CATEGORY_ICON_PATHS: Record<CommandCategory, string> = {
  'View': 'M15 12a3 3 0 11-6 0 3 3 0 016 0z M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z',
  'Node Display': 'M4 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2V6zM14 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2V6zM4 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2v-2zM14 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2v-2z',
  'Runtime Display': 'M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z',
  'Warnings': 'M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z',
  'Metadata': 'M4 7c0-1.1 3.6-2 8-2s8 .9 8 2-3.6 2-8 2-8-.9-8-2zm0 0v10c0 1.1 3.6 2 8 2s8-.9 8-2V7M4 12c0 1.1 3.6 2 8 2s8-.9 8-2',
  'Behavior': 'M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z',
  'Theme': 'M7 21a4 4 0 01-4-4V5a2 2 0 012-2h4a2 2 0 012 2v12a4 4 0 01-4 4zm0 0h12a2 2 0 002-2v-4a2 2 0 00-2-2h-2.343M11 7.343l1.657-1.657a2 2 0 012.828 0l2.829 2.829a2 2 0 010 2.828l-8.486 8.485M7 17h.01',
  'Export & Share': 'M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12',
  'Panels': 'M9 17V7m0 10a2 2 0 01-2 2H5a2 2 0 01-2-2V7a2 2 0 012-2h2a2 2 0 012 2m0 10a2 2 0 002 2h6a2 2 0 002-2V7a2 2 0 00-2-2h-6a2 2 0 00-2 2',
  'Metrics': 'M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z',
  'Annotations': 'M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z',
};

interface Command {
  id: string;
  label: string;
  category: CommandCategory;
  keywords: string[];
  shortcut?: string;
  /** Row icon; falls back to the category glyph when absent. */
  icon?: ReactNode;
  execute: () => void;
  /** If present, command is a toggle and this returns current state */
  isActive?: () => boolean;
  /** If present, command is only available when this returns true */
  isAvailable?: () => boolean;
  /** Right-side hint text (e.g. current value) */
  hint?: () => string;
}

const NODE_INDICATOR_LABELS: Record<NodeIndicatorMetric, string> = {
  cost: 'Cost',
  actualRows: 'A-Rows',
  actualTime: 'A-Time',
  starts: 'Starts',
  activityPercent: 'Activity %',
};

const SANKEY_METRIC_LABELS: Record<SankeyMetric, string> = {
  rows: 'Rows',
  cost: 'Cost',
  actualRows: 'Total Rows (A-Rows × Starts)',
  actualTime: 'A-Time',
};

const VIEW_MODE_LABELS: Record<ViewMode, string> = {
  hierarchical: 'Tree',
  sankey: 'Sankey',
  flame: 'Flame',
  tabular: 'Table',
  text: 'Plan Text',
  sql: 'SQL',
  metadata: 'Metadata',
  compare: 'Compare',
  monitor: 'Monitor',
  experimental: 'Experimental',
};

const COLOR_SCHEME_LABELS: Record<ColorScheme, string> = {
  contrast: 'High Contrast',
  semantic: 'Semantic',
  estact: 'Est ⇄ Act',
  rail: 'Icon Rail',
  ticker: 'Ticker',
};

const HIGHLIGHT_STYLE_LABELS: Record<HighlightStyle, string> = {
  circle: 'Circle',
  tint: 'Tint',
  glow: 'Glow',
  dot: 'Dot',
  underline: 'Underline',
  hachure: 'Hachure',
};

// `onExportPng` is a plain callback (already dereferenced from its ref by the
// caller) rather than the ref itself — see the call site in `CommandPalette`
// for why that split matters.
function useCommands(onExportPng: () => void): Command[] {
  const {
    // State
    viewMode,
    theme,
    colorScheme,
    filters,
    sankeyMetric,
    nodeIndicatorMetric,
    highlightStyle,
    parsedPlan,
    plans,
    visualizationMaximized,
    inputPanelCollapsed,
    filterPanelCollapsed,
    detailPanelCollapsed,
    hotspotsEnabled,
    treeCompareEnabled,
    annotations,
    legendVisible,
    densitySelection,
    // Actions
    setLegendVisible,
    setShortcutsOverlayOpen,
    applyDensityPreset,
    setViewMode,
    setTheme,
    setColorScheme,
    setFilters,
    setSankeyMetric,
    setNodeIndicatorMetric,
    setHighlightStyle,
    setVisualizationMaximized,
    setInputPanelCollapsed,
    setFilterPanelCollapsed,
    setDetailPanelCollapsed,
    setHotspotsEnabled,
    setTreeCompareEnabled,
    exportAnnotatedPlan,
    clearAnnotations,
    share,
    setBaselineDialogOpen,
    setConnectPanelOpen,
  } = usePlan();

  const anyPlanParsed = plans.some(p => p.parsedPlan);
  const hasActualStats = parsedPlan?.hasActualStats ?? false;
  const hasAnyInput = plans.some(s => s.rawInput.trim().length > 0);
  const canExportPng = parsedPlan !== null && viewMode === 'hierarchical' && !treeCompareEnabled;
  const multipleParsedPlans = plans.filter(p => p.parsedPlan).length >= 2;

  const toggleNodeDisplayOption = useCallback((key: keyof NodeDisplayOptions) => {
    setFilters({
      nodeDisplayOptions: {
        ...filters.nodeDisplayOptions,
        [key]: !filters.nodeDisplayOptions[key],
      },
    });
  }, [filters.nodeDisplayOptions, setFilters]);

  const enableAllDisplayOptions = useCallback(() => {
    const next: Partial<NodeDisplayOptions> = {};
    for (const key of Object.keys(filters.nodeDisplayOptions) as (keyof NodeDisplayOptions)[]) {
      next[key] = true;
    }
    setFilters({
      animateEdges: true,
      focusSelection: true,
      nodeDisplayOptions: { ...filters.nodeDisplayOptions, ...next },
    });
  }, [filters.nodeDisplayOptions, setFilters]);

  const disableAllDisplayOptions = useCallback(() => {
    const next: Partial<NodeDisplayOptions> = {};
    for (const key of Object.keys(filters.nodeDisplayOptions) as (keyof NodeDisplayOptions)[]) {
      next[key] = false;
    }
    setFilters({
      animateEdges: false,
      focusSelection: false,
      nodeDisplayOptions: { ...filters.nodeDisplayOptions, ...next },
    });
  }, [filters.nodeDisplayOptions, setFilters]);

  return useMemo(() => {
    const commands: Command[] = [];

    // --- View modes ---
    for (const [mode, label] of Object.entries(VIEW_MODE_LABELS) as [ViewMode, string][]) {
      commands.push({
        id: `view-${mode}`,
        label: `Switch to ${label} view`,
        category: 'View',
        keywords: ['view', 'mode', 'switch', label.toLowerCase(), mode],
        icon: <ViewIcon mode={mode} />,
        execute: () => setViewMode(mode),
        isActive: () => viewMode === mode,
        isAvailable: () => {
          if (mode === 'compare') return multipleParsedPlans;
          if (mode === 'sql') return anyPlanParsed;
          return anyPlanParsed;
        },
      });
    }

    // Split compare
    commands.push({
      id: 'split-compare',
      label: 'Split compare (dual trees)',
      category: 'View',
      keywords: ['split', 'compare', 'dual', 'side by side', 'tree'],
      execute: () => setTreeCompareEnabled(!treeCompareEnabled),
      isActive: () => treeCompareEnabled,
      isAvailable: () => multipleParsedPlans && viewMode === 'hierarchical',
    });

    // --- Legend ---
    commands.push({
      id: 'toggle-legend',
      label: 'Toggle legend',
      category: 'View',
      keywords: ['legend', 'colors', 'key', 'badges', 'meaning'],
      execute: () => setLegendVisible(!legendVisible),
      isActive: () => legendVisible,
      isAvailable: () => anyPlanParsed,
    });

    // --- Keyboard shortcuts help ---
    commands.push({
      id: 'keyboard-shortcuts',
      label: 'Keyboard shortcuts',
      category: 'View',
      keywords: ['keyboard', 'shortcuts', 'help', 'keys', 'hotkeys'],
      shortcut: '?',
      execute: () => setShortcutsOverlayOpen(true),
    });

    // --- Maximize ---
    commands.push({
      id: 'maximize',
      label: visualizationMaximized ? 'Restore visualization' : 'Maximize visualization',
      category: 'View',
      keywords: ['maximize', 'fullscreen', 'restore', 'minimize', 'focus', 'zen'],
      shortcut: 'F',
      execute: () => setVisualizationMaximized(!visualizationMaximized),
      isAvailable: () => anyPlanParsed,
    });

    // --- Density presets ---
    for (const preset of DENSITY_PRESET_ORDER) {
      commands.push({
        id: `density-${preset}`,
        label: `Density preset: ${DENSITY_PRESET_LABELS[preset]}`,
        category: 'Node Display',
        keywords: ['density', 'preset', 'minimal', 'compact', 'detailed', 'simplify', preset],
        execute: () => applyDensityPreset(preset),
        isActive: () => densitySelection === preset,
        isAvailable: () => anyPlanParsed,
      });
    }

    // --- Node display toggles ---
    const nodeDisplayItems: { key: keyof NodeDisplayOptions; label: string; keywords: string[]; runtime?: boolean }[] = [
      { key: 'showObjectName', label: 'Object name', keywords: ['object', 'name', 'table'] },
      { key: 'showRows', label: hasActualStats ? 'E-Rows' : 'Rows', keywords: ['rows', 'estimated', 'e-rows'] },
      { key: 'showCost', label: 'Cost', keywords: ['cost', 'optimizer'] },
      { key: 'showBytes', label: 'Bytes', keywords: ['bytes', 'size', 'memory'] },
      { key: 'showPredicateIndicators', label: 'Predicate indicators', keywords: ['predicate', 'indicator'] },
      { key: 'showPredicateDetails', label: 'Predicate details', keywords: ['predicate', 'details', 'expressions'] },
      { key: 'showPartitionInfo', label: 'Partition pruning', keywords: ['partition', 'pruning', 'pstart', 'pstop', 'range'] },
      { key: 'showQueryBlockBadge', label: 'Query block badge', keywords: ['query', 'block', 'badge'] },
      { key: 'showQueryBlockGrouping', label: 'Query block grouping', keywords: ['query', 'block', 'group'] },
    ];

    for (const item of nodeDisplayItems) {
      commands.push({
        id: `display-${item.key}`,
        label: `Toggle ${item.label}`,
        category: 'Node Display',
        keywords: ['display', 'show', 'hide', 'toggle', 'node', ...item.keywords],
        execute: () => toggleNodeDisplayOption(item.key),
        isActive: () => filters.nodeDisplayOptions[item.key],
        isAvailable: () => anyPlanParsed,
      });
    }

    // --- Runtime display toggles ---
    const runtimeItems: { key: keyof NodeDisplayOptions; label: string; keywords: string[] }[] = [
      { key: 'showActualRows', label: 'A-Rows', keywords: ['actual', 'rows', 'runtime'] },
      { key: 'showActualTime', label: 'A-Time', keywords: ['actual', 'time', 'runtime'] },
      { key: 'showStarts', label: 'Starts', keywords: ['starts', 'runtime', 'executions'] },
    ];

    for (const item of runtimeItems) {
      commands.push({
        id: `display-${item.key}`,
        label: `Toggle ${item.label}`,
        category: 'Runtime Display',
        keywords: ['display', 'show', 'hide', 'toggle', ...item.keywords],
        execute: () => toggleNodeDisplayOption(item.key),
        isActive: () => filters.nodeDisplayOptions[item.key],
        isAvailable: () => anyPlanParsed && hasActualStats,
      });
    }

    // --- Warning badge toggles ---
    const warningItems: { key: keyof NodeDisplayOptions; label: string; keywords: string[]; runtime?: boolean }[] = [
      { key: 'showHotspotBadge', label: 'Hotspot badge', keywords: ['hotspot', 'hot', 'badge'], runtime: true },
      { key: 'showSpillBadge', label: 'Spill to disk badge', keywords: ['spill', 'disk', 'temp', 'badge'] },
      { key: 'showCardinalityBadge', label: 'Cardinality mismatch badge', keywords: ['cardinality', 'mismatch', 'badge'], runtime: true },
      { key: 'showAdvisorBadge', label: 'Advisor findings badge', keywords: ['advisor', 'findings', 'badge'] },
    ];

    for (const item of warningItems) {
      commands.push({
        id: `warning-${item.key}`,
        label: `Toggle ${item.label}`,
        category: 'Warnings',
        keywords: ['warning', 'show', 'hide', 'toggle', ...item.keywords],
        execute: () => toggleNodeDisplayOption(item.key),
        isActive: () => filters.nodeDisplayOptions[item.key],
        isAvailable: () => anyPlanParsed && (!item.runtime || hasActualStats),
      });
    }

    // --- Metadata indicator toggles ---
    const metadataItems: { key: keyof NodeDisplayOptions; label: string; keywords: string[] }[] = [
      { key: 'showStaleStatsBadge', label: 'Stale stats badge', keywords: ['stale', 'stats', 'metadata', 'bundle'] },
      { key: 'showMissingStatsBadge', label: 'Missing stats badge', keywords: ['missing', 'stats', 'metadata', 'bundle'] },
      { key: 'showMismatchNoHistogramBadge', label: 'No-histogram-on-mismatch badge', keywords: ['histogram', 'cardinality', 'mismatch', 'metadata', 'bundle'] },
    ];

    for (const item of metadataItems) {
      commands.push({
        id: `metadata-${item.key}`,
        label: `Toggle ${item.label}`,
        category: 'Metadata',
        keywords: ['metadata', 'show', 'hide', 'toggle', ...item.keywords],
        execute: () => toggleNodeDisplayOption(item.key),
        isActive: () => filters.nodeDisplayOptions[item.key],
        isAvailable: () => anyPlanParsed,
      });
    }

    // --- Behavior toggles ---
    commands.push({
      id: 'animate-edges',
      label: 'Toggle edge animation',
      category: 'Behavior',
      keywords: ['animate', 'edges', 'motion', 'flow'],
      execute: () => setFilters({ animateEdges: !filters.animateEdges }),
      isActive: () => filters.animateEdges,
      isAvailable: () => anyPlanParsed,
    });

    commands.push({
      id: 'focus-selection',
      label: 'Toggle focus selection path',
      category: 'Behavior',
      keywords: ['focus', 'selection', 'path', 'highlight'],
      execute: () => setFilters({ focusSelection: !filters.focusSelection }),
      isActive: () => filters.focusSelection,
      isAvailable: () => anyPlanParsed,
    });

    // Show annotations
    commands.push({
      id: 'show-annotations',
      label: 'Toggle annotation overlays',
      category: 'Annotations',
      keywords: ['annotations', 'notes', 'highlights', 'overlay', 'show', 'hide'],
      execute: () => toggleNodeDisplayOption('showAnnotations'),
      isActive: () => filters.nodeDisplayOptions.showAnnotations,
      isAvailable: () => anyPlanParsed,
    });

    // Enable/disable all view options
    commands.push({
      id: 'enable-all-display',
      label: 'Enable all display options',
      category: 'Node Display',
      keywords: ['enable', 'all', 'show', 'display', 'options'],
      execute: enableAllDisplayOptions,
      isAvailable: () => anyPlanParsed,
    });

    commands.push({
      id: 'disable-all-display',
      label: 'Disable all display options',
      category: 'Node Display',
      keywords: ['disable', 'all', 'hide', 'display', 'options'],
      execute: disableAllDisplayOptions,
      isAvailable: () => anyPlanParsed,
    });

    // --- Theme ---
    commands.push({
      id: 'toggle-theme',
      label: `Switch to ${theme === 'light' ? 'dark' : 'light'} mode`,
      category: 'Theme',
      keywords: ['theme', 'dark', 'light', 'mode', 'toggle'],
      execute: () => setTheme(theme === 'light' ? 'dark' : 'light'),
      hint: () => theme === 'light' ? 'Light' : 'Dark',
    });

    // Color schemes
    for (const [scheme, label] of Object.entries(COLOR_SCHEME_LABELS) as [ColorScheme, string][]) {
      commands.push({
        id: `color-${scheme}`,
        label: `${label} color scheme`,
        category: 'Theme',
        keywords: ['color', 'scheme', 'palette', label.toLowerCase()],
        execute: () => setColorScheme(scheme),
        isActive: () => colorScheme === scheme,
      });
    }

    // Highlight styles
    for (const [style, label] of Object.entries(HIGHLIGHT_STYLE_LABELS) as [HighlightStyle, string][]) {
      commands.push({
        id: `highlight-style-${style}`,
        label: `${label} highlight style`,
        category: 'Theme',
        keywords: ['highlight', 'style', label.toLowerCase(), 'annotation'],
        execute: () => setHighlightStyle(style),
        isActive: () => highlightStyle === style,
      });
    }

    // --- Export & Share ---
    commands.push({
      id: 'share-url',
      label: 'Share plan via URL',
      category: 'Export & Share',
      keywords: ['share', 'url', 'link', 'copy', 'clipboard'],
      execute: () => { void share(); },
      isAvailable: () => hasAnyInput,
    });

    commands.push({
      id: 'export-png',
      label: 'Export as PNG',
      category: 'Export & Share',
      keywords: ['export', 'png', 'image', 'screenshot', 'download'],
      execute: onExportPng,
      isAvailable: () => canExportPng,
    });

    commands.push({
      id: 'create-baseline-script',
      label: 'Create SQL Plan Baseline script…',
      category: 'Export & Share',
      keywords: ['baseline', 'sql plan baseline', 'spm', 'dbms_spm', 'script', 'fix plan'],
      execute: () => setBaselineDialogOpen(true),
      isAvailable: () => parsedPlan !== null,
    });

    commands.push({
      id: 'save-annotations',
      label: 'Save annotated plan',
      category: 'Export & Share',
      keywords: ['save', 'annotations', 'export', 'json', 'download'],
      execute: exportAnnotatedPlan,
      isAvailable: () => parsedPlan !== null,
    });

    commands.push({
      id: 'clear-annotations',
      label: 'Clear all annotations',
      category: 'Annotations',
      keywords: ['clear', 'annotations', 'remove', 'reset'],
      execute: clearAnnotations,
      isAvailable: () => parsedPlan !== null && hasAnnotations(annotations),
    });

    // --- Panels ---
    commands.push({
      id: 'toggle-input-panel',
      label: inputPanelCollapsed ? 'Show input panel' : 'Hide input panel',
      category: 'Panels',
      keywords: ['input', 'panel', 'collapse', 'expand', 'show', 'hide'],
      execute: () => setInputPanelCollapsed(!inputPanelCollapsed),
    });

    commands.push({
      id: 'connect-database',
      label: 'Connect to database…',
      category: 'Panels',
      keywords: ['connect', 'database', 'db', 'oracle', 'agent', 'sql'],
      execute: () => {
        setInputPanelCollapsed(false);
        setConnectPanelOpen(true);
      },
      isAvailable: () => isDbAgentEnabled(),
    });

    commands.push({
      id: 'toggle-filter-panel',
      label: filterPanelCollapsed ? 'Show filter panel' : 'Hide filter panel',
      category: 'Panels',
      keywords: ['filter', 'panel', 'collapse', 'expand', 'show', 'hide', 'left'],
      execute: () => setFilterPanelCollapsed(!filterPanelCollapsed),
      isAvailable: () => anyPlanParsed,
    });

    commands.push({
      id: 'toggle-detail-panel',
      label: detailPanelCollapsed ? 'Show detail panel' : 'Hide detail panel',
      category: 'Panels',
      keywords: ['detail', 'panel', 'collapse', 'expand', 'show', 'hide', 'right', 'node'],
      execute: () => setDetailPanelCollapsed(!detailPanelCollapsed),
      isAvailable: () => anyPlanParsed,
    });

    commands.push({
      id: 'toggle-hotspots',
      label: 'Toggle hotspot detection',
      category: 'Panels',
      keywords: ['hotspot', 'detection', 'hot', 'node', 'enable', 'disable'],
      execute: () => setHotspotsEnabled(!hotspotsEnabled),
      isActive: () => hotspotsEnabled,
      isAvailable: () => anyPlanParsed && hasActualStats,
    });

    // --- Node indicator metric ---
    for (const [metric, label] of Object.entries(NODE_INDICATOR_LABELS) as [NodeIndicatorMetric, string][]) {
      const isRuntime = metric !== 'cost';
      commands.push({
        id: `indicator-${metric}`,
        label: `Node indicator: ${label}`,
        category: 'Metrics',
        keywords: ['indicator', 'metric', 'badge', 'node', label.toLowerCase()],
        execute: () => setNodeIndicatorMetric(metric),
        isActive: () => nodeIndicatorMetric === metric,
        isAvailable: () => anyPlanParsed && (!isRuntime || hasActualStats),
      });
    }

    // --- Sankey metric ---
    for (const [metric, label] of Object.entries(SANKEY_METRIC_LABELS) as [SankeyMetric, string][]) {
      const isRuntime = metric === 'actualRows' || metric === 'actualTime';
      commands.push({
        id: `sankey-${metric}`,
        label: `Sankey metric: ${label}`,
        category: 'Metrics',
        keywords: ['sankey', 'metric', 'flow', label.toLowerCase()],
        execute: () => setSankeyMetric(metric),
        isActive: () => sankeyMetric === metric,
        isAvailable: () => anyPlanParsed && (!isRuntime || hasActualStats),
      });
    }

    return commands;
  }, [
    viewMode, theme, colorScheme, filters, sankeyMetric, nodeIndicatorMetric,
    highlightStyle, parsedPlan, visualizationMaximized,
    inputPanelCollapsed, filterPanelCollapsed, detailPanelCollapsed,
    hotspotsEnabled, treeCompareEnabled, annotations, anyPlanParsed,
    hasActualStats, hasAnyInput, canExportPng, multipleParsedPlans,
    legendVisible, setLegendVisible, setShortcutsOverlayOpen,
    densitySelection, applyDensityPreset,
    setViewMode, setTheme, setColorScheme, setFilters, setSankeyMetric,
    setNodeIndicatorMetric, setHighlightStyle, setVisualizationMaximized,
    setInputPanelCollapsed, setFilterPanelCollapsed,
    setDetailPanelCollapsed, setHotspotsEnabled, setTreeCompareEnabled,
    exportAnnotatedPlan, clearAnnotations, share, onExportPng, setBaselineDialogOpen, setConnectPanelOpen,
    toggleNodeDisplayOption, enableAllDisplayOptions, disableAllDisplayOptions,
  ]);
}

const CATEGORY_ORDER: CommandCategory[] = [
  'View',
  'Node Display',
  'Runtime Display',
  'Warnings',
  'Behavior',
  'Theme',
  'Export & Share',
  'Panels',
  'Metrics',
  'Annotations',
];

export function CommandPalette() {
  const { commandPaletteOpen: open, setCommandPaletteOpen: setOpen, exportPngFnRef } = usePlan();
  const [query, setQuery] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const itemRefs = useRef<Map<number, HTMLButtonElement>>(new Map());
  // Dereference the ref here, in a plain event-handler-shaped callback, and
  // hand `useCommands` an ordinary function — reading `.current` inside a
  // closure that itself gets stored in the commands array (built with
  // `.push`) trips the refs-during-render check even though it only ever
  // runs from a click/keyboard handler.
  const triggerExportPng = useCallback(() => {
    exportPngFnRef.current?.();
  }, [exportPngFnRef]);
  const commands = useCommands(triggerExportPng);

  // Filter to available commands
  const availableCommands = useMemo(
    () => commands.filter(cmd => !cmd.isAvailable || cmd.isAvailable()),
    [commands]
  );

  // Search
  const filtered = useMemo(() => {
    const term = query.trim().toLowerCase();
    if (!term) return availableCommands;
    const terms = term.split(/\s+/);
    return availableCommands.filter(cmd => {
      const searchable = [cmd.label.toLowerCase(), ...cmd.keywords].join(' ');
      return terms.every(t => searchable.includes(t));
    });
  }, [availableCommands, query]);

  // Group by category
  const grouped = useMemo(() => {
    return CATEGORY_ORDER
      .map(cat => ({
        category: cat,
        items: filtered.filter(cmd => cmd.category === cat),
      }))
      .filter(g => g.items.length > 0);
  }, [filtered]);

  // Flat list for keyboard navigation
  const flatItems = useMemo(() => grouped.flatMap(g => g.items), [grouped]);

  // Clamp selected index
  useEffect(() => {
    setSelectedIndex(i => Math.min(i, Math.max(0, flatItems.length - 1)));
  }, [flatItems.length]);

  // Scroll selected item into view
  useEffect(() => {
    const el = itemRefs.current.get(selectedIndex);
    el?.scrollIntoView({ block: 'nearest' });
  }, [selectedIndex]);

  // Global Cmd+K listener
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        setOpen(!open);
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [open, setOpen]);

  // Reset on open/close
  useEffect(() => {
    if (open) {
      setQuery('');
      setSelectedIndex(0);
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [open]);

  const executeAndClose = useCallback((cmd: Command) => {
    cmd.execute();
    // Keep palette open for toggles, close for actions
    if (!cmd.isActive) {
      setOpen(false);
    }
  }, [setOpen]);

  const onKeyDown = useCallback((e: React.KeyboardEvent) => {
    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        e.stopPropagation();
        if (flatItems.length === 0) break;
        setSelectedIndex(i => (i + 1) % flatItems.length);
        break;
      case 'ArrowUp':
        e.preventDefault();
        e.stopPropagation();
        if (flatItems.length === 0) break;
        setSelectedIndex(i => (i - 1 + flatItems.length) % flatItems.length);
        break;
      case 'Enter':
        e.preventDefault();
        e.stopPropagation();
        if (flatItems[selectedIndex]) {
          executeAndClose(flatItems[selectedIndex]);
        }
        break;
      case 'Escape':
        e.preventDefault();
        e.stopPropagation();
        setOpen(false);
        break;
    }
  }, [flatItems, selectedIndex, executeAndClose, setOpen]);

  if (!open) return null;

  let flatIndex = 0;

  return createPortal(
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 z-[90] bg-black/30 dark:bg-black/50"
        onClick={() => setOpen(false)}
      />
      {/* Palette */}
      <div
        className="fixed z-[91] top-[min(20%,120px)] left-1/2 -translate-x-1/2 w-[540px] max-w-[calc(100vw-2rem)] rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 shadow-2xl flex flex-col overflow-hidden"
        onKeyDown={onKeyDown}
      >
        {/* Search input */}
        <div className="flex items-center gap-2 px-4 py-3 border-b border-slate-200 dark:border-slate-700">
          <svg className="w-4 h-4 text-slate-400 dark:text-slate-500 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
          <input
            ref={inputRef}
            value={query}
            onChange={e => { setQuery(e.target.value); setSelectedIndex(0); }}
            placeholder="Type a command..."
            className="flex-1 bg-transparent text-sm text-slate-900 dark:text-slate-100 placeholder-slate-400 dark:placeholder-slate-500 focus:outline-none"
          />
          <kbd className="hidden sm:inline-flex items-center px-1.5 py-0.5 text-[10px] font-medium text-slate-400 dark:text-slate-500 bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded">
            ESC
          </kbd>
        </div>

        {/* Results */}
        <div ref={listRef} className="max-h-[min(60vh,400px)] overflow-y-auto py-1">
          {flatItems.length === 0 && (
            <div className="px-4 py-6 text-center text-sm text-slate-500 dark:text-slate-400">
              No matching commands
            </div>
          )}
          {grouped.map(group => {
            const categoryItems = group.items.map(cmd => {
              const thisIndex = flatIndex++;
              const isSelected = thisIndex === selectedIndex;
              const active = cmd.isActive?.();
              return (
                <button
                  key={cmd.id}
                  ref={(el) => {
                    if (el) itemRefs.current.set(thisIndex, el);
                    else itemRefs.current.delete(thisIndex);
                  }}
                  type="button"
                  onClick={() => executeAndClose(cmd)}
                  onMouseEnter={() => setSelectedIndex(thisIndex)}
                  className={`w-full flex items-center gap-3 px-4 py-2 text-left text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-blue-500/60 dark:focus-visible:ring-blue-400/60 ${
                    isSelected
                      ? 'bg-blue-50 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300'
                      : 'text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800'
                  }`}
                >
                  {/* Command icon — accented when this command is the active one */}
                  <span
                    className={`w-4 h-4 shrink-0 flex items-center justify-center ${
                      active
                        ? 'text-blue-600 dark:text-blue-400'
                        : 'text-slate-400 dark:text-slate-500'
                    }`}
                  >
                    {cmd.icon ?? <OutlineIcon path={CATEGORY_ICON_PATHS[cmd.category]} />}
                  </span>
                  <span className={`flex-1 truncate ${active ? 'font-medium text-blue-600 dark:text-blue-400' : ''}`}>
                    {cmd.label}
                  </span>
                  {active && (
                    <svg
                      className="w-3.5 h-3.5 shrink-0 text-blue-600 dark:text-blue-400"
                      fill="none"
                      viewBox="0 0 24 24"
                      stroke="currentColor"
                      strokeWidth={3}
                      aria-hidden="true"
                    >
                      <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                    </svg>
                  )}
                  {cmd.shortcut && (
                    <kbd className="px-1.5 py-0.5 text-[10px] font-medium text-slate-400 dark:text-slate-500 bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded">
                      {cmd.shortcut}
                    </kbd>
                  )}
                  {cmd.hint && (
                    <span className="text-xs text-slate-400 dark:text-slate-500">{cmd.hint()}</span>
                  )}
                </button>
              );
            });

            return (
              <div key={group.category}>
                <div className="px-4 pt-2 pb-1 text-[11px] font-semibold tracking-wide text-slate-500 dark:text-slate-400 uppercase">
                  {group.category}
                </div>
                {categoryItems}
              </div>
            );
          })}
        </div>

        {/* Footer */}
        <div className="flex items-center gap-3 px-4 py-2 border-t border-slate-100 dark:border-slate-800 text-[11px] text-slate-400 dark:text-slate-500">
          <span className="flex items-center gap-1">
            <kbd className="px-1 py-0.5 bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded text-[10px]">&uarr;</kbd>
            <kbd className="px-1 py-0.5 bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded text-[10px]">&darr;</kbd>
            navigate
          </span>
          <span className="flex items-center gap-1">
            <kbd className="px-1 py-0.5 bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded text-[10px]">&crarr;</kbd>
            select
          </span>
          <span className="flex items-center gap-1">
            <kbd className="px-1 py-0.5 bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded text-[10px]">esc</kbd>
            close
          </span>
        </div>
      </div>
    </>,
    document.body
  );
}
