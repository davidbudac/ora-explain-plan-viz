import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import type { ClipboardEvent as ReactClipboardEvent, KeyboardEvent as ReactKeyboardEvent } from 'react';
import { usePlan, useDraftInput } from '../hooks/usePlanContext';
import type { PendingBundleChoice } from '../hooks/usePlanContext';
import { getSourceDisplayName } from '../lib/parser';
import { formatNumberShort } from '../lib/format';
import { SAMPLE_PLAN_GROUPS, SAMPLE_CATEGORY_BADGES, type SamplePlan } from '../examples';
import { looksLikeMetadataBundle } from '../lib/metadata/bundle';
import { INPUT_PLACEHOLDER, looksLikePlan } from '../lib/formats';
import { describeRecentPlan, type RecentPlan } from '../lib/session';
import type { PlanSlot } from '../lib/compare';
import { MetadataChip } from './MetadataChip';
import { getDopDowngrade } from '../lib/planSignals';
import type { ParsedPlan } from '../lib/types';
import { isDbAgentEnabled } from '../lib/agent/client';
import { ConnectPanel } from './ConnectPanel';
import { BrandMark, HeaderActions } from './Header';
import { MaximizeButton, PlanTabsCluster, SqlIdTitle, ViewTabStrip } from './NavRibbon';
import { TOP_BAR_LABEL_ATTR, useTopBarMode } from '../hooks/useTopBarMode';
import {
  Dialog,
  DialogBody,
  DialogFooter,
  FOCUS_RING,
  FOCUS_RING_INSET,
  BTN_SECONDARY,
  useMenuKeyboard,
} from './ui';

const dbAgentEnabled = isDbAgentEnabled();

const IS_MAC = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform ?? '');
const PARSE_SHORTCUT_LABEL = IS_MAC ? '⌘⏎' : 'Ctrl+Enter';

const MENU_ITEM_CLASS =
  `w-full px-3 py-2 text-left hover:bg-slate-100 dark:hover:bg-slate-800 focus-visible:bg-slate-100 dark:focus-visible:bg-slate-800 ${FOCUS_RING_INSET}`;
const MENU_HEADING_CLASS =
  'px-3 pt-2 pb-1 text-[11px] font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wide';
const CHIP_CLASS =
  'px-2 py-0.5 border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-slate-700 dark:text-slate-300 rounded text-[11px] font-medium';
const BADGE_BASE = 'text-[10px] font-semibold uppercase tracking-wide px-1.5 py-0.5 rounded';

/** Marks a top-bar button's text as collapsible (see `useTopBarMode`). */
const topBarLabelProps = { [TOP_BAR_LABEL_ATTR]: '' };
// Heroicons outline: database cylinder, and a book for the examples menu.
const DB_ICON_PATH =
  'M4 7v10c0 2.21 3.582 4 8 4s8-1.79 8-4V7M4 7c0 2.21 3.582 4 8 4s8-1.79 8-4M4 7c0-2.21 3.582-4 8-4s8 1.79 8 4m0 5c0 2.21-3.582 4-8 4s-8-1.79-8-4';
const EXAMPLE_ICON_PATH =
  'M12 6.253v13C10.832 18.477 9.246 18 7.5 18S4.168 18.477 3 19.253v-13C4.168 5.477 5.754 5 7.5 5s3.332.477 4.5 1.253zm0 0C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253';
/** Below this width the SQL-ID title text would only show a letter or two plus an ellipsis. */
const MIN_TITLE_TEXT_PX = 40;

/**
 * Format + metadata badges for an example (shared by the Load Example menu
 * and the start screen's example cards).
 */
export function ExampleBadges({ sample }: { sample: SamplePlan }) {
  return (
    <span className="shrink-0 flex items-center gap-1">
      {sample.metadata && (
        <span
          title="Includes a schema-metadata bundle — tables, indexes, columns & stats on the Metadata tab"
          className={`${BADGE_BASE} text-violet-600 dark:text-violet-300 bg-violet-100 dark:bg-violet-900/40`}
        >
          metadata
        </span>
      )}
      <span className={`${BADGE_BASE} text-slate-500 dark:text-slate-400 bg-slate-100 dark:bg-slate-900`}>
        {SAMPLE_CATEGORY_BADGES[sample.category] ?? sample.category}
      </span>
    </span>
  );
}

export function InputPanel() {
  const {
    setInput, parsePlan, loadExample, clearPlan, requestClearPlan, removePlanSlot,
    error, parsedPlan, inputPanelCollapsed: isCollapsed, setInputPanelCollapsed: setIsCollapsed,
    hasMultiplePlans, plans, activePlanIndex, metadataBundle, metadataBundleWarning, detachMetadataBundle,
    connectPanelOpen: showConnectPanel, setConnectPanelOpen: setShowConnectPanel,
    bundleNotice, dismissBundleNotice, recentPlans, openRecentPlan, removeRecentPlan,
  } = usePlan();
  const draftInput = useDraftInput();
  const { labelsCollapsed } = useTopBarMode();
  const [showSampleMenu, setShowSampleMenu] = useState(false);
  const [showParseHint, setShowParseHint] = useState(false);
  const [titleTextHidden, setTitleTextHidden] = useState(false);
  const titleRef = useRef<HTMLHeadingElement>(null);
  const menuWrapRef = useRef<HTMLDivElement>(null);
  const menuTriggerRef = useRef<HTMLButtonElement>(null);
  const menuId = useId();
  const hintId = useId();

  const closeSampleMenu = useCallback((restoreFocus = true) => {
    setShowSampleMenu(false);
    if (restoreFocus) menuTriggerRef.current?.focus();
  }, []);
  const { menuProps, focusFirst } = useMenuKeyboard<HTMLDivElement>({ onClose: () => closeSampleMenu(true) });

  // Move focus into the menu when it opens (keyboard and pointer alike).
  useEffect(() => {
    if (showSampleMenu) focusFirst();
  }, [showSampleMenu, focusFirst]);

  // Hide the SQL-ID title text once the top bar squeezes it to a sliver. The
  // text only turns transparent, so its box (and this measurement) is stable.
  useLayoutEffect(() => {
    const el = titleRef.current;
    if (!el) return;
    const check = () => setTitleTextHidden(el.getBoundingClientRect().width < MIN_TITLE_TEXT_PX);
    check();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(check);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  // Close the menu when clicking outside it.
  useEffect(() => {
    if (!showSampleMenu) return;
    const handleClickOutside = (event: MouseEvent) => {
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (menuWrapRef.current && !menuWrapRef.current.contains(target)) {
        setShowSampleMenu(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [showSampleMenu]);

  const handleParse = () => {
    setShowParseHint(false);
    void parsePlan();
  };

  const handleLoadSample = (sample: SamplePlan) => {
    closeSampleMenu(false);
    void loadExample(sample);
  };

  const handleOpenRecent = (entry: RecentPlan) => {
    closeSampleMenu(false);
    void openRecentPlan(entry);
  };

  const handleClear = () => {
    setShowParseHint(false);
    // Only a loaded plan needs a confirmation; a bare draft just clears.
    if (parsedPlan) void requestClearPlan();
    else clearPlan();
  };

  // First-run nicety: a paste that is recognisably a plan (or a metadata
  // bundle) and fills the box parses immediately; anything else gets a hint.
  const handlePaste = (event: ReactClipboardEvent<HTMLTextAreaElement>) => {
    const pasted = event.clipboardData.getData('text');
    const textarea = event.currentTarget;
    // Let the paste land (and onChange run) before looking at the result.
    window.setTimeout(() => {
      const value = textarea.value;
      if (!value.trim()) return;
      const replacedWholeBox = value.trim() === pasted.trim();
      if (replacedWholeBox && (looksLikeMetadataBundle(value) || looksLikePlan(value))) {
        setShowParseHint(false);
        void parsePlan(value);
      } else {
        setShowParseHint(true);
      }
    }, 0);
  };

  const handleTriggerKeyDown = (event: ReactKeyboardEvent<HTMLButtonElement>) => {
    if (event.key === 'ArrowDown' && !showSampleMenu) {
      event.preventDefault();
      setShowSampleMenu(true);
    }
  };

  return (
    <div className="relative z-30 shrink-0 flex flex-col bg-white dark:bg-slate-900 border-b border-slate-200/70 dark:border-slate-800/70">
      {/* The app's single top bar: brand, input drawer handle + SQL ID, plan
          tabs, view tabs, and the app actions. Only the SQL-ID title and the
          plan tabs may shrink; the view tabs degrade through icon-only into an
          overflow menu (see ViewTabStrip). File drops are handled window-wide
          by App (full-window drop overlay). */}
      <div className="h-12 flex items-center gap-2 px-3">
        <BrandMark />
        <button
          type="button"
          onClick={() => setIsCollapsed(!isCollapsed)}
          aria-expanded={!isCollapsed}
          aria-controls="input-panel-content"
          className={`shrink min-w-0 flex items-center gap-2 text-left rounded-md px-1 py-1 hover:bg-slate-100 dark:hover:bg-slate-800 motion-safe:transition-colors ${FOCUS_RING}`}
          title={`${isCollapsed ? 'Show' : 'Hide'} plan input${parsedPlan?.sqlId ? ` (SQL ID: ${parsedPlan.sqlId})` : ''}`}
        >
          <svg
            className={`shrink-0 w-4 h-4 text-slate-500 motion-safe:transition-transform ${isCollapsed ? '' : 'rotate-90'}`}
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            aria-hidden="true"
          >
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
          </svg>
          {/* As the bar narrows the title first drops its "SQL ID:" prefix (it
              turns sr-only, so the accessible name keeps the full text) and
              then truncates the bare id. When the bar leaves it only a sliver,
              the text goes transparent (still in layout and in the accessible
              name) instead of showing a 1–2 letter stub; the button title
              carries the full "SQL ID: …" in every mode. */}
          <h2
            ref={titleRef}
            className={`text-sm font-semibold text-slate-900 dark:text-slate-100 truncate ${titleTextHidden ? 'opacity-0' : ''}`}
          >
            {hasMultiplePlans && (
              <span className="text-slate-500 dark:text-slate-400 mr-1.5">{plans[activePlanIndex].customLabel || plans[activePlanIndex].label}:</span>
            )}
            {parsedPlan?.sqlId
              ? <SqlIdTitle sqlId={parsedPlan.sqlId} />
              : 'Oracle Execution Plan Input'}
          </h2>
        </button>

        <PlanTabsCluster />
        <ViewTabStrip />

        {/* `ml-auto` only bites in the empty state, where the view tabs are
            absent and there is no flexible child to eat the free space. */}
        <div className="ml-auto flex items-center gap-2 shrink-0">
          {dbAgentEnabled && (
            <button
              type="button"
              onClick={() => setShowConnectPanel(!showConnectPanel)}
              aria-pressed={showConnectPanel}
              aria-label="DB Connect"
              title="Connect to a database through the local agent"
              className={`h-8 px-2 text-xs border rounded-md transition-colors flex items-center gap-1.5 font-semibold ${FOCUS_RING} ${
                showConnectPanel
                  ? 'border-slate-300 dark:border-slate-600 bg-slate-200 dark:bg-slate-700 text-slate-900 dark:text-slate-100'
                  : 'border-slate-200 dark:border-slate-700 bg-transparent text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800'
              }`}
            >
              <svg className="w-4 h-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d={DB_ICON_PATH} />
              </svg>
              <span {...topBarLabelProps} className={labelsCollapsed ? 'sr-only' : ''}>DB Connect</span>
            </button>
          )}
          <div className="relative" ref={menuWrapRef}>
            <button
              ref={menuTriggerRef}
              type="button"
              onClick={() => setShowSampleMenu((open) => !open)}
              onKeyDown={handleTriggerKeyDown}
              aria-haspopup="menu"
              aria-expanded={showSampleMenu}
              aria-controls={showSampleMenu ? menuId : undefined}
              aria-label="Load Example"
              title="Load a recent plan or an example"
              className={`h-8 px-2 text-xs border border-slate-200 dark:border-slate-700 bg-transparent text-slate-700 dark:text-slate-300 rounded-md hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors flex items-center gap-1.5 font-semibold ${FOCUS_RING}`}
            >
              <svg className="w-4 h-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d={EXAMPLE_ICON_PATH} />
              </svg>
              <span {...topBarLabelProps} className={labelsCollapsed ? 'sr-only' : ''}>Load Example</span>
              {/* Part of the collapsible label: the icon-only trigger drops its chevron too. */}
              <span {...topBarLabelProps} className={labelsCollapsed ? 'sr-only' : ''}>
                <svg className={`w-4 h-4 transition-transform ${showSampleMenu ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                </svg>
              </span>
            </button>
            {showSampleMenu && (
              <div
                {...menuProps}
                id={menuId}
                aria-label="Load a recent plan or an example"
                onBlur={(event) => {
                  // Tabbing out of the menu closes it (focus stays where it went).
                  const next = event.relatedTarget as Node | null;
                  if (next && !menuWrapRef.current?.contains(next)) setShowSampleMenu(false);
                }}
                className="absolute right-0 mt-1 w-80 max-w-[calc(100vw-1.5rem)] max-h-[70vh] overflow-y-auto bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg shadow-lg z-50 py-1"
              >
                {recentPlans.length > 0 && (
                  <div role="group" aria-label="Recent plans">
                    <div role="none" className={MENU_HEADING_CLASS} aria-hidden="true">Recent</div>
                    {recentPlans.map((entry) => (
                      <div key={entry.id} role="none" className="flex items-stretch">
                        <button
                          type="button"
                          role="menuitem"
                          onClick={() => handleOpenRecent(entry)}
                          className={`${MENU_ITEM_CLASS} min-w-0 flex-1`}
                        >
                          <span className="block text-sm text-slate-700 dark:text-slate-200 truncate">{entry.label}</span>
                          <span className="block text-[11px] text-slate-500 dark:text-slate-400 truncate">
                            {describeRecentPlan(entry)}
                          </span>
                        </button>
                        <button
                          type="button"
                          role="menuitem"
                          aria-label={`Remove ${entry.label} from recent plans`}
                          title="Remove from recent plans"
                          onClick={() => {
                            removeRecentPlan(entry.id);
                            // The focused row is gone: keep focus inside the menu.
                            window.setTimeout(focusFirst, 0);
                          }}
                          className={`shrink-0 w-8 flex items-center justify-center text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 ${FOCUS_RING_INSET}`}
                        >
                          <svg className="w-3.5 h-3.5" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" aria-hidden="true">
                            <path d="M4 4l8 8M12 4l-8 8" />
                          </svg>
                        </button>
                      </div>
                    ))}
                    <div className="border-t border-slate-200 dark:border-slate-700 my-1" role="separator" />
                  </div>
                )}
                {SAMPLE_PLAN_GROUPS.map((group, groupIndex) => (
                  <div key={group.category} role="group" aria-label={`${group.label} examples`}>
                    {groupIndex > 0 && <div className="border-t border-slate-200 dark:border-slate-700 my-1" role="separator" />}
                    <div role="none" className={MENU_HEADING_CLASS} aria-hidden="true">{group.label}</div>
                    {group.samples.map((sample) => (
                      <button
                        key={sample.name}
                        type="button"
                        role="menuitem"
                        onClick={() => handleLoadSample(sample)}
                        className={MENU_ITEM_CLASS}
                      >
                        <span className="flex items-center justify-between gap-2">
                          <span className="text-sm text-slate-700 dark:text-slate-200 truncate">{sample.name}</span>
                          <ExampleBadges sample={sample} />
                        </span>
                        {sample.description && (
                          <span className="block mt-0.5 text-[11px] leading-snug text-slate-500 dark:text-slate-400">
                            {sample.description}
                          </span>
                        )}
                      </button>
                    ))}
                  </div>
                ))}
              </div>
            )}
          </div>
          <div className="w-px h-5 bg-slate-200 dark:bg-slate-700" aria-hidden="true" />
          <HeaderActions />
          <MaximizeButton />
        </div>
      </div>

      {dbAgentEnabled && showConnectPanel && (
        <div className="px-3 pt-2">
          <ConnectPanel />
        </div>
      )}

      {/* Collapsible content */}
      {!isCollapsed && (
        <div id="input-panel-content" className="flex flex-col gap-2 px-3 pb-3">
          {/* Plan identity chips. They used to ride the top bar; the single bar
              has no room for them, so the drawer carries them instead. */}
          {parsedPlan && (
            <div className="flex items-center flex-wrap gap-1.5">
              <MetadataChip
                bundle={metadataBundle}
                warning={metadataBundleWarning}
                planSqlId={parsedPlan.sqlId}
                onDetach={() => detachMetadataBundle(activePlanIndex)}
              />
              <span className={CHIP_CLASS}>{getSourceDisplayName(parsedPlan.source)}</span>
              {parsedPlan.hasActualStats && <span className={CHIP_CLASS}>Actual Stats</span>}
              {parsedPlan.bindVariables && parsedPlan.bindVariables.length > 0 && (
                <span className={CHIP_CLASS}>
                  {parsedPlan.bindVariables.length} bind{parsedPlan.bindVariables.length !== 1 ? 's' : ''}
                </span>
              )}
              <PlanNoteChips parsedPlan={parsedPlan} />
            </div>
          )}

          <textarea
            value={draftInput}
            onChange={(e) => {
              setInput(e.target.value);
              if (!e.target.value.trim()) setShowParseHint(false);
            }}
            onPaste={handlePaste}
            onKeyDown={(e) => {
              if ((e.metaKey || e.ctrlKey) && e.key === 'Enter' && draftInput.trim()) {
                e.preventDefault();
                handleParse();
              }
            }}
            aria-label="Plan text"
            aria-describedby={showParseHint ? hintId : undefined}
            placeholder={INPUT_PLACEHOLDER}
            className="w-full h-36 p-2.5 font-mono text-xs bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-700 rounded-md resize-y focus:outline-none focus:ring-2 focus:ring-blue-500/60 text-slate-900 dark:text-slate-100 placeholder-slate-400 dark:placeholder-slate-500"
          />

          {showParseHint && !error && (
            <p id={hintId} className="-mt-1 text-[11px] text-slate-500 dark:text-slate-400">
              Press Parse (⌘⏎ / Ctrl+Enter) when ready.
            </p>
          )}

          {error && (
            <div
              role="alert"
              className="p-2 text-xs bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-md text-red-700 dark:text-red-400"
            >
              {error}
            </div>
          )}

          <div className="flex gap-2">
            <button
              type="button"
              onClick={handleParse}
              disabled={!draftInput.trim()}
              aria-keyshortcuts="Meta+Enter Control+Enter"
              className={`h-8 px-3 bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors font-semibold text-xs ${FOCUS_RING}`}
            >
              Parse <kbd className="ml-1 text-[10px] opacity-70 font-normal">{PARSE_SHORTCUT_LABEL}</kbd>
            </button>
            {(parsedPlan || draftInput.trim()) && (
              <button
                type="button"
                onClick={handleClear}
                className={`h-8 px-3 border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-300 rounded-md hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors font-semibold text-xs ${FOCUS_RING}`}
              >
                Clear
              </button>
            )}
            {!parsedPlan && plans.length > 1 && (
              <button
                type="button"
                onClick={() => removePlanSlot(activePlanIndex)}
                className={`h-8 px-3 border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-300 rounded-md hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors font-semibold text-xs ${FOCUS_RING}`}
                title="Discard this empty plan"
              >
                Cancel
              </button>
            )}
            {/* Format / note chips now live in the chip row at the top of the
                drawer; this row keeps the plan's numbers only. */}
            {parsedPlan && (
              <div className="hidden lg:flex items-center ml-auto text-xs text-slate-600 dark:text-slate-400 gap-2">
                <span>
                  {parsedPlan.allNodes.length} operations
                </span>
                <span>
                  Cost: {parsedPlan.rootNode?.cost != null ? formatNumberShort(parsedPlan.rootNode.cost) : '—'}
                </span>
                {parsedPlan.planHashValue && (
                  <span>
                    PHV: {parsedPlan.planHashValue}
                  </span>
                )}
              </div>
            )}
          </div>

        </div>
      )}

      {/* Bundle status is shown outside the collapsible content so drops onto
          the collapsed header still get visible feedback. */}
      {bundleNotice && (
        <div className="px-3 pb-2">
          <div
            role={bundleNotice.tone === 'error' ? 'alert' : 'status'}
            className={`p-2 text-xs rounded-md border flex items-start justify-between gap-2 ${
              bundleNotice.tone === 'ok'
                ? 'bg-emerald-50 dark:bg-emerald-900/20 border-emerald-200 dark:border-emerald-800 text-emerald-700 dark:text-emerald-300'
                : bundleNotice.tone === 'warn'
                  ? 'bg-amber-50 dark:bg-amber-900/20 border-amber-200 dark:border-amber-800 text-amber-700 dark:text-amber-300'
                  : 'bg-red-50 dark:bg-red-900/20 border-red-200 dark:border-red-800 text-red-700 dark:text-red-400'
            }`}
          >
            <span>{bundleNotice.text}</span>
            <button
              type="button"
              onClick={dismissBundleNotice}
              aria-label="Dismiss"
              className={`shrink-0 font-bold opacity-60 hover:opacity-100 leading-none rounded ${FOCUS_RING}`}
            >
              ×
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

const NOTE_CHIP_CLASS = 'px-2 py-0.5 border border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-900/20 text-amber-700 dark:text-amber-300 rounded text-[11px] font-medium';

function PlanNoteChips({ parsedPlan }: { parsedPlan: ParsedPlan }) {
  const notes = parsedPlan.notes;
  const dopDowngrade = getDopDowngrade(parsedPlan.monitorMetadata);
  if (!notes && !dopDowngrade) return null;

  return (
    <>
      {notes?.dynamicSampling && (
        <span className={NOTE_CHIP_CLASS} title="Dynamic sampling — statistics were sampled at parse time; estimates may be less reliable">
          Dyn. sampling{notes.dynamicSamplingLevel ? ` (L${notes.dynamicSamplingLevel})` : ''}
        </span>
      )}
      {notes?.planDirectives && (
        <span className={NOTE_CHIP_CLASS} title="SQL plan directives were used — the optimizer adjusted estimates based on past misestimates">
          Plan directives
        </span>
      )}
      {notes?.cardinalityFeedback && (
        <span className={NOTE_CHIP_CLASS} title="Cardinality feedback — the optimizer re-estimated based on a prior execution; the plan may change between executions">
          Card. feedback
        </span>
      )}
      {notes?.statisticsFeedback && (
        <span className={NOTE_CHIP_CLASS} title="Statistics feedback — the optimizer re-estimated based on a prior execution; the plan may change between executions">
          Stats feedback
        </span>
      )}
      {notes?.adaptivePlan && (
        <span className={NOTE_CHIP_CLASS} title="This is an adaptive plan — the final shape was decided at runtime">
          Adaptive plan
        </span>
      )}
      {notes?.sqlProfile && (
        <span className={NOTE_CHIP_CLASS} title={`SQL profile "${notes.sqlProfile}" was applied to this plan`}>
          Profile "{notes.sqlProfile}"
        </span>
      )}
      {notes?.sqlPlanBaseline && (
        <span className={NOTE_CHIP_CLASS} title={`SQL plan baseline "${notes.sqlPlanBaseline}" was applied to this plan`}>
          Baseline "{notes.sqlPlanBaseline}"
        </span>
      )}
      {notes?.outline && (
        <span className={NOTE_CHIP_CLASS} title={`Outline "${notes.outline}" was used to shape this plan`}>
          Outline "{notes.outline}"
        </span>
      )}
      {dopDowngrade && (
        <span
          className="px-2 py-0.5 border border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-400 rounded text-[11px] font-medium"
          title={`DOP downgraded: requested ${dopDowngrade.requested} PX servers, allocated ${dopDowngrade.allocated}`}
        >
          DOP {dopDowngrade.allocated}/{dopDowngrade.requested}
        </span>
      )}
    </>
  );
}

/**
 * Chooser for a metadata bundle that matched several (or no) loaded plans.
 * Rendered by App at the top level so it also works while the canvas is
 * maximized (when this panel is not mounted).
 */
export function BundleAttachChooser({
  pending,
  plans,
  onResolve,
}: {
  pending: PendingBundleChoice | null;
  plans: PlanSlot[];
  onResolve: (index: number | null) => void;
}) {
  return (
    <Dialog
      open={pending !== null}
      onClose={() => onResolve(null)}
      title="Attach metadata bundle"
      description={pending?.reason}
      size="sm"
    >
      <DialogBody>
        <div className="flex flex-col gap-2">
          {pending?.candidateIndices.map((idx) => {
            const slot = plans[idx];
            if (!slot) return null;
            const label = slot.customLabel || slot.label;
            const sqlId = slot.parsedPlan?.sqlId;
            return (
              <button
                key={idx}
                type="button"
                onClick={() => onResolve(idx)}
                className={`text-left p-2 border border-slate-200 dark:border-slate-700 rounded-md hover:bg-slate-50 dark:hover:bg-slate-800 ${FOCUS_RING}`}
              >
                <div className="text-sm font-semibold text-slate-900 dark:text-slate-100">Attach to {label}</div>
                {sqlId && (
                  <div className="text-[11px] text-slate-500 dark:text-slate-400 font-mono">SQL_ID: {sqlId}</div>
                )}
              </button>
            );
          })}
        </div>
      </DialogBody>
      <DialogFooter>
        <button type="button" onClick={() => onResolve(null)} className={BTN_SECONDARY}>
          Cancel
        </button>
      </DialogFooter>
    </Dialog>
  );
}
