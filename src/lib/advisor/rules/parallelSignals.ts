import type { AdvisorRule, Finding, RuleContext } from '../types';
import { computeParallelSignals, getDopDowngrade } from '../../planSignals';

export const parallelSignalsRule: AdvisorRule = {
  id: 'parallel-signals',

  evaluate(ctx: RuleContext): Finding[] {
    const findings: Finding[] = [];
    const { maxFindingsPerRule } = ctx.thresholds;

    const signals = computeParallelSignals(ctx.plan);
    let broadcastCount = 0;
    let serialCount = 0;

    for (const signal of signals) {
      if (signal.kind === 'broadcast-large') {
        if (broadcastCount >= maxFindingsPerRule) continue;
        broadcastCount++;
        findings.push({
          ruleId: 'parallel-broadcast-large',
          severity: 'warning',
          nodeIds: [signal.nodeId],
          title: 'Large broadcast in parallel plan',
          explanation: signal.reason,
          suggestion: 'Consider a HASH distribution instead of BROADCAST when the redistributed row source is large.',
        });
      } else {
        if (serialCount >= maxFindingsPerRule) continue;
        serialCount++;
        findings.push({
          ruleId: 'parallel-serial-point',
          severity: 'warning',
          nodeIds: [signal.nodeId],
          title: 'Serialization point in parallel plan',
          explanation: signal.reason,
          suggestion: 'Review whether this operation can remain parallel (P->P) to avoid funneling all rows through a single process.',
        });
      }
    }

    const downgrade = getDopDowngrade(ctx.plan.monitorMetadata);
    if (downgrade) {
      findings.push({
        ruleId: 'dop-downgrade',
        severity: 'warning',
        nodeIds: [],
        title: 'Degree of parallelism downgraded',
        explanation: `Requested DOP ${downgrade.requested} but only ${downgrade.allocated} parallel servers were allocated at runtime.`,
        suggestion: 'Check parallel_max_servers and system load — insufficient PX server availability commonly causes DOP downgrade.',
      });
    }

    return findings;
  },
};
