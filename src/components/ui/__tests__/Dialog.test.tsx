/** @jsxRuntime automatic */
/** @jsxImportSource react */
import { act, StrictMode, useRef, useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ConfirmProvider } from '../ConfirmDialog';
import { Dialog, DialogBody, DialogFooter } from '../Dialog';
import { buttonByText, cleanup, click, press, render } from './testUtils';

afterEach(cleanup);

function Harness({
  open = true,
  onClose = () => {},
  dirty,
  dismissOnBackdrop,
  dismissOnEscape,
  useInitialRef,
}: {
  open?: boolean;
  onClose?: () => void;
  dirty?: boolean;
  dismissOnBackdrop?: boolean;
  dismissOnEscape?: boolean;
  useInitialRef?: boolean;
}) {
  const secondRef = useRef<HTMLButtonElement>(null);
  return (
    <>
      <button type="button">Trigger</button>
      <Dialog
        open={open}
        onClose={onClose}
        title="Edit note"
        description="Change the note text."
        dirty={dirty}
        dismissOnBackdrop={dismissOnBackdrop}
        dismissOnEscape={dismissOnEscape}
        initialFocusRef={useInitialRef ? secondRef : undefined}
      >
        <DialogBody>
          <input aria-label="Note text" />
        </DialogBody>
        <DialogFooter>
          <button type="button">Cancel</button>
          <button type="button" ref={secondRef}>
            Save
          </button>
        </DialogFooter>
      </Dialog>
    </>
  );
}

const dialog = () => document.querySelector<HTMLElement>('[role="dialog"]');

describe('Dialog', () => {
  it('renders nothing when closed and a labelled modal dialog when open', () => {
    const view = render(<Harness open={false} />);
    expect(dialog()).toBeNull();

    view.rerender(<Harness open />);
    const el = dialog()!;
    expect(el).not.toBeNull();
    expect(el.getAttribute('aria-modal')).toBe('true');
    // Portaled to body, not inside the render container.
    expect(view.container.contains(el)).toBe(false);

    const heading = document.getElementById(el.getAttribute('aria-labelledby')!);
    expect(heading?.textContent).toBe('Edit note');
    const description = document.getElementById(el.getAttribute('aria-describedby')!);
    expect(description?.textContent).toBe('Change the note text.');
  });

  it('supports ariaLabel when there is no visible title', () => {
    render(
      <Dialog open onClose={() => {}} ariaLabel="Custom layout">
        <button type="button">Only</button>
      </Dialog>,
    );
    expect(dialog()!.getAttribute('aria-label')).toBe('Custom layout');
    expect(dialog()!.hasAttribute('aria-labelledby')).toBe(false);
  });

  it('moves focus to the first focusable (skipping the header Close) on open', () => {
    const view = render(<Harness open={false} />);
    buttonByText('Trigger').focus();
    view.rerender(<Harness open />);
    expect(document.activeElement).toBe(document.querySelector('input[aria-label="Note text"]'));
  });

  it('honours initialFocusRef', () => {
    render(<Harness useInitialRef />);
    expect(document.activeElement).toBe(buttonByText('Save'));
  });

  it('focuses the panel itself when nothing inside is focusable', () => {
    render(
      <Dialog open onClose={() => {}} ariaLabel="Empty">
        <p>No controls</p>
      </Dialog>,
    );
    expect(document.activeElement).toBe(dialog());
  });

  it('traps Tab and Shift+Tab inside the dialog', () => {
    render(<Harness useInitialRef />);
    const close = document.querySelector<HTMLElement>('[aria-label="Close"]')!;
    const save = buttonByText('Save');

    // Forward from the last focusable wraps to the first (the header Close).
    save.focus();
    const forward = press(save, 'Tab');
    expect(forward.defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(close);

    // Backward from the first focusable wraps to the last.
    const backward = press(close, 'Tab', { shiftKey: true });
    expect(backward.defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(save);

    // In the middle, the browser's default Tab movement is left alone.
    const input = document.querySelector<HTMLElement>('input')!;
    input.focus();
    expect(press(input, 'Tab').defaultPrevented).toBe(false);
  });

  it('pulls focus back in if something outside grabs it', () => {
    render(<Harness useInitialRef />);
    const outside = document.createElement('button');
    document.body.appendChild(outside);
    act(() => outside.focus());
    expect(dialog()!.contains(document.activeElement)).toBe(true);
  });

  it('calls onClose on Escape and stops the event from reaching window listeners', () => {
    const onClose = vi.fn();
    const windowListener = vi.fn();
    window.addEventListener('keydown', windowListener);
    try {
      render(<Harness onClose={onClose} />);
      press(document.querySelector('input')!, 'Escape');
      expect(onClose).toHaveBeenCalledTimes(1);
      expect(windowListener).not.toHaveBeenCalled();
    } finally {
      window.removeEventListener('keydown', windowListener);
    }
  });

  it('still swallows Escape (but does not close) when dismissOnEscape is false', () => {
    const onClose = vi.fn();
    const windowListener = vi.fn();
    window.addEventListener('keydown', windowListener);
    try {
      render(<Harness onClose={onClose} dismissOnEscape={false} />);
      press(document.querySelector('input')!, 'Escape');
      expect(onClose).not.toHaveBeenCalled();
      expect(windowListener).not.toHaveBeenCalled();
    } finally {
      window.removeEventListener('keydown', windowListener);
    }
  });

  it('closes via the header Close button and the backdrop; respects dismissOnBackdrop', () => {
    const onClose = vi.fn();
    const view = render(<Harness onClose={onClose} />);
    click(document.querySelector('[aria-label="Close"]')!);
    expect(onClose).toHaveBeenCalledTimes(1);

    click(document.querySelector('[data-ui-backdrop]')!);
    expect(onClose).toHaveBeenCalledTimes(2);

    view.rerender(<Harness onClose={onClose} dismissOnBackdrop={false} />);
    click(document.querySelector('[data-ui-backdrop]')!);
    expect(onClose).toHaveBeenCalledTimes(2);
  });

  it('restores focus to the previously focused element on close', () => {
    const view = render(<Harness open={false} />);
    const trigger = buttonByText('Trigger');
    trigger.focus();
    view.rerender(<Harness open />);
    expect(document.activeElement).not.toBe(trigger);

    view.rerender(<Harness open={false} />);
    expect(dialog()).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });

  it('locks body scroll while open and releases it on close', () => {
    document.body.style.overflow = 'auto';
    const view = render(<Harness open />);
    expect(document.body.style.overflow).toBe('hidden');
    view.rerender(<Harness open={false} />);
    expect(document.body.style.overflow).toBe('auto');
  });

  it('behaves under StrictMode double-invoked effects (focus, restore, scroll-lock balance)', () => {
    document.body.style.overflow = 'auto';
    const view = render(
      <StrictMode>
        <Harness open={false} />
      </StrictMode>,
    );
    const trigger = buttonByText('Trigger');
    trigger.focus();

    view.rerender(
      <StrictMode>
        <Harness open useInitialRef />
      </StrictMode>,
    );
    expect(document.activeElement).toBe(buttonByText('Save'));
    expect(document.body.style.overflow).toBe('hidden');

    view.rerender(
      <StrictMode>
        <Harness open={false} />
      </StrictMode>,
    );
    expect(document.activeElement).toBe(trigger);
    expect(document.body.style.overflow).toBe('auto');
  });

  describe('dirty', () => {
    function DirtyApp({ onClose }: { onClose: () => void }) {
      const [open, setOpen] = useState(true);
      return (
        <ConfirmProvider>
          <Harness
            open={open}
            dirty
            onClose={() => {
              onClose();
              setOpen(false);
            }}
          />
        </ConfirmProvider>
      );
    }

    const confirmDialog = () => document.querySelector<HTMLElement>('[role="alertdialog"]');

    it('asks "Discard your changes?" on Escape and keeps the dialog if the user keeps editing', async () => {
      const onClose = vi.fn();
      render(<DirtyApp onClose={onClose} />);

      await act(async () => {
        press(document.querySelector('input')!, 'Escape');
      });
      expect(onClose).not.toHaveBeenCalled();
      expect(confirmDialog()?.textContent).toContain('Discard your changes?');

      await act(async () => {
        click(buttonByText('Keep editing'));
      });
      expect(confirmDialog()).toBeNull();
      expect(onClose).not.toHaveBeenCalled();
      expect(dialog()).not.toBeNull();
    });

    it('closes only after the user confirms the discard', async () => {
      const onClose = vi.fn();
      render(<DirtyApp onClose={onClose} />);

      await act(async () => {
        press(document.querySelector('input')!, 'Escape');
      });
      await act(async () => {
        click(buttonByText('Discard'));
      });
      expect(onClose).toHaveBeenCalledTimes(1);
      expect(dialog()).toBeNull();
    });

    it('also guards backdrop clicks and ignores repeated requests while asking', async () => {
      const onClose = vi.fn();
      render(<DirtyApp onClose={onClose} />);

      await act(async () => {
        click(document.querySelector('[data-ui-backdrop]')!);
      });
      expect(confirmDialog()).not.toBeNull();
      expect(onClose).not.toHaveBeenCalled();

      // A second Escape inside the confirm dialog cancels that confirm only.
      await act(async () => {
        press(buttonByText('Keep editing'), 'Escape');
      });
      expect(confirmDialog()).toBeNull();
      expect(onClose).not.toHaveBeenCalled();
      expect(dialog()).not.toBeNull();
    });
  });
});
