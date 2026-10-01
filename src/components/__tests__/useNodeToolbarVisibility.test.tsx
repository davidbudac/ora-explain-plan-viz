/** @jsxRuntime automatic */
/** @jsxImportSource react */
import { act, useLayoutEffect, useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  TOOLBAR_HIDE_DELAY_MS,
  TOOLBAR_SHOW_DELAY_MS,
  useNodeToolbarVisibility,
} from '../nodes/useNodeToolbarVisibility';
import { cleanup, press, render } from '../ui/__tests__/testUtils';

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

const probe: { latest: ReturnType<typeof useNodeToolbarVisibility> | null } = { latest: null };
const latest = () => probe.latest!;

/** Stand-in for a React Flow node: a `.react-flow__node` wrapper around a card, with the toolbar beside it. */
function Harness({ selectedOnTouch = false }: { selectedOnTouch?: boolean }) {
  const [rootEl, setRootEl] = useState<HTMLDivElement | null>(null);
  const v = useNodeToolbarVisibility({ rootEl, enabled: true, selectedOnTouch });
  useLayoutEffect(() => {
    probe.latest = v;
  });
  return (
    <div className="react-flow__node" tabIndex={0} data-testid="wrapper">
      <div
        ref={setRootEl}
        data-testid="card"
        onMouseEnter={v.cardHover.onMouseEnter}
        onMouseLeave={v.cardHover.onMouseLeave}
      />
      {v.visible && (
        <div
          data-testid="toolbar"
          data-node-action-surface={v.toolbarProps.surfaceId}
          onMouseEnter={() => v.toolbarProps.onHoverChange(true)}
          onMouseLeave={() => v.toolbarProps.onHoverChange(false)}
        >
          <button type="button" data-testid="toolbar-button" />
        </div>
      )}
    </div>
  );
}

const q = (id: string) => document.querySelector<HTMLElement>(`[data-testid="${id}"]`);
const visible = () => q('toolbar') !== null;
const advance = (ms: number) => act(() => void vi.advanceTimersByTime(ms));
const enter = (el: Element, buttons = 0) =>
  act(() => void el.dispatchEvent(new MouseEvent('mouseover', { bubbles: true, relatedTarget: document.body, buttons })));
const leave = (el: Element) =>
  act(() => void el.dispatchEvent(new MouseEvent('mouseout', { bubbles: true, relatedTarget: document.body })));

function stubFocusVisible(value: boolean) {
  const original = Element.prototype.matches;
  vi.spyOn(Element.prototype, 'matches').mockImplementation(function (this: Element, selector: string) {
    if (selector === ':focus-visible') return value;
    return original.call(this, selector);
  });
}

describe('hover timing', () => {
  it('shows after a short delay, not immediately', () => {
    render(<Harness />);
    enter(q('card')!);
    expect(visible()).toBe(false);
    advance(TOOLBAR_SHOW_DELAY_MS - 1);
    expect(visible()).toBe(false);
    advance(1);
    expect(visible()).toBe(true);
  });

  it('never shows when the pointer only sweeps across the node', () => {
    render(<Harness />);
    enter(q('card')!);
    advance(TOOLBAR_SHOW_DELAY_MS - 20);
    leave(q('card')!);
    advance(1000);
    expect(visible()).toBe(false);
  });

  it('hides a little after the pointer leaves, and stays if it comes back in time', () => {
    render(<Harness />);
    enter(q('card')!);
    advance(TOOLBAR_SHOW_DELAY_MS);
    expect(visible()).toBe(true);

    leave(q('card')!);
    advance(TOOLBAR_HIDE_DELAY_MS - 1);
    expect(visible()).toBe(true);
    advance(1);
    expect(visible()).toBe(false);

    enter(q('card')!);
    advance(TOOLBAR_SHOW_DELAY_MS);
    leave(q('card')!);
    advance(TOOLBAR_HIDE_DELAY_MS - 10);
    enter(q('card')!);
    advance(1000);
    expect(visible()).toBe(true);
  });

  it('bridges the move from the card onto the toolbar pill', () => {
    render(<Harness />);
    enter(q('card')!);
    advance(TOOLBAR_SHOW_DELAY_MS);
    leave(q('card')!);
    advance(TOOLBAR_HIDE_DELAY_MS / 2);
    enter(q('toolbar')!);
    advance(1000);
    expect(visible()).toBe(true);

    leave(q('toolbar')!);
    advance(TOOLBAR_HIDE_DELAY_MS);
    expect(visible()).toBe(false);
  });

  it('ignores nodes sliding under a pointer with a button held (pan / drag)', () => {
    render(<Harness />);
    enter(q('card')!, 1);
    advance(1000);
    expect(visible()).toBe(false);
  });

  it('clears its timer when the node goes away', () => {
    const view = render(<Harness />);
    enter(q('card')!);
    view.unmount();
    expect(() => advance(1000)).not.toThrow();
  });
});

describe('other reasons to stay visible', () => {
  it('an open popover keeps the toolbar up with the pointer gone', () => {
    render(<Harness />);
    enter(q('card')!);
    advance(TOOLBAR_SHOW_DELAY_MS);
    act(() => latest().toolbarProps.onPopoverOpenChange(true));
    leave(q('card')!);
    advance(1000);
    expect(visible()).toBe(true);

    act(() => latest().toolbarProps.onPopoverOpenChange(false));
    expect(visible()).toBe(false);
  });

  it('closing a popover drops a stale hover: no mouseleave arrives when it unmounts under the pointer', () => {
    render(<Harness />);
    enter(q('card')!);
    advance(TOOLBAR_SHOW_DELAY_MS);
    act(() => latest().toolbarProps.onPopoverOpenChange(true));
    // The pointer moves into the popover (a React child of the node): no leave event
    advance(1000);
    expect(visible()).toBe(true);
    act(() => latest().toolbarProps.onPopoverOpenChange(false));
    expect(visible()).toBe(false);

    // A real hover re-establishes itself
    enter(q('card')!);
    advance(TOOLBAR_SHOW_DELAY_MS);
    expect(visible()).toBe(true);
  });

  it('a coarse-pointer device shows it on the selected node', () => {
    render(<Harness selectedOnTouch />);
    expect(visible()).toBe(true);
  });

  it('keyboard focus on the node wrapper shows it, and leaving hides it', () => {
    stubFocusVisible(true);
    render(<Harness />);
    const wrapper = q('wrapper')!;
    act(() => wrapper.focus());
    expect(visible()).toBe(true);
    act(() => wrapper.blur());
    expect(visible()).toBe(false);
  });

  it('mouse focus on the wrapper (not :focus-visible) does not', () => {
    stubFocusVisible(false);
    render(<Harness />);
    act(() => q('wrapper')!.focus());
    expect(visible()).toBe(false);
  });

  it('keeps it up while focus is inside the toolbar', () => {
    stubFocusVisible(true);
    render(<Harness />);
    const wrapper = q('wrapper')!;
    act(() => wrapper.focus());
    // The toolbar reports its own focus; moving wrapper → toolbar must not drop it
    act(() => q('toolbar-button')!.focus());
    act(() => latest().toolbarProps.onFocusWithinChange(true));
    expect(visible()).toBe(true);
    act(() => latest().toolbarProps.onFocusWithinChange(false));
    expect(visible()).toBe(false);
  });

  it('commits hover immediately if the toolbar is already visible from keyboard focus', () => {
    stubFocusVisible(true);
    render(<Harness />);
    const wrapper = q('wrapper')!;

    // Make toolbar visible via keyboard focus
    act(() => wrapper.focus());
    expect(visible()).toBe(true);

    // Pointer enters the card without advancing timers (would normally wait 80ms)
    act(() => latest().toolbarProps.onHoverChange(true));

    // Toolbar must be visible now, not waiting for the delay
    expect(visible()).toBe(true);

    // Focus moves away (e.g., mousedown on toolbar button)
    act(() => latest().toolbarProps.onFocusWithinChange(false));

    // Toolbar stays visible because hover was committed immediately
    expect(visible()).toBe(true);
  });
});

describe('keyboard entry', () => {
  it('marks the node with its shortcut', () => {
    render(<Harness />);
    expect(q('wrapper')!.getAttribute('aria-keyshortcuts')).toBe('Shift+F10');
  });

  it('Shift+F10 shows the toolbar and asks for focus to move into it', () => {
    render(<Harness />);
    const event = press(q('wrapper')!, 'F10', { shiftKey: true });
    expect(event.defaultPrevented).toBe(true);
    expect(visible()).toBe(true);
    expect(latest().toolbarProps.autoFocus).toBe(true);

    // Once focus lands inside, the request is spent
    act(() => latest().toolbarProps.onFocusWithinChange(true));
    expect(latest().toolbarProps.autoFocus).toBe(false);
  });

  it('the Menu key does the same', () => {
    render(<Harness />);
    const event = press(q('wrapper')!, 'ContextMenu');
    expect(event.defaultPrevented).toBe(true);
    expect(visible()).toBe(true);
  });

  it('plain F10 does nothing', () => {
    render(<Harness />);
    const event = press(q('wrapper')!, 'F10');
    expect(event.defaultPrevented).toBe(false);
    expect(visible()).toBe(false);
  });

  it('Escape hides the toolbar and returns focus to the node without re-opening it', () => {
    stubFocusVisible(true);
    render(<Harness />);
    const wrapper = q('wrapper')!;
    press(wrapper, 'F10', { shiftKey: true });
    act(() => q('toolbar-button')!.focus());
    act(() => latest().toolbarProps.onFocusWithinChange(true));
    expect(visible()).toBe(true);

    act(() => latest().toolbarProps.onRequestClose());
    expect(document.activeElement).toBe(wrapper);
    expect(visible()).toBe(false);
  });

  it('removes the shortcut hint when the node goes away', () => {
    const view = render(<Harness />);
    const wrapper = q('wrapper')!;
    view.unmount();
    expect(wrapper.getAttribute('aria-keyshortcuts')).toBeNull();
  });
});
