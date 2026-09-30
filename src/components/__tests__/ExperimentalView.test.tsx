/** @jsxRuntime automatic */
/** @jsxImportSource react */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ExperimentalSubView } from '../../lib/types';

const state = vi.hoisted(() => ({
  experimentalSubView: 'scatter' as ExperimentalSubView,
  setExperimentalSubView: vi.fn(),
}));
vi.mock('../../hooks/usePlanContext', () => ({
  usePlan: () => ({
    experimentalSubView: state.experimentalSubView,
    setExperimentalSubView: state.setExperimentalSubView,
    parsedPlan: {},
  }),
}));
// The sub-views are heavy and irrelevant to the switcher
vi.mock('../views/experimental/ScatterView', () => ({ ScatterView: () => <div data-testid="scatter" /> }));
vi.mock('../views/experimental/TimelineView', () => ({ TimelineView: () => <div data-testid="timeline" /> }));
vi.mock('../views/experimental/WaterfallView', () => ({ WaterfallView: () => <div data-testid="waterfall" /> }));
vi.mock('../views/experimental/MorphView', () => ({ MorphView: () => <div data-testid="morph" /> }));
vi.mock('../views/experimental/WaitsView', () => ({ WaitsView: () => <div data-testid="waits" /> }));

import { ExperimentalView } from '../views/experimental/ExperimentalView';
import { buttonByText, cleanup, click, render } from '../ui/__tests__/testUtils';

beforeEach(() => {
  state.setExperimentalSubView.mockReset();
});
afterEach(cleanup);

describe('ExperimentalView switcher', () => {
  it('marks only the active sub-view as pressed', () => {
    state.experimentalSubView = 'timeline';
    render(<ExperimentalView />);
    expect(buttonByText('Timeline').getAttribute('aria-pressed')).toBe('true');
    expect(buttonByText('Scatter').getAttribute('aria-pressed')).toBe('false');
    expect(buttonByText('Waits').getAttribute('aria-pressed')).toBe('false');
  });

  it('describes the active sub-view under the switcher', () => {
    const expected: Record<ExperimentalSubView, string> = {
      scatter: 'Estimated vs actual rows per operation, log-log; far from the diagonal means a misestimate',
      timeline: 'When each operation was active during execution, with ASH wait classes',
      waterfall: 'Rows read vs rows returned per operation — wasted work',
      morph: 'Animated estimate→actual icicle',
      waits: 'Wait-class composition per operation from ASH samples',
    };
    for (const view of Object.keys(expected) as ExperimentalSubView[]) {
      state.experimentalSubView = view;
      const rendered = render(<ExperimentalView />);
      expect(rendered.container.textContent).toContain(expected[view]);
      rendered.unmount();
    }
  });

  it('switches sub-view on click', () => {
    state.experimentalSubView = 'scatter';
    render(<ExperimentalView />);
    click(buttonByText('Waterfall'));
    expect(state.setExperimentalSubView).toHaveBeenCalledWith('waterfall');
  });
});
