import type { PlanNode } from '../../types.ts';
import type { TableObject } from '../../metadata/bundle.ts';
import type { AdvisorRule, Finding, RuleContext } from '../types.ts';
import { extractPredicateColumns } from '../../metadata/predicateColumns.ts';
import { effectiveExecutions } from '../../format.ts';

const FULL_SCAN_RE = /TABLE ACCESS (STORAGE )?FULL/;
const PARTITION_ITERATOR_RE = /^(?:PX )?PARTITION\b/i;
const PARTITION_ALL_RE = /\bALL\b/i;
/** Pstop of an interval-partitioned table that is not pruned. */
const INTERVAL_MAX_PARTITION = 1_048_575;

/**
 * What part of a partitioned table a full scan reads:
 *  - whole: every partition (or the table is not partitioned)
 *  - pruned: a subset; `partitions` is how many, when the plan says so
 *  - unknown: the plan carries no partition information to tell
 */
type ScanScope = { kind: 'whole' } | { kind: 'unknown' } | { kind: 'pruned'; partitions?: number };

function partitionIteratorOf(node: PlanNode, byId: Map<number, PlanNode>): PlanNode | undefined {
  let parent = node.parentId !== undefined ? byId.get(node.parentId) : undefined;
  while (parent && /^PX BLOCK/i.test(parent.operation)) {
    parent = parent.parentId !== undefined ? byId.get(parent.parentId) : undefined;
  }
  return parent && PARTITION_ITERATOR_RE.test(parent.operation) ? parent : undefined;
}

function scanScope(node: PlanNode, table: TableObject, byId: Map<number, PlanNode>): ScanScope {
  if (!table.stats.partitioned) return { kind: 'whole' };

  const iterator = partitionIteratorOf(node, byId);
  const pstart = node.pstart ?? iterator?.pstart;
  const pstop = node.pstop ?? iterator?.pstop;
  if (!iterator && pstart === undefined && pstop === undefined) return { kind: 'unknown' };

  if (iterator && PARTITION_ALL_RE.test(iterator.operation)) return { kind: 'whole' };

  const partitionCount = table.stats.partition_count;
  const start = pstart !== undefined && /^\d+$/.test(pstart.trim()) ? Number(pstart) : undefined;
  const stop = pstop !== undefined && /^\d+$/.test(pstop.trim()) ? Number(pstop) : undefined;
  if (start === 1 && stop !== undefined && (stop >= INTERVAL_MAX_PARTITION || (partitionCount !== undefined && stop >= partitionCount))) {
    return { kind: 'whole' };
  }

  // Subpartition numbering makes Pstart/Pstop counts unreliable.
  const composite = !!table.stats.subpartition_type && table.stats.subpartition_type !== 'NONE';
  if (iterator && /\bSINGLE\b/i.test(iterator.operation) && !composite) return { kind: 'pruned', partitions: 1 };
  if (start !== undefined && stop !== undefined && stop >= start && !composite) {
    return { kind: 'pruned', partitions: stop - start + 1 };
  }
  return { kind: 'pruned' };
}

export const selectiveFullScanRule: AdvisorRule = {
  id: 'selective-full-scan',

  evaluate(ctx: RuleContext): Finding[] {
    const findings: Finding[] = [];
    const {
      ftsMinTableRows, ftsSelectivityWarn, ftsSelectivityCritical, ftsCriticalMinTableRows,
      ftsFallbackMaxRowsPerStart, ftsFallbackMinGetsPerStart, maxFindingsPerRule,
    } = ctx.thresholds;

    const byId = new Map(ctx.plan.allNodes.map((n) => [n.id, n]));

    for (const node of ctx.plan.allNodes) {
      if (!FULL_SCAN_RE.test(node.operation.toUpperCase())) continue;
      if (!node.accessPredicates && !node.filterPredicates) continue;
      if (node.starts === 0) continue;

      const match = ctx.findObject(node.objectName);
      const table = match && match.object.type === 'TABLE' ? match.object : undefined;
      // Rows the scan could read: the whole table, or for a pruned scan of a partitioned table an
      // even-partition share of it. Without the partition count a pruned scan has no usable
      // denominator, so only the measured buffer-gets fallback below can judge it.
      let tableRows = table?.stats.num_rows ?? undefined;
      let partitionNote = '';
      if (table && tableRows !== undefined) {
        const scope = scanScope(node, table, byId);
        const partitionCount = table.stats.partition_count;
        if (scope.kind === 'unknown') {
          tableRows = undefined;
        } else if (scope.kind === 'pruned') {
          if (scope.partitions !== undefined && partitionCount !== undefined && partitionCount > 0) {
            const scanned = Math.min(scope.partitions, partitionCount);
            tableRows = Math.round((tableRows * scanned) / partitionCount);
            partitionNote = ` (${scanned.toLocaleString()} of ${partitionCount.toLocaleString()} partitions; estimated as table rows x partitions scanned / partition count, assuming evenly sized partitions)`;
          } else {
            tableRows = undefined;
          }
        }
      }
      // How many times the scan really ran, when the plan lets us tell: the multiplier behind
      // estimatedRowsTotal. Starts is not it (it also counts partitions and PX granules).
      // Undefined = unknown; each use below then keeps its conservative reading.
      const executions = node.estimatedRowsTotal !== undefined ? effectiveExecutions(node) ?? 1 : undefined;
      const runs = executions ?? 1;
      // A-Rows is cumulative over all executions, while tableRows is what ONE execution reads:
      // compare per execution. E-Rows (no actual stats) is per execution already.
      const returned = node.actualRows !== undefined ? node.actualRows / runs : node.rows;

      let finding: Finding | null = null;

      if (tableRows !== undefined && tableRows >= ftsMinTableRows && returned !== undefined) {
        const selectivity = tableRows > 0 ? returned / tableRows : 0;
        if (selectivity <= ftsSelectivityWarn) {
          // "Big" is judged on the rows read over all executions, not on the table size alone.
          const isCritical = selectivity <= ftsSelectivityCritical && tableRows * runs >= ftsCriticalMinTableRows;
          const columns = extractPredicateColumns(node.accessPredicates, node.filterPredicates);
          const scanned = partitionNote
            ? `about ${tableRows.toLocaleString()} rows in the partitions scanned${partitionNote}`
            : `a table with ${tableRows.toLocaleString()} rows`;
          const pct = `${(selectivity * 100).toFixed(3)}% selectivity`;
          const outcome = runs > 1 && node.actualRows !== undefined
            ? `ran ${runs.toLocaleString()} times and returned only ${returned.toLocaleString()} rows per execution (${node.actualRows.toLocaleString()} in total; ${pct})`
            : `returned only ${returned.toLocaleString()} rows (${pct})`;
          finding = {
            ruleId: 'selective-full-scan',
            severity: isCritical ? 'critical' : 'warning',
            nodeIds: [node.id],
            title: `Selective full scan on ${node.operation}`,
            explanation: `Full scan of ${scanned} ${outcome}.`,
            suggestion: columns.length > 0
              ? `Consider an index on ${columns.join(', ')} to avoid scanning the entire table for this filter.`
              : 'Consider an index on the filtered column(s) to avoid scanning the entire table.',
          };
        }
      }

      // Measured fallback: also when the table size is known but the selectivity test did not
      // fire (stale num_rows must not hide a scan that demonstrably read far more than it returned).
      if (!finding) {
        const starts = node.starts;
        const actualRows = node.actualRows;
        const logicalReads = node.logicalReads;
        if (starts !== undefined && starts >= 1 && actualRows !== undefined && logicalReads !== undefined) {
          const rowsPerStart = actualRows / starts;
          const getsPerStart = logicalReads / starts;
          if (rowsPerStart <= ftsFallbackMaxRowsPerStart && getsPerStart >= ftsFallbackMinGetsPerStart) {
            // Only a real re-execution is critical: Starts > 1 alone can be one pass over several partitions.
            const isCritical = (executions ?? starts) > 1;
            const columns = extractPredicateColumns(node.accessPredicates, node.filterPredicates);
            finding = {
              ruleId: 'selective-full-scan',
              severity: isCritical ? 'critical' : 'warning',
              nodeIds: [node.id],
              title: `Selective full scan on ${node.operation}`,
              explanation: `Full scan averaged ${getsPerStart.toLocaleString()} logical reads per start but returned only ${rowsPerStart.toLocaleString()} rows per start across ${starts.toLocaleString()} start(s).`,
              suggestion: columns.length > 0
                ? `Consider an index on ${columns.join(', ')} to avoid scanning the entire table for this filter.`
                : 'Consider an index on the filtered column(s) to avoid scanning the entire table.',
            };
          }
        }
      }

      if (finding) {
        findings.push(finding);
        if (findings.length >= maxFindingsPerRule) break;
      }
    }

    return findings;
  },
};
