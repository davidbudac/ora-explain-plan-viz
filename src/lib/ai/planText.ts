import type { ParsedPlan, PlanNode } from '../types';
import { computeSelfTimes } from '../analysis';
import { formatBytes, formatNumberShort, formatTimeShort } from '../format';

interface Column {
  header: string;
  align: 'left' | 'right';
  value: (node: PlanNode) => string;
}

/**
 * Regenerate a DBMS_XPLAN-style fixed-width table from a parsed plan.
 * Models know this format cold, so the analysis context uses it regardless
 * of what format the plan was originally pasted in. Actuals columns are
 * emitted only when the plan carries runtime statistics; columns that are
 * empty for every row are dropped entirely.
 */
export function renderPlanTable(plan: ParsedPlan): string {
  if (plan.allNodes.length === 0) return '';
  if (plan.hasActualStats && plan.maxSelfTime === undefined) {
    computeSelfTimes(plan);
  }

  const indent = (node: PlanNode) => ' '.repeat(node.depth) + node.operation;
  const num = (v?: number) => formatNumberShort(v) ?? '';

  const candidates: Column[] = [
    { header: 'Id', align: 'right', value: (n) => String(n.id) },
    { header: 'Operation', align: 'left', value: indent },
    { header: 'Name', align: 'left', value: (n) => n.objectName ?? '' },
    ...(plan.hasActualStats
      ? [{ header: 'Starts', align: 'right', value: (n: PlanNode) => num(n.starts) } as Column]
      : []),
    { header: 'E-Rows', align: 'right', value: (n) => num(n.rows) },
    ...(plan.hasActualStats
      ? [
          { header: 'A-Rows', align: 'right', value: (n: PlanNode) => num(n.actualRows) } as Column,
          { header: 'A-Time', align: 'right', value: (n: PlanNode) => formatTimeShort(n.actualTime) ?? '' } as Column,
          { header: 'A-Self', align: 'right', value: (n: PlanNode) => formatTimeShort(n.selfTime) ?? '' } as Column,
        ]
      : []),
    { header: 'Cost', align: 'right', value: (n) => num(n.cost) },
    { header: 'Pstart', align: 'right', value: (n) => n.pstart ?? '' },
    { header: 'Pstop', align: 'right', value: (n) => n.pstop ?? '' },
    ...(plan.hasActualStats
      ? [
          { header: 'Mem', align: 'right', value: (n: PlanNode) => formatBytes(n.memoryUsed) ?? '' } as Column,
          { header: 'Temp', align: 'right', value: (n: PlanNode) => formatBytes(n.tempUsed) ?? '' } as Column,
          { header: 'Reads', align: 'right', value: (n: PlanNode) => num(n.physicalReads) } as Column,
        ]
      : []),
  ];

  const nodes = [...plan.allNodes].sort((a, b) => a.id - b.id);
  const columns = candidates.filter(
    (col) => col.header === 'Id' || col.header === 'Operation'
      || nodes.some((n) => col.value(n) !== ''),
  );

  const widths = columns.map((col) =>
    Math.max(col.header.length, ...nodes.map((n) => col.value(n).length)),
  );
  const pad = (text: string, width: number, align: 'left' | 'right') =>
    align === 'left' ? text.padEnd(width) : text.padStart(width);

  const renderRow = (cells: string[]) =>
    '| ' + cells.map((cell, i) => pad(cell, widths[i], columns[i].align)).join(' | ') + ' |';
  const divider = '-'.repeat(renderRow(columns.map((c) => c.header)).length);

  const lines = [
    divider,
    renderRow(columns.map((c) => c.header)),
    divider,
    ...nodes.map((n) => renderRow(columns.map((c) => c.value(n)))),
    divider,
  ];
  return lines.join('\n');
}

/** Render the per-id access/filter predicate listing, DBMS_XPLAN style. */
export function renderPredicates(plan: ParsedPlan): string {
  const lines: string[] = [];
  const nodes = [...plan.allNodes].sort((a, b) => a.id - b.id);
  for (const node of nodes) {
    if (node.accessPredicates) lines.push(`  ${node.id} - access(${node.accessPredicates})`);
    if (node.filterPredicates) lines.push(`  ${node.id} - filter(${node.filterPredicates})`);
  }
  if (lines.length === 0) return '';
  return ['Predicate Information (identified by operation id):', ...lines].join('\n');
}

/** Render the DBMS_XPLAN "Note" section back out as bullet lines. */
export function renderNotes(plan: ParsedPlan): string {
  const raw = plan.notes?.rawLines ?? [];
  if (raw.length === 0) return '';
  return ['Note:', ...raw.map((line) => `- ${line}`)].join('\n');
}
