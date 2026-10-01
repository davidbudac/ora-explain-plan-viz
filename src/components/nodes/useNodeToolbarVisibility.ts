import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import type { MouseEvent as ReactMouseEvent } from 'react';
import { isFocusVisible, surfaceIdOf } from './toolbarSurface';

/**
 * When a plan node's hover toolbar is shown. Local state per node (kept out of
 * the plan context on purpose: every node re-rendering on context changes would
 * be a perf regression on big plans). The toolbar is visible while any of:
 *
 * - the pointer is over the card or over the toolbar pill — shown after a short
 *   delay (so sweeping the mouse across the canvas does not flash toolbars) and
 *   hidden shortly after the pointer has left both (the delay bridges the move
 *   from the card to the portalled pill);
 * - keyboard focus is on the node wrapper (`:focus-visible`) or inside the
 *   toolbar / one of its popovers;
 * - a popover (brush picker, note editor) is open;
 * - the device has a coarse pointer (no hover) and the node is selected.
 *
 * Keyboard entry: Shift+F10 or the Menu key on the focused node shows the
 * toolbar and moves focus to its first button.
 */

export const TOOLBAR_SHOW_DELAY_MS = 80;
export const TOOLBAR_HIDE_DELAY_MS = 160;

/** Touch-first devices have no hover: they get the toolbar on the selected node. */
export function isCoarsePointer(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false;
  return window.matchMedia('(pointer: coarse)').matches;
}

export interface NodeToolbarVisibilityOptions {
  /** The node card's root element (its `.react-flow__node` wrapper is found from it). */
  rootEl: HTMLElement | null;
  /** Off for nodes that cannot show a toolbar at all. */
  enabled: boolean;
  /** Coarse-pointer device and the node is selected. */
  selectedOnTouch: boolean;
}

export interface NodeToolbarVisibility {
  visible: boolean;
  /** Merge into the node card's own mouse handlers. */
  cardHover: {
    onMouseEnter: (event: ReactMouseEvent) => void;
    onMouseLeave: () => void;
  };
  /** Spread onto `<NodeActionToolbar>`. */
  toolbarProps: {
    surfaceId: string;
    autoFocus: boolean;
    onHoverChange: (hovering: boolean) => void;
    onFocusWithinChange: (focused: boolean) => void;
    onPopoverOpenChange: (open: boolean) => void;
    onRequestClose: () => void;
  };
}

export function useNodeToolbarVisibility({ rootEl, enabled, selectedOnTouch }: NodeToolbarVisibilityOptions): NodeToolbarVisibility {
  const surfaceId = useId();
  const [hovered, setHovered] = useState(false);
  const [focusActive, setFocusActive] = useState(false);
  const [popoverOpen, setPopoverOpen] = useState(false);
  const [autoFocus, setAutoFocus] = useState(false);

  const hoveredRef = useRef(false);
  const visibleRef = useRef(false);
  const timerRef = useRef<number | null>(null);
  const wrapperRef = useRef<HTMLElement | null>(null);
  // Focusing the wrapper on purpose (after Escape) must not summon the toolbar again
  const suppressFocusRef = useRef(false);

  const clearTimer = useCallback(() => {
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const commitHovered = useCallback((next: boolean) => {
    hoveredRef.current = next;
    setHovered(next);
  }, []);

  const enter = useCallback(() => {
    clearTimer();
    if (hoveredRef.current) return; // already shown: just cancel the pending hide
    if (visibleRef.current) {
      // Toolbar already visible for another reason (keyboard focus, popover, etc.): commit immediately
      commitHovered(true);
      return;
    }
    timerRef.current = window.setTimeout(() => {
      timerRef.current = null;
      commitHovered(true);
    }, TOOLBAR_SHOW_DELAY_MS);
  }, [clearTimer, commitHovered]);

  const leave = useCallback(() => {
    clearTimer();
    if (!hoveredRef.current) return; // never shown: the pending show is cancelled
    timerRef.current = window.setTimeout(() => {
      timerRef.current = null;
      commitHovered(false);
    }, TOOLBAR_HIDE_DELAY_MS);
  }, [clearTimer, commitHovered]);

  const onCardMouseEnter = useCallback(
    (event: ReactMouseEvent) => {
      // A pressed button means a pan or drag is under way: nodes sweeping under a still pointer must not pop toolbars
      if (event.buttons !== 0) return;
      enter();
    },
    [enter],
  );

  const onHoverChange = useCallback((hovering: boolean) => (hovering ? enter() : leave()), [enter, leave]);

  const onPopoverOpenChange = useCallback(
    (open: boolean) => {
      setPopoverOpen(open);
      if (open) return;
      // A popover is a React child of the node, so React sees the pointer as still "inside" the
      // node while it is over the popover, and no mouseleave follows when the popover unmounts
      // under the pointer. Start from "not hovered"; a real hover re-establishes itself with the
      // next mouseover (React fires mouseenter for pointers arriving from nowhere).
      clearTimer();
      commitHovered(false);
    },
    [clearTimer, commitHovered],
  );

  const onFocusWithinChange = useCallback((focused: boolean) => {
    setFocusActive(focused);
    if (focused) setAutoFocus(false);
  }, []);

  const requestClose = useCallback(() => {
    clearTimer();
    commitHovered(false);
    setFocusActive(false);
    setAutoFocus(false);
    setPopoverOpen(false);
    const wrapper = wrapperRef.current;
    if (wrapper) {
      suppressFocusRef.current = true;
      wrapper.focus({ preventScroll: true });
      // focus() is synchronous; when the wrapper was already focused no event fired to consume the flag
      suppressFocusRef.current = false;
    }
  }, [clearTimer, commitHovered]);

  // Keyboard focus on the React Flow node wrapper + the Shift+F10 / Menu key entry
  useEffect(() => {
    if (!enabled || !rootEl) return;
    const wrapper = rootEl.closest('.react-flow__node');
    if (!(wrapper instanceof HTMLElement)) return;
    wrapperRef.current = wrapper;

    // Mouse clicks focus the wrapper too, so gate on :focus-visible
    const handleFocusIn = (event: FocusEvent) => {
      if (suppressFocusRef.current) return;
      if (isFocusVisible(event.target instanceof Element ? event.target : wrapper)) setFocusActive(true);
    };
    const handleFocusOut = (event: FocusEvent) => {
      const next = event.relatedTarget;
      if (next instanceof Node && wrapper.contains(next)) return;
      // Moving into the toolbar (portalled out of the wrapper) keeps it up
      if (surfaceIdOf(next) === surfaceId) return;
      setFocusActive(false);
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      const isMenuKey = event.key === 'ContextMenu' || (event.key === 'F10' && event.shiftKey);
      if (!isMenuKey) return;
      event.preventDefault();
      setFocusActive(true);
      setAutoFocus(true);
    };
    wrapper.addEventListener('focusin', handleFocusIn);
    wrapper.addEventListener('focusout', handleFocusOut);
    wrapper.addEventListener('keydown', handleKeyDown);
    wrapper.setAttribute('aria-keyshortcuts', 'Shift+F10');
    return () => {
      wrapper.removeEventListener('focusin', handleFocusIn);
      wrapper.removeEventListener('focusout', handleFocusOut);
      wrapper.removeEventListener('keydown', handleKeyDown);
      wrapper.removeAttribute('aria-keyshortcuts');
      if (wrapperRef.current === wrapper) wrapperRef.current = null;
    };
  }, [enabled, rootEl, surfaceId]);

  // A pending show/hide must not outlive the node
  useEffect(() => clearTimer, [clearTimer]);

  const visible = enabled && (hovered || focusActive || popoverOpen || selectedOnTouch);

  // Keep visibleRef in sync so enter() can check if the toolbar is already showing
  useLayoutEffect(() => {
    visibleRef.current = visible;
  }, [visible]);

  return {
    visible,
    cardHover: { onMouseEnter: onCardMouseEnter, onMouseLeave: leave },
    toolbarProps: {
      surfaceId,
      autoFocus,
      onHoverChange,
      onFocusWithinChange,
      onPopoverOpenChange,
      onRequestClose: requestClose,
    },
  };
}
