import { useEffect, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { PlanProvider, usePlan } from './hooks/usePlanContext';
import { Header } from './components/Header';
import { InputPanel } from './components/InputPanel';
import { PlanTabs } from './components/PlanTabs';
import { FilterPanel } from './components/FilterPanel';
import { VisualizationTabs } from './components/VisualizationTabs';
import { NodeDetailPanel } from './components/NodeDetailPanel';
import { Legend } from './components/Legend';

const LEFT_PANEL_MIN = 220;
const RIGHT_PANEL_MIN = 260;
const PANEL_MAX_RATIO = 0.25;
const CENTER_MIN_WIDTH = 440;
const DEFAULT_LEFT_PANEL_WIDTH = 250;
const DEFAULT_RIGHT_PANEL_WIDTH = 300;

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
  let right = clamp(widths.right, RIGHT_PANEL_MIN, getMaxRightWidth(viewportWidth, left));
  left = clamp(left, LEFT_PANEL_MIN, getMaxLeftWidth(viewportWidth, right));
  return { left, right };
}

function AppContent() {
  const { plans, viewMode } = usePlan();
  const anyPlanParsed = plans.some(p => p.parsedPlan);
  const isCompareView = viewMode === 'compare';
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
    <div className="flex flex-col h-screen bg-[var(--app-bg)] dark:bg-[var(--app-bg-dark)] text-[var(--text-primary)] dark:text-[var(--text-primary-dark)]">
      <Header />
      <InputPanel />
      <PlanTabs />

      {anyPlanParsed && (
        <div className="flex flex-1 min-h-0 overflow-hidden">
          {!isCompareView && (
            <FilterPanel
              panelWidth={panelWidths.left}
              onResizeStart={startResize('left')}
            />
          )}
          <div className="flex-1 flex flex-col relative min-w-0 bg-[var(--surface-raised)] dark:bg-[var(--surface-raised-dark)] border-r border-l border-[var(--border-color)] dark:border-[var(--border-color-dark)]">
            <VisualizationTabs />
            <Legend />
          </div>
          {!isCompareView && (
            <NodeDetailPanel
              panelWidth={panelWidths.right}
              onResizeStart={startResize('right')}
            />
          )}
        </div>
      )}

      {!anyPlanParsed && (
        <div className="flex-1 flex flex-col items-center justify-center text-[var(--text-secondary)] dark:text-[var(--text-secondary-dark)] p-8">
          <svg
            className="w-16 h-16 mb-4 text-[var(--text-muted)] dark:text-[var(--text-muted-dark)]"
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
          <h2 className="text-xl font-semibold text-[var(--text-primary)] dark:text-[var(--text-primary-dark)] mb-2">
            No Execution Plan Loaded
          </h2>
          <p className="text-center max-w-md mb-4">
            Paste your Oracle DBMS_XPLAN output in the text area above, or load one of the sample plans to get started.
          </p>
          <div className="text-sm text-[var(--text-muted)] dark:text-[var(--text-muted-dark)]">
            Supports standard DBMS_XPLAN.DISPLAY output format
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
