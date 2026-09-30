/**
 * Stacking order for overlay primitives. Kept in one place so dialogs, the
 * confirm dialog and toasts always layer correctly regardless of which one is
 * opened from which.
 */
export const Z_DIALOG = 100;
export const Z_CONFIRM = 110;
export const Z_TOAST = 120;
