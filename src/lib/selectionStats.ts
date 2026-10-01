import type { ParsedPlan, PlanNode } from './types';

/**
 * Aggregate statistics for a multi-node selection.
 *
 * Oracle reports cost, A-Time and (for DBMS_XPLAN / JSON / XBI) buffer gets cumulatively: a
 * parent includes its children. Summing those across a selection that holds both an
 * ancestor and its descendant counts the descendant twice, so every aggregate here is a
 * sum of *self* values (own cost, own time, own buffers). A-Rows and E-Rows are not
 * cumulative but they are per-operation flows, so a sum counts rows once per operation that
 * touched them — it is "rows handled by the selected operations", not a distinct-row count.
 * Starts are not summed at all (summing restarts of different operations means nothing).
 */
export interface SelectionStats {
  count: number;
  /** Σ E-Rows (per-start estimates; each operation counted once). */
  sumRows: number;
  sumBytes: number;
  /** Σ own cost. */
  sumSelfCost: number;
  /** Σ A-Rows — rows produced by each selected operation. */
  sumActualRows: number;
  /** Largest A-Rows / Starts among the selected operations. */
  maxActualRows: number;
  maxStarts: number;
  /** Σ self time; the cumulative A-Time of the outermost selected nodes when self time is unavailable. */
  sumActualTime: number;
  /** `Self time` when `sumActualTime` is a sum of self times, else `A-Time`. */
  actualTimeLabel: string;
  /** Σ ASH activity share (shares of distinct operations add up). */
  sumActivityPercent: number | undefined;
  avgCpuPercent: number | undefined;
  sumTempSpace: number;
  sumMemoryUsed: number;
  sumTempUsed: number;
  /** Σ self buffer gets / physical read requests (own work, children excluded). */
  sumSelfBuffers: number;
  sumSelfPhysicalReads: number;
}

/** Sources whose per-line buffer/read counts are already exclusive (V$SQL_PLAN_MONITOR). */
function hasExclusiveIo(source: ParsedPlan['source'] | undefined): boolean {
  return source === 'sql_monitor_text' || source === 'sql_monitor_xml';
}

/** A node's own value of a cumulative count: node − Σ live children, floored at 0. */
function selfOf(node: PlanNode, pick: (n: PlanNode) => number | undefined, cumulative: boolean): number {
  const own = pick(node);
  if (own === undefined) return 0;
  if (!cumulative) return own;
  const childSum = node.children.filter((c) => !c.inactive).reduce((sum, c) => sum + (pick(c) ?? 0), 0);
  return Math.max(0, own - childSum);
}

/** Selected nodes with no selected ancestor, so cumulative values are not double counted. */
export function outermostNodes(nodes: PlanNode[], allNodes: PlanNode[]): PlanNode[] {
  const byId = new Map(allNodes.map((n) => [n.id, n]));
  const selectedIds = new Set(nodes.map((n) => n.id));
  return nodes.filter((n) => {
    for (let p = n.parentId !== undefined ? byId.get(n.parentId) : undefined; p; p = p.parentId !== undefined ? byId.get(p.parentId) : undefined) {
      if (selectedIds.has(p.id)) return false;
    }
    return true;
  });
}

function sumNumbers(values: Array<number | undefined>): number {
  return values.reduce<number>((total, value) => total + (value ?? 0), 0);
}

function averageNumbers(values: Array<number | undefined>): number | undefined {
  const defined = values.filter((value): value is number => value !== undefined);
  if (defined.length === 0) return undefined;
  return defined.reduce((total, value) => total + value, 0) / defined.length;
}

export function computeSelectionStats(
  nodes: PlanNode[],
  allNodes: PlanNode[],
  source?: ParsedPlan['source'],
): SelectionStats {
  const cumulativeIo = !hasExclusiveIo(source);
  const hasSelfTime = nodes.every((n) => n.selfTime !== undefined);
  const activityValues = nodes.map((n) => n.activityPercent).filter((v): v is number => v !== undefined);

  return {
    count: nodes.length,
    sumRows: sumNumbers(nodes.map((n) => n.rows)),
    sumBytes: sumNumbers(nodes.map((n) => n.bytes)),
    sumSelfCost: sumNumbers(nodes.map((n) => n.selfCost)),
    sumActualRows: sumNumbers(nodes.map((n) => n.actualRows)),
    maxActualRows: Math.max(0, ...nodes.map((n) => n.actualRows ?? 0)),
    maxStarts: Math.max(0, ...nodes.map((n) => n.starts ?? 0)),
    sumActualTime: hasSelfTime
      ? sumNumbers(nodes.map((n) => n.selfTime))
      : sumNumbers(outermostNodes(nodes, allNodes).map((n) => n.actualTime)),
    actualTimeLabel: hasSelfTime ? 'Self time' : 'A-Time',
    sumActivityPercent: activityValues.length > 0 ? sumNumbers(activityValues) : undefined,
    avgCpuPercent: averageNumbers(nodes.map((n) => n.cpuPercent)),
    sumTempSpace: sumNumbers(nodes.map((n) => n.tempSpace)),
    sumMemoryUsed: sumNumbers(nodes.map((n) => n.memoryUsed)),
    sumTempUsed: sumNumbers(nodes.map((n) => n.tempUsed)),
    sumSelfBuffers: nodes.reduce((total, n) => total + selfOf(n, (x) => x.logicalReads, cumulativeIo), 0),
    sumSelfPhysicalReads: nodes.reduce((total, n) => total + selfOf(n, (x) => x.physicalReads, cumulativeIo), 0),
  };
}
