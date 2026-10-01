import { describe, expect, it } from 'vitest';
import {
  expandTabs,
  expandTableTabs,
  normalizeNewlines,
  parseByteSize,
  parseCostCell,
  parseCount,
  parseTimeToMs,
  parseUsedMem,
  parseWorkareaExecutions,
} from '../values';

describe('parseCount', () => {
  it('reads plain numbers and commas', () => {
    expect(parseCount('786')).toBe(786);
    expect(parseCount('1,234')).toBe(1234);
  });

  it('uses 1000-based suffixes up to E', () => {
    expect(parseCount('4823K')).toBe(4_823_000);
    expect(parseCount('13M')).toBe(13_000_000);
    expect(parseCount('2G')).toBe(2e9);
    expect(parseCount('3T')).toBe(3e12);
    expect(parseCount('1P')).toBe(1e15);
    expect(parseCount('1E')).toBe(1e18);
    expect(parseCount('1.5K')).toBe(1500);
  });

  it('returns null for blanks and junk', () => {
    expect(parseCount('')).toBeNull();
    expect(parseCount('   ')).toBeNull();
    expect(parseCount('n/a')).toBeNull();
  });
});

describe('parseByteSize', () => {
  it('uses 1024-based suffixes and an optional trailing B', () => {
    expect(parseByteSize('512')).toBe(512);
    expect(parseByteSize('2048K')).toBe(2048 * 1024);
    expect(parseByteSize('10M')).toBe(10 * 1024 ** 2);
    expect(parseByteSize('1G')).toBe(1024 ** 3);
    expect(parseByteSize('2T')).toBe(2 * 1024 ** 4);
    expect(parseByteSize('1P')).toBe(1024 ** 5);
    expect(parseByteSize('1E')).toBe(1024 ** 6);
    expect(parseByteSize('4KB')).toBe(4096);
    expect(parseByteSize('512B')).toBe(512);
  });

  it('returns null for blanks and non-sizes', () => {
    expect(parseByteSize('')).toBeNull();
    expect(parseByteSize('1385K (0)')).toBeNull();
  });
});

describe('parseCostCell', () => {
  it('reads cost and %CPU', () => {
    expect(parseCostCell('123 (5)')).toEqual({ cost: 123, cpuPercent: 5 });
    expect(parseCostCell('  15234  (2)')).toEqual({ cost: 15234, cpuPercent: 2 });
    expect(parseCostCell('30 (100)')).toEqual({ cost: 30, cpuPercent: 100 });
  });

  it('reads a cost without %CPU', () => {
    expect(parseCostCell('42')).toEqual({ cost: 42 });
  });

  it('scales suffixed costs (1000-based)', () => {
    expect(parseCostCell('4823K (1)')).toEqual({ cost: 4_823_000, cpuPercent: 1 });
    expect(parseCostCell('13M  (2)')).toEqual({ cost: 13_000_000, cpuPercent: 2 });
  });

  it('returns null for an empty cell', () => {
    expect(parseCostCell('')).toBeNull();
    expect(parseCostCell('   ')).toBeNull();
  });
});

describe('parseUsedMem', () => {
  it('splits memory and pass count', () => {
    expect(parseUsedMem('1385K (0)')).toEqual({ bytes: 1385 * 1024, passes: 0 });
    expect(parseUsedMem('10M (1)')).toEqual({ bytes: 10 * 1024 ** 2, passes: 1 });
    expect(parseUsedMem('  2048 (3) ')).toEqual({ bytes: 2048, passes: 3 });
  });

  it('accepts a bare size', () => {
    expect(parseUsedMem('2048K')).toEqual({ bytes: 2048 * 1024 });
  });

  it('returns null for blank or unparseable cells', () => {
    expect(parseUsedMem('')).toBeNull();
    expect(parseUsedMem('xyz (0)')).toBeNull();
  });
});

describe('parseWorkareaExecutions', () => {
  it('reads O/1/M triples', () => {
    expect(parseWorkareaExecutions('1/0/0')).toEqual({ optimal: 1, onePass: 0, multipass: 0 });
    expect(parseWorkareaExecutions(' 2/0/0 ')).toEqual({ optimal: 2, onePass: 0, multipass: 0 });
    expect(parseWorkareaExecutions('0/3/1')).toEqual({ optimal: 0, onePass: 3, multipass: 1 });
  });

  it('returns null otherwise', () => {
    expect(parseWorkareaExecutions('')).toBeNull();
    expect(parseWorkareaExecutions('1/0')).toBeNull();
  });
});

describe('parseTimeToMs', () => {
  it('reads HH:MM:SS.ff', () => {
    expect(parseTimeToMs('00:00:00.06')).toBeCloseTo(60);
    expect(parseTimeToMs('00:01:02')).toBe(62_000);
    expect(parseTimeToMs('01:00:00.50')).toBe(3_600_500);
  });

  it('reads plain seconds and rejects blanks', () => {
    expect(parseTimeToMs('1.5')).toBe(1500);
    expect(parseTimeToMs('')).toBeNull();
  });
});

describe('tabs and newlines', () => {
  it('expands tabs to 8-column stops', () => {
    expect(expandTabs('\tx')).toBe('        x');
    expect(expandTabs('ab\tx')).toBe('ab      x');
    expect(expandTabs('12345678\tx')).toBe('12345678        x');
    expect(expandTabs('no tabs')).toBe('no tabs');
  });

  it('expands tabs only in table lines', () => {
    const out = expandTableTabs(['|\tx |', 'select\t1 from dual']);
    expect(out[0]).toBe('|       x |');
    expect(out[1]).toBe('select\t1 from dual');
  });

  it('normalises CRLF and lone CR', () => {
    expect(normalizeNewlines('a\r\nb\rc\nd')).toBe('a\nb\nc\nd');
  });
});
