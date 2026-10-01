/** @jsxRuntime automatic */
/** @jsxImportSource react */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PlanWarningsNotice } from '../PlanWarningsNotice';
import { cleanup, click, render } from '../ui/__tests__/testUtils';
import type { PlanWarning } from '../../lib/types';

afterEach(cleanup);

const warn = (code: string, extra: Partial<PlanWarning> = {}): PlanWarning => ({ code, message: `message ${code}`, ...extra });

describe('PlanWarningsNotice', () => {
  it('shows one or two warnings inline as a status region', () => {
    const { container } = render(<PlanWarningsNotice warnings={[warn('a'), warn('b', { detail: 'row 3' })]} onDismiss={() => {}} />);
    const status = container.querySelector('[role="status"]');
    expect(status?.textContent).toContain('message a');
    expect(status?.textContent).toContain('message b');
    expect(status?.textContent).toContain('row 3');
    expect(container.querySelector('[aria-expanded]')).toBeNull();
  });

  it('collapses more than two behind a toggle that shows the count', () => {
    const { container } = render(
      <PlanWarningsNotice warnings={[warn('a'), warn('b'), warn('c')]} onDismiss={() => {}} />,
    );
    expect(container.textContent).toContain('3 warnings about this plan');
    expect(container.textContent).not.toContain('message a');

    const toggle = container.querySelector('[aria-expanded]') as HTMLButtonElement;
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    click(toggle);
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    expect(container.textContent).toContain('message a');
    expect(container.textContent).toContain('message c');
  });

  it('calls onDismiss from the close button', () => {
    const onDismiss = vi.fn();
    const { container } = render(<PlanWarningsNotice warnings={[warn('a')]} onDismiss={onDismiss} />);
    click(container.querySelector('button[aria-label="Dismiss"]')!);
    expect(onDismiss).toHaveBeenCalledOnce();
  });

  it('uses the quiet style when every entry is informational', () => {
    const { container } = render(<PlanWarningsNotice warnings={[warn('a', { severity: 'info' })]} onDismiss={() => {}} />);
    expect(container.querySelector('[role="status"]')?.className).not.toContain('amber');
  });
});
