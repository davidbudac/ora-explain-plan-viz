import { describe, expect, it } from 'vitest';
import { SAMPLE_PLANS } from '../../examples';
import { parsePlan } from '../parser';
import {
  buildReplayScript,
  curveTimeWhen,
  curveValueAt,
  formatReplayTime,
  replayRoleAt,
  replayStateAt,
} from '../replay';
import type { ReplayScript } from '../replay';
import { buildPlan } from './fixtures/buildPlan';

function script(plan: Parameters<typeof buildReplayScript>[0]): ReplayScript {
  const s = buildReplayScript(plan);
  if (!s) throw new Error('no script');
  return s;
}

const track = (s: ReplayScript, id: number) => s.tracks.get(id)!;
const roles = (s: ReplayScript, id: number) => track(s, id).spans.map((sp) => sp.role);

describe('replay curves', () => {
  const curve: [number, number][] = [[0, 0], [10, 0], [20, 100], [30, 100]];

  it('interpolates and clamps', () => {
    expect(curveValueAt(curve, -5)).toBe(0);
    expect(curveValueAt(curve, 15)).toBe(50);
    expect(curveValueAt(curve, 99)).toBe(100);
    expect(curveValueAt([], 3)).toBe(0);
  });

  it('finds when a value is reached', () => {
    expect(curveTimeWhen(curve, 50)).toBe(15);
    expect(curveTimeWhen(curve, 100)).toBe(20);
    expect(curveTimeWhen(curve, 101)).toBeUndefined();
  });
});

describe('buildReplayScript: row-source order', () => {
  it('consumes the hash join build side before the probe side', () => {
    const s = script(buildPlan({
      id: 0, op: 'SELECT STATEMENT', actualRows: 10, starts: 1,
      kids: [{
        id: 1, op: 'HASH JOIN', rows: 10, actualRows: 10, starts: 1,
        kids: [
          { id: 2, op: 'TABLE ACCESS FULL', objectName: 'DIM', rows: 100, actualRows: 100, starts: 1 },
          { id: 3, op: 'TABLE ACCESS FULL', objectName: 'FACT', rows: 1000, actualRows: 1000, starts: 1 },
        ],
      }],
    }));
    expect(s.tier).toBe('weighted');
    expect(s.unit).toBe('%');
    expect(s.duration).toBeCloseTo(100, 0);
    expect(track(s, 2).lastActive).toBeLessThanOrEqual(track(s, 3).firstActive + 1e-9);
    expect(roles(s, 1)[0]).toBe('fill');
    expect(roles(s, 1).at(-1)).toBe('emit');
    expect(track(s, 1).fill).toBeDefined();

    const build = s.chapters.find((c) => c.kind === 'build');
    expect(build?.focus).toEqual([1, 2, 3]);
    expect(build?.caption).toContain('DIM');
    expect(build?.caption).toContain('FACT');
    expect(build?.t).toBeCloseTo(track(s, 2).lastActive, 6);
  });

  it('runs the inner side of a nested loop once per outer row, interleaved with the outer side', () => {
    const s = script(buildPlan({
      id: 0, op: 'SELECT STATEMENT', actualRows: 500, starts: 1,
      kids: [{
        id: 1, op: 'NESTED LOOPS', rows: 5, actualRows: 500, starts: 1,
        kids: [
          { id: 2, op: 'TABLE ACCESS FULL', objectName: 'ORDERS', rows: 5, actualRows: 500, starts: 1 },
          { id: 3, op: 'INDEX UNIQUE SCAN', objectName: 'CUST_PK', rows: 1, actualRows: 500, starts: 500 },
        ],
      }],
    }));
    const outer = track(s, 2);
    const inner = track(s, 3);
    expect(inner.perStart).toBe(true);
    expect(outer.perStart).toBe(false);
    expect(inner.startsTotal).toBe(500);
    // Planned starts come from the optimizer's E-Rows of the driving side.
    expect(inner.plannedStarts).toBe(5);
    expect(inner.firstActive).toBeLessThan(outer.lastActive);
    const loops = s.chapters.find((c) => c.kind === 'loops');
    expect(loops?.title).toBe('#3 runs 500 times');
    expect(loops?.caption).toContain('planned for about 5');
    // Starts climb with playback.
    const mid = (inner.firstActive + inner.lastActive) / 2;
    expect(replayStateAt(inner, mid).starts).toBeGreaterThan(0);
    expect(replayStateAt(inner, mid).starts).toBeLessThan(500);
  });

  it('fills a blocking sort before it returns rows, and spills past the memory limit', () => {
    const s = script(buildPlan({
      id: 0, op: 'SELECT STATEMENT', actualRows: 1000, starts: 1,
      kids: [{
        id: 1, op: 'SORT ORDER BY', rows: 1000, actualRows: 1000, starts: 1, tempUsed: 90 * 1024 * 1024, memoryUsed: 10 * 1024 * 1024,
        kids: [{ id: 2, op: 'TABLE ACCESS FULL', objectName: 'BIG', rows: 1000, actualRows: 1000, starts: 1 }],
      }],
    }));
    const sort = track(s, 1);
    expect(roles(s, 1)).toEqual(['fill', 'drain']);
    expect(replayRoleAt(sort, sort.firstActive)).toBe('fill');
    // Nothing leaves the sort before its input is complete.
    const drainFrom = sort.spans[1].from;
    expect(drainFrom).toBeGreaterThanOrEqual(track(s, 2).lastActive - 1e-9);
    expect(replayStateAt(sort, drainFrom - 1e-6).rows).toBe(0);
    expect(track(s, 0).firstActive).toBeGreaterThanOrEqual(drainFrom - 1e-9);

    expect(sort.memLimit).toBeCloseTo(0.1, 6);
    expect(sort.spillPredicted).toBe(false);
    expect(sort.spillAt).toBeGreaterThan(sort.firstActive);
    expect(sort.spillAt).toBeLessThan(drainFrom);
    expect(replayStateAt(sort, sort.spillAt! + 1e-3).spilling).toBe(true);
    expect(s.chapters.map((c) => c.kind)).toEqual(expect.arrayContaining(['spill', 'drain']));
  });

  it('runs the children of UNION ALL one after the other', () => {
    const s = script(buildPlan({
      id: 0, op: 'UNION-ALL', actualRows: 20, starts: 1,
      kids: [
        { id: 1, op: 'TABLE ACCESS FULL', rows: 10, actualRows: 10, starts: 1 },
        { id: 2, op: 'TABLE ACCESS FULL', rows: 10, actualRows: 10, starts: 1 },
      ],
    }));
    expect(track(s, 1).lastActive).toBeLessThanOrEqual(track(s, 2).firstActive + 1e-9);
  });
});

describe('buildReplayScript: what is replayed', () => {
  it('drops inactive adaptive rows and operations that never started', () => {
    const s = script(buildPlan({
      id: 0, op: 'SELECT STATEMENT', actualRows: 1, starts: 1,
      kids: [{
        id: 1, op: 'HASH JOIN', actualRows: 1, starts: 1,
        kids: [
          { id: 2, op: 'NESTED LOOPS', inactive: true, kids: [{ id: 3, op: 'TABLE ACCESS FULL', actualRows: 1, starts: 1 }] },
          { id: 4, op: 'TABLE ACCESS FULL', actualRows: 1, starts: 1 },
          { id: 5, op: 'TABLE ACCESS FULL', actualRows: 0, starts: 0 },
        ],
      }],
    }));
    const ids = s.order.map((tr) => tr.id);
    expect(ids).not.toContain(2);
    expect(ids).not.toContain(5);
    expect(ids).toContain(3);
  });

  it('simulates from estimates when nothing was measured', () => {
    const s = script(buildPlan({
      id: 0, op: 'SELECT STATEMENT', cost: 10, selfCost: 0, rows: 50,
      kids: [{ id: 1, op: 'TABLE ACCESS FULL', cost: 10, selfCost: 10, rows: 50 }],
    }, 'dbms_xplan'));
    expect(s.tier).toBe('simulated');
    expect(s.tierReason).toMatch(/Nothing was measured/);
    expect(track(s, 1).rowsTotal).toBe(50);
    expect(s.chapters.some((c) => c.kind === 'estimate')).toBe(false);
  });

  it('announces a misestimate when the actual rows pass the estimate', () => {
    const s = script(buildPlan({
      id: 0, op: 'SELECT STATEMENT', actualRows: 5000, starts: 1,
      kids: [{ id: 1, op: 'TABLE ACCESS FULL', objectName: 'T', rows: 10, estimatedRowsTotal: 10, actualRows: 5000, starts: 1 }],
    }));
    const est = s.chapters.find((c) => c.kind === 'estimate');
    expect(est?.focus[0]).toBe(1);
    // At the crossing, give or take the sliver that separates it from the start chapter.
    const crossing = curveTimeWhen(track(s, 1).emit, 10)!;
    expect(est!.t).toBeGreaterThanOrEqual(crossing);
    expect(est!.t - crossing).toBeLessThanOrEqual(s.duration * 0.01);
  });

  it('formats script time by unit', () => {
    const s = script(buildPlan({ id: 0, op: 'SELECT STATEMENT', actualRows: 1, starts: 1 }));
    expect(formatReplayTime(s, 42.4)).toBe('42%');
    expect(formatReplayTime({ ...s, unit: 's' }, 4.25)).toBe('4.3 s');
  });
});

describe('buildReplayScript: SQL Monitor statement duration', () => {
  const example = (name: string) => script(parsePlan(SAMPLE_PLANS.find((x) => x.name.includes(name))!.data));
  const done = (s: ReplayScript) => s.chapters.find((c) => c.kind === 'done')!;

  it('ends a text report with its Global Information Duration, not the root active window', () => {
    // Duration : 13s; the root's Time Active(s) is 1.
    expect(done(example('Exadata Cell Offload')).caption).toMatch(/^1 row returned in 13 s\./);
  });

  it('ends an XML report with its target duration, not the elapsed time summed over PX processes', () => {
    // <duration>.0861</duration>; the global elapsed_time of 325716 µs adds up the QC and 8 PX servers.
    const s = example('Partitioned Star Query');
    expect(done(s).caption).toMatch(/^120 rows returned in 86 ms\./);
    expect(s.tierReason).toContain('(86 ms)');
  });

  it('does not report a completion for a statement still executing when the report was taken', () => {
    // Status : EXECUTING, Duration : 221s.
    const caption = done(example('Skewed Parallel')).caption;
    expect(caption).toMatch(/still executing/i);
    expect(caption).toContain('221 s');
    expect(caption).not.toMatch(/returned in/);
  });

  it('names no duration when the report has none', () => {
    const text = SAMPLE_PLANS.find((x) => x.name.includes('Exadata Cell Offload'))!.data;
    const lines = text.split('\n');
    const from = lines.findIndex((l) => l.startsWith('Global Information'));
    const to = lines.findIndex((l) => l.startsWith('Parallel Execution Details'));
    const s = script(parsePlan([...lines.slice(0, from), ...lines.slice(to)].join('\n')));
    expect(done(s).caption).toMatch(/^1 row returned\./);
  });
});

describe('buildReplayScript: hotspot from measured activity', () => {
  const example = (name: string) => script(parsePlan(SAMPLE_PLANS.find((x) => x.name.includes(name))!.data));
  const done = (s: ReplayScript) => s.chapters.find((c) => c.kind === 'done')!;

  it('names the operation with the most ASH activity, at its Activity %', () => {
    // Activity (%): #4 SORT AGGREGATE 50.52, #5 PX BLOCK ITERATOR 45.36, #6 TABLE ACCESS STORAGE FULL 3.09.
    const s = example('Exadata Cell Offload');
    expect(s.hotspotId).toBe(4);
    expect(done(s).caption).toContain('Most of the work: #4 SORT AGGREGATE (51%).');
  });

  it('places a text report on the timeline from its Start Active offsets', () => {
    // | 4 | SORT AGGREGATE | ... | 13 | +1 |   | 0 | SELECT STATEMENT | ... | 1 | +13 |
    const s = example('Exadata Cell Offload');
    expect(s.tier).toBe('measured');
    expect(s.unit).toBe('s');
    expect(track(s, 4).firstActive).toBe(1);
    expect(track(s, 0).firstActive).toBe(13);
  });

  it('takes the hotspot from activity even when the animation is paced by rows', () => {
    const s = script(buildPlan({
      id: 0, op: 'SELECT STATEMENT', actualRows: 10, starts: 1,
      kids: [{
        id: 1, op: 'HASH JOIN', rows: 10, actualRows: 10, starts: 1, activityPercent: 5,
        kids: [
          { id: 2, op: 'TABLE ACCESS FULL', objectName: 'DIM', rows: 100, actualRows: 100, starts: 1, activityPercent: 80 },
          { id: 3, op: 'TABLE ACCESS FULL', objectName: 'FACT', rows: 1_000_000, actualRows: 1_000_000, starts: 1, activityPercent: 15 },
        ],
      }],
    }));
    expect(s.tier).toBe('weighted');
    expect(s.hotspotId).toBe(2);
    expect(done(s).caption).toContain('Most of the work: #2 TABLE ACCESS FULL DIM (80%).');
  });
});

describe('buildReplayScript on the bundled examples', () => {
  const scripts = SAMPLE_PLANS.map((sample) => ({ name: sample.name, s: buildReplayScript(parsePlan(sample.data)) }));

  it('uses real time for a SQL Monitor report with activity', () => {
    const { s } = scripts.find((x) => x.name.includes('Window Sort Spill'))!;
    expect(s?.tier).toBe('measured');
    expect(s?.unit).toBe('s');
    expect(s?.ash).toBeDefined();
    expect(s?.chapters.some((c) => c.kind === 'spill')).toBe(true);
  });

  it.each(scripts.map((x) => [x.name, x.s] as const))('%s: consistent script', (_name, s) => {
    expect(s).not.toBeNull();
    const { duration, chapters, order } = s!;
    expect(Number.isFinite(duration)).toBe(true);
    expect(duration).toBeGreaterThan(0);
    // Chapters are in order, inside the script, and end with "Done".
    for (let i = 1; i < chapters.length; i++) expect(chapters[i].t).toBeGreaterThanOrEqual(chapters[i - 1].t);
    for (const c of chapters) {
      expect(c.t).toBeGreaterThanOrEqual(0);
      expect(c.t).toBeLessThanOrEqual(duration + 1e-9);
    }
    expect(chapters.at(-1)?.kind).toBe('done');
    for (const tr of order) {
      // Rows only ever go up, and end at the operation's total.
      for (let i = 1; i < tr.emit.length; i++) expect(tr.emit[i][1]).toBeGreaterThanOrEqual(tr.emit[i - 1][1] - 1e-6);
      if (tr.spans.length) expect(curveValueAt(tr.emit, duration + 1)).toBeCloseTo(tr.rowsTotal, 3);
      expect(tr.work).toBeGreaterThanOrEqual(0);
    }
  });
});
