import { useEffect, useRef, useState } from 'react';
import { usePlan } from '../hooks/usePlanContext';
import { DENSITY_PRESET_ORDER, DENSITY_PRESET_LABELS } from '../lib/density';
import type { DensityPreset } from '../lib/density';
import { FilterPanelBody } from './FilterPanel';
import { NodeDetailBody, NoSelectionBody } from './NodeDetailPanel';

const CONTROL = 'min-h-8 rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-2.5 text-xs text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500';

/** Canvas controls and non-modal sheets: the graph stays usable while inspecting. */
export function WorkspaceTools({ narrow }: { narrow: boolean }) {
  const { filterPanelCollapsed, setFilterPanelCollapsed, detailPanelCollapsed,
    setDetailPanelCollapsed, densitySelection, applyDensityPreset, viewMode,
    selectedNodes, activePlanIndex, filteredNodes, parsedPlan } = usePlan();
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
      if ((event.target as HTMLElement).closest('[role="dialog"]') !== sheet.current) return;
      event.preventDefault();
      event.stopPropagation();
      setDismissedSelection(selectionKey);
      setPanel(null);
      (activePanel === 'filters' ? filtersButton : detailsButton).current?.focus();
    };
    document.addEventListener('keydown', onKeyDown, true);
    return () => document.removeEventListener('keydown', onKeyDown, true);
  }, [activePanel, selectionKey]);

  return <>
    <div className="shrink-0 flex flex-wrap items-center gap-2 px-3 py-2 border-b border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900" aria-label="Workspace controls">
      <button ref={filtersButton} type="button" className={CONTROL}
        aria-expanded={narrow ? activePanel === 'filters' : !filterPanelCollapsed}
        onClick={() => narrow ? activePanel === 'filters' ? closePanel() : setPanel('filters') : setFilterPanelCollapsed(!filterPanelCollapsed)}>
        Filters <span className="font-mono">{filteredNodes.length}/{parsedPlan?.allNodes.length ?? 0}</span>
      </button>
      {viewMode === 'hierarchical' && <label className="flex items-center gap-2 text-xs text-slate-600 dark:text-slate-300">
        Nodes
        <select className={CONTROL} aria-label="Node density" value={densitySelection}
          onChange={e => applyDensityPreset(e.target.value as DensityPreset)}>
          {densitySelection === 'custom' && <option value="custom" disabled>Custom</option>}
          {DENSITY_PRESET_ORDER.map(preset => <option key={preset} value={preset}>{DENSITY_PRESET_LABELS[preset]}</option>)}
        </select>
      </label>}
      <button ref={detailsButton} type="button" className={`${CONTROL} ml-auto`}
        aria-expanded={narrow ? activePanel === 'details' : !detailPanelCollapsed}
        onClick={() => narrow ? activePanel === 'details' ? closePanel() : setPanel('details') : setDetailPanelCollapsed(!detailPanelCollapsed)}>
        Details{selectedNodes.length === 1 ? ` #${selectedNodes[0].id}` : ''}
      </button>
    </div>
    {activePanel && <section ref={sheet} role="dialog" aria-modal="false" aria-label={activePanel === 'filters' ? 'Plan filters' : 'Operation details'}
      className="absolute z-40 right-2 top-12 bottom-2 w-[340px] max-w-[calc(100%-1rem)] flex flex-col rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 shadow-xl max-sm:top-auto max-sm:left-2 max-sm:w-auto max-sm:max-h-[50%]">
      <div className="flex shrink-0 items-center justify-between border-b border-slate-200 dark:border-slate-800 p-2">
        <h2 className="text-sm font-semibold">{activePanel === 'filters' ? 'Filters and display' : 'Details'}</h2>
        <button type="button" className={CONTROL} onClick={closePanel} aria-label="Close workspace panel">Close</button>
      </div>
      <div className="min-h-0 overflow-y-auto overscroll-contain">
        {activePanel === 'filters' ? <FilterPanelBody /> : selectedNodes.length ? <NodeDetailBody /> : <NoSelectionBody />}
      </div>
    </section>}
  </>;
}
