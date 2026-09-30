/* eslint-disable react-refresh/only-export-components */
import { createContext, useCallback, useContext, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { FocusEvent, ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { generateId } from '../../lib/ids';
import { FOCUS_RING } from './focusRing';
import { Z_TOAST } from './layers';

export type ToastTone = 'success' | 'error' | 'info' | 'warning';

export interface ToastOptions {
  title?: string;
  message: ReactNode;
  /** Default 'info'. */
  tone?: ToastTone;
  /**
   * Milliseconds before auto-dismiss. Default 5000 (8000 for errors).
   * `0` or `Infinity` keeps the toast until dismissed.
   */
  duration?: number;
  /** Optional inline action; the toast is dismissed after it runs. */
  action?: { label: string; onClick: () => void };
}

export interface ToastApi {
  /** Shows a toast and returns its id. */
  show: (options: ToastOptions) => string;
  dismiss: (id: string) => void;
}

interface ToastItem {
  id: string;
  options: ToastOptions;
}

const MAX_TOASTS = 4;
const DEFAULT_DURATION = 5000;
const ERROR_DURATION = 8000;
/** After a hover/focus pause, never resume with less than this left. */
const MIN_RESUME_MS = 1000;

// ---------------------------------------------------------------------------
// Non-hook accessor for plain library code
// ---------------------------------------------------------------------------

/** The mounted provider's API; null when no `ToastProvider` is mounted. */
let activeApi: ToastApi | null = null;

/**
 * Hook-free toast accessor bound to the mounted `ToastProvider`, for code
 * outside React (e.g. `src/lib/fileExport.ts`):
 *
 *   toast.show({ tone: 'error', message: 'Export failed' });
 *
 * With no provider mounted, errors/warnings are logged to the console and
 * other tones are dropped; an id is still returned.
 */
export const toast: ToastApi = {
  show(options) {
    if (activeApi) return activeApi.show(options);
    if (options.tone === 'error' || options.tone === 'warning') {
      console.warn('[toast]', options.title ?? '', options.message);
    }
    return generateId();
  },
  dismiss(id) {
    activeApi?.dismiss(id);
  },
};

// ---------------------------------------------------------------------------
// Provider + hook
// ---------------------------------------------------------------------------

const ToastContext = createContext<ToastApi | null>(null);

/** Hook variant of the toast API. Falls back to the module-level accessor outside a provider. */
export function useToast(): ToastApi {
  return useContext(ToastContext) ?? toast;
}

export function ToastProvider({ children }: { children?: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);

  const dismiss = useCallback((id: string) => {
    setItems((current) => current.filter((item) => item.id !== id));
  }, []);

  const show = useCallback((options: ToastOptions) => {
    const id = generateId();
    // Oldest toasts fall off the top once the stack is full.
    setItems((current) => [...current, { id, options }].slice(-MAX_TOASTS));
    return id;
  }, []);

  const api = useMemo<ToastApi>(() => ({ show, dismiss }), [show, dismiss]);

  // Layout effect so the accessor is live before any child's passive effects run.
  useLayoutEffect(() => {
    activeApi = api;
    return () => {
      if (activeApi === api) activeApi = null;
    };
  }, [api]);

  return (
    <ToastContext.Provider value={api}>
      {children}
      {typeof document !== 'undefined'
        ? createPortal(
            <div
              data-ui-toast-region=""
              style={{ zIndex: Z_TOAST }}
              className="pointer-events-none fixed bottom-4 right-4 flex w-[min(24rem,calc(100vw-2rem))] flex-col gap-2"
            >
              {items.map((item) => (
                <ToastCard key={item.id} item={item} onDismiss={dismiss} />
              ))}
            </div>,
            document.body,
          )
        : null}
    </ToastContext.Provider>
  );
}

// ---------------------------------------------------------------------------
// A single toast
// ---------------------------------------------------------------------------

const TONE_STYLES: Record<ToastTone, { accent: string; icon: string }> = {
  success: { accent: 'border-l-emerald-500', icon: 'text-emerald-600 dark:text-emerald-400' },
  error: { accent: 'border-l-red-500', icon: 'text-red-600 dark:text-red-400' },
  warning: { accent: 'border-l-amber-500', icon: 'text-amber-600 dark:text-amber-400' },
  info: { accent: 'border-l-blue-500', icon: 'text-blue-600 dark:text-blue-400' },
};

function ToneIcon({ tone }: { tone: ToastTone }) {
  const common = {
    width: 16,
    height: 16,
    viewBox: '0 0 16 16',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 1.6,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
    'aria-hidden': true,
  };
  switch (tone) {
    case 'success':
      return (
        <svg {...common}>
          <circle cx="8" cy="8" r="6.25" />
          <path d="M5.25 8.25l1.9 1.9 3.6-4" />
        </svg>
      );
    case 'error':
      return (
        <svg {...common}>
          <circle cx="8" cy="8" r="6.25" />
          <path d="M8 4.75v3.9M8 11.1v.05" />
        </svg>
      );
    case 'warning':
      return (
        <svg {...common}>
          <path d="M8 2.5l6 10.5H2L8 2.5z" />
          <path d="M8 6.75v2.9M8 11.4v.05" />
        </svg>
      );
    default:
      return (
        <svg {...common}>
          <circle cx="8" cy="8" r="6.25" />
          <path d="M8 7.25v3.6M8 4.9v.05" />
        </svg>
      );
  }
}

function ToastCard({ item, onDismiss }: { item: ToastItem; onDismiss: (id: string) => void }) {
  const { id, options } = item;
  const tone = options.tone ?? 'info';
  const duration = options.duration ?? (tone === 'error' ? ERROR_DURATION : DEFAULT_DURATION);
  const sticky = !Number.isFinite(duration) || duration <= 0;
  const isAlert = tone === 'error' || tone === 'warning';

  const timerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const remainingRef = useRef(duration);
  const startedAtRef = useRef(0);
  const hoveredRef = useRef(false);
  const focusedRef = useRef(false);

  const startTimer = useCallback(() => {
    if (sticky || timerRef.current !== undefined) return;
    startedAtRef.current = Date.now();
    timerRef.current = setTimeout(() => {
      timerRef.current = undefined;
      onDismiss(id);
    }, remainingRef.current);
  }, [sticky, id, onDismiss]);

  const pauseTimer = useCallback(() => {
    if (timerRef.current === undefined) return;
    clearTimeout(timerRef.current);
    timerRef.current = undefined;
    remainingRef.current = Math.max(MIN_RESUME_MS, remainingRef.current - (Date.now() - startedAtRef.current));
  }, []);

  useLayoutEffect(() => {
    startTimer();
    return () => {
      if (timerRef.current !== undefined) {
        clearTimeout(timerRef.current);
        timerRef.current = undefined;
      }
    };
  }, [startTimer]);

  const onBlur = (event: FocusEvent<HTMLDivElement>) => {
    const next = event.relatedTarget;
    if (next instanceof Node && event.currentTarget.contains(next)) return;
    focusedRef.current = false;
    if (!hoveredRef.current) startTimer();
  };

  const { accent, icon } = TONE_STYLES[tone];

  return (
    <div
      role={isAlert ? 'alert' : 'status'}
      aria-live={isAlert ? undefined : 'polite'}
      aria-atomic="true"
      data-tone={tone}
      onMouseEnter={() => {
        hoveredRef.current = true;
        pauseTimer();
      }}
      onMouseLeave={() => {
        hoveredRef.current = false;
        if (!focusedRef.current) startTimer();
      }}
      onFocus={() => {
        focusedRef.current = true;
        pauseTimer();
      }}
      onBlur={onBlur}
      className={`ui-toast-enter pointer-events-auto flex items-start gap-2.5 rounded-lg border border-l-4 border-slate-200 ${accent} bg-white py-2.5 pl-3 pr-2 text-[13px] text-slate-700 shadow-lg dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200`}
    >
      <span className={`mt-0.5 shrink-0 ${icon}`}>
        <ToneIcon tone={tone} />
      </span>
      <div className="min-w-0 flex-1 break-words">
        {options.title ? (
          <div className="font-semibold leading-snug text-slate-900 dark:text-slate-50">{options.title}</div>
        ) : null}
        <div className="leading-snug">{options.message}</div>
        {options.action ? (
          <button
            type="button"
            onClick={() => {
              options.action?.onClick();
              onDismiss(id);
            }}
            className={`mt-1.5 rounded text-[12px] font-semibold text-blue-600 hover:underline dark:text-blue-400 ${FOCUS_RING}`}
          >
            {options.action.label}
          </button>
        ) : null}
      </div>
      <button
        type="button"
        aria-label="Dismiss notification"
        onClick={() => onDismiss(id)}
        className={`inline-flex h-6 w-6 shrink-0 items-center justify-center rounded text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-800 dark:text-slate-400 dark:hover:bg-slate-700 dark:hover:text-slate-100 ${FOCUS_RING}`}
      >
        <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" aria-hidden="true">
          <path d="M4 4l8 8M12 4l-8 8" />
        </svg>
      </button>
    </div>
  );
}
