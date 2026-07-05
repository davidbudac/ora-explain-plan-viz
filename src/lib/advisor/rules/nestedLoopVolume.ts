import type { AdvisorRule, Finding, RuleContext } from '../types';

export const nestedLoopVolumeRule: AdvisorRule = {
  id: 'nested-loop-volume',
  requiresActualStats: true,

  evaluate(ctx: RuleContext): Finding[] {
    const findings: Finding[] = [];
    const { nlStartsWarn, nlStartsCritical, nlInnerRowsWarn, nlInnerRowsCritical, maxFindingsPerRule } = ctx.thresholds;

    for (const node of ctx.plan.allNodes) {
      if (!node.operation.toUpperCase().startsWith('NESTED LOOPS')) continue;
      if (node.children.length < 2) continue;

      const outer = node.children[0];
      const inner = node.children[1];
      const probes = inner.starts ?? outer.actualRows;
      const volume = inner.actualRows;

      if (probes === undefined || volume === undefined) continue;

      const isWarn = probes >= nlStartsWarn && volume >= nlInnerRowsWarn;
      if (!isWarn) continue;

      const isCritical = probes >= nlStartsCritical && volume >= nlInnerRowsCritical;

      findings.push({
        ruleId: 'nested-loop-volume',
        severity: isCritical ? 'critical' : 'warning',
        nodeIds: [node.id],
        title: `High-volume nested loop on ${node.operation}`,
        explanation: `The inner row source was probed ${probes.toLocaleString()} times and produced ${volume.toLocaleString()} total rows (A-Rows is cumulative across all probes).`,
        suggestion: 'Consider whether a hash join would perform fewer total logical reads than repeatedly probing the inner row source at this volume.',
      });

      if (findings.length >= maxFindingsPerRule) break;
    }

    return findings;
  },
};
