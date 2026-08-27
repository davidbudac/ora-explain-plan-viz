import type { ParsedPlan } from '../types';
import type { MetadataBundle } from '../metadata/bundle';
import type { AdvisorReport } from '../advisor/types';
import type { AiSectionId, BuiltContext, ContextSection } from './types';
import { aggregateActivityByLine } from '../ash';
import { assessPartitionPruning, computeParallelSignals, getDopDowngrade } from '../planSignals';
import { formatNumberShort, formatTimeShort } from '../format';
import { renderNotes, renderPlanTable, renderPredicates } from './planText';
import { projectMetadata } from './metadataProjection';
import { buildTestCaseScript } from './testCase';
import { findObjectInBundle } from '../metadata/lookup';
import {
  buildComparisonRows,
  computeComparisonSummary,
  matchNodes,
  type CompareMetric,
} from '../compare';

/** Rough chars-per-token estimate; good enough for the review dialog. */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

const SECTION_LABELS: Record<AiSectionId, string> = {
  sql: 'SQL text',
  predicates: 'Predicates',
  notes: 'Note section',
  binds: 'Bind variables',
  monitorMeta: 'Execution metadata',
  ash: 'Activity (ASH samples)',
  signals: 'Plan signals',
  advisor: 'Heuristic pre-analysis',
  metadata: 'Schema metadata',
};

function section(id: AiSectionId, text: string): ContextSection | null {
  if (!text.trim()) return null;
  return { id, label: SECTION_LABELS[id], text, charCount: text.length, included: true };
}

export interface SectionedContext {
  /** Always sent: the plan table(s) and, for compare, the match digest. */
  core: string;
  sections: ContextSection[];
}

/** Build the core plan table plus every togglable section that has data. */
export function buildAnalyzeSections(
  plan: ParsedPlan,
  bundle: MetadataBundle | null,
  advisorReport: AdvisorReport | null,
): SectionedContext {
  const header: string[] = [];
  if (plan.sqlId) header.push(`SQL_ID: ${plan.sqlId}`);
  if (plan.planHashValue) header.push(`Plan hash value: ${plan.planHashValue}`);
  header.push(`Source format: ${plan.source}${plan.hasActualStats ? ' (with runtime statistics)' : ' (optimizer estimates only)'}`);

  const core = `${header.join('\n')}\n\n${renderPlanTable(plan)}`;

  const sections = [
    section('sql', plan.sqlText ?? ''),
    section('predicates', renderPredicates(plan)),
    section('notes', renderNotes(plan)),
    section('binds', renderBinds(plan)),
    section('monitorMeta', renderMonitorMeta(plan)),
    section('ash', renderAsh(plan)),
    section('signals', renderSignals(plan)),
    section('advisor', renderAdvisor(advisorReport)),
    section('metadata', bundle ? projectMetadata(bundle, plan) : ''),
  ].filter((s): s is ContextSection => s !== null);

  return { core, sections };
}

/**
 * Test-case context: the analyze sections, but with FULL (unprojected)
 * metadata for the referenced objects — including DDL — and with the
 * deterministic test-case skeleton script appended to the always-sent core.
 */
export function buildTestCaseSections(
  plan: ParsedPlan,
  bundle: MetadataBundle,
  advisorReport: AdvisorReport | null,
): SectionedContext {
  const base = buildAnalyzeSections(plan, bundle, advisorReport);

  const core = [
    base.core,
    '',
    '=== DETERMINISTIC TEST CASE SKELETON ===',
    buildTestCaseScript({ plan, bundle }),
  ].join('\n');

  const fullMetadata = renderFullMetadata(bundle, plan);
  const sections = base.sections
    .map((s) =>
      s.id === 'metadata' ? { ...s, text: fullMetadata, charCount: fullMetadata.length } : s,
    )
    .filter((s) => s.text.trim() !== '');

  return { core, sections };
}

/**
 * Full metadata for the plan's referenced objects (plus indexes of referenced
 * tables): everything the bundle holds, DDL included — no projection or cap.
 */
function renderFullMetadata(bundle: MetadataBundle, plan: ParsedPlan): string {
  const keys = new Set<string>();
  for (const node of plan.allNodes) {
    const found = findObjectInBundle(bundle, node.objectName);
    if (found) keys.add(found.key);
  }
  for (const key of [...keys]) {
    const object = bundle.objects[key];
    if (object.type !== 'TABLE') continue;
    for (const indexName of object.indexes) {
      const found = findObjectInBundle(bundle, indexName);
      if (found) keys.add(found.key);
    }
  }
  if (keys.size === 0) return '';

  const objects: Record<string, unknown> = {};
  for (const key of [...keys].sort()) objects[key] = bundle.objects[key];

  const full: Record<string, unknown> = { source: bundle.source, objects };
  if (bundle.system_params) full.system_params = bundle.system_params;
  if (bundle.optimizer_env?.length) full.optimizer_env = bundle.optimizer_env;
  if (bundle.sql_management) full.sql_management = bundle.sql_management;

  return JSON.stringify(full, null, 1);
}

/**
 * Compare context: both plans' tables plus a per-node match digest. The
 * digest replaces per-plan predicates/metadata/ASH by default — those
 * sections are still offered as toggles from each plan where present.
 */
export function buildCompareSections(planA: ParsedPlan, planB: ParsedPlan): SectionedContext {
  const label = (plan: ParsedPlan, name: string) => {
    const bits = [name];
    if (plan.sqlId) bits.push(`SQL_ID ${plan.sqlId}`);
    if (plan.planHashValue) bits.push(`plan hash ${plan.planHashValue}`);
    return bits.join(', ');
  };

  const core = [
    `=== PLAN A (${label(planA, 'baseline')}) ===`,
    renderPlanTable(planA),
    '',
    `=== PLAN B (${label(planB, 'candidate')}) ===`,
    renderPlanTable(planB),
    '',
    '=== NODE MATCH DIGEST (A -> B) ===',
    renderCompareDigest(planA, planB),
  ].join('\n');

  const sections = [
    section('sql', planA.sqlText ?? planB.sqlText ?? ''),
    section('predicates', joinPlanSections(renderPredicates(planA), renderPredicates(planB))),
    section('notes', joinPlanSections(renderNotes(planA), renderNotes(planB))),
  ].filter((s): s is ContextSection => s !== null);

  return { core, sections };
}

/** Assemble the outgoing user message from the core and the included sections. */
export function assembleContext(core: string, sections: ContextSection[]): BuiltContext {
  const parts = [core];
  for (const s of sections) {
    if (!s.included) continue;
    parts.push(`=== ${s.label.toUpperCase()} ===\n${s.text}`);
  }
  const userMessage = parts.join('\n\n');
  return { core, sections, userMessage, tokenEstimate: estimateTokens(userMessage) };
}

function joinPlanSections(a: string, b: string): string {
  if (!a && !b) return '';
  const parts: string[] = [];
  if (a) parts.push(`--- Plan A ---\n${a}`);
  if (b) parts.push(`--- Plan B ---\n${b}`);
  return parts.join('\n');
}

function renderBinds(plan: ParsedPlan): string {
  const binds = plan.bindVariables ?? [];
  if (binds.length === 0) return '';
  return binds
    .map((b) => `  ${b.name}${b.type ? ` (${b.type})` : ''} = ${b.value ?? 'NULL'}`)
    .join('\n');
}

function renderMonitorMeta(plan: ParsedPlan): string {
  const meta = plan.monitorMetadata;
  if (!meta) return '';
  const lines: string[] = [];
  const push = (label: string, value: string | number | undefined) => {
    if (value !== undefined && value !== '') lines.push(`  ${label}: ${value}`);
  };
  push('Status', meta.status);
  push('Duration (s)', meta.duration);
  push('Execution start', meta.sqlExecStart);
  const us = (v?: number) => (v === undefined ? undefined : `${(v / 1_000_000).toFixed(2)}s`);
  push('CPU time', us(meta.cpuTime));
  push('User I/O wait', us(meta.userIoWaitTime));
  push('Other wait', us(meta.otherWaitTime));
  push('PL/SQL exec time', us(meta.plsqlExecTime));
  push('Buffer gets', meta.bufferGets?.toLocaleString());
  push('Read requests', meta.readReqs?.toLocaleString());
  push('Read bytes', meta.readBytes?.toLocaleString());
  push('DOP', meta.dop);
  push('PX servers requested', meta.pxServersRequested);
  push('PX servers allocated', meta.pxServersAllocated);
  push('User', meta.user);
  push('Module', meta.module);
  push('Service', meta.service);
  push('DB version', meta.dbVersion);

  const env = Object.entries(meta.optimizerEnv ?? {});
  if (env.length > 0) {
    lines.push('  Non-default optimizer environment:');
    for (const [name, value] of env) lines.push(`    ${name} = ${value}`);
  }
  return lines.join('\n');
}

function renderAsh(plan: ParsedPlan): string {
  const timeline = plan.activityTimeline;
  if (!timeline || timeline.samples.length === 0) return '';
  const byLine = aggregateActivityByLine(timeline);
  if (byLine.length === 0) return '';
  const lines = byLine.slice(0, 15).map((entry) => {
    const classes = entry.byClass
      .map((c) => {
        const events = c.events.slice(0, 2).map((e) => `${e.event} ${e.count}`).join(', ');
        return `${c.waitClass} ${c.count}${events ? ` [${events}]` : ''}`;
      })
      .join(', ');
    return `  line ${entry.line}: ${entry.total} samples (${classes})`;
  });
  const header = `ASH samples per plan line (${timeline.durationSecs}s execution, top ${lines.length}):`;
  return [header, ...lines].join('\n');
}

function renderSignals(plan: ParsedPlan): string {
  const lines: string[] = [];
  for (const signal of computeParallelSignals(plan)) {
    lines.push(`  line ${signal.nodeId} [${signal.kind}]: ${signal.reason}`);
  }
  const downgrade = getDopDowngrade(plan.monitorMetadata);
  if (downgrade) {
    lines.push(`  DOP downgraded: ${downgrade.requested} PX servers requested, ${downgrade.allocated} allocated.`);
  }
  const unpruned = plan.allNodes.filter((n) => assessPartitionPruning(n) === 'none');
  for (const node of unpruned) {
    lines.push(`  line ${node.id}: no partition pruning (${node.operation} reads all partitions).`);
  }
  return lines.join('\n');
}

function renderAdvisor(report: AdvisorReport | null): string {
  if (!report || report.findings.length === 0) return '';
  const lines = report.findings.map((f) => {
    const where = f.nodeIds.length > 0 ? ` (lines ${f.nodeIds.join(',')})` : '';
    return `  [${f.severity}] ${f.title}${where}: ${f.explanation}`;
  });
  return [
    'Heuristic pre-analysis from a fixed rule engine — verify against the plan, don\'t parrot:',
    ...lines,
  ].join('\n');
}

const DIGEST_METRICS: { metric: CompareMetric; label: string; format: (v: number) => string }[] = [
  { metric: 'cost', label: 'cost', format: (v) => formatNumberShort(v) ?? '' },
  { metric: 'actualRows', label: 'aRows', format: (v) => formatNumberShort(v) ?? '' },
  { metric: 'actualTime', label: 'aTime', format: (v) => formatTimeShort(v) ?? '' },
];

function renderCompareDigest(planA: ParsedPlan, planB: ParsedPlan): string {
  const matches = matchNodes(planA, planB);
  const rows = buildComparisonRows(matches);
  const lines: string[] = [];

  for (const row of rows) {
    const { planANode, planBNode, matchType } = row.match;
    if (matchType === 'unmatched') {
      const node = planANode ?? planBNode;
      if (!node) continue;
      const side = planANode ? 'A' : 'B';
      lines.push(`  only in ${side}: #${node.id} ${node.operation}${node.objectName ? ` ${node.objectName}` : ''}`);
      continue;
    }
    if (!planANode || !planBNode) continue;
    const changes = DIGEST_METRICS
      .map(({ metric, label, format }) => {
        const delta = row.deltas[metric];
        if (!delta?.changed || delta.valueA === undefined || delta.valueB === undefined) return null;
        return `${label} ${format(delta.valueA)}->${format(delta.valueB)}`;
      })
      .filter((c): c is string => c !== null);
    if (changes.length === 0) continue;
    const name = planANode.objectName ?? planBNode.objectName;
    lines.push(`  A#${planANode.id} -> B#${planBNode.id} ${planANode.operation}${name ? ` ${name}` : ''}: ${changes.join(', ')}`);
  }

  const summary = computeComparisonSummary(planA, planB, matches);
  const totals = [
    `matched ${summary.matchedCount} nodes, only-in-A ${summary.unmatchedACount}, only-in-B ${summary.unmatchedBCount}`,
    `total cost ${formatNumberShort(summary.totalCostA)} -> ${formatNumberShort(summary.totalCostB)}`,
  ];
  if (summary.totalElapsedTimeA !== undefined && summary.totalElapsedTimeB !== undefined) {
    totals.push(`elapsed ${formatTimeShort(summary.totalElapsedTimeA)} -> ${formatTimeShort(summary.totalElapsedTimeB)}`);
  }

  return [...lines, `  totals: ${totals.join('; ')}`].join('\n');
}
