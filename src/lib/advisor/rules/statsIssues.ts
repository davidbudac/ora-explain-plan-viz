import type { PlanNode } from '../../types';
import type { AdvisorRule, Finding, FindingSeverity, RuleContext } from '../types';
import { evaluateBadges, type MetadataBadgeKind } from '../../metadata/badges';
import { extractPredicateColumns } from '../../metadata/predicateColumns';
import { computeCardinalityRatio, cardinalityRatioSeverity } from '../../format';
import type { MetadataObject } from '../../metadata/bundle';

const SEVERITY_BY_KIND: Record<MetadataBadgeKind, FindingSeverity> = {
  'stale-stats': 'warning',
  'missing-stats': 'warning',
  'mismatch-no-histogram': 'info',
};

export const statsIssuesRule: AdvisorRule = {
  id: 'stats-issues',
  requiresMetadata: true,

  evaluate(ctx: RuleContext): Finding[] {
    const findings: Finding[] = [];
    if (!ctx.bundle) return findings;

    const groups = new Map<string, { object: MetadataObject; nodeIds: number[]; nodes: PlanNode[] }>();

    for (const node of ctx.plan.allNodes) {
      const match = ctx.findObject(node.objectName);
      if (!match || match.object.type !== 'TABLE') continue;
      const group = groups.get(match.key);
      if (group) {
        group.nodeIds.push(node.id);
        group.nodes.push(node);
      } else {
        groups.set(match.key, { object: match.object, nodeIds: [node.id], nodes: [node] });
      }
    }

    for (const [key, group] of groups) {
      const predicateColumns = extractPredicateColumns(
        ...group.nodes.flatMap((n) => [n.accessPredicates, n.filterPredicates]),
      );
      const worstNode = group.nodes.reduce((worst, n) => {
        const ratio = computeCardinalityRatio(n.rows, n.actualRows);
        const worstRatio = computeCardinalityRatio(worst.rows, worst.actualRows);
        const dev = ratio === undefined ? -1 : ratio === Infinity ? Infinity : ratio >= 1 ? ratio : 1 / ratio;
        const worstDev = worstRatio === undefined ? -1 : worstRatio === Infinity ? Infinity : worstRatio >= 1 ? worstRatio : 1 / worstRatio;
        return dev > worstDev ? n : worst;
      }, group.nodes[0]);
      const cardinalitySeverity = ctx.plan.hasActualStats
        ? cardinalityRatioSeverity(computeCardinalityRatio(worstNode.rows, worstNode.actualRows))
        : 'good';

      const badges = evaluateBadges({
        match: { key, object: group.object },
        cardinalitySeverity,
        predicateColumns,
      });

      for (const badge of badges) {
        findings.push({
          ruleId: 'stats-issues',
          severity: SEVERITY_BY_KIND[badge.kind],
          nodeIds: [...group.nodeIds],
          title: `${badge.kind.replace(/-/g, ' ')} on ${key}`,
          explanation: badge.reason,
          suggestion: badge.kind === 'stale-stats' || badge.kind === 'missing-stats'
            ? `Gather fresh statistics on ${key}.`
            : `Consider gathering a histogram on the affected column(s) of ${key}.`,
        });
      }
    }

    return findings.slice(0, ctx.thresholds.maxFindingsPerRule);
  },
};
