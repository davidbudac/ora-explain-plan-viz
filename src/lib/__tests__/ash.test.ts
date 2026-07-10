import { describe, it, expect } from 'vitest';
import { WAIT_CLASS_COLORS, getWaitClassColor, aggregateActivityByLine, aggregateActivityByBucket } from '../ash';
import type { ActivityTimeline } from '../types';

const timeline: ActivityTimeline = {
  durationSecs: 5,
  bucketIntervalSecs: 1,
  bucketCount: 5,
  samples: [
    { bucket: 1, line: 4, waitClass: 'Cpu', count: 3 },
    { bucket: 2, line: 4, waitClass: 'User I/O', event: 'db file sequential read', count: 2 },
    { bucket: 3, line: 4, waitClass: 'User I/O', event: 'db file sequential read', count: 1 },
    { bucket: 3, line: 2, waitClass: 'Cpu', count: 1 },
    { bucket: 4, waitClass: 'Cpu', count: 1 }, // no line — excluded from per-line aggregation
  ],
};

describe('getWaitClassColor', () => {
  it('returns the mapped color', () => {
    expect(getWaitClassColor('User I/O')).toBe(WAIT_CLASS_COLORS['User I/O']);
  });
  it('is case-insensitive', () => {
    expect(getWaitClassColor('CPU')).toBe(WAIT_CLASS_COLORS['Cpu']);
    expect(getWaitClassColor('cpu')).toBe(WAIT_CLASS_COLORS['Cpu']);
  });
  it('falls back to Other for unknown classes', () => {
    expect(getWaitClassColor('Made Up Class')).toBe(WAIT_CLASS_COLORS['Other']);
  });
});

describe('aggregateActivityByLine', () => {
  const result = aggregateActivityByLine(timeline);

  it('excludes samples without a line', () => {
    const total = result.reduce((s, l) => s + l.total, 0);
    expect(total).toBe(7); // 3+2+1+1, not the +1 from the lineless sample
  });

  it('sorts lines by total desc', () => {
    // line 4: 3 (Cpu) + 2 (User I/O) + 1 (User I/O) = 6; line 2: 1 (Cpu)
    expect(result.map((l) => l.line)).toEqual([4, 2]);
    expect(result[0].total).toBe(6);
    expect(result[1].total).toBe(1);
  });

  it('groups and sums events within a class, sorted desc', () => {
    const line4 = result.find((l) => l.line === 4)!;
    const userIo = line4.byClass.find((c) => c.waitClass === 'User I/O')!;
    expect(userIo.count).toBe(3); // 2 + 1
    expect(userIo.events).toEqual([{ event: 'db file sequential read', count: 3 }]);
  });
});

describe('aggregateActivityByBucket', () => {
  it('groups samples by bucket number', () => {
    const byBucket = aggregateActivityByBucket(timeline);
    expect(byBucket.get(3)).toHaveLength(2); // line-4 User I/O + line-2 Cpu
    expect(byBucket.get(1)).toHaveLength(1);
  });
});
