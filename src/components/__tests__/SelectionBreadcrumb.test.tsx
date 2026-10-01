/** @jsxRuntime automatic */
/** @jsxImportSource react */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SelectionBreadcrumb } from '../SelectionBreadcrumb';
import { collapseCrumbs, crumbTitle } from '../../lib/breadcrumb';
import type { Crumb } from '../../lib/breadcrumb';
import { cleanup, click, render } from '../ui/__tests__/testUtils';

afterEach(cleanup);

const crumbs = (n: number): Crumb[] =>
  Array.from({ length: n }, (_, i) => ({ id: i, operation: `OP ${i}`, objectName: i === n - 1 ? 'ORDERS' : undefined }));

describe('collapseCrumbs', () => {
  it('keeps short paths whole', () => {
    expect(collapseCrumbs(crumbs(5)).every((item) => item.kind === 'crumb')).toBe(true);
  });

  it('collapses the middle of a long path, keeping the root and the last three', () => {
    const items = collapseCrumbs(crumbs(9));
    expect(items.map((item) => (item.kind === 'gap' ? '…' : item.crumb.id))).toEqual([0, '…', 6, 7, 8]);
    const gap = items[1];
    expect(gap.kind === 'gap' && gap.hidden.map((c) => c.id)).toEqual([1, 2, 3, 4, 5]);
  });
});

describe('SelectionBreadcrumb', () => {
  it('renders nothing for an empty path', () => {
    const { container } = render(<SelectionBreadcrumb path={[]} onSelect={() => {}} onReturn={() => {}} />);
    expect(container.querySelector('nav')).toBeNull();
  });

  it('is a labelled nav with the selected operation marked current', () => {
    const { container } = render(<SelectionBreadcrumb path={crumbs(3)} onSelect={() => {}} onReturn={() => {}} />);
    const nav = container.querySelector('nav');
    expect(nav?.getAttribute('aria-label')).toBe('Selected operation path');
    expect(container.querySelectorAll('[aria-current="location"]')).toHaveLength(1);
    expect(container.querySelector('[aria-current="location"]')?.getAttribute('title')).toBe(crumbTitle(crumbs(3)[2]));
  });

  it('selects the clicked ancestor', () => {
    const onSelect = vi.fn();
    const { container } = render(<SelectionBreadcrumb path={crumbs(4)} onSelect={onSelect} onReturn={() => {}} />);
    const buttons = Array.from(container.querySelectorAll('ol button'));
    expect(buttons).toHaveLength(4);
    click(buttons[1]);
    expect(onSelect).toHaveBeenCalledWith(1);
  });

  it('shows an ellipsis for long paths and has no button for it', () => {
    const { container } = render(<SelectionBreadcrumb path={crumbs(9)} onSelect={() => {}} onReturn={() => {}} />);
    expect(container.querySelectorAll('ol button')).toHaveLength(4);
    expect(container.textContent).toContain('…');
  });

  it('recentres through the Return to selected button', () => {
    const onReturn = vi.fn();
    const { container } = render(<SelectionBreadcrumb path={crumbs(2)} onSelect={() => {}} onReturn={onReturn} />);
    const button = Array.from(container.querySelectorAll('button')).find((b) => b.textContent === 'Return to selected');
    click(button!);
    expect(onReturn).toHaveBeenCalledTimes(1);
  });
});
