/** @jsxRuntime automatic */
/** @jsxImportSource react */
import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BTN_PRIMARY } from '../buttonStyles';
import { CopyButton } from '../CopyButton';
import { ToastProvider } from '../Toast';
import { cleanup, click, render } from './testUtils';

const copyToClipboard = vi.hoisted(() => vi.fn<(text: string) => Promise<boolean>>());
vi.mock('../../../lib/clipboard', () => ({ copyToClipboard }));

beforeEach(() => {
  vi.useFakeTimers();
  copyToClipboard.mockReset();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

const button = () => document.querySelector<HTMLButtonElement>('button')!;
const liveRegion = () => document.querySelector<HTMLElement>('[aria-live="polite"]')!;

async function clickAndSettle() {
  await act(async () => {
    click(button());
    await vi.advanceTimersByTimeAsync(0);
  });
}

describe('CopyButton', () => {
  it('shows "Copied" after a successful copy, announces it, then reverts after 1500ms', async () => {
    copyToClipboard.mockResolvedValue(true);
    render(<CopyButton text="SELECT 1" />);
    expect(button().textContent).toBe('Copy');
    expect(liveRegion().textContent).toBe('');

    await clickAndSettle();
    expect(copyToClipboard).toHaveBeenCalledWith('SELECT 1');
    expect(button().textContent).toBe('Copied');
    expect(liveRegion().textContent).toBe('Copied');

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1400);
    });
    expect(button().textContent).toBe('Copied');
    await act(async () => {
      await vi.advanceTimersByTimeAsync(200);
    });
    expect(button().textContent).toBe('Copy');
    expect(liveRegion().textContent).toBe('');
  });

  it('never shows "Copied" when the copy fails, and raises an error toast instead', async () => {
    copyToClipboard.mockResolvedValue(false);
    render(
      <ToastProvider>
        <CopyButton text="SELECT 1" />
      </ToastProvider>,
    );

    await clickAndSettle();
    expect(button().textContent).toBe('Copy');
    expect(liveRegion().textContent).toBe('');
    expect(document.body.textContent).not.toContain('Copied');

    const alert = document.querySelector('[role="alert"]')!;
    expect(alert.textContent).toContain('Copy failed');
    expect(alert.textContent).toContain('select the text and copy manually');
  });

  it('treats a throwing text() or rejected clipboard call as a failure', async () => {
    render(
      <ToastProvider>
        <CopyButton
          text={() => {
            throw new Error('nope');
          }}
        />
      </ToastProvider>,
    );
    await clickAndSettle();
    expect(document.body.textContent).not.toContain('Copied');
    expect(document.querySelector('[role="alert"]')).not.toBeNull();
    expect(copyToClipboard).not.toHaveBeenCalled();
  });

  it('evaluates a text function at click time', async () => {
    copyToClipboard.mockResolvedValue(true);
    let current = 'first';
    render(<CopyButton text={() => current} />);
    current = 'second';
    await clickAndSettle();
    expect(copyToClipboard).toHaveBeenCalledWith('second');
  });

  it('supports custom labels and an icon-only mode with an accessible name', async () => {
    copyToClipboard.mockResolvedValue(true);
    const view = render(<CopyButton text="x" label="Copy SQL" copiedLabel="SQL copied" />);
    expect(button().textContent).toBe('Copy SQL');
    await clickAndSettle();
    expect(button().textContent).toBe('SQL copied');
    view.unmount();

    render(<CopyButton text="x" iconOnly ariaLabel="Copy predicate" />);
    expect(button().textContent).toBe('');
    expect(button().getAttribute('aria-label')).toBe('Copy predicate');
  });

  it('uses the shared BTN_PRIMARY recipe for variant="primary" and stays primary once copied', async () => {
    copyToClipboard.mockResolvedValue(true);
    render(<CopyButton text="x" variant="primary" size="sm" className="w-full" />);
    expect(button().className).toContain(BTN_PRIMARY);
    expect(button().classList.contains('w-full')).toBe(true);
    // No important-modifier overrides are needed any more.
    expect(button().className).not.toMatch(/(^|\s)[\w:-]+!(\s|$)/);
    expect(button().classList.contains('hover:bg-slate-100')).toBe(false);

    await clickAndSettle();
    expect(button().textContent).toBe('Copied');
    expect(button().className).toContain(BTN_PRIMARY);
  });

  it('keeps the quiet ghost styling by default', () => {
    render(<CopyButton text="x" />);
    expect(button().className).not.toContain(BTN_PRIMARY);
    expect(button().classList.contains('hover:bg-slate-100')).toBe(true);
  });

  it('does not update state after unmount while a copy is in flight', async () => {
    let resolve!: (value: boolean) => void;
    copyToClipboard.mockReturnValue(new Promise<boolean>((r) => (resolve = r)));
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const view = render(<CopyButton text="x" />);
    click(button());
    view.unmount();
    await act(async () => {
      resolve(true);
      await vi.advanceTimersByTimeAsync(2000);
    });
    expect(error).not.toHaveBeenCalled();
  });
});
