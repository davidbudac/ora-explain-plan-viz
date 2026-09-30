/** @jsxRuntime automatic */
/** @jsxImportSource react */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ErrorBoundary } from '../ErrorBoundary';
import { buttonByText, cleanup, click, render } from './testUtils';

let shouldThrow = true;
function Bomb() {
  if (shouldThrow) throw new Error('kaboom from test');
  return <p>all good</p>;
}

beforeEach(() => {
  shouldThrow = true;
  // React logs caught errors; keep test output clean.
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('ErrorBoundary', () => {
  it('renders children when nothing throws', () => {
    shouldThrow = false;
    render(
      <ErrorBoundary>
        <Bomb />
      </ErrorBoundary>,
    );
    expect(document.body.textContent).toContain('all good');
  });

  it('shows the fallback card with the message, and "Try again" recovers', () => {
    const onError = vi.fn();
    render(
      <ErrorBoundary onError={onError}>
        <Bomb />
      </ErrorBoundary>,
    );
    const card = document.querySelector('[role="alert"]')!;
    expect(card.textContent).toContain('Something went wrong');
    expect(card.querySelector('pre')?.textContent).toBe('kaboom from test');
    expect(onError).toHaveBeenCalledTimes(1);
    expect(buttonByText('Reload page')).toBeTruthy();
    expect(buttonByText('Copy error details')).toBeTruthy();

    shouldThrow = false;
    click(buttonByText('Try again'));
    expect(document.querySelector('[role="alert"]')).toBeNull();
    expect(document.body.textContent).toContain('all good');
  });
});
