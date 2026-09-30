import type { FilterState, PlanNode, PredicateType } from './types';
import { computeCardinalityRatio } from './format';

export function matchesSearch(node: PlanNode, searchText: string): boolean {
  const searchLower = searchText.trim().toLowerCase();
  if (!searchLower) return true;

  const matchesOperation = node.operation.toLowerCase().includes(searchLower);
  const matchesObject = node.objectName?.toLowerCase().includes(searchLower);
  const matchesPredicates =
    node.accessPredicates?.toLowerCase().includes(searchLower) ||
    node.filterPredicates?.toLowerCase().includes(searchLower);

  return !!(matchesOperation || matchesObject || matchesPredicates);
}

export function matchesPredicateTypes(node: PlanNode, predicateTypes: PredicateType[]): boolean {
  if (predicateTypes.length === 0) return true;

  const hasAccess = !!node.accessPredicates;
  const hasFilter = !!node.filterPredicates;
  const hasNone = !hasAccess && !hasFilter;

  return predicateTypes.some((type) => {
    if (type === 'access') return hasAccess;
    if (type === 'filter') return hasFilter;
    if (type === 'none') return hasNone;
    return false;
  });
}

export function matchesOperationTypes(node: PlanNode, operationTypes: string[]): boolean {
  if (operationTypes.length === 0) return true;
  return operationTypes.some((type) => node.operation.toUpperCase().includes(type.toUpperCase()));
}

/**
 * True when any node-hiding filter differs from its default (i.e. the filter
 * panel is actually narrowing the visible plan). Display-only options
 * (nodeDisplayOptions, edge behavior flags) are ignored.
 */
export function hasActiveFilters(filters: FilterState): boolean {
  return (
    filters.searchText.trim() !== '' ||
    filters.operationTypes.length > 0 ||
    filters.predicateTypes.length > 0 ||
    filters.minCost > 0 ||
    filters.maxCost !== Infinity ||
    filters.minActualRows > 0 ||
    filters.maxActualRows !== Infinity ||
    filters.minActualTime > 0 ||
    filters.maxActualTime !== Infinity ||
    filters.minCardinalityMismatch > 0
  );
}

export function matchesFilters(
  node: PlanNode,
  filters: FilterState,
  hasActualStats: boolean
): boolean {
  const {
    operationTypes,
    minCost,
    maxCost,
    searchText,
    predicateTypes,
    minActualRows,
    maxActualRows,
    minActualTime,
    maxActualTime,
    minCardinalityMismatch,
  } = filters;

  if (!matchesOperationTypes(node, operationTypes)) return false;

  const nodeCost = node.cost || 0;
  if (nodeCost < minCost || nodeCost > maxCost) return false;

  if (hasActualStats && node.actualRows !== undefined) {
    if (node.actualRows < minActualRows || node.actualRows > maxActualRows) return false;
  }

  if (hasActualStats && node.actualTime !== undefined) {
    if (node.actualTime < minActualTime || node.actualTime > maxActualTime) return false;
  }

  // Cardinality mismatch filter
  if (hasActualStats && minCardinalityMismatch > 0) {
    const ratio = computeCardinalityRatio(node.rows, node.actualRows);
    if (ratio !== undefined) {
      const deviation = ratio >= 1 ? ratio : 1 / ratio;
      if (deviation < minCardinalityMismatch) return false;
    } else {
      // No ratio available — hide if filter is active
      return false;
    }
  }

  if (!matchesPredicateTypes(node, predicateTypes)) return false;

  if (!matchesSearch(node, searchText)) return false;

  return true;
}

/**
 * The node-narrowing fields of {@link FilterState} — everything "Reset filters"
 * clears. Display-only fields (showPredicates, animateEdges, scaleEdgeWidth,
 * focusSelection, nodeDisplayOptions) are deliberately absent.
 */
export type FilterFieldKey =
  | 'searchText'
  | 'operationTypes'
  | 'predicateTypes'
  | 'minCost'
  | 'maxCost'
  | 'minActualRows'
  | 'maxActualRows'
  | 'minActualTime'
  | 'maxActualTime'
  | 'minCardinalityMismatch';

/**
 * A `setFilters` patch that returns every node-narrowing filter to its neutral
 * value while leaving display settings untouched (same field set as the Filter
 * panel's "Reset filters"). Returns fresh arrays on every call.
 */
export function neutralFilterPatch(): Pick<FilterState, FilterFieldKey> {
  return {
    searchText: '',
    operationTypes: [],
    predicateTypes: [],
    minCost: 0,
    maxCost: Infinity,
    minActualRows: 0,
    maxActualRows: Infinity,
    minActualTime: 0,
    maxActualTime: Infinity,
    minCardinalityMismatch: 0,
  };
}

/**
 * True when any node-narrowing filter differs from its neutral value (see
 * {@link neutralFilterPatch}); display-only fields never count. When this is
 * false, {@link matchesFilters} accepts every node, so callers can use it to
 * tell "no filter" apart from "a filter that matches nothing" — an empty
 * `filteredNodeIds` set only means the latter when this returns true.
 */
export function isFilterActive(filters: FilterState): boolean {
  return hasActiveFilters(filters);
}
