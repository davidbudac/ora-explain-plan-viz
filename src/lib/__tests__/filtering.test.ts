import { describe, it, expect } from 'vitest';
import { hasActiveFilters, isFilterActive, matchesFilters, neutralFilterPatch } from '../filtering';
import type { FilterState, NodeDisplayOptions, PlanNode } from '../types';

const displayOptions: NodeDisplayOptions = {
  showRows: true,
  showCost: true,
  showBytes: true,
  showObjectName: true,
  showPredicateIndicators: true,
  showPredicateDetails: false,
  showPartitionInfo: true,
  showQueryBlockBadge: true,
  showQueryBlockGrouping: true,
  showActualRows: true,
  showActualTime: true,
  showStarts: true,
  showHotspotBadge: true,
  showSpillBadge: true,
  showCardinalityBadge: true,
  showAdvisorBadge: true,
  showStaleStatsBadge: true,
  showMissingStatsBadge: true,
  showMismatchNoHistogramBadge: true,
  showAnnotations: true,
  compactStats: false,
};

function makeFilters(overrides: Partial<FilterState> = {}): FilterState {
  return {
    operationTypes: [],
    minCost: 0,
    maxCost: Infinity,
    searchText: '',
    showPredicates: true,
    predicateTypes: [],
    animateEdges: false,
    scaleEdgeWidth: true,
    focusSelection: false,
    nodeDisplayOptions: { ...displayOptions },
    minActualRows: 0,
    maxActualRows: Infinity,
    minActualTime: 0,
    maxActualTime: Infinity,
    minCardinalityMismatch: 0,
    ...overrides,
  };
}

describe('hasActiveFilters', () => {
  it('returns false for default filters', () => {
    expect(hasActiveFilters(makeFilters())).toBe(false);
  });

  it('detects search text', () => {
    expect(hasActiveFilters(makeFilters({ searchText: 'EMP' }))).toBe(true);
    expect(hasActiveFilters(makeFilters({ searchText: '   ' }))).toBe(false);
  });

  it('detects operation and predicate type filters', () => {
    expect(hasActiveFilters(makeFilters({ operationTypes: ['TABLE ACCESS FULL'] }))).toBe(true);
    expect(hasActiveFilters(makeFilters({ predicateTypes: ['access'] }))).toBe(true);
  });

  it('detects threshold filters', () => {
    expect(hasActiveFilters(makeFilters({ minCost: 10 }))).toBe(true);
    expect(hasActiveFilters(makeFilters({ maxCost: 500 }))).toBe(true);
    expect(hasActiveFilters(makeFilters({ minActualRows: 1 }))).toBe(true);
    expect(hasActiveFilters(makeFilters({ minActualTime: 100 }))).toBe(true);
    expect(hasActiveFilters(makeFilters({ minCardinalityMismatch: 3 }))).toBe(true);
  });

  it('ignores display-only options', () => {
    const filters = makeFilters({ animateEdges: true, focusSelection: true });
    filters.nodeDisplayOptions.showRows = false;
    expect(hasActiveFilters(filters)).toBe(false);
  });
});

function makeNode(overrides: Partial<PlanNode> = {}): PlanNode {
  return {
    id: 1,
    depth: 1,
    operation: 'TABLE ACCESS FULL',
    objectName: 'EMP',
    rows: 10,
    cost: 5,
    actualRows: 1000,
    actualTime: 12,
    accessPredicates: undefined,
    filterPredicates: '"E"."ID"=1',
    children: [],
    ...overrides,
  };
}

describe('isFilterActive', () => {
  it('is false for neutral filters, including the app defaults', () => {
    expect(isFilterActive(makeFilters())).toBe(false);
    // Display settings the app ships with (focusSelection on) are not filters.
    expect(isFilterActive(makeFilters({ focusSelection: true }))).toBe(false);
  });

  it.each<[string, Partial<FilterState>]>([
    ['searchText', { searchText: 'emp' }],
    ['operationTypes', { operationTypes: ['HASH JOIN'] }],
    ['predicateTypes', { predicateTypes: ['filter'] }],
    ['minCost', { minCost: 1 }],
    ['maxCost', { maxCost: 100 }],
    ['minActualRows', { minActualRows: 1 }],
    ['maxActualRows', { maxActualRows: 100 }],
    ['minActualTime', { minActualTime: 1 }],
    ['maxActualTime', { maxActualTime: 100 }],
    ['minCardinalityMismatch', { minCardinalityMismatch: 3 }],
  ])('detects a non-neutral %s', (_field, patch) => {
    expect(isFilterActive(makeFilters(patch))).toBe(true);
  });

  it('treats whitespace-only search text as neutral (matchesSearch trims too)', () => {
    expect(isFilterActive(makeFilters({ searchText: '  \t ' }))).toBe(false);
  });

  it('ignores every display-only field', () => {
    const filters = makeFilters({
      showPredicates: false,
      animateEdges: true,
      scaleEdgeWidth: false,
      focusSelection: true,
    });
    filters.nodeDisplayOptions = { ...displayOptions, showCost: false, showRows: false };
    expect(isFilterActive(filters)).toBe(false);
  });

  it('agrees with hasActiveFilters', () => {
    const samples = [makeFilters(), makeFilters({ minCost: 3 }), makeFilters({ searchText: 'x' })];
    for (const filters of samples) {
      expect(isFilterActive(filters)).toBe(hasActiveFilters(filters));
    }
  });

  it('when inactive, matchesFilters accepts every node (neutral really is neutral)', () => {
    const nodes = [
      makeNode(),
      makeNode({ id: 2, cost: undefined, rows: undefined, actualRows: undefined, actualTime: undefined }),
      makeNode({ id: 3, operation: 'HASH JOIN', objectName: undefined, filterPredicates: undefined, cost: 1e9 }),
    ];
    const filters = makeFilters();
    expect(isFilterActive(filters)).toBe(false);
    for (const node of nodes) {
      expect(matchesFilters(node, filters, true)).toBe(true);
      expect(matchesFilters(node, filters, false)).toBe(true);
    }
  });
});

describe('neutralFilterPatch', () => {
  it('clears every filter field but leaves display settings untouched', () => {
    const active = makeFilters({
      searchText: 'emp',
      operationTypes: ['HASH JOIN'],
      predicateTypes: ['access'],
      minCost: 10,
      maxCost: 50,
      minActualRows: 5,
      maxActualRows: 500,
      minActualTime: 1,
      maxActualTime: 99,
      minCardinalityMismatch: 10,
      showPredicates: false,
      animateEdges: true,
      scaleEdgeWidth: false,
      focusSelection: true,
    });
    active.nodeDisplayOptions = { ...displayOptions, showCost: false };
    expect(isFilterActive(active)).toBe(true);

    const reset: FilterState = { ...active, ...neutralFilterPatch() };
    expect(isFilterActive(reset)).toBe(false);
    expect(reset.showPredicates).toBe(false);
    expect(reset.animateEdges).toBe(true);
    expect(reset.scaleEdgeWidth).toBe(false);
    expect(reset.focusSelection).toBe(true);
    expect(reset.nodeDisplayOptions.showCost).toBe(false);
  });

  it('only contains filter fields and returns fresh arrays', () => {
    const a = neutralFilterPatch();
    const b = neutralFilterPatch();
    expect(Object.keys(a).sort()).toEqual([
      'maxActualRows', 'maxActualTime', 'maxCost', 'minActualRows', 'minActualTime',
      'minCardinalityMismatch', 'minCost', 'operationTypes', 'predicateTypes', 'searchText',
    ]);
    expect(a.operationTypes).not.toBe(b.operationTypes);
    expect(a.predicateTypes).not.toBe(b.predicateTypes);
  });
});

describe('cardinality mismatch slider with multiple starts', () => {
  const inner: PlanNode = {
    id: 3, depth: 2, operation: 'INDEX UNIQUE SCAN', children: [],
    rows: 1, starts: 1000, actualRows: 1000, estimatedRowsTotal: 1000,
  };

  it('treats a correct per-start estimate as no mismatch', () => {
    const filters = makeFilters({ minCardinalityMismatch: 3 });
    expect(matchesFilters(inner, filters, true)).toBe(false);
  });

  it('matches when the all-starts estimate is off', () => {
    const filters = makeFilters({ minCardinalityMismatch: 3 });
    expect(matchesFilters({ ...inner, actualRows: 250000 }, filters, true)).toBe(true);
  });

  it('hides nodes without a comparable estimate while the slider is active', () => {
    const filters = makeFilters({ minCardinalityMismatch: 3 });
    expect(matchesFilters({ ...inner, estimatedRowsTotal: undefined, actualRows: 250000 }, filters, true)).toBe(false);
  });
});
