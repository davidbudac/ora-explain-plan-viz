import type { ParsedPlan, PlanNode } from './types';
import type { AnnotationState } from './annotations';
import type { MetadataBundle } from './metadata/bundle';
import { createEmptyAnnotationState } from './annotations';

export interface PlanSlot {
  id: string;
  label: string;
  customLabel?: string;
  /** Source text of the currently loaded plan (only changes on a successful load). */
  rawInput: string;
  /**
   * What the user is editing in the input drawer. Absent means "same as
   * rawInput" (a freshly loaded plan); Parse reads this, not rawInput.
   */
  draftInput?: string;
  parsedPlan: ParsedPlan | null;
  error: string | null;
  selectedNodeId: number | null;
  selectedNodeIds: number[];
  annotations: AnnotationState;
  metadataBundle: MetadataBundle | null;
  metadataBundleWarning: string | null;
}

export type CompareMetric = 'cost' | 'rows' | 'bytes' | 'actualRows' | 'actualTime' | 'selfTime' | 'starts' | 'tempSpace' | 'memoryUsed';

export type MatchType = 'exact-id' | 'heuristic' | 'access-changed' | 'unmatched';

export interface NodeMatch {
  matchType: MatchType;
  planANode: PlanNode | null;
  planBNode: PlanNode | null;
}

export interface ComparisonSummary {
  totalCostA: number;
  totalCostB: number;
  costDelta: number;
  costDeltaPercent: number;
  totalElapsedTimeA?: number;
  totalElapsedTimeB?: number;
  timeDelta?: number;
  timeDeltaPercent?: number;
  matchedCount: number;
  unmatchedACount: number;
  unmatchedBCount: number;
}

function normalizeOperation(node: PlanNode): string {
  return node.operation.toUpperCase().replace(/\s+/g, ' ').trim();
}

function normalizeObject(node: PlanNode): string {
  return (node.objectName ?? '').toUpperCase();
}

function normalizeAlias(node: PlanNode): string {
  return (node.objectAlias ?? '').toUpperCase();
}

function getNodeSignature(node: PlanNode): string {
  return `${normalizeOperation(node)}|${normalizeObject(node)}`;
}

/** 0 when both nodes carry the same alias (e.g. E@SEL$1), 1 otherwise. */
function aliasPenalty(a: PlanNode, b: PlanNode): number {
  const aliasA = normalizeAlias(a);
  return aliasA !== '' && aliasA === normalizeAlias(b) ? 0 : 1;
}

/**
 * Same object, different operation: aliases must be equal when both nodes have
 * one, otherwise fall back to the object name. Nodes without an object never match.
 */
function sameObject(a: PlanNode, b: PlanNode): boolean {
  const aliasA = normalizeAlias(a);
  const aliasB = normalizeAlias(b);
  if (aliasA !== '' && aliasB !== '') return aliasA === aliasB;
  const objectA = normalizeObject(a);
  return objectA !== '' && objectA === normalizeObject(b);
}

function rankLess(a: number[], b: number[]): boolean {
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return a[i] < b[i];
  }
  return false;
}

/** Index of the candidate with the lowest rank tuple (lexicographic); first wins ties. */
function pickBest(candidates: PlanNode[], rank: (candidate: PlanNode) => number[]): number {
  let bestIdx = 0;
  let bestRank = rank(candidates[0]);
  for (let i = 1; i < candidates.length; i++) {
    const r = rank(candidates[i]);
    if (rankLess(r, bestRank)) {
      bestIdx = i;
      bestRank = r;
    }
  }
  return bestIdx;
}

export function matchNodes(planA: ParsedPlan, planB: ParsedPlan): NodeMatch[] {
  const matches: NodeMatch[] = [];
  const matchedAIds = new Set<number>();
  const matchedBIds = new Set<number>();

  const bNodesById = new Map(planB.allNodes.map(n => [n.id, n]));

  // Pass 1: same id AND same operation AND same object
  for (const aNode of planA.allNodes) {
    const bNode = bNodesById.get(aNode.id);
    if (bNode && !matchedBIds.has(bNode.id) && getNodeSignature(aNode) === getNodeSignature(bNode)) {
      matches.push({ matchType: 'exact-id', planANode: aNode, planBNode: bNode });
      matchedAIds.add(aNode.id);
      matchedBIds.add(bNode.id);
    }
  }

  // Pass 2: heuristic match by operation+object signature (alias, then closest depth)
  const sigMapB = new Map<string, PlanNode[]>();
  for (const bNode of planB.allNodes) {
    if (matchedBIds.has(bNode.id)) continue;
    const sig = getNodeSignature(bNode);
    const list = sigMapB.get(sig) ?? [];
    list.push(bNode);
    sigMapB.set(sig, list);
  }

  for (const aNode of planA.allNodes) {
    if (matchedAIds.has(aNode.id)) continue;
    const candidates = sigMapB.get(getNodeSignature(aNode));
    if (!candidates || candidates.length === 0) continue;

    const bestIdx = pickBest(candidates, c => [aliasPenalty(aNode, c), Math.abs(c.depth - aNode.depth)]);
    const bestMatch = candidates[bestIdx];
    matches.push({ matchType: 'heuristic', planANode: aNode, planBNode: bestMatch });
    matchedAIds.add(aNode.id);
    matchedBIds.add(bestMatch.id);
    candidates.splice(bestIdx, 1);
  }

  // Pass 3: same object, changed operation (e.g. FULL scan -> INDEX access)
  const remainingB = planB.allNodes.filter(n => !matchedBIds.has(n.id));
  for (const aNode of planA.allNodes) {
    if (matchedAIds.has(aNode.id)) continue;
    const candidates = remainingB.filter(b => !matchedBIds.has(b.id) && sameObject(aNode, b));
    if (candidates.length === 0) continue;

    // Prefer the same object name (an alias is shared by a table and its index), then closest depth
    const bestIdx = pickBest(candidates, c => [
      normalizeObject(c) === normalizeObject(aNode) ? 0 : 1,
      Math.abs(c.depth - aNode.depth),
    ]);
    const bestMatch = candidates[bestIdx];
    matches.push({ matchType: 'access-changed', planANode: aNode, planBNode: bestMatch });
    matchedAIds.add(aNode.id);
    matchedBIds.add(bestMatch.id);
  }

  // Unmatched nodes
  for (const aNode of planA.allNodes) {
    if (!matchedAIds.has(aNode.id)) {
      matches.push({ matchType: 'unmatched', planANode: aNode, planBNode: null });
    }
  }
  for (const bNode of planB.allNodes) {
    if (!matchedBIds.has(bNode.id)) {
      matches.push({ matchType: 'unmatched', planANode: null, planBNode: bNode });
    }
  }

  // Sort: exact-id first (by Plan A id), then heuristic, access-changed, then unmatched
  const typeOrder: Record<MatchType, number> = { 'exact-id': 0, 'heuristic': 1, 'access-changed': 2, 'unmatched': 3 };
  matches.sort((a, b) => {
    const typeA = typeOrder[a.matchType];
    const typeB = typeOrder[b.matchType];
    if (typeA !== typeB) return typeA - typeB;
    const idA = a.planANode?.id ?? a.planBNode?.id ?? 0;
    const idB = b.planANode?.id ?? b.planBNode?.id ?? 0;
    return idA - idB;
  });

  return matches;
}

export function computeComparisonSummary(
  planA: ParsedPlan,
  planB: ParsedPlan,
  matches: NodeMatch[]
): ComparisonSummary {
  const totalCostA = planA.totalCost;
  const totalCostB = planB.totalCost;
  const costDelta = totalCostB - totalCostA;
  const costDeltaPercent = totalCostA > 0 ? (costDelta / totalCostA) * 100 : 0;

  const totalElapsedTimeA = planA.totalElapsedTime;
  const totalElapsedTimeB = planB.totalElapsedTime;
  let timeDelta: number | undefined;
  let timeDeltaPercent: number | undefined;
  if (totalElapsedTimeA !== undefined && totalElapsedTimeB !== undefined) {
    timeDelta = totalElapsedTimeB - totalElapsedTimeA;
    timeDeltaPercent = totalElapsedTimeA > 0 ? (timeDelta / totalElapsedTimeA) * 100 : 0;
  }

  let matchedCount = 0;
  let unmatchedACount = 0;
  let unmatchedBCount = 0;
  for (const match of matches) {
    if (match.matchType !== 'unmatched') {
      matchedCount++;
    } else if (match.planANode && !match.planBNode) {
      unmatchedACount++;
    } else {
      unmatchedBCount++;
    }
  }

  return {
    totalCostA,
    totalCostB,
    costDelta,
    costDeltaPercent,
    totalElapsedTimeA,
    totalElapsedTimeB,
    timeDelta,
    timeDeltaPercent,
    matchedCount,
    unmatchedACount,
    unmatchedBCount,
  };
}

export function getNodeMetricValue(node: PlanNode, metric: CompareMetric): number | undefined {
  switch (metric) {
    case 'cost': return node.cost;
    case 'rows': return node.rows;
    case 'bytes': return node.bytes;
    case 'actualRows': return node.actualRows;
    case 'actualTime': return node.actualTime;
    case 'selfTime': return node.selfTime;
    case 'starts': return node.starts;
    case 'tempSpace': return node.tempUsed ?? node.tempSpace;
    case 'memoryUsed': return node.memoryUsed;
  }
}

export function getMetricLabel(metric: CompareMetric): string {
  switch (metric) {
    case 'cost': return 'Cost';
    case 'rows': return 'E-Rows';
    case 'bytes': return 'Bytes';
    case 'actualRows': return 'A-Rows';
    case 'actualTime': return 'A-Time';
    case 'selfTime': return 'Self Time';
    case 'starts': return 'Starts';
    case 'tempSpace': return 'Temp Space';
    case 'memoryUsed': return 'Memory';
  }
}

export const ALL_COMPARE_METRICS: CompareMetric[] = [
  'cost', 'rows', 'bytes', 'actualRows', 'actualTime', 'selfTime', 'starts', 'tempSpace', 'memoryUsed',
];

/** Metrics where a negative B−A delta is an improvement. */
export const LOWER_IS_BETTER: ReadonlySet<CompareMetric> = new Set([
  'cost', 'actualTime', 'selfTime', 'tempSpace', 'memoryUsed',
]);

export interface MetricDelta {
  valueA?: number;
  valueB?: number;
  delta?: number;          // B − A, only when both values are defined
  deltaPercent?: number;   // only when both defined and valueA > 0
  changed: boolean;        // covers one-sided values (present in only one plan)
}

export interface ComparisonRow {
  match: NodeMatch;
  /** Stable across sorting/filtering: matchType + both node ids. */
  key: string;
  deltas: Partial<Record<CompareMetric, MetricDelta>>;
  /** Position in the original match order — stable-sort tiebreak. */
  originalIndex: number;
}

function computeMetricDelta(
  nodeA: PlanNode | null,
  nodeB: PlanNode | null,
  metric: CompareMetric
): MetricDelta {
  const valueA = nodeA ? getNodeMetricValue(nodeA, metric) : undefined;
  const valueB = nodeB ? getNodeMetricValue(nodeB, metric) : undefined;
  const bothDefined = valueA !== undefined && valueB !== undefined;
  return {
    valueA,
    valueB,
    delta: bothDefined ? valueB - valueA : undefined,
    deltaPercent: bothDefined && valueA > 0 ? ((valueB - valueA) / valueA) * 100 : undefined,
    changed: (valueA ?? null) !== (valueB ?? null),
  };
}

/** Precompute deltas for ALL metrics per match — cheap, and the expanded row detail needs them. */
export function buildComparisonRows(matches: NodeMatch[]): ComparisonRow[] {
  return matches.map((match, originalIndex) => {
    const deltas: Partial<Record<CompareMetric, MetricDelta>> = {};
    for (const metric of ALL_COMPARE_METRICS) {
      deltas[metric] = computeMetricDelta(match.planANode, match.planBNode, metric);
    }
    return {
      match,
      key: `${match.matchType}:${match.planANode?.id ?? '-'}:${match.planBNode?.id ?? '-'}`,
      deltas,
      originalIndex,
    };
  });
}

/** True when the row differs in any of the visible metrics. Unmatched rows always count as changed. */
export function rowHasVisibleChange(row: ComparisonRow, visible: CompareMetric[]): boolean {
  if (row.match.matchType === 'unmatched') return true;
  return visible.some((metric) => row.deltas[metric]?.changed);
}

export const DEFAULT_COMPARE_METRICS: CompareMetric[] = ['cost', 'actualRows', 'actualTime'];

function getAlphaLabel(index: number): string {
  let label = '';
  let value = index;

  do {
    label = String.fromCharCode(65 + (value % 26)) + label;
    value = Math.floor(value / 26) - 1;
  } while (value >= 0);

  return label;
}

export function getPlanSlotLabel(index: number): string {
  return `Plan ${getAlphaLabel(index)}`;
}

export function createEmptySlot(index: number): PlanSlot {
  return {
    id: `plan-${index}`,
    label: getPlanSlotLabel(index),
    rawInput: '',
    parsedPlan: null,
    error: null,
    selectedNodeId: null,
    selectedNodeIds: [],
    annotations: createEmptyAnnotationState(),
    metadataBundle: null,
    metadataBundleWarning: null,
  };
}
