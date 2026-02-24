import { useState, useEffect, useRef, useCallback } from 'react';
import { HIGHLIGHT_COLORS, getHighlightColorDef } from '../lib/annotations';
import type { HighlightColor } from '../lib/annotations';

interface AnnotationEditorProps {
  nodeId: number;
  annotationText: string;
  highlightColor?: HighlightColor;
  onTextChange: (nodeId: number, text: string) => void;
  onTextRemove: (nodeId: number) => void;
  onHighlightChange: (nodeId: number, color: HighlightColor) => void;
  onHighlightRemove: (nodeId: number) => void;
}

export function AnnotationEditor({
  nodeId,
  annotationText,
  highlightColor,
  onTextChange,
  onTextRemove,
  onHighlightChange,
  onHighlightRemove,
}: AnnotationEditorProps) {
  const [localText, setLocalText] = useState(annotationText);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Sync local text when the nodeId changes (switching selected node)
  useEffect(() => {
    setLocalText(annotationText);
  }, [nodeId, annotationText]);

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
    <div className="p-3 border-b border-neutral-200 dark:border-neutral-800">
      <h4 className="text-xs font-semibold text-neutral-700 dark:text-neutral-300 mb-2 uppercase tracking-wide">
        Annotation
      </h4>

      <textarea
        value={localText}
        onChange={(e) => handleTextChange(e.target.value)}
        onBlur={handleBlur}
        placeholder="Add a note..."
        rows={2}
        className="w-full px-2.5 py-1.5 text-xs border border-neutral-200 dark:border-neutral-700 rounded-md bg-white dark:bg-neutral-950 text-neutral-900 dark:text-neutral-100 placeholder-neutral-400 dark:placeholder-neutral-500 focus:outline-none focus:ring-2 focus:ring-blue-500/60 resize-y"
      />

      <div className="flex items-center gap-1.5 mt-2">
        <span className="text-[11px] text-neutral-500 dark:text-neutral-400 mr-1">Highlight:</span>
        {HIGHLIGHT_COLORS.map((colorDef) => {
          const isActive = highlightColor === colorDef.name;
          return (
            <button
              key={colorDef.name}
              onClick={() => handleColorClick(colorDef.name)}
              className={`w-5 h-5 rounded-full transition-all ${
                isActive ? colorDef.chipActive : colorDef.chip
              } hover:scale-110`}
              title={`${colorDef.label}${isActive ? ' (click to remove)' : ''}`}
            />
          );
        })}
      </div>

      {highlightColor && (
        <div className="mt-1.5 flex items-center gap-1">
          <div className={`w-2.5 h-2.5 rounded-full ${getHighlightColorDef(highlightColor).chip}`} />
          <span className="text-[11px] text-neutral-500 dark:text-neutral-400">
            {getHighlightColorDef(highlightColor).label} highlight
          </span>
        </div>
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
      <span className="text-[11px] text-neutral-500 dark:text-neutral-400 mr-1">Highlight all:</span>
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
        className="ml-1 text-[11px] text-neutral-400 hover:text-neutral-600 dark:hover:text-neutral-300"
        title="Clear all highlights"
      >
        Clear
      </button>
    </div>
  );
}
