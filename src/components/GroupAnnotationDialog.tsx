import { useState, useRef, useEffect } from 'react';
import { HIGHLIGHT_COLORS } from '../lib/annotations';
import type { HighlightColor, AnnotationGroup } from '../lib/annotations';

interface GroupAnnotationDialogProps {
  nodeIds: number[];
  existingGroup?: AnnotationGroup;
  onSave: (data: { name: string; color: HighlightColor; note?: string; nodeIds: number[] }) => void;
  onDelete?: () => void;
  onClose: () => void;
}

export function GroupAnnotationDialog({
  nodeIds,
  existingGroup,
  onSave,
  onDelete,
  onClose,
}: GroupAnnotationDialogProps) {
  const [name, setName] = useState(existingGroup?.name || '');
  const [color, setColor] = useState<HighlightColor>(existingGroup?.color || 'blue');
  const [note, setNote] = useState(existingGroup?.note || '');
  const nameRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    nameRef.current?.focus();
  }, []);

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

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 dark:bg-black/50">
      <form
        onSubmit={handleSubmit}
        className="bg-[var(--surface)] dark:bg-[var(--surface-dark)] rounded-sm shadow-xl border border-[var(--border-color)] dark:border-[var(--border-color-dark)] p-4 w-80 max-w-[90vw]"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="text-sm font-semibold text-[var(--text-primary)] dark:text-[var(--text-primary-dark)] mb-3">
          {existingGroup ? 'Edit Group' : 'Create Group'}
        </h3>

        <div className="space-y-3">
          <div>
            <label className="block text-[11px] font-medium text-slate-600 dark:text-slate-400 mb-1 uppercase tracking-wide">
              Name
            </label>
            <input
              ref={nameRef}
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g., Join path bottleneck"
              className="w-full px-2.5 py-1.5 text-xs border border-[var(--border-color)] dark:border-[var(--border-color-dark)] rounded-sm bg-white dark:bg-slate-950 text-[var(--text-primary)] dark:text-[var(--text-primary-dark)] placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500/60"
            />
          </div>

          <div>
            <label className="block text-[11px] font-medium text-slate-600 dark:text-slate-400 mb-1 uppercase tracking-wide">
              Color
            </label>
            <div className="flex items-center gap-1.5">
              {HIGHLIGHT_COLORS.map((colorDef) => (
                <button
                  key={colorDef.name}
                  type="button"
                  onClick={() => setColor(colorDef.name)}
                  className={`w-6 h-6 rounded-full transition-all ${
                    color === colorDef.name ? colorDef.chipActive : colorDef.chip
                  } hover:scale-110`}
                  title={colorDef.label}
                />
              ))}
            </div>
          </div>

          <div>
            <label className="block text-[11px] font-medium text-slate-600 dark:text-slate-400 mb-1 uppercase tracking-wide">
              Note (optional)
            </label>
            <textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Add context..."
              rows={2}
              className="w-full px-2.5 py-1.5 text-xs border border-[var(--border-color)] dark:border-[var(--border-color-dark)] rounded-sm bg-white dark:bg-slate-950 text-[var(--text-primary)] dark:text-[var(--text-primary-dark)] placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500/60 resize-y"
            />
          </div>

          <div className="text-[11px] text-[var(--text-muted)] dark:text-[var(--text-muted-dark)]">
            {nodeIds.length} node{nodeIds.length !== 1 ? 's' : ''} selected
          </div>
        </div>

        <div className="flex items-center justify-between mt-4 pt-3 border-t border-[var(--border-color)] dark:border-[var(--border-color-dark)]">
          <div>
            {existingGroup && onDelete && (
              <button
                type="button"
                onClick={onDelete}
                className="px-2.5 py-1.5 text-xs text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/30 rounded transition-colors"
              >
                Delete
              </button>
            )}
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              className="px-2.5 py-1.5 text-xs text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 rounded transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={!name.trim()}
              className="px-3 py-1.5 text-xs font-medium bg-blue-600 text-white rounded hover:bg-blue-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {existingGroup ? 'Update' : 'Create'}
            </button>
          </div>
        </div>
      </form>
    </div>
  );
}
