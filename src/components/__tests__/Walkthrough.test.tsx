/** @jsxRuntime automatic */
/** @jsxImportSource react */
import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { WalkthroughView } from '../Walkthrough';
import { WALKTHROUGH_STEPS, type WalkthroughStep } from '../../lib/walkthrough';
import { buttonByText, cleanup, click, press, render } from '../ui/__tests__/testUtils';

const STEPS: WalkthroughStep[] = [
  { id: 'a', title: 'First', body: 'Body one' },
  { id: 'b', title: 'Second', body: 'Body two', target: 'thing' },
  { id: 'c', title: 'Third', body: 'Body three', target: 'does-not-exist' },
];

function Harness({ steps = STEPS, onClose }: { steps?: WalkthroughStep[]; onClose: () => void }) {
  const [index, setIndex] = useState(0);
  return (
    <WalkthroughView
      steps={steps}
      index={index}
      onNext={() => setIndex((i) => Math.min(i + 1, steps.length - 1))}
      onBack={() => setIndex((i) => Math.max(i - 1, 0))}
      onClose={onClose}
    />
  );
}

const card = () => document.body.querySelector('[role="dialog"]') as HTMLElement;

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('WalkthroughView', () => {
  it('renders the first step as a labelled modal dialog', () => {
    render(<Harness onClose={() => {}} />);
    const dialog = card();
    expect(dialog.getAttribute('aria-modal')).toBe('true');
    const label = document.getElementById(dialog.getAttribute('aria-labelledby')!);
    expect(label?.textContent).toBe('First');
    expect(dialog.textContent).toContain('Step 1 of 3');
    expect(dialog.textContent).toContain('Body one');
    expect(dialog.getAttribute('data-placement')).toBe('center');
    // First step: no Back.
    expect(Array.from(dialog.querySelectorAll('button')).some((b) => b.textContent === 'Back')).toBe(false);
  });

  it('Next and Back move between steps and focus the primary button', () => {
    render(<Harness onClose={() => {}} />);
    click(buttonByText('Next'));
    expect(card().textContent).toContain('Second');
    expect(card().textContent).toContain('Step 2 of 3');
    expect(document.activeElement).toBe(buttonByText('Next'));
    click(buttonByText('Back'));
    expect(card().textContent).toContain('First');
  });

  it('shows Finish on the last step and closes with it', () => {
    const onClose = vi.fn();
    render(<Harness onClose={onClose} />);
    click(buttonByText('Next'));
    click(buttonByText('Next'));
    expect(() => buttonByText('Next')).toThrow();
    click(buttonByText('Finish'));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('Skip tour closes', () => {
    const onClose = vi.fn();
    render(<Harness onClose={onClose} />);
    click(buttonByText('Skip tour'));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('Escape closes; arrow keys step through the tour', () => {
    const onClose = vi.fn();
    render(<Harness onClose={onClose} />);
    press(buttonByText('Next'), 'ArrowRight');
    expect(card().textContent).toContain('Second');
    press(buttonByText('Next'), 'ArrowLeft');
    expect(card().textContent).toContain('First');
    press(buttonByText('Next'), 'Escape');
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('does not hijack arrow keys typed into a text field elsewhere on the page', () => {
    render(<Harness onClose={() => {}} />);
    const input = document.createElement('input');
    document.body.appendChild(input);
    press(input, 'ArrowRight');
    expect(card().textContent).toContain('First');
    input.remove();
  });

  it('still renders, centred and without a spotlight, when the target is missing', () => {
    render(<Harness onClose={() => {}} />);
    click(buttonByText('Next')); // "thing" is not in the DOM
    click(buttonByText('Next')); // neither is "does-not-exist"
    expect(card().textContent).toContain('Third');
    expect(card().getAttribute('data-placement')).toBe('center');
    expect(document.body.querySelector('[data-walkthrough-spotlight]')).toBeNull();
  });

  it('spotlights a target that is on screen', () => {
    const anchor = document.createElement('div');
    anchor.setAttribute('data-tour', 'thing');
    anchor.getBoundingClientRect = () =>
      ({ top: 100, left: 100, width: 120, height: 30, right: 220, bottom: 130, x: 100, y: 100, toJSON: () => ({}) }) as DOMRect;
    document.body.appendChild(anchor);
    render(<Harness onClose={() => {}} />);
    click(buttonByText('Next'));
    expect(document.body.querySelector('[data-walkthrough-spotlight]')).not.toBeNull();
    expect(card().getAttribute('data-placement')).not.toBe('center');
  });

  it('restores focus to the previously focused element when it closes', () => {
    const opener = document.createElement('button');
    document.body.appendChild(opener);
    opener.focus();
    const view = render(<Harness onClose={() => {}} />);
    expect(document.activeElement).not.toBe(opener);
    view.unmount();
    expect(document.activeElement).toBe(opener);
  });

  it('walks the real step list end to end', () => {
    render(<Harness steps={WALKTHROUGH_STEPS} onClose={() => {}} />);
    for (let i = 0; i < WALKTHROUGH_STEPS.length - 1; i += 1) click(buttonByText('Next'));
    expect(card().textContent).toContain(`Step ${WALKTHROUGH_STEPS.length} of ${WALKTHROUGH_STEPS.length}`);
    expect(buttonByText('Finish')).toBeTruthy();
  });
});
