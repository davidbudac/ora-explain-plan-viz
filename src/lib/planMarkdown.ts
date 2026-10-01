import type { ParsedPlan, PlanNode } from './types';
import type { FeedbackMessage } from './actionFeedback';
import { copyToClipboard } from './clipboard';
import { formatNumberShort, formatTimeCompact } from './format';

export interface PlanMarkdownOptions {
  /** Include the SQL text fence. Default true. */
  includeSql?: boolean;
  /** Truncate the SQL after this many characters (with a note). Default 2000; `Infinity` keeps it whole. */
  sqlMaxLength?: number;
  /** Include the "Predicates" block. Default true. */
  includePredicates?: boolean;
  /** Include the optimizer "Notes" list. Default true. */
  includeNotes?: boolean;
}

export const DEFAULT_SQL_MAX_LENGTH = 2000;

// Regular leading spaces collapse when Markdown renders; non-breaking ones survive.
const INDENT_UNIT = '  ';

/** Make arbitrary text safe inside a GFM table cell. */
function escapeCell(text: string): string {
  return text.replace(/\r?\n/g, ' ').replace(/\|/g, '\\|');
}

/** Wrap `body` in a code fence that cannot be closed by backticks inside it. */
function fence(body: string, lang = ''): string {
  const longestRun = (body.match(/`+/g) ?? []).reduce((max, run) => Math.max(max, run.length), 0);
  const ticks = '`'.repeat(Math.max(3, longestRun + 1));
  return `${ticks}${lang}\n${body}\n${ticks}`;
}

function hasPredicates(node: PlanNode): boolean {
  return Boolean(node.accessPredicates || node.filterPredicates);
}

function formatCount(value: number | undefined): string {
  return formatNumberShort(value) ?? '';
}

function nodeName(node: PlanNode): string {
  return node.objectName ?? '';
}

interface Column {
  header: string;
  align: 'left' | 'right';
  cell: (node: PlanNode) => string;
}

function buildColumns(plan: ParsedPlan): Column[] {
  // Parsers number depth from 1 for some formats; indent relative to the shallowest row.
  const baseDepth = plan.allNodes.reduce((min, node) => Math.min(min, node.depth), Infinity);
  const columns: Column[] = [
    {
      header: 'Id',
      align: 'right',
      cell: (node) => `${node.id}${hasPredicates(node) ? ' *' : ''}`,
    },
    {
      header: 'Operation',
      align: 'left',
      cell: (node) =>
        INDENT_UNIT.repeat(Math.max(0, node.depth - baseDepth)) +
        escapeCell(node.operation) +
        (node.inactive ? ' (not used)' : ''),
    },
    { header: 'Name', align: 'left', cell: (node) => escapeCell(nodeName(node)) },
    { header: 'E-Rows', align: 'right', cell: (node) => formatCount(node.rows) },
  ];

  if (plan.hasActualStats) {
    columns.push(
      { header: 'Starts', align: 'right', cell: (node) => formatCount(node.starts) },
      { header: 'A-Rows', align: 'right', cell: (node) => formatCount(node.actualRows) },
      { header: 'A-Time', align: 'right', cell: (node) => formatTimeCompact(node.actualTime) ?? '' },
    );
    if (plan.allNodes.some((node) => node.logicalReads !== undefined)) {
      columns.push({ header: 'Buffers', align: 'right', cell: (node) => formatCount(node.logicalReads) });
    }
  } else {
    columns.push({ header: 'Cost', align: 'right', cell: (node) => formatCount(node.cost) });
  }
  return columns;
}

function buildTable(plan: ParsedPlan): string {
  const columns = buildColumns(plan);
  const header = `| ${columns.map((c) => c.header).join(' | ')} |`;
  const divider = `| ${columns.map((c) => (c.align === 'right' ? '---:' : '---')).join(' | ')} |`;
  const rows = plan.allNodes.map((node) => `| ${columns.map((c) => c.cell(node)).join(' | ')} |`);
  return [header, divider, ...rows].join('\n');
}

function buildPredicates(plan: ParsedPlan): string | null {
  const lines: string[] = [];
  const nodes = plan.allNodes.filter(hasPredicates).sort((a, b) => a.id - b.id);
  for (const node of nodes) {
    if (node.accessPredicates) lines.push(`${node.id} - access(${node.accessPredicates})`);
    if (node.filterPredicates) lines.push(`${node.id} - filter(${node.filterPredicates})`);
  }
  if (lines.length === 0) return null;
  return `**Predicates** (\`*\` in the Id column)\n\n${fence(lines.join('\n'), 'text')}`;
}

function buildSql(plan: ParsedPlan, maxLength: number): string | null {
  const sql = plan.sqlText?.trim();
  if (!sql) return null;
  if (sql.length <= maxLength) return fence(sql, 'sql');
  const shown = sql.slice(0, Math.max(0, maxLength)).trimEnd();
  const omitted = sql.length - shown.length;
  return `${fence(shown, 'sql')}\n\n_SQL truncated: showing the first ${shown.length.toLocaleString('en-US')} of ${sql.length.toLocaleString('en-US')} characters (${omitted.toLocaleString('en-US')} omitted)._`;
}

function buildHeading(plan: ParsedPlan): string {
  const parts: string[] = [];
  if (plan.sqlId) parts.push(`SQL ID \`${plan.sqlId}\``);
  if (plan.planHashValue) parts.push(`plan hash value \`${plan.planHashValue}\``);
  if (plan.childNumber !== undefined) parts.push(`child number ${plan.childNumber}`);
  return parts.length > 0 ? `### Execution plan — ${parts.join(', ')}` : '### Execution plan';
}

/**
 * Formats a parsed plan as GitHub-flavoured Markdown for pasting into tickets
 * and chats: heading, SQL fence, operations table, predicates and notes.
 * Pure — no DOM or clipboard access.
 */
export function formatPlanAsMarkdown(plan: ParsedPlan, options: PlanMarkdownOptions = {}): string {
  const {
    includeSql = true,
    sqlMaxLength = DEFAULT_SQL_MAX_LENGTH,
    includePredicates = true,
    includeNotes = true,
  } = options;

  const blocks: string[] = [buildHeading(plan)];

  if (includeSql) {
    const sql = buildSql(plan, sqlMaxLength);
    if (sql) blocks.push(sql);
  }

  if (plan.allNodes.length === 0) {
    blocks.push('_No plan operations to show._');
  } else {
    blocks.push(buildTable(plan));
    if (includePredicates) {
      const predicates = buildPredicates(plan);
      if (predicates) blocks.push(predicates);
    }
  }

  const noteLines = plan.notes?.rawLines ?? [];
  if (includeNotes && noteLines.length > 0) {
    blocks.push(`**Notes**\n\n${noteLines.map((line) => `- ${line.replace(/\r?\n/g, ' ')}`).join('\n')}`);
  }

  return blocks.join('\n\n') + '\n';
}

/**
 * Copies the plan as Markdown and reports the outcome through `notify` (normally
 * the toast API). Resolves true when the text reached the clipboard.
 */
export async function copyPlanAsMarkdown(
  plan: ParsedPlan,
  notify: (feedback: FeedbackMessage) => void,
  options?: PlanMarkdownOptions,
): Promise<boolean> {
  let ok = false;
  try {
    ok = await copyToClipboard(formatPlanAsMarkdown(plan, options));
  } catch {
    ok = false;
  }
  if (ok) {
    notify({ tone: 'success', message: 'Plan copied as Markdown' });
  } else {
    notify({ tone: 'error', title: 'Could not copy the plan', message: 'Copy failed — the browser blocked clipboard access.' });
  }
  return ok;
}
