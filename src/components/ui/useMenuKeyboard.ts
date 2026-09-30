import { useCallback, useRef } from 'react';
import type { KeyboardEvent, RefObject } from 'react';

const ITEM_SELECTOR = '[role="menuitem"], [role="menuitemcheckbox"], [role="menuitemradio"]';

function getItems(container: HTMLElement | null): HTMLElement[] {
  if (!container) return [];
  return Array.from(container.querySelectorAll<HTMLElement>(ITEM_SELECTOR)).filter(
    (el) => !(el as HTMLButtonElement).disabled && el.getAttribute('aria-disabled') !== 'true',
  );
}

export interface UseMenuKeyboardOptions {
  /** Called when the user presses Escape inside the menu. */
  onClose: () => void;
}

export interface MenuProps<T extends HTMLElement> {
  ref: RefObject<T | null>;
  role: 'menu';
  onKeyDown: (event: KeyboardEvent<T>) => void;
}

/**
 * Keyboard support for a `role="menu"` container.
 *
 * - ArrowDown / ArrowUp: move focus across `[role="menuitem"]` descendants,
 *   wrapping at both ends (ArrowDown with nothing focused goes to the first
 *   item, ArrowUp to the last).
 * - Home / End: first / last item.
 * - Escape: calls `onClose` (and stops propagation so app-level shortcut
 *   listeners do not also fire).
 *
 * Disabled items (`disabled` or `aria-disabled="true"`) are skipped.
 *
 * Usage:
 *   const { menuProps, focusFirst } = useMenuKeyboard({ onClose: () => setOpen(false) });
 *   useEffect(() => { if (open) focusFirst(); }, [open, focusFirst]);
 *   return <div {...menuProps}>…<button role="menuitem">…</button></div>;
 */
export function useMenuKeyboard<T extends HTMLElement = HTMLDivElement>({ onClose }: UseMenuKeyboardOptions): {
  menuProps: MenuProps<T>;
  focusFirst: () => void;
} {
  const ref = useRef<T | null>(null);

  const focusFirst = useCallback(() => {
    getItems(ref.current)[0]?.focus();
  }, []);

  const onKeyDown = useCallback(
    (event: KeyboardEvent<T>) => {
      if (event.ctrlKey || event.metaKey || event.altKey) return;

      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        onClose();
        return;
      }

      if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp' && event.key !== 'Home' && event.key !== 'End') {
        return;
      }

      const items = getItems(ref.current);
      if (items.length === 0) return;

      event.preventDefault();
      event.stopPropagation();

      const active = document.activeElement;
      const current = items.findIndex((el) => el === active || el.contains(active));
      let next: number;
      switch (event.key) {
        case 'Home':
          next = 0;
          break;
        case 'End':
          next = items.length - 1;
          break;
        case 'ArrowDown':
          next = current < 0 ? 0 : (current + 1) % items.length;
          break;
        default: // ArrowUp
          next = current < 0 ? items.length - 1 : (current - 1 + items.length) % items.length;
      }
      items[next].focus();
    },
    [onClose],
  );

  return { menuProps: { ref, role: 'menu', onKeyDown }, focusFirst };
}
