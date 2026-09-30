/** @jsxRuntime automatic */
/** @jsxImportSource react */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CompareMetric } from '../../lib/compare';

const state = vi.hoisted(() => ({
  compareMetrics: ['cost'] as CompareMetric[],
  setCompareMetrics: vi.fn(),
}));
vi.mock('../../hooks/usePlanContext', () => ({
  usePlan: () => ({
    compareMetrics: state.compareMetrics,
    setCompareMetrics: state.setCompareMetrics,
    plans: [],
    comparePlanIndices: [0, 1],
  }),
}));

import { CompareMetricSelector } from '../CompareMetricSelector';
import { buttonByText, cleanup, click, render } from '../ui/__tests__/testUtils';

beforeEach(() => {
  state.setCompareMetrics.mockReset();
});
afterEach(cleanup);

describe('CompareMetricSelector', () => {
  it('reports each metric as a toggle with its pressed state', () => {
    state.compareMetrics = ['cost', 'rows'];
    render(<CompareMetricSelector />);
    expect(buttonByText('Cost').getAttribute('aria-pressed')).toBe('true');
    expect(buttonByText('E-Rows').getAttribute('aria-pressed')).toBe('true');
    expect(buttonByText('Bytes').getAttribute('aria-pressed')).toBe('false');
  });

  it('turns a metric off when more than one is selected', () => {
    state.compareMetrics = ['cost', 'rows'];
    render(<CompareMetricSelector />);
    click(buttonByText('E-Rows'));
    expect(state.setCompareMetrics).toHaveBeenCalledWith(['cost']);
  });

  it('refuses to deselect the last metric and says why', () => {
    state.compareMetrics = ['cost'];
    render(<CompareMetricSelector />);
    const cost = buttonByText('Cost');
    expect(cost.getAttribute('aria-disabled')).toBe('true');
    expect(cost.title).toBe('At least one metric must stay selected');

    click(cost);
    expect(state.setCompareMetrics).not.toHaveBeenCalled();
  });

  it('still lets another metric be added', () => {
    state.compareMetrics = ['cost'];
    render(<CompareMetricSelector />);
    click(buttonByText('E-Rows'));
    expect(state.setCompareMetrics).toHaveBeenCalledWith(['cost', 'rows']);
  });
});
