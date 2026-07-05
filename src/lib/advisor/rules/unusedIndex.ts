import type { AdvisorRule, Finding, RuleContext } from '../types';
import { extractPredicateColumns } from '../../metadata/predicateColumns';
import { resolveIndexesForBlock } from '../../metadata/indexes';

const FULL_SCAN_RE = /TABLE ACCESS (STORAGE )?FULL/;

export const unusedIndexRule: AdvisorRule = {
  id: 'index-exists-unused',
  requiresMetadata: true,

  evaluate(ctx: RuleContext): Finding[] {
    const findings: Finding[] = [];
    const { maxFindingsPerRule } = ctx.thresholds;
    if (!ctx.bundle) return findings;
    const bundle = ctx.bundle;

    for (const node of ctx.plan.allNodes) {
      if (!FULL_SCAN_RE.test(node.operation.toUpperCase())) continue;
      if (!node.accessPredicates && !node.filterPredicates) continue;

      const match = ctx.findObject(node.objectName);
      if (!match || match.object.type !== 'TABLE') continue;

      const predCols = extractPredicateColumns(node.accessPredicates, node.filterPredicates)
        .filter((c) => Object.prototype.hasOwnProperty.call(match.object.columns, c));
      if (predCols.length === 0) continue;

      const { indexes } = resolveIndexesForBlock(match, bundle);

      for (const idx of indexes) {
        if (ctx.usedIndexKeys.has(idx.key)) continue;
        if (idx.object.stats.status !== 'VALID') continue;
        if (idx.object.stats.visibility !== 'VISIBLE') continue;

        const leadingColumn = idx.object.columns[0];
        if (!leadingColumn || !predCols.includes(leadingColumn)) continue;

        findings.push({
          ruleId: 'index-exists-unused',
          severity: 'warning',
          nodeIds: [node.id],
          title: `Unused index ${idx.key} on ${node.operation}`,
          explanation: `Index ${idx.key} leads with column ${leadingColumn}, which appears in this node's predicates (${predCols.join(', ')}), but the plan does not use it.`,
          suggestion: 'The optimizer may have priced this index out (low selectivity, stale stats, or a cheaper full scan) — verify with stats/histograms before assuming it is a missing-index problem.',
        });

        if (findings.length >= maxFindingsPerRule) return findings;
      }
    }

    return findings;
  },
};
