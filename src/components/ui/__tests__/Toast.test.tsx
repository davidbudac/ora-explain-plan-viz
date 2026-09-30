/** @jsxRuntime automatic */
/** @jsxImportSource react */
import { act, useEffect } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ToastProvider, toast, useToast } from '../Toast';
import type { ToastApi } from '../Toast';
import { cleanup, click, render } from './testUtils';

let api: ToastApi;
function Capture({ onApi }: { onApi: (value: ToastApi) => void }) {
  const value = useToast();
  useEffect(() => {
    onApi(value);
  }, [onApi, value]);
  return null;
}

const setApi = (value: ToastApi) => {
  api = value;
};

function mountProvider() {
  return render(
    <ToastProvider>
      <Capture onApi={setApi} />
    </ToastProvider>,
  );
}

const toasts = () => Array.from(document.querySelectorAll<HTMLElement>('[data-tone]'));
const advance = (ms: number) =>
  act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('Toast', () => {
  it('renders a toast with title, message and the right role per tone', () => {
    mountProvider();
    act(() => {
      api.show({ tone: 'info', title: 'Heads up', message: 'Plan loaded' });
      api.show({ tone: 'success', message: 'Saved' });
      api.show({ tone: 'error', message: 'Boom' });
      api.show({ tone: 'warning', message: 'Careful' });
    });

    const [info, success, error, warning] = toasts();
    expect(info.textContent).toContain('Heads up');
    expect(info.textContent).toContain('Plan loaded');

    for (const el of [info, success]) {
      expect(el.getAttribute('role')).toBe('status');
      expect(el.getAttribute('aria-live')).toBe('polite');
    }
    for (const el of [error, warning]) {
      expect(el.getAttribute('role')).toBe('alert');
    }
  });

  it('defaults to the info tone', () => {
    mountProvider();
    act(() => {
      api.show({ message: 'Plain' });
    });
    expect(toasts()[0].dataset.tone).toBe('info');
  });

  it('dismisses via the close button and via dismiss(id)', () => {
    mountProvider();
    let id = '';
    act(() => {
      id = api.show({ message: 'One' });
      api.show({ message: 'Two' });
    });
    expect(toasts()).toHaveLength(2);

    click(toasts()[1].querySelector('[aria-label="Dismiss notification"]')!);
    expect(toasts().map((t) => t.textContent)).toEqual([expect.stringContaining('One')]);

    act(() => api.dismiss(id));
    expect(toasts()).toHaveLength(0);
  });

  it('auto-dismisses after 5s, and after 8s for errors', async () => {
    mountProvider();
    act(() => {
      api.show({ tone: 'info', message: 'Quick' });
      api.show({ tone: 'error', message: 'Slow' });
    });

    await advance(4900);
    expect(toasts()).toHaveLength(2);
    await advance(200);
    expect(toasts().map((t) => t.dataset.tone)).toEqual(['error']);
    await advance(3000);
    expect(toasts()).toHaveLength(0);
  });

  it('keeps a toast with duration 0 until dismissed', async () => {
    mountProvider();
    act(() => {
      api.show({ message: 'Sticky', duration: 0 });
    });
    await advance(60_000);
    expect(toasts()).toHaveLength(1);
  });

  it('pauses the timer while hovered and resumes afterwards', async () => {
    mountProvider();
    act(() => {
      api.show({ message: 'Hover me' });
    });
    const el = toasts()[0];

    await advance(3000);
    act(() => {
      el.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
      el.dispatchEvent(new MouseEvent('mouseenter', { bubbles: false }));
    });
    await advance(30_000);
    expect(toasts()).toHaveLength(1);

    act(() => {
      el.dispatchEvent(new MouseEvent('mouseout', { bubbles: true }));
      el.dispatchEvent(new MouseEvent('mouseleave', { bubbles: false }));
    });
    await advance(1900);
    expect(toasts()).toHaveLength(1);
    await advance(200);
    expect(toasts()).toHaveLength(0);
  });

  it('pauses the timer while a control inside has focus', async () => {
    mountProvider();
    act(() => {
      api.show({ message: 'Focus me' });
    });
    const close = toasts()[0].querySelector<HTMLElement>('[aria-label="Dismiss notification"]')!;
    await advance(3000);
    act(() => close.focus());
    await advance(30_000);
    expect(toasts()).toHaveLength(1);

    // 2s were left when focus arrived; the timer resumes with exactly that.
    act(() => close.blur());
    await advance(1900);
    expect(toasts()).toHaveLength(1);
    await advance(200);
    expect(toasts()).toHaveLength(0);
  });

  it('keeps at most 4 toasts, dropping the oldest', () => {
    mountProvider();
    act(() => {
      for (let i = 1; i <= 6; i++) api.show({ message: `Toast ${i}`, duration: 0 });
    });
    const text = toasts().map((t) => t.textContent);
    expect(text).toHaveLength(4);
    expect(text[0]).toContain('Toast 3');
    expect(text[3]).toContain('Toast 6');
  });

  it('runs the action and dismisses the toast', () => {
    mountProvider();
    const onClick = vi.fn();
    act(() => {
      api.show({ message: 'Deleted', action: { label: 'Undo', onClick }, duration: 0 });
    });
    const undo = Array.from(document.querySelectorAll('button')).find((b) => b.textContent === 'Undo')!;
    click(undo);
    expect(onClick).toHaveBeenCalledTimes(1);
    expect(toasts()).toHaveLength(0);
  });

  it('exposes a hook-free accessor bound to the mounted provider', () => {
    const view = mountProvider();
    let id = '';
    act(() => {
      id = toast.show({ tone: 'success', message: 'From lib code' });
    });
    expect(toasts()[0].textContent).toContain('From lib code');
    act(() => toast.dismiss(id));
    expect(toasts()).toHaveLength(0);

    // After unmount the accessor degrades quietly instead of throwing.
    view.unmount();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(() => toast.show({ tone: 'error', message: 'Nobody home' })).not.toThrow();
    expect(warn).toHaveBeenCalled();
  });

  it('renders toasts above dialogs in a body-level region', () => {
    mountProvider();
    act(() => {
      api.show({ message: 'Layered' });
    });
    const region = document.querySelector<HTMLElement>('[data-ui-toast-region]')!;
    expect(region.parentElement).toBe(document.body);
    expect(region.style.zIndex).toBe('120');
  });
});
