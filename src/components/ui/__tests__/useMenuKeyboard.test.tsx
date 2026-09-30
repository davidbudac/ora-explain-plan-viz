/** @jsxRuntime automatic */
/** @jsxImportSource react */
import { useEffect } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useMenuKeyboard } from '../useMenuKeyboard';
import { cleanup, press, render } from './testUtils';

afterEach(cleanup);

function Menu({ onClose }: { onClose: () => void }) {
  const { menuProps, focusFirst } = useMenuKeyboard({ onClose });
  useEffect(() => {
    focusFirst();
  }, [focusFirst]);
  return (
    <div {...menuProps}>
      <button role="menuitem">One</button>
      <button role="menuitem" disabled>
        Skipped
      </button>
      <button role="menuitem">Two</button>
      <button role="menuitem">Three</button>
    </div>
  );
}

const active = () => document.activeElement?.textContent;

describe('useMenuKeyboard', () => {
  it('exposes role=menu and focusFirst focuses the first enabled item', () => {
    render(<Menu onClose={() => {}} />);
    expect(document.querySelector('[role="menu"]')).not.toBeNull();
    expect(active()).toBe('One');
  });

  it('ArrowDown / ArrowUp rove focus and wrap, skipping disabled items', () => {
    render(<Menu onClose={() => {}} />);
    const menu = document.querySelector('[role="menu"]')!;

    press(menu, 'ArrowDown');
    expect(active()).toBe('Two');
    press(menu, 'ArrowDown');
    expect(active()).toBe('Three');
    press(menu, 'ArrowDown');
    expect(active()).toBe('One');
    press(menu, 'ArrowUp');
    expect(active()).toBe('Three');
  });

  it('Home / End jump to the ends', () => {
    render(<Menu onClose={() => {}} />);
    const menu = document.querySelector('[role="menu"]')!;
    press(menu, 'End');
    expect(active()).toBe('Three');
    press(menu, 'Home');
    expect(active()).toBe('One');
  });

  it('Escape calls onClose and stops propagation', () => {
    const onClose = vi.fn();
    const windowListener = vi.fn();
    window.addEventListener('keydown', windowListener);
    try {
      render(<Menu onClose={onClose} />);
      press(document.querySelector('[role="menu"]')!, 'Escape');
      expect(onClose).toHaveBeenCalledTimes(1);
      expect(windowListener).not.toHaveBeenCalled();
    } finally {
      window.removeEventListener('keydown', windowListener);
    }
  });
});
