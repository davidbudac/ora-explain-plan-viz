import { useCallback, useEffect, useMemo, useState } from 'react';
import { usePlan } from '../hooks/usePlanContext';
import { useNarrowWorkspace } from '../hooks/useNarrowWorkspace';
import { loadSettings, saveSettings } from '../lib/settings';
import { buildOverview, SHOW_OVERVIEW_EVENT } from '../lib/overview';
import type { OverviewItem } from '../lib/overview';
import { SEVERITY_STYLES } from '../lib/severityStyles';
import type { ParsedPlan } from '../lib/types';
import { FOCUS_RING } from './ui';
import { GatherScriptModal } from './GatherScriptModal';

const NEUTRAL_CHIP = 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300';

const CHIP_LABELS: Record<OverviewItem['kind'], string> = {
  finding: '',
  hotspot: 'Hotspot',
  mismatch: 'Estimate',
};

interface AnalysisOverviewProps {
  /** False in views / workspaces the card does not float over (it keeps tracking plans meanwhile). */
  active: boolean;
  /** Distance from the top of the view area in px (clears each view's own top chrome / the focus pill). */
  top?: number;
}

/**
 * Compact, dismissible "where to look first" card shown once per newly loaded
 * plan: the top three advisor findings (topped up with the hottest operation
 * and the worst row estimate), each with a Focus action. Built entirely from
 * `advisorReport` / `hottestNodeId` — see `lib/overview.ts`.
 */
export function AnalysisOverview({ active, top = 12 }: AnalysisOverviewProps) {
  const { parsedPlan, advisorReport, hottestNodeId, metadataBundle, selectNode, focusMode } = usePlan();
  const narrow = useNarrowWorkspace();
  const hasBundle = !!metadataBundle;

  // Plan the card is currently open for. Plans already offered once are remembered
  // (most recent few) so switching views or plan tabs does not pop the card up again.
  const [openFor, setOpenFor] = useState<ParsedPlan | null>(null);
  const [trackedPlan, setTrackedPlan] = useState<ParsedPlan | null>(null);
  const [seen, setSeen] = useState<readonly ParsedPlan[]>([]);
  const [autoShow, setAutoShow] = useState(() => loadSettings().showAnalysisOverview !== false);
  const [collapsed, setCollapsed] = useState(true);
  const [gatherOpen, setGatherOpen] = useState(false);

  const items = useMemo(
    () => buildOverview(parsedPlan, advisorReport, { hasBundle, hottestNodeId }),
    [parsedPlan, advisorReport, hasBundle, hottestNodeId],
  );

  // A newly loaded plan opens the card once (adjusting state during render, not in an effect).
  if (parsedPlan !== trackedPlan) {
    setTrackedPlan(parsedPlan);
    if (parsedPlan && !seen.includes(parsedPlan)) {
      setSeen([...seen.slice(-19), parsedPlan]);
      if (autoShow && items.length > 0) setOpenFor(parsedPlan);
    }
  }

  // "Show analysis overview" (command palette) reopens it on demand, even when empty.
  useEffect(() => {
    const reopen = () => {
      setOpenFor(parsedPlan);
      setCollapsed(false);
    };
    window.addEventListener(SHOW_OVERVIEW_EVENT, reopen);
    return () => window.removeEventListener(SHOW_OVERVIEW_EVENT, reopen);
  }, [parsedPlan]);

  const dismiss = useCallback(() => setOpenFor(null), []);

  const onAutoShowChange = (hide: boolean) => {
    setAutoShow(!hide);
    saveSettings({ showAnalysisOverview: !hide });
  };

  const visible = active && !!parsedPlan && openFor === parsedPlan;
  const sqlId = parsedPlan?.sqlId;
  const showBody = !narrow || !collapsed;

  // Wide: anchored top-right of the canvas; in focus mode the right edge belongs to the
  // selection inspector, so it moves to the top-left (below the floating pill).
  const placement = narrow
    ? 'inset-x-3 bottom-3'
    : focusMode
      ? 'left-3 w-[380px] max-w-[calc(100%-1.5rem)]'
      : 'right-3 w-[380px] max-w-[calc(100%-1.5rem)]';
  const style = narrow ? { maxHeight: '45%' } : { top, maxHeight: `calc(100% - ${top + 12}px)` };

  return (
    <>
      {visible && (
        <section
          role="region"
          aria-label="Analysis overview"
          onKeyDown={(event) => {
            if (event.key === 'Escape') {
              event.stopPropagation();
              dismiss();
            }
          }}
          className={`absolute z-40 flex flex-col overflow-hidden rounded-xl border border-slate-200 dark:border-slate-700 bg-white/95 dark:bg-slate-900/95 backdrop-blur shadow-lg text-slate-700 dark:text-slate-200 ${placement}`}
          style={style}
        >
          <header className="flex items-center gap-2 px-3 py-2 shrink-0">
            <h2 className="text-xs font-semibold text-slate-900 dark:text-slate-100">
              Where to look first
            </h2>
            {narrow && (
              <button
                type="button"
                onClick={() => setCollapsed((value) => !value)}
                aria-expanded={!collapsed}
                className={`rounded-md px-1.5 py-0.5 text-[11px] font-medium text-blue-600 dark:text-blue-400 hover:bg-blue-50 dark:hover:bg-blue-900/30 ${FOCUS_RING}`}
              >
                {collapsed ? `Show ${items.length || ''}`.trim() : 'Hide'}
              </button>
            )}
            <button
              type="button"
              onClick={dismiss}
              aria-label="Dismiss analysis overview"
              className={`ml-auto rounded-md p-1 text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 ${FOCUS_RING}`}
            >
              <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden="true">
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 6l12 12M18 6L6 18" />
              </svg>
            </button>
          </header>

          {showBody && (
            <div className="min-h-0 overflow-y-auto border-t border-slate-100 dark:border-slate-800">
              {items.length === 0 ? (
                <p className="px-3 py-3 text-xs text-slate-500 dark:text-slate-400">
                  Nothing stood out in this plan. Open the Details panel for the full operation list.
                </p>
              ) : (
                <ul className="divide-y divide-slate-100 dark:divide-slate-800">
                  {items.map((item) => (
                    <OverviewRow
                      key={item.key}
                      item={item}
                      onFocus={item.nodeId === null ? undefined : () => selectNode(item.nodeId)}
                      onAttach={item.needsMetadata ? () => setGatherOpen(true) : undefined}
                    />
                  ))}
                </ul>
              )}
              <label className="flex items-center gap-2 border-t border-slate-100 dark:border-slate-800 px-3 py-2 text-[11px] text-slate-500 dark:text-slate-400 cursor-pointer">
                <input
                  type="checkbox"
                  checked={!autoShow}
                  onChange={(event) => onAutoShowChange(event.target.checked)}
                  className={`h-3.5 w-3.5 rounded border-slate-300 dark:border-slate-600 ${FOCUS_RING}`}
                />
                Don&apos;t show after parsing
              </label>
            </div>
          )}
        </section>
      )}
      {gatherOpen && (
        <GatherScriptModal
          initialSqlId={sqlId}
          initialMode={sqlId ? 'sqlid' : 'manual'}
          onClose={() => setGatherOpen(false)}
        />
      )}
    </>
  );
}

function OverviewRow({ item, onFocus, onAttach }: { item: OverviewItem; onFocus?: () => void; onAttach?: () => void }) {
  const chipClass = item.severity ? SEVERITY_STYLES[item.severity].chip : NEUTRAL_CHIP;
  const chipLabel = item.severity ?? CHIP_LABELS[item.kind];
  return (
    <li className="px-3 py-2.5">
      <div className="flex items-start gap-2">
        <span className={`mt-px shrink-0 rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${chipClass}`}>
          {chipLabel}
        </span>
        <span className="text-xs font-semibold text-slate-900 dark:text-slate-100 break-words">{item.title}</span>
      </div>
      <p className="mt-1 text-[11px] leading-snug text-slate-600 dark:text-slate-400">{item.why}</p>
      {item.nodeLabel && (
        <p className="mt-1 truncate font-mono text-[11px] text-slate-500 dark:text-slate-400" title={item.nodeLabel}>
          {item.nodeLabel}
        </p>
      )}
      {(onFocus || onAttach) && (
        <div className="mt-1.5 flex items-center gap-3">
          {onFocus && (
            <button
              type="button"
              onClick={onFocus}
              className={`rounded-md border border-slate-200 dark:border-slate-700 px-2 py-0.5 text-[11px] font-semibold text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 ${FOCUS_RING}`}
            >
              Focus
            </button>
          )}
          {onAttach && (
            <button
              type="button"
              onClick={onAttach}
              className={`rounded-md px-1 py-0.5 text-[11px] font-medium text-blue-600 dark:text-blue-400 underline-offset-2 hover:underline ${FOCUS_RING}`}
            >
              Attach metadata…
            </button>
          )}
        </div>
      )}
    </li>
  );
}
