/**
 * Stacking order for overlay primitives. Kept in one place so dialogs, the
 * confirm dialog and toasts always layer correctly regardless of which one is
 * opened from which.
 */
export const Z_DIALOG = 100;
/** Guided-tour overlay: above app chrome and docked panels, below dialogs and toasts. */
export const Z_WALKTHROUGH = 90;
export const Z_CONFIRM = 110;
export const Z_TOAST = 120;
