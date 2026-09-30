import { useId, useRef, useState } from 'react';
import { HIGHLIGHT_COLORS } from '../lib/annotations';
import type { HighlightColor, AnnotationGroup } from '../lib/annotations';
import { Dialog, DialogBody, DialogFooter, FOCUS_RING, useConfirm } from './ui';

interface GroupAnnotationDialogProps {
  nodeIds: number[];
  existingGroup?: AnnotationGroup;
  onSave: (data: { name: string; color: HighlightColor; note?: string; nodeIds: number[] }) => void;
  onDelete?: () => void;
  onClose: () => void;
}

/**
 * Focus indicator for the colour swatches. An outline (not FOCUS_RING's ring)
 * so it never fights the swatch's own `ring-2` "selected" marker.
 */
const SWATCH_FOCUS =
  'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-500 dark:focus-visible:outline-blue-400';

const FIELD_LABEL =
  'block text-[10px] font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400 mb-1';

export function GroupAnnotationDialog({
  nodeIds,
  existingGroup,
  onSave,
  onDelete,
  onClose,
}: GroupAnnotationDialogProps) {
  const initialName = existingGroup?.name || '';
  const initialColor: HighlightColor = existingGroup?.color || 'blue';
  const initialNote = existingGroup?.note || '';

  const [name, setName] = useState(initialName);
  const [color, setColor] = useState<HighlightColor>(initialColor);
  const [note, setNote] = useState(initialNote);
  const nameRef = useRef<HTMLInputElement>(null);
  const confirm = useConfirm();
  const nameId = useId();
  const noteId = useId();

  // Escape / backdrop / X ask before throwing away edits
  const dirty = name !== initialName || color !== initialColor || note !== initialNote;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    onSave({
      name: name.trim(),
      color,
      note: note.trim() || undefined,
      nodeIds,
    });
  };

  const handleDelete = async () => {
    if (!onDelete) return;
    const ok = await confirm({
      title: 'Delete this group?',
      message: `“${existingGroup?.name ?? 'This group'}” and its note will be removed. The plan nodes themselves are not changed.`,
      confirmLabel: 'Delete group',
      tone: 'danger',
    });
    if (ok) onDelete();
  };

  return (
    <Dialog
      open
      onClose={onClose}
      title={existingGroup ? 'Edit Group' : 'Create Group'}
      size="sm"
      initialFocusRef={nameRef}
      dirty={dirty}
    >
      <form onSubmit={handleSubmit} className="flex min-h-0 flex-1 flex-col">
        <DialogBody className="space-y-3">
          <div>
            <label htmlFor={nameId} className={FIELD_LABEL}>
              Name
            </label>
            <input
              id={nameId}
              ref={nameRef}
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g., Join path bottleneck"
              className="w-full px-2.5 py-1.5 text-xs border border-slate-200 dark:border-slate-700 rounded-md bg-white dark:bg-slate-950 text-slate-900 dark:text-slate-100 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500/60"
            />
          </div>

          <div role="group" aria-label="Colour">
            <div className={FIELD_LABEL} aria-hidden="true">
              Color
            </div>
            <div className="flex items-center gap-1.5 p-1">
              {HIGHLIGHT_COLORS.map((colorDef) => (
                <button
                  key={colorDef.name}
                  type="button"
                  onClick={() => setColor(colorDef.name)}
                  aria-pressed={color === colorDef.name}
                  aria-label={colorDef.label}
                  className={`w-6 h-6 rounded-full transition-all ${SWATCH_FOCUS} ${
                    color === colorDef.name
                      ? `${colorDef.chipActive} ring-2 ring-offset-2 ring-offset-white dark:ring-offset-slate-900`
                      : colorDef.chip
                  } hover:scale-110`}
                  title={colorDef.label}
                />
              ))}
            </div>
          </div>

          <div>
            <label htmlFor={noteId} className={FIELD_LABEL}>
              Note (optional)
            </label>
            <textarea
              id={noteId}
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Add context..."
              rows={2}
              className="w-full px-2.5 py-1.5 text-xs border border-slate-200 dark:border-slate-700 rounded-md bg-white dark:bg-slate-950 text-slate-900 dark:text-slate-100 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500/60 resize-y"
            />
          </div>

          <div className="text-[11px] text-slate-500 dark:text-slate-400">
            {nodeIds.length} node{nodeIds.length !== 1 ? 's' : ''} selected
          </div>
        </DialogBody>

        <DialogFooter align="between">
          <div>
            {existingGroup && onDelete && (
              <button
                type="button"
                onClick={() => void handleDelete()}
                className={`px-2.5 py-1.5 text-xs text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/30 rounded transition-colors ${FOCUS_RING}`}
              >
                Delete
              </button>
            )}
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              className={`px-2.5 py-1.5 text-xs text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 rounded transition-colors ${FOCUS_RING}`}
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={!name.trim()}
              className={`px-3 py-1.5 text-xs font-medium bg-blue-600 text-white rounded hover:bg-blue-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${FOCUS_RING}`}
            >
              {existingGroup ? 'Update' : 'Create'}
            </button>
          </div>
        </DialogFooter>
      </form>
    </Dialog>
  );
}
