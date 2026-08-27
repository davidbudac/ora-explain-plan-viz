/* eslint-disable react-refresh/only-export-components */
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { ReactNode } from 'react';

/**
 * Progressive disclosure for the Minimal density preset: the node body is
 * stripped to one metric line, and everything it hides comes back in a floating
 * card after a short hover (or on keyboard focus).
 *
 * The card is portalled to <body> with fixed positioning derived from the node's
 * bounding rect — React Flow's zoom/pan transform and the pane's overflow
 * clipping make an in-node absolutely positioned popover unusable.
 */

const HOVER_DELAY_MS = 250;
const VIEWPORT_MARGIN = 8;
const ANCHOR_GAP = 10;

/** Touch/pen input never gets a hover card — there is no hover to disclose from. */
function isCoarsePointer(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false;
  return window.matchMedia('(pointer: coarse)').matches;
}

export interface NodeHoverCardController {
  anchorRef: (el: HTMLDivElement | null) => void;
  anchorRect: DOMRect | null;
  hoverProps: {
    onMouseEnter: () => void;
    onMouseLeave: () => void;
  };
}

/**
 * Hover/focus timing + dismissal for a single node's hover card.
 * `enabled` is the Minimal-density gate: when false nothing is ever scheduled.
 */
export function useNodeHoverCard(enabled: boolean): NodeHoverCardController {
  const anchorElRef = useRef<HTMLDivElement | null>(null);
  const timerRef = useRef<number | null>(null);
  const [rect, setRect] = useState<DOMRect | null>(null);
  // Leaving Minimal density hides the card without touching state.
  const anchorRect = enabled ? rect : null;

  const clearTimer = useCallback(() => {
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const close = useCallback(() => {
    clearTimer();
    setRect((prev) => (prev === null ? prev : null));
  }, [clearTimer]);

  const openNow = useCallback(() => {
    const el = anchorElRef.current;
    if (!el) return;
    setRect(el.getBoundingClientRect());
  }, []);

  const onMouseEnter = useCallback(() => {
    if (!enabled || isCoarsePointer()) return;
    clearTimer();
    timerRef.current = window.setTimeout(() => {
      timerRef.current = null;
      openNow();
    }, HOVER_DELAY_MS);
  }, [enabled, clearTimer, openNow]);

  const onMouseLeave = useCallback(() => {
    close();
  }, [close]);

  // Unmount (or a density switch) must not leave a pending open behind.
  useEffect(() => clearTimer, [enabled, clearTimer]);

  // Keyboard focus on the React Flow node wrapper discloses the card as well.
  // Mouse clicks focus the wrapper too, so gate on :focus-visible.
  const [anchorEl, setAnchorEl] = useState<HTMLDivElement | null>(null);
  const anchorRef = useCallback((el: HTMLDivElement | null) => {
    anchorElRef.current = el;
    setAnchorEl(el);
  }, []);

  useEffect(() => {
    if (!enabled || !anchorEl) return;
    const wrapper = anchorEl.closest('.react-flow__node');
    if (!(wrapper instanceof HTMLElement)) return;
    const handleFocusIn = () => {
      let keyboard = true;
      try {
        keyboard = wrapper.matches(':focus-visible');
      } catch {
        keyboard = true;
      }
      if (keyboard) openNow();
    };
    const handleFocusOut = () => close();
    wrapper.addEventListener('focusin', handleFocusIn);
    wrapper.addEventListener('focusout', handleFocusOut);
    return () => {
      wrapper.removeEventListener('focusin', handleFocusIn);
      wrapper.removeEventListener('focusout', handleFocusOut);
    };
  }, [enabled, anchorEl, openNow, close]);

  // While open, any pan / zoom / scroll / press / Escape dismisses immediately:
  // the fixed position would otherwise drift away from its node.
  useEffect(() => {
    if (anchorRect === null) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close();
    };
    const capture = { capture: true } as const;
    window.addEventListener('wheel', close, { capture: true, passive: true });
    window.addEventListener('scroll', close, { capture: true, passive: true });
    window.addEventListener('pointerdown', close, capture);
    window.addEventListener('keydown', onKeyDown, capture);
    window.addEventListener('resize', close);
    return () => {
      window.removeEventListener('wheel', close, capture);
      window.removeEventListener('scroll', close, capture);
      window.removeEventListener('pointerdown', close, capture);
      window.removeEventListener('keydown', onKeyDown, capture);
      window.removeEventListener('resize', close);
    };
  }, [anchorRect, close]);

  return { anchorRef, anchorRect, hoverProps: { onMouseEnter, onMouseLeave } };
}

interface NodeHoverCardProps {
  /** Viewport-space rect of the node the card belongs to. */
  anchorRect: DOMRect;
  children: ReactNode;
}

export function NodeHoverCard({ anchorRect, children }: NodeHoverCardProps) {
  const cardRef = useRef<HTMLDivElement | null>(null);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);

  // Measure, then place — runs before paint, so the card never shows unpositioned.
  useLayoutEffect(() => {
    const el = cardRef.current;
    if (!el) return;
    const { width, height } = el.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;

    // Prefer the right flank; flip to the left, then clamp, when it overflows.
    let left = anchorRect.right + ANCHOR_GAP;
    if (left + width > vw - VIEWPORT_MARGIN) {
      const flipped = anchorRect.left - ANCHOR_GAP - width;
      left = flipped >= VIEWPORT_MARGIN ? flipped : Math.max(VIEWPORT_MARGIN, vw - VIEWPORT_MARGIN - width);
    }

    // Top-aligned with the node; ride up (or clamp) rather than leave the viewport.
    let top = anchorRect.top;
    if (top + height > vh - VIEWPORT_MARGIN) top = anchorRect.bottom - height;
    const maxTop = Math.max(VIEWPORT_MARGIN, vh - VIEWPORT_MARGIN - height);
    top = Math.min(Math.max(VIEWPORT_MARGIN, top), maxTop);

    setPos({ left, top });
  }, [anchorRect]);

  if (typeof document === 'undefined') return null;

  return createPortal(
    <div
      ref={cardRef}
      role="tooltip"
      className="fixed z-[60] pointer-events-none w-72 max-h-[70vh] overflow-hidden rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 shadow-xl p-3 text-slate-700 dark:text-slate-300"
      style={{ left: pos?.left ?? 0, top: pos?.top ?? 0, opacity: pos ? 1 : 0 }}
    >
      {children}
    </div>,
    document.body,
  );
}
