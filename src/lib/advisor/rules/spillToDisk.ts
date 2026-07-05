import type { AdvisorRule, Finding, RuleContext } from '../types';
import { formatBytes } from '../../format';

export const spillToDiskRule: AdvisorRule = {
  id: 'spill-to-disk',

  evaluate(ctx: RuleContext): Finding[] {
    const findings: Finding[] = [];
    const { spillCriticalBytes, maxFindingsPerRule } = ctx.thresholds;

    for (const node of ctx.plan.allNodes) {
      const tempUsed = node.tempUsed;
      if (tempUsed === undefined || tempUsed <= 0) continue;

      const isCritical = tempUsed >= spillCriticalBytes;

      findings.push({
        ruleId: 'spill-to-disk',
        severity: isCritical ? 'critical' : 'warning',
        nodeIds: [node.id],
        title: `Spill to disk on ${node.operation}`,
        explanation: `This operation used ${formatBytes(tempUsed)} of temp space, meaning it spilled to disk instead of completing in memory.`,
        suggestion: 'Consider increasing PGA/work area memory, or reducing the row volume feeding this operation (better filtering, an index to avoid the sort/hash).',
      });

      if (findings.length >= maxFindingsPerRule) break;
    }

    return findings;
  },
};
