import { useSyncExternalStore } from 'react';

const QUERY = '(max-width: 1100px)';
function subscribe(onChange: () => void) {
  const media = window.matchMedia(QUERY);
  media.addEventListener('change', onChange);
  return () => media.removeEventListener('change', onChange);
}
function getSnapshot() {
  return window.matchMedia(QUERY).matches;
}

/** Responsive layout never overwrites the user's docked-panel preferences. */
export function useNarrowWorkspace() {
  return useSyncExternalStore(subscribe, getSnapshot, () => false);
}
