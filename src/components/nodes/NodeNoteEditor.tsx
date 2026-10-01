import { useCallback, useEffect, useRef, useState } from 'react';
import type { KeyboardEvent as ReactKeyboardEvent } from 'react';
import { BTN_PRIMARY, BTN_SECONDARY, FOCUS_RING } from '../ui';

/**
 * Contents of the toolbar's note popover: a small textarea that edits the
 * operation's note without opening the details panel.
 *
 * Closing rules (no silent data loss, mirroring the details panel which saves on
 * blur): Save / Cmd-or-Ctrl+Enter save; Cancel / Escape discard; *every other*
 * way the editor goes away (press outside, canvas moved, window resized,
 * toolbar hidden, node removed) saves a changed draft on unmount. Saving
 * whitespace-only text removes the note.
 */

const COMPACT_BTN = '!px-2.5 !py-1 !text-xs';

const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform ?? '');
const SAVE_HINT = isMac ? '⌘+Enter to save' : 'Ctrl+Enter to save';

interface NodeNoteEditorProps {
  nodeId: number;
  operation: string;
  /** The note as stored ('' when the node has none). */
  initialText: string;
  onSave: (text: string) => void;
  onDelete: () => void;
  /** Ask the host to close the popover (the editor has already settled its draft). */
  onClose: () => void;
}

export function NodeNoteEditor({ nodeId, operation, initialText, onSave, onDelete, onClose }: NodeNoteEditorProps) {
  const [draft, setDraft] = useState(initialText);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  // Latest values for the unmount cleanup (which must not re-run on every render)
  const draftRef = useRef(draft);
  const savedRef = useRef(initialText);
  const discardRef = useRef(false);
  const onSaveRef = useRef(onSave);
  const onDeleteRef = useRef(onDelete);
  useEffect(() => {
    draftRef.current = draft;
    onSaveRef.current = onSave;
    onDeleteRef.current = onDelete;
  });

  // Persist the draft if (and only if) it differs from what is stored.
  const commit = useCallback(() => {
    const next = draftRef.current.trim();
    const previous = savedRef.current.trim();
    if (next === previous) return;
    savedRef.current = next;
    if (next) onSaveRef.current(next);
    else onDeleteRef.current();
  }, []);

  useEffect(
    () => () => {
      if (!discardRef.current) commit();
    },
    [commit],
  );

  // Focus with the caret at the end, ready to append
  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.focus({ preventScroll: true });
    el.setSelectionRange(el.value.length, el.value.length);
  }, []);

  const save = () => {
    commit();
    onClose();
  };

  const cancel = () => {
    discardRef.current = true;
    onClose();
  };

  const remove = () => {
    discardRef.current = true;
    savedRef.current = '';
    onDeleteRef.current();
    onClose();
  };

  const handleKeyDown = (e: ReactKeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      save();
    } else if (e.key === 'Escape') {
      // The popover root closes on Escape; make that a discard, not a save.
      discardRef.current = true;
    }
  };

  const hasNote = initialText.trim() !== '';

  return (
    <div className="w-72">
      <div className="mb-2 truncate text-[10px] font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
        Note · #{nodeId} {operation}
      </div>
      <textarea
        ref={textareaRef}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={handleKeyDown}
        rows={3}
        placeholder="Add a note..."
        aria-label={`Note for operation ${nodeId}`}
        className="w-full resize-y rounded-md border border-slate-200 bg-white px-2.5 py-1.5 text-xs text-slate-900 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500/60 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100 dark:placeholder-slate-500"
      />
      <div className="mt-2 flex items-center gap-2">
        {hasNote && (
          <button
            type="button"
            onClick={remove}
            className={`rounded text-[11px] text-slate-500 hover:text-red-600 dark:text-slate-400 dark:hover:text-red-400 ${FOCUS_RING}`}
          >
            Delete
          </button>
        )}
        <span className="ml-auto text-[10px] text-slate-400 dark:text-slate-500">{SAVE_HINT}</span>
        <button type="button" onClick={cancel} className={`${BTN_SECONDARY} ${COMPACT_BTN}`}>
          Cancel
        </button>
        <button type="button" onClick={save} className={`${BTN_PRIMARY} ${COMPACT_BTN}`}>
          Save
        </button>
      </div>
    </div>
  );
}
