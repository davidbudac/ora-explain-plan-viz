import type { AdvisorRule, Finding, FindingSeverity, RuleContext } from '../types';
import { nodeCardinalityRatio, cardinalityRatioSeverity } from '../../format';

function describeEstimate(c: { eRowsPerStart?: number; starts?: number; eRowsTotal: number }): string {
  if (c.starts !== undefined && c.starts > 1 && c.eRowsPerStart !== undefined && c.eRowsPerStart !== c.eRowsTotal) {
    const unit = c.eRowsPerStart === 1 ? 'row' : 'rows';
    return `Estimated ${c.eRowsPerStart.toLocaleString()} ${unit} per start × ${c.starts.toLocaleString()} starts = ${c.eRowsTotal.toLocaleString()} rows`;
  }
  return `Estimated ${c.eRowsTotal.toLocaleString()} rows (E-Rows)`;
}

export const cardinalityMismatchRule: AdvisorRule = {
  id: 'cardinality-mismatch',
  requiresActualStats: true,

  evaluate(ctx: RuleContext): Finding[] {
    const { maxFindingsPerRule, cardinalityMinRowDelta } = ctx.thresholds;

    const candidates: Array<{ nodeId: number; operation: string; eRowsPerStart?: number; starts?: number; eRowsTotal: number; aRows: number; deviation: number; severity: FindingSeverity }> = [];

    for (const node of ctx.plan.allNodes) {
      const ratio = nodeCardinalityRatio(node);
      if (ratio === undefined) continue;
      const eRowsTotal = node.estimatedRowsTotal as number;
      const aRows = node.actualRows as number;
      // Tiny absolute differences (5 estimated vs 60 actual) are ratio noise, not a problem.
      if (Math.abs(aRows - eRowsTotal) < cardinalityMinRowDelta) continue;
      const sev = cardinalityRatioSeverity(ratio);
      if (sev === 'good') continue;

      const deviation = ratio >= 1 ? ratio : 1 / ratio;

      candidates.push({
        nodeId: node.id,
        operation: node.operation,
        eRowsPerStart: node.rows,
        starts: node.starts,
        eRowsTotal,
        aRows,
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
      explanation: `${describeEstimate(c)} but actually produced ${c.aRows.toLocaleString()} rows (A-Rows), a ${c.deviation.toFixed(1)}x deviation.`,
      suggestion: 'Gather fresh statistics (including histograms on filtered columns) or consider an SQL profile/plan baseline if the estimate consistently diverges from reality.',
    }));
  },
};
