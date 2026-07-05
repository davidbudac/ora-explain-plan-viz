import type { AdvisorRule, Finding, FindingSeverity, RuleContext } from '../types';
import { computeCardinalityRatio, cardinalityRatioSeverity } from '../../format';

export const cardinalityMismatchRule: AdvisorRule = {
  id: 'cardinality-mismatch',
  requiresActualStats: true,

  evaluate(ctx: RuleContext): Finding[] {
    const { maxFindingsPerRule } = ctx.thresholds;

    const candidates: Array<{ nodeId: number; operation: string; eRows: number; aRows: number; deviation: number; severity: FindingSeverity }> = [];

    for (const node of ctx.plan.allNodes) {
      const ratio = computeCardinalityRatio(node.rows, node.actualRows);
      if (ratio === undefined) continue;
      const sev = cardinalityRatioSeverity(ratio);
      if (sev === 'good') continue;

      const deviation = ratio === Infinity ? Infinity : ratio >= 1 ? ratio : 1 / ratio;

      candidates.push({
        nodeId: node.id,
        operation: node.operation,
        eRows: node.rows as number,
        aRows: node.actualRows as number,
        deviation,
        severity: sev === 'bad' ? 'critical' : 'warning',
      });
    }

    candidates.sort((a, b) => b.deviation - a.deviation);

    return candidates.slice(0, maxFindingsPerRule).map((c) => ({
      ruleId: 'cardinality-mismatch',
      severity: c.severity,
      nodeIds: [c.nodeId],
      title: `Cardinality mismatch on ${c.operation}`,
      explanation: `Estimated ${c.eRows.toLocaleString()} rows (E-Rows) but actually produced ${c.aRows.toLocaleString()} rows (A-Rows), a ${c.deviation === Infinity ? '∞' : c.deviation.toFixed(1)}x deviation.`,
      suggestion: 'Gather fresh statistics (including histograms on filtered columns) or consider an SQL profile/plan baseline if the estimate consistently diverges from reality.',
    }));
  },
};
