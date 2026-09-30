/** @jsxRuntime automatic */
/** @jsxImportSource react */
import { act } from 'react';
import type { ReactElement } from 'react';
import { createRoot } from 'react-dom/client';
import type { Root } from 'react-dom/client';

// Tell React this environment supports act() so updates flush synchronously.
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const mounted: Array<{ root: Root; container: HTMLElement }> = [];

export interface Rendered {
  container: HTMLElement;
  rerender: (ui: ReactElement) => void;
  unmount: () => void;
}

/** Minimal render helper (no @testing-library dependency). */
export function render(ui: ReactElement): Rendered {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  mounted.push({ root, container });
  act(() => {
    root.render(ui);
  });
  return {
    container,
    rerender: (next) => {
      act(() => {
        root.render(next);
      });
    },
    unmount: () => {
      act(() => {
        root.unmount();
      });
      container.remove();
    },
  };
}

/** Unmount everything rendered so far; call from afterEach. */
export function cleanup(): void {
  while (mounted.length > 0) {
    const { root, container } = mounted.pop()!;
    act(() => {
      root.unmount();
    });
    container.remove();
  }
  document.body.innerHTML = '';
  document.body.removeAttribute('style');
}

export function press(target: Element, key: string, init: KeyboardEventInit = {}): KeyboardEvent {
  const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...init });
  act(() => {
    target.dispatchEvent(event);
  });
  return event;
}

export function click(target: Element): void {
  act(() => {
    (target as HTMLElement).click();
  });
}

/** Query by accessible text of a button. */
export function buttonByText(text: string, scope: ParentNode = document.body): HTMLButtonElement {
  const match = Array.from(scope.querySelectorAll('button')).find((b) => b.textContent?.trim() === text);
  if (!match) throw new Error(`No button with text "${text}"`);
  return match as HTMLButtonElement;
}
