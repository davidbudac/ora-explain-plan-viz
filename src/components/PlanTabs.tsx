import { useState, useRef, useEffect } from 'react';
import { usePlan } from '../hooks/usePlanContext';
import { ComparePlanPicker } from './ComparePlanPicker';

function InlineRenameLabel({
  slot,
  index,
  isActive,
  onRename,
}: {
  slot: { label: string; customLabel?: string };
  index: number;
  isActive: boolean;
  onRename: (index: number, customLabel: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  const displayLabel = slot.customLabel || slot.label;

  useEffect(() => {
    if (editing) {
      inputRef.current?.focus();
      inputRef.current?.select();
    }
  }, [editing]);

  const commit = () => {
    setEditing(false);
    onRename(index, draft.trim());
  };

  if (editing) {
    return (
      <input
        ref={inputRef}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') commit();
          if (e.key === 'Escape') setEditing(false);
        }}
        onClick={(e) => e.stopPropagation()}
        className={`
          w-24 px-1 py-0 text-xs font-semibold bg-transparent border-b outline-none
          ${isActive
            ? 'text-white border-white/50 placeholder-blue-200'
            : 'text-neutral-700 dark:text-neutral-300 border-neutral-400 dark:border-neutral-500 placeholder-neutral-400'
          }
        `}
        placeholder={slot.label}
        maxLength={30}
      />
    );
  }

  return (
    <span className="flex items-center gap-1">
      <span
        onDoubleClick={(e) => {
          e.stopPropagation();
          setDraft(slot.customLabel || '');
          setEditing(true);
        }}
        className="cursor-text select-none"
        title="Double-click to rename"
      >
        {displayLabel}
      </span>
      <button
        onClick={(e) => {
          e.stopPropagation();
          setDraft(slot.customLabel || '');
          setEditing(true);
        }}
        className={`
          p-0.5 rounded opacity-0 group-hover/tab:opacity-60 hover:!opacity-100 transition-opacity
          ${isActive ? 'hover:bg-blue-500' : 'hover:bg-neutral-200 dark:hover:bg-neutral-700'}
        `}
        title="Rename plan"
      >
        <svg className="w-2.5 h-2.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
        </svg>
      </button>
    </span>
  );
}

export function PlanTabs() {
  const { plans, activePlanIndex, setActivePlan, addPlanSlot, removePlanSlot, renamePlanSlot, viewMode, setViewMode, treeCompareEnabled, setTreeCompareEnabled } = usePlan();

  const parsedPlanCount = plans.filter((slot) => slot.parsedPlan).length;
  const hasEmptySlot = plans.some((slot) => !slot.parsedPlan);

  if (parsedPlanCount === 0 && plans.length <= 1) return null;

  return (
    <div className="flex items-center gap-1 overflow-x-auto px-3 py-1.5 bg-white dark:bg-neutral-900 border-b border-neutral-200 dark:border-neutral-800">
      {plans.map((slot, index) => {
        const isActive = index === activePlanIndex && viewMode !== 'compare';
        const phv = slot.parsedPlan?.planHashValue;
        return (
          <div
            key={slot.id}
            className={`
              group/tab shrink-0 flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-md transition-colors border cursor-pointer
              ${isActive
                ? 'bg-blue-600 text-white border-blue-600'
                : 'text-neutral-600 dark:text-neutral-400 border-neutral-200 dark:border-neutral-700 hover:bg-neutral-50 dark:hover:bg-neutral-800'
              }
            `}
          >
            <button
              onClick={() => {
                setActivePlan(index);
                if (viewMode === 'compare') {
                  setViewMode('hierarchical');
                }
              }}
              className="flex items-center gap-1.5"
            >
              <InlineRenameLabel
                slot={slot}
                index={index}
                isActive={isActive}
                onRename={renamePlanSlot}
              />
              {phv && (
                <span className={`font-mono text-[10px] ${isActive ? 'text-blue-200' : 'text-neutral-400 dark:text-neutral-500'}`}>
                  PHV: {phv}
                </span>
              )}
              {!slot.parsedPlan && (
                <span className={`text-[10px] italic ${isActive ? 'text-blue-200' : 'text-neutral-400 dark:text-neutral-500'}`}>
                  (empty)
                </span>
              )}
            </button>
            {plans.length > 1 && (
              <button
                onClick={(event) => {
                  event.stopPropagation();
                  removePlanSlot(index);
                }}
                className={`
                  ml-1 p-0.5 rounded transition-colors
                  ${isActive
                    ? 'hover:bg-blue-500 text-blue-200'
                    : 'hover:bg-neutral-200 dark:hover:bg-neutral-700 text-neutral-400 dark:text-neutral-500'
                  }
                `}
                title={`Remove ${slot.customLabel || slot.label}`}
              >
                <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            )}
          </div>
        );
      })}

      {!hasEmptySlot && (
        <button
          type="button"
          onClick={addPlanSlot}
          className="shrink-0 flex items-center gap-1 px-2.5 py-1.5 text-xs font-semibold rounded-md border border-dashed border-neutral-300 dark:border-neutral-600 text-neutral-500 dark:text-neutral-400 hover:bg-neutral-50 dark:hover:bg-neutral-800 hover:text-neutral-700 dark:hover:text-neutral-200 hover:border-neutral-400 dark:hover:border-neutral-500 transition-colors"
          title="Add another plan to compare"
        >
          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
          </svg>
          Add Plan
        </button>
      )}

      {parsedPlanCount >= 2 && (viewMode === 'hierarchical' || viewMode === 'tabular') && (
        <>
          <div className="w-px h-5 bg-neutral-200 dark:bg-neutral-700 mx-1 shrink-0" />
          <div className="flex bg-neutral-100 dark:bg-neutral-800 rounded-md p-0.5 border border-neutral-200 dark:border-neutral-700 shrink-0">
            <button
              type="button"
              onClick={() => setTreeCompareEnabled(false)}
              className={`px-2.5 py-1 text-xs rounded-md transition-colors font-medium ${!treeCompareEnabled ? 'bg-blue-600 text-white shadow-sm' : 'text-neutral-600 dark:text-neutral-400 hover:bg-neutral-100 dark:hover:bg-neutral-700'}`}
            >
              Single
            </button>
            <button
              type="button"
              onClick={() => setTreeCompareEnabled(true)}
              className={`px-2.5 py-1 text-xs rounded-md transition-colors font-medium ${treeCompareEnabled ? 'bg-blue-600 text-white shadow-sm' : 'text-neutral-600 dark:text-neutral-400 hover:bg-neutral-100 dark:hover:bg-neutral-700'}`}
            >
              Side-by-side
            </button>
          </div>
          {treeCompareEnabled && <ComparePlanPicker />}
        </>
      )}
    </div>
  );
}
