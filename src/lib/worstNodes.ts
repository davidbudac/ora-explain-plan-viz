import type { ParsedPlan, PlanNode } from './types';
import { rankNodesByTime, usesActivityRanking } from './analysis';

export interface WorstNodes {
  /** Top operations by own (self) cost, highest first. */
  byCost: PlanNode[];
  /** Top operations by time, highest first. */
  byTime: PlanNode[];
  /** What `byTime` was ranked by: ASH activity share (SQL Monitor) or self time. */
  timeBy: 'activity' | 'time';
}

const WORST_COUNT = 5;

/**
 * The overview's "Highest Cost" / "Slowest Ops" lists. Cost ranks by SELF cost
 * (cumulative cost would surface a hot leaf plus its whole ancestor chain);
 * time uses `rankNodesByTime`, which prefers ASH activity for SQL Monitor plans.
 */
export function computeWorstNodes(plan: ParsedPlan | null): WorstNodes {
  if (!plan) return { byCost: [], byTime: [], timeBy: 'time' };

  const byCost = plan.allNodes
    .filter((n) => n.parentId !== undefined && n.selfCost !== undefined)
    .sort((a, b) => (b.selfCost ?? 0) - (a.selfCost ?? 0))
    .slice(0, WORST_COUNT);

  const byTime = plan.hasActualStats ? rankNodesByTime(plan).slice(0, WORST_COUNT) : [];
  const timeBy = usesActivityRanking(plan) ? 'activity' : 'time';

  return { byCost, byTime, timeBy };
}
