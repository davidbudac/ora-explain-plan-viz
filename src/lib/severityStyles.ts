import type { FindingSeverity } from './advisor';

export const SEVERITY_STYLES: Record<FindingSeverity, { banner: string; text: string; chip: string }> = {
  info: {
    banner: 'bg-sky-50 dark:bg-sky-950/30 border-sky-500/20',
    text: 'text-sky-700 dark:text-sky-300',
    chip: 'bg-sky-100 dark:bg-sky-900/40 text-sky-700 dark:text-sky-300',
  },
  warning: {
    banner: 'bg-amber-50 dark:bg-amber-950/30 border-amber-500/20',
    text: 'text-amber-700 dark:text-amber-300',
    chip: 'bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-300',
  },
  critical: {
    banner: 'bg-red-50 dark:bg-red-950/30 border-red-500/20',
    text: 'text-red-700 dark:text-red-300',
    chip: 'bg-red-100 dark:bg-red-900/40 text-red-700 dark:text-red-300',
  },
};
