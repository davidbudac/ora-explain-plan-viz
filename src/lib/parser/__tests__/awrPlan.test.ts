import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { parsePlan } from '../index';

// Real Oracle 19.27 capture (dbmint, PDB1, 2026-11-06): what
// `@plan_to_url.sql 5rt99cxvjpbrz "" AWR 2468804666` embeds in its link, i.e.
// DBMS_XPLAN.DISPLAY_WORKLOAD_REPOSITORY(format => 'ADVANCED') output. AWR
// output has a bare `SQL_ID` header (no child number), no runtime columns and
// a trailing "Query Block Registry" section.
const AWR = readFileSync(join(__dirname, 'fixtures', 'awr-advanced-19c.txt'), 'utf-8');

describe('AWR plan (DISPLAY_WORKLOAD_REPOSITORY ADVANCED, 19c)', () => {
  const plan = parsePlan(AWR);
  const node = (id: number) => plan.allNodes.find((n) => n.id === id)!;

  it('reads the header: sql_id, plan hash value and SQL text', () => {
    expect(plan.sqlId).toBe('5rt99cxvjpbrz');
    expect(plan.planHashValue).toBe('2468804666');
    expect(plan.sqlText).toMatch(/^DELETE FROM order_events WHERE order_id IN/);
  });

  it('parses the plan as estimates only, without warnings', () => {
    expect(plan.allNodes).toHaveLength(6);
    expect(plan.hasActualStats).toBe(false);
    expect(node(5).actualRows).toBeUndefined();
    expect(plan.warnings).toBeUndefined();
  });

  it('keeps the predicates, query blocks, outline and peeked binds AWR stores', () => {
    expect(node(2).accessPredicates).toBe('"ORDER_ID"="ID"');
    expect(node(4).accessPredicates).toBe('"CREATED_AT"<:1');
    expect(node(5).queryBlock).toBe('SEL$3BA1AD7C');
    expect(plan.outlineHints).toContain('USE_HASH(@"SEL$3BA1AD7C" "ORDER_EVENTS"@"DEL$1")');
    expect(plan.bindVariables).toEqual([
      expect.objectContaining({ name: ':1', type: 'TIMESTAMP', position: 1 }),
    ]);
  });
});
