import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { parsePlan } from '../index';
import { formatPlanAsMarkdown } from '../../planMarkdown';

function readExample(filename: string): string {
  return readFileSync(join(__dirname, '../../../examples', filename), 'utf-8');
}

const OSBORNE = '17-sql_monitor-Exadata Cell Offload (K. Osborne).txt';
const LEWIS = '18-sql_monitor-Skewed Parallel (J. Lewis).txt';

describe('SQL Monitor text: SQL Text section', () => {
  it('carries the statement from the SQL Text section into the plan and its Markdown export', () => {
    const plan = parsePlan(readExample(OSBORNE));

    expect(plan.source).toBe('sql_monitor_text');
    expect(plan.sqlText).toBe('select /*+ INDEX (SKEW2 SKEW2_COL1) */ avg(pk_col) from kso.skew2');
    expect(formatPlanAsMarkdown(plan)).toContain('```sql\nselect /*+ INDEX (SKEW2 SKEW2_COL1) */ avg(pk_col) from kso.skew2\n```');
  });

  it('keeps every line of a multi-line statement, up to the Global Information heading', () => {
    const plan = parsePlan(readExample(LEWIS));
    const lines = plan.sqlText?.split('\n') ?? [];

    expect(lines).toHaveLength(30);
    expect(lines[0]).toBe("SELECT /*+ PARALLEL(8) */ DISTINCT rd.document_id AS doc_id");
    expect(lines[1]).toBe(",'firm_id' AS criteria_key");
    expect(lines[29]).toBe('WHERE 1 = 1');
    expect(plan.warnings).toBeUndefined();
  });

  it('keeps a blank line inside the statement', () => {
    const input = readExample(OSBORNE).replace(
      'select /*+ INDEX (SKEW2 SKEW2_COL1) */ avg(pk_col) from kso.skew2',
      'select /*+ INDEX (SKEW2 SKEW2_COL1) */ avg(pk_col)\n\nfrom kso.skew2',
    );

    expect(parsePlan(input).sqlText).toBe('select /*+ INDEX (SKEW2 SKEW2_COL1) */ avg(pk_col)\n\nfrom kso.skew2');
  });
});

describe('SQL Monitor XML: optimizer temp estimate', () => {
  it('reads the temp estimate into tempSpace and the measured spill into tempUsed, independently', () => {
    const plan = parsePlan(readExample('23-sql_monitor-Window Sort Spill.txt'));
    const node = (id: number) => plan.allNodes.find((n) => n.id === id);

    expect(plan.source).toBe('sql_monitor_xml');
    expect(node(3)?.tempSpace).toBe(56_312_000);
    expect(node(3)?.tempUsed).toBe(65_011_712);
    expect(node(4)?.tempSpace).toBe(56_312_000);
    expect(node(4)?.tempUsed).toBe(60_817_408);
    expect(node(5)?.tempSpace).toBeUndefined();
    expect(node(5)?.tempUsed).toBeUndefined();
  });

  it('keeps an estimate on an operation that never spilled', () => {
    const plan = parsePlan(readExample('24-sql_monitor-Recursive BOM.txt'));
    const sort = plan.allNodes.find((n) => n.id === 1);

    expect(sort?.operation).toBe('SORT GROUP BY');
    expect(sort?.tempSpace).toBe(71_957_085_709_000);
    expect(sort?.tempUsed).toBeUndefined();
  });
});
