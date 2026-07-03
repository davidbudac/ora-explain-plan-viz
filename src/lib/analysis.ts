import type { ParsedPlan, PlanNode } from './types';

/** Depth-first walk over a plan tree (parent before children). */
export function walkPlanTree(root: PlanNode, visit: (node: PlanNode) => void): void {
  visit(root);
  for (const child of root.children) {
    walkPlanTree(child, visit);
  }
}

/**
 * Derive per-operation self time from A-Time and normalize A-Time semantics
 * across sources. Runs once per parse, in place.
 *
 * Oracle reports A-Time cumulatively (a parent's time includes its children),
 * which makes "sort by A-Time" surface one hot leaf plus its entire ancestor
 * chain. Self time (own work only) is what hotspot ranking needs.
 *
 * - Cumulative sources (dbms_xplan, sql_monitor, json):
 *   selfTime = max(0, actualTime − Σ children.actualTime). The clamp absorbs
 *   parallel-execution and rounding artifacts where children exceed the parent.
 * - XBI: the parser stores SELF elapsed time in actualTime for every row
 *   EXCEPT the root, whose ">>> Plan totals >>>" row already carries the plan
 *   total (children's self times sum to it). Non-root actualTime is rolled up
 *   bottom-up to cumulative (matching the other sources), the root is derived
 *   like a cumulative source, and activityPercent is recomputed from self time.
 */
export function computeSelfTimes(plan: ParsedPlan): void {
  if (!plan.rootNode) return;

  if (plan.source === 'xbi') {
    const root = plan.rootNode;
    // Post-order roll-up of non-root subtrees: children first, then parent.
    const rollUp = (node: PlanNode): void => {
      for (const child of node.children) rollUp(child);
      node.selfTime = node.actualTime;
      const childSum = node.children.reduce(
        (sum, child) => sum + (child.actualTime ?? 0), 0);
      if (node.actualTime !== undefined || node.children.some((c) => c.actualTime !== undefined)) {
        node.actualTime = (node.selfTime ?? 0) + childSum;
      }
    };
    for (const child of root.children) rollUp(child);

    // Root row is ">>> Plan totals >>>": its ms is the plan total (cumulative).
    const rootChildSum = root.children.reduce(
      (sum, child) => sum + (child.actualTime ?? 0), 0);
    if (root.actualTime === undefined && root.children.some((c) => c.actualTime !== undefined)) {
      root.actualTime = rootChildSum;
    }
    root.selfTime = root.actualTime !== undefined
      ? Math.max(0, root.actualTime - rootChildSum)
      : undefined;

    plan.totalElapsedTime = root.actualTime;
    const total = plan.totalElapsedTime;
    if (total && total > 0) {
      for (const node of plan.allNodes) {
        if (node.selfTime !== undefined && node.parentId !== undefined) {
          node.activityPercent = (node.selfTime / total) * 100;
        }
      }
    }
  } else {
    for (const node of plan.allNodes) {
      if (node.actualTime === undefined) {
        node.selfTime = undefined;
        continue;
      }
      const childSum = node.children.reduce(
        (sum, child) => sum + (child.actualTime ?? 0), 0);
      node.selfTime = Math.max(0, node.actualTime - childSum);
    }
  }

  plan.maxSelfTime = Math.max(0, ...plan.allNodes.map((n) => n.selfTime ?? 0));
}

/**
 * The node deserving the "hotspot" ring: highest self time (falling back to
 * cumulative A-Time for nodes without derived self time), excluding root
 * statement nodes. Returns null when the plan has no actual statistics.
 */
export function computeHottestNodeId(plan: ParsedPlan | null): number | null {
  if (!plan?.hasActualStats) return null;

  let hottestId: number | null = null;
  let hottestTime = 0;
  for (const node of plan.allNodes) {
    if (node.parentId === undefined) continue; // skip root statement nodes
    const time = node.selfTime ?? node.actualTime;
    if (time !== undefined && time > hottestTime) {
      hottestTime = time;
      hottestId = node.id;
    }
  }
  return hottestId;
}
