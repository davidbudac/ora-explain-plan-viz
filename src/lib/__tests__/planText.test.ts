import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import {
  parsePlanTableRowId,
  buildLineOperationMap,
  splitLines,
  findTextMatches,
  segmentLine,
} from '../planText';

function example(name: string): string {
  return readFileSync(join(__dirname, '../../examples', name), 'utf-8');
}

describe('parsePlanTableRowId', () => {
  it.each<[string, number | null]>([
    ['|   0 | SELECT STATEMENT               |', 0],
    ['|   4 |     HASH GROUP BY              |', 4],
    ['|*  2 |   HASH JOIN                    |', 2],
    ['|* 12 |      HASH JOIN                 |', 12],
    ['|  -> 6 |        BUFFER SORT            |', 6],
    ['| -> 0 | SELECT STATEMENT |', 0],
    ['|-* 3 |    NESTED LOOPS  |', 3],
    ['|-  4 |     STATISTICS COLLECTOR |', 4],
    ['| 0 | SELECT STATEMENT |', 0],
    ['| Id  | Operation                      | Name |', null],
    ['-------------------------------------------', null],
    ['   3 - access("E"."ID"=:1)', null],
    ['Plan hash value: 3456789012', null],
    ['', null],
  ])('%s → %s', (line, expected) => {
    expect(parsePlanTableRowId(line)).toBe(expected);
  });
});

describe('buildLineOperationMap', () => {
  const text = [
    'Plan hash value: 1234567890',
    '',
    '---------------------------------------',
    '| Id  | Operation          | Name     |',
    '---------------------------------------',
    '|   0 | SELECT STATEMENT   |          |',
    '|*  1 |  HASH JOIN         |          |',
    '|   2 |   TABLE ACCESS FULL| DEPT     |',
    '---------------------------------------',
    '',
    'Predicate Information (identified by operation id):',
    '---------------------------------------------------',
    '',
    '   1 - access("E"."DEPT_ID"="D"."ID")',
    '       filter("E"."SAL">1000 AND',
    '              "E"."X"=1)',
    '',
    '   2 - filter("D"."LOC"=\'NY\')',
    '',
    'Note',
    '-----',
    '   - dynamic statistics used: dynamic sampling (level=2)',
    '   5 - this is not an entry any more',
  ].join('\n');

  const map = buildLineOperationMap(text);

  it('returns one entry per line', () => {
    expect(map).toHaveLength(splitLines(text).length);
  });

  it('maps plan-table rows and ignores header / rule lines', () => {
    expect(map[3]).toBeNull(); // | Id | Operation |
    expect(map[5]).toBe(0);
    expect(map[6]).toBe(1);
    expect(map[7]).toBe(2);
    expect(map[8]).toBeNull();
  });

  it('maps predicate entries and their continuation lines', () => {
    expect(map[10]).toBeNull(); // header
    expect(map[13]).toBe(1);
    expect(map[14]).toBe(1);
    expect(map[15]).toBe(1);
    expect(map[16]).toBeNull(); // blank separator
    expect(map[17]).toBe(2);
  });

  it('stops at the next top-level section', () => {
    expect(map[19]).toBeNull(); // Note
    expect(map[21]).toBeNull();
    expect(map[22]).toBeNull();
  });

  it('handles Hint Report "Total hints" preamble and CRLF input', () => {
    const hint = [
      'Hint Report (identified by operation id / Query Block Name / Object Alias):',
      'Total hints for statement: 1',
      '---------------------------------------------------------------------------',
      '',
      '   3 -  SEL$1 / E@SEL$1',
      '           -  FULL(e)',
    ].join('\r\n');
    const m = buildLineOperationMap(hint);
    expect(m[4]).toBe(3);
    expect(m[5]).toBe(3);
    expect(m[1]).toBeNull();
  });

  it('maps every plan row of a real DBMS_XPLAN example', () => {
    const raw = example('02-dbms_xplan-Complex Plan.txt');
    const lines = splitLines(raw);
    const m = buildLineOperationMap(raw);
    const rowIds = lines
      .map((line, i) => (line.startsWith('|') && parsePlanTableRowId(line) !== null ? m[i] : undefined))
      .filter((id): id is number => typeof id === 'number');
    expect(rowIds.slice(0, 17)).toEqual(Array.from({ length: 17 }, (_, i) => i));
    // Query Block Name entries map too.
    const qbIndex = lines.findIndex((l) => l.startsWith('Query Block Name'));
    expect(qbIndex).toBeGreaterThan(0);
    const firstEntry = lines.findIndex((l, i) => i > qbIndex && /^\s+1 - SEL\$1/.test(l));
    expect(m[firstEntry]).toBe(1);
  });

  it('maps SQL Monitor "->" active rows', () => {
    const raw = example('18-sql_monitor-Skewed Parallel (J. Lewis).txt');
    const lines = splitLines(raw);
    const m = buildLineOperationMap(raw);
    const idx = lines.findIndex((l) => l.includes('-> 6 |'));
    expect(idx).toBeGreaterThan(0);
    expect(m[idx]).toBe(6);
  });
});

describe('findTextMatches', () => {
  const lines = ['HASH JOIN', 'TABLE ACCESS FULL | EMP', 'hash join outer', 'aaaa'];

  it('finds case-insensitive matches in document order', () => {
    expect(findTextMatches(lines, 'hash join')).toEqual([
      { line: 0, start: 0, end: 9 },
      { line: 2, start: 0, end: 9 },
    ]);
  });

  it('treats the query literally (regex metacharacters escaped)', () => {
    expect(findTextMatches(lines, '| EMP')).toEqual([{ line: 1, start: 18, end: 23 }]);
    expect(findTextMatches(['a.b', 'axb'], '.')).toEqual([{ line: 0, start: 1, end: 2 }]);
  });

  it('returns non-overlapping matches', () => {
    expect(findTextMatches(lines, 'aa')).toEqual([
      { line: 3, start: 0, end: 2 },
      { line: 3, start: 2, end: 4 },
    ]);
  });

  it('matches nothing for an empty or blank query', () => {
    expect(findTextMatches(lines, '')).toEqual([]);
    expect(findTextMatches(lines, '   ')).toEqual([]);
  });
});

describe('segmentLine', () => {
  type Kind = 'filter' | 'match' | 'current';
  const priority: Kind[] = ['filter', 'match', 'current'];

  it('returns a single plain segment without ranges', () => {
    expect(segmentLine<Kind>(5, [], priority)).toEqual([{ start: 0, end: 5, kind: null }]);
    expect(segmentLine<Kind>(0, [], priority)).toEqual([]);
  });

  it('splits around ranges and lets the higher-priority kind win overlaps', () => {
    const segs = segmentLine<Kind>(10, [
      { start: 0, end: 6, kind: 'filter' },
      { start: 4, end: 8, kind: 'current' },
    ], priority);
    expect(segs).toEqual([
      { start: 0, end: 4, kind: 'filter' },
      { start: 4, end: 8, kind: 'current' },
      { start: 8, end: 10, kind: null },
    ]);
  });

  it('merges adjacent segments of the same kind and clamps out-of-range ranges', () => {
    const segs = segmentLine<Kind>(6, [
      { start: 0, end: 2, kind: 'match' },
      { start: 2, end: 4, kind: 'match' },
      { start: 5, end: 99, kind: 'filter' },
      { start: -3, end: 0, kind: 'current' },
    ], priority);
    expect(segs).toEqual([
      { start: 0, end: 4, kind: 'match' },
      { start: 4, end: 5, kind: null },
      { start: 5, end: 6, kind: 'filter' },
    ]);
  });
});
