import type { ParsedPlan, PlanNode } from './types';

export interface PlanSlot {
  id: string;              // 'plan-0' | 'plan-1'
  label: string;           // 'Plan A' | 'Plan B'
  rawInput: string;
  parsedPlan: ParsedPlan | null;
  error: string | null;
  selectedNodeId: number | null;
  selectedNodeIds: number[];
}

export type CompareMetric = 'cost' | 'rows' | 'bytes' | 'actualRows' | 'actualTime' | 'starts' | 'tempSpace' | 'memoryUsed';

export type MatchType = 'exact-id' | 'heuristic' | 'unmatched';

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

function getNodeSignature(node: PlanNode): string {
  return `${node.operation.toUpperCase()}|${(node.objectName ?? '').toUpperCase()}`;
}

function operationsSimilar(a: PlanNode, b: PlanNode): boolean {
  if (a.operation.toUpperCase() === b.operation.toUpperCase()) return true;
  const firstWordA = a.operation.split(' ')[0].toUpperCase();
  const firstWordB = b.operation.split(' ')[0].toUpperCase();
  return firstWordA === firstWordB;
}

export function matchNodes(planA: ParsedPlan, planB: ParsedPlan): NodeMatch[] {
  const matches: NodeMatch[] = [];
  const matchedAIds = new Set<number>();
  const matchedBIds = new Set<number>();

  const bNodesById = new Map(planB.allNodes.map(n => [n.id, n]));

  // Pass 1: Exact ID match with operation similarity check
  for (const aNode of planA.allNodes) {
    const bNode = bNodesById.get(aNode.id);
    if (bNode && !matchedBIds.has(bNode.id) && operationsSimilar(aNode, bNode)) {
      matches.push({ matchType: 'exact-id', planANode: aNode, planBNode: bNode });
      matchedAIds.add(aNode.id);
      matchedBIds.add(bNode.id);
    }
  }

  // Pass 2: Heuristic match for remaining nodes by operation+object signature
  const unmatchedB = planB.allNodes.filter(n => !matchedBIds.has(n.id));
  const sigMapB = new Map<string, PlanNode[]>();
  for (const bNode of unmatchedB) {
    const sig = getNodeSignature(bNode);
    const list = sigMapB.get(sig) ?? [];
    list.push(bNode);
    sigMapB.set(sig, list);
  }

  for (const aNode of planA.allNodes) {
    if (matchedAIds.has(aNode.id)) continue;
    const sig = getNodeSignature(aNode);
    const candidates = sigMapB.get(sig);
    if (!candidates || candidates.length === 0) continue;

    // Pick candidate with closest depth
    let bestIdx = 0;
    let bestDist = Math.abs(candidates[0].depth - aNode.depth);
    for (let i = 1; i < candidates.length; i++) {
      const dist = Math.abs(candidates[i].depth - aNode.depth);
      if (dist < bestDist) {
        bestDist = dist;
        bestIdx = i;
      }
    }

    const bestMatch = candidates[bestIdx];
    matches.push({ matchType: 'heuristic', planANode: aNode, planBNode: bestMatch });
    matchedAIds.add(aNode.id);
    matchedBIds.add(bestMatch.id);
    candidates.splice(bestIdx, 1);
  }

  // Pass 3: Unmatched nodes
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

  // Sort: exact-id first (by Plan A id), then heuristic, then unmatched
  matches.sort((a, b) => {
    const typeOrder: Record<MatchType, number> = { 'exact-id': 0, 'heuristic': 1, 'unmatched': 2 };
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
    case 'starts': return 'Starts';
    case 'tempSpace': return 'Temp Space';
    case 'memoryUsed': return 'Memory';
  }
}

export const ALL_COMPARE_METRICS: CompareMetric[] = [
  'cost', 'rows', 'bytes', 'actualRows', 'actualTime', 'starts', 'tempSpace', 'memoryUsed',
];

export const DEFAULT_COMPARE_METRICS: CompareMetric[] = ['cost', 'actualRows', 'actualTime'];

export function createEmptySlot(index: number): PlanSlot {
  return {
    id: `plan-${index}`,
    label: index === 0 ? 'Plan A' : 'Plan B',
    rawInput: '',
    parsedPlan: null,
    error: null,
    selectedNodeId: null,
    selectedNodeIds: [],
  };
}
