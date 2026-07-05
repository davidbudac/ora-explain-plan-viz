import type { AdvisorRule, Finding, RuleContext } from '../types';
import { extractPredicateColumns } from '../../metadata/predicateColumns';

const FULL_SCAN_RE = /TABLE ACCESS (STORAGE )?FULL/;

export const selectiveFullScanRule: AdvisorRule = {
  id: 'selective-full-scan',

  evaluate(ctx: RuleContext): Finding[] {
    const findings: Finding[] = [];
    const {
      ftsMinTableRows, ftsSelectivityWarn, ftsSelectivityCritical, ftsCriticalMinTableRows,
      ftsFallbackMaxRowsPerStart, ftsFallbackMinGetsPerStart, maxFindingsPerRule,
    } = ctx.thresholds;

    for (const node of ctx.plan.allNodes) {
      if (!FULL_SCAN_RE.test(node.operation.toUpperCase())) continue;
      if (!node.accessPredicates && !node.filterPredicates) continue;

      const match = ctx.findObject(node.objectName);
      const tableRows = match && match.object.type === 'TABLE' ? match.object.stats.num_rows ?? undefined : undefined;
      const returned = node.actualRows ?? node.rows;

      let finding: Finding | null = null;

      if (tableRows !== undefined && tableRows >= ftsMinTableRows && returned !== undefined) {
        const selectivity = tableRows > 0 ? returned / tableRows : 0;
        if (selectivity <= ftsSelectivityWarn) {
          const isCritical = selectivity <= ftsSelectivityCritical && tableRows >= ftsCriticalMinTableRows;
          const columns = extractPredicateColumns(node.accessPredicates, node.filterPredicates);
          finding = {
            ruleId: 'selective-full-scan',
            severity: isCritical ? 'critical' : 'warning',
            nodeIds: [node.id],
            title: `Selective full scan on ${node.operation}`,
            explanation: `Full scan of a table with ${tableRows.toLocaleString()} rows returned only ${returned.toLocaleString()} rows (${(selectivity * 100).toFixed(3)}% selectivity).`,
            suggestion: columns.length > 0
              ? `Consider an index on ${columns.join(', ')} to avoid scanning the entire table for this filter.`
              : 'Consider an index on the filtered column(s) to avoid scanning the entire table.',
          };
        }
      } else {
        const starts = node.starts;
        const actualRows = node.actualRows;
        const logicalReads = node.logicalReads;
        if (starts !== undefined && starts >= 1 && actualRows !== undefined && logicalReads !== undefined) {
          const rowsPerStart = actualRows / starts;
          const getsPerStart = logicalReads / starts;
          if (rowsPerStart <= ftsFallbackMaxRowsPerStart && getsPerStart >= ftsFallbackMinGetsPerStart) {
            const isCritical = starts > 1;
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
