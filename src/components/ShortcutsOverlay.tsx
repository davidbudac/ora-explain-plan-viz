import { useEffect } from 'react';
import { createPortal } from 'react-dom';
import { usePlan } from '../hooks/usePlanContext';

const isMac = navigator.platform?.includes('Mac');
const MOD = isMac ? '⌘' : 'Ctrl';

const SHORTCUT_GROUPS: { title: string; items: { keys: string[]; description: string }[] }[] = [
  {
    title: 'General',
    items: [
      { keys: [`${MOD}+K`], description: 'Open the command palette' },
      { keys: ['?'], description: 'Show this shortcuts overview' },
      { keys: ['F'], description: 'Maximize / restore the visualization' },
      { keys: [`${MOD}+Enter`], description: 'Parse the plan in the input panel' },
    ],
  },
  {
    title: 'Navigation (Tree & Tabular views)',
    items: [
      { keys: ['↑'], description: 'Select parent operation' },
      { keys: ['↓'], description: 'Select first child operation' },
      { keys: ['←', '→'], description: 'Select previous / next sibling' },
      { keys: ['Esc'], description: 'Deselect / close dialogs' },
    ],
  },
  {
    title: 'Selection',
    items: [
      { keys: [`${MOD}+Click`], description: 'Add or remove a node from a multi-selection' },
    ],
  },
];

/** Modal listing all keyboard shortcuts; opened via `?` or the command palette. */
export function ShortcutsOverlay() {
  const { shortcutsOverlayOpen: open, setShortcutsOverlayOpen: setOpen } = usePlan();

  // Global `?` opener (skips inputs); Escape closes while open.
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (open && e.key === 'Escape') {
        e.preventDefault();
        setOpen(false);
        return;
      }
      if (e.key !== '?' || e.ctrlKey || e.metaKey || e.altKey) return;
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      if ((e.target as HTMLElement)?.isContentEditable) return;
      e.preventDefault();
      setOpen(true);
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [open, setOpen]);

  if (!open) return null;

  return createPortal(
    <>
      <div
        className="fixed inset-0 z-[90] bg-black/30 dark:bg-black/50"
        onClick={() => setOpen(false)}
      />
      <div
        role="dialog"
        aria-label="Keyboard shortcuts"
        className="fixed z-[91] top-[min(20%,120px)] left-1/2 -translate-x-1/2 w-[440px] max-w-[calc(100vw-2rem)] rounded-xl border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-neutral-900 shadow-2xl flex flex-col overflow-hidden"
      >
        <div className="flex items-center justify-between px-4 py-3 border-b border-neutral-200 dark:border-neutral-700">
          <h3 className="text-sm font-bold text-neutral-900 dark:text-neutral-100">Keyboard shortcuts</h3>
          <button
            type="button"
            onClick={() => setOpen(false)}
            className="p-1 rounded hover:bg-neutral-100 dark:hover:bg-neutral-800 text-neutral-400"
            aria-label="Close"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
        <div className="max-h-[min(60vh,480px)] overflow-y-auto p-4 space-y-4">
          {SHORTCUT_GROUPS.map((group) => (
            <div key={group.title}>
              <h4 className="text-[11px] font-semibold tracking-wide text-neutral-400 dark:text-neutral-500 uppercase mb-2">
                {group.title}
              </h4>
              <div className="space-y-1.5">
                {group.items.map((item) => (
                  <div key={item.description} className="flex items-center justify-between gap-3 text-sm">
                    <span className="text-neutral-700 dark:text-neutral-300">{item.description}</span>
                    <span className="flex items-center gap-1 shrink-0">
                      {item.keys.map((key) => (
                        <kbd
                          key={key}
                          className="px-1.5 py-0.5 text-[11px] font-medium text-neutral-500 dark:text-neutral-400 bg-neutral-100 dark:bg-neutral-800 border border-neutral-200 dark:border-neutral-700 rounded"
                        >
                          {key}
                        </kbd>
                      ))}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    </>,
    document.body
  );
}
