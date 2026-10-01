import type { ParsedPlan } from '../types';
import type { MetadataBundle } from '../metadata/bundle';
import { findObjectInBundle } from '../metadata/lookup';
import { findUsedIndexKeys } from '../metadata/indexes';
import { DEFAULT_THRESHOLDS, type AdvisorThresholds } from './config';
import type { AdvisorReport, AdvisorRule, Finding, FindingSeverity, FindObjectFn, RuleContext } from './types';
import { ALL_RULES } from './rules';

const SEVERITY_RANK: Record<FindingSeverity, number> = {
  critical: 0,
  warning: 1,
  info: 2,
};

interface CacheEntry {
  bundle: MetadataBundle | null;
  thresholds: AdvisorThresholds;
  report: AdvisorReport;
}

const CACHE = new WeakMap<ParsedPlan, CacheEntry>();

function buildFindObject(bundle: MetadataBundle | null): FindObjectFn {
  const memo = new Map<string, ReturnType<typeof findObjectInBundle>>();
  return (objectName: string | undefined) => {
    if (!bundle) return null;
    const key = objectName ?? '';
    if (memo.has(key)) return memo.get(key) ?? null;
    const result = findObjectInBundle(bundle, objectName);
    memo.set(key, result);
    return result;
  };
}

function buildReport(fullPlan: ParsedPlan, bundle: MetadataBundle | null, thresholds: AdvisorThresholds): AdvisorReport {
  // Adaptive-plan rows the optimizer did not use never ran: rules must not see them.
  const inactiveIds = new Set(fullPlan.allNodes.filter((n) => n.inactive).map((n) => n.id));
  const plan: ParsedPlan = inactiveIds.size > 0
    ? { ...fullPlan, allNodes: fullPlan.allNodes.filter((n) => !n.inactive) }
    : fullPlan;

  const ctx: RuleContext = {
    plan,
    bundle,
    thresholds,
    findObject: buildFindObject(bundle),
    usedIndexKeys: bundle ? findUsedIndexKeys(bundle, plan.allNodes) : new Set<string>(),
  };

  const findings: Finding[] = [];

  for (const rule of ALL_RULES as AdvisorRule[]) {
    if (rule.requiresMetadata && !bundle) continue;
    if (rule.requiresActualStats && !plan.hasActualStats) continue;
    try {
      for (const finding of rule.evaluate(ctx)) {
        if (inactiveIds.size === 0 || finding.nodeIds.length === 0) {
          findings.push(finding);
          continue;
        }
        // A finding may still name an inactive node (e.g. through a child link): drop those ids,
        // and the whole finding when nothing live is left.
        const nodeIds = finding.nodeIds.filter((id) => !inactiveIds.has(id));
        if (nodeIds.length > 0) findings.push(nodeIds.length === finding.nodeIds.length ? finding : { ...finding, nodeIds });
      }
    } catch {
      // Rules must never throw on missing optional fields, but guard the
      // engine regardless so one broken rule can't take down the report.
    }
  }

  findings.sort((a, b) => {
    const rankDiff = SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity];
    if (rankDiff !== 0) return rankDiff;
    return (a.nodeIds[0] ?? -1) - (b.nodeIds[0] ?? -1);
  });

  const findingsByNodeId = new Map<number, Finding[]>();
  const counts: Record<FindingSeverity, number> = { critical: 0, warning: 0, info: 0 };
  const maxSeverityByNodeId = new Map<number, FindingSeverity>();

  for (const finding of findings) {
    counts[finding.severity]++;
    for (const nodeId of finding.nodeIds) {
      const arr = findingsByNodeId.get(nodeId);
      if (arr) arr.push(finding);
      else findingsByNodeId.set(nodeId, [finding]);

      const currentMax = maxSeverityByNodeId.get(nodeId);
      if (!currentMax || SEVERITY_RANK[finding.severity] < SEVERITY_RANK[currentMax]) {
        maxSeverityByNodeId.set(nodeId, finding.severity);
      }
    }
  }

  return { findings, findingsByNodeId, counts, maxSeverityByNodeId };
}

export function runAdvisor(
  plan: ParsedPlan,
  bundle: MetadataBundle | null,
  thresholds: AdvisorThresholds = DEFAULT_THRESHOLDS,
): AdvisorReport {
  const cached = CACHE.get(plan);
  if (cached && cached.bundle === bundle && cached.thresholds === thresholds) {
    return cached.report;
  }

  const report = buildReport(plan, bundle, thresholds);
  CACHE.set(plan, { bundle, thresholds, report });
  return report;
}
