import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { KeyboardEvent as ReactKeyboardEvent, ReactNode, RefObject } from 'react';
import { createPortal } from 'react-dom';
import { surfaceIdOf, stopKeyPropagation } from './toolbarSurface';

/**
 * Small non-modal popover for the node hover toolbar (brush picker, note
 * editor). Portalled to <body> with fixed positioning under the button that
 * opened it — React Flow's zoom/pan transform and the pane's clipping make an
 * in-canvas popover unusable (same reasoning as `NodeHoverCard`).
 *
 * It is a React child of the plan node, so React *synthetic* events bubble out
 * of it into the node wrapper (a click would select the node, arrow keys would
 * move a selected one). Every pointer/keyboard event is therefore stopped at
 * the popover root.
 */

export type PopoverCloseReason = 'escape' | 'outside' | 'scroll' | 'resize';

const VIEWPORT_MARGIN = 8;
const ANCHOR_GAP = 6;

interface NodePopoverProps {
  /** The button the popover hangs under (read when the popover opens). */
  anchorRef: RefObject<HTMLElement | null>;
  /** Shared with the toolbar pill (see `SURFACE_ATTR`). */
  surfaceId: string;
  /** Accessible name of the dialog. */
  label: string;
  className?: string;
  onClose: (reason: PopoverCloseReason) => void;
  children: ReactNode;
}

export function NodePopover({ anchorRef, surfaceId, label, className = '', onClose, children }: NodePopoverProps) {
  const ref = useRef<HTMLDivElement | null>(null);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);

  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  });

  // Measure, then place — before paint, so it never shows unpositioned. Prefers
  // the space below the button, flips above when that would overflow, and is
  // clamped into the viewport horizontally.
  useLayoutEffect(() => {
    const el = ref.current;
    const anchorEl = anchorRef.current;
    if (!el || !anchorEl) return;
    const anchor = anchorEl.getBoundingClientRect();
    const { width, height } = el.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;

    let top = anchor.bottom + ANCHOR_GAP;
    if (top + height > vh - VIEWPORT_MARGIN) {
      const above = anchor.top - ANCHOR_GAP - height;
      top = above >= VIEWPORT_MARGIN ? above : Math.max(VIEWPORT_MARGIN, vh - VIEWPORT_MARGIN - height);
    }
    const maxLeft = Math.max(VIEWPORT_MARGIN, vw - VIEWPORT_MARGIN - width);
    const left = Math.min(Math.max(VIEWPORT_MARGIN, anchor.left), maxLeft);
    setPos({ left, top });
  }, [anchorRef]);

  // Dismissal: a press outside the toolbar surface, a wheel/scroll outside it
  // (the canvas moved, so the fixed popover would drift away from its node), or
  // a window resize.
  useEffect(() => {
    const isInSurface = (target: EventTarget | null) => surfaceIdOf(target) === surfaceId;
    const onPointerDown = (e: PointerEvent) => {
      if (!isInSurface(e.target)) onCloseRef.current('outside');
    };
    const onMove = (e: Event) => {
      if (!isInSurface(e.target)) onCloseRef.current('scroll');
    };
    const onResize = () => onCloseRef.current('resize');
    window.addEventListener('pointerdown', onPointerDown, true);
    window.addEventListener('wheel', onMove, { capture: true, passive: true });
    window.addEventListener('scroll', onMove, { capture: true, passive: true });
    window.addEventListener('resize', onResize);
    return () => {
      window.removeEventListener('pointerdown', onPointerDown, true);
      window.removeEventListener('wheel', onMove, true);
      window.removeEventListener('scroll', onMove, true);
      window.removeEventListener('resize', onResize);
    };
  }, [surfaceId]);

  const handleKeyDown = (e: ReactKeyboardEvent) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      onClose('escape');
      return;
    }
    stopKeyPropagation(e);
  };

  if (typeof document === 'undefined') return null;

  return createPortal(
    <div
      ref={ref}
      role="dialog"
      aria-modal="false"
      aria-label={label}
      data-node-action-surface={surfaceId}
      className={`nodrag nopan nowheel fixed z-[60] rounded-lg border border-slate-200 bg-white p-3 text-slate-700 shadow-xl dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300 ${className}`}
      style={{ left: pos?.left ?? 0, top: pos?.top ?? 0, opacity: pos ? 1 : 0 }}
      onClick={(e) => e.stopPropagation()}
      onDoubleClick={(e) => e.stopPropagation()}
      onPointerDown={(e) => e.stopPropagation()}
      onMouseDown={(e) => e.stopPropagation()}
      onKeyDown={handleKeyDown}
    >
      {children}
    </div>,
    document.body,
  );
}
