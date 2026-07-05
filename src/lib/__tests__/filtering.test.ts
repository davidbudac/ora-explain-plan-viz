import { describe, it, expect } from 'vitest';
import { hasActiveFilters } from '../filtering';
import type { FilterState, NodeDisplayOptions } from '../types';

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
