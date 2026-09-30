import { createContext, useContext } from 'react';
import type { ReactNode } from 'react';

export interface ConfirmOptions {
  title: string;
  message?: ReactNode;
  /** Label of the affirmative button. Default "Confirm". */
  confirmLabel?: string;
  /** Label of the dismissive button. Default "Cancel". */
  cancelLabel?: string;
  /**
   * 'danger' makes the confirm button red and gives the Cancel button initial
   * focus (so a stray Enter cannot destroy anything). Default 'default'.
   */
  tone?: 'danger' | 'default';
}

/** Resolves true when the user confirms, false on cancel / Escape / backdrop. */
export type ConfirmFn = (options: ConfirmOptions) => Promise<boolean>;

export const ConfirmContext = createContext<ConfirmFn | null>(null);

/**
 * Last-resort implementation used when no `ConfirmProvider` is mounted (for
 * example a component rendered in isolation). Falls back to the native
 * `window.confirm` so destructive flows still ask before proceeding.
 */
const nativeConfirm: ConfirmFn = async ({ title, message }) => {
  if (typeof window === 'undefined' || typeof window.confirm !== 'function') return false;
  const text = typeof message === 'string' ? `${title}\n\n${message}` : title;
  return window.confirm(text);
};

/**
 * Returns `confirm(options)`, a promise-based replacement for `window.confirm`.
 *
 *   const confirm = useConfirm();
 *   if (await confirm({ title: 'Delete note?', tone: 'danger', confirmLabel: 'Delete' })) { … }
 */
export function useConfirm(): ConfirmFn {
  return useContext(ConfirmContext) ?? nativeConfirm;
}
