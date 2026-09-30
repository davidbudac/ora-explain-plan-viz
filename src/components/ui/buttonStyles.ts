import { FOCUS_RING } from './focusRing';

/**
 * Shared button class recipes for the UI primitives (dialog footers, confirm,
 * error fallback). Text is 13px to match the app's dense chrome.
 */
const BASE =
  'inline-flex items-center justify-center gap-1.5 rounded-md px-3 py-1.5 text-[13px] font-medium ' +
  'transition-colors disabled:opacity-50 disabled:cursor-not-allowed ' +
  FOCUS_RING;

export const BTN_PRIMARY = `${BASE} bg-blue-600 text-white hover:bg-blue-700 dark:bg-blue-500 dark:hover:bg-blue-400 dark:text-slate-950`;

export const BTN_SECONDARY = `${BASE} border border-slate-300 bg-white text-slate-700 hover:bg-slate-50 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700`;

export const BTN_DANGER = `${BASE} bg-red-600 text-white hover:bg-red-700 dark:bg-red-500 dark:hover:bg-red-400 dark:text-slate-950`;
