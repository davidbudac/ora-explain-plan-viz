import type { PlanNode } from '../../types';
import type { AdvisorRule, Finding, RuleContext } from '../types';

function rowsOf(node: PlanNode): number | undefined {
  return node.actualRows ?? node.rows;
}

export const mergeJoinCartesianRule: AdvisorRule = {
  id: 'merge-join-cartesian',

  evaluate(ctx: RuleContext): Finding[] {
    const findings: Finding[] = [];
    const { cartesianMinSideRows, cartesianCriticalProduct, maxFindingsPerRule } = ctx.thresholds;

    for (const node of ctx.plan.allNodes) {
      if (!node.operation.toUpperCase().includes('MERGE JOIN CARTESIAN')) continue;
      if (node.children.length !== 2) continue;

      const leftRows = rowsOf(node.children[0]);
      const rightRows = rowsOf(node.children[1]);
      if (leftRows === undefined || rightRows === undefined) continue;
      if (leftRows <= cartesianMinSideRows || rightRows <= cartesianMinSideRows) continue;

      const product = leftRows * rightRows;
      const isCritical = product > cartesianCriticalProduct;

      findings.push({
        ruleId: 'merge-join-cartesian',
        severity: isCritical ? 'critical' : 'warning',
        nodeIds: [node.id],
        title: `Cartesian product on ${node.operation}`,
        explanation: `A Cartesian join combines ${leftRows.toLocaleString()} rows with ${rightRows.toLocaleString()} rows, producing up to ${product.toLocaleString()} rows with no join condition linking the two sides.`,
        suggestion: 'Check for a missing join predicate between these two row sources, or confirm the Cartesian product is intentional.',
      });

      if (findings.length >= maxFindingsPerRule) break;
    }

    return findings;
  },
};
