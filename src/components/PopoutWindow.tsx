import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { createPortal } from 'react-dom';

interface PopoutWindowProps {
  title: string;
  width?: number;
  height?: number;
  onClose: () => void;
  children: ReactNode;
}

// Windows parked here by a cleanup that may be a StrictMode remount: the
// re-run effect reclaims the window instead of opening a new one. Opening a
// second window would fail anyway — the click's transient user activation is
// consumed by the first window.open, so the popup blocker rejects the retry.
const parkedWindows = new Map<string, { win: Window; closeTimer: number }>();

/**
 * Mounts `children` into a real, separate browser window (via `window.open` +
 * a React portal) so content can live on a second monitor while staying part
 * of the same React tree — no postMessage/serialization needed.
 */
export function PopoutWindow({ title, width = 1100, height = 800, onClose, children }: PopoutWindowProps) {
  const [win, setWin] = useState<Window | null>(null);
  const closedRef = useRef(false);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    closedRef.current = false;
    const parked = parkedWindows.get(title);
    let opened: Window | null = null;
    if (parked && !parked.win.closed) {
      window.clearTimeout(parked.closeTimer);
      parkedWindows.delete(title);
      opened = parked.win;
    } else {
      opened = window.open('', '', `width=${width},height=${height},popup=yes`);
    }
    if (!opened) {
      // Popup blocked — reset silently rather than leaving a stuck "open" flag.
      onCloseRef.current();
      return;
    }
    opened.document.title = title;
    setWin(opened);

    const requestClose = () => {
      if (closedRef.current) return;
      closedRef.current = true;
      onCloseRef.current();
    };

    // Mirror every <style>/<link rel="stylesheet"> from the parent head so
    // Tailwind's generated CSS (and Vite's HMR style tags in dev) render
    // identically in the child document.
    const cloneStylesheets = () => {
      // Idempotent: a reclaimed (StrictMode-remounted) window already carries
      // clones from the previous mount — replace rather than accumulate.
      opened.document.head
        .querySelectorAll('[data-popout-clone]')
        .forEach((node) => node.remove());
      const nodes = Array.from(
        document.head.querySelectorAll('style, link[rel="stylesheet"]'),
      );
      for (const node of nodes) {
        const clone = node.cloneNode(true) as HTMLElement;
        clone.setAttribute('data-popout-clone', '');
        opened.document.head.appendChild(clone);
      }
    };
    cloneStylesheets();

    const headObserver = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        mutation.addedNodes.forEach((node) => {
          if (!(node instanceof HTMLElement)) return;
          const isStylesheet =
            node.tagName === 'STYLE' ||
            (node.tagName === 'LINK' && node.getAttribute('rel') === 'stylesheet');
          if (isStylesheet) {
            const clone = node.cloneNode(true) as HTMLElement;
            clone.setAttribute('data-popout-clone', '');
            opened.document.head.appendChild(clone);
          }
        });
      }
    });
    headObserver.observe(document.head, { childList: true });

    // Keep the child's dark-mode class in sync with the parent's.
    const syncDarkClass = () => {
      opened.document.documentElement.classList.toggle(
        'dark',
        document.documentElement.classList.contains('dark'),
      );
    };
    syncDarkClass();
    const themeObserver = new MutationObserver(syncDarkClass);
    themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });

    // Close plumbing: the child window tells us when it goes away (user
    // closes it, or OS/browser closes it) via pagehide plus a closed-poll
    // fallback (pagehide can be unreliable for windows with no navigation).
    opened.addEventListener('pagehide', requestClose);
    const pollInterval = window.setInterval(() => {
      if (opened.closed) requestClose();
    }, 300);

    // If the parent tab/window goes away, take the child with it.
    const handleParentUnload = () => opened.close();
    window.addEventListener('beforeunload', handleParentUnload);

    return () => {
      window.clearInterval(pollInterval);
      window.removeEventListener('beforeunload', handleParentUnload);
      opened.removeEventListener('pagehide', requestClose);
      headObserver.disconnect();
      themeObserver.disconnect();
      // Don't close synchronously: park the window for one macrotask so a
      // StrictMode remount (which runs its effect before the timeout fires)
      // can reclaim it. On a real unmount the timeout closes it.
      const closeTimer = window.setTimeout(() => {
        parkedWindows.delete(title);
        if (!opened.closed) opened.close();
      }, 0);
      parkedWindows.set(title, { win: opened, closeTimer });
      setWin(null);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!win) return null;

  return createPortal(
    <div className="h-screen overflow-hidden flex flex-col bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100">
      {children}
    </div>,
    win.document.body,
  );
}
