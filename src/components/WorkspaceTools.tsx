import { useEffect, useId, useRef, useState } from 'react';
import { usePlan } from '../hooks/usePlanContext';
import { DENSITY_PRESET_ORDER, DENSITY_PRESET_LABELS } from '../lib/density';
import type { DensityPreset } from '../lib/density';
import type { FlameMetric, NodeIndicatorMetric, SankeyMetric } from '../lib/types';
import { FilterPanelBody } from './FilterPanel';
import { NodeDetailBody, NoSelectionBody } from './NodeDetailPanel';
import { CustomizeViewMenu } from './CustomizeViewMenu';
import { TreeLayoutControls } from './views/TreeLayoutControls';
import { FOCUS_RING } from './ui';

const CONTROL_BASE = `min-h-8 rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-xs text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 ${FOCUS_RING}`;
const CONTROL = `${CONTROL_BASE} px-2.5`;

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
 * The tree's layout strip, wired to the context. Focus/redraw go through
 * `treeViewActionsRef`, published by the single-plan tree while it is mounted.
 */
function TreeLayoutStrip() {
  const {
    treeLayoutDirection, setTreeLayoutDirection, treeViewActionsRef, selectedNodes,
  } = usePlan();
  return (
    <TreeLayoutControls
      className="shadow-none! bg-transparent! dark:bg-transparent! backdrop-blur-none! flex-nowrap! shrink-0"
      direction={treeLayoutDirection}
      onDirectionChange={setTreeLayoutDirection}
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
    nodeIndicatorMetric, setNodeIndicatorMetric, sankeyMetric, setSankeyMetric, flameMetric, setFlameMetric, experimentalSubView,
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

  if (viewMode === 'experimental' && experimentalSubView === 'flame') {
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
      <button ref={filtersButton} type="button" data-tour="filters" className={`${CONTROL} shrink-0`}
        aria-expanded={narrow ? activePanel === 'filters' : !filterPanelCollapsed}
        onClick={() => narrow ? activePanel === 'filters' ? closePanel() : setPanel('filters') : setFilterPanelCollapsed(!filterPanelCollapsed)}>
        Filters <span className="font-mono">{filteredNodes.length}/{parsedPlan?.allNodes.length ?? 0}</span>
      </button>
      {/* One row at any width: Filters (and Details, when narrow) keep the row's ends and the
          view controls between them scroll sideways (no scrollbar) once the
          canvas is too narrow to hold them — never wrap onto a second row. The
          padding keeps focus rings from being clipped by the scroller. */}
      <div data-tour="view-controls" className="flex-1 min-w-0 -my-1 px-1 py-1 flex flex-nowrap items-center gap-2 overflow-x-auto scrollbar-none">
        <ViewControls />
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
        <h2 className="text-sm font-medium">{activePanel === 'filters' ? 'Filters' : detailsTitle}</h2>
        <button type="button" className={CONTROL} onClick={closePanel} aria-label="Close workspace panel">Close</button>
      </div>
      <div className="min-h-0 overflow-y-auto overscroll-contain">
        {activePanel === 'filters' ? <FilterPanelBody /> : selectedNodes.length ? <NodeDetailBody /> : <NoSelectionBody hideTitle />}
      </div>
    </section>}
  </>;
}
