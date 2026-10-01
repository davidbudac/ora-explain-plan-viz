import { useEffect } from 'react';
import { usePlan } from '../hooks/usePlanContext';
import { Dialog, DialogBody } from './ui';

const isMac = navigator.platform?.includes('Mac');
const MOD = isMac ? '⌘' : 'Ctrl';

const SHORTCUT_GROUPS: { title: string; items: { keys: string[]; description: string }[] }[] = [
  {
    title: 'General',
    items: [
      { keys: [`${MOD}+K`], description: 'Open the command palette' },
      { keys: [`${MOD}+O`], description: 'Open a plan file (same as dropping it on the window)' },
      { keys: ['?'], description: 'Show this shortcuts overview' },
      { keys: ['F'], description: 'Maximize / restore the visualization' },
      { keys: ['Z'], description: 'Toggle focus mode (floating instruments)' },
      { keys: [`${MOD}+Enter`], description: 'Parse the plan in the input panel' },
    ],
  },
  {
    title: 'Tree view',
    items: [
      { keys: ['↑'], description: 'Select parent operation' },
      { keys: ['↓'], description: 'Select first child operation' },
      { keys: ['←', '→'], description: 'Select previous / next sibling' },
      { keys: ['←', '→'], description: 'Left-to-right layout (the arrows rotate): parent / first child' },
      { keys: ['↑', '↓'], description: 'Left-to-right layout: previous / next sibling' },
      { keys: ['Arrows'], description: 'Arrowing into a collapsed node expands it' },
      { keys: ['Chevron'], description: 'Click the chevron on a node to collapse / expand its subtree' },
      { keys: ['Shift+F10'], description: 'Show actions for the focused operation (highlight, note, zoom, copy) — hovering a node shows them too' },
    ],
  },
  {
    title: 'Tabular view',
    items: [
      { keys: ['↑', '↓'], description: 'Move to the previous / next row' },
      { keys: ['←', '→'], description: 'Collapse / expand the selected row' },
    ],
  },
  {
    title: 'Compare view',
    items: [
      { keys: ['Enter', 'Space'], description: 'Expand / collapse the focused row’s details' },
    ],
  },
  {
    title: 'Flame graph',
    items: [
      { keys: ['Double-click'], description: 'Zoom in to a bar’s subtree' },
      { keys: ['Esc'], description: 'Reset the zoom' },
      { keys: ['Tab'], description: 'Move focus between bars' },
      { keys: ['Enter'], description: 'Select the focused bar' },
      { keys: ['Shift+Enter'], description: 'Zoom in to the focused bar' },
    ],
  },
  {
    title: 'Sankey diagram',
    items: [
      { keys: ['Tab'], description: 'Move focus between nodes (the tooltip follows)' },
      { keys: ['Enter', 'Space'], description: 'Select the focused node' },
    ],
  },
  {
    title: 'Selection',
    items: [
      { keys: [`${MOD}+Click`], description: 'Add or remove a node from a multi-selection' },
      { keys: ['Esc'], description: 'Deselect, or close the open dialog' },
    ],
  },
];

/** Modal listing all keyboard shortcuts; opened via `?` or the command palette. */
export function ShortcutsOverlay() {
  const { shortcutsOverlayOpen: open, setShortcutsOverlayOpen: setOpen } = usePlan();

  // Global `?` opener (skips inputs). Escape and focus handling belong to the Dialog.
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key !== '?' || e.ctrlKey || e.metaKey || e.altKey) return;
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      if ((e.target as HTMLElement)?.isContentEditable) return;
      e.preventDefault();
      setOpen(true);
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [setOpen]);

  return (
    <Dialog open={open} onClose={() => setOpen(false)} title="Keyboard shortcuts" size="md">
      <DialogBody className="space-y-4 pb-5">
        {SHORTCUT_GROUPS.map((group) => (
          <div key={group.title}>
            <h3 className="text-[11px] font-semibold tracking-wide text-slate-500 dark:text-slate-400 uppercase mb-2">
              {group.title}
            </h3>
            <div className="space-y-1.5">
              {group.items.map((item) => (
                <div key={item.description} className="flex items-center justify-between gap-3 text-sm">
                  <span className="text-slate-700 dark:text-slate-300">{item.description}</span>
                  <span className="flex items-center gap-1 shrink-0">
                    {item.keys.map((key) => (
                      <kbd
                        key={key}
                        className="px-1.5 py-0.5 text-[11px] font-medium text-slate-500 dark:text-slate-400 bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded"
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
      </DialogBody>
    </Dialog>
  );
}
