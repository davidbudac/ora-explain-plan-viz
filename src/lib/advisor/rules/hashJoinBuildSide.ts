import type { PlanNode } from '../../types';
import type { AdvisorRule, Finding, RuleContext } from '../types';
import { formatBytes } from '../../format';
import { liveChildren } from './shared';

function rowsOf(node: PlanNode, useActual: boolean): number | undefined {
  return useActual ? node.actualRows : node.estimatedRowsTotal ?? node.rows;
}

export const hashJoinBuildSideRule: AdvisorRule = {
  id: 'hash-join-build-side',

  evaluate(ctx: RuleContext): Finding[] {
    const findings: Finding[] = [];
    const { hashBuildMinRows, hashBuildProbeRatio, maxFindingsPerRule } = ctx.thresholds;

    for (const node of ctx.plan.allNodes) {
      if (!node.operation.toUpperCase().startsWith('HASH JOIN')) continue;
      const kids = liveChildren(node);
      if (kids.length < 2) continue;
      const [build, probe] = kids;

      // Compare like with like: actuals when both sides have them, otherwise estimates for both.
      const useActual = build.actualRows !== undefined && probe.actualRows !== undefined;
      const buildRows = rowsOf(build, useActual);
      const probeRows = rowsOf(probe, useActual);
      if (buildRows === undefined || probeRows === undefined) continue;
      if (buildRows < hashBuildMinRows || buildRows < hashBuildProbeRatio * Math.max(probeRows, 1)) continue;

      const spills = (node.tempUsed ?? 0) > 0;
      const basis = useActual ? 'A-Rows' : 'estimated';
      findings.push({
        ruleId: 'hash-join-build-side',
        severity: spills ? 'warning' : 'info',
        nodeIds: [node.id],
        title: `Large hash join build side on ${node.operation}`,
        explanation: `The build side (operation ${build.id}, the first child) has ${buildRows.toLocaleString()} rows (${basis}) but the probe side (operation ${probe.id}) only ${probeRows.toLocaleString()}, ${(buildRows / Math.max(probeRows, 1)).toFixed(0)}x fewer. A hash join is cheapest when the smaller input is hashed.${spills ? ` The join also spilled ${formatBytes(node.tempUsed as number)} to temp.` : ''}`,
        suggestion: useActual
          ? 'Try swapping the join inputs (SWAP_JOIN_INPUTS hint) so the smaller side builds the hash table, and check whether the estimates for the two inputs are wrong enough to have made the optimizer choose this order.'
          : 'Check the estimates of both inputs: if they are right, the optimizer may still pick the better order with fresh statistics; otherwise the SWAP_JOIN_INPUTS hint reverses build and probe.',
      });

      if (findings.length >= maxFindingsPerRule) break;
    }

    return findings;
  },
};
