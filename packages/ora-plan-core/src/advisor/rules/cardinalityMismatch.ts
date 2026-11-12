import type { PlanNode } from '../../types.ts';
import type { AdvisorRule, Finding, FindingSeverity, RuleContext } from '../types.ts';
import { nodeCardinalityRatio, cardinalityRatioSeverity, effectiveExecutions } from '../../format.ts';
import { effectiveChildren } from '../../analysis.ts';

/** "Estimated 5 rows per execution × 167 executions = 835 rows": the arithmetic behind `estimatedRowsTotal`. */
function describeEstimate(node: PlanNode): string {
  const total = node.estimatedRowsTotal as number;
  const executions = effectiveExecutions(node);
  if (executions !== undefined && node.rows !== undefined) {
    const unit = node.rows === 1 ? 'row' : 'rows';
    const times = Number.isInteger(executions) ? executions.toLocaleString() : executions.toFixed(1);
    return `Estimated ${node.rows.toLocaleString()} ${unit} per execution × ${times} executions = ${total.toLocaleString()} rows`;
  }
  return `Estimated ${total.toLocaleString()} rows (E-Rows)`;
}

export const cardinalityMismatchRule: AdvisorRule = {
  id: 'cardinality-mismatch',
  requiresActualStats: true,

  evaluate(ctx: RuleContext): Finding[] {
    const { maxFindingsPerRule, cardinalityMinRowDelta } = ctx.thresholds;

    /** Deviation (>= 1) and severity when the estimate is materially off, else undefined. */
    const assess = (node: PlanNode): { deviation: number; severity: FindingSeverity } | undefined => {
      const ratio = nodeCardinalityRatio(node);
      if (ratio === undefined) return undefined;
      const eRowsTotal = node.estimatedRowsTotal as number;
      const aRows = node.actualRows as number;
      // Tiny absolute differences (5 estimated vs 60 actual) are ratio noise, not a problem.
      if (Math.abs(aRows - eRowsTotal) < cardinalityMinRowDelta) return undefined;
      const sev = cardinalityRatioSeverity(ratio);
      if (sev === 'good') return undefined;
      return { deviation: ratio >= 1 ? ratio : 1 / ratio, severity: sev === 'bad' ? 'critical' : 'warning' };
    };

    const off = new Map<PlanNode, ReturnType<typeof assess>>();
    for (const node of ctx.plan.allNodes) off.set(node, assess(node));

    // A node whose own estimate is wrong because a child's was (the error just flows upward)
    // is not a separate problem. Operations without a comparable estimate (never started,
    // cut off early) don't break the chain: look through them to their children.
    const inputsOff = (node: PlanNode): boolean =>
      effectiveChildren(node).some((child) => {
        if (off.get(child) !== undefined) return true;
        return nodeCardinalityRatio(child) === undefined && inputsOff(child);
      });

    // Nearest active ancestor of each active node: inactive adaptive-plan rows in between are skipped
    // (ctx.plan.allNodes may not contain them, so parentId cannot be followed).
    const activeParentOf = new Map<PlanNode, PlanNode>();
    for (const n of ctx.plan.allNodes) {
      if (n.inactive) continue;
      for (const child of effectiveChildren(n)) activeParentOf.set(child, n);
    }
    const inheritingAncestors = (node: PlanNode): number => {
      let count = 0;
      let parent = activeParentOf.get(node);
      while (parent) {
        if (off.get(parent) !== undefined) count++;
        else if (nodeCardinalityRatio(parent) !== undefined) break; // estimate was right again: error absorbed
        parent = activeParentOf.get(parent);
      }
      return count;
    };

    const candidates: Array<{ node: PlanNode; deviation: number; severity: FindingSeverity; inherited: number }> = [];
    for (const node of ctx.plan.allNodes) {
      const verdict = off.get(node);
      if (!verdict) continue;
      if (inputsOff(node)) continue;
      candidates.push({ node, ...verdict, inherited: inheritingAncestors(node) });
    }

    candidates.sort((a, b) => b.deviation - a.deviation);

    return candidates.slice(0, maxFindingsPerRule).map((c) => {
      const { node } = c;
      const inheritNote = c.inherited > 0
        ? ` The estimates of ${c.inherited} operation${c.inherited === 1 ? '' : 's'} above it are off because of this error.`
        : '';
      const root = effectiveChildren(node).length === 0 ? '' : ' Its inputs were estimated accurately, so the error originates here.';
      return {
        ruleId: 'cardinality-mismatch',
        severity: c.severity,
        nodeIds: [node.id],
        title: `Cardinality mismatch on ${node.operation}`,
        explanation: `${describeEstimate(node)} but actually produced ${(node.actualRows as number).toLocaleString()} rows (A-Rows), a ${c.deviation.toFixed(1)}x deviation.${root}${inheritNote}`,
        suggestion: 'Gather fresh statistics (including histograms on filtered columns) or consider an SQL profile/plan baseline if the estimate consistently diverges from reality.',
      };
    });
  },
};
