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
