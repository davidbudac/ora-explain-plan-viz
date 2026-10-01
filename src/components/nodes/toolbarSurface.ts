/**
 * Shared plumbing for the node hover toolbar and its popovers.
 *
 * The toolbar pill and each popover carry `data-node-action-surface="<id>"`, so
 * "inside the toolbar" can be answered for DOM that is not nested (the pill
 * lives in React Flow's renderer, popovers in <body>).
 */

export const SURFACE_ATTR = 'data-node-action-surface';

/** The surface id of the nearest toolbar/popover element around `target`, if any. */
export function surfaceIdOf(target: EventTarget | null): string | null {
  if (!(target instanceof Element)) return null;
  return target.closest(`[${SURFACE_ATTR}]`)?.getAttribute(SURFACE_ATTR) ?? null;
}

/**
 * Stops a keyboard event from reaching the React Flow node wrapper (Enter/Space
 * would select the node, arrows would move it) and the window-level handlers
 * (Escape deselects, arrows navigate the tree). Cmd/Ctrl+letter chords are let
 * through so the command palette (Cmd+K) keeps working.
 */
export function stopKeyPropagation(event: {
  key: string;
  metaKey: boolean;
  ctrlKey: boolean;
  stopPropagation: () => void;
}): void {
  if ((event.metaKey || event.ctrlKey) && event.key.length === 1) return;
  event.stopPropagation();
}

/** `:focus-visible` with a safe default where the selector is unsupported (old engines, jsdom). */
export function isFocusVisible(el: EventTarget | null): boolean {
  if (!(el instanceof Element)) return false;
  try {
    return el.matches(':focus-visible');
  } catch {
    return true;
  }
}
