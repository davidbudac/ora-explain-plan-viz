import { useEffect, useId, useRef, useState } from 'react';
import { usePlan } from '../hooks/usePlanContext';
import { DENSITY_PRESET_ORDER, DENSITY_PRESET_LABELS } from '../lib/density';
import type { DensityPreset } from '../lib/density';
import type { FlameMetric, NodeIndicatorMetric, SankeyMetric, ViewMode } from '../lib/types';
import { FilterPanelBody } from './FilterPanel';
import { NodeDetailBody, NoSelectionBody } from './NodeDetailPanel';
import { CustomizeViewMenu } from './CustomizeViewMenu';
import { TreeLayoutControls } from './views/TreeLayoutControls';
import { FOCUS_RING } from './ui';

const CONTROL_BASE = `min-h-8 rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-xs text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 ${FOCUS_RING}`;
const CONTROL = `${CONTROL_BASE} px-2.5`;
/** Square, icon-only variant of CONTROL (the legend toggle). */
const ICON_CONTROL = `${CONTROL_BASE} w-8 shrink-0 flex items-center justify-center`;
const CONTROL_PRESSED = 'bg-slate-200 dark:bg-slate-700 border-slate-300 dark:border-slate-600 text-slate-900 dark:text-slate-100 hover:bg-slate-200 dark:hover:bg-slate-700';

/** Views that render the floating colour/badge legend. */
const LEGEND_VIEWS: ViewMode[] = ['hierarchical', 'tabular', 'sankey', 'flame'];

interface SegmentOption<T extends string> {
  value: T;
  label: string;
  title?: string;
}

/**
 * Label text for a toolbar control. Always visible when `labelled`; otherwise it
 * stays a screen-reader/accessible name until the toolbar is wide enough
 * (container query on the toolbar, see `WorkspaceTools`; the width it tests is
 * the toolbar's content box) to spare the words.
 */
function FieldLabel({ htmlFor, labelled, children }: { htmlFor: string; labelled: boolean; children: string }) {
  return (
    <label
      htmlFor={htmlFor}
      className={`text-xs whitespace-nowrap text-slate-600 dark:text-slate-300 ${labelled ? '' : 'sr-only @min-[900px]:not-sr-only'}`}
    >
      {children}
    </label>
  );
}

/**
 * A compact one-of-many `<select>` (the tree's node indicator, Sankey flow and
 * flame metric) — the same footprint as the density select, where a button
 * group per metric used to wrap the toolbar onto a second row.
 */
function MetricSelect<T extends string>({
  label,
  title,
  value,
  options,
  onChange,
  labelled,
}: {
  label: string;
  title: string;
  value: T;
  options: SegmentOption<T>[];
  onChange: (value: T) => void;
  labelled: boolean;
}) {
  const id = useId();
  // A single choice is not a choice (e.g. Cost-only plans without runtime stats).
  if (options.length < 2) return null;
  return (
    <div className="shrink-0 flex items-center gap-1.5">
      <FieldLabel htmlFor={id} labelled={labelled}>{label}</FieldLabel>
      <select
        id={id}
        className={CONTROL}
        title={title}
        value={value}
        onChange={(e) => onChange(e.target.value as T)}
      >
        {options.map((option) => (
          <option key={option.value} value={option.value} title={option.title}>{option.label}</option>
        ))}
      </select>
    </div>
  );
}

/**
 * The tree's layout strip, wired to the context. Expand/collapse/focus/redraw
 * go through `treeViewActionsRef`, and the hidden count / collapsibility /
 * minimap visibility come from `treeViewState` — both published by the
 * single-plan tree while it is mounted.
 */
function TreeLayoutStrip() {
  const {
    treeLayoutDirection, setTreeLayoutDirection, treeMinimap, setTreeMinimap,
    treeViewActionsRef, treeViewState, selectedNodes,
  } = usePlan();
  return (
    <TreeLayoutControls
      className="shadow-none! bg-transparent! dark:bg-transparent! backdrop-blur-none! flex-nowrap! shrink-0"
      direction={treeLayoutDirection}
      onDirectionChange={setTreeLayoutDirection}
      minimap={treeMinimap}
      onMinimapChange={setTreeMinimap}
      minimapShown={treeViewState?.minimapShown ?? false}
      onExpandAll={() => treeViewActionsRef.current?.expandAll()}
      onCollapseAll={() => treeViewActionsRef.current?.collapseAll()}
      hiddenCount={treeViewState?.hiddenCount ?? 0}
      canCollapse={treeViewState?.canCollapse ?? false}
      onFocusSelected={() => treeViewActionsRef.current?.focusSelected()}
      canFocusSelected={selectedNodes.length === 1}
      onRedraw={() => treeViewActionsRef.current?.resetLayout()}
    />
  );
}

/**
 * View-specific display controls for the active view: tree → node density
 * (+ Customize…), node indicator and the layout strip; Sankey → flow metric;
 * Flame → metric. Shared by the workspace toolbar and focus mode's pill.
 *
 * In the toolbar the tree's field labels ("Nodes", "Indicator") only show once
 * the toolbar is wide enough to spare them; `labelled` keeps them visible
 * where the controls have a whole panel to themselves (focus mode's View chip).
 */
export function ViewControls({ includeTreeLayout = true, labelled = false }: { includeTreeLayout?: boolean; labelled?: boolean }) {
  const {
    viewMode, parsedPlan, treeCompareEnabled, densitySelection, applyDensityPreset,
    nodeIndicatorMetric, setNodeIndicatorMetric, sankeyMetric, setSankeyMetric, flameMetric, setFlameMetric,
  } = usePlan();
  const densityId = useId();
  if (!parsedPlan) return null;
  const hasActualStats = parsedPlan.hasActualStats;

  if (viewMode === 'hierarchical') {
    const indicatorOptions: SegmentOption<NodeIndicatorMetric>[] = [
      { value: 'cost', label: 'Cost' },
      ...(hasActualStats
        ? ([
            { value: 'actualRows', label: 'A-Rows' },
            { value: 'actualTime', label: 'A-Time' },
            { value: 'starts', label: 'Starts' },
          ] as SegmentOption<NodeIndicatorMetric>[])
        : []),
    ];
    return (
      <>
        <div className="shrink-0 flex items-center gap-1.5">
          <FieldLabel htmlFor={densityId} labelled={labelled}>Nodes</FieldLabel>
          <select
            id={densityId}
            className={CONTROL}
            title="Node density"
            value={densitySelection}
            onChange={(e) => applyDensityPreset(e.target.value as DensityPreset)}
          >
            {densitySelection === 'custom' && <option value="custom" disabled>Custom</option>}
            {DENSITY_PRESET_ORDER.map((preset) => (
              <option key={preset} value={preset}>{DENSITY_PRESET_LABELS[preset]}</option>
            ))}
          </select>
          <CustomizeViewMenu triggerClassName={CONTROL} />
        </div>
        {!treeCompareEnabled && (
          <MetricSelect
            label="Indicator"
            title="Node indicator — the metric shown as each node's badge"
            value={nodeIndicatorMetric}
            options={indicatorOptions}
            onChange={setNodeIndicatorMetric}
            labelled={labelled}
          />
        )}
        {includeTreeLayout && !treeCompareEnabled && <TreeLayoutStrip />}
      </>
    );
  }

  if (viewMode === 'sankey') {
    const options: SegmentOption<SankeyMetric>[] = [
      { value: 'rows', label: hasActualStats ? 'E-Rows' : 'Rows', title: 'Estimated rows' },
      { value: 'cost', label: 'Cost' },
      ...(hasActualStats
        ? ([
            { value: 'actualRows', label: 'Total rows', title: 'Total rows over all starts (A-Rows is already cumulative)' },
            { value: 'actualTime', label: 'A-Time' },
          ] as SegmentOption<SankeyMetric>[])
        : []),
    ];
    return <MetricSelect label="Flow" title="Flow metric — what the band widths represent" value={sankeyMetric} options={options} onChange={setSankeyMetric} labelled />;
  }

  if (viewMode === 'flame') {
    const options: SegmentOption<FlameMetric>[] = [
      { value: 'cost', label: 'Cost' },
      ...(hasActualStats
        ? ([
            { value: 'actualTime', label: 'A-Time' },
            { value: 'actualRows', label: 'A-Rows' },
          ] as SegmentOption<FlameMetric>[])
        : []),
    ];
    // Without runtime stats the flame graph falls back to cost.
    const effective: FlameMetric = hasActualStats ? flameMetric : 'cost';
    return <MetricSelect label="Metric" title="Flame graph metric — what the bar widths represent" value={effective} options={options} onChange={setFlameMetric} labelled />;
  }

  return null;
}

/**
 * Legend on/off, for the views that draw one. Icon-only by default (the
 * toolbar is tight); pass `iconOnly={false}` where a text chip has room.
 */
export function LegendToggle({
  className,
  pressedClassName = CONTROL_PRESSED,
  iconOnly = true,
}: {
  className?: string;
  pressedClassName?: string;
  iconOnly?: boolean;
}) {
  const { viewMode, legendVisible, setLegendVisible } = usePlan();
  if (!LEGEND_VIEWS.includes(viewMode)) return null;
  return (
    <button
      type="button"
      aria-pressed={legendVisible}
      aria-label="Toggle legend"
      onClick={() => setLegendVisible(!legendVisible)}
      title={legendVisible ? 'Hide the colour and badge legend' : 'Show the colour and badge legend'}
      className={`${className ?? (iconOnly ? ICON_CONTROL : CONTROL)} ${legendVisible ? pressedClassName : ''} flex items-center gap-1.5`}
    >
      <svg className="w-3.5 h-3.5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h2m4 0h10M4 12h2m4 0h10M4 18h2m4 0h10" />
      </svg>
      {!iconOnly && <span>Legend</span>}
    </button>
  );
}

/** Canvas controls and non-modal sheets: the graph stays usable while inspecting. */
export function WorkspaceTools({ narrow }: { narrow: boolean }) {
  const { filterPanelCollapsed, setFilterPanelCollapsed, selectedNodes, activePlanIndex, filteredNodes, parsedPlan } = usePlan();
  const [panel, setPanel] = useState<'filters' | 'details' | null>(null);
  const [dismissedSelection, setDismissedSelection] = useState('');
  const filtersButton = useRef<HTMLButtonElement>(null);
  const detailsButton = useRef<HTMLButtonElement>(null);
  const sheet = useRef<HTMLElement>(null);
  const selectionKey = selectedNodes.length ? `${activePlanIndex}:${selectedNodes.map(n => n.id).join(',')}` : '';
  const activePanel = narrow ? panel ?? (selectionKey && selectionKey !== dismissedSelection ? 'details' : null) : null;

  function closePanel() {
    setDismissedSelection(selectionKey);
    setPanel(null);
    // A selection-driven sheet must not steal focus from graph navigation.
    // Only restore focus when it was inside the sheet being dismissed.
    if (sheet.current?.contains(document.activeElement)) {
      (activePanel === 'filters' ? filtersButton : detailsButton).current?.focus();
    }
  }

  useEffect(() => {
    if (!activePanel) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.defaultPrevented) return;
      // Let nested dialogs/popovers handle their own Escape first.
      const target = event.target;
      if (!(target instanceof Element) || target.closest('[role="dialog"]') !== sheet.current) return;
      event.preventDefault();
      event.stopPropagation();
      setDismissedSelection(selectionKey);
      setPanel(null);
      (activePanel === 'filters' ? filtersButton : detailsButton).current?.focus();
    };
    document.addEventListener('keydown', onKeyDown, true);
    return () => document.removeEventListener('keydown', onKeyDown, true);
  }, [activePanel, selectionKey]);

  const detailsTitle = selectedNodes.length === 0
    ? 'Overview'
    : selectedNodes.length === 1
      ? `Operation #${selectedNodes[0].id}`
      : `${selectedNodes.length} operations`;

  return <>
    {/* `@container`: the view controls show their field labels only when the
        toolbar is wide enough (see FieldLabel). */}
    <div role="group" aria-label="Workspace controls" className="@container shrink-0 flex items-center gap-2 px-3 py-2 border-b border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900">
      <button ref={filtersButton} type="button" className={`${CONTROL} shrink-0`}
        aria-expanded={narrow ? activePanel === 'filters' : !filterPanelCollapsed}
        onClick={() => narrow ? activePanel === 'filters' ? closePanel() : setPanel('filters') : setFilterPanelCollapsed(!filterPanelCollapsed)}>
        Filters <span className="font-mono">{filteredNodes.length}/{parsedPlan?.allNodes.length ?? 0}</span>
      </button>
      {/* One row at any width: Filters (and Details, when narrow) keep the row's ends and the
          view controls between them scroll sideways (no scrollbar) once the
          canvas is too narrow to hold them — never wrap onto a second row. The
          padding keeps focus rings from being clipped by the scroller. */}
      <div className="flex-1 min-w-0 -my-1 px-1 py-1 flex flex-nowrap items-center gap-2 overflow-x-auto scrollbar-none">
        <ViewControls />
        <LegendToggle />
      </div>
      {/* Wide screens toggle the docked details panel from its edge tab; only the
          narrow layout (no docked panels) needs a button to open the sheet. */}
      {narrow && (
        <button ref={detailsButton} type="button" className={`${CONTROL} shrink-0`}
          aria-expanded={activePanel === 'details'}
          onClick={() => activePanel === 'details' ? closePanel() : setPanel('details')}>
          Details{selectedNodes.length === 1 ? ` #${selectedNodes[0].id}` : ''}
        </button>
      )}
    </div>
    {activePanel && <section ref={sheet} role="dialog" aria-modal="false" aria-label={activePanel === 'filters' ? 'Filters' : detailsTitle}
      className="absolute z-40 right-2 top-12 bottom-2 w-[340px] max-w-[calc(100%-1rem)] flex flex-col rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 shadow-xl max-sm:top-auto max-sm:left-2 max-sm:w-auto max-sm:max-h-[50%]">
      <div className="flex shrink-0 items-center justify-between border-b border-slate-200 dark:border-slate-800 p-2">
        <h2 className="text-sm font-semibold">{activePanel === 'filters' ? 'Filters' : detailsTitle}</h2>
        <button type="button" className={CONTROL} onClick={closePanel} aria-label="Close workspace panel">Close</button>
      </div>
      <div className="min-h-0 overflow-y-auto overscroll-contain">
        {activePanel === 'filters' ? <FilterPanelBody /> : selectedNodes.length ? <NodeDetailBody /> : <NoSelectionBody hideTitle />}
      </div>
    </section>}
  </>;
}
