import type { ActivitySample, ActivityTimeline } from './types';

export const WAIT_CLASS_COLORS: Record<string, string> = {
  'Cpu': '#22c55e',
  'User I/O': '#3b82f6',
  'System I/O': '#0e7490',
  'Concurrency': '#991b1b',
  'Application': '#ef4444',
  'Commit': '#f97316',
  'Configuration': '#a16207',
  'Network': '#8b5cf6',
  'Scheduler': '#84cc16',
  'Cluster': '#78716c',
  'Other': '#f59e0b',
};

const WAIT_CLASS_COLORS_LOWER: Record<string, string> = Object.fromEntries(
  Object.entries(WAIT_CLASS_COLORS).map(([k, v]) => [k.toLowerCase(), v])
);

/** Look up a wait class color, case-insensitively ('CPU' === 'Cpu'), falling back to 'Other'. */
export function getWaitClassColor(waitClass: string): string {
  return WAIT_CLASS_COLORS_LOWER[waitClass.toLowerCase()] ?? WAIT_CLASS_COLORS['Other'];
}

export interface LineActivity {
  line: number;
  total: number;
  byClass: { waitClass: string; count: number; events: { event: string; count: number }[] }[];
}

/** Aggregate ASH samples per plan line. Samples without a line are excluded. */
export function aggregateActivityByLine(timeline: ActivityTimeline): LineActivity[] {
  const byLine = new Map<number, Map<string, Map<string | undefined, number>>>();

  for (const sample of timeline.samples) {
    if (sample.line === undefined) continue;
    let classMap = byLine.get(sample.line);
    if (!classMap) {
      classMap = new Map();
      byLine.set(sample.line, classMap);
    }
    let eventMap = classMap.get(sample.waitClass);
    if (!eventMap) {
      eventMap = new Map();
      classMap.set(sample.waitClass, eventMap);
    }
    eventMap.set(sample.event, (eventMap.get(sample.event) ?? 0) + sample.count);
  }

  const result: LineActivity[] = [];
  for (const [line, classMap] of byLine) {
    let total = 0;
    const byClass: LineActivity['byClass'] = [];
    for (const [waitClass, eventMap] of classMap) {
      let classCount = 0;
      const events: { event: string; count: number }[] = [];
      for (const [event, count] of eventMap) {
        classCount += count;
        if (event !== undefined) events.push({ event, count });
      }
      events.sort((a, b) => b.count - a.count);
      byClass.push({ waitClass, count: classCount, events });
      total += classCount;
    }
    byClass.sort((a, b) => b.count - a.count);
    result.push({ line, total, byClass });
  }

  result.sort((a, b) => b.total - a.total);
  return result;
}

/** Group ASH samples by bucket number, for timeline rendering. */
export function aggregateActivityByBucket(timeline: ActivityTimeline): Map<number, ActivitySample[]> {
  const byBucket = new Map<number, ActivitySample[]>();
  for (const sample of timeline.samples) {
    let arr = byBucket.get(sample.bucket);
    if (!arr) {
      arr = [];
      byBucket.set(sample.bucket, arr);
    }
    arr.push(sample);
  }
  return byBucket;
}
