import { useCallback, useEffect, useRef, useState } from 'react';
import { copyToClipboard } from '../../lib/clipboard';
import { BTN_PRIMARY } from './buttonStyles';
import { FOCUS_RING } from './focusRing';
import { toast } from './Toast';

const COPIED_MS = 1500;

export interface CopyButtonProps {
  /** Text to copy, or a function evaluated at click time (for large/lazy payloads). */
  text: string | (() => string);
  /** Visible label. Default "Copy". */
  label?: string;
  /** Visible label for the success state. Default "Copied". */
  copiedLabel?: string;
  /** Render only the icon (provide `ariaLabel` or `label` for the accessible name). */
  iconOnly?: boolean;
  /** 'xs' (default) for dense chrome, 'sm' for regular toolbars. */
  size?: 'xs' | 'sm';
  /**
   * 'default' is a quiet ghost button for dense chrome; 'primary' uses the
   * shared primary-button recipe (for a dialog's main "Copy script" action).
   */
  variant?: 'default' | 'primary';
  className?: string;
  /** Accessible name override. Defaults to `label`. */
  ariaLabel?: string;
}

function CopyIcon({ size }: { size: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="5.5" y="5.5" width="8" height="8" rx="1.5" />
      <path d="M10.5 3.5v-.25A1.25 1.25 0 0 0 9.25 2h-6A1.25 1.25 0 0 0 2 3.25v6A1.25 1.25 0 0 0 3.25 10.5h.25" />
    </svg>
  );
}

function CheckIcon({ size }: { size: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M3.5 8.5l3 3 6-7" />
    </svg>
  );
}

/**
 * Copy-to-clipboard button. Shows the "copied" state only after the copy
 * actually succeeded; on failure it raises an error toast instead and never
 * flips to the copied state.
 */
export function CopyButton({
  text,
  label = 'Copy',
  copiedLabel = 'Copied',
  iconOnly = false,
  size = 'xs',
  variant = 'default',
  className = '',
  ariaLabel,
}: CopyButtonProps) {
  const [copied, setCopied] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      if (timerRef.current !== undefined) clearTimeout(timerRef.current);
    };
  }, []);

  const handleClick = useCallback(async () => {
    let ok = false;
    try {
      ok = await copyToClipboard(typeof text === 'function' ? text() : text);
    } catch {
      ok = false;
    }

    if (!ok) {
      if (mountedRef.current) setCopied(false);
      toast.show({
        tone: 'error',
        message: 'Copy failed — select the text and copy manually',
      });
      return;
    }

    if (!mountedRef.current) return;
    setCopied(true);
    if (timerRef.current !== undefined) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      timerRef.current = undefined;
      if (mountedRef.current) setCopied(false);
    }, COPIED_MS);
  }, [text]);

  const iconSize = size === 'sm' ? 15 : 13;
  const sizing = size === 'sm' ? 'text-[13px]' : 'text-[12px]';
  const padding = iconOnly ? (size === 'sm' ? 'h-7 w-7' : 'h-6 w-6') : size === 'sm' ? 'h-7 px-2.5' : 'h-6 px-2';
  const tone = copied
    ? 'text-emerald-700 dark:text-emerald-400'
    : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900 dark:text-slate-300 dark:hover:bg-slate-800 dark:hover:text-slate-50';
  const visibleLabel = copied ? copiedLabel : label;
  // The primary variant reuses BTN_PRIMARY wholesale (it already carries the
  // focus ring, padding, height and 13px text), so `size` only affects the
  // icon. While "copied" it keeps the primary surface and just swaps the
  // icon/label, so the button does not change colour under the pointer.
  const classes =
    variant === 'primary'
      ? `${BTN_PRIMARY} shrink-0 ${className}`
      : `inline-flex shrink-0 items-center justify-center gap-1 rounded-md font-medium transition-colors ${sizing} ${padding} ${tone} ${FOCUS_RING} ${className}`;

  return (
    <>
      <button
        type="button"
        onClick={() => void handleClick()}
        aria-label={iconOnly ? (ariaLabel ?? label) : ariaLabel}
        title={iconOnly ? (copied ? copiedLabel : (ariaLabel ?? label)) : undefined}
        data-copied={copied ? 'true' : undefined}
        className={classes}
      >
        {copied ? <CheckIcon size={iconSize} /> : <CopyIcon size={iconSize} />}
        {iconOnly ? null : <span>{visibleLabel}</span>}
      </button>
      <span className="sr-only" aria-live="polite" aria-atomic="true">
        {copied ? copiedLabel : ''}
      </span>
    </>
  );
}
