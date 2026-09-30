import { useCallback, useEffect, useMemo, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { PlanProvider, usePlan } from './hooks/usePlanContext';
import { AiProvider, useAi } from './hooks/useAiAnalysis';
import { AiAnalysisDialog } from './components/AiAnalysisDialog';
import { InputPanel } from './components/InputPanel';
import { MaximizedTopBar } from './components/NavRibbon';
import { FilterPanel } from './components/FilterPanel';
import { VisualizationTabs } from './components/VisualizationTabs';
import { NodeDetailPanel } from './components/NodeDetailPanel';
import { PanelEdgeTab } from './components/PanelEdgeTab';
import { FocusOverlay } from './components/FocusOverlay';
import { WorkspaceTools } from './components/WorkspaceTools';
import { useNarrowWorkspace } from './hooks/useNarrowWorkspace';
import { CommandPalette } from './components/CommandPalette';
import { ShortcutsOverlay } from './components/ShortcutsOverlay';
import { ShareResultDialog } from './components/ShareResultDialog';
import { PopoutWindow } from './components/PopoutWindow';
import { BaselineScriptModal } from './components/BaselineScriptModal';
import { ClientReportModal } from './components/ClientReportModal';
import { MetadataExplorer } from './components/metadata/MetadataExplorer';
import { BundleAttachChooser, ExampleBadges } from './components/InputPanel';
import { CopyButton, FOCUS_RING } from './components/ui';
import { SAMPLE_PLANS_BY_CATEGORY, FEATURED_SAMPLE_PLANS } from './examples';
import type { SamplePlan } from './examples';
import { SUPPORTED_FORMATS } from './lib/formats';
import { describeRecentPlan } from './lib/session';
import type { RecentPlan } from './lib/session';
import { dragHasFiles } from './lib/dropFiles';

function MetadataPopoutContent({ onReturn }: { onReturn: () => void }) {
  const { metadataBundle } = usePlan();
  if (!metadataBundle) return null;
  return (
    <>
      <div className="shrink-0 px-4 py-2 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between gap-3">
        <span className="text-xs font-semibold text-slate-700 dark:text-slate-300">Metadata Explorer</span>
        <button
          type="button"
          onClick={onReturn}
          className="h-7 px-2.5 text-[11px] font-semibold rounded border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
        >
          Return to tab
        </button>
      </div>
      <div className="flex-1 min-h-0">
        <MetadataExplorer bundle={metadataBundle} />
      </div>
    </>
  );
}

// Fallback when no example is flagged `featured` in src/examples/descriptions.ts.
// Two of these ship a schema-metadata bundle (Cardinality Trap, Partition Range
// Iterator) so the front page showcases the metadata feature; the other two keep
// format variety (DBMS_XPLAN + XBI). Cards with metadata get a badge (below).
const FALLBACK_FEATURED_EXAMPLES: Array<{ category: SamplePlan['category']; name: string }> = [
  { category: 'sql_monitor', name: 'Cardinality Trap (NL)' },
  { category: 'dbms_xplan', name: 'Simple Plan' },
  { category: 'sql_monitor', name: 'Partition Range Iterator' },
  { category: 'xbi', name: 'XBI TPC-DS Query' },
];

function getFeaturedExamples(): SamplePlan[] {
  if (FEATURED_SAMPLE_PLANS.length > 0) return FEATURED_SAMPLE_PLANS;

  const usedByCategory = new Map<SamplePlan['category'], Set<SamplePlan>>();
  const results: SamplePlan[] = [];

  for (const { category, name } of FALLBACK_FEATURED_EXAMPLES) {
    const pool = SAMPLE_PLANS_BY_CATEGORY[category] as SamplePlan[] | undefined;
    if (!pool || pool.length === 0) continue;

    let used = usedByCategory.get(category);
    if (!used) {
      used = new Set();
      usedByCategory.set(category, used);
    }

    const exact = pool.find((p) => p.name === name && !used!.has(p));
    const fallback = exact ?? pool.find((p) => !used!.has(p));
    if (!fallback) continue;

    used.add(fallback);
    results.push(fallback);
  }

  return results;
}

function ExampleChip({
  sample,
  onLoad,
}: {
  sample: SamplePlan;
  onLoad: (sample: SamplePlan) => void;
}) {
  return (
    <button
      type="button"
      onClick={() => onLoad(sample)}
      className={`flex flex-col gap-0.5 px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 hover:border-slate-300 dark:hover:border-slate-600 hover:bg-slate-50 dark:hover:bg-slate-700/50 transition-colors text-left ${FOCUS_RING}`}
    >
      <span className="flex items-center justify-between gap-2">
        <span className="text-sm font-medium text-slate-700 dark:text-slate-200 truncate">
          {sample.name}
        </span>
        <ExampleBadges sample={sample} />
      </span>
      {sample.description && (
        <span className="text-xs leading-snug text-slate-500 dark:text-slate-400">{sample.description}</span>
      )}
    </button>
  );
}

function ExampleChipGrid({
  samples,
  onLoad,
}: {
  samples: SamplePlan[];
  onLoad: (sample: SamplePlan) => void;
}) {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
      {samples.map((sample) => (
        <ExampleChip key={`${sample.category}-${sample.name}`} sample={sample} onLoad={onLoad} />
      ))}
    </div>
  );
}

/**
 * Shown in the main area when the active plan tab is an empty slot the user
 * just added — otherwise the workspace is a blank void with no way forward.
 */
function EmptySlotState({
  slotLabel,
  otherPlanLabel,
  samples,
  onLoad,
}: {
  slotLabel: string;
  otherPlanLabel: string | null;
  samples: SamplePlan[];
  onLoad: (sample: SamplePlan) => void;
}) {
  return (
    <div className="flex-1 flex flex-col items-center justify-center text-slate-500 dark:text-slate-400 p-8 overflow-y-auto">
      <svg
        className="w-12 h-12 mb-3 text-slate-300 dark:text-slate-700"
        fill="none"
        viewBox="0 0 24 24"
        stroke="currentColor"
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth={1}
          d="M9 17v-2m3 2v-4m3 4v-6m2 10H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
        />
      </svg>
      <h2 className="text-base font-semibold text-slate-700 dark:text-slate-300 mb-1">
        {slotLabel} is empty
      </h2>
      <p className="text-sm mb-6 text-center">
        Paste a plan above or load an example to compare
        {otherPlanLabel ? ` against ${otherPlanLabel}` : ''}.
      </p>

      {samples.length > 0 && (
        <div className="w-full max-w-2xl">
          <div className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400 mb-2 text-center">
            Try an example
          </div>
          <ExampleChipGrid samples={samples} onLoad={onLoad} />
        </div>
      )}
    </div>
  );
}

/**
 * Window-level file drop: files dropped anywhere load through the same
 * pipeline as the input panel, and the browser never navigates away to the
 * dropped file (which used to throw the whole session away).
 */
function useWindowFileDrop(onFiles: (files: File[]) => void): boolean {
  const [dragging, setDragging] = useState(false);

  useEffect(() => {
    // dragenter/dragleave fire for every element crossed; count them so the
    // overlay only hides once the drag has really left the window.
    let depth = 0;
    const reset = () => {
      depth = 0;
      setDragging(false);
    };
    const onDragEnter = (event: DragEvent) => {
      if (!dragHasFiles(event.dataTransfer)) return;
      event.preventDefault();
      depth += 1;
      setDragging(true);
    };
    const onDragOver = (event: DragEvent) => {
      if (!dragHasFiles(event.dataTransfer)) return;
      // Required for the drop event to fire (and to block file navigation).
      event.preventDefault();
      if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy';
    };
    const onDragLeave = (event: DragEvent) => {
      if (!dragHasFiles(event.dataTransfer)) return;
      depth = Math.max(0, depth - 1);
      if (depth === 0 || event.relatedTarget === null) reset();
    };
    const onDrop = (event: DragEvent) => {
      if (!dragHasFiles(event.dataTransfer)) return;
      event.preventDefault();
      reset();
      const files = Array.from(event.dataTransfer?.files ?? []);
      if (files.length > 0) onFiles(files);
    };
    window.addEventListener('dragenter', onDragEnter);
    window.addEventListener('dragover', onDragOver);
    window.addEventListener('dragleave', onDragLeave);
    window.addEventListener('drop', onDrop);
    window.addEventListener('dragend', reset);
    return () => {
      window.removeEventListener('dragenter', onDragEnter);
      window.removeEventListener('dragover', onDragOver);
      window.removeEventListener('dragleave', onDragLeave);
      window.removeEventListener('drop', onDrop);
      window.removeEventListener('dragend', reset);
    };
  }, [onFiles]);

  return dragging;
}

function DropOverlay() {
  return (
    <div
      aria-hidden="true"
      className="pointer-events-none fixed inset-0 z-[90] flex items-center justify-center bg-slate-900/40 dark:bg-black/60 p-6"
    >
      <div className="max-w-md w-full rounded-2xl border-2 border-dashed border-blue-400 dark:border-blue-500 bg-white/95 dark:bg-slate-900/95 px-6 py-8 text-center shadow-2xl">
        <svg className="mx-auto w-10 h-10 mb-3 text-blue-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 16V4m0 0l-4 4m4-4l4 4M4 16v2a2 2 0 002 2h12a2 2 0 002-2v-2" />
        </svg>
        <div className="text-base font-semibold text-slate-800 dark:text-slate-100">
          Drop a plan, a metadata bundle or an annotated-plan JSON
        </div>
        <div className="mt-1 text-xs text-slate-500 dark:text-slate-400">
          Drop a plan together with its bundle to attach it in one go. Files are read locally, never uploaded.
        </div>
      </div>
    </div>
  );
}

function RecentPlansList({
  entries,
  onOpen,
  onRemove,
}: {
  entries: RecentPlan[];
  onOpen: (entry: RecentPlan) => void;
  onRemove: (id: string) => void;
}) {
  return (
    <ul className="flex flex-col gap-1.5">
      {entries.map((entry) => (
        <li
          key={entry.id}
          className="flex items-stretch rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 hover:border-slate-300 dark:hover:border-slate-600 transition-colors"
        >
          <button
            type="button"
            onClick={() => onOpen(entry)}
            className={`min-w-0 flex-1 px-3 py-2 text-left rounded-l-lg hover:bg-slate-50 dark:hover:bg-slate-700/50 ${FOCUS_RING}`}
          >
            <span className="block text-sm font-medium text-slate-700 dark:text-slate-200 truncate">{entry.label}</span>
            <span className="block text-xs text-slate-500 dark:text-slate-400 truncate">{describeRecentPlan(entry)}</span>
          </button>
          <button
            type="button"
            onClick={() => onRemove(entry.id)}
            aria-label={`Remove ${entry.label} from recent plans`}
            title="Remove from recent plans"
            className={`shrink-0 w-9 flex items-center justify-center rounded-r-lg text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700/50 ${FOCUS_RING}`}
          >
            <svg className="w-3.5 h-3.5" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" aria-hidden="true">
              <path d="M4 4l8 8M12 4l-8 8" />
            </svg>
          </button>
        </li>
      ))}
    </ul>
  );
}

const PLAN_SNIPPETS: Array<{ title: string; hint: string; sql: string }> = [
  {
    title: 'DBMS_XPLAN with runtime statistics',
    hint: 'Run the statement with the GATHER_PLAN_STATISTICS hint (or STATISTICS_LEVEL=ALL) first to get A-Rows / A-Time.',
    sql: "SELECT * FROM TABLE(DBMS_XPLAN.DISPLAY_CURSOR(:sql_id, NULL, 'ALLSTATS LAST +PREDICATE +NOTE +OUTLINE'));",
  },
  {
    title: 'SQL Monitor XML report (richest)',
    hint: 'Needs the Tuning Pack. Includes actual rows, time, ASH activity and bind values.',
    sql: "SELECT DBMS_SQL_MONITOR.REPORT_SQL_MONITOR(sql_id => :sql_id, type => 'XML', report_level => 'ALL') FROM dual;",
  },
];

function HowToGetAPlan() {
  return (
    <details className="group rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800/50 text-left">
      <summary
        className={`cursor-pointer select-none list-none flex items-center justify-between gap-2 px-4 py-3 text-sm font-medium text-slate-700 dark:text-slate-200 rounded-lg ${FOCUS_RING}`}
      >
        How to get a plan
        <svg className="w-4 h-4 text-slate-400 motion-safe:transition-transform group-open:rotate-180" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </summary>
      <div className="px-4 pb-4 flex flex-col gap-3">
        {PLAN_SNIPPETS.map((snippet) => (
          <div key={snippet.title}>
            <div className="flex items-center justify-between gap-2">
              <div className="text-xs font-semibold text-slate-700 dark:text-slate-300">{snippet.title}</div>
              <CopyButton text={snippet.sql} label="Copy SQL" />
            </div>
            <pre className="mt-1 overflow-x-auto whitespace-pre-wrap break-all font-mono text-xs px-2 py-1.5 rounded bg-slate-100 dark:bg-slate-950 text-slate-700 dark:text-slate-300 border border-slate-200 dark:border-slate-800">
              {snippet.sql}
            </pre>
            <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">{snippet.hint}</p>
          </div>
        ))}
        <p className="text-xs text-slate-500 dark:text-slate-400">
          Paste the output above — every format below is detected automatically:
        </p>
        <ul className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-1 text-xs">
          {SUPPORTED_FORMATS.map((format) => (
            <li key={format.id} className="text-slate-600 dark:text-slate-300">
              <span className="font-medium">{format.name}</span>
              <span className="text-slate-500 dark:text-slate-400"> — {format.hint}</span>
            </li>
          ))}
        </ul>
      </div>
    </details>
  );
}

const LEFT_PANEL_MIN = 250;
const RIGHT_PANEL_MIN = 300;
const PANEL_MAX_RATIO = 0.3;
const CENTER_MIN_WIDTH = 400;
const DEFAULT_LEFT_PANEL_WIDTH = 280;
const DEFAULT_RIGHT_PANEL_WIDTH = 320;

type ResizeSide = 'left' | 'right';

interface PanelWidths {
  left: number;
  right: number;
}

interface ResizeState {
  side: ResizeSide;
  startX: number;
  startLeft: number;
  startRight: number;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function getMaxLeftWidth(viewportWidth: number, rightWidth: number): number {
  const byRatio = Math.floor(viewportWidth * PANEL_MAX_RATIO);
  const byCenter = viewportWidth - CENTER_MIN_WIDTH - rightWidth;
  return Math.max(LEFT_PANEL_MIN, Math.min(byRatio, byCenter));
}

function getMaxRightWidth(viewportWidth: number, leftWidth: number): number {
  const byRatio = Math.floor(viewportWidth * PANEL_MAX_RATIO);
  const byCenter = viewportWidth - CENTER_MIN_WIDTH - leftWidth;
  return Math.max(RIGHT_PANEL_MIN, Math.min(byRatio, byCenter));
}

function clampPanelWidths(widths: PanelWidths, viewportWidth: number): PanelWidths {
  let left = clamp(widths.left, LEFT_PANEL_MIN, getMaxLeftWidth(viewportWidth, widths.right));
  const right = clamp(widths.right, RIGHT_PANEL_MIN, getMaxRightWidth(viewportWidth, left));
  left = clamp(left, LEFT_PANEL_MIN, getMaxLeftWidth(viewportWidth, right));
  return { left, right };
}

function AppContent() {
  const narrowWorkspace = useNarrowWorkspace();
  const {
    plans, activePlanIndex, viewMode, visualizationMaximized, setVisualizationMaximized, loadExample,
    loadFiles, recentPlans, openRecentPlan, removeRecentPlan, pendingBundleChoice, resolveBundleChoice,
    metadataBundle, metadataPopoutOpen, setMetadataPopoutOpen,
    baselineDialogOpen, setBaselineDialogOpen,
    reportDialogOpen, setReportDialogOpen,
    filterPanelCollapsed, setFilterPanelCollapsed,
    detailPanelCollapsed, setDetailPanelCollapsed,
    focusMode, setFocusMode,
  } = usePlan();
  const { aiDialogOpen, closeAiDialog } = useAi();
  const activeSlot = plans[activePlanIndex];
  const activeParsedPlan = activeSlot?.parsedPlan ?? null;
  const anyPlanParsed = plans.some(p => p.parsedPlan);
  const featuredExamples = useMemo(() => getFeaturedExamples(), []);
  const isComparisonWorkspace = viewMode === 'compare';
  // The comparison workspace has no docked side panels to hide, so focus mode
  // simply doesn't apply there.
  const focusModeActive = focusMode && !isComparisonWorkspace && !narrowWorkspace;
  // A slot the user added with "+ Add Plan" but hasn't filled yet: the plan
  // views and the details rail have nothing to say about it.
  const activeSlotEmpty = anyPlanParsed && !activeParsedPlan && !isComparisonWorkspace;
  const otherPlanLabel = useMemo(() => {
    const other = plans.find((slot, index) => index !== activePlanIndex && slot.parsedPlan);
    return other ? other.customLabel || other.label : null;
  }, [plans, activePlanIndex]);
  const loadSample = useCallback(
    (sample: SamplePlan) => {
      void loadExample(sample);
    },
    [loadExample]
  );
  const openRecent = useCallback(
    (entry: RecentPlan) => {
      void openRecentPlan(entry);
    },
    [openRecentPlan]
  );
  const handleDroppedFiles = useCallback(
    (files: File[]) => {
      void loadFiles(files);
    },
    [loadFiles]
  );
  const draggingFiles = useWindowFileDrop(handleDroppedFiles);
  const [panelWidths, setPanelWidths] = useState<PanelWidths>({
    left: DEFAULT_LEFT_PANEL_WIDTH,
    right: DEFAULT_RIGHT_PANEL_WIDTH,
  });
  const [resizeState, setResizeState] = useState<ResizeState | null>(null);

  useEffect(() => {
    const onResize = () => {
      setPanelWidths((current) => clampPanelWidths(current, window.innerWidth));
    };
    onResize();
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  useEffect(() => {
    if (!resizeState) return;

    const onPointerMove = (event: PointerEvent) => {
      const deltaX = event.clientX - resizeState.startX;
      const viewportWidth = window.innerWidth;

      if (resizeState.side === 'left') {
        const nextLeft = clamp(
          resizeState.startLeft + deltaX,
          LEFT_PANEL_MIN,
          getMaxLeftWidth(viewportWidth, resizeState.startRight)
        );
        setPanelWidths((current) => ({ ...current, left: nextLeft }));
        return;
      }

      const nextRight = clamp(
        resizeState.startRight - deltaX,
        RIGHT_PANEL_MIN,
        getMaxRightWidth(viewportWidth, resizeState.startLeft)
      );
      setPanelWidths((current) => ({ ...current, right: nextRight }));
    };

    const onPointerUp = () => {
      setResizeState(null);
    };

    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onPointerUp);

    return () => {
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', onPointerUp);
    };
  }, [resizeState]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'f' || event.ctrlKey || event.metaKey || event.altKey || event.shiftKey) return;
      if (!anyPlanParsed) return;
      const tag = (event.target as HTMLElement)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      if ((event.target as HTMLElement)?.isContentEditable) return;
      event.preventDefault();
      setVisualizationMaximized(!visualizationMaximized);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [anyPlanParsed, visualizationMaximized, setVisualizationMaximized]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'z' || event.ctrlKey || event.metaKey || event.altKey || event.shiftKey) return;
      // Inert in the comparison workspace, which has no docked panels to hide.
      if (!anyPlanParsed || isComparisonWorkspace) return;
      const tag = (event.target as HTMLElement)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      if ((event.target as HTMLElement)?.isContentEditable) return;
      event.preventDefault();
      setFocusMode(!focusMode);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [anyPlanParsed, isComparisonWorkspace, focusMode, setFocusMode]);

  const startResize = (side: ResizeSide) => (event: ReactPointerEvent<HTMLButtonElement>) => {
    if (event.button !== 0) return;
    event.preventDefault();
    setResizeState({
      side,
      startX: event.clientX,
      startLeft: panelWidths.left,
      startRight: panelWidths.right,
    });
  };

  // Keyboard resizing from a focused splitter (←/→ in 16 px steps, Shift for
  // coarse steps, Home/End to the limits). Same clamping as a pointer drag:
  // only the panel being resized moves.
  const resizePanelBy = (side: ResizeSide) => (delta: number) => {
    const viewportWidth = window.innerWidth;
    setPanelWidths((current) =>
      side === 'left'
        ? { ...current, left: clamp(current.left + delta, LEFT_PANEL_MIN, getMaxLeftWidth(viewportWidth, current.right)) }
        : { ...current, right: clamp(current.right + delta, RIGHT_PANEL_MIN, getMaxRightWidth(viewportWidth, current.left)) }
    );
  };
  // The window resize listener above re-renders on every resize, so reading
  // the viewport here keeps the splitters' aria-valuemax current.
  const viewportWidth = window.innerWidth;

  return (
    <div className="flex flex-col h-screen bg-slate-100 dark:bg-slate-950 text-slate-900 dark:text-slate-100 overflow-hidden">
      <CommandPalette />
      <ShortcutsOverlay />
      <ShareResultDialog />
      {draggingFiles && <DropOverlay />}
      <BundleAttachChooser
        pending={pendingBundleChoice}
        plans={plans}
        onResolve={(index) => {
          void resolveBundleChoice(index);
        }}
      />
      {baselineDialogOpen && (
        <BaselineScriptModal
          initialSqlId={activeParsedPlan?.sqlId ?? ''}
          initialPlanHash={activeParsedPlan?.planHashValue ?? ''}
          onClose={() => setBaselineDialogOpen(false)}
        />
      )}
      {aiDialogOpen && <AiAnalysisDialog onClose={closeAiDialog} />}
      {reportDialogOpen && activeParsedPlan && (
        <ClientReportModal onClose={() => setReportDialogOpen(false)} />
      )}
      {metadataPopoutOpen && metadataBundle && (
        <PopoutWindow title="Metadata Explorer" onClose={() => setMetadataPopoutOpen(false)}>
          <MetadataPopoutContent onReturn={() => setMetadataPopoutOpen(false)} />
        </PopoutWindow>
      )}
      {/* One bar for the whole app: InputPanel owns it (brand, input drawer,
          plan/view tabs, actions). Maximizing swaps it for the navigation-only
          slim variant so the canvas keeps a way back out. */}
      {visualizationMaximized && anyPlanParsed ? <MaximizedTopBar /> : <InputPanel />}

      {anyPlanParsed && (
        <div className="flex flex-1 min-h-0 overflow-hidden">
          {!isComparisonWorkspace && !focusModeActive && !narrowWorkspace && (
            <FilterPanel
              panelWidth={panelWidths.left}
              onResizeStart={startResize('left')}
              onResizeBy={resizePanelBy('left')}
              minWidth={LEFT_PANEL_MIN}
              maxWidth={getMaxLeftWidth(viewportWidth, panelWidths.right)}
            />
          )}
          <main className="flex-1 flex flex-col relative min-w-0 bg-slate-50 dark:bg-slate-900 border-r border-l border-slate-200 dark:border-slate-800 shadow-inner">
            {!isComparisonWorkspace && !focusModeActive && !activeSlotEmpty && (
              <WorkspaceTools narrow={narrowWorkspace} />
            )}
            {activeSlotEmpty ? (
              <EmptySlotState
                slotLabel={activeSlot?.customLabel || activeSlot?.label || 'This plan'}
                otherPlanLabel={otherPlanLabel}
                samples={featuredExamples}
                onLoad={loadSample}
              />
            ) : (
              <VisualizationTabs />
            )}
            {focusModeActive && !activeSlotEmpty && <FocusOverlay />}
            {!isComparisonWorkspace && !focusModeActive && !narrowWorkspace && !filterPanelCollapsed && (
              <PanelEdgeTab
                side="left"
                label="Hide filters"
                onClick={() => setFilterPanelCollapsed(true)}
              />
            )}
            {!isComparisonWorkspace && !focusModeActive && !narrowWorkspace && !activeSlotEmpty && !detailPanelCollapsed && (
              <PanelEdgeTab
                side="right"
                label="Hide details"
                onClick={() => setDetailPanelCollapsed(true)}
              />
            )}
          </main>
          {!isComparisonWorkspace && !focusModeActive && !narrowWorkspace && !activeSlotEmpty && (
            <NodeDetailPanel
              panelWidth={panelWidths.right}
              onResizeStart={startResize('right')}
              onResizeBy={resizePanelBy('right')}
              minWidth={RIGHT_PANEL_MIN}
              maxWidth={getMaxRightWidth(viewportWidth, panelWidths.left)}
            />
          )}
        </div>
      )}

      {!anyPlanParsed && (
        <div className="flex-1 overflow-y-auto">
          <div className="min-h-full flex flex-col items-center justify-center text-slate-500 dark:text-slate-400 p-8">
            <svg
              className="w-16 h-16 mb-4 text-slate-300 dark:text-slate-700"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              aria-hidden="true"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={1}
                d="M9 17v-2m3 2v-4m3 4v-6m2 10H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
              />
            </svg>
            <h2 className="text-xl font-semibold text-slate-700 dark:text-slate-300 mb-2">
              No Execution Plan Loaded
            </h2>

            <div className="flex flex-col sm:flex-row items-center gap-2 sm:gap-4 mb-3 text-sm text-center">
              <div className="flex items-center gap-2">
                <span className="flex items-center justify-center w-5 h-5 rounded-full bg-slate-200 dark:bg-slate-800 text-xs font-semibold text-slate-600 dark:text-slate-300">1</span>
                <span>Paste a plan above, or drop a file anywhere on this page</span>
              </div>
              <span className="hidden sm:inline text-slate-300 dark:text-slate-700">&rarr;</span>
              <div className="flex items-center gap-2">
                <span className="flex items-center justify-center w-5 h-5 rounded-full bg-slate-200 dark:bg-slate-800 text-xs font-semibold text-slate-600 dark:text-slate-300">2</span>
                <span>Explore the interactive plan tree</span>
              </div>
              <span className="hidden sm:inline text-slate-300 dark:text-slate-700">&rarr;</span>
              <div className="flex items-center gap-2">
                <span className="flex items-center justify-center w-5 h-5 rounded-full bg-slate-200 dark:bg-slate-800 text-xs font-semibold text-slate-600 dark:text-slate-300">3</span>
                <span>Click nodes for details &amp; findings</span>
              </div>
            </div>

            <p className="mb-6 max-w-2xl text-xs text-center text-slate-500 dark:text-slate-400">
              Accepts{' '}
              {SUPPORTED_FORMATS.map((format, index) => (
                <span key={format.id}>
                  {index > 0 && (index === SUPPORTED_FORMATS.length - 1 ? ' and ' : ', ')}
                  <span title={format.hint} className="font-medium text-slate-600 dark:text-slate-300">{format.name}</span>
                </span>
              ))}
              .
            </p>

            {recentPlans.length > 0 && (
              <section className="w-full max-w-2xl mb-6" aria-labelledby="recent-plans-heading">
                <h3
                  id="recent-plans-heading"
                  className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400 mb-2 text-center"
                >
                  Recent
                </h3>
                <RecentPlansList entries={recentPlans} onOpen={openRecent} onRemove={removeRecentPlan} />
              </section>
            )}

            {featuredExamples.length > 0 && (
              <div className="w-full max-w-2xl mb-4">
                <div className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400 mb-2 text-center">
                  Try an example
                </div>
                <ExampleChipGrid samples={featuredExamples} onLoad={loadSample} />
                <div className="text-xs text-slate-400 dark:text-slate-500 text-center mt-2">
                  All examples are available under &quot;Load Example&quot; in the top bar.
                </div>
              </div>
            )}

            <div className="w-full max-w-2xl mb-4">
              <HowToGetAPlan />
            </div>

            <div className="w-full max-w-2xl mb-4">
              <div className="rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800/50 px-4 py-3 text-left">
                <div className="text-sm font-medium text-slate-700 dark:text-slate-200">
                  Or generate a link straight from the database
                </div>
                <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                  Skip copy/paste: <code className="font-mono">plan_to_url.sql</code> fetches the
                  plan for a <code className="font-mono">sql_id</code>, gzip-compresses and encodes it
                  inside the database, and prints a ready-to-click link that opens the plan here.
                </p>
                <div className="mt-2 flex items-center justify-between gap-3 flex-wrap">
                  <code className="font-mono text-xs px-2 py-1 rounded bg-slate-100 dark:bg-slate-950 text-slate-700 dark:text-slate-300 border border-slate-200 dark:border-slate-800">
                    SQL&gt; @plan_to_url.sql an05rsj1up1k5
                  </code>
                  <div className="flex items-center gap-3 whitespace-nowrap">
                    <a
                      href="https://github.com/davidbudac/ora-explain-plan-viz/blob/main/scripts/plan_to_url.sql"
                      target="_blank"
                      rel="noreferrer"
                      className={`text-xs font-semibold text-blue-600 dark:text-blue-400 hover:underline rounded ${FOCUS_RING}`}
                    >
                      Get the script
                    </a>
                    <a
                      href="https://github.com/davidbudac/ora-explain-plan-viz/blob/main/scripts/README.md#plan_to_urlsql"
                      target="_blank"
                      rel="noreferrer"
                      className={`text-xs font-semibold text-blue-600 dark:text-blue-400 hover:underline rounded ${FOCUS_RING}`}
                    >
                      Read the docs &rarr;
                    </a>
                  </div>
                </div>
              </div>
            </div>

            <div className="text-sm text-slate-400 dark:text-slate-500 text-center">
              Repeated DBMS_XPLAN sections with different plan hash values are imported as separate plan tabs.
            </div>

            <p className="mt-4 max-w-2xl text-xs text-center text-slate-400 dark:text-slate-500">
              Everything runs in your browser: plans are never uploaded. Your last session and recent plans are kept
              only in this browser&apos;s local storage. The public build counts anonymous page views with GoatCounter
              and sends no plan data.
            </p>
          </div>
        </div>
      )}
    </div>
  );
}

function App() {
  return (
    <PlanProvider>
      <AiProvider>
        <AppContent />
      </AiProvider>
    </PlanProvider>
  );
}

export default App;
