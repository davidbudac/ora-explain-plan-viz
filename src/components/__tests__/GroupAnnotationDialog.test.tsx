/** @jsxRuntime automatic */
/** @jsxImportSource react */
import { act } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { GroupAnnotationDialog } from '../GroupAnnotationDialog';
import { ConfirmProvider } from '../ui';
import { buttonByText, cleanup, click, press, render } from '../ui/__tests__/testUtils';
import type { AnnotationGroup } from '../../lib/annotations';

afterEach(cleanup);

const group: AnnotationGroup = { id: 'g1', name: 'Join path', nodeIds: [2, 3], color: 'red', note: 'slow' };

function setup(overrides: Partial<React.ComponentProps<typeof GroupAnnotationDialog>> = {}) {
  const props = {
    nodeIds: [2, 3],
    existingGroup: group,
    onSave: vi.fn(),
    onDelete: vi.fn(),
    onClose: vi.fn(),
    ...overrides,
  };
  render(
    <ConfirmProvider>
      <GroupAnnotationDialog {...props} />
    </ConfirmProvider>,
  );
  return props;
}

const dialogs = () => Array.from(document.querySelectorAll<HTMLElement>('[role="dialog"], [role="alertdialog"]'));
const nameInput = () => document.querySelector<HTMLInputElement>('input[type="text"]')!;

async function typeInto(input: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
  await act(async () => {
    setter.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

describe('GroupAnnotationDialog', () => {
  it('is a labelled modal dialog titled for the mode', () => {
    setup();
    const [dialog] = dialogs();
    expect(dialog.getAttribute('aria-modal')).toBe('true');
    expect(dialog.textContent).toContain('Edit Group');
  });

  it('asks before deleting and only deletes after the user confirms', async () => {
    const props = setup();

    // The group dialog and the confirm dialog both have buttons of the same name,
    // so scope lookups to the right dialog.
    const groupDialog = () => document.querySelector<HTMLElement>('[role="dialog"]')!;
    const confirmDialog = () => document.querySelector<HTMLElement>('[role="alertdialog"]');

    await act(async () => {
      click(buttonByText('Delete', groupDialog()));
    });
    expect(confirmDialog()).not.toBeNull();
    expect(confirmDialog()!.textContent).toContain('Delete this group?');
    expect(props.onDelete).not.toHaveBeenCalled();

    // Declining leaves the group alone and keeps the edit dialog open
    await act(async () => {
      click(buttonByText('Cancel', confirmDialog()!));
    });
    expect(confirmDialog()).toBeNull();
    expect(groupDialog()).not.toBeNull();
    expect(props.onDelete).not.toHaveBeenCalled();
    expect(props.onClose).not.toHaveBeenCalled();

    await act(async () => {
      click(buttonByText('Delete', groupDialog()));
    });
    await act(async () => {
      click(buttonByText('Delete group', confirmDialog()!));
    });
    expect(props.onDelete).toHaveBeenCalledTimes(1);
  });

  it('closes on Escape when nothing was edited', () => {
    const props = setup();
    press(document.querySelector('[role="dialog"]')!, 'Escape');
    expect(props.onClose).toHaveBeenCalledTimes(1);
  });

  it('asks before discarding edits on Escape', async () => {
    const props = setup();
    await typeInto(nameInput(), 'Renamed group');

    await act(async () => {
      press(document.querySelector('[role="dialog"]')!, 'Escape');
    });
    expect(props.onClose).not.toHaveBeenCalled();
    expect(document.querySelector('[role="alertdialog"]')?.textContent).toContain('Discard your changes?');

    await act(async () => {
      click(buttonByText('Discard'));
    });
    expect(props.onClose).toHaveBeenCalledTimes(1);
  });

  it('marks the active colour swatch as pressed', () => {
    setup();
    const red = document.querySelector<HTMLButtonElement>('button[aria-label="Red"]');
    const blue = document.querySelector<HTMLButtonElement>('button[aria-label="Blue"]');
    expect(red?.getAttribute('aria-pressed')).toBe('true');
    expect(blue?.getAttribute('aria-pressed')).toBe('false');
  });
});
