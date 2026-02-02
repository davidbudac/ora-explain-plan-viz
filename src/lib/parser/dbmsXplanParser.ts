import type { PlanNode, ParsedPlan } from '../types';
import type { PlanParser } from './types';

interface RawPlanRow {
  id: number;
  operation: string;
  objectName?: string;
  alias?: string;
  rows?: number;
  bytes?: number;
  cost?: number;
  cpuPercent?: number;
  time?: string;
  depth: number;
  hasStarPrefix: boolean;
}

interface ColumnPositions {
  id: { start: number; end: number };
  operation: { start: number; end: number };
  name: { start: number; end: number };
  rows?: { start: number; end: number };
  bytes?: { start: number; end: number };
  cost?: { start: number; end: number };
  time?: { start: number; end: number };
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
    const lines = input.split('\n');

    // Extract plan hash value if present
    const planHashValue = extractPlanHashValue(lines);

    // Find and parse the table section
    const tableData = parseTableSection(lines);

    if (tableData.length === 0) {
      return {
        planHashValue,
        rootNode: null,
        allNodes: [],
        totalCost: 0,
        maxRows: 0,
        source: 'dbms_xplan',
        hasActualStats: false,
      };
    }

    // Parse predicate information
    const predicates = parsePredicates(lines);

    // Parse query block information
    const queryBlocks = parseQueryBlocks(lines);

    // Build tree structure
    const { rootNode, allNodes } = buildTree(tableData, predicates, queryBlocks);

    // Calculate totals
    const totalCost = allNodes.reduce((sum, node) => sum + (node.cost || 0), 0);
    const maxRows = Math.max(...allNodes.map(node => node.rows || 0));

    return {
      planHashValue,
      rootNode,
      allNodes,
      totalCost,
      maxRows,
      source: 'dbms_xplan',
      hasActualStats: false,
    };
  },
};

function extractPlanHashValue(lines: string[]): string | undefined {
  for (const line of lines) {
    const match = line.match(/Plan hash value:\s*(\d+)/i);
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
      const row = parseDataRow(line, columns);
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
    } else if (segment.includes('cost')) {
      cols.cost = { start, end };
    } else if (segment === 'time' || segment === 'e-time') {
      cols.time = { start, end };
    }
  }

  return cols;
}

function parseDataRow(line: string, columns: ColumnPositions): RawPlanRow | null {
  // Extract ID column
  const idStr = line.substring(columns.id.start, columns.id.end).trim();

  // Check for star prefix (indicates predicate info)
  const hasStarPrefix = idStr.startsWith('*');
  const idMatch = idStr.match(/\*?\s*(\d+)/);
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
  let cost: number | undefined;
  let cpuPercent: number | undefined;
  let time: string | undefined;

  if (columns.rows) {
    const rowsStr = line.substring(columns.rows.start, columns.rows.end).trim();
    const rowsVal = parseNumericValue(rowsStr);
    if (rowsVal !== null) rows = rowsVal;
  }

  if (columns.bytes) {
    const bytesStr = line.substring(columns.bytes.start, columns.bytes.end).trim();
    const bytesVal = parseNumericValue(bytesStr);
    if (bytesVal !== null) bytes = bytesVal;
  }

  if (columns.cost) {
    const costStr = line.substring(columns.cost.start, columns.cost.end).trim();
    // Cost might be in format "123 (5)" where 5 is CPU%
    const costMatch = costStr.match(/(\d+)\s*(?:\((\d+)\))?/);
    if (costMatch) {
      cost = parseInt(costMatch[1], 10);
      if (costMatch[2]) {
        cpuPercent = parseInt(costMatch[2], 10);
      }
    }
  }

  if (columns.time) {
    time = line.substring(columns.time.start, columns.time.end).trim() || undefined;
  }

  return {
    id,
    operation,
    objectName,
    rows,
    bytes,
    cost,
    cpuPercent,
    time,
    depth,
    hasStarPrefix,
  };
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

function parseNumericValue(str: string): number | null {
  // Handle K/M/G suffixes and remove commas
  const cleaned = str.replace(/,/g, '').trim();

  if (!cleaned || cleaned === '') {
    return null;
  }

  const suffixMatch = cleaned.match(/^([\d.]+)\s*([KMG])?$/i);
  if (suffixMatch) {
    let value = parseFloat(suffixMatch[1]);
    const suffix = (suffixMatch[2] || '').toUpperCase();

    if (suffix === 'K') value *= 1000;
    else if (suffix === 'M') value *= 1000000;
    else if (suffix === 'G') value *= 1000000000;

    return Math.round(value);
  }

  const num = parseInt(cleaned, 10);
  return isNaN(num) ? null : num;
}

function parsePredicates(lines: string[]): Map<number, { access?: string; filter?: string }> {
  const predicates = new Map<number, { access?: string; filter?: string }>();

  // Find predicate section
  let inPredicateSection = false;
  let currentId: number | null = null;
  let currentType: 'access' | 'filter' | null = null;
  let currentText = '';

  for (const line of lines) {
    if (/Predicate Information/i.test(line)) {
      inPredicateSection = true;
      continue;
    }

    if (!inPredicateSection) {
      continue;
    }

    // Stop at next section or empty lines after predicates
    if (/^[A-Z].*:$/i.test(line.trim()) && !/^\s*\d+\s*-/.test(line)) {
      break;
    }

    // Parse predicate lines like "3 - access(...)" or "3 - filter(...)"
    const predicateMatch = line.match(/^\s*(\d+)\s*-\s*(access|filter)\s*\((.+)\)?\s*$/i);
    if (predicateMatch) {
      // Save previous predicate if any
      if (currentId !== null && currentType && currentText) {
        const existing = predicates.get(currentId) || {};
        existing[currentType] = currentText;
        predicates.set(currentId, existing);
      }

      currentId = parseInt(predicateMatch[1], 10);
      currentType = predicateMatch[2].toLowerCase() as 'access' | 'filter';
      currentText = predicateMatch[3] || '';

      // Handle case where predicate text is complete on this line
      if (currentText.endsWith(')') || !line.includes('(')) {
        const existing = predicates.get(currentId) || {};
        existing[currentType] = currentText.replace(/\)$/, '');
        predicates.set(currentId, existing);
        currentId = null;
        currentType = null;
        currentText = '';
      }
    } else if (currentId !== null && currentType && line.trim()) {
      // Continuation of multi-line predicate
      currentText += ' ' + line.trim();
      if (line.trim().endsWith(')')) {
        const existing = predicates.get(currentId) || {};
        existing[currentType] = currentText.replace(/\)$/, '');
        predicates.set(currentId, existing);
        currentId = null;
        currentType = null;
        currentText = '';
      }
    }
  }

  // Save any remaining predicate
  if (currentId !== null && currentType && currentText) {
    const existing = predicates.get(currentId) || {};
    existing[currentType] = currentText.replace(/\)$/, '');
    predicates.set(currentId, existing);
  }

  return predicates;
}

function parseQueryBlocks(lines: string[]): Map<number, { queryBlock?: string; objectAlias?: string }> {
  const queryBlocks = new Map<number, { queryBlock?: string; objectAlias?: string }>();

  // Find Query Block Name / Object Alias section
  let inQueryBlockSection = false;

  for (const line of lines) {
    if (/Query Block Name\s*\/\s*Object Alias/i.test(line)) {
      inQueryBlockSection = true;
      continue;
    }

    if (!inQueryBlockSection) {
      continue;
    }

    // Skip separator lines
    if (/^[-]+$/.test(line.trim())) {
      continue;
    }

    // Stop at next section header or empty line after data
    if (line.trim() === '' || (/^[A-Z].*:$/i.test(line.trim()) && !/^\s*\d+\s*-/.test(line))) {
      break;
    }

    // Parse lines like "   2 - SEL$1 / E@SEL$1" or "   1 - SEL$1"
    const match = line.match(/^\s*(\d+)\s*-\s*(\S+)(?:\s*\/\s*(\S+))?/);
    if (match) {
      const id = parseInt(match[1], 10);
      const queryBlock = match[2];
      const objectAlias = match[3];
      queryBlocks.set(id, { queryBlock, objectAlias });
    }
  }

  return queryBlocks;
}

function buildTree(
  rows: RawPlanRow[],
  predicates: Map<number, { access?: string; filter?: string }>,
  queryBlocks: Map<number, { queryBlock?: string; objectAlias?: string }>
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
      cost: row.cost,
      cpuPercent: row.cpuPercent,
      time: row.time,
      accessPredicates: preds?.access,
      filterPredicates: preds?.filter,
      queryBlock: qb?.queryBlock,
      objectAlias: qb?.objectAlias,
      children: [],
    };

    nodeMap.set(row.id, node);
    allNodes.push(node);
  }

  // Build parent-child relationships based on depth
  // In Oracle plans, a node's parent is the nearest preceding node with lower depth
  for (let i = 1; i < rows.length; i++) {
    const currentRow = rows[i];
    const currentNode = nodeMap.get(currentRow.id)!;

    // Look backwards for parent
    for (let j = i - 1; j >= 0; j--) {
      const potentialParentRow = rows[j];
      if (potentialParentRow.depth < currentRow.depth) {
        const parentNode = nodeMap.get(potentialParentRow.id)!;
        parentNode.children.push(currentNode);
        currentNode.parentId = parentNode.id;
        break;
      }
    }
  }

  // Root is typically id 0 or the first node
  const rootNode = nodeMap.get(0) || allNodes[0] || null;

  return { rootNode, allNodes };
}
