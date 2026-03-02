import type { PlanNode, ParsedPlan } from '../types';
import type { PlanParser } from './types';

/**
 * Parser for Oracle execution plans in JSON format.
 * Handles JSON extracted from V$SQL_PLAN_STATISTICS_ALL via JSON_ARRAYAGG/JSON_OBJECT,
 * as used by tools like Datadog's explain plan visualizer and Tanel Poder's xdd.sql scripts.
 *
 * Expected input: a JSON array of objects, each representing a plan operation.
 * Keys are flexible (snake_case or camelCase variants supported).
 */
export const jsonPlanParser: PlanParser = {
  canParse(input: string): boolean {
    const trimmed = input.trim();
    // Must start with [ and end with ] (JSON array)
    if (!trimmed.startsWith('[') || !trimmed.endsWith(']')) {
      return false;
    }
    try {
      const parsed = JSON.parse(trimmed);
      if (!Array.isArray(parsed) || parsed.length === 0) {
        return false;
      }
      // Check that first element looks like a plan operation
      const first = parsed[0];
      return (
        typeof first === 'object' &&
        first !== null &&
        ('id' in first || 'ID' in first) &&
        ('operation' in first || 'OPERATION' in first)
      );
    } catch {
      return false;
    }
  },

  parse(input: string): ParsedPlan {
    let rawArray: Record<string, unknown>[];
    try {
      rawArray = JSON.parse(input.trim());
    } catch {
      return emptyPlan();
    }

    if (!Array.isArray(rawArray) || rawArray.length === 0) {
      return emptyPlan();
    }

    // Normalize keys to lowercase for flexible matching
    const normalized = rawArray.map(normalizeKeys);

    const allNodes: PlanNode[] = [];
    const nodeMap = new Map<number, PlanNode>();

    for (const row of normalized) {
      const node = parseJsonOperation(row);
      if (node) {
        nodeMap.set(node.id, node);
        allNodes.push(node);
      }
    }

    if (allNodes.length === 0) {
      return emptyPlan();
    }

    // Build parent-child relationships
    for (const node of allNodes) {
      if (node.parentId !== undefined) {
        const parent = nodeMap.get(node.parentId);
        if (parent) {
          parent.children.push(node);
        }
      }
    }

    // If no parent_id was available, build tree from depth
    const hasParentIds = allNodes.some(n => n.parentId !== undefined);
    if (!hasParentIds) {
      for (let i = 1; i < allNodes.length; i++) {
        const current = allNodes[i];
        for (let j = i - 1; j >= 0; j--) {
          if (allNodes[j].depth < current.depth) {
            allNodes[j].children.push(current);
            current.parentId = allNodes[j].id;
            break;
          }
        }
      }
    }

    const rootNode = nodeMap.get(0) || allNodes.find(n => n.parentId === undefined) || null;

    const hasActualStats = allNodes.some(
      n => n.actualRows !== undefined || n.actualTime !== undefined
    );
    const totalCost = allNodes.reduce((sum, n) => sum + (n.cost || 0), 0);
    const maxRows = Math.max(...allNodes.map(n => n.actualRows || n.rows || 0), 0);
    const maxActualRows = Math.max(...allNodes.map(n => n.actualRows || 0), 0);
    const maxStarts = Math.max(...allNodes.map(n => n.starts || 0), 0);

    // Total elapsed time: root node's actualTime or sum heuristic
    const totalElapsedTime = rootNode?.actualTime || 0;

    // Try to extract plan hash from the data (some scripts include it as metadata)
    const planHashValue = getStr(normalized[0], 'plan_hash_value') ||
      getStr(normalized[0], 'plan_hash') || undefined;
    const sqlId = getStr(normalized[0], 'sql_id') || undefined;

    return {
      planHashValue,
      sqlId,
      rootNode,
      allNodes,
      totalCost,
      maxRows,
      maxActualRows: hasActualStats ? maxActualRows : undefined,
      maxStarts: hasActualStats ? maxStarts : undefined,
      source: 'json',
      hasActualStats,
      totalElapsedTime,
    };
  },
};

function emptyPlan(): ParsedPlan {
  return {
    rootNode: null,
    allNodes: [],
    totalCost: 0,
    maxRows: 0,
    source: 'json',
    hasActualStats: false,
  };
}

/**
 * Normalize all keys to lowercase with underscores for consistent lookup.
 * Handles: "OPERATION", "Operation", "operation", "object_name", "objectName", etc.
 */
function normalizeKeys(obj: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(obj)) {
    // Convert camelCase to snake_case, then lowercase
    const normalized = key
      .replace(/([a-z])([A-Z])/g, '$1_$2')
      .toLowerCase();
    result[normalized] = value;
  }
  return result;
}

function getNum(row: Record<string, unknown>, ...keys: string[]): number | undefined {
  for (const key of keys) {
    const val = row[key];
    if (val !== undefined && val !== null && val !== '') {
      const num = typeof val === 'number' ? val : parseFloat(String(val));
      if (!isNaN(num)) return num;
    }
  }
  return undefined;
}

function getInt(row: Record<string, unknown>, ...keys: string[]): number | undefined {
  const num = getNum(row, ...keys);
  return num !== undefined ? Math.round(num) : undefined;
}

function getStr(row: Record<string, unknown>, ...keys: string[]): string | undefined {
  for (const key of keys) {
    const val = row[key];
    if (val !== undefined && val !== null && val !== '') {
      return String(val).trim();
    }
  }
  return undefined;
}

function parseJsonOperation(row: Record<string, unknown>): PlanNode | null {
  const id = getInt(row, 'id');
  if (id === undefined) return null;

  // Build operation name from operation + options (V$SQL_PLAN format)
  const operation = getStr(row, 'operation') || '';
  const options = getStr(row, 'options');
  const fullOperation = options ? `${operation} ${options}` : operation;

  if (!fullOperation) return null;

  const depth = getInt(row, 'depth') || 0;

  // Object info
  const objectName = getStr(row, 'object_name');
  const objectAlias = getStr(row, 'object_alias');

  // Estimated stats (optimizer)
  const rows = getInt(row, 'cardinality', 'rows', 'e_rows');
  const bytes = getInt(row, 'bytes');
  const cost = getInt(row, 'cost');
  const cpuCost = getInt(row, 'cpu_cost');
  const ioCost = getInt(row, 'io_cost');

  // Actual runtime stats
  // V$SQL_PLAN_STATISTICS_ALL uses last_* prefix
  const actualRows = getInt(row, 'actual_rows', 'last_output_rows', 'output_rows', 'a_rows');
  const starts = getInt(row, 'actual_starts', 'last_starts', 'starts');
  const memoryUsed = getInt(row, 'actual_memory_used', 'last_memory_used', 'max_memory', 'used_mem');
  const tempUsed = getInt(row, 'actual_tempseg_size', 'last_tempseg_size', 'temp_space', 'used_tmp');
  const physicalReads = getInt(row, 'actual_disk_reads', 'last_disk_reads', 'physical_reads');
  const logicalReads = getInt(row, 'actual_cr_buffer_gets', 'last_cr_buffer_gets', 'buffer_gets', 'logical_reads');

  // Elapsed time: V$SQL_PLAN_STATISTICS_ALL stores in microseconds
  const elapsedTimeUs = getNum(row, 'actual_elapsed_time', 'last_elapsed_time', 'elapsed_time');
  const actualTime = elapsedTimeUs !== undefined ? elapsedTimeUs / 1000 : undefined;

  // Parallel degree
  const parallelDegree = getInt(row, 'actual_parallel_degree', 'last_degree', 'degree');

  // Predicates
  const accessPredicates = getStr(row, 'access_predicates');
  const filterPredicates = getStr(row, 'filter_predicates');

  // Query block / partition info
  const queryBlock = getStr(row, 'qblock_name', 'query_block');

  // Temp space from optimizer (estimated, different from actual tempUsed)
  const tempSpace = getInt(row, 'temp_space');

  const node: PlanNode = {
    id,
    depth,
    operation: fullOperation,
    objectName,
    objectAlias,
    queryBlock,
    rows,
    bytes,
    cost,
    cpuPercent: cpuCost && ioCost ? Math.round((cpuCost / (cpuCost + ioCost)) * 100) : undefined,
    tempSpace,
    actualRows,
    actualTime,
    starts,
    memoryUsed,
    tempUsed: tempUsed || (tempSpace && !actualRows ? undefined : tempUsed),
    physicalReads,
    logicalReads,
    accessPredicates,
    filterPredicates,
    children: [],
  };

  // Parallel degree stored in starts if degree > 1 (informational)
  if (parallelDegree && parallelDegree > 1 && !node.starts) {
    node.starts = parallelDegree;
  }

  // Parent ID
  const parentId = getInt(row, 'parent_id');
  if (parentId !== undefined) {
    node.parentId = parentId;
  }

  return node;
}
