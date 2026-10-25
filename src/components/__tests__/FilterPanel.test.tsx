import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FilterState, ParsedPlan, PlanNode } from '../../lib/types';

const state = vi.hoisted(() => ({
  plan: null as unknown,
  filters: {} as Record<string, unknown>,
  setFilters: vi.fn(),
  selectNode: vi.fn(),
}));
vi.mock('../../hooks/usePlanContext', () => ({
  usePlan: () => {
    const plan = state.plan as { allNodes: unknown[] };
    return {
      parsedPlan: plan,
      filters: state.filters,
      setFilters: state.setFilters,
      filteredNodes: plan.allNodes,
      selectNode: state.selectNode,
      colorScheme: 'contrast',
    };
  },
}));

import { FilterPanelBody } from '../FilterPanel';
import { buttonByText, cleanup, click, press, render } from '../ui/__tests__/testUtils';

const DEFAULT_FILTERS: FilterState = {
  operationTypes: [],
  minCost: 0,
  maxCost: Infinity,
  searchText: '',
  predicateTypes: [],
  minActualRows: 0,
  maxActualRows: Infinity,
  minActualTime: 0,
  maxActualTime: Infinity,
  minCardinalityMismatch: 0,
} as FilterState;

function node(id: number, operation: string, extra: Partial<PlanNode> = {}): PlanNode {
  return { id, depth: id, operation, cost: 10 * (id + 1), children: [], ...extra } as PlanNode;
}

function plan(nodes: PlanNode[], hasActualStats = false): ParsedPlan {
  return { allNodes: nodes, hasActualStats } as unknown as ParsedPlan;
}

function typeInto(input: HTMLInputElement, value: string) {
  act(() => {
    input.focus();
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
    setter.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

beforeEach(() => {
  state.filters = { ...DEFAULT_FILTERS };
  state.setFilters.mockReset();
  state.plan = plan([
    node(0, 'SELECT STATEMENT'),
    node(1, 'HASH JOIN', { accessPredicates: '"A"."ID"="B"."ID"' }),
    node(2, 'TABLE ACCESS FULL', { filterPredicates: '"A"."X">1' }),
    node(3, 'INDEX RANGE SCAN', { accessPredicates: '"B"."ID"=1' }),
  ]);
});
afterEach(cleanup);

describe('FilterPanelBody', () => {
  it('lists operation categories as count tiles and toggles a whole category', () => {
    render(<FilterPanelBody />);
    const join = document.querySelector<HTMLButtonElement>('button[aria-label="Join Operations (1)"]')!;
    expect(join.getAttribute('aria-pressed')).toBe('false');
    expect(join.textContent).toBe('1Join');
    click(join);
    const { operationTypes } = state.setFilters.mock.calls[0][0] as FilterState;
    expect(operationTypes).toContain('HASH JOIN');
  });

  it('fades the other tiles once one is picked', () => {
    state.filters = { ...DEFAULT_FILTERS, predicateTypes: ['access'] };
    render(<FilterPanelBody />);
    const access = document.querySelector<HTMLButtonElement>('button[aria-label^="Access predicates"]')!;
    const filter = document.querySelector<HTMLButtonElement>('button[aria-label^="Filter predicates"]')!;
    expect(access.getAttribute('aria-pressed')).toBe('true');
    expect(access.className).not.toContain('opacity-45');
    expect(filter.className).toContain('opacity-45');
  });

  it('hides a facet group that has only one value', () => {
    state.plan = plan([node(0, 'SELECT STATEMENT'), node(1, 'TABLE ACCESS FULL')]);
    render(<FilterPanelBody />);
    // Every operation lacks predicates, so "None" would be the only choice.
    expect(document.querySelector('[aria-label="Predicate types"]')).toBeNull();
    expect(document.querySelector('[aria-label="Operation types"]')).not.toBeNull();
  });

  it('keeps Reset in place but disabled until a filter is active', () => {
    render(<FilterPanelBody />);
    expect(buttonByText('Reset').disabled).toBe(true);
    cleanup();
    state.filters = { ...DEFAULT_FILTERS, minCost: 20 };
    render(<FilterPanelBody />);
    expect(buttonByText('Reset').disabled).toBe(false);
  });

  it('commits a typed threshold with a suffix on Enter', () => {
    state.plan = plan([node(0, 'SELECT STATEMENT', { actualRows: 5_000_000 }), node(1, 'TABLE ACCESS FULL', { actualRows: 10 })], true);
    render(<FilterPanelBody />);
    const rows = document.querySelector<HTMLInputElement>('input[aria-label="A-Rows, at least"]')!;
    typeInto(rows, '1.5m');
    press(rows, 'Enter');
    expect(state.setFilters).toHaveBeenCalledWith({ minActualRows: 1_500_000 });
  });

  it('ignores unreadable threshold text', () => {
    render(<FilterPanelBody />);
    const cost = document.querySelector<HTMLInputElement>('input[aria-label="Cost, at least"]')!;
    typeInto(cost, 'lots');
    press(cost, 'Enter');
    expect(state.setFilters).not.toHaveBeenCalled();
  });

  it('shows the active threshold with ≥ and only runtime ranges when the plan has stats', () => {
    state.filters = { ...DEFAULT_FILTERS, minCost: 20 };
    render(<FilterPanelBody />);
    expect(document.querySelector<HTMLInputElement>('input[aria-label="Cost, at least"]')!.value).toBe('≥ 20');
    expect(document.querySelector('input[aria-label="A-Rows, at least"]')).toBeNull();
  });

  it('steps through search matches with Enter', () => {
    state.filters = { ...DEFAULT_FILTERS, searchText: 'scan' };
    render(<FilterPanelBody />);
    const search = document.querySelector<HTMLInputElement>('input[placeholder="Search operations…"]')!;
    press(search, 'Enter');
    expect(state.selectNode).toHaveBeenLastCalledWith(3);
  });
});
