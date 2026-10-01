import type { ParsedPlan, PlanNode, ViewMode } from './types';
import type { AdvisorReport, Finding, FindingSeverity } from './advisor/types';
import { DEFAULT_THRESHOLDS } from './advisor/config';
import { ALL_RULES } from './advisor/rules';
import { usesActivityRanking } from './analysis';
import { cardinalityRatioSeverity, formatTimeShort, nodeCardinalityRatio, formatCardinalityRatio } from './format';

/** How many "things to look at" the overview shows. */
export const OVERVIEW_LIMIT = 3;

/** Longest "why it matters" line before it is cut with an ellipsis. */
export const OVERVIEW_WHY_MAX = 140;

/** Window event the command palette dispatches to reopen the overview card. */
export const SHOW_OVERVIEW_EVENT = 'oraplanviz:show-analysis-overview';

/** Views the card floats over (single-plan workspace only; not compare / SQL / metadata / AI tabs). */
export const OVERVIEW_VIEW_MODES: ReadonlySet<ViewMode> = new Set<ViewMode>(['hierarchical', 'tabular', 'sankey', 'flame']);

export type OverviewItemKind = 'finding' | 'hotspot' | 'mismatch';

export interface OverviewItem {
  /** Stable React key. */
  key: string;
  kind: OverviewItemKind;
  /** Advisor severity for findings; null for the fallback hotspot / mismatch items. */
  severity: FindingSeverity | null;
  /** What was detected. */
  title: string;
  /** Why it matters: one truncated line. */
  why: string;
  /** Node the Focus action selects; null for plan-level findings. */
  nodeId: number | null;
  /** `#id OPERATION OBJECT` for the primary node (+ "+N more" when several); null for plan-level findings. */
  nodeLabel: string | null;
  /** Stronger evidence needs a schema-metadata bundle and none is attached. */
  needsMetadata: boolean;
}

export interface OverviewOptions {
  /** Whether a metadata bundle is attached to the plan. */
  hasBundle: boolean;
  /**
   * The context's hottest node (null when hotspots are disabled or there are
   * no actual stats). The hotspot fallback is skipped when this is null.
   */
  hottestNodeId: number | null;
  limit?: number;
}

const SEVERITY_RANK: Record<FindingSeverity, number> = { critical: 0, warning: 1, info: 2 };

const METADATA_RULE_IDS: ReadonlySet<string> = new Set(
  ALL_RULES.filter((rule) => rule.requiresMetadata).map((rule) => rule.id),
);

/** Explanations / suggestions that point at statistics or indexes are stronger with a bundle. */
const METADATA_HINT = /\b(statistics|stats|histograms?|indexes|index)\b/i;

/** Collapse whitespace and cut to `max` characters with an ellipsis. */
export function truncateWhy(text: string, max: number = OVERVIEW_WHY_MAX): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  if (flat.length <= max) return flat;
  return `${flat.slice(0, max - 1).trimEnd()}…`;
}

/** `#4 TABLE ACCESS FULL EMP` */
export function describeNode(node: PlanNode): string {
  return `#${node.id} ${node.operation}${node.objectName ? ` ${node.objectName}` : ''}`;
}

function findingItem(finding: Finding, index: number, nodeById: Map<number, PlanNode>, hasBundle: boolean): OverviewItem {
  const primary = finding.nodeIds.length > 0 ? nodeById.get(finding.nodeIds[0]) : undefined;
  let nodeLabel: string | null = null;
  if (primary) {
    const more = finding.nodeIds.length - 1;
    nodeLabel = describeNode(primary) + (more > 0 ? ` +${more} more` : '');
  } else if (finding.nodeIds.length > 0) {
    nodeLabel = `#${finding.nodeIds[0]}`;
  }
  const wantsMetadata = METADATA_RULE_IDS.has(finding.ruleId) || METADATA_HINT.test(finding.explanation);
  return {
    key: `finding:${finding.ruleId}:${finding.nodeIds.join(',')}:${index}`,
    kind: 'finding',
    severity: finding.severity,
    title: finding.title,
    why: truncateWhy(finding.explanation),
    nodeId: finding.nodeIds.length > 0 ? finding.nodeIds[0] : null,
    nodeLabel,
    needsMetadata: !hasBundle && wantsMetadata,
  };
}

/** Worst estimate-vs-actual deviation among live non-root nodes, if material (>= warn, >= min row delta). */
function worstMismatchNode(plan: ParsedPlan, skip: ReadonlySet<number>): PlanNode | null {
  let worst: PlanNode | null = null;
  let worstDeviation = 0;
  for (const node of plan.allNodes) {
    if (node.parentId === undefined || node.inactive || skip.has(node.id)) continue;
    const ratio = nodeCardinalityRatio(node);
    if (ratio === undefined || cardinalityRatioSeverity(ratio) === 'good') continue;
    const total = node.estimatedRowsTotal;
    if (total === undefined || node.actualRows === undefined) continue;
    if (Math.abs(node.actualRows - total) < DEFAULT_THRESHOLDS.cardinalityMinRowDelta) continue;
    const deviation = ratio >= 1 ? ratio : 1 / ratio;
    if (deviation > worstDeviation) {
      worst = node;
      worstDeviation = deviation;
    }
  }
  return worst;
}

function hotspotWhy(plan: ParsedPlan, node: PlanNode): string {
  if (usesActivityRanking(plan) && node.activityPercent !== undefined) {
    return `Takes ${Math.round(node.activityPercent)}% of the sampled database activity (ASH), the most of any operation.`;
  }
  const time = node.selfTime ?? node.actualTime;
  const shown = formatTimeShort(time);
  return shown
    ? `Spends ${shown}${node.selfTime !== undefined ? ' of its own time' : ''}, the most of any operation.`
    : 'Spends the most time of any operation.';
}

/**
 * The overview card's "top things to look at", built only from results the app
 * already computes: advisor findings (severity, then the engine's order), and —
 * when fewer than `limit` — the hottest operation and the worst cardinality
 * mismatch, skipping nodes a finding already covers. Plan-level findings
 * (`nodeIds: []`) are kept, just without a node to focus.
 */
export function buildOverview(
  plan: ParsedPlan | null,
  report: AdvisorReport | null,
  options: OverviewOptions,
): OverviewItem[] {
  if (!plan) return [];
  const limit = options.limit ?? OVERVIEW_LIMIT;
  const nodeById = new Map(plan.allNodes.map((node) => [node.id, node]));

  const ranked = (report?.findings ?? [])
    .map((finding, index) => ({ finding, index }))
    .sort((a, b) => SEVERITY_RANK[a.finding.severity] - SEVERITY_RANK[b.finding.severity] || a.index - b.index)
    .slice(0, limit);

  const items = ranked.map(({ finding, index }) => findingItem(finding, index, nodeById, options.hasBundle));
  if (items.length >= limit) return items;

  // De-duplicate by node against every finding, not just the ones shown.
  const covered = new Set<number>();
  for (const finding of report?.findings ?? []) for (const id of finding.nodeIds) covered.add(id);

  const hottest = options.hottestNodeId !== null && plan.hasActualStats ? nodeById.get(options.hottestNodeId) : undefined;
  if (hottest && !covered.has(hottest.id)) {
    covered.add(hottest.id);
    items.push({
      key: `hotspot:${hottest.id}`,
      kind: 'hotspot',
      severity: null,
      title: `Hottest operation: ${hottest.operation}`,
      why: hotspotWhy(plan, hottest),
      nodeId: hottest.id,
      nodeLabel: describeNode(hottest),
      needsMetadata: false,
    });
  }
  if (items.length >= limit) return items;

  const mismatch = plan.hasActualStats ? worstMismatchNode(plan, covered) : null;
  if (mismatch) {
    const label = formatCardinalityRatio(nodeCardinalityRatio(mismatch));
    items.push({
      key: `mismatch:${mismatch.id}`,
      kind: 'mismatch',
      severity: null,
      title: `Worst row estimate: ${mismatch.operation}`,
      why: truncateWhy(
        `Estimated ${(mismatch.estimatedRowsTotal as number).toLocaleString()} rows but produced ${(mismatch.actualRows as number).toLocaleString()}${label ? ` (${label})` : ''}; a bad estimate can steer the optimizer to a poor plan.`,
      ),
      nodeId: mismatch.id,
      nodeLabel: describeNode(mismatch),
      needsMetadata: !options.hasBundle,
    });
  }
  return items;
}
