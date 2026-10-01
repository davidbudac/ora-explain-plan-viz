/** @jsxRuntime automatic */
/** @jsxImportSource react */
import { act } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Mock } from 'vitest';
import { NodeActionToolbarView } from '../nodes/NodeActionToolbar';
import type { NodeActionToolbarViewProps } from '../nodes/NodeActionToolbar';
import { cleanup, click, press, render } from '../ui/__tests__/testUtils';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

/** jsdom has no real focus-visible heuristic; decide it per test. */
function stubFocusVisible(visible: boolean) {
  const original = Element.prototype.matches;
  vi.spyOn(Element.prototype, 'matches').mockImplementation(function (this: Element, selector: string) {
    if (selector === ':focus-visible') return visible;
    return original.call(this, selector);
  });
}

type Handlers = {
  onBrushChange: Mock;
  onPaint: Mock;
  onSetHighlight: Mock;
  onClearHighlight: Mock;
  onSaveNote: Mock;
  onDeleteNote: Mock;
  onZoom: Mock;
  onCopy: Mock;
  onHoverChange: Mock;
  onFocusWithinChange: Mock;
  onPopoverOpenChange: Mock;
  onRequestClose: Mock;
};

function setup(overrides: Partial<NodeActionToolbarViewProps> = {}) {
  const handlers: Handlers = {
    onBrushChange: vi.fn(),
    onPaint: vi.fn(),
    onSetHighlight: vi.fn(),
    onClearHighlight: vi.fn(),
    onSaveNote: vi.fn(),
    onDeleteNote: vi.fn(),
    onZoom: vi.fn(),
    onCopy: vi.fn(),
    onHoverChange: vi.fn(),
    onFocusWithinChange: vi.fn(),
    onPopoverOpenChange: vi.fn(),
    onRequestClose: vi.fn(),
  };
  const parentClick = vi.fn();
  const parentKeyDown = vi.fn();
  const windowKeyDown = vi.fn();
  window.addEventListener('keydown', windowKeyDown);

  const view = render(
    <div onClick={parentClick} onKeyDown={parentKeyDown}>
      <NodeActionToolbarView
        nodeId={7}
        operation="TABLE ACCESS FULL"
        hasChildren={false}
        brush={{ color: 'red', style: 'circle' }}
        fallbackStyle="circle"
        note=""
        annotationTools
        surfaceId="test-surface"
        {...handlers}
        {...overrides}
      />
    </div>,
  );
  return {
    ...handlers,
    ...view,
    parentClick,
    parentKeyDown,
    windowKeyDown,
    dispose: () => window.removeEventListener('keydown', windowKeyDown),
  };
}

const toolbar = () => document.querySelector<HTMLElement>('[role="toolbar"]')!;
const byLabel = (label: string, scope: ParentNode = document) =>
  scope.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`);
const dialog = () => document.querySelector<HTMLElement>('[role="dialog"]');
const buttonWithText = (text: string, scope: ParentNode = document) =>
  Array.from(scope.querySelectorAll('button')).find((b) => b.textContent?.trim() === text) as HTMLButtonElement | undefined;

function typeInto(textarea: HTMLTextAreaElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!;
  act(() => {
    setter.call(textarea, value);
    textarea.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

function pointerDown(target: Element) {
  act(() => {
    target.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true }));
  });
}

describe('NodeActionToolbarView layout', () => {
  it('is a labelled toolbar with the five actions', () => {
    const t = setup();
    expect(toolbar().getAttribute('aria-label')).toBe('Actions for operation 7');
    expect(byLabel('Paint with Red circle highlight')).not.toBeNull();
    expect(byLabel('Choose highlight brush')).not.toBeNull();
    expect(byLabel('Add note')).not.toBeNull();
    expect(byLabel('Zoom to operation')).not.toBeNull();
    expect(byLabel('Copy operation details')).not.toBeNull();
    for (const button of toolbar().querySelectorAll('button')) {
      expect(button.getAttribute('type')).toBe('button');
      expect(button.getAttribute('title')).toBeTruthy();
    }
    t.dispose();
  });

  it('says "subtree" when the operation has children', () => {
    const t = setup({ hasChildren: true });
    expect(byLabel('Zoom to subtree')).not.toBeNull();
    expect(byLabel('Zoom to operation')).toBeNull();
    t.dispose();
  });

  it('omits paint, brush and note when annotations are hidden, keeping zoom and copy', () => {
    const t = setup({ annotationTools: false });
    expect(byLabel('Choose highlight brush')).toBeNull();
    expect(byLabel('Add note')).toBeNull();
    expect(toolbar().querySelector('[aria-pressed]')).toBeNull();
    const zoom = byLabel('Zoom to operation')!;
    expect(zoom).not.toBeNull();
    expect(byLabel('Copy operation details')).not.toBeNull();
    // The roving tab stop falls back to the first remaining button
    expect(zoom.getAttribute('tabindex')).toBe('0');
    t.dispose();
  });

  it('flags a note with a badge and an "Edit note" label', () => {
    const t = setup({ note: 'check the histogram' });
    expect(byLabel('Edit note')).not.toBeNull();
    expect(byLabel('Add note')).toBeNull();
    expect(toolbar().querySelector('[data-note-badge]')).not.toBeNull();
    t.dispose();
  });

  it('reports hover over the pill', () => {
    const t = setup();
    act(() => {
      toolbar().dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
    });
    expect(t.onHoverChange).toHaveBeenCalledWith(true);
    act(() => {
      toolbar().dispatchEvent(new MouseEvent('mouseout', { bubbles: true, relatedTarget: document.body }));
    });
    expect(t.onHoverChange).toHaveBeenCalledWith(false);
    t.dispose();
  });
});

describe('paint button', () => {
  it('offers to paint, and toggles via onPaint', () => {
    const t = setup();
    const paint = byLabel('Paint with Red circle highlight')!;
    expect(paint.getAttribute('aria-pressed')).toBe('false');
    click(paint);
    expect(t.onPaint).toHaveBeenCalledTimes(1);
    t.dispose();
  });

  it('is pressed and offers removal when the node already carries the brush', () => {
    const t = setup({
      brush: { color: 'blue', style: 'glow' },
      highlight: { nodeId: 7, color: 'blue', style: 'glow' },
    });
    const paint = byLabel('Remove Blue glow highlight')!;
    expect(paint.getAttribute('aria-pressed')).toBe('true');
    click(paint);
    expect(t.onPaint).toHaveBeenCalledTimes(1);
    t.dispose();
  });

  it('is not pressed when the colour or style differs', () => {
    const t = setup({
      brush: { color: 'blue', style: 'glow' },
      highlight: { nodeId: 7, color: 'blue', style: 'tint' },
    });
    expect(byLabel('Paint with Blue glow highlight')!.getAttribute('aria-pressed')).toBe('false');
    t.dispose();
  });

  it('counts a legacy highlight as drawn in the fallback style', () => {
    const t = setup({
      brush: { color: 'red', style: 'underline' },
      highlight: { nodeId: 7, color: 'red' },
      fallbackStyle: 'underline',
    });
    expect(byLabel('Remove Red underline highlight')!.getAttribute('aria-pressed')).toBe('true');
    t.dispose();
  });

  it('shows the brush colour in a bar under the icon', () => {
    const t = setup({ brush: { color: 'green', style: 'circle' } });
    const bar = byLabel('Paint with Green circle highlight')!.querySelector<HTMLElement>('span > span');
    // #22c55e (light theme)
    expect(bar?.style.backgroundColor).toBe('rgb(34, 197, 94)');
    t.dispose();
  });
});

describe('zoom and copy', () => {
  it('call their handlers', () => {
    const t = setup();
    click(byLabel('Zoom to operation')!);
    click(byLabel('Copy operation details')!);
    expect(t.onZoom).toHaveBeenCalledTimes(1);
    expect(t.onCopy).toHaveBeenCalledTimes(1);
    t.dispose();
  });
});

describe('brush picker popover', () => {
  it('opens from the caret as a labelled, non-modal dialog and focuses the active colour', () => {
    const t = setup();
    const caret = byLabel('Choose highlight brush')!;
    expect(caret.getAttribute('aria-haspopup')).toBe('dialog');
    expect(caret.getAttribute('aria-expanded')).toBe('false');

    click(caret);
    const dlg = dialog()!;
    expect(dlg.getAttribute('aria-label')).toBe('Highlight brush');
    expect(dlg.getAttribute('aria-modal')).toBe('false');
    expect(dlg.parentElement).toBe(document.body);
    expect(caret.getAttribute('aria-expanded')).toBe('true');
    expect(document.activeElement).toBe(byLabel('Red brush', dlg));
    expect(t.onPopoverOpenChange).toHaveBeenLastCalledWith(true);
    t.dispose();
  });

  it('marks the brush colour and style as pressed', () => {
    const t = setup({ brush: { color: 'purple', style: 'hachure' } });
    click(byLabel('Choose highlight brush')!);
    const dlg = dialog()!;
    expect(byLabel('Purple brush', dlg)!.getAttribute('aria-pressed')).toBe('true');
    expect(byLabel('Red brush', dlg)!.getAttribute('aria-pressed')).toBe('false');
    expect(buttonWithText('Hachure', dlg)!.getAttribute('aria-pressed')).toBe('true');
    expect(buttonWithText('Circle', dlg)!.getAttribute('aria-pressed')).toBe('false');
    expect(dlg.querySelectorAll('[aria-label="Brush colour"] button')).toHaveLength(9);
    expect(dlg.querySelectorAll('[aria-label="Brush style"] button')).toHaveLength(6);
    t.dispose();
  });

  it('picking a colour or style only changes the brush: no paint, popover stays open', () => {
    const t = setup();
    click(byLabel('Choose highlight brush')!);
    const dlg = dialog()!;
    click(byLabel('Blue brush', dlg)!);
    expect(t.onBrushChange).toHaveBeenLastCalledWith({ color: 'blue' });
    click(buttonWithText('Glow', dlg)!);
    expect(t.onBrushChange).toHaveBeenLastCalledWith({ style: 'glow' });
    expect(t.onPaint).not.toHaveBeenCalled();
    expect(t.onSetHighlight).not.toHaveBeenCalled();
    expect(dialog()).not.toBeNull();
    t.dispose();
  });

  it('the footer paints this node (without toggling) and closes', () => {
    const t = setup();
    click(byLabel('Choose highlight brush')!);
    click(buttonWithText('Paint #7', dialog()!)!);
    expect(t.onSetHighlight).toHaveBeenCalledTimes(1);
    expect(t.onPaint).not.toHaveBeenCalled();
    expect(dialog()).toBeNull();
    expect(t.onPopoverOpenChange).toHaveBeenLastCalledWith(false);
    t.dispose();
  });

  it('offers "Clear highlight" only when the node has one', () => {
    const none = setup();
    click(byLabel('Choose highlight brush')!);
    expect(buttonWithText('Clear highlight', dialog()!)).toBeUndefined();
    none.dispose();
    cleanup();

    const t = setup({ highlight: { nodeId: 7, color: 'red', style: 'circle' } });
    click(byLabel('Choose highlight brush')!);
    click(buttonWithText('Clear highlight', dialog()!)!);
    expect(t.onClearHighlight).toHaveBeenCalledTimes(1);
    expect(dialog()).toBeNull();
    t.dispose();
  });

  it('Escape closes only the popover and returns focus to the caret', () => {
    const t = setup();
    const caret = byLabel('Choose highlight brush')!;
    click(caret);
    press(byLabel('Red brush', dialog()!)!, 'Escape');
    expect(dialog()).toBeNull();
    expect(document.activeElement).toBe(caret);
    expect(t.windowKeyDown).not.toHaveBeenCalled();
    expect(t.onRequestClose).not.toHaveBeenCalled();
    t.dispose();
  });

  it('closes on a press outside, but not on a press inside the toolbar', () => {
    const t = setup();
    click(byLabel('Choose highlight brush')!);
    pointerDown(toolbar());
    expect(dialog()).not.toBeNull();
    pointerDown(byLabel('Red brush', dialog()!)!);
    expect(dialog()).not.toBeNull();

    pointerDown(document.body);
    expect(dialog()).toBeNull();
    // An outside press does not steal focus back
    expect(document.activeElement).not.toBe(byLabel('Choose highlight brush'));
    t.dispose();
  });

  it('closes when the canvas moves (wheel outside) or the window resizes', () => {
    const t = setup();
    click(byLabel('Choose highlight brush')!);
    act(() => {
      document.body.dispatchEvent(new WheelEvent('wheel', { bubbles: true }));
    });
    expect(dialog()).toBeNull();

    click(byLabel('Choose highlight brush')!);
    act(() => {
      window.dispatchEvent(new Event('resize'));
    });
    expect(dialog()).toBeNull();
    t.dispose();
  });

  it('toggles closed from the caret', () => {
    const t = setup();
    const caret = byLabel('Choose highlight brush')!;
    click(caret);
    click(caret);
    expect(dialog()).toBeNull();
    t.dispose();
  });

  it('only one popover is open at a time', () => {
    const t = setup();
    click(byLabel('Choose highlight brush')!);
    click(byLabel('Add note')!);
    expect(document.querySelectorAll('[role="dialog"]')).toHaveLength(1);
    expect(dialog()!.getAttribute('aria-label')).toBe('Note for operation 7');
    t.dispose();
  });
});

describe('note popover', () => {
  function openNote(note = '') {
    const t = setup({ note });
    click(byLabel(note ? 'Edit note' : 'Add note')!);
    const dlg = dialog()!;
    const textarea = dlg.querySelector('textarea')!;
    return { t, dlg, textarea };
  }

  it('prefills the note, focuses it with the caret at the end, and titles the dialog', () => {
    const { t, dlg, textarea } = openNote('check the histogram');
    expect(textarea.value).toBe('check the histogram');
    expect(document.activeElement).toBe(textarea);
    expect(textarea.selectionStart).toBe('check the histogram'.length);
    expect(textarea.getAttribute('rows')).toBe('3');
    expect(dlg.textContent).toContain('Note · #7 TABLE ACCESS FULL');
    expect(dlg.textContent).toMatch(/(⌘|Ctrl)\+Enter to save/);
    t.dispose();
  });

  it('Cmd+Enter saves and closes', () => {
    const { t, textarea } = openNote();
    typeInto(textarea, 'fix the join order');
    press(textarea, 'Enter', { metaKey: true });
    expect(t.onSaveNote).toHaveBeenCalledTimes(1);
    expect(t.onSaveNote).toHaveBeenCalledWith('fix the join order');
    expect(dialog()).toBeNull();
    t.dispose();
  });

  it('Ctrl+Enter saves as well', () => {
    const { t, textarea } = openNote();
    typeInto(textarea, 'via ctrl');
    press(textarea, 'Enter', { ctrlKey: true });
    expect(t.onSaveNote).toHaveBeenCalledWith('via ctrl');
    t.dispose();
  });

  it('plain Enter inserts a newline instead of saving', () => {
    const { t, textarea } = openNote();
    typeInto(textarea, 'a');
    press(textarea, 'Enter');
    expect(t.onSaveNote).not.toHaveBeenCalled();
    expect(dialog()).not.toBeNull();
    t.dispose();
  });

  it('Escape cancels without saving and returns focus to the note button', () => {
    const { t, textarea } = openNote();
    typeInto(textarea, 'draft I changed my mind about');
    press(textarea, 'Escape');
    expect(t.onSaveNote).not.toHaveBeenCalled();
    expect(t.onDeleteNote).not.toHaveBeenCalled();
    expect(dialog()).toBeNull();
    expect(document.activeElement).toBe(byLabel('Add note'));
    t.dispose();
  });

  it('Cancel discards the edits', () => {
    const { t, dlg, textarea } = openNote('keep me');
    typeInto(textarea, 'edited');
    click(buttonWithText('Cancel', dlg)!);
    expect(t.onSaveNote).not.toHaveBeenCalled();
    expect(dialog()).toBeNull();
    t.dispose();
  });

  it('saving blank text removes the existing note', () => {
    const { t, textarea } = openNote('old note');
    typeInto(textarea, '   ');
    press(textarea, 'Enter', { metaKey: true });
    expect(t.onDeleteNote).toHaveBeenCalledTimes(1);
    expect(t.onSaveNote).not.toHaveBeenCalled();
    t.dispose();
  });

  it('saving blank text on a node without a note does nothing', () => {
    const { t, textarea } = openNote();
    typeInto(textarea, '  ');
    press(textarea, 'Enter', { metaKey: true });
    expect(t.onDeleteNote).not.toHaveBeenCalled();
    expect(t.onSaveNote).not.toHaveBeenCalled();
    t.dispose();
  });

  it('Delete is offered only for an existing note and removes it', () => {
    const none = openNote();
    expect(buttonWithText('Delete', none.dlg)).toBeUndefined();
    none.t.dispose();
    cleanup();

    const { t, dlg } = openNote('old note');
    click(buttonWithText('Delete', dlg)!);
    expect(t.onDeleteNote).toHaveBeenCalledTimes(1);
    expect(dialog()).toBeNull();
    t.dispose();
  });

  it('Save button saves the trimmed text', () => {
    const { t, dlg, textarea } = openNote();
    typeInto(textarea, '  padded  ');
    click(buttonWithText('Save', dlg)!);
    expect(t.onSaveNote).toHaveBeenCalledWith('padded');
    t.dispose();
  });

  it('closing any other way saves a changed draft (no silent loss)', () => {
    const { t, textarea } = openNote();
    typeInto(textarea, 'typed then clicked away');
    pointerDown(document.body);
    expect(dialog()).toBeNull();
    expect(t.onSaveNote).toHaveBeenCalledTimes(1);
    expect(t.onSaveNote).toHaveBeenCalledWith('typed then clicked away');
    t.dispose();
  });

  it('closing with an unchanged draft saves nothing', () => {
    const { t } = openNote('same');
    pointerDown(document.body);
    expect(dialog()).toBeNull();
    expect(t.onSaveNote).not.toHaveBeenCalled();
    expect(t.onDeleteNote).not.toHaveBeenCalled();
    t.dispose();
  });

  it('unmounting the toolbar with a changed draft still saves it', () => {
    const { t, textarea } = openNote();
    typeInto(textarea, 'toolbar went away');
    t.unmount();
    expect(t.onSaveNote).toHaveBeenCalledWith('toolbar went away');
    t.dispose();
  });

  it('saves exactly once when Save is followed by the unmount', () => {
    const { t, textarea } = openNote();
    typeInto(textarea, 'once');
    press(textarea, 'Enter', { metaKey: true });
    t.unmount();
    expect(t.onSaveNote).toHaveBeenCalledTimes(1);
    t.dispose();
  });
});

describe('keyboard', () => {
  it('uses a roving tab stop: one button is tabbable, arrows move between buttons and wrap', () => {
    const t = setup();
    const items = Array.from(toolbar().querySelectorAll<HTMLButtonElement>('button'));
    expect(items.map((b) => b.getAttribute('tabindex'))).toEqual(['0', '-1', '-1', '-1', '-1']);

    act(() => items[0].focus());
    press(items[0], 'ArrowRight');
    expect(document.activeElement).toBe(items[1]);
    expect(items.map((b) => b.getAttribute('tabindex'))).toEqual(['-1', '0', '-1', '-1', '-1']);

    press(items[1], 'End');
    expect(document.activeElement).toBe(items[4]);
    press(items[4], 'ArrowRight');
    expect(document.activeElement).toBe(items[0]);
    press(items[0], 'ArrowLeft');
    expect(document.activeElement).toBe(items[4]);
    press(items[4], 'Home');
    expect(document.activeElement).toBe(items[0]);
    t.dispose();
  });

  it('Escape on the pill asks the host to hide the toolbar', () => {
    const t = setup();
    const first = toolbar().querySelector<HTMLButtonElement>('button')!;
    act(() => first.focus());
    press(first, 'Escape');
    expect(t.onRequestClose).toHaveBeenCalledTimes(1);
    expect(t.windowKeyDown).not.toHaveBeenCalled();
    t.dispose();
  });

  it('autoFocus moves focus to the first button', () => {
    const t = setup({ autoFocus: true });
    expect(document.activeElement).toBe(toolbar().querySelector('button'));
    t.dispose();
  });

  it('reports keyboard focus entering and leaving the toolbar', () => {
    stubFocusVisible(true);
    const t = setup();
    const outside = document.createElement('button');
    document.body.appendChild(outside);
    const first = toolbar().querySelector<HTMLButtonElement>('button')!;

    act(() => first.focus());
    expect(t.onFocusWithinChange).toHaveBeenLastCalledWith(true);

    // Moving between buttons is not leaving
    t.onFocusWithinChange.mockClear();
    const second = toolbar().querySelectorAll<HTMLButtonElement>('button')[1];
    act(() => second.focus());
    expect(t.onFocusWithinChange).not.toHaveBeenCalledWith(false);

    act(() => outside.focus());
    expect(t.onFocusWithinChange).toHaveBeenLastCalledWith(false);
    outside.remove();
    t.dispose();
  });

  it('does not count mouse-initiated focus (not :focus-visible) as keyboard focus', () => {
    stubFocusVisible(false);
    const t = setup();
    const first = toolbar().querySelector<HTMLButtonElement>('button')!;
    act(() => first.focus());
    expect(t.onFocusWithinChange).toHaveBeenLastCalledWith(false);
    t.dispose();
  });

  it('keeps focus-within true while focus moves from a button into its popover', () => {
    stubFocusVisible(true);
    const t = setup();
    click(byLabel('Choose highlight brush')!);
    t.onFocusWithinChange.mockClear();
    const swatch = byLabel('Blue brush', dialog()!)!;
    act(() => swatch.focus());
    expect(t.onFocusWithinChange).not.toHaveBeenCalledWith(false);
    t.dispose();
  });
});

describe('event isolation from the node', () => {
  it('clicks and key presses on the pill never reach the node wrapper', () => {
    const t = setup();
    const paint = byLabel('Paint with Red circle highlight')!;
    click(paint);
    click(byLabel('Zoom to operation')!);
    act(() => {
      paint.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
      paint.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    });
    press(paint, 'Enter');
    press(paint, ' ');
    press(paint, 'ArrowLeft');
    press(paint, 'ArrowDown');
    expect(t.parentClick).not.toHaveBeenCalled();
    expect(t.parentKeyDown).not.toHaveBeenCalled();
    expect(t.windowKeyDown).not.toHaveBeenCalled();
    t.dispose();
  });

  it('clicks and key presses inside a popover never reach the node wrapper either', () => {
    const t = setup();
    click(byLabel('Add note')!);
    const dlg = dialog()!;
    click(dlg);
    click(dlg.querySelector('textarea')!);
    act(() => {
      dlg.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
      dlg.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
    });
    const textarea = dlg.querySelector('textarea')!;
    press(textarea, 'a');
    press(textarea, 'ArrowLeft');
    press(textarea, 'Escape');
    expect(t.parentClick).not.toHaveBeenCalled();
    expect(t.parentKeyDown).not.toHaveBeenCalled();
    expect(t.windowKeyDown).not.toHaveBeenCalled();
    t.dispose();
  });

  it('lets Cmd/Ctrl+letter chords (the command palette) through', () => {
    const t = setup();
    const paint = byLabel('Paint with Red circle highlight')!;
    press(paint, 'k', { metaKey: true });
    expect(t.windowKeyDown).toHaveBeenCalledTimes(1);
    t.dispose();
  });
});
