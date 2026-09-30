import { useSyncExternalStore } from 'react';

/**
 * How much the single top bar has to compact its non-ribbon clusters. Written
 * by the view-tab ribbon (`ViewTabStrip`), which measures the whole bar and
 * decides the allocation (see `lib/topBarLayout.ts`); read by the clusters that
 * render the collapsible pieces (plan tabs, header actions, and any button in
 * the bar that marks its text with `data-topbar-label`).
 *
 * Only one top bar is mounted at a time (normal or maximized), so a single
 * module-level value is enough. The ribbon resets it when it unmounts.
 */
export interface TopBarMode {
  /** Buttons in the bar show icons only (their `data-topbar-label` text is visually hidden). */
  labelsCollapsed: boolean;
  /** Plan tabs hide their secondary text (PHV, the "Add Plan" label). */
  planCompact: boolean;
  /** Plan tabs may shrink and scroll (last resort). */
  planSqueezed: boolean;
  /** Width the plan tabs get while squeezed; null otherwise. */
  planWidth: number | null;
}

/**
 * Attribute that marks a text label inside a top-bar button as collapsible.
 * The button must keep an icon and an `aria-label` so it still reads and works
 * with the label hidden: `<span data-topbar-label className={labelsCollapsed ? 'sr-only' : ''}>`.
 */
export const TOP_BAR_LABEL_ATTR = 'data-topbar-label';

const DEFAULT_MODE: TopBarMode = { labelsCollapsed: false, planCompact: false, planSqueezed: false, planWidth: null };

let current: TopBarMode = DEFAULT_MODE;
const listeners = new Set<() => void>();

export function setTopBarMode(next: TopBarMode): void {
  if (
    next.labelsCollapsed === current.labelsCollapsed &&
    next.planCompact === current.planCompact &&
    next.planSqueezed === current.planSqueezed &&
    next.planWidth === current.planWidth
  ) {
    return;
  }
  current = next;
  listeners.forEach((listener) => listener());
}

export function resetTopBarMode(): void {
  setTopBarMode(DEFAULT_MODE);
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

const getSnapshot = () => current;
const getServerSnapshot = () => DEFAULT_MODE;

export function useTopBarMode(): TopBarMode {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}
