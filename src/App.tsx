import { useEffect, useMemo, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { PlanProvider, usePlan } from './hooks/usePlanContext';
import { Header } from './components/Header';
import { InputPanel } from './components/InputPanel';
import { NavRibbon } from './components/NavRibbon';
import { FilterPanel } from './components/FilterPanel';
import { VisualizationTabs } from './components/VisualizationTabs';
import { NodeDetailPanel } from './components/NodeDetailPanel';
import { CommandPalette } from './components/CommandPalette';
import { ShortcutsOverlay } from './components/ShortcutsOverlay';
import { ShareResultDialog } from './components/ShareResultDialog';
import { PopoutWindow } from './components/PopoutWindow';
import { BaselineScriptModal } from './components/BaselineScriptModal';
import { MetadataExplorer } from './components/metadata/MetadataExplorer';
import { SAMPLE_PLANS_BY_CATEGORY } from './examples';
import type { SamplePlan } from './examples';

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

// Two of these ship a schema-metadata bundle (Cardinality Trap, Partition Range
// Iterator) so the front page showcases the metadata feature; the other two keep
// format variety (DBMS_XPLAN + XBI). Cards with metadata get a badge (below).
const FEATURED_EXAMPLES: Array<{ category: SamplePlan['category']; name: string }> = [
  { category: 'sql_monitor', name: 'Cardinality Trap (NL)' },
  { category: 'dbms_xplan', name: 'Simple Plan' },
  { category: 'sql_monitor', name: 'Partition Range Iterator' },
  { category: 'xbi', name: 'XBI TPC-DS Query' },
];

function getFeaturedExamples(): SamplePlan[] {
  const usedByCategory = new Map<SamplePlan['category'], Set<SamplePlan>>();
  const results: SamplePlan[] = [];

  for (const { category, name } of FEATURED_EXAMPLES) {
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

function categoryLabel(category: SamplePlan['category']): string {
  switch (category) {
    case 'dbms_xplan':
      return 'DBMS_XPLAN';
    case 'sql_monitor':
      return 'SQL Monitor';
    case 'json':
      return 'JSON';
    case 'xbi':
      return 'XBI';
    default:
      return category;
  }
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
  const {
    plans, activePlanIndex, viewMode, visualizationMaximized, setVisualizationMaximized, loadAndParsePlan,
    metadataBundle, metadataPopoutOpen, setMetadataPopoutOpen,
    baselineDialogOpen, setBaselineDialogOpen,
  } = usePlan();
  const activeParsedPlan = plans[activePlanIndex]?.parsedPlan ?? null;
  const anyPlanParsed = plans.some(p => p.parsedPlan);
  const featuredExamples = useMemo(() => getFeaturedExamples(), []);
  const isComparisonWorkspace = viewMode === 'compare';
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

  return (
    <div className="flex flex-col h-screen bg-slate-100 dark:bg-slate-950 text-slate-900 dark:text-slate-100 overflow-hidden">
      <CommandPalette />
      <ShortcutsOverlay />
      <ShareResultDialog />
      {baselineDialogOpen && (
        <BaselineScriptModal
          initialSqlId={activeParsedPlan?.sqlId ?? ''}
          initialPlanHash={activeParsedPlan?.planHashValue ?? ''}
          onClose={() => setBaselineDialogOpen(false)}
        />
      )}
      {metadataPopoutOpen && metadataBundle && (
        <PopoutWindow title="Metadata Explorer" onClose={() => setMetadataPopoutOpen(false)}>
          <MetadataPopoutContent onReturn={() => setMetadataPopoutOpen(false)} />
        </PopoutWindow>
      )}
      {!visualizationMaximized && <Header />}
      {!visualizationMaximized && <InputPanel />}
      {anyPlanParsed && <NavRibbon />}

      {anyPlanParsed && (
        <div className="flex flex-1 min-h-0 overflow-hidden">
          {!isComparisonWorkspace && (
            <FilterPanel
              panelWidth={panelWidths.left}
              onResizeStart={startResize('left')}
            />
          )}
          <main className="flex-1 flex flex-col relative min-w-0 bg-slate-50 dark:bg-slate-900 border-r border-l border-slate-200 dark:border-slate-800 shadow-inner">
            <VisualizationTabs />
          </main>
          {!isComparisonWorkspace && (
            <NodeDetailPanel
              panelWidth={panelWidths.right}
              onResizeStart={startResize('right')}
            />
          )}
        </div>
      )}

      {!anyPlanParsed && (
        <div className="flex-1 flex flex-col items-center justify-center text-neutral-500 dark:text-neutral-400 p-8">
          <svg
            className="w-16 h-16 mb-4 text-neutral-300 dark:text-neutral-700"
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
          <h2 className="text-xl font-semibold text-neutral-700 dark:text-neutral-300 mb-2">
            No Execution Plan Loaded
          </h2>

          <div className="flex flex-col sm:flex-row items-center gap-2 sm:gap-4 mb-6 text-sm text-center">
            <div className="flex items-center gap-2">
              <span className="flex items-center justify-center w-5 h-5 rounded-full bg-slate-200 dark:bg-slate-800 text-xs font-semibold text-slate-600 dark:text-slate-300">1</span>
              <span>Paste DBMS_XPLAN / SQL Monitor output above, or drop a file</span>
            </div>
            <span className="hidden sm:inline text-neutral-300 dark:text-neutral-700">&rarr;</span>
            <div className="flex items-center gap-2">
              <span className="flex items-center justify-center w-5 h-5 rounded-full bg-slate-200 dark:bg-slate-800 text-xs font-semibold text-slate-600 dark:text-slate-300">2</span>
              <span>Explore the interactive plan tree</span>
            </div>
            <span className="hidden sm:inline text-neutral-300 dark:text-neutral-700">&rarr;</span>
            <div className="flex items-center gap-2">
              <span className="flex items-center justify-center w-5 h-5 rounded-full bg-slate-200 dark:bg-slate-800 text-xs font-semibold text-slate-600 dark:text-slate-300">3</span>
              <span>Click nodes for details &amp; findings</span>
            </div>
          </div>

          {featuredExamples.length > 0 && (
            <div className="w-full max-w-2xl mb-4">
              <div className="text-xs font-semibold uppercase tracking-wide text-neutral-400 dark:text-neutral-500 mb-2 text-center">
                Try an example
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                {featuredExamples.map((sample) => (
                  <button
                    key={`${sample.category}-${sample.name}`}
                    type="button"
                    onClick={() => loadAndParsePlan(sample.data, sample.metadata)}
                    className="flex items-center justify-between gap-2 px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 hover:border-slate-300 dark:hover:border-slate-600 hover:bg-slate-50 dark:hover:bg-slate-700/50 transition-colors text-left"
                  >
                    <span className="text-sm font-medium text-slate-700 dark:text-slate-200 truncate">
                      {sample.name}
                    </span>
                    <span className="shrink-0 flex items-center gap-1">
                      {sample.metadata && (
                        <span
                          title="Includes a schema-metadata bundle — tables, indexes, columns & stats on the Metadata tab"
                          className="text-[10px] font-semibold uppercase tracking-wide text-violet-600 dark:text-violet-300 bg-violet-100 dark:bg-violet-900/40 px-1.5 py-0.5 rounded"
                        >
                          metadata
                        </span>
                      )}
                      <span className="text-[10px] font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500 bg-slate-100 dark:bg-slate-900 px-1.5 py-0.5 rounded">
                        {categoryLabel(sample.category)}
                      </span>
                    </span>
                  </button>
                ))}
              </div>
              <div className="text-xs text-neutral-400 dark:text-neutral-500 text-center mt-2">
                All examples are available under &quot;Load Example&quot; in the input panel above.
              </div>
            </div>
          )}

          <div className="w-full max-w-2xl mb-4">
            <div className="rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800/50 px-4 py-3 text-left">
              <div className="text-sm font-medium text-slate-700 dark:text-slate-200">
                Or generate a link straight from the database
              </div>
              <p className="mt-1 text-xs text-neutral-500 dark:text-neutral-400">
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
                    className="text-xs font-semibold text-blue-600 dark:text-blue-400 hover:underline"
                  >
                    Get the script
                  </a>
                  <a
                    href="https://github.com/davidbudac/ora-explain-plan-viz/blob/main/scripts/README.md#plan_to_urlsql"
                    target="_blank"
                    rel="noreferrer"
                    className="text-xs font-semibold text-blue-600 dark:text-blue-400 hover:underline"
                  >
                    Read the docs &rarr;
                  </a>
                </div>
              </div>
            </div>
          </div>

          <div className="text-sm text-neutral-400 dark:text-neutral-500">
            Repeated DBMS_XPLAN sections with different plan hash values are imported as separate plan tabs.
          </div>
        </div>
      )}
    </div>
  );
}

function App() {
  return (
    <PlanProvider>
      <AppContent />
    </PlanProvider>
  );
}

export default App;
