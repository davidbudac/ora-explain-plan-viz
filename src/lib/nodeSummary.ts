import type { PlanNode } from './types';
import { formatTimeCompact } from './format';

/**
 * Plain-text summary of one plan operation, for pasting into a chat, ticket or
 * e-mail ("Copy operation details" on the tree's hover toolbar):
 *
 *   #3 TABLE ACCESS FULL · EMPLOYEES
 *   Rows 107 est / 105 actual · Cost 3 · Bytes 7,383 · A-Time 10ms · Starts 1
 *   Access: "E"."DEPARTMENT_ID"=:B1
 *   Filter: "E"."SALARY">1000
 *   Note: check the histogram
 *
 * Absent parts (and whole lines) are left out. Counts are exact, with thousands
 * separators, so the pasted numbers can be compared against the plan.
 */

export interface NodeSummaryOptions {
  /** The plan carries runtime statistics (SQL Monitor): include actual rows, time and starts. */
  hasActualStats?: boolean;
  /** The consultant's note on the operation. */
  note?: string;
}

const countFormat = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 });

function formatCount(value: number): string {
  return Number.isFinite(value) ? countFormat.format(value) : String(value);
}

export function formatNodeSummary(node: PlanNode, opts: NodeSummaryOptions = {}): string {
  const actuals = opts.hasActualStats === true;
  const lines: string[] = [];

  lines.push(`#${node.id} ${node.operation}${node.objectName ? ` · ${node.objectName}` : ''}`);

  const stats: string[] = [];
  const hasEstRows = node.rows !== undefined;
  const hasActRows = actuals && node.actualRows !== undefined;
  if (hasEstRows && hasActRows) {
    stats.push(`Rows ${formatCount(node.rows!)} est / ${formatCount(node.actualRows!)} actual`);
  } else if (hasActRows) {
    stats.push(`Rows ${formatCount(node.actualRows!)} actual`);
  } else if (hasEstRows) {
    // With runtime stats in the plan an estimate alone is still labelled as one
    stats.push(actuals ? `Rows ${formatCount(node.rows!)} est` : `Rows ${formatCount(node.rows!)}`);
  }
  if (node.cost !== undefined) stats.push(`Cost ${formatCount(node.cost)}`);
  if (node.bytes !== undefined) stats.push(`Bytes ${formatCount(node.bytes)}`);
  if (actuals && node.actualTime !== undefined) stats.push(`A-Time ${formatTimeCompact(node.actualTime)}`);
  if (actuals && node.starts !== undefined) stats.push(`Starts ${formatCount(node.starts)}`);
  if (stats.length > 0) lines.push(stats.join(' · '));

  const access = node.accessPredicates?.trim();
  if (access) lines.push(`Access: ${access}`);
  const filter = node.filterPredicates?.trim();
  if (filter) lines.push(`Filter: ${filter}`);
  const note = opts.note?.trim();
  if (note) lines.push(`Note: ${note}`);

  return lines.join('\n');
}
