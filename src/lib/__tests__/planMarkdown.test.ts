import { describe, it, expect, vi, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parsePlan } from '../parser';
import type { ParsedPlan, PlanNode } from '../types';
import { formatPlanAsMarkdown, copyPlanAsMarkdown } from '../planMarkdown';
import * as clipboard from '../clipboard';

const NBSP = ' ';

function example(name: string): string {
  return readFileSync(resolve(__dirname, '../../examples', name), 'utf8');
}

function node(partial: Partial<PlanNode> & { id: number }): PlanNode {
  return { depth: 0, operation: 'SELECT STATEMENT', children: [], ...partial };
}

function plan(nodes: PlanNode[], extra: Partial<ParsedPlan> = {}): ParsedPlan {
  return {
    rootNode: nodes[0] ?? null,
    allNodes: nodes,
    totalCost: 0,
    maxRows: 0,
    source: 'dbms_xplan',
    hasActualStats: false,
    ...extra,
  };
}

afterEach(() => vi.restoreAllMocks());

describe('formatPlanAsMarkdown', () => {
  it('renders the Simple Plan example', () => {
    const parsed = parsePlan(example('01-dbms_xplan-Simple Plan.txt'));
    const md = formatPlanAsMarkdown(parsed);
    expect(md).toMatchSnapshot();
    expect(md.startsWith('### Execution plan — plan hash value `1234567890`')).toBe(true);
    expect(md).toContain('| Id | Operation | Name | E-Rows | Cost |');
    // Ids 4 and 6 carry predicates.
    expect(md).toContain('| 4 * |');
    expect(md).toContain('| 6 * |');
    expect(md).toContain('| 3 |');
    expect(md).toContain('4 - access("E"."DEPARTMENT_ID"=:dept_id)');
  });

  it('puts SQL ID and plan hash in the heading when known, nothing when not', () => {
    const withIds = formatPlanAsMarkdown(plan([node({ id: 0 })], { sqlId: 'abc123xyz', planHashValue: '42' }));
    expect(withIds.split('\n')[0]).toBe('### Execution plan — SQL ID `abc123xyz`, plan hash value `42`');
    const bare = formatPlanAsMarkdown(plan([node({ id: 0 })]));
    expect(bare.split('\n')[0]).toBe('### Execution plan');
  });

  it('indents operations with non-breaking spaces per depth', () => {
    const md = formatPlanAsMarkdown(
      plan([
        node({ id: 0, depth: 0 }),
        node({ id: 1, depth: 1, operation: 'HASH JOIN' }),
        node({ id: 2, depth: 2, operation: 'TABLE ACCESS FULL', objectName: 'EMP' }),
      ])
    );
    expect(md).toContain('| 0 | SELECT STATEMENT |');
    expect(md).toContain(`| 1 | ${NBSP.repeat(2)}HASH JOIN |`);
    expect(md).toContain(`| 2 | ${NBSP.repeat(4)}TABLE ACCESS FULL | EMP |`);
  });

  it('escapes pipes and flattens newlines in cells', () => {
    const md = formatPlanAsMarkdown(
      plan([node({ id: 0, operation: 'A | B\nC', objectName: 'X|Y' })])
    );
    expect(md).toContain('| A \\| B C | X\\|Y |');
  });

  it('uses actual-stats columns when the plan has them, and Buffers only if present', () => {
    const nodes = [
      node({ id: 0, rows: 1, starts: 1, actualRows: 1500, actualTime: 2500, logicalReads: 12000, cost: 9 }),
      node({ id: 1, depth: 1, operation: 'TABLE ACCESS FULL', rows: 10, starts: 3, actualRows: 20, actualTime: 40 }),
    ];
    const md = formatPlanAsMarkdown(plan(nodes, { hasActualStats: true }));
    expect(md).toContain('| Id | Operation | Name | E-Rows | Starts | A-Rows | A-Time | Buffers |');
    expect(md).not.toContain('Cost');
    expect(md).toContain('| 0 | SELECT STATEMENT |  | 1 | 1 | 1.5K | 2.50s | 12.0K |');
    expect(md).toContain(`| 1 | ${NBSP.repeat(2)}TABLE ACCESS FULL |  | 10 | 3 | 20 | 40ms |  |`);

    const noBuffers = formatPlanAsMarkdown(
      plan([node({ id: 0, rows: 1, starts: 1, actualRows: 1, actualTime: 5 })], { hasActualStats: true })
    );
    expect(noBuffers).not.toContain('Buffers');
  });

  it('shows Cost and no actual columns for an estimate-only plan', () => {
    const md = formatPlanAsMarkdown(plan([node({ id: 0, rows: 10, cost: 25 })]));
    expect(md).toContain('| Id | Operation | Name | E-Rows | Cost |');
    expect(md).toContain('| 0 | SELECT STATEMENT |  | 10 | 25 |');
    expect(md).not.toContain('A-Rows');
  });

  it('lists predicates by node id, access before filter, in a fence', () => {
    const md = formatPlanAsMarkdown(
      plan([
        node({ id: 0 }),
        node({ id: 5, depth: 1, filterPredicates: '"A"|| \'x\'>1', accessPredicates: '"A"=1' }),
        node({ id: 2, depth: 1, filterPredicates: '"B" IS NOT NULL' }),
      ])
    );
    const block = md.slice(md.indexOf('**Predicates**'));
    expect(block).toContain('```text\n2 - filter("B" IS NOT NULL)\n5 - access("A"=1)\n5 - filter("A"|| \'x\'>1)\n```');
    expect(md).toContain('| 5 * |');
    expect(md).toContain('| 2 * |');
  });

  it('omits predicates and notes on request', () => {
    const p = plan([node({ id: 0, accessPredicates: '"A"=1' })], { notes: { rawLines: ['dynamic statistics used'] } });
    const md = formatPlanAsMarkdown(p, { includePredicates: false, includeNotes: false });
    expect(md).not.toContain('Predicates');
    expect(md).not.toContain('Notes');
  });

  it('renders notes as a list', () => {
    const md = formatPlanAsMarkdown(
      plan([node({ id: 0 })], { notes: { rawLines: ['dynamic statistics used: dynamic sampling (level=2)', 'this is an adaptive plan'] } })
    );
    expect(md).toContain('**Notes**\n\n- dynamic statistics used: dynamic sampling (level=2)\n- this is an adaptive plan');
  });

  it('includes the SQL in a fence, truncates long text with a note, and can keep it whole', () => {
    const sql = 'SELECT ' + 'x, '.repeat(1000) + 'y FROM dual';
    const p = plan([node({ id: 0 })], { sqlText: sql });

    const truncated = formatPlanAsMarkdown(p);
    expect(truncated).toContain('```sql\nSELECT x,');
    expect(truncated).toMatch(/_SQL truncated: showing the first [\d,]+ of 3,018 characters/);
    expect(truncated).not.toContain('FROM dual');

    const small = formatPlanAsMarkdown(p, { sqlMaxLength: 50 });
    expect(small).toContain('truncated');

    const full = formatPlanAsMarkdown(p, { sqlMaxLength: Infinity });
    expect(full).toContain('y FROM dual\n```');
    expect(full).not.toContain('truncated');

    const none = formatPlanAsMarkdown(p, { includeSql: false });
    expect(none).not.toContain('```sql');
  });

  it('uses a longer fence when the SQL itself contains backticks', () => {
    const md = formatPlanAsMarkdown(plan([node({ id: 0 })], { sqlText: 'select ```x``` from t' }));
    expect(md).toContain('````sql\nselect ```x``` from t\n````');
  });

  it('handles an empty plan', () => {
    const md = formatPlanAsMarkdown(plan([], { planHashValue: '7' }));
    expect(md).toBe('### Execution plan — plan hash value `7`\n\n_No plan operations to show._\n');
  });

  it('marks inactive adaptive-plan rows', () => {
    const md = formatPlanAsMarkdown(plan([node({ id: 0 }), node({ id: 1, depth: 1, operation: 'HASH JOIN', inactive: true })]));
    expect(md).toContain('HASH JOIN (not used)');
  });
});

describe('copyPlanAsMarkdown', () => {
  it('copies the Markdown and reports success', async () => {
    const spy = vi.spyOn(clipboard, 'copyToClipboard').mockResolvedValue(true);
    const notify = vi.fn();
    const p = plan([node({ id: 0 })]);
    await expect(copyPlanAsMarkdown(p, notify)).resolves.toBe(true);
    expect(spy).toHaveBeenCalledWith(formatPlanAsMarkdown(p));
    expect(notify).toHaveBeenCalledWith({ tone: 'success', message: 'Plan copied as Markdown' });
  });

  it('reports failure when the clipboard is unavailable', async () => {
    vi.spyOn(clipboard, 'copyToClipboard').mockResolvedValue(false);
    const notify = vi.fn();
    await expect(copyPlanAsMarkdown(plan([node({ id: 0 })]), notify)).resolves.toBe(false);
    expect(notify).toHaveBeenCalledWith(expect.objectContaining({ tone: 'error' }));
  });
});
