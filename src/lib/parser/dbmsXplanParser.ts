import type { PlanNode, ParsedPlan } from '../types';
import { planRootCost } from '../analysis';
import type { PlanParser } from './types';
import { parseNoteSection } from './noteSection';
import { alignColumnsToRow, pipeIndexes } from './rowAlign';
import { parsePredicateSection, parseQueryBlockSection } from './predicateSection';
import type { NodePredicates, NodeQueryBlock } from './predicateSection';
import {
  parseHintReport,
  parseOutlineSection,
  parsePeekedBinds,
  parseProjectionSection,
  parseRemoteSqlSection,
} from './advancedSections';
import type { HintReport } from './advancedSections';
import {
  expandTableTabs,
  normalizeNewlines,
  parseByteSize,
  parseCostCell,
  parseCount,
  parseTimeToMs,
  parseUsedMem,
  parseWorkareaExecutions,
} from './values';

/** Runtime-statistics fields a DBMS_XPLAN row can carry (ALLSTATS / DISPLAY_CURSOR columns). */
type RuntimeStats = Pick<
  PlanNode,
  | 'starts'
  | 'actualRows'
  | 'actualTime'
  | 'logicalReads'
  | 'physicalReads'
  | 'physicalWrites'
  | 'estimatedOptimalMemory'
  | 'estimatedOnePassMemory'
  | 'memoryUsed'
  | 'workareaPasses'
  | 'workareaExecutions'
  | 'tempUsed'
>;

type RuntimeColumn =
  | 'starts'
  | 'aRows'
  | 'aTime'
  | 'buffers'
  | 'reads'
  | 'writes'
  | 'oMem'
  | 'oneMem'
  | 'usedMem'
  | 'o1m'
  | 'usedTmp';

/** Lower-cased header text → runtime column (exact match; headers are not substring-matched). */
const RUNTIME_HEADERS: Record<string, RuntimeColumn> = {
  'starts': 'starts',
  'a-rows': 'aRows',
  'a-time': 'aTime',
  'buffers': 'buffers',
  'reads': 'reads',
  'writes': 'writes',
  'omem': 'oMem',
  '0mem': 'oMem',
  '1mem': 'oneMem',
  'used-mem': 'usedMem',
  'o/1/m': 'o1m',
  'used-tmp': 'usedTmp',
  'max-tmp': 'usedTmp',
};

interface RawPlanRow {
  id: number;
  operation: string;
  objectName?: string;
  alias?: string;
  rows?: number;
  bytes?: number;
  tempSpace?: number;
  cost?: number;
  cpuPercent?: number;
  time?: string;
  pstart?: string;
  pstop?: string;
  tq?: string;
  inOut?: string;
  pqDistrib?: string;
  stats: RuntimeStats;
  depth: number;
  hasStarPrefix: boolean;
  /** Adaptive-plan row marked '-' in the Id column (not used by the executed plan). */
  inactive: boolean;
}

interface ColumnPositions {
  id: { start: number; end: number };
  operation: { start: number; end: number };
  name: { start: number; end: number };
  rows?: { start: number; end: number };
  bytes?: { start: number; end: number };
  tempSpace?: { start: number; end: number };
  cost?: { start: number; end: number };
  time?: { start: number; end: number };
  pstart?: { start: number; end: number };
  pstop?: { start: number; end: number };
  tq?: { start: number; end: number };
  inOut?: { start: number; end: number };
  pqDistrib?: { start: number; end: number };
  runtime: Partial<Record<RuntimeColumn, { start: number; end: number }>>;
}

/**
 * Parser for standard Oracle DBMS_XPLAN output.
 */
export const dbmsXplanParser: PlanParser = {
  canParse(input: string): boolean {
    // Look for the characteristic table header with Id and Operation columns
    return /\|\s*Id\s*\|.*Operation/i.test(input);
  },

  parse(input: string): ParsedPlan {
    const lines = expandTableTabs(normalizeNewlines(input).split('\n'));

    // Extract plan hash value if present
    const planHashValue = extractPlanHashValue(lines);

    // Extract SQL_ID and SQL text from any preamble (DISPLAY_CURSOR header,
    // SQL*Plus prompt/continuation, or bare SQL above the plan table).
    const { sqlId, childNumber, sqlText } = extractSqlHeader(lines);

    // Find and parse the table section
    const tableData = parseTableSection(lines);

    if (tableData.length === 0) {
      return {
        planHashValue,
        sqlId,
        childNumber,
        sqlText,
        rootNode: null,
        allNodes: [],
        totalCost: 0,
        maxRows: 0,
        source: 'dbms_xplan',
        hasActualStats: false,
      };
    }

    // Parse predicate information
    const predicates = parsePredicateSection(lines);

    // Parse query block information
    const queryBlocks = parseQueryBlockSection(lines);

    // ADVANCED sections: projection, remote SQL, hint report, outline, peeked binds
    const advanced: AdvancedNodeData = {
      projection: parseProjectionSection(lines),
      remoteSql: parseRemoteSqlSection(lines),
      hintReport: parseHintReport(lines),
    };
    const outlineHints = parseOutlineSection(lines);
    const peekedBinds = parsePeekedBinds(lines);

    // Build tree structure
    const { rootNode, allNodes } = buildTree(tableData, predicates, queryBlocks, advanced);

    // Calculate totals
    const totalCost = planRootCost(rootNode, allNodes);
    // Inactive adaptive-plan rows are not part of the executed plan: keep them out of the scales.
    const activeNodes = allNodes.filter(node => !node.inactive);
    const maxRows = Math.max(...activeNodes.map(node => node.rows || 0), 0);

    // ALLSTATS / DISPLAY_CURSOR output carries actual runtime statistics (A-Rows etc.)
    const hasActualStats = allNodes.some(node => node.actualRows !== undefined);
    const maxActualRows = Math.max(...activeNodes.map(node => node.actualRows || 0), 0);
    const maxStarts = Math.max(...activeNodes.map(node => node.starts || 0), 0);

    // Parse the trailing "Note" section, if present.
    const notes = parseNoteSection(lines);

    return {
      planHashValue,
      sqlId,
      childNumber,
      sqlText,
      rootNode,
      allNodes,
      totalCost,
      maxRows: hasActualStats ? maxActualRows : maxRows,
      maxActualRows: hasActualStats ? maxActualRows : undefined,
      maxStarts: hasActualStats ? maxStarts : undefined,
      source: 'dbms_xplan',
      hasActualStats,
      // A-Time is cumulative: the root's actualTime is the total elapsed time
      totalElapsedTime: hasActualStats ? rootNode?.actualTime || 0 : undefined,
      notes,
      bindVariables: peekedBinds.length > 0 ? peekedBinds : undefined,
      outlineHints,
      hintSummary: advanced.hintReport.summary,
    };
  },
};

export function extractDbmsXplanSegments(input: string): string[] {
  const normalized = normalizeNewlines(input).trim();
  if (!normalized) return [];

  const lines = normalized.split('\n');
  const segmentStarts: number[] = [];

  for (let i = 0; i < lines.length; i++) {
    if (/Plan\s+hash\s+value\s*:\s*\d+/i.test(lines[i])) {
      segmentStarts.push(i);
    }
  }

  if (segmentStarts.length < 2) {
    return dbmsXplanParser.canParse(normalized) ? [normalized] : [];
  }

  const segments: string[] = [];

  // A DISPLAY_CURSOR / DISPLAY_AWR block opens with a "SQL_ID <id>, child number N"
  // header above its "Plan hash value:" line. Start a later segment at that header
  // (not at the hash line) so the header and SQL text stay with their own plan.
  const headerStart = (i: number): number => {
    const hashLine = segmentStarts[i];
    for (let j = hashLine - 1; j > segmentStarts[i - 1]; j--) {
      if (/^\s*SQL_ID\s+\S+/i.test(lines[j])) return j;
    }
    return hashLine;
  };
  const starts = segmentStarts.map((hashLine, i) => (i === 0 ? hashLine : headerStart(i)));

  for (let i = 0; i < segmentStarts.length; i++) {
    // Preserve preamble text (SQL_ID header, SQL*Plus prompt, etc.) before
    // the very first "Plan hash value:" so the first plan can extract SQL.
    const start = i === 0 ? 0 : starts[i];
    const end = starts[i + 1] ?? lines.length;
    const segment = lines.slice(start, end).join('\n').trim();

    if (segment && dbmsXplanParser.canParse(segment)) {
      segments.push(segment);
    }
  }

  return segments;
}

export function parseDbmsXplanPlans(input: string): ParsedPlan[] {
  return extractDbmsXplanSegments(input).map((segment) => dbmsXplanParser.parse(segment));
}

const SQL_START_KEYWORD = /^(SELECT|WITH|INSERT|UPDATE|DELETE|MERGE|CREATE|ALTER)\b/i;

/**
 * Extract SQL_ID and SQL text from the preamble of a DBMS_XPLAN block.
 *
 * Handles three common shapes:
 *   1. DISPLAY_CURSOR / DISPLAY_AWR header:
 *        SQL_ID  <id>, child number N
 *        -------------------------------------
 *        <sql text>
 *        (blank)
 *        Plan hash value: ...
 *   2. SQL*Plus prompt with line-number continuation:
 *        SQL> SELECT ...
 *          2    FROM ...
 *          3   WHERE ...;
 *   3. Bare SQL text immediately before the plan table.
 */
function extractSqlHeader(lines: string[]): { sqlId?: string; childNumber?: number; sqlText?: string } {
  // Shape 1: DISPLAY_CURSOR header with SQL_ID
  for (let i = 0; i < lines.length; i++) {
    const idMatch = lines[i].match(/^\s*SQL_ID\s+(\S+?)(?:\s*,.*)?\s*$/i);
    if (!idMatch) continue;

    const sqlId = idMatch[1].replace(/[.,;]+$/, '');
    const child = lines[i].match(/child\s+number\s+(\d+)/i);
    const childNumber = child ? parseInt(child[1], 10) : undefined;
    // Skip the separator dashes line(s) that follow the header.
    let j = i + 1;
    while (j < lines.length && /^\s*[-=]+\s*$/.test(lines[j])) j++;

    const collected: string[] = [];
    for (; j < lines.length; j++) {
      const line = lines[j];
      if (/Plan\s+hash\s+value\s*:/i.test(line)) break;
      if (/^\s*$/.test(line)) {
        if (collected.length === 0) continue; // skip leading blanks
        break;
      }
      collected.push(line);
    }

    const sqlText = cleanSqlLines(collected);
    return { sqlId: sqlId || undefined, childNumber, sqlText: sqlText || undefined };
  }

  // Shapes 2 & 3: look at everything before the first "Plan hash value:".
  const planIdx = lines.findIndex((l) => /Plan\s+hash\s+value\s*:/i.test(l));
  if (planIdx <= 0) return {};

  const prefix = lines.slice(0, planIdx);

  // Find the first line that looks like the start of a SQL statement,
  // accepting an optional "SQL> " prompt.
  let startIdx = -1;
  for (let i = 0; i < prefix.length; i++) {
    const stripped = prefix[i].replace(/^\s*SQL>\s*/i, '');
    if (SQL_START_KEYWORD.test(stripped.trim())) {
      startIdx = i;
      break;
    }
  }
  if (startIdx === -1) return {};

  const collected: string[] = [];
  for (let i = startIdx; i < prefix.length; i++) {
    const raw = prefix[i];
    if (/^\s*$/.test(raw)) {
      if (collected.length > 0) break;
      continue;
    }
    // Stop on section markers that typically follow the SQL.
    if (/^\s*(Explained\.|Execution Plan|PLAN_TABLE_OUTPUT|Statistics)\s*$/i.test(raw)) break;
    if (/^\s*\d+\s+rows?\s+selected/i.test(raw)) break;
    if (/^[-=]{5,}\s*$/.test(raw)) {
      if (collected.length > 0) break;
      continue;
    }
    collected.push(raw);
  }

  const sqlText = cleanSqlLines(collected);
  return sqlText ? { sqlText } : {};
}

function cleanSqlLines(lines: string[]): string {
  const cleaned = lines.map((line) =>
    line
      .replace(/^\s*SQL>\s?/i, '')
      // SQL*Plus continuation: "  2    FROM ..." — strip leading line number.
      .replace(/^\s{0,4}\d+\s{1,4}/, '')
      .trimEnd(),
  );
  // Drop trailing blank lines.
  while (cleaned.length && cleaned[cleaned.length - 1].trim() === '') cleaned.pop();
  return cleaned.join('\n').replace(/;\s*$/, '').trim();
}

function extractPlanHashValue(lines: string[]): string | undefined {
  for (const line of lines) {
    const match = line.match(/Plan\s+hash\s+value\s*:\s*(\d+)/i);
    if (match) {
      return match[1];
    }
  }
  return undefined;
}

function parseTableSection(lines: string[]): RawPlanRow[] {
  const rows: RawPlanRow[] = [];

  // Find the header line to determine column positions
  let headerLineIndex = -1;
  let headerLine = '';

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    // Look for the header row containing "Id" and "Operation"
    if (/\|\s*Id\s*\|.*Operation/i.test(line)) {
      headerLineIndex = i;
      headerLine = line;
      break;
    }
  }

  if (headerLineIndex === -1) {
    return rows;
  }

  // Parse column positions from header
  const columns = parseColumnPositions(headerLine);
  const headerPipes = pipeIndexes(headerLine);

  // Parse data rows (after header, skip separator line)
  for (let i = headerLineIndex + 1; i < lines.length; i++) {
    const line = lines[i];

    // Stop at separator line or empty content
    if (/^[-|]+$/.test(line.trim()) || line.trim() === '') {
      // Check if this is the end separator
      if (/^[-|]+$/.test(line.trim())) {
        // Look for more data rows after separator (multi-line format)
        let foundMoreData = false;
        for (let j = i + 1; j < lines.length; j++) {
          if (/^\|.*\d+.*\|/.test(lines[j])) {
            foundMoreData = true;
            break;
          }
          if (/^[-|]+$/.test(lines[j].trim())) {
            break;
          }
        }
        if (!foundMoreData) {
          break;
        }
      }
      continue;
    }

    // Parse data row if it looks like a plan row
    if (/^\|/.test(line)) {
      const row = parseDataRow(line, alignColumnsToRow(columns, headerPipes, line));
      if (row) {
        rows.push(row);
      }
    }
  }

  return rows;
}

function parseColumnPositions(headerLine: string): ColumnPositions {
  const cols: ColumnPositions = {
    id: { start: 0, end: 0 },
    operation: { start: 0, end: 0 },
    name: { start: 0, end: 0 },
    runtime: {},
  };

  // Find column boundaries by looking for | characters
  const pipePositions: number[] = [];
  for (let i = 0; i < headerLine.length; i++) {
    if (headerLine[i] === '|') {
      pipePositions.push(i);
    }
  }

  // Match column names to positions
  const headerLower = headerLine.toLowerCase();

  for (let i = 0; i < pipePositions.length - 1; i++) {
    const start = pipePositions[i] + 1;
    const end = pipePositions[i + 1];
    const segment = headerLower.substring(start, end).trim();

    if (segment === 'id') {
      cols.id = { start, end };
    } else if (segment === 'operation') {
      cols.operation = { start, end };
    } else if (segment === 'name' || segment === 'object name') {
      cols.name = { start, end };
    } else if (segment === 'rows' || segment === 'e-rows') {
      cols.rows = { start, end };
    } else if (segment === 'bytes' || segment === 'e-bytes') {
      cols.bytes = { start, end };
    } else if (segment === 'tempspc' || segment === 'e-temp') {
      cols.tempSpace = { start, end };
    } else if (segment.includes('cost')) {
      cols.cost = { start, end };
    } else if (segment === 'time' || segment === 'e-time') {
      cols.time = { start, end };
    } else if (segment === 'pstart') {
      cols.pstart = { start, end };
    } else if (segment === 'pstop') {
      cols.pstop = { start, end };
    } else if (segment === 'tq') {
      cols.tq = { start, end };
    } else if (segment === 'in-out') {
      cols.inOut = { start, end };
    } else if (segment === 'pq distrib') {
      cols.pqDistrib = { start, end };
    } else if (segment in RUNTIME_HEADERS) {
      cols.runtime[RUNTIME_HEADERS[segment]] = { start, end };
    }
  }

  return cols;
}

function parseDataRow(line: string, columns: ColumnPositions): RawPlanRow | null {
  // Extract ID column
  const idStr = line.substring(columns.id.start, columns.id.end).trim();

  // Check for star prefix (indicates predicate info). Adaptive plans may prefix
  // inactive rows with a "-" marker (e.g. "- * 3"), so detect the star anywhere
  // in the cell rather than only as the very first character.
  const hasStarPrefix = idStr.includes('*');
  const inactive = /^-(?!>)/.test(idStr); // "->" marks the currently executing row, not a skipped one
  const idMatch = idStr.match(/[-\s*]*(\d+)/);
  if (!idMatch) {
    return null;
  }

  const id = parseInt(idMatch[1], 10);

  // Extract operation - preserve leading spaces for depth calculation
  const operationRaw = line.substring(columns.operation.start, columns.operation.end);
  const depth = calculateDepth(operationRaw);
  const operation = operationRaw.trim();

  if (!operation) {
    return null;
  }

  // Extract object name
  const objectName = line.substring(columns.name.start, columns.name.end).trim() || undefined;

  // Extract optional numeric columns
  let rows: number | undefined;
  let bytes: number | undefined;
  let tempSpace: number | undefined;
  let cost: number | undefined;
  let cpuPercent: number | undefined;
  let time: string | undefined;

  if (columns.rows) {
    const rowsStr = line.substring(columns.rows.start, columns.rows.end).trim();
    const rowsVal = parseCount(rowsStr);
    if (rowsVal !== null) rows = rowsVal;
  }

  if (columns.bytes) {
    const bytesStr = line.substring(columns.bytes.start, columns.bytes.end).trim();
    const bytesVal = parseCount(bytesStr);
    if (bytesVal !== null) bytes = bytesVal;
  }

  if (columns.tempSpace) {
    const tempVal = parseByteSize(line.substring(columns.tempSpace.start, columns.tempSpace.end).trim());
    if (tempVal !== null) tempSpace = tempVal;
  }

  if (columns.cost) {
    // Cost might be "123 (5)" (5 = CPU%) and large costs are abbreviated ("4823K (1)")
    const costVal = parseCostCell(line.substring(columns.cost.start, columns.cost.end));
    if (costVal) {
      cost = costVal.cost;
      cpuPercent = costVal.cpuPercent;
    }
  }

  if (columns.time) {
    time = line.substring(columns.time.start, columns.time.end).trim() || undefined;
  }

  let pstart: string | undefined;
  let pstop: string | undefined;
  let tq: string | undefined;
  let inOut: string | undefined;
  let pqDistrib: string | undefined;

  if (columns.pstart) {
    pstart = line.substring(columns.pstart.start, columns.pstart.end).trim() || undefined;
  }

  if (columns.pstop) {
    pstop = line.substring(columns.pstop.start, columns.pstop.end).trim() || undefined;
  }

  if (columns.tq) {
    tq = line.substring(columns.tq.start, columns.tq.end).trim() || undefined;
  }

  if (columns.inOut) {
    inOut = line.substring(columns.inOut.start, columns.inOut.end).trim() || undefined;
  }

  if (columns.pqDistrib) {
    pqDistrib = line.substring(columns.pqDistrib.start, columns.pqDistrib.end).trim() || undefined;
  }

  return {
    id,
    operation,
    objectName,
    rows,
    bytes,
    tempSpace,
    cost,
    cpuPercent,
    time,
    pstart,
    pstop,
    tq,
    inOut,
    pqDistrib,
    stats: parseRuntimeStats(line, columns),
    depth,
    hasStarPrefix,
    inactive,
  };
}

/** Read the ALLSTATS runtime columns (Starts, A-Rows, Buffers, OMem, Used-Mem …) of one data row. */
function parseRuntimeStats(line: string, columns: ColumnPositions): RuntimeStats {
  const stats: RuntimeStats = {};
  const cell = (col: RuntimeColumn): string | undefined => {
    const range = columns.runtime[col];
    return range ? line.substring(range.start, range.end).trim() : undefined;
  };

  const starts = parseCount(cell('starts') ?? '');
  if (starts !== null) stats.starts = starts;

  const actualRows = parseCount(cell('aRows') ?? '');
  if (actualRows !== null) stats.actualRows = actualRows;

  const actualTime = parseTimeToMs(cell('aTime') ?? '');
  if (actualTime !== null) stats.actualTime = actualTime;

  const buffers = parseCount(cell('buffers') ?? '');
  if (buffers !== null) stats.logicalReads = buffers;

  // DISPLAY_CURSOR Reads/Writes are physical read/write requests, not I/O-request stats
  const reads = parseCount(cell('reads') ?? '');
  if (reads !== null) stats.physicalReads = reads;

  const writes = parseCount(cell('writes') ?? '');
  if (writes !== null) stats.physicalWrites = writes;

  const oMem = parseByteSize(cell('oMem') ?? '');
  if (oMem !== null) stats.estimatedOptimalMemory = oMem;

  const oneMem = parseByteSize(cell('oneMem') ?? '');
  if (oneMem !== null) stats.estimatedOnePassMemory = oneMem;

  const usedMem = parseUsedMem(cell('usedMem') ?? '');
  if (usedMem) {
    stats.memoryUsed = usedMem.bytes;
    if (usedMem.passes !== undefined) stats.workareaPasses = usedMem.passes;
  }

  const executions = parseWorkareaExecutions(cell('o1m') ?? '');
  if (executions) stats.workareaExecutions = executions;

  const usedTmp = parseByteSize(cell('usedTmp') ?? '');
  if (usedTmp !== null) stats.tempUsed = usedTmp;

  return stats;
}

function calculateDepth(operationStr: string): number {
  // Count leading spaces to determine nesting level
  let spaces = 0;
  for (const char of operationStr) {
    if (char === ' ') {
      spaces++;
    } else {
      break;
    }
  }
  // Typically each level is 1-2 spaces of indentation
  return Math.floor(spaces / 1);
}

/** Per-operation data from the ADVANCED sections, keyed by operation id. */
interface AdvancedNodeData {
  projection: Map<number, string>;
  remoteSql: Map<number, string>;
  hintReport: HintReport;
}

function buildTree(
  rows: RawPlanRow[],
  predicates: Map<number, NodePredicates>,
  queryBlocks: Map<number, NodeQueryBlock>,
  advanced: AdvancedNodeData
): { rootNode: PlanNode | null; allNodes: PlanNode[] } {
  if (rows.length === 0) {
    return { rootNode: null, allNodes: [] };
  }

  // Create all nodes first
  const nodeMap = new Map<number, PlanNode>();
  const allNodes: PlanNode[] = [];

  for (const row of rows) {
    const preds = predicates.get(row.id);
    const qb = queryBlocks.get(row.id);
    const node: PlanNode = {
      id: row.id,
      depth: row.depth,
      operation: row.operation,
      objectName: row.objectName,
      alias: row.alias,
      rows: row.rows,
      bytes: row.bytes,
      tempSpace: row.tempSpace,
      cost: row.cost,
      cpuPercent: row.cpuPercent,
      time: row.time,
      pstart: row.pstart,
      pstop: row.pstop,
      tq: row.tq,
      inOut: row.inOut,
      pqDistrib: row.pqDistrib,
      ...row.stats,
      accessPredicates: preds?.access,
      filterPredicates: preds?.filter,
      storagePredicates: preds?.storage,
      queryBlock: qb?.queryBlock,
      objectAlias: qb?.objectAlias,
      projection: advanced.projection.get(row.id),
      remoteSql: advanced.remoteSql.get(row.id),
      hints: advanced.hintReport.hints.get(row.id),
      inactive: row.inactive || undefined,
      children: [],
    };

    nodeMap.set(row.id, node);
    allNodes.push(node);
  }

  // Build parent-child relationships based on depth
  // In Oracle plans, a node's parent is the nearest preceding node with lower depth.
  // Use a stack for O(n) linking instead of O(n^2) backtracking.
  const stack: PlanNode[] = [];
  for (const row of rows) {
    const currentNode = nodeMap.get(row.id)!;

    while (stack.length > 0 && stack[stack.length - 1].depth >= row.depth) {
      stack.pop();
    }

    const parent = stack[stack.length - 1];
    if (parent) {
      parent.children.push(currentNode);
      currentNode.parentId = parent.id;
    }

    stack.push(currentNode);
  }

  // Root is typically id 0 or the first node
  const rootNode = nodeMap.get(0) || allNodes[0] || null;

  return { rootNode, allNodes };
}
