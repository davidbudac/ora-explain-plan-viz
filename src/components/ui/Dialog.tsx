import { createContext, useCallback, useContext, useEffect, useId, useLayoutEffect, useRef } from 'react';
import type { KeyboardEvent as ReactKeyboardEvent, ReactNode, RefObject } from 'react';
import { createPortal } from 'react-dom';
import { useConfirm } from './confirmContext';
import { getFocusable } from './focusUtils';
import { FOCUS_RING } from './focusRing';
import { Z_CONFIRM, Z_DIALOG } from './layers';

export type DialogSize = 'sm' | 'md' | 'lg' | 'xl';

const SIZE_CLASS: Record<DialogSize, string> = {
  sm: 'max-w-sm',
  md: 'max-w-lg',
  lg: 'max-w-2xl',
  xl: 'max-w-4xl',
};

/**
 * A dialog is labelled either by a visible `title` (rendered as its heading)
 * or, for fully custom layouts, by an `ariaLabel`.
 */
type DialogLabelProps = { title: string; ariaLabel?: string } | { title?: undefined; ariaLabel: string };

export type DialogProps = DialogLabelProps & {
  open: boolean;
  /** Called when the dialog asks to close (Escape, backdrop, header X). */
  onClose: () => void;
  /** Secondary text under the title; wired to `aria-describedby`. */
  description?: ReactNode;
  /** Max width preset. Default 'md'. */
  size?: DialogSize;
  /** Element to focus on open. Default: first focusable (not the header X). */
  initialFocusRef?: RefObject<HTMLElement | null>;
  /** Clicking the backdrop requests close. Default true. */
  dismissOnBackdrop?: boolean;
  /** Pressing Escape requests close. Default true. */
  dismissOnEscape?: boolean;
  /**
   * When true, Escape / backdrop / header-X first ask "Discard your changes?"
   * through `useConfirm()` and only call `onClose` if the user agrees.
   * (Footer buttons call your own handlers directly and are never guarded.)
   */
  dirty?: boolean;
  /** Render the header X button when `title` is set. Default true. */
  showCloseButton?: boolean;
  /** 'alertdialog' for confirmations that interrupt the workflow. Default 'dialog'. */
  role?: 'dialog' | 'alertdialog';
  /** Stacking layer: 'dialog' (z-100) or 'confirm' (z-110). Default 'dialog'. */
  layer?: 'dialog' | 'confirm';
  /** Extra classes for the panel. */
  className?: string;
  children?: ReactNode;
};

// ---------------------------------------------------------------------------
// Module-level coordination between stacked dialogs
// ---------------------------------------------------------------------------

/** Open dialogs, bottom to top. Only the topmost one traps focus. */
const dialogStack: object[] = [];

let scrollLockCount = 0;
let savedBodyOverflow = '';
let savedBodyPaddingRight = '';

function lockBodyScroll(): void {
  if (scrollLockCount++ > 0) return;
  const body = document.body;
  savedBodyOverflow = body.style.overflow;
  savedBodyPaddingRight = body.style.paddingRight;
  // Compensate for the vanishing scrollbar so the page does not jump sideways.
  const scrollbarWidth = window.innerWidth - document.documentElement.clientWidth;
  body.style.overflow = 'hidden';
  if (scrollbarWidth > 0) body.style.paddingRight = `${scrollbarWidth}px`;
}

function unlockBodyScroll(): void {
  scrollLockCount = Math.max(0, scrollLockCount - 1);
  if (scrollLockCount > 0) return;
  document.body.style.overflow = savedBodyOverflow;
  document.body.style.paddingRight = savedBodyPaddingRight;
}

/** Focus targets that legitimately live outside the panel (toasts, portaled popovers). */
const FOCUS_ALLOWED_OUTSIDE = '[data-ui-toast-region], [data-ui-allow-focus]';

function findInitialFocus(panel: HTMLElement): HTMLElement | null {
  const explicit = panel.querySelector<HTMLElement>('[data-autofocus]');
  if (explicit) return explicit;
  const focusable = getFocusable(panel);
  // Skip the header X: landing on "Close" makes Enter dismiss the dialog.
  return focusable.find((el) => !el.hasAttribute('data-dialog-close')) ?? focusable[0] ?? null;
}

// ---------------------------------------------------------------------------
// Context shared with DialogHeader
// ---------------------------------------------------------------------------

interface DialogContextValue {
  /** Close honoring the `dirty` guard. */
  requestClose: () => void | Promise<void>;
}

const DialogContext = createContext<DialogContextValue | null>(null);

// ---------------------------------------------------------------------------
// Dialog
// ---------------------------------------------------------------------------

function DialogInner(props: DialogProps) {
  const {
    onClose,
    title,
    ariaLabel,
    description,
    size = 'md',
    initialFocusRef,
    dismissOnBackdrop = true,
    dismissOnEscape = true,
    dirty = false,
    showCloseButton = true,
    role = 'dialog',
    layer = 'dialog',
    className = '',
    children,
  } = props;

  const confirm = useConfirm();
  const panelRef = useRef<HTMLDivElement>(null);
  const tokenRef = useRef<object>({});
  const titleId = useId();
  const descriptionId = useId();
  const confirmingRef = useRef(false);
  const mountedRef = useRef(false);

  // Latest props for callbacks that outlive a render (async confirm, focus on mount).
  const latest = useRef({ onClose, dirty, initialFocusRef });
  useLayoutEffect(() => {
    latest.current = { onClose, dirty, initialFocusRef };
  });

  // Focus management + scroll lock + stack membership, tied to mount/unmount.
  useLayoutEffect(() => {
    const panel = panelRef.current;
    if (!panel) return;
    const token = tokenRef.current;
    mountedRef.current = true;
    dialogStack.push(token);
    lockBodyScroll();

    const previouslyFocused = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const target = latest.current.initialFocusRef?.current ?? findInitialFocus(panel) ?? panel;
    target.focus({ preventScroll: true });

    return () => {
      mountedRef.current = false;
      const index = dialogStack.indexOf(token);
      if (index >= 0) dialogStack.splice(index, 1);
      unlockBodyScroll();
      if (previouslyFocused && previouslyFocused.isConnected && previouslyFocused !== document.body) {
        previouslyFocused.focus({ preventScroll: true });
      }
    };
  }, []);

  // Keep focus inside the topmost dialog even when something else grabs it
  // (a click on inert page chrome, a script calling .focus(), …).
  useEffect(() => {
    const token = tokenRef.current;
    const onFocusIn = (event: FocusEvent) => {
      if (dialogStack[dialogStack.length - 1] !== token) return;
      const panel = panelRef.current;
      const target = event.target;
      if (!panel || !(target instanceof Node) || panel.contains(target)) return;
      if (target instanceof Element && target.closest(FOCUS_ALLOWED_OUTSIDE)) return;
      (findInitialFocus(panel) ?? panel).focus({ preventScroll: true });
    };
    document.addEventListener('focusin', onFocusIn);
    return () => document.removeEventListener('focusin', onFocusIn);
  }, []);

  const requestClose = useCallback(async () => {
    if (!latest.current.dirty) {
      latest.current.onClose();
      return;
    }
    if (confirmingRef.current) return;
    confirmingRef.current = true;
    try {
      const discard = await confirm({
        title: 'Discard your changes?',
        message: 'You have unsaved changes that will be lost.',
        confirmLabel: 'Discard',
        cancelLabel: 'Keep editing',
        tone: 'danger',
      });
      if (discard && mountedRef.current) latest.current.onClose();
    } finally {
      confirmingRef.current = false;
    }
  }, [confirm]);

  const handleKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Escape') {
      // Always swallow Escape: a modal owns the keyboard, and window-level
      // shortcut listeners must not react to it while the dialog is open.
      event.stopPropagation();
      if (event.defaultPrevented || !dismissOnEscape) return;
      event.preventDefault();
      void requestClose();
      return;
    }

    if (event.key !== 'Tab') return;
    const panel = panelRef.current;
    if (!panel) return;
    const focusable = getFocusable(panel);
    if (focusable.length === 0) {
      event.preventDefault();
      panel.focus({ preventScroll: true });
      return;
    }
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    const active = document.activeElement;
    if (event.shiftKey) {
      if (active === first || active === panel || !panel.contains(active)) {
        event.preventDefault();
        last.focus();
      }
    } else if (active === last || !panel.contains(active)) {
      event.preventDefault();
      first.focus();
    }
  };

  const labelledBy = title ? titleId : undefined;

  return (
    <div
      className="fixed inset-0 flex items-center justify-center p-4 sm:p-6"
      style={{ zIndex: layer === 'confirm' ? Z_CONFIRM : Z_DIALOG }}
    >
      {/* Backdrop. mousedown is cancelled so a click on it never moves focus
          out of the dialog (which would make Escape miss the panel). */}
      <div
        aria-hidden="true"
        data-ui-backdrop=""
        className="absolute inset-0 bg-slate-900/50 backdrop-blur-sm"
        onMouseDown={(event) => event.preventDefault()}
        onClick={() => {
          if (dismissOnBackdrop) void requestClose();
        }}
      />
      <div
        ref={panelRef}
        role={role}
        aria-modal="true"
        aria-labelledby={labelledBy}
        aria-label={labelledBy ? undefined : ariaLabel}
        aria-describedby={description ? descriptionId : undefined}
        tabIndex={-1}
        onKeyDown={handleKeyDown}
        className={`ui-dialog-enter relative flex max-h-[calc(100dvh-2rem)] w-full flex-col overflow-hidden rounded-xl border border-slate-200 bg-white text-[13px] text-slate-800 shadow-2xl outline-none dark:border-slate-700/70 dark:bg-slate-900 dark:text-slate-100 ${SIZE_CLASS[size]} ${className}`}
      >
        <DialogContext.Provider value={{ requestClose }}>
          {title ? (
            <DialogHeader
              id={titleId}
              title={title}
              description={description}
              descriptionId={descriptionId}
              showCloseButton={showCloseButton}
            />
          ) : description ? (
            <div id={descriptionId} className="sr-only">
              {description}
            </div>
          ) : null}
          {children}
        </DialogContext.Provider>
      </div>
    </div>
  );
}

/**
 * Accessible modal dialog.
 *
 * Portals to `document.body`, traps focus, locks body scroll, restores focus
 * to the previously focused element on close, and handles Escape on the dialog
 * element itself (with `stopPropagation`).
 *
 *   <Dialog open={open} onClose={close} title="Export report" size="lg">
 *     <DialogBody>…</DialogBody>
 *     <DialogFooter>
 *       <button onClick={close}>Cancel</button>
 *     </DialogFooter>
 *   </Dialog>
 *
 * Portaled popovers opened from inside a dialog should carry
 * `data-ui-allow-focus` so the focus guard lets them take focus.
 */
export function Dialog(props: DialogProps) {
  if (!props.open || typeof document === 'undefined') return null;
  return createPortal(<DialogInner {...props} />, document.body);
}

// ---------------------------------------------------------------------------
// Layout helpers
// ---------------------------------------------------------------------------

function CloseIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" aria-hidden="true">
      <path d="M4 4l8 8M12 4l-8 8" />
    </svg>
  );
}

export interface DialogHeaderProps {
  title: ReactNode;
  description?: ReactNode;
  /** id for the heading element (Dialog passes this for aria-labelledby). */
  id?: string;
  /** id for the description element (Dialog passes this for aria-describedby). */
  descriptionId?: string;
  /** Override the close action. Default: the enclosing Dialog's guarded close. */
  onClose?: () => void;
  /** Show the X button. Default true. */
  showCloseButton?: boolean;
  /** Draw a bottom border (useful above a scrolling body). Default false. */
  bordered?: boolean;
  className?: string;
  /** Extra controls rendered before the X button. */
  children?: ReactNode;
}

/** Title row with a "Close" icon button (aria-label="Close"). */
export function DialogHeader({
  title,
  description,
  id,
  descriptionId,
  onClose,
  showCloseButton = true,
  bordered = false,
  className = '',
  children,
}: DialogHeaderProps) {
  const context = useContext(DialogContext);
  const close = onClose ?? context?.requestClose;
  return (
    <div
      className={`flex shrink-0 items-start gap-3 px-5 pb-3 pt-4 ${
        bordered ? 'border-b border-slate-200/70 dark:border-slate-700/60' : ''
      } ${className}`}
    >
      <div className="min-w-0 flex-1">
        <h2 id={id} className="text-[15px] font-semibold leading-snug text-slate-900 dark:text-slate-50">
          {title}
        </h2>
        {description ? (
          <div id={descriptionId} className="mt-1 text-[13px] leading-relaxed text-slate-600 dark:text-slate-400">
            {description}
          </div>
        ) : null}
      </div>
      {children}
      {showCloseButton && close ? (
        <button
          type="button"
          aria-label="Close"
          data-dialog-close=""
          onClick={() => void close()}
          className={`-mr-1.5 -mt-0.5 inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-800 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-100 ${FOCUS_RING}`}
        >
          <CloseIcon />
        </button>
      ) : null}
    </div>
  );
}

/** Scrollable content region; the header and footer stay pinned. */
export function DialogBody({ className = '', children }: { className?: string; children?: ReactNode }) {
  return <div className={`min-h-0 flex-1 overflow-y-auto px-5 py-3 ${className}`}>{children}</div>;
}

export interface DialogFooterProps {
  /** Button alignment. Default 'end'. */
  align?: 'start' | 'end' | 'between';
  /** Draw a top border. Default true. */
  bordered?: boolean;
  className?: string;
  children?: ReactNode;
}

const FOOTER_ALIGN: Record<NonNullable<DialogFooterProps['align']>, string> = {
  start: 'justify-start',
  end: 'justify-end',
  between: 'justify-between',
};

/** Pinned action row. */
export function DialogFooter({ align = 'end', bordered = true, className = '', children }: DialogFooterProps) {
  return (
    <div
      className={`flex shrink-0 flex-wrap items-center gap-2 px-5 py-3 ${FOOTER_ALIGN[align]} ${
        bordered ? 'border-t border-slate-200/70 dark:border-slate-700/60' : ''
      } ${className}`}
    >
      {children}
    </div>
  );
}
