import { useState, useEffect, useRef, useCallback } from 'react';
import { HIGHLIGHT_COLORS, HIGHLIGHT_STYLES, getHighlightColorDef } from '../lib/annotations';
import type { HighlightColor, HighlightStyle } from '../lib/annotations';
import { FOCUS_RING, useConfirm } from './ui';

/**
 * Focus indicator for the colour swatches. An outline (not FOCUS_RING's ring)
 * so it never fights the swatch's own `ring-2` "selected" marker.
 */
const SWATCH_FOCUS =
  'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-500 dark:focus-visible:outline-blue-400';

interface AnnotationEditorProps {
  nodeId: number;
  annotationText: string;
  highlightColor?: HighlightColor;
  highlightStyle: HighlightStyle;
  onHighlightStyleChange: (style: HighlightStyle) => void;
  onTextChange: (nodeId: number, text: string) => void;
  onTextRemove: (nodeId: number) => void;
  onHighlightChange: (nodeId: number, color: HighlightColor) => void;
  onHighlightRemove: (nodeId: number) => void;
}

export function AnnotationEditor({
  nodeId,
  annotationText,
  highlightColor,
  highlightStyle,
  onHighlightStyleChange,
  onTextChange,
  onTextRemove,
  onHighlightChange,
  onHighlightRemove,
}: AnnotationEditorProps) {
  const [localText, setLocalText] = useState(annotationText);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Sync local text when the nodeId changes (switching selected node) or the
  // annotation text changes from outside (e.g. import), without resetting on
  // every render.
  const [prevNodeId, setPrevNodeId] = useState(nodeId);
  const [prevAnnotationText, setPrevAnnotationText] = useState(annotationText);
  if (nodeId !== prevNodeId || annotationText !== prevAnnotationText) {
    setPrevNodeId(nodeId);
    setPrevAnnotationText(annotationText);
    setLocalText(annotationText);
  }

  const handleTextChange = useCallback(
    (value: string) => {
      setLocalText(value);
      if (debounceRef.current) clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(() => {
        if (value.trim()) {
          onTextChange(nodeId, value);
        } else {
          onTextRemove(nodeId);
        }
      }, 500);
    },
    [nodeId, onTextChange, onTextRemove]
  );

  const handleBlur = useCallback(() => {
    if (debounceRef.current) {
      clearTimeout(debounceRef.current);
      debounceRef.current = null;
    }
    if (localText.trim()) {
      onTextChange(nodeId, localText);
    } else {
      onTextRemove(nodeId);
    }
  }, [nodeId, localText, onTextChange, onTextRemove]);

  useEffect(() => {
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, []);

  const handleColorClick = (color: HighlightColor) => {
    if (highlightColor === color) {
      onHighlightRemove(nodeId);
    } else {
      onHighlightChange(nodeId, color);
    }
  };

  return (
    <div className="p-3 border-b border-slate-200 dark:border-slate-800">
      <h4 className="text-[10px] font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400 mb-2">
        Annotation
      </h4>

      <textarea
        value={localText}
        onChange={(e) => handleTextChange(e.target.value)}
        onBlur={handleBlur}
        placeholder="Add a note..."
        rows={2}
        className="w-full px-2.5 py-1.5 text-xs border border-slate-200 dark:border-slate-700 rounded-md bg-white dark:bg-slate-950 text-slate-900 dark:text-slate-100 placeholder-slate-400 dark:placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-blue-500/60 resize-y"
      />

      <div className="flex items-center gap-1.5 mt-2" role="group" aria-label="Highlight colour">
        <span className="text-[11px] text-slate-500 dark:text-slate-400 mr-1" aria-hidden="true">Highlight:</span>
        {HIGHLIGHT_COLORS.map((colorDef) => {
          const isActive = highlightColor === colorDef.name;
          return (
            <button
              key={colorDef.name}
              type="button"
              onClick={() => handleColorClick(colorDef.name)}
              aria-pressed={isActive}
              aria-label={`${colorDef.label} highlight`}
              className={`w-5 h-5 rounded-full transition-all ${SWATCH_FOCUS} ${
                isActive ? `${colorDef.chipActive} ring-2 ring-offset-2 ring-offset-white dark:ring-offset-slate-900` : colorDef.chip
              } hover:scale-110`}
              title={`${colorDef.label}${isActive ? ' (click to remove)' : ''}`}
            />
          );
        })}
      </div>

      {highlightColor && (
        <>
          <div className="mt-1.5 flex items-center gap-1">
            <div className={`w-2.5 h-2.5 rounded-full ${getHighlightColorDef(highlightColor).chip}`} />
            <span className="text-[11px] text-slate-500 dark:text-slate-400">
              {getHighlightColorDef(highlightColor).label} highlight
            </span>
          </div>

          <div className="flex items-center gap-1 mt-2 flex-wrap" role="group" aria-label="Highlight style">
            <span className="text-[11px] text-slate-500 dark:text-slate-400 mr-0.5" aria-hidden="true">Style:</span>
            {HIGHLIGHT_STYLES.map((styleDef) => (
              <button
                key={styleDef.name}
                type="button"
                aria-pressed={highlightStyle === styleDef.name}
                onClick={() => onHighlightStyleChange(styleDef.name)}
                className={`px-1.5 py-0.5 text-[11px] rounded border border-slate-200 dark:border-slate-700 transition-all ${FOCUS_RING} ${
                  highlightStyle === styleDef.name
                    ? 'bg-slate-900 text-white dark:bg-slate-100 dark:text-slate-900 font-semibold'
                    : 'bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-700'
                }`}
                title={styleDef.description}
              >
                {styleDef.label}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

interface BulkHighlightPickerProps {
  nodeIds: number[];
  onHighlightChange: (nodeId: number, color: HighlightColor) => void;
  onHighlightRemove: (nodeId: number) => void;
}

export function BulkHighlightPicker({
  nodeIds,
  onHighlightChange,
  onHighlightRemove,
}: BulkHighlightPickerProps) {
  const confirm = useConfirm();

  const handleColorClick = (color: HighlightColor) => {
    for (const nodeId of nodeIds) {
      onHighlightChange(nodeId, color);
    }
  };

  const handleClear = async () => {
    // One node is an obvious, easily redone action; several deserve a second look
    if (nodeIds.length > 1) {
      const ok = await confirm({
        title: `Clear highlights on ${nodeIds.length} nodes?`,
        message: 'This removes the colour highlight from every selected node.',
        confirmLabel: 'Clear highlights',
        tone: 'danger',
      });
      if (!ok) return;
    }
    for (const nodeId of nodeIds) {
      onHighlightRemove(nodeId);
    }
  };

  return (
    <div className="flex items-center gap-1.5" role="group" aria-label="Highlight all selected nodes">
      <span className="text-[11px] text-slate-500 dark:text-slate-400 mr-1" aria-hidden="true">Highlight all:</span>
      {HIGHLIGHT_COLORS.map((colorDef) => (
        <button
          key={colorDef.name}
          type="button"
          onClick={() => handleColorClick(colorDef.name)}
          aria-label={`Highlight all selected nodes ${colorDef.label}`}
          className={`w-5 h-5 rounded-full transition-all ${SWATCH_FOCUS} ${colorDef.chip} hover:scale-110`}
          title={colorDef.label}
        />
      ))}
      <button
        type="button"
        onClick={() => void handleClear()}
        className={`ml-1 rounded text-[11px] text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200 ${FOCUS_RING}`}
        title="Clear all highlights"
      >
        Clear
      </button>
    </div>
  );
}
