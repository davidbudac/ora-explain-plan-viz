import type { ParsedPlan, PlanNode } from './types';
import type { AnnotationState, AnnotationGroup } from './annotations';
import { getHighlightColorDef } from './annotations';
import type { AdvisorReport, Finding, FindingSeverity } from './advisor';
import {
  computeCardinalityRatio,
  formatCardinalityRatio,
  cardinalityRatioSeverity,
  formatBytes,
  formatNumberShort,
  formatTimeCompact,
} from './format';

/**
 * Client report builder — packages the loaded plan, the consultant's
 * annotations, and every piece of analysis the app derives (advisor findings,
 * hotspots, cardinality mismatches, predicates, environment) into a single
 * self-contained HTML document the consultant can hand to a client or print
 * to PDF. Pure string building, fully offline: no network, no scripts in the
 * output beyond none at all — the document is static HTML + inline CSS.
 */

export interface ClientReportSections {
  sqlText: boolean;
  planTable: boolean;
  annotations: boolean;
  findings: boolean;
  hotspots: boolean;
  cardinality: boolean;
  predicates: boolean;
  environment: boolean;
  rawPlan: boolean;
}

export const DEFAULT_REPORT_SECTIONS: ClientReportSections = {
  sqlText: true,
  planTable: true,
  annotations: true,
  findings: true,
  hotspots: true,
  cardinality: true,
  predicates: true,
  environment: true,
  rawPlan: true,
};

export interface ClientReportOptions {
  /** Document title, e.g. "Order Search Query — Performance Review". */
  title: string;
  sections: ClientReportSections;
}

export interface ClientReportInput {
  plan: ParsedPlan;
  rawPlanText: string;
  annotations: AnnotationState;
  advisorReport: AdvisorReport | null;
  hottestNodeId: number | null;
  /** Display name of the input format, e.g. "SQL Monitor (XML)". */
  sourceLabel?: string;
  generatedAt: Date;
}

// --- helpers ---

export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function nodeLabel(node: PlanNode): string {
  return `#${node.id} ${node.operation}${node.objectName ? ` (${node.objectName})` : ''}`;
}

function nodeLabelById(plan: ParsedPlan, nodeId: number): string {
  const node = plan.allNodes.find((n) => n.id === nodeId);
  return node ? nodeLabel(node) : `#${nodeId}`;
}

const SEVERITY_META: Record<FindingSeverity, { label: string; color: string; bg: string }> = {
  critical: { label: 'Critical', color: '#b91c1c', bg: '#fef2f2' },
  warning: { label: 'Warning', color: '#b45309', bg: '#fffbeb' },
  info: { label: 'Info', color: '#1d4ed8', bg: '#eff6ff' },
};

function severityBadge(severity: FindingSeverity): string {
  const meta = SEVERITY_META[severity];
  return `<span class="badge" style="color:${meta.color};background:${meta.bg};border:1px solid ${meta.color}33">${meta.label}</span>`;
}

function colorChip(hex: string): string {
  return `<span class="chip" style="background:${hex}"></span>`;
}

function metaRow(label: string, value: string, mono = false): string {
  return `<tr><th>${escapeHtml(label)}</th><td${mono ? ' class="mono"' : ''}>${escapeHtml(value)}</td></tr>`;
}

// --- sections ---

function buildSqlTextSection(plan: ParsedPlan): string {
  if (!plan.sqlText?.trim()) return '';
  return `<pre class="code">${escapeHtml(plan.sqlText.trim())}</pre>`;
}

function buildPlanTableSection(input: ClientReportInput): string {
  const { plan, annotations, hottestNodeId } = input;
  const hasActual = plan.hasActualStats;
  const hasStarts = plan.allNodes.some((n) => n.starts !== undefined);
  const hasTemp = plan.allNodes.some((n) => n.tempUsed !== undefined || n.tempSpace !== undefined);

  const headers = ['Id', 'Operation', 'Name', 'E-Rows'];
  if (hasActual) headers.push('A-Rows', 'Estimate quality');
  headers.push('Cost');
  if (hasActual) headers.push('A-Time', 'Self time');
  if (hasStarts) headers.push('Starts');
  if (hasTemp) headers.push('Temp');

  const rows: string[] = [];
  for (const node of plan.allNodes) {
    const highlight = annotations.nodeHighlights.get(node.id);
    const note = annotations.nodeAnnotations.get(node.id);
    const isHot = node.id === hottestNodeId;
    const ratio = computeCardinalityRatio(node.rows, node.actualRows);
    const ratioSeverity = cardinalityRatioSeverity(ratio);

    const cells: string[] = [];
    cells.push(`<td class="num mono">${node.id}</td>`);
    const marker = highlight ? colorChip(getHighlightColorDef(highlight.color).hex) : '';
    const hotBadge = isHot ? '<span class="badge hot">Hotspot</span>' : '';
    cells.push(
      `<td class="mono op"><span style="padding-left:${node.depth * 14}px">${marker}${escapeHtml(node.operation)}</span>${hotBadge}</td>`
    );
    cells.push(`<td class="mono">${escapeHtml(node.objectName ?? '')}</td>`);
    cells.push(`<td class="num">${formatNumberShort(node.rows) ?? ''}</td>`);
    if (hasActual) {
      cells.push(`<td class="num">${formatNumberShort(node.actualRows) ?? ''}</td>`);
      const ratioText = formatCardinalityRatio(ratio);
      cells.push(
        `<td class="num${ratioSeverity !== 'good' ? ` sev-${ratioSeverity}` : ''}">${ratioText ? escapeHtml(ratioText) : ''}</td>`
      );
    }
    cells.push(`<td class="num">${formatNumberShort(node.cost) ?? ''}</td>`);
    if (hasActual) {
      cells.push(`<td class="num">${formatTimeCompact(node.actualTime) ?? ''}</td>`);
      cells.push(`<td class="num">${formatTimeCompact(node.selfTime) ?? ''}</td>`);
    }
    if (hasStarts) cells.push(`<td class="num">${formatNumberShort(node.starts) ?? ''}</td>`);
    if (hasTemp) cells.push(`<td class="num">${formatBytes(node.tempUsed ?? node.tempSpace) ?? ''}</td>`);

    rows.push(`<tr${isHot ? ' class="hot-row"' : ''}>${cells.join('')}</tr>`);
    if (note?.text.trim()) {
      rows.push(
        `<tr class="note-row"><td></td><td colspan="${headers.length - 1}"><span class="note-icon">✎</span> ${escapeHtml(note.text.trim())}</td></tr>`
      );
    }
  }

  const captionParts = ["E-Rows = optimizer's row estimate"];
  if (hasActual) {
    captionParts.push('A-Rows = actual rows produced');
    captionParts.push('Self time = time spent in the operation itself, excluding its children');
  }
  const hasNotes = plan.allNodes.some((n) => annotations.nodeAnnotations.get(n.id)?.text.trim());
  const noteHint = hasNotes ? ' Rows marked ✎ carry a consultant note (see Consultant Notes).' : '';

  return `<div class="table-wrap"><table><thead><tr>${headers
    .map((h) => `<th>${escapeHtml(h)}</th>`)
    .join('')}</tr></thead><tbody>${rows.join('')}</tbody></table></div>
<p class="caption">${captionParts.join('; ')}.${noteHint}</p>`;
}

function buildGroupHtml(group: AnnotationGroup, plan: ParsedPlan): string {
  const colorDef = getHighlightColorDef(group.color);
  const members = group.nodeIds.map((id) => `<li class="mono">${escapeHtml(nodeLabelById(plan, id))}</li>`).join('');
  return `<div class="card">
  <div class="card-title">${colorChip(colorDef.hex)}${escapeHtml(group.name)}</div>
  ${group.note?.trim() ? `<p>${escapeHtml(group.note.trim())}</p>` : ''}
  <ul class="plain">${members}</ul>
</div>`;
}

function buildAnnotationsSection(input: ClientReportInput): string {
  const { plan, annotations } = input;
  const parts: string[] = [];

  const notes = [...annotations.nodeAnnotations.values()].sort((a, b) => a.nodeId - b.nodeId);
  if (notes.length > 0) {
    const items = notes
      .map((note) => {
        const highlight = annotations.nodeHighlights.get(note.nodeId);
        const marker = highlight ? colorChip(getHighlightColorDef(highlight.color).hex) : '';
        return `<div class="card">
  <div class="card-title">${marker}<span class="mono">${escapeHtml(nodeLabelById(plan, note.nodeId))}</span></div>
  <p>${escapeHtml(note.text.trim()).replace(/\n/g, '<br>')}</p>
</div>`;
      })
      .join('\n');
    parts.push(`<h3>Notes on plan operations</h3>\n${items}`);
  }

  if (annotations.groups.length > 0) {
    parts.push(`<h3>Operation groups</h3>\n${annotations.groups.map((g) => buildGroupHtml(g, plan)).join('\n')}`);
  }

  // Highlights that carry no note still convey the consultant's markup —
  // summarize them so the color coding in the plan table is explained.
  const bareHighlights = [...annotations.nodeHighlights.values()]
    .filter((h) => !annotations.nodeAnnotations.has(h.nodeId))
    .sort((a, b) => a.nodeId - b.nodeId);
  if (bareHighlights.length > 0) {
    const items = bareHighlights
      .map(
        (h) =>
          `<li>${colorChip(getHighlightColorDef(h.color).hex)}<span class="mono">${escapeHtml(nodeLabelById(plan, h.nodeId))}</span></li>`
      )
      .join('');
    parts.push(`<h3>Highlighted operations</h3>\n<ul class="plain">${items}</ul>`);
  }

  return parts.join('\n');
}

function buildFindingHtml(finding: Finding, plan: ParsedPlan): string {
  const nodes = finding.nodeIds.map((id) => escapeHtml(nodeLabelById(plan, id))).join(', ');
  return `<div class="card">
  <div class="card-title">${severityBadge(finding.severity)}${escapeHtml(finding.title)}</div>
  ${nodes ? `<div class="card-meta mono">${nodes}</div>` : ''}
  <p>${escapeHtml(finding.explanation)}</p>
</div>`;
}

function buildFindingsSection(input: ClientReportInput): string {
  const { plan, advisorReport } = input;
  if (!advisorReport || advisorReport.findings.length === 0) return '';
  return advisorReport.findings.map((f) => buildFindingHtml(f, plan)).join('\n');
}

function buildHotspotsSection(input: ClientReportInput): string {
  const { plan } = input;
  if (!plan.hasActualStats) return '';
  const total = plan.totalElapsedTime;
  const top = plan.allNodes
    .filter((n) => n.parentId !== undefined && (n.selfTime ?? 0) > 0)
    .sort((a, b) => (b.selfTime ?? 0) - (a.selfTime ?? 0))
    .slice(0, 5);
  if (top.length === 0) return '';

  const rows = top
    .map((node) => {
      const pct = total && total > 0 ? `${(((node.selfTime ?? 0) / total) * 100).toFixed(1)}%` : '';
      return `<tr>
  <td class="mono">${escapeHtml(nodeLabel(node))}</td>
  <td class="num">${formatTimeCompact(node.selfTime) ?? ''}</td>
  <td class="num">${pct}</td>
</tr>`;
    })
    .join('');
  return `<div class="table-wrap"><table><thead><tr><th>Operation</th><th>Self time</th><th>% of total</th></tr></thead><tbody>${rows}</tbody></table></div>
<p class="caption">Operations ranked by time spent in the operation itself (excluding child operations).</p>`;
}

function buildCardinalitySection(input: ClientReportInput): string {
  const { plan } = input;
  if (!plan.hasActualStats) return '';
  const mismatches = plan.allNodes
    .map((node) => ({ node, ratio: computeCardinalityRatio(node.rows, node.actualRows) }))
    .filter((x): x is { node: PlanNode; ratio: number } => x.ratio !== undefined)
    .map((x) => ({ ...x, deviation: x.ratio >= 1 ? x.ratio : 1 / x.ratio }))
    .filter((x) => x.deviation >= 3)
    .sort((a, b) => b.deviation - a.deviation)
    .slice(0, 10);
  if (mismatches.length === 0) return '';

  const rows = mismatches
    .map(({ node, ratio }) => {
      const severity = cardinalityRatioSeverity(ratio);
      return `<tr>
  <td class="mono">${escapeHtml(nodeLabel(node))}</td>
  <td class="num">${formatNumberShort(node.rows) ?? ''}</td>
  <td class="num">${formatNumberShort(node.actualRows) ?? ''}</td>
  <td class="num sev-${severity}">${escapeHtml(formatCardinalityRatio(ratio) ?? '')}</td>
</tr>`;
    })
    .join('');
  return `<div class="table-wrap"><table><thead><tr><th>Operation</th><th>Estimated rows</th><th>Actual rows</th><th>Deviation</th></tr></thead><tbody>${rows}</tbody></table></div>
<p class="caption">Operations where the optimizer's row estimate deviates from the actual row count by 3&times; or more.</p>`;
}

function buildPredicatesSection(plan: ParsedPlan): string {
  const nodes = plan.allNodes.filter((n) => n.accessPredicates || n.filterPredicates);
  if (nodes.length === 0) return '';
  const rows = nodes
    .map((node) => {
      const preds: string[] = [];
      if (node.accessPredicates) {
        preds.push(`<div><span class="pred-kind">access</span> <code>${escapeHtml(node.accessPredicates)}</code></div>`);
      }
      if (node.filterPredicates) {
        preds.push(`<div><span class="pred-kind">filter</span> <code>${escapeHtml(node.filterPredicates)}</code></div>`);
      }
      return `<tr><td class="mono">${escapeHtml(nodeLabel(node))}</td><td>${preds.join('')}</td></tr>`;
    })
    .join('');
  return `<div class="table-wrap"><table><thead><tr><th>Operation</th><th>Predicates</th></tr></thead><tbody>${rows}</tbody></table></div>`;
}

function buildEnvironmentSection(plan: ParsedPlan): string {
  const parts: string[] = [];
  const meta = plan.monitorMetadata;

  if (meta) {
    const rows: string[] = [];
    if (meta.status) rows.push(metaRow('Status', meta.status));
    if (meta.sqlExecStart) rows.push(metaRow('Execution start', meta.sqlExecStart, true));
    if (meta.duration !== undefined) rows.push(metaRow('Duration', formatTimeCompact(meta.duration * 1000) ?? String(meta.duration)));
    if (meta.user) rows.push(metaRow('User', meta.user, true));
    if (meta.service) rows.push(metaRow('Service', meta.service, true));
    if (meta.module) rows.push(metaRow('Module', meta.module, true));
    if (meta.program) rows.push(metaRow('Program', meta.program, true));
    if (meta.dbVersion) rows.push(metaRow('Database version', meta.dbVersion, true));
    if (meta.dbUniqueName) rows.push(metaRow('Database', meta.dbUniqueName, true));
    if (meta.dbPlatform) rows.push(metaRow('Platform', meta.dbPlatform));
    if (meta.instanceId !== undefined) rows.push(metaRow('Instance', String(meta.instanceId), true));
    if (meta.dop !== undefined) rows.push(metaRow('Degree of parallelism', String(meta.dop), true));
    if (meta.pxServersRequested !== undefined && meta.pxServersAllocated !== undefined) {
      rows.push(metaRow('PX servers (allocated / requested)', `${meta.pxServersAllocated} / ${meta.pxServersRequested}`, true));
    }
    if (meta.bufferGets !== undefined) rows.push(metaRow('Buffer gets', formatNumberShort(meta.bufferGets) ?? '', true));
    if (meta.readReqs !== undefined) rows.push(metaRow('Read requests', formatNumberShort(meta.readReqs) ?? '', true));
    if (meta.readBytes !== undefined) rows.push(metaRow('Bytes read', formatBytes(meta.readBytes) ?? '', true));
    if (rows.length > 0) {
      parts.push(`<h3>Execution environment</h3>\n<table class="meta-table">${rows.join('')}</table>`);
    }

    const timeRows: string[] = [];
    const toMs = (us?: number) => (us === undefined ? undefined : us / 1000);
    const cpu = toMs(meta.cpuTime);
    const io = toMs(meta.userIoWaitTime);
    const other = toMs(meta.otherWaitTime);
    const plsql = toMs(meta.plsqlExecTime);
    if (cpu !== undefined) timeRows.push(metaRow('CPU time', formatTimeCompact(cpu) ?? '', true));
    if (io !== undefined) timeRows.push(metaRow('User I/O wait', formatTimeCompact(io) ?? '', true));
    if (plsql !== undefined && plsql > 0) timeRows.push(metaRow('PL/SQL execution', formatTimeCompact(plsql) ?? '', true));
    if (other !== undefined) timeRows.push(metaRow('Other waits', formatTimeCompact(other) ?? '', true));
    if (timeRows.length > 0) {
      parts.push(`<h3>Database time breakdown</h3>\n<table class="meta-table">${timeRows.join('')}</table>`);
    }
  }

  const noteTags: string[] = [];
  const notes = plan.notes;
  if (notes?.dynamicSampling) noteTags.push(`Dynamic sampling${notes.dynamicSamplingLevel ? ` (level ${notes.dynamicSamplingLevel})` : ''}`);
  if (notes?.planDirectives) noteTags.push('SQL plan directives used');
  if (notes?.cardinalityFeedback) noteTags.push('Cardinality feedback');
  if (notes?.statisticsFeedback) noteTags.push('Statistics feedback');
  if (notes?.adaptivePlan) noteTags.push('Adaptive plan');
  if (notes?.sqlProfile) noteTags.push(`SQL profile "${notes.sqlProfile}"`);
  if (notes?.sqlPlanBaseline) noteTags.push(`SQL plan baseline "${notes.sqlPlanBaseline}"`);
  if (notes?.outline) noteTags.push(`Outline "${notes.outline}"`);
  if (noteTags.length > 0) {
    parts.push(
      `<h3>Optimizer notes</h3>\n<div class="note-tags">${noteTags.map((t) => `<span class="tag">${escapeHtml(t)}</span>`).join('')}</div>`
    );
  }

  if (plan.bindVariables && plan.bindVariables.length > 0) {
    const rows = plan.bindVariables
      .map(
        (bind) =>
          `<tr><td class="mono">${escapeHtml(bind.name)}</td><td>${escapeHtml(bind.type ?? '')}</td><td class="mono">${escapeHtml(bind.value ?? '')}</td></tr>`
      )
      .join('');
    parts.push(
      `<h3>Bind variables</h3>\n<div class="table-wrap"><table><thead><tr><th>Name</th><th>Type</th><th>Value</th></tr></thead><tbody>${rows}</tbody></table></div>`
    );
  }

  return parts.join('\n');
}

function buildRawPlanSection(rawPlanText: string): string {
  if (!rawPlanText.trim()) return '';
  return `<pre class="code small">${escapeHtml(rawPlanText.trim())}</pre>`;
}

// --- document assembly ---

const REPORT_CSS = `
:root { color-scheme: light; }
* { box-sizing: border-box; }
body {
  margin: 0; padding: 40px 24px; background: #f1f5f9;
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
  color: #0f172a; font-size: 14px; line-height: 1.55;
}
.page { max-width: 920px; margin: 0 auto; background: #fff; padding: 48px 56px; border: 1px solid #e2e8f0; border-radius: 8px; }
header { border-bottom: 2px solid #0f172a; padding-bottom: 20px; margin-bottom: 28px; }
header h1 { margin: 0 0 4px; font-size: 26px; letter-spacing: -0.01em; }
header .subtitle { color: #475569; font-size: 14px; margin: 0 0 16px; }
.meta-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 8px 24px; }
.meta-grid .item .label { font-size: 10px; text-transform: uppercase; letter-spacing: 0.06em; color: #64748b; }
.meta-grid .item .value { font-size: 13px; font-weight: 600; }
nav.toc { margin: 0 0 28px; padding: 14px 18px; background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 6px; }
nav.toc .toc-title { font-size: 10px; text-transform: uppercase; letter-spacing: 0.06em; color: #64748b; margin-bottom: 6px; }
nav.toc ol { margin: 0; padding-left: 20px; columns: 2; }
nav.toc a { color: #1d4ed8; text-decoration: none; }
section { margin-bottom: 32px; break-inside: avoid-page; }
section > h2 { font-size: 17px; border-bottom: 1px solid #cbd5e1; padding-bottom: 6px; margin: 0 0 14px; }
section h3 { font-size: 14px; margin: 18px 0 8px; }
.mono, code { font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; }
code { font-size: 12px; background: #f1f5f9; padding: 1px 4px; border-radius: 3px; }
.note-tags { margin-top: 8px; }
.tag { display: inline-block; font-size: 11px; padding: 2px 8px; margin: 0 6px 6px 0; border: 1px solid #fcd34d; background: #fffbeb; color: #92400e; border-radius: 999px; }
.table-wrap { overflow-x: auto; }
table { border-collapse: collapse; width: 100%; font-size: 12px; }
th, td { border: 1px solid #e2e8f0; padding: 4px 8px; text-align: left; vertical-align: top; }
thead th { background: #f1f5f9; font-size: 11px; text-transform: uppercase; letter-spacing: 0.04em; color: #475569; }
td.num { text-align: right; white-space: nowrap; font-variant-numeric: tabular-nums; }
td.op { white-space: nowrap; }
tr.hot-row td { background: #fef2f2; }
tr.note-row td { background: #fefce8; font-size: 12px; color: #52525b; border-top: none; }
.note-icon { color: #a16207; }
.sev-warn { color: #b45309; font-weight: 600; }
.sev-bad { color: #b91c1c; font-weight: 700; }
.badge { display: inline-block; font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.04em; padding: 1px 6px; border-radius: 4px; margin-right: 8px; }
.badge.hot { color: #b91c1c; background: #fef2f2; border: 1px solid #fecaca; margin-left: 8px; }
.chip { display: inline-block; width: 10px; height: 10px; border-radius: 3px; margin-right: 6px; vertical-align: baseline; }
.card { border: 1px solid #e2e8f0; border-left-width: 3px; border-radius: 6px; padding: 10px 14px; margin-bottom: 10px; break-inside: avoid; }
.card-title { font-weight: 600; font-size: 13px; margin-bottom: 4px; }
.card-meta { font-size: 11px; color: #64748b; margin-bottom: 6px; }
.card p { margin: 4px 0; font-size: 13px; }
ul.plain { list-style: none; padding: 0; margin: 6px 0; }
ul.plain li { padding: 1px 0; font-size: 12px; }
.pred-kind { display: inline-block; font-size: 10px; font-weight: 700; text-transform: uppercase; color: #64748b; width: 42px; }
pre.code { background: #0f172a; color: #e2e8f0; padding: 14px 16px; border-radius: 6px; font-size: 12px; line-height: 1.5; overflow-x: auto; font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; }
pre.code.small { font-size: 10.5px; }
.meta-table { width: auto; min-width: 60%; }
.meta-table th { background: #f8fafc; font-weight: 600; text-align: left; width: 240px; }
.caption { font-size: 11px; color: #64748b; margin: 6px 0 0; }
footer { margin-top: 36px; padding-top: 12px; border-top: 1px solid #e2e8f0; font-size: 11px; color: #94a3b8; display: flex; justify-content: space-between; }
@media print {
  body { background: #fff; padding: 0; }
  .page { border: none; border-radius: 0; padding: 0; max-width: none; }
  .table-wrap { overflow-x: visible; }
  table { font-size: 10px; }
  td.op { white-space: normal; }
  pre.code { background: #f8fafc; color: #0f172a; border: 1px solid #e2e8f0; }
  a { color: inherit; }
}
`;

interface ReportSection {
  id: string;
  title: string;
  html: string;
}

export function buildClientReport(input: ClientReportInput, options: ClientReportOptions): string {
  const { plan, generatedAt } = input;
  const sections: ReportSection[] = [];
  const add = (enabled: boolean, id: string, title: string, html: string) => {
    if (enabled && html.trim()) sections.push({ id, title, html });
  };

  add(options.sections.sqlText, 'sql', 'SQL Statement', buildSqlTextSection(plan));
  add(options.sections.planTable, 'plan', 'Execution Plan', buildPlanTableSection(input));
  add(options.sections.annotations, 'notes', 'Consultant Notes', buildAnnotationsSection(input));
  add(options.sections.findings, 'findings', 'Automated Findings', buildFindingsSection(input));
  add(options.sections.hotspots, 'hotspots', 'Where the Time Went', buildHotspotsSection(input));
  add(options.sections.cardinality, 'cardinality', 'Optimizer Estimate Accuracy', buildCardinalitySection(input));
  add(options.sections.predicates, 'predicates', 'Predicates', buildPredicatesSection(plan));
  add(options.sections.environment, 'environment', 'Execution Details', buildEnvironmentSection(plan));
  add(options.sections.rawPlan, 'raw-plan', 'Appendix: Raw Plan', buildRawPlanSection(input.rawPlanText));

  const metaItems: string[] = [];
  const metaItem = (label: string, value: string, mono = false) =>
    `<div class="item"><div class="label">${escapeHtml(label)}</div><div class="value${mono ? ' mono' : ''}">${escapeHtml(value)}</div></div>`;
  metaItems.push(metaItem('Date', generatedAt.toISOString().slice(0, 10)));
  if (plan.sqlId) metaItems.push(metaItem('SQL ID', plan.sqlId, true));
  if (plan.planHashValue) metaItems.push(metaItem('Plan hash value', plan.planHashValue, true));
  if (input.sourceLabel) metaItems.push(metaItem('Plan source', input.sourceLabel));

  const toc =
    sections.length > 1
      ? `<nav class="toc"><div class="toc-title">Contents</div><ol>${sections
          .map((s) => `<li><a href="#${s.id}">${escapeHtml(s.title)}</a></li>`)
          .join('')}</ol></nav>`
      : '';

  const body = sections
    .map((s) => `<section id="${s.id}"><h2>${escapeHtml(s.title)}</h2>\n${s.html}\n</section>`)
    .join('\n');

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(options.title)}</title>
<style>${REPORT_CSS}</style>
</head>
<body>
<div class="page">
<header>
  <h1>${escapeHtml(options.title)}</h1>
  <p class="subtitle">Query performance documentation</p>
  <div class="meta-grid">${metaItems.join('')}</div>
</header>
${toc}
${body}
<footer>
  <span>Query performance documentation</span>
  <span>Generated ${escapeHtml(generatedAt.toISOString().slice(0, 10))} with Oracle Plan Visualizer</span>
</footer>
</div>
</body>
</html>`;
}

export function clientReportFilename(plan: ParsedPlan): string {
  const parts: string[] = [];
  if (plan.sqlId) parts.push(plan.sqlId);
  if (plan.planHashValue) parts.push(plan.planHashValue);
  if (parts.length === 0) parts.push('plan');
  return `${parts.join('-')}-report.html`;
}
