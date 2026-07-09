import { useState, useEffect, useRef, useCallback } from 'react';
import { HIGHLIGHT_COLORS, HIGHLIGHT_STYLES, getHighlightColorDef } from '../lib/annotations';
import type { HighlightColor, HighlightStyle } from '../lib/annotations';

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
      <h4 className="text-[10px] font-semibold uppercase tracking-wider text-slate-400 dark:text-slate-500 mb-2">
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

      <div className="flex items-center gap-1.5 mt-2">
        <span className="text-[11px] text-slate-500 dark:text-slate-400 mr-1">Highlight:</span>
        {HIGHLIGHT_COLORS.map((colorDef) => {
          const isActive = highlightColor === colorDef.name;
          return (
            <button
              key={colorDef.name}
              onClick={() => handleColorClick(colorDef.name)}
              className={`w-5 h-5 rounded-full transition-all ${
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

          <div className="flex items-center gap-1 mt-2 flex-wrap">
            <span className="text-[11px] text-slate-500 dark:text-slate-400 mr-0.5">Style:</span>
            {HIGHLIGHT_STYLES.map((styleDef) => (
              <button
                key={styleDef.name}
                onClick={() => onHighlightStyleChange(styleDef.name)}
                className={`px-1.5 py-0.5 text-[11px] rounded border border-slate-200 dark:border-slate-700 transition-all ${
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
  const handleColorClick = (color: HighlightColor) => {
    for (const nodeId of nodeIds) {
      onHighlightChange(nodeId, color);
    }
  };

  const handleClear = () => {
    for (const nodeId of nodeIds) {
      onHighlightRemove(nodeId);
    }
  };

  return (
    <div className="flex items-center gap-1.5">
      <span className="text-[11px] text-slate-500 dark:text-slate-400 mr-1">Highlight all:</span>
      {HIGHLIGHT_COLORS.map((colorDef) => (
        <button
          key={colorDef.name}
          onClick={() => handleColorClick(colorDef.name)}
          className={`w-5 h-5 rounded-full transition-all ${colorDef.chip} hover:scale-110`}
          title={colorDef.label}
        />
      ))}
      <button
        onClick={handleClear}
        className="ml-1 text-[11px] text-slate-400 hover:text-slate-600 dark:hover:text-slate-300"
        title="Clear all highlights"
      >
        Clear
      </button>
    </div>
  );
}
