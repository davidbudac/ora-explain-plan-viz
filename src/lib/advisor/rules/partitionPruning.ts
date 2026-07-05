import type { AdvisorRule, Finding, RuleContext } from '../types';
import { assessPartitionPruning } from '../../planSignals';

export const partitionPruningRule: AdvisorRule = {
  id: 'partition-no-pruning',

  evaluate(ctx: RuleContext): Finding[] {
    const findings: Finding[] = [];
    const { maxFindingsPerRule } = ctx.thresholds;

    for (const node of ctx.plan.allNodes) {
      if (assessPartitionPruning(node) !== 'none') continue;

      findings.push({
        ruleId: 'partition-no-pruning',
        severity: 'warning',
        nodeIds: [node.id],
        title: `No partition pruning on ${node.operation}`,
        explanation: `This operation accesses all partitions (Pstart/Pstop indicate no pruning), scanning the entire partitioned object.`,
        suggestion: 'Check whether a partition key predicate could be added to prune to a subset of partitions.',
      });

      if (findings.length >= maxFindingsPerRule) break;
    }

    return findings;
  },
};
