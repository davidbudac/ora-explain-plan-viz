import { useState, useRef, useEffect } from 'react';
import { usePlan } from '../hooks/usePlanContext';
import { ComparePlanPicker } from './ComparePlanPicker';
import { FOCUS_RING, FOCUS_RING_INSET } from './ui';

/** Inline rename field that replaces a plan tab's label while editing. */
function RenameInput({
  slot,
  isActive,
  onCommit,
  onCancel,
}: {
  slot: { label: string; customLabel?: string };
  isActive: boolean;
  onCommit: (customLabel: string) => void;
  onCancel: () => void;
}) {
  const [draft, setDraft] = useState(slot.customLabel || '');
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, []);

  return (
    <input
      ref={inputRef}
      value={draft}
      aria-label={`Rename ${slot.customLabel || slot.label}`}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => onCommit(draft.trim())}
      onKeyDown={(e) => {
        if (e.key === 'Enter') onCommit(draft.trim());
        if (e.key === 'Escape') {
          e.stopPropagation();
          onCancel();
        }
      }}
      className={`
        w-24 mx-2 px-1 py-0 text-xs font-semibold bg-transparent border-b outline-none
        ${isActive
          ? 'text-slate-900 dark:text-slate-100 border-slate-500 dark:border-slate-400 placeholder-slate-400'
          : 'text-slate-700 dark:text-slate-300 border-slate-400 dark:border-slate-500 placeholder-slate-400'
        }
      `}
      placeholder={slot.label}
      maxLength={30}
    />
  );
}

interface PlanTabsProps {
  /**
   * Hide secondary text (the PHV, the "Add Plan" label) so the view ribbon
   * keeps its labels. Elements that compact carry `data-plan-tab-extra` so the
   * top-bar allocator can measure both variants.
   */
  compact?: boolean;
}

export function PlanTabs({ compact = false }: PlanTabsProps) {
  const { plans, activePlanIndex, setActivePlan, addPlanSlot, requestRemovePlanSlot, renamePlanSlot, viewMode, setViewMode, treeCompareEnabled, setTreeCompareEnabled, setBaselineDialogOpen } = usePlan();
  const [editingIndex, setEditingIndex] = useState<number | null>(null);

  const parsedPlanCount = plans.filter((slot) => slot.parsedPlan).length;
  const hasEmptySlot = plans.some((slot) => !slot.parsedPlan);

  if (parsedPlanCount === 0 && plans.length <= 1) return null;

  const extraClass = compact ? 'hidden' : '';

  return (
    <div className="flex items-center gap-1 shrink-0">
      <div role="group" aria-label="Plans" className="flex items-center gap-1">
        {plans.map((slot, index) => {
          const isActive = index === activePlanIndex && viewMode !== 'compare';
          const phv = slot.parsedPlan?.planHashValue;
          const name = slot.customLabel || slot.label;
          const activateTab = () => {
            setActivePlan(index);
            if (viewMode === 'compare') {
              setViewMode('hierarchical');
            }
          };
          const iconButton = `
            shrink-0 h-6 w-6 flex items-center justify-center rounded transition-colors
            ${FOCUS_RING}
            ${isActive
              ? 'hover:bg-slate-300 dark:hover:bg-slate-600 text-slate-500 dark:text-slate-400'
              : 'hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-400 dark:text-slate-500'}
          `;
          return (
            // The tab is a plain button; rename / SPM / remove are its
            // siblings (never nested interactive controls inside a tab).
            <div
              key={slot.id}
              className={`
                group/tab shrink-0 flex items-center rounded-md border transition-colors
                ${isActive
                  ? 'bg-slate-200 dark:bg-slate-700 text-slate-900 dark:text-slate-100 border-slate-300 dark:border-slate-600'
                  : 'text-slate-600 dark:text-slate-400 border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800'
                }
              `}
            >
              {editingIndex === index ? (
                <RenameInput
                  slot={slot}
                  isActive={isActive}
                  onCommit={(label) => {
                    setEditingIndex(null);
                    renamePlanSlot(index, label);
                  }}
                  onCancel={() => setEditingIndex(null)}
                />
              ) : (
                <button
                  type="button"
                  onClick={activateTab}
                  onDoubleClick={() => setEditingIndex(index)}
                  aria-current={isActive ? 'true' : undefined}
                  title={`${name}${phv ? ` — PHV ${phv}` : ''}${slot.parsedPlan ? '' : ' (empty)'} · double-click to rename`}
                  className={`flex items-center gap-1.5 pl-3 pr-1.5 py-1.5 text-xs font-semibold rounded-md ${FOCUS_RING_INSET}`}
                >
                  <span className="select-none">{name}</span>
                  {phv && (
                    <span
                      data-plan-tab-extra
                      className={`font-mono text-[10px] ${isActive ? 'text-slate-500 dark:text-slate-400' : 'text-slate-400 dark:text-slate-500'} ${extraClass}`}
                    >
                      PHV: {phv}
                    </span>
                  )}
                  {!slot.parsedPlan && (
                    <span className={`text-[10px] italic ${isActive ? 'text-slate-500 dark:text-slate-400' : 'text-slate-400 dark:text-slate-500'}`}>
                      (empty)
                    </span>
                  )}
                </button>
              )}
              {editingIndex !== index && (
                <button
                  type="button"
                  onClick={() => setEditingIndex(index)}
                  aria-label={`Rename ${name}`}
                  title="Rename plan"
                  className={`${iconButton} w-5! opacity-0 group-hover/tab:opacity-60 hover:opacity-100! focus-visible:opacity-100`}
                >
                  <svg className="w-2.5 h-2.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
                  </svg>
                </button>
              )}
              {phv && (
                // Compacts away with the PHV: the same script is under File → SQL Plan Baseline script.
                <button
                  type="button"
                  data-plan-tab-extra
                  onClick={() => {
                    setActivePlan(index);
                    setBaselineDialogOpen(true);
                  }}
                  aria-label={`SQL Plan Baseline script for ${name}`}
                  className={`
                    shrink-0 mx-0.5 px-1 py-px text-[10px] font-semibold rounded border bg-transparent transition-colors
                    border-slate-300/70 dark:border-slate-600/70 text-slate-500 dark:text-slate-400
                    hover:border-slate-400 dark:hover:border-slate-500 hover:text-slate-700 dark:hover:text-slate-200
                    ${FOCUS_RING} ${extraClass}
                  `}
                  title="Generate SQL Plan Baseline script (DBMS_SPM)"
                >
                  SPM
                </button>
              )}
              {plans.length > 1 && (
                <button
                  type="button"
                  // Confirms first when the slot holds a loaded plan (its
                  // annotations and metadata bundle go with it).
                  onClick={() => void requestRemovePlanSlot(index)}
                  aria-label={`Remove ${name}`}
                  title={`Remove ${name}`}
                  className={`${iconButton} mr-0.5`}
                >
                  <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              )}
            </div>
          );
        })}
      </div>

      {!hasEmptySlot && (
        <button
          type="button"
          onClick={addPlanSlot}
          aria-label="Add plan"
          className={`shrink-0 h-[30px] flex items-center gap-1 px-2 text-xs font-semibold rounded-md border border-dashed border-slate-300 dark:border-slate-600 text-slate-500 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-800 hover:text-slate-700 dark:hover:text-slate-200 hover:border-slate-400 dark:hover:border-slate-500 transition-colors ${FOCUS_RING_INSET}`}
          title="Add another plan to compare"
        >
          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
          </svg>
          <span data-plan-tab-extra className={`pr-0.5 ${extraClass}`}>Add Plan</span>
        </button>
      )}

      {parsedPlanCount >= 2 && (viewMode === 'hierarchical' || viewMode === 'tabular') && (
        <>
          <div className="w-px h-5 bg-slate-200 dark:bg-slate-700 mx-1 shrink-0" aria-hidden="true" />
          <div role="group" aria-label="Plan layout" className="flex bg-slate-100 dark:bg-slate-800 rounded-md p-0.5 border border-slate-200 dark:border-slate-700 shrink-0">
            <button
              type="button"
              aria-pressed={!treeCompareEnabled}
              aria-label="Single plan"
              title="Single plan"
              onClick={() => setTreeCompareEnabled(false)}
              className={`flex items-center gap-1.5 px-2 py-1 text-xs rounded-md transition-colors font-medium ${FOCUS_RING_INSET} ${!treeCompareEnabled ? 'bg-slate-200 dark:bg-slate-700 text-slate-900 dark:text-slate-100' : 'text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-700'}`}
            >
              <svg className="w-3.5 h-3.5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
                <rect x="5" y="4" width="14" height="16" rx="2" strokeWidth={2} />
              </svg>
              <span data-plan-tab-extra className={extraClass}>Single</span>
            </button>
            <button
              type="button"
              aria-pressed={treeCompareEnabled}
              aria-label="Side-by-side plans"
              title="Side-by-side plans"
              onClick={() => setTreeCompareEnabled(true)}
              className={`flex items-center gap-1.5 px-2 py-1 text-xs rounded-md transition-colors font-medium ${FOCUS_RING_INSET} ${treeCompareEnabled ? 'bg-slate-200 dark:bg-slate-700 text-slate-900 dark:text-slate-100' : 'text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-700'}`}
            >
              <svg className="w-3.5 h-3.5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
                <rect x="3" y="4" width="8" height="16" rx="1.5" strokeWidth={2} />
                <rect x="13" y="4" width="8" height="16" rx="1.5" strokeWidth={2} />
              </svg>
              <span data-plan-tab-extra className={extraClass}>Side-by-side</span>
            </button>
          </div>
          {treeCompareEnabled && <ComparePlanPicker />}
        </>
      )}
    </div>
  );
}
