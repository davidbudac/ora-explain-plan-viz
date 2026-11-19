// Experimental → Replay: an animated replay of how the plan ran. Three
// layouts play the same script (lib/replay.ts) from one shared clock, so
// switching layouts keeps the playhead.
//
// Keys: Space play/pause · [ / ] previous/next chapter.

import { useCallback, useEffect, useMemo, useState } from 'react';
import { usePlan } from '../../../../hooks/usePlanContext';
import { buildReplayScript } from '../../../../lib/replay';
import type { ReplayScript } from '../../../../lib/replay';
import { FOCUS_RING } from '../../../ui';
import { ReplayLanes } from './ReplayLanes';
import { TierBadge } from './ReplayControls';
import { ReplayStory } from './ReplayStory';
import { ReplayTree } from './ReplayTree';
import { useReplayClock } from './useReplayClock';

type ReplayLayout = 'tree' | 'lanes' | 'story';

const LAYOUTS: { id: ReplayLayout; label: string; title: string }[] = [
  { id: 'tree', label: 'Tree', title: 'The whole plan tree, animated' },
  { id: 'lanes', label: 'Lanes', title: 'One lane per operation: when it ran and how many rows it produced' },
  { id: 'story', label: 'Story', title: 'Chapter by chapter, zoomed to what each chapter is about' },
];

const LAYOUT_STORAGE_KEY = 'ora-explain-viz-replay-layout';

function loadLayout(): ReplayLayout {
  try {
    const saved = localStorage.getItem(LAYOUT_STORAGE_KEY);
    return LAYOUTS.some((l) => l.id === saved) ? (saved as ReplayLayout) : 'tree';
  } catch {
    return 'tree';
  }
}

function saveLayout(layout: ReplayLayout) {
  try {
    localStorage.setItem(LAYOUT_STORAGE_KEY, layout);
  } catch {
    // localStorage may be unavailable (private browsing); the choice just isn't remembered.
  }
}

/** Keys typed into a field, or pressed inside a dialog or menu, belong there. */
function ownsKeys(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName)) return true;
  return target.closest('[role="dialog"], [role="menu"], [role="listbox"]') !== null;
}

/** Space on a focused button or link activates it rather than playing. */
const ownsSpace = (target: EventTarget | null) =>
  target instanceof HTMLElement && (target.tagName === 'BUTTON' || target.tagName === 'A');

export function ReplayView() {
  const { parsedPlan } = usePlan();
  const script = useMemo(() => (parsedPlan ? buildReplayScript(parsedPlan) : null), [parsedPlan]);
  // A new plan gets a fresh stage, which rewinds the clock.
  const [stage, setStage] = useState({ script, key: 0 });
  if (stage.script !== script) setStage({ script, key: stage.key + 1 });

  if (!script) {
    return (
      <div className="h-full grid place-items-center text-sm text-slate-500 dark:text-slate-400">
        This plan has no operations to replay.
      </div>
    );
  }
  return <ReplayStage key={stage.key} script={script} />;
}

function ReplayStage({ script }: { script: ReplayScript }) {
  const { theme, palette, selectedNodeIds, selectNode } = usePlan();
  const [layout, setLayoutState] = useState<ReplayLayout>(loadLayout);
  const [showAhead, setShowAhead] = useState(true);
  const clock = useReplayClock(script);
  const selectedIds = useMemo(() => new Set(selectedNodeIds), [selectedNodeIds]);
  const onSelect = useCallback((id: number) => selectNode(id), [selectNode]);

  const setLayout = (next: ReplayLayout) => {
    setLayoutState(next);
    saveLayout(next);
  };

  const { toggle, nextChapter, prevChapter } = clock;
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.altKey || ownsKeys(event.target)) return;
      if (event.key === ' ') {
        if (ownsSpace(event.target)) return;
        event.preventDefault();
        toggle();
      } else if (event.key === ']') {
        event.preventDefault();
        nextChapter();
      } else if (event.key === '[') {
        event.preventDefault();
        prevChapter();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [toggle, nextChapter, prevChapter]);

  const props = { script, clock, isDark: theme === 'dark', palette, selectedIds, onSelect };
  return (
    <div className="h-full flex flex-col bg-white dark:bg-slate-900">
      <div className="flex items-center gap-3 px-3 py-1.5 border-b border-slate-200 dark:border-slate-800">
        <div role="group" aria-label="Replay layout" className="flex bg-slate-100 dark:bg-slate-800 rounded-md p-0.5 gap-0.5">
          {LAYOUTS.map((l) => (
            <button
              key={l.id}
              type="button"
              title={l.title}
              aria-pressed={layout === l.id}
              onClick={() => setLayout(l.id)}
              className={`px-2 py-0.5 text-[11px] rounded font-medium ${FOCUS_RING} ${
                layout === l.id
                  ? 'bg-white dark:bg-slate-700 text-slate-900 dark:text-white shadow-sm'
                  : 'text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200'
              }`}
            >
              {l.label}
            </button>
          ))}
        </div>
        <TierBadge script={script} />
        <span className="min-w-0 truncate text-[11px] text-slate-500 dark:text-slate-400" title={script.tierReason}>
          {script.tierReason}
        </span>
        {layout === 'lanes' && (
          <label className="ml-auto shrink-0 flex items-center gap-1 text-[11px] text-slate-600 dark:text-slate-300">
            <input type="checkbox" checked={showAhead} onChange={(e) => setShowAhead(e.target.checked)} />
            Show what's ahead
          </label>
        )}
      </div>
      <div className="flex-1 min-h-0">
        {layout === 'tree' && <ReplayTree {...props} />}
        {layout === 'lanes' && <ReplayLanes {...props} showAhead={showAhead} />}
        {layout === 'story' && <ReplayStory {...props} />}
      </div>
    </div>
  );
}
