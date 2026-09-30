import type { KeyboardEvent as ReactKeyboardEvent, PointerEvent as ReactPointerEvent } from 'react';
import { FOCUS_RING } from './ui';

interface PanelEdgeTabProps {
  /** Which canvas seam the tab is attached to — i.e. which panel it collapses. */
  side: 'left' | 'right';
  label: string;
  onClick: () => void;
}

/**
 * Small tab riding the canvas seam that collapses the adjoining panel. It sits
 * inside the (relative) canvas `<main>` and replaces the old in-header chevron
 * buttons, so the panel headers stay free of furniture. At rest it is a bare
 * chevron; hover/focus reveals the label. Reopening is handled by the panels'
 * own collapsed rails.
 */
export function PanelEdgeTab({ side, label, onClick }: PanelEdgeTabProps) {
  const isLeft = side === 'left';

  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      title={label}
      aria-expanded={true}
      className={`group absolute top-1/2 -translate-y-1/2 z-30 h-16 min-w-[18px] max-w-[18px] hover:max-w-[150px] focus-visible:max-w-[150px] hover:px-2 focus-visible:px-2 flex items-center justify-center gap-1.5 overflow-hidden shadow-sm
        bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-600
        text-slate-400 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-100
        hover:bg-slate-50 dark:hover:bg-slate-700
        motion-safe:transition-all motion-safe:duration-150
        ${isLeft ? 'left-0 border-l-0 rounded-r-lg' : 'right-0 border-r-0 rounded-l-lg'}
        ${FOCUS_RING}`}
    >
      <svg
        className="shrink-0 w-3 h-3"
        fill="none"
        viewBox="0 0 24 24"
        stroke="currentColor"
        strokeWidth={2}
        aria-hidden="true"
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          d={isLeft ? 'M15 19l-7-7 7-7' : 'M9 5l7 7-7 7'}
        />
      </svg>
      <span className="max-w-0 opacity-0 group-hover:max-w-[90px] group-hover:opacity-100 group-focus-visible:max-w-[90px] group-focus-visible:opacity-100 motion-safe:transition-all motion-safe:duration-150 whitespace-nowrap text-[11px] font-semibold">
        {label}
      </span>
    </button>
  );
}

/** Keyboard step for splitter resizing (Shift = coarse). */
const RESIZE_STEP_PX = 16;
const RESIZE_STEP_COARSE_PX = 64;

export interface PanelResizeHandleProps {
  /** Edge of the canvas the panel sits on; decides which arrow grows it. */
  side: 'left' | 'right';
  label: string;
  /** Current panel width in px (`aria-valuenow`). */
  width: number;
  minWidth?: number;
  maxWidth?: number;
  /** id of the panel element this splitter sizes. */
  controls?: string;
  // Method syntax on purpose: callers pass handlers typed for a narrower
  // element (e.g. HTMLButtonElement) and method parameters are bivariant.
  onPointerDown(event: ReactPointerEvent<HTMLElement>): void;
  /**
   * Keyboard resizing: called with a width delta in px. Without it the
   * splitter still works with the pointer but is not a keyboard tab stop.
   */
  onResizeBy?: (delta: number) => void;
}

/**
 * Window-splitter handle on a docked panel's inner edge: `role="separator"`
 * with the panel width as its value; drag with the pointer, or focus it and
 * use ←/→ (Shift for bigger steps) and Home/End.
 */
export function PanelResizeHandle({
  side,
  label,
  width,
  minWidth,
  maxWidth,
  controls,
  onPointerDown,
  onResizeBy,
}: PanelResizeHandleProps) {
  const onKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (!onResizeBy) return;
    const step = event.shiftKey ? RESIZE_STEP_COARSE_PX : RESIZE_STEP_PX;
    // The left panel grows to the right; the right panel grows to the left.
    const grow = side === 'left' ? 'ArrowRight' : 'ArrowLeft';
    const shrink = side === 'left' ? 'ArrowLeft' : 'ArrowRight';
    let delta: number | null = null;
    if (event.key === grow) delta = step;
    else if (event.key === shrink) delta = -step;
    else if (event.key === 'Home' && minWidth !== undefined) delta = minWidth - width;
    else if (event.key === 'End' && maxWidth !== undefined) delta = maxWidth - width;
    if (delta === null) return;
    event.preventDefault();
    event.stopPropagation();
    if (delta !== 0) onResizeBy(delta);
  };

  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label={label}
      aria-valuenow={Math.round(width)}
      aria-valuemin={minWidth}
      aria-valuemax={maxWidth}
      aria-controls={controls}
      tabIndex={onResizeBy ? 0 : undefined}
      title={label}
      onPointerDown={onPointerDown}
      onKeyDown={onKeyDown}
      className={`absolute ${side === 'left' ? 'right-0' : 'left-0'} top-0 z-10 h-full w-1 cursor-col-resize touch-none bg-transparent hover:bg-slate-200/70 dark:hover:bg-slate-700/70 focus-visible:bg-blue-500/40 transition-colors ${FOCUS_RING}`}
    />
  );
}
