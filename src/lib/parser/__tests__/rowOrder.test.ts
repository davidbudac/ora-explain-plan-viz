import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { parsePlan } from '../index';
import { runAdvisor } from '../../advisor';
import type { ParsedPlan, PlanNode } from '../../types';

const JSON_EXAMPLE = readFileSync(
  join(__dirname, '../../../examples/12-json-JSON Plan (TPC-DS Hash Joins).txt'),
  'utf8',
);
const CSV_FIXTURE = readFileSync(join(__dirname, 'fixtures/vsqlplan-stats-allstats-19c.csv'), 'utf8');

interface Shape { id: number; children: Shape[] }
const shape = (node: PlanNode): Shape => ({ id: node.id, children: node.children.map(shape) });

const findings = (plan: ParsedPlan) =>
  runAdvisor(plan, null).findings.map(f => ({ ruleId: f.ruleId, nodeIds: f.nodeIds, title: f.title, severity: f.severity }));

/** Each parent's child IDs in V$SQL_PLAN.POSITION order, read straight from the rows. */
function childIdsByPosition(rows: { id: number; parentId: number | null; position: number }[]): Map<number, number[]> {
  const byParent = new Map<number, { id: number; position: number }[]>();
  for (const r of rows) {
    if (r.parentId === null) continue;
    byParent.set(r.parentId, [...(byParent.get(r.parentId) ?? []), r]);
  }
  return new Map([...byParent].map(([p, kids]) => [p, kids.sort((a, b) => a.position - b.position).map(k => k.id)]));
}

function expectChildOrder(plan: ParsedPlan, expected: Map<number, number[]>) {
  for (const node of plan.allNodes) {
    expect(node.children.map(c => c.id), `children of ${node.id}`).toEqual(expected.get(node.id) ?? []);
  }
}

/** RFC-4180 records (quoted fields may hold newlines). */
function csvRecords(text: string): string[] {
  const records: string[] = [];
  let start = 0;
  let inQuote = false;
  for (let i = 0; i < text.length; i++) {
    if (text[i] === '"') inQuote = !inQuote;
    else if (text[i] === '\n' && !inQuote) {
      records.push(text.slice(start, i));
      start = i + 1;
    }
  }
  if (start < text.length) records.push(text.slice(start));
  return records.filter(r => r.trim() !== '');
}

describe('V$SQL_PLAN row order does not change the plan', () => {
  it('JSON example 12: reversed array gives the same tree, POSITION-ordered children and the same findings', () => {
    const rows = JSON.parse(JSON_EXAMPLE) as { id: number; parent_id: number | null; position: number }[];
    const forward = parsePlan(JSON_EXAMPLE);
    const reversed = parsePlan(JSON.stringify([...rows].reverse()));

    const expected = childIdsByPosition(rows.map(r => ({ id: r.id, parentId: r.parent_id, position: r.position })));
    expectChildOrder(forward, expected);
    expectChildOrder(reversed, expected);
    expect(shape(reversed.rootNode!)).toEqual(shape(forward.rootNode!));
    expect(reversed.allNodes.map(n => n.id)).toEqual(forward.allNodes.map(n => n.id));
    expect(findings(reversed)).toEqual(findings(forward));
  });

  it('CSV 19c capture: reversed records give the same tree, POSITION-ordered children and the same findings', () => {
    const [header, ...records] = csvRecords(CSV_FIXTURE.replace(/\r\n/g, '\n'));
    const forward = parsePlan(CSV_FIXTURE);
    const reversed = parsePlan([header, ...[...records].reverse()].join('\n'));

    const cols = header.split(',').map(c => c.replace(/"/g, ''));
    const at = (name: string) => cols.indexOf(name);
    const rows = records.map(rec => {
      const cells = rec.split(',');
      return {
        id: Number(cells[at('ID')]),
        parentId: cells[at('PARENT_ID')] === '' ? null : Number(cells[at('PARENT_ID')]),
        position: Number(cells[at('POSITION')]),
      };
    });

    expect(reversed.allNodes).toHaveLength(forward.allNodes.length);
    expectChildOrder(reversed, childIdsByPosition(rows));
    expect(shape(reversed.rootNode!)).toEqual(shape(forward.rootNode!));
    expect(findings(reversed)).toEqual(findings(forward));
  });

  it('without POSITION, siblings fall back to operation-ID order', () => {
    const rows = [
      { id: 3, parent_id: 1, operation: 'TABLE ACCESS', options: 'FULL', object_name: 'BIG', cardinality: 1000000, cost: 900 },
      { id: 2, parent_id: 1, operation: 'TABLE ACCESS', options: 'FULL', object_name: 'SMALL', cardinality: 10, cost: 2 },
      { id: 1, parent_id: 0, operation: 'HASH JOIN', cardinality: 10, cost: 905 },
      { id: 0, parent_id: null, operation: 'SELECT STATEMENT', cardinality: 10, cost: 905 },
    ];
    const plan = parsePlan(JSON.stringify(rows));
    expect(shape(plan.rootNode!)).toEqual({ id: 0, children: [{ id: 1, children: [{ id: 2, children: [] }, { id: 3, children: [] }] }] });
  });
});
