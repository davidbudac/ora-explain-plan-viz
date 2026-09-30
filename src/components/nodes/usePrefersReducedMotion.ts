import { useSyncExternalStore } from 'react';

/**
 * `prefers-reduced-motion: reduce`, as a React value that updates live.
 *
 * One shared MediaQueryList subscription for the whole app — every plan node
 * reads this, so a per-component listener would multiply with plan size.
 */

const QUERY = '(prefers-reduced-motion: reduce)';

let mediaQuery: MediaQueryList | null | undefined;
const listeners = new Set<() => void>();

function getMediaQuery(): MediaQueryList | null {
  if (mediaQuery !== undefined) return mediaQuery;
  mediaQuery =
    typeof window !== 'undefined' && typeof window.matchMedia === 'function'
      ? window.matchMedia(QUERY)
      : null;
  return mediaQuery;
}

function notify() {
  listeners.forEach((listener) => listener());
}

function subscribe(listener: () => void): () => void {
  const mq = getMediaQuery();
  if (listeners.size === 0) mq?.addEventListener?.('change', notify);
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) mq?.removeEventListener?.('change', notify);
  };
}

function getSnapshot(): boolean {
  return getMediaQuery()?.matches ?? false;
}

function getServerSnapshot(): boolean {
  return false;
}

export function prefersReducedMotion(): boolean {
  return getSnapshot();
}

export function usePrefersReducedMotion(): boolean {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}
