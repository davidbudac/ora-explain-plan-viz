import { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { usePlan } from '../hooks/usePlanContext';
import type { ViewMode, SankeyMetric, NodeIndicatorMetric, ColorScheme, NodeDisplayOptions } from '../lib/types';
import type { HighlightStyle } from '../lib/annotations';
import { hasAnnotations } from '../lib/annotations';

type CommandCategory =
  | 'View'
  | 'Node Display'
  | 'Runtime Display'
  | 'Warnings'
  | 'Behavior'
  | 'Theme'
  | 'Export & Share'
  | 'Panels'
  | 'Metrics'
  | 'Annotations';

interface Command {
  id: string;
  label: string;
  category: CommandCategory;
  keywords: string[];
  shortcut?: string;
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
  actualRows: 'A-Rows',
  actualTime: 'A-Time',
};

const VIEW_MODE_LABELS: Record<ViewMode, string> = {
  hierarchical: 'Tree',
  sankey: 'Sankey',
  tabular: 'Table',
  text: 'Plan Text',
  sql: 'SQL',
  compare: 'Compare',
};

const COLOR_SCHEME_LABELS: Record<ColorScheme, string> = {
  muted: 'Muted',
  professional: 'Professional',
  vibrant: 'Vibrant',
  monochrome: 'Monochrome',
  readable: 'Readable',
};

const HIGHLIGHT_STYLE_LABELS: Record<HighlightStyle, string> = {
  circle: 'Circle',
  tint: 'Tint',
  glow: 'Glow',
  dot: 'Dot',
  underline: 'Underline',
  hachure: 'Hachure',
};

function useCommands(): Command[] {
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
    legendVisible,
    inputPanelCollapsed,
    filterPanelCollapsed,
    detailPanelCollapsed,
    hotspotsEnabled,
    treeCompareEnabled,
    annotations,
    exportPngFnRef,
    // Actions
    setViewMode,
    setTheme,
    setColorScheme,
    setFilters,
    setSankeyMetric,
    setNodeIndicatorMetric,
    setHighlightStyle,
    setVisualizationMaximized,
    setLegendVisible,
    setInputPanelCollapsed,
    setFilterPanelCollapsed,
    setDetailPanelCollapsed,
    setHotspotsEnabled,
    setTreeCompareEnabled,
    exportAnnotatedPlan,
    clearAnnotations,
    sharePlan,
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

    // --- Node display toggles ---
    const nodeDisplayItems: { key: keyof NodeDisplayOptions; label: string; keywords: string[]; runtime?: boolean }[] = [
      { key: 'showObjectName', label: 'Object name', keywords: ['object', 'name', 'table'] },
      { key: 'showRows', label: hasActualStats ? 'E-Rows' : 'Rows', keywords: ['rows', 'estimated', 'e-rows'] },
      { key: 'showCost', label: 'Cost', keywords: ['cost', 'optimizer'] },
      { key: 'showBytes', label: 'Bytes', keywords: ['bytes', 'size', 'memory'] },
      { key: 'showPredicateIndicators', label: 'Predicate indicators', keywords: ['predicate', 'indicator'] },
      { key: 'showPredicateDetails', label: 'Predicate details', keywords: ['predicate', 'details', 'expressions'] },
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
      execute: () => { sharePlan(); },
      isAvailable: () => hasAnyInput,
    });

    commands.push({
      id: 'export-png',
      label: 'Export as PNG',
      category: 'Export & Share',
      keywords: ['export', 'png', 'image', 'screenshot', 'download'],
      execute: () => { exportPngFnRef.current?.(); },
      isAvailable: () => canExportPng,
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
      id: 'toggle-legend',
      label: 'Toggle legend',
      category: 'Panels',
      keywords: ['legend', 'color', 'key', 'show', 'hide'],
      execute: () => setLegendVisible(!legendVisible),
      isActive: () => legendVisible,
      isAvailable: () => anyPlanParsed,
    });

    commands.push({
      id: 'toggle-input-panel',
      label: inputPanelCollapsed ? 'Show input panel' : 'Hide input panel',
      category: 'Panels',
      keywords: ['input', 'panel', 'collapse', 'expand', 'show', 'hide'],
      execute: () => setInputPanelCollapsed(!inputPanelCollapsed),
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
    highlightStyle, parsedPlan, plans, visualizationMaximized, legendVisible,
    inputPanelCollapsed, filterPanelCollapsed, detailPanelCollapsed,
    hotspotsEnabled, treeCompareEnabled, annotations, anyPlanParsed,
    hasActualStats, hasAnyInput, canExportPng, multipleParsedPlans,
    setViewMode, setTheme, setColorScheme, setFilters, setSankeyMetric,
    setNodeIndicatorMetric, setHighlightStyle, setVisualizationMaximized,
    setLegendVisible, setInputPanelCollapsed, setFilterPanelCollapsed,
    setDetailPanelCollapsed, setHotspotsEnabled, setTreeCompareEnabled,
    exportAnnotatedPlan, clearAnnotations, sharePlan, exportPngFnRef,
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
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const itemRefs = useRef<Map<number, HTMLButtonElement>>(new Map());
  const commands = useCommands();

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
        setOpen(prev => !prev);
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

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
  }, []);

  const onKeyDown = useCallback((e: React.KeyboardEvent) => {
    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        setSelectedIndex(i => (i + 1) % flatItems.length);
        break;
      case 'ArrowUp':
        e.preventDefault();
        setSelectedIndex(i => (i - 1 + flatItems.length) % flatItems.length);
        break;
      case 'Enter':
        e.preventDefault();
        if (flatItems[selectedIndex]) {
          executeAndClose(flatItems[selectedIndex]);
        }
        break;
      case 'Escape':
        e.preventDefault();
        setOpen(false);
        break;
    }
  }, [flatItems, selectedIndex, executeAndClose]);

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
        className="fixed z-[91] top-[min(20%,120px)] left-1/2 -translate-x-1/2 w-[540px] max-w-[calc(100vw-2rem)] rounded-xl border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-neutral-900 shadow-2xl flex flex-col overflow-hidden"
        onKeyDown={onKeyDown}
      >
        {/* Search input */}
        <div className="flex items-center gap-2 px-4 py-3 border-b border-neutral-200 dark:border-neutral-700">
          <svg className="w-4 h-4 text-neutral-400 dark:text-neutral-500 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
          <input
            ref={inputRef}
            value={query}
            onChange={e => { setQuery(e.target.value); setSelectedIndex(0); }}
            placeholder="Type a command..."
            className="flex-1 bg-transparent text-sm text-neutral-900 dark:text-neutral-100 placeholder-neutral-400 dark:placeholder-neutral-500 focus:outline-none"
          />
          <kbd className="hidden sm:inline-flex items-center px-1.5 py-0.5 text-[10px] font-medium text-neutral-400 dark:text-neutral-500 bg-neutral-100 dark:bg-neutral-800 border border-neutral-200 dark:border-neutral-700 rounded">
            ESC
          </kbd>
        </div>

        {/* Results */}
        <div ref={listRef} className="max-h-[min(60vh,400px)] overflow-y-auto py-1">
          {flatItems.length === 0 && (
            <div className="px-4 py-6 text-center text-sm text-neutral-500 dark:text-neutral-400">
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
                  className={`w-full flex items-center gap-3 px-4 py-2 text-left text-sm transition-colors ${
                    isSelected
                      ? 'bg-blue-50 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300'
                      : 'text-neutral-700 dark:text-neutral-300 hover:bg-neutral-50 dark:hover:bg-neutral-800'
                  }`}
                >
                  {/* Toggle indicator */}
                  {cmd.isActive !== undefined && (
                    <span className={`w-4 h-4 rounded border flex items-center justify-center shrink-0 ${
                      active
                        ? 'bg-blue-500 border-blue-500 dark:bg-blue-600 dark:border-blue-600'
                        : 'border-neutral-300 dark:border-neutral-600'
                    }`}>
                      {active && (
                        <svg className="w-3 h-3 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                        </svg>
                      )}
                    </span>
                  )}
                  <span className="flex-1 truncate">{cmd.label}</span>
                  {cmd.shortcut && (
                    <kbd className="px-1.5 py-0.5 text-[10px] font-medium text-neutral-400 dark:text-neutral-500 bg-neutral-100 dark:bg-neutral-800 border border-neutral-200 dark:border-neutral-700 rounded">
                      {cmd.shortcut}
                    </kbd>
                  )}
                  {cmd.hint && (
                    <span className="text-xs text-neutral-400 dark:text-neutral-500">{cmd.hint()}</span>
                  )}
                </button>
              );
            });

            return (
              <div key={group.category}>
                <div className="px-4 pt-2 pb-1 text-[11px] font-semibold tracking-wide text-neutral-400 dark:text-neutral-500 uppercase">
                  {group.category}
                </div>
                {categoryItems}
              </div>
            );
          })}
        </div>

        {/* Footer */}
        <div className="flex items-center gap-3 px-4 py-2 border-t border-neutral-100 dark:border-neutral-800 text-[11px] text-neutral-400 dark:text-neutral-500">
          <span className="flex items-center gap-1">
            <kbd className="px-1 py-0.5 bg-neutral-100 dark:bg-neutral-800 border border-neutral-200 dark:border-neutral-700 rounded text-[10px]">&uarr;</kbd>
            <kbd className="px-1 py-0.5 bg-neutral-100 dark:bg-neutral-800 border border-neutral-200 dark:border-neutral-700 rounded text-[10px]">&darr;</kbd>
            navigate
          </span>
          <span className="flex items-center gap-1">
            <kbd className="px-1 py-0.5 bg-neutral-100 dark:bg-neutral-800 border border-neutral-200 dark:border-neutral-700 rounded text-[10px]">&crarr;</kbd>
            select
          </span>
          <span className="flex items-center gap-1">
            <kbd className="px-1 py-0.5 bg-neutral-100 dark:bg-neutral-800 border border-neutral-200 dark:border-neutral-700 rounded text-[10px]">esc</kbd>
            close
          </span>
        </div>
      </div>
    </>,
    document.body
  );
}
