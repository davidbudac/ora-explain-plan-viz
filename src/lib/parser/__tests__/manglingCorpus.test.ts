import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { parsePlan, splitPlanBatches } from '../index';
import { stripLinePrefix } from '../values';
import type { ParsedPlan } from '../../types';

const FIXTURES = join(__dirname, 'fixtures');
const EXAMPLES = join(__dirname, '../../../examples');
const fixture = (name: string): string => readFileSync(join(FIXTURES, name), 'utf-8').replace(/\r\n?/g, '\n');
const example = (name: string): string => readFileSync(join(EXAMPLES, name), 'utf-8').replace(/\r\n?/g, '\n');

/** Real captures, mangled in memory only (the files themselves are never edited). */
const CORPUS: Array<[string, string]> = [
  ['allstats-nlj-batching.txt', fixture('allstats-nlj-batching.txt')],
  ['allstats-adaptive-19c.txt', fixture('allstats-adaptive-19c.txt')],
  ['allstats-adaptive-19c-tabs.txt', fixture('allstats-adaptive-19c-tabs.txt')],
  ['awr-advanced-19c.txt', fixture('awr-advanced-19c.txt')],
  ['advanced-allstats-19c.txt', fixture('advanced-allstats-19c.txt')],
  ['17-sql_monitor (text)', example('17-sql_monitor-Exadata Cell Offload (K. Osborne).txt')],
  ['18-sql_monitor (text)', example('18-sql_monitor-Skewed Parallel (J. Lewis).txt')],
  ['26-dbms_xplan (parallel)', example('26-dbms_xplan-Parallel Query.txt')],
];

const NBSP = '\u00a0';
const perLine = (fn: (line: string, index: number) => string) => (text: string): string =>
  text.split('\n').map(fn).join('\n');

/** What mail clients, chat tools, Markdown, CSV exports and log viewers do to a pasted plan. */
const MANGLERS: Array<[string, (text: string) => string]> = [
  ['1-space indent', perLine((line) => ` ${line}`)],
  ['4-space indent (Markdown code block)', perLine((line) => `    ${line}`)],
  ['4-space indent, blank lines trimmed', perLine((line) => (line.trim() === '' ? '' : `    ${line}`))],
  ['tab indent', perLine((line) => `\t${line}`)],
  ['"> " mail quoting', perLine((line) => (line === '' ? '>' : `> ${line}`))],
  ['one double-quoted string per line', perLine((line) => `"${line}"`)],
  ['CSV-quoted lines (inner quotes doubled)', perLine((line) => `"${line.replace(/"/g, '""')}"`)],
  [
    'fixed-width log timestamp',
    perLine((line, i) => `2026-11-11 10:${String(Math.floor(i / 60) % 60).padStart(2, '0')}:${String(i % 60).padStart(2, '0')} ${line}`),
  ],
  ['every space a no-break space', (text) => text.replace(/ /g, NBSP)],
  ['space runs alternating space / no-break space', (text) => text.replace(/ {2,}/g, (run) => [...run].map((_, i) => (i % 2 ? NBSP : ' ')).join(''))],
  ['space runs alternating no-break space / space', (text) => text.replace(/ {2,}/g, (run) => [...run].map((_, i) => (i % 2 ? ' ' : NBSP)).join(''))],
];

/** The whole plan as plain data (tree links as ids), so two parses can be compared with toEqual. */
const snapshot = (plan: ParsedPlan): unknown =>
  JSON.parse(
    JSON.stringify(plan, (key, value) => {
      if (key === 'rootNode') return value ? (value as { id: number }).id : null;
      if (key === 'children') return (value as Array<{ id: number }>).map((child) => child.id);
      return value;
    }),
  );

const tree = (plan: ParsedPlan): Array<[number, number | null, number]> =>
  plan.allNodes.map((node) => [node.id, node.parentId ?? null, node.depth]);

describe('mangled pastes parse like the original capture', () => {
  describe.each(CORPUS)('%s', (_name, text) => {
    const clean = parsePlan(text);

    it.each(MANGLERS)('%s', (_label, mangle) => {
      const mangled = mangle(text);
      expect(mangled).not.toBe(text);
      const plan = parsePlan(mangled);
      expect(plan.allNodes).toHaveLength(clean.allNodes.length);
      expect(tree(plan)).toEqual(tree(clean));
      expect(plan.warnings).toBeUndefined();
      expect(snapshot(plan)).toEqual(snapshot(clean));
    });
  });

  it('returns the lines of an aligned plan untouched (same array)', () => {
    for (const [, text] of CORPUS) {
      const lines = text.split('\n');
      expect(stripLinePrefix(lines)).toBe(lines);
    }
  });

  it('still strips quotes wrapped around the whole paste', () => {
    const text = fixture('allstats-workarea.txt');
    const clean = parsePlan(text);
    const plan = parsePlan(`"${text.trim()}"`);
    expect(tree(plan)).toEqual(tree(clean));
    expect(plan.sqlId).toBe(clean.sqlId);
    expect(plan.warnings).toBeUndefined();
  });

  it('splits a mail-quoted paste of two plans at their SQL_ID headers', () => {
    const first = fixture('allstats-workarea.txt');
    const second = first.replace('child number 0', 'child number 1').replace(/Plan hash value: \d+/, 'Plan hash value: 999');
    const quoted = `${first}\n${second}`.split('\n').map((line) => (line === '' ? '>' : `> ${line}`)).join('\n');
    const batches = splitPlanBatches(quoted);
    expect(batches).toHaveLength(2);
    expect(batches[0]).toMatch(/^SQL_ID\s+\S+, child number 0/);
    expect(batches[1]).toMatch(/^SQL_ID\s+\S+, child number 1/);
    expect(batches.map((batch) => parsePlan(batch).planHashValue)).toEqual([parsePlan(first).planHashValue, '999']);
  });
});

describe('plan-table rows that cannot be used', () => {
  const WORKAREA = fixture('allstats-workarea.txt');
  const lines = WORKAREA.split('\n');
  const headerIndex = lines.findIndex((line) => /\|\s*Id\s*\|/.test(line));

  it('warns when the header row is there but no row below it could be read', () => {
    const plan = parsePlan(lines.slice(0, headerIndex + 2).join('\n'));
    expect(plan.rootNode).toBeNull();
    expect((plan.warnings ?? []).map((w) => w.code)).toEqual(['no_plan_rows']);
  });

  it('warns when rows cannot be attached to the tree because the indentation was lost', () => {
    // Collapse the Operation cell's indentation to one space, keeping the column width.
    const flattened = lines
      .map((line) => {
        if (!/^\|[^|]*\d[^|]*\|/.test(line)) return line;
        const cells = line.split('|');
        cells[2] = ` ${cells[2].trim()}`.padEnd(cells[2].length);
        return cells.join('|');
      })
      .join('\n');
    const plan = parsePlan(flattened);
    const clean = parsePlan(WORKAREA);
    expect(plan.allNodes).toHaveLength(clean.allNodes.length);
    const warning = (plan.warnings ?? []).find((w) => w.code === 'disconnected_rows');
    expect(warning?.message).toContain(`${clean.allNodes.length - 1} operations`);
    expect(warning?.message).toContain('ids 1, 2, 3');
  });
});
