import { useEffect, useRef } from 'react';
import type { CSSProperties } from 'react';
import { HIGHLIGHT_COLORS, HIGHLIGHT_STYLES } from '../../lib/annotations';
import type { HighlightBrush, HighlightStyle } from '../../lib/annotations';
import { BTN_PRIMARY, FOCUS_RING } from '../ui';
import { brushHex } from './brush';

/**
 * Contents of the toolbar's "Highlight brush" popover: step 1 of the two-step
 * flow. Picking a colour or a style only changes the brush; painting is a
 * separate, explicit action (the toolbar's paint button or the footer button).
 */

/**
 * Focus indicator for the colour swatches. An outline (not FOCUS_RING's ring)
 * so it never fights the swatch's own `ring-2` "selected" marker.
 */
const SWATCH_FOCUS =
  'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-500 dark:focus-visible:outline-blue-400';

const COMPACT_BTN = '!px-2.5 !py-1 !text-xs';

interface BrushPickerProps {
  brush: HighlightBrush;
  nodeId: number;
  /** The node already carries a highlight (offers "Clear highlight"). */
  hasHighlight: boolean;
  onBrushChange: (patch: Partial<HighlightBrush>) => void;
  /** Paint this node with the brush (never un-paints) and close. */
  onPaint: () => void;
  onClear: () => void;
}

export function BrushPicker({ brush, nodeId, hasHighlight, onBrushChange, onPaint, onClear }: BrushPickerProps) {
  const activeSwatchRef = useRef<HTMLButtonElement | null>(null);

  // Open with the current brush colour focused
  useEffect(() => {
    activeSwatchRef.current?.focus({ preventScroll: true });
  }, []);

  const hex = brushHex(brush.color);

  return (
    <div className="w-64">
      <div className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
        Highlight brush
      </div>

      <div className="flex items-center gap-1.5" role="group" aria-label="Brush colour">
        {HIGHLIGHT_COLORS.map((colorDef) => {
          const active = brush.color === colorDef.name;
          return (
            <button
              key={colorDef.name}
              ref={active ? activeSwatchRef : undefined}
              type="button"
              aria-pressed={active}
              aria-label={`${colorDef.label} brush`}
              title={colorDef.label}
              onClick={() => onBrushChange({ color: colorDef.name })}
              className={`h-5 w-5 rounded-full transition-all ${SWATCH_FOCUS} ${
                active
                  ? `${colorDef.chipActive} ring-2 ring-offset-2 ring-offset-white dark:ring-offset-slate-900`
                  : colorDef.chip
              } hover:scale-110`}
            />
          );
        })}
      </div>

      <div className="mt-3 grid grid-cols-3 gap-1.5" role="group" aria-label="Brush style">
        {HIGHLIGHT_STYLES.map((styleDef) => {
          const active = brush.style === styleDef.name;
          return (
            <button
              key={styleDef.name}
              type="button"
              aria-pressed={active}
              title={styleDef.description}
              onClick={() => onBrushChange({ style: styleDef.name })}
              className={`flex flex-col items-center gap-1 rounded-md border px-1 py-1.5 text-[11px] transition-colors ${FOCUS_RING} ${
                active
                  ? 'border-slate-900 bg-slate-100 font-semibold text-slate-900 dark:border-slate-100 dark:bg-slate-800 dark:text-slate-100'
                  : 'border-slate-200 text-slate-600 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-400 dark:hover:bg-slate-800'
              }`}
            >
              <HighlightStylePreview style={styleDef.name} hex={hex} />
              {styleDef.label}
            </button>
          );
        })}
      </div>

      <div className="mt-3 flex items-center justify-end gap-2">
        {hasHighlight && (
          <button
            type="button"
            onClick={onClear}
            className={`mr-auto rounded text-[11px] text-slate-500 hover:text-red-600 dark:text-slate-400 dark:hover:text-red-400 ${FOCUS_RING}`}
          >
            Clear highlight
          </button>
        )}
        <button type="button" onClick={onPaint} className={`${BTN_PRIMARY} ${COMPACT_BTN}`}>
          Paint #{nodeId}
        </button>
      </div>
    </div>
  );
}

/**
 * A ~36×22 mini card drawn in one highlight style and colour, so the style
 * grid previews exactly what the brush will do.
 */
export function HighlightStylePreview({ style, hex }: { style: HighlightStyle; hex: string }) {
  const cardStyle: CSSProperties = {};
  if (style === 'tint') cardStyle.backgroundColor = `${hex}2e`;
  if (style === 'glow') cardStyle.boxShadow = `0 0 6px 2px ${hex}99`;
  if (style === 'hachure') {
    cardStyle.backgroundImage = `repeating-linear-gradient(-45deg, ${hex}73 0, ${hex}73 1.5px, transparent 1.5px, transparent 5px)`;
  }

  return (
    <span aria-hidden="true" className="relative block h-[22px] w-9">
      <span
        className="absolute inset-[3px] block rounded-[3px] border border-slate-300 bg-white dark:border-slate-600 dark:bg-slate-800"
        style={cardStyle}
      >
        <span className="absolute left-[3px] top-[3px] block h-[2px] w-[12px] rounded-full bg-slate-400 dark:bg-slate-500" />
        <span className="absolute left-[3px] top-[8px] block h-[2px] w-[8px] rounded-full bg-slate-300 dark:bg-slate-600" />
      </span>

      {style === 'circle' && (
        <svg className="absolute inset-0 h-full w-full" viewBox="0 0 36 22" fill="none">
          <ellipse cx="18" cy="11" rx="16.5" ry="9.5" stroke={hex} strokeWidth="1.6" opacity="0.8" transform="rotate(-3 18 11)" />
          <ellipse cx="18.5" cy="11.5" rx="15.5" ry="8.5" stroke={hex} strokeWidth="1.2" opacity="0.45" transform="rotate(2 18 11)" />
        </svg>
      )}

      {style === 'dot' && (
        <span
          className="absolute -right-px -top-px block h-[7px] w-[7px] rounded-full"
          style={{ backgroundColor: hex, boxShadow: `0 0 4px 1px ${hex}80` }}
        />
      )}

      {style === 'underline' && (
        <svg className="absolute inset-0 h-full w-full" viewBox="0 0 36 22" fill="none">
          <path d="M 5,13.5 C 11,12.2 16,14.6 21,13.2 C 24,12.5 26,13.6 29,13.2" stroke={hex} strokeWidth="1.8" strokeLinecap="round" opacity="0.85" />
        </svg>
      )}
    </span>
  );
}
