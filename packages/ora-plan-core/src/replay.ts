// Plan replay: turns a parsed plan into a time-based "script" the Replay view
// plays back. Per operation it records when the operation is active and in
// which role (consuming input into a work area, emitting rows, draining a sort,
// waiting), cumulative rows/starts curves, work-area fill and spill, plus
// generated chapters with captions.
//
// Three fidelity tiers:
//  - measured:  SQL Monitor active windows + ASH buckets (real seconds)
//  - weighted:  row-source semantics for order, A-Rows/Starts (or A-Time) for durations
//  - simulated: row-source semantics for order, optimizer self cost for durations
//
// Row-source semantics: a hash join consumes its build side fully before
// probing; a nested loop / FILTER runs its inner side once per outer row;
// blocking operations (SORT, HASH GROUP BY, WINDOW, BUFFER SORT, HASH UNIQUE)
// fill first and drain afterwards; n-ary operations (UNION ALL, ...) run their
// children one after the other.

import type { ActivitySample, ParsedPlan, PlanNode } from './types.ts';
import { computeHottestNodeId, effectiveChildren, usesActivityRanking } from './analysis.ts';
import {
  cardinalityRatioSeverity,
  formatBytes,
  formatCardinalityRatio,
  formatNumberShort,
  nodeCardinalityRatio,
} from './format.ts';

export type ReplayTier = 'measured' | 'weighted' | 'simulated';
export type ReplayOpKind = 'scan' | 'stream' | 'blocking' | 'hashjoin' | 'nestedloop' | 'merge' | 'nary' | 'stopkey';
export type ReplayRole = 'emit' | 'fill' | 'drain' | 'wait';
/** Piecewise-linear [t, value] points, sorted by t. */
export type ReplayCurve = [number, number][];

export interface ReplaySpan {
  from: number;
  to: number;
  role: ReplayRole;
}

export interface ReplayTrack {
  id: number;
  node: PlanNode;
  kind: ReplayOpKind;
  label: string;
  depth: number;
  parentId?: number;
  childIds: number[];
  /** Child whose rows drive this op (outer side of NL, build side of HJ, sort input). */
  driverChildId?: number;
  rowsTotal: number;
  /** Optimizer total (E-Rows × starts, see `estimatedRowsTotal`); comparable with A-Rows. */
  rowsEstimate?: number;
  startsTotal: number;
  /** Starts the optimizer planned for (E-Rows of the driving side, compounded). */
  plannedStarts: number;
  /** Rows the optimizer planned for: E-Rows × planned starts (narrative use; ratios use rowsEstimate). */
  rowsPlanned?: number;
  /** Runs once per row of an enclosing NESTED LOOPS / FILTER. */
  perStart: boolean;
  spans: ReplaySpan[];
  emit: ReplayCurve;
  starts: ReplayCurve;
  /** Work-area fill level (0..1) over time; blocking operations and hash joins only. */
  fill?: ReplayCurve;
  /** Fill level (0..1) where the work area ran out of memory. */
  memLimit?: number;
  spillAt?: number;
  tempBytes?: number;
  memBytes?: number;
  /** Spill is the optimizer's estimate (TempSpc), not measured. */
  spillPredicted?: boolean;
  buildEnd?: number;
  /** Share of all work (0..1). */
  work: number;
  firstActive: number;
  lastActive: number;
}

export type ReplayChapterKind = 'start' | 'build' | 'spill' | 'drain' | 'loops' | 'estimate' | 'first-row' | 'done';

export interface ReplayChapter {
  t: number;
  kind: ReplayChapterKind;
  title: string;
  caption: string;
  /** Operations the chapter is about; the first one is the main subject. */
  focus: number[];
}

export interface ReplayAshIndex {
  bucketSecs: number;
  bucketCount: number;
  /** key `${bucket}:${line}` → samples */
  byBucketLine: Map<string, ActivitySample[]>;
  /** per bucket (1-based, like SQL Monitor) → wait class → count, all lines */
  byBucket: Map<number, Map<string, number>>;
  maxBucketTotal: number;
}

export interface ReplayScript {
  tier: ReplayTier;
  tierReason: string;
  duration: number;
  /** 's' → script time is real seconds; '%' → share of total work. */
  unit: 's' | '%';
  rootId: number;
  /** Executed operations in plan (pre-)order. */
  order: ReplayTrack[];
  tracks: Map<number, ReplayTrack>;
  chapters: ReplayChapter[];
  ash?: ReplayAshIndex;
  hotspotId?: number;
  /** Wall-clock duration of the statement (SQL Monitor's Duration, else the root's A-Time). */
  durationMs?: number;
  /** SQL Monitor took the report before the statement finished (status other than DONE…). */
  stillRunning?: boolean;
}

// ---------------------------------------------------------------------------
// Curves and state
// ---------------------------------------------------------------------------

export function curveValueAt(curve: ReplayCurve, t: number): number {
  if (curve.length === 0) return 0;
  if (t <= curve[0][0]) return curve[0][1];
  const last = curve[curve.length - 1];
  if (t >= last[0]) return last[1];
  for (let i = 1; i < curve.length; i++) {
    const [t1, v1] = curve[i];
    if (t <= t1) {
      const [t0, v0] = curve[i - 1];
      if (t1 === t0) return v1;
      return v0 + ((v1 - v0) * (t - t0)) / (t1 - t0);
    }
  }
  return last[1];
}

/** Earliest t where the (non-decreasing) curve reaches `value`, or undefined. */
export function curveTimeWhen(curve: ReplayCurve, value: number): number | undefined {
  for (let i = 1; i < curve.length; i++) {
    const [t0, v0] = curve[i - 1];
    const [t1, v1] = curve[i];
    if (v0 >= value) return t0;
    if (v1 >= value) return v1 === v0 ? t1 : t0 + ((value - v0) * (t1 - t0)) / (v1 - v0);
  }
  return undefined;
}

export function replayRoleAt(track: ReplayTrack, t: number): ReplayRole | undefined {
  for (const s of track.spans) if (t >= s.from && t < s.to) return s.role;
  return undefined;
}

export interface ReplayNodeState {
  role?: ReplayRole;
  rows: number;
  starts: number;
  fill: number;
  spilling: boolean;
  done: boolean;
  started: boolean;
}

export function replayStateAt(track: ReplayTrack, t: number): ReplayNodeState {
  const role = replayRoleAt(track, t);
  const started = t >= track.firstActive;
  return {
    role,
    rows: curveValueAt(track.emit, t),
    starts: track.startsTotal <= 1
      ? (started ? Math.min(1, track.startsTotal || 1) : 0)
      : Math.round(curveValueAt(track.starts, t)),
    fill: track.fill ? curveValueAt(track.fill, t) : 0,
    spilling: track.spillAt !== undefined && t >= track.spillAt && (role === 'fill' || role === 'wait' || role === 'drain'),
    done: t >= track.lastActive,
    started,
  };
}

// ---------------------------------------------------------------------------
// Classification
// ---------------------------------------------------------------------------

const NARY = /^(UNION|CONCATENATION|APPEND|INTERSECTION|MINUS|BITMAP (AND|OR|MINUS)|RECURSIVE WITH)/;
const BLOCKING = /^(SORT|HASH GROUP BY|HASH UNIQUE|WINDOW|BUFFER SORT|HASH \(GROUP BY\))/;

function classify(node: PlanNode, kids: PlanNode[]): ReplayOpKind {
  const op = node.operation.toUpperCase();
  if (kids.length === 0) return 'scan';
  if (op.startsWith('HASH JOIN') && kids.length >= 2) return 'hashjoin';
  if (op.startsWith('NESTED LOOPS')) return 'nestedloop';
  if (op.startsWith('MERGE JOIN') && kids.length >= 2) return 'merge';
  if (op.startsWith('FILTER') && kids.length >= 2) return 'nestedloop';
  if (op.startsWith('COUNT STOPKEY')) return 'stopkey';
  if (/NOSORT/.test(op)) return 'stream';
  if (BLOCKING.test(op)) return 'blocking';
  if (kids.length >= 2 && NARY.test(op)) return 'nary';
  // Any other multi-child op (SELECT STATEMENT / UPDATE with scalar subqueries, ...):
  // the LAST child drives, the earlier ones run per driving row.
  if (kids.length >= 2) return 'nestedloop';
  return 'stream';
}

/** NL / FILTER: first child drives. Scalar-subquery shape (non-join multi-child): last child drives. */
function driverIndex(node: PlanNode, kind: ReplayOpKind, kids: PlanNode[]): number {
  if (kind !== 'nestedloop') return 0;
  const op = node.operation.toUpperCase();
  if (op.startsWith('NESTED LOOPS') || op.startsWith('FILTER')) return 0;
  return kids.length - 1;
}

// ---------------------------------------------------------------------------
// Tier detection
// ---------------------------------------------------------------------------

/** Whole seconds stay whole: SQL Monitor's Duration has no more precision than that. */
function formatMs(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)} ms`;
  const s = ms / 1000;
  return Number.isInteger(s) ? `${s} s` : `${s.toFixed(1)} s`;
}

/** SQL Monitor reports carry the statement's wall clock separately from their per-process elapsed time. */
function statementDurationMs(plan: ParsedPlan): number | undefined {
  if (!plan.timeIsActiveWindow && !plan.monitorMetadata) return plan.totalElapsedTime;
  const seconds = plan.monitorMetadata?.duration;
  return seconds === undefined ? undefined : seconds * 1000;
}

function detectTier(plan: ParsedPlan, nodes: PlanNode[]): { tier: ReplayTier; reason: string } {
  const isMonitor = plan.source === 'sql_monitor_xml' || plan.source === 'sql_monitor_text';
  if (isMonitor) {
    let lo = Infinity;
    let hi = -Infinity;
    for (const n of nodes) {
      if (n.firstActiveOffset !== undefined) lo = Math.min(lo, n.firstActiveOffset);
      if (n.lastActiveOffset !== undefined) hi = Math.max(hi, n.lastActiveOffset);
    }
    const span = hi - lo + 1;
    if (Number.isFinite(span) && span >= 3) {
      const samples = plan.activityTimeline?.samples.reduce((s, x) => s + x.count, 0) ?? 0;
      return {
        tier: 'measured',
        reason: `Real time: SQL Monitor active windows (1 s granularity)${samples ? ` and ${samples} ASH samples` : ''}.`,
      };
    }
    const ms = statementDurationMs(plan);
    return {
      tier: 'weighted',
      reason: `Order from Oracle's row-source semantics; durations from A-Rows and Starts. The report is too short for real timing${ms !== undefined ? ` (${formatMs(ms)})` : ''}.`,
    };
  }
  if (plan.hasActualStats) {
    const hasTime = nodes.some((n) => n.actualTime !== undefined);
    return {
      tier: 'weighted',
      reason: hasTime
        ? 'Order from Oracle\'s row-source semantics; durations from A-Time (self time per operation).'
        : 'Order from Oracle\'s row-source semantics; durations from A-Rows, Starts and buffers.',
    };
  }
  return {
    tier: 'simulated',
    reason: 'Nothing was measured: order from Oracle\'s row-source semantics, durations from optimizer cost, rows from E-Rows.',
  };
}

// ---------------------------------------------------------------------------
// Builder
// ---------------------------------------------------------------------------

interface Part {
  id: number;
  work: number;
  role: 'emit' | 'fill' | 'drain';
}
type Phase = Part[];

/** Build the replay script for a plan, or null when it has no root. */
export function buildReplayScript(plan: ParsedPlan): ReplayScript | null {
  const root = plan.rootNode;
  if (!root) return null;

  // Executed tree: inactive adaptive rows and operations that never started are dropped.
  const nodes: PlanNode[] = [];
  const kidsOf = new Map<number, PlanNode[]>();
  const parentOf = new Map<number, number>();
  const kindOf = new Map<number, ReplayOpKind>();
  const hasActual = plan.hasActualStats;
  const notExecuted = (n: PlanNode) => hasActual && n.starts === 0;
  const walk = (n: PlanNode) => {
    nodes.push(n);
    const kids = effectiveChildren(n).filter((k) => !notExecuted(k));
    kidsOf.set(n.id, kids);
    kindOf.set(n.id, classify(n, kids));
    for (const k of kids) {
      parentOf.set(k.id, n.id);
      walk(k);
    }
  };
  walk(root);

  const { tier, reason } = detectTier(plan, nodes);

  // Optimizer totals (E-Rows × estimated starts) and per-start flags.
  const estTotal = new Map<number, number | undefined>();
  const estStarts = new Map<number, number>();
  const perStart = new Set<number>();
  const estPass = (n: PlanNode, mult: number, inner: boolean) => {
    estStarts.set(n.id, mult);
    if (inner) perStart.add(n.id);
    const total = n.estimatedRowsTotal ?? (n.rows !== undefined ? n.rows * mult : undefined);
    estTotal.set(n.id, total);
    const kids = kidsOf.get(n.id) ?? [];
    const kind = kindOf.get(n.id)!;
    if (kind === 'nestedloop') {
      const di = driverIndex(n, kind, kids);
      estPass(kids[di], mult, inner);
      const driverRows = estTotal.get(kids[di].id) ?? 1;
      kids.forEach((k, i) => {
        if (i !== di) estPass(k, Math.max(1, driverRows), true);
      });
    } else {
      for (const k of kids) estPass(k, mult, inner);
    }
  };
  estPass(root, 1, false);

  // What the optimizer planned: E-Rows × planned starts, ignoring actual starts.
  const plannedTotal = new Map<number, number>();
  const plannedStarts = new Map<number, number>();
  const planPass = (n: PlanNode, mult: number) => {
    plannedStarts.set(n.id, mult);
    plannedTotal.set(n.id, (n.rows ?? 1) * mult);
    const kids = kidsOf.get(n.id) ?? [];
    const kind = kindOf.get(n.id)!;
    if (kind === 'nestedloop') {
      const di = driverIndex(n, kind, kids);
      planPass(kids[di], mult);
      const driverRows = Math.max(1, plannedTotal.get(kids[di].id) ?? 1);
      kids.forEach((k, i) => {
        if (i !== di) planPass(k, driverRows);
      });
    } else {
      for (const k of kids) planPass(k, mult);
    }
  };
  planPass(root, 1);

  const rowsOf = (n: PlanNode) =>
    hasActual ? (n.actualRows ?? estTotal.get(n.id) ?? 0) : (estTotal.get(n.id) ?? 0);
  const startsOf = (n: PlanNode) => (hasActual ? (n.starts ?? 1) : (estStarts.get(n.id) ?? 1));

  // Work weights for the semantic tiers.
  const reliableTime = hasActual && plan.source !== 'sql_monitor_xml' && plan.source !== 'sql_monitor_text'
    && nodes.some((n) => n.selfTime !== undefined);
  const rawWork = new Map<number, number>();
  for (const n of nodes) {
    let w: number;
    if (tier === 'simulated') {
      w = Math.max(0, n.selfCost ?? 0);
    } else if (reliableTime) {
      w = Math.max(0, n.selfTime ?? 0);
    } else {
      const kind = kindOf.get(n.id)!;
      const rows = rowsOf(n);
      w = (kind === 'scan' ? rows : rows * 0.3) + startsOf(n) * 1.5 + (n.logicalReads ?? 0) * 0.5;
      if (kind === 'blocking' && (n.tempUsed ?? 0) > 0) w *= 2.5; // spilled sorts cost a lot more
    }
    rawWork.set(n.id, w);
  }
  // Every operation gets a sliver of time, so nothing is invisible.
  const rawTotal = [...rawWork.values()].reduce((a, b) => a + b, 0) || 1;
  const epsilon = rawTotal * 0.006;
  for (const n of nodes) rawWork.set(n.id, (rawWork.get(n.id) ?? 0) + epsilon);

  const tracks = new Map<number, ReplayTrack>();
  const depthOf = new Map<number, number>();
  const setDepth = (n: PlanNode, d: number) => {
    depthOf.set(n.id, d);
    for (const k of kidsOf.get(n.id) ?? []) setDepth(k, d + 1);
  };
  setDepth(root, 0);
  for (const n of nodes) {
    const kids = kidsOf.get(n.id) ?? [];
    const kind = kindOf.get(n.id)!;
    tracks.set(n.id, {
      id: n.id,
      node: n,
      kind,
      label: `${n.operation}${n.objectName ? ` ${n.objectName}` : ''}`,
      depth: depthOf.get(n.id) ?? 0,
      parentId: parentOf.get(n.id),
      childIds: kids.map((k) => k.id),
      driverChildId: kids.length ? kids[driverIndex(n, kind, kids)].id : undefined,
      rowsTotal: rowsOf(n),
      rowsEstimate: estTotal.get(n.id),
      startsTotal: startsOf(n),
      plannedStarts: Math.round(plannedStarts.get(n.id) ?? 1),
      rowsPlanned: n.rows !== undefined ? plannedTotal.get(n.id) : undefined,
      perStart: perStart.has(n.id),
      spans: [],
      emit: [],
      starts: [],
      work: 0,
      firstActive: Infinity,
      lastActive: -Infinity,
    });
  }

  const duration = tier === 'measured'
    ? scheduleMeasured(root, kidsOf, tracks)
    : schedulePhases(root, kidsOf, tracks, rawWork);

  // Work share. ASH activity says where the time went, however the animation is paced.
  const byActivity = usesActivityRanking(plan);
  if (byActivity) {
    for (const n of nodes) tracks.get(n.id)!.work = (n.activityPercent ?? 0) / 100;
  } else if (tier === 'measured') {
    for (const n of nodes) {
      const tr = tracks.get(n.id)!;
      const win = tr.spans.length ? tr.spans[tr.spans.length - 1].to - tr.spans[0].from : 0;
      tr.work = win / Math.max(1, duration);
    }
  } else {
    const total = [...rawWork.values()].reduce((a, b) => a + b, 0) || 1;
    for (const n of nodes) tracks.get(n.id)!.work = (rawWork.get(n.id) ?? 0) / total;
  }

  for (const tr of tracks.values()) buildCurves(tr, hasActual);

  const order = nodes.map((n) => tracks.get(n.id)!);
  let hotspotId: number | undefined;
  if (byActivity) {
    const hottest = computeHottestNodeId(plan);
    if (hottest !== null && tracks.has(hottest)) hotspotId = hottest;
  } else {
    let best = -1;
    for (const tr of order) {
      if (tr.work > best) {
        best = tr.work;
        hotspotId = tr.id;
      }
    }
  }

  const script: ReplayScript = {
    tier,
    tierReason: reason,
    duration,
    unit: tier === 'measured' ? 's' : '%',
    rootId: root.id,
    order,
    tracks,
    chapters: [],
    hotspotId,
    durationMs: statementDurationMs(plan),
    stillRunning: plan.monitorMetadata?.status !== undefined && !/^DONE/i.test(plan.monitorMetadata.status),
  };
  if (tier === 'measured' && plan.activityTimeline) script.ash = indexAsh(plan);
  script.chapters = buildChapters(script, hasActual);
  return script;
}

// ---------------------------------------------------------------------------
// Semantic scheduler: phases of interleaved work
// ---------------------------------------------------------------------------

/** Schedules the weighted/simulated tiers; script time is the share of all work (0..100). */
function schedulePhases(
  root: PlanNode,
  kidsOf: Map<number, PlanNode[]>,
  tracks: Map<number, ReplayTrack>,
  work: Map<number, number>,
): number {
  const phasesOf = (n: PlanNode): Phase[] => {
    const tr = tracks.get(n.id)!;
    const kids = kidsOf.get(n.id) ?? [];
    const w = work.get(n.id) ?? 0;
    const last = (ph: Phase[]) => ph[ph.length - 1];
    switch (tr.kind) {
      case 'scan':
        return [[{ id: n.id, work: w, role: 'emit' }]];
      case 'stream':
      case 'stopkey': {
        const ph = phasesOf(kids[0]);
        last(ph).push({ id: n.id, work: w, role: 'emit' });
        return ph;
      }
      case 'blocking': {
        const ph = phasesOf(kids[0]);
        last(ph).push({ id: n.id, work: w * 0.6, role: 'fill' });
        ph.push([{ id: n.id, work: w * 0.4, role: 'drain' }]);
        return ph;
      }
      case 'hashjoin': {
        const build = phasesOf(kids[0]);
        last(build).push({ id: n.id, work: w * 0.4, role: 'fill' });
        const probe = kids.slice(1).flatMap((k) => phasesOf(k));
        last(probe).push({ id: n.id, work: w * 0.6, role: 'emit' });
        return [...build, ...probe];
      }
      case 'merge': {
        const a = phasesOf(kids[0]);
        const b = phasesOf(kids[1]);
        return [...a.slice(0, -1), ...b.slice(0, -1), [...last(a), ...last(b), { id: n.id, work: w, role: 'emit' }]];
      }
      case 'nestedloop': {
        const di = driverIndex(n, tr.kind, kids);
        const outer = phasesOf(kids[di]);
        // The inner side runs once per outer row: all of its work interleaves with the outer stream.
        const inner: Part[] = [];
        kids.forEach((k, i) => {
          if (i === di) return;
          const merged = new Map<number, Part>();
          for (const part of phasesOf(k).flat()) {
            const prev = merged.get(part.id);
            if (prev) prev.work += part.work;
            else merged.set(part.id, { ...part, role: 'emit' });
          }
          inner.push(...merged.values());
        });
        last(outer).push(...inner, { id: n.id, work: w, role: 'emit' });
        return outer;
      }
      case 'nary': {
        const ph: Phase[] = [];
        for (const k of kids) {
          const kp = phasesOf(k);
          last(kp).push({ id: n.id, work: w / kids.length, role: 'emit' });
          ph.push(...kp);
        }
        return ph;
      }
    }
  };

  const phases = phasesOf(root);
  const total = phases.reduce((s, ph) => s + ph.reduce((a, p) => a + p.work, 0), 0) || 1;
  const scale = 100 / total;
  let t = 0;
  for (const ph of phases) {
    const d = ph.reduce((a, p) => a + p.work, 0) * scale;
    const from = t;
    const to = t + Math.max(d, 0.05);
    for (const part of ph) {
      const tr = tracks.get(part.id)!;
      const prev = tr.spans[tr.spans.length - 1];
      if (prev && prev.role === part.role && Math.abs(prev.to - from) < 1e-9) prev.to = to;
      else tr.spans.push({ from, to, role: part.role });
    }
    t = to;
  }

  // Parents that already opened but wait on a child (e.g. a HJ between build and probe).
  for (const tr of tracks.values()) {
    tr.spans.sort((a, b) => a.from - b.from);
    const filled: ReplaySpan[] = [];
    for (const s of tr.spans) {
      const prev = filled[filled.length - 1];
      if (prev && s.from - prev.to > 1e-6) filled.push({ from: prev.to, to: s.from, role: 'wait' });
      filled.push(s);
    }
    tr.spans = filled;
  }
  return t;
}

// ---------------------------------------------------------------------------
// Measured scheduler: SQL Monitor active windows
// ---------------------------------------------------------------------------

function scheduleMeasured(
  root: PlanNode,
  kidsOf: Map<number, PlanNode[]>,
  tracks: Map<number, ReplayTrack>,
): number {
  const emitStart = new Map<number, number>();
  const endOf = new Map<number, number>();
  let duration = 0;

  const visit = (n: PlanNode) => {
    const kids = kidsOf.get(n.id) ?? [];
    for (const k of kids) visit(k);
    const tr = tracks.get(n.id)!;
    if (n.firstActiveOffset === undefined) return;
    const fa = n.firstActiveOffset;
    // SQL Monitor offsets are whole seconds: an op last active at second N runs until N+1.
    const end = (n.lastActiveOffset ?? fa) + 1;
    endOf.set(n.id, end);
    duration = Math.max(duration, end);
    const parentFa = tr.parentId !== undefined ? tracks.get(tr.parentId)!.node.firstActiveOffset : undefined;
    const clamp = (v: number) => Math.min(Math.max(v, fa), end - 0.2);
    const driver = tr.driverChildId;
    const driverEmit = driver !== undefined ? emitStart.get(driver) : undefined;
    const spans: ReplaySpan[] = [];
    switch (tr.kind) {
      case 'blocking': {
        const inputEnd = driver !== undefined ? (endOf.get(driver) ?? fa) : fa;
        const es = Math.min(Math.max(Math.max(inputEnd, parentFa ?? inputEnd), fa + 0.1), end - 0.25);
        const fillEnd = Math.min(inputEnd, es);
        if (fillEnd > fa) spans.push({ from: fa, to: fillEnd, role: 'fill' });
        if (es > fillEnd) spans.push({ from: Math.max(fa, fillEnd), to: es, role: 'wait' });
        spans.push({ from: es, to: end, role: 'drain' });
        emitStart.set(n.id, es);
        break;
      }
      case 'hashjoin': {
        const buildEnd = clamp(driver !== undefined ? (endOf.get(driver) ?? fa) : fa);
        const probe = tr.childIds[1];
        const es = clamp(Math.max(buildEnd, probe !== undefined ? (emitStart.get(probe) ?? buildEnd) : buildEnd));
        if (buildEnd > fa) spans.push({ from: fa, to: buildEnd, role: 'fill' });
        if (es > buildEnd) spans.push({ from: buildEnd, to: es, role: 'wait' });
        spans.push({ from: es, to: end, role: 'emit' });
        tr.buildEnd = buildEnd;
        emitStart.set(n.id, es);
        break;
      }
      default: {
        let es = clamp(Math.max(fa, driverEmit ?? fa));
        if (n.firstRowOffset !== undefined && tr.parentId === undefined) es = clamp(Math.max(es, n.firstRowOffset));
        if (es > fa) spans.push({ from: fa, to: es, role: 'wait' });
        spans.push({ from: es, to: end, role: 'emit' });
        emitStart.set(n.id, es);
      }
    }
    tr.spans = spans;
  };
  visit(root);
  return Math.max(duration, 1);
}

// ---------------------------------------------------------------------------
// Curves from spans
// ---------------------------------------------------------------------------

function buildCurves(tr: ReplayTrack, hasActual: boolean) {
  const spans = tr.spans;
  if (spans.length === 0) {
    tr.emit = [[0, 0]];
    tr.starts = [[0, 0]];
    return;
  }
  tr.firstActive = spans[0].from;
  tr.lastActive = spans[spans.length - 1].to;

  // Rows: spread over the emitting spans by duration.
  const out = spans.filter((s) => s.role === 'emit' || s.role === 'drain');
  const outDur = out.reduce((a, s) => a + (s.to - s.from), 0) || 1;
  const emit: ReplayCurve = [[0, 0]];
  let acc = 0;
  for (const s of out) {
    emit.push([s.from, acc]);
    acc += (tr.rowsTotal * (s.to - s.from)) / outDur;
    emit.push([s.to, acc]);
  }
  tr.emit = emit;

  // Starts: linear across the busy (non-wait) spans.
  const busy = spans.filter((s) => s.role !== 'wait');
  const busyDur = busy.reduce((a, s) => a + (s.to - s.from), 0) || 1;
  const starts: ReplayCurve = [[0, 0]];
  let sacc = 0;
  for (const s of busy) {
    starts.push([s.from, sacc]);
    sacc += (tr.startsTotal * (s.to - s.from)) / busyDur;
    starts.push([s.to, sacc]);
  }
  tr.starts = starts;

  // Work areas.
  if (tr.kind !== 'blocking' && tr.kind !== 'hashjoin') return;
  const fills = spans.filter((s) => s.role === 'fill');
  const fillDur = fills.reduce((a, s) => a + (s.to - s.from), 0);
  if (fillDur <= 0) return;
  const fill: ReplayCurve = [[0, 0]];
  let f = 0;
  for (const s of fills) {
    fill.push([s.from, f]);
    f += (s.to - s.from) / fillDur;
    fill.push([s.to, f]);
  }
  if (tr.kind === 'blocking') {
    const drains = spans.filter((s) => s.role === 'drain');
    const drainDur = drains.reduce((a, s) => a + (s.to - s.from), 0) || 1;
    let level = 1;
    for (const s of drains) {
      fill.push([s.from, level]);
      level -= (s.to - s.from) / drainDur;
      fill.push([s.to, Math.max(0, level)]);
    }
  } else {
    // A hash table stays in memory until the join is done.
    fill.push([tr.lastActive, 1]);
    fill.push([tr.lastActive + 1e-6, 0]);
  }
  tr.fill = fill;

  const n = tr.node;
  const temp = hasActual ? n.tempUsed : n.tempSpace;
  if (temp && temp > 0) {
    const mem = n.memoryUsed ?? n.estimatedOptimalMemory ?? temp * 0.1;
    tr.tempBytes = temp;
    tr.memBytes = n.memoryUsed;
    tr.spillPredicted = !hasActual;
    tr.memLimit = Math.min(0.9, Math.max(0.03, mem / (mem + temp)));
    tr.spillAt = curveTimeWhen(fill, tr.memLimit);
  }
}

// ---------------------------------------------------------------------------
// ASH
// ---------------------------------------------------------------------------

function indexAsh(plan: ParsedPlan): ReplayAshIndex | undefined {
  const tl = plan.activityTimeline;
  if (!tl) return undefined;
  const byBucketLine = new Map<string, ActivitySample[]>();
  const byBucket = new Map<number, Map<string, number>>();
  for (const s of tl.samples) {
    if (s.line !== undefined) {
      const key = `${s.bucket}:${s.line}`;
      const arr = byBucketLine.get(key);
      if (arr) arr.push(s);
      else byBucketLine.set(key, [s]);
    }
    let m = byBucket.get(s.bucket);
    if (!m) byBucket.set(s.bucket, (m = new Map()));
    m.set(s.waitClass, (m.get(s.waitClass) ?? 0) + s.count);
  }
  let maxBucketTotal = 1;
  for (const m of byBucket.values()) maxBucketTotal = Math.max(maxBucketTotal, [...m.values()].reduce((a, b) => a + b, 0));
  return { bucketSecs: tl.bucketIntervalSecs || 1, bucketCount: tl.bucketCount, byBucketLine, byBucket, maxBucketTotal };
}

/** ASH bucket covering script time t (1-based, like SQL Monitor). */
export function replayBucketAt(ash: ReplayAshIndex, t: number): number {
  return Math.floor(t / ash.bucketSecs) + 1;
}

/** Dominant ASH sample for an operation at time t (measured tier only). */
export function replayAshAt(script: ReplayScript, id: number, t: number): ActivitySample | undefined {
  if (!script.ash) return undefined;
  const samples = script.ash.byBucketLine.get(`${replayBucketAt(script.ash, t)}:${id}`);
  if (!samples || samples.length === 0) return undefined;
  return samples.reduce((a, b) => (b.count > a.count ? b : a));
}

// ---------------------------------------------------------------------------
// Chapters
// ---------------------------------------------------------------------------

const n0 = (v: number | undefined) => formatNumberShort(v) ?? '0';

/** The op whose rows actually stream out of `tr` (probe side of a HJ, outer side of a NL, ...). */
function streamSource(script: ReplayScript, tr: ReplayTrack): ReplayTrack {
  let cur: ReplayTrack = tr;
  for (;;) {
    if (cur.kind === 'scan' || cur.kind === 'blocking') return cur;
    const next = cur.kind === 'hashjoin' ? cur.childIds[1] : cur.driverChildId;
    if (next === undefined) return cur;
    cur = script.tracks.get(next)!;
  }
}

function sourceName(script: ReplayScript, tr: ReplayTrack): string {
  const s = streamSource(script, tr);
  return s.kind === 'scan' ? (s.node.objectName ?? s.label) : `#${s.id} ${s.node.operation}`;
}

const isBad = (tr: ReplayTrack) => {
  const r = nodeCardinalityRatio(tr.node);
  return r !== undefined && cardinalityRatioSeverity(r) === 'bad';
};

const CHAPTER_ORDER: Record<ReplayChapterKind, number> = {
  start: 0, estimate: 1, build: 2, loops: 3, spill: 4, drain: 5, 'first-row': 6, done: 7,
};

function buildChapters(script: ReplayScript, hasActual: boolean): ReplayChapter[] {
  const chapters: ReplayChapter[] = [];
  const { tracks, duration } = script;
  const fmtT = (t: number) => (script.unit === 's' ? `${t.toFixed(1)} s` : `${Math.round(t)}% of the work`);
  const root = tracks.get(script.rootId)!;
  const parentFocus = (tr: ReplayTrack) => (tr.parentId !== undefined ? [tr.parentId] : []);

  // Start: the first leaf that does anything.
  const leaves = script.order.filter((t) => t.kind === 'scan' && t.spans.length > 0);
  const first = leaves.reduce<ReplayTrack | undefined>((a, b) => (!a || b.firstActive < a.firstActive ? b : a), undefined);
  if (first) {
    chapters.push({
      t: first.firstActive,
      kind: 'start',
      title: `Reading ${first.node.objectName ?? first.node.operation}`,
      caption: `#${first.id} ${first.label} runs first. Every row starts at a leaf like this one and is pulled upward, one parent at a time.`,
      focus: [first.id, ...parentFocus(first)],
    });
  }

  for (const tr of script.order) {
    if (tr.spans.length === 0) continue;

    if (tr.kind === 'hashjoin') {
      const fillEnd = tr.spans.find((s) => s.role === 'fill')?.to ?? tr.buildEnd;
      const build = tr.childIds[0] !== undefined ? tracks.get(tr.childIds[0]) : undefined;
      const probe = tr.childIds[1] !== undefined ? tracks.get(tr.childIds[1]) : undefined;
      if (fillEnd !== undefined && build && probe) {
        chapters.push({
          t: fillEnd,
          kind: 'build',
          title: `Hash table built (#${tr.id})`,
          caption: `HASH JOIN #${tr.id} has loaded all ${n0(build.rowsTotal)} rows of its build side (${sourceName(script, build)})${tr.node.memoryUsed ? ` into ${formatBytes(tr.node.memoryUsed)}` : ''}. It will probe it with rows from ${sourceName(script, probe)}.`,
          focus: [tr.id, build.id, probe.id],
        });
      }
    }

    if (tr.spillAt !== undefined && tr.tempBytes) {
      chapters.push({
        t: tr.spillAt,
        kind: 'spill',
        title: tr.spillPredicted ? `Expected spill (#${tr.id})` : `Out of memory, spilling to TEMP (#${tr.id})`,
        caption: tr.spillPredicted
          ? `The optimizer expects ${tr.node.operation} #${tr.id} to need ${formatBytes(tr.tempBytes)} of TEMP: its input won't fit in the work area.`
          : `${tr.node.operation} #${tr.id} filled its work area${tr.memBytes ? ` (${formatBytes(tr.memBytes)})` : ''} after ${Math.round((tr.memLimit ?? 0) * 100)}% of its input. The rest goes to disk: ${formatBytes(tr.tempBytes)} written to TEMP and read back.`,
        focus: [tr.id],
      });
    }

    if (tr.kind === 'blocking') {
      const drain = tr.spans.find((s) => s.role === 'drain');
      const input = tr.driverChildId !== undefined ? tracks.get(tr.driverChildId) : undefined;
      if (drain && input && tr.rowsTotal > 1) {
        chapters.push({
          t: drain.from,
          kind: 'drain',
          title: `#${tr.id} ${tr.node.operation.split(' ').slice(0, 2).join(' ')} starts returning rows`,
          caption: `${tr.node.operation} is blocking: #${tr.id} could not return a single row until it had all ${n0(input.rowsTotal)} input rows. Now it hands ${n0(tr.rowsTotal)} rows to its parent.`,
          focus: [tr.id, ...parentFocus(tr)],
        });
      }
    }
  }

  // Misestimate origins: a bad estimate whose own inputs were estimated fine,
  // shown at the moment the actual rows pass what the optimizer expected.
  if (hasActual) {
    const origins = script.order
      .filter((tr) => isBad(tr) && (tr.rowsEstimate ?? 0) < tr.rowsTotal && tr.spans.length > 0)
      .filter((tr) => !tr.childIds.some((c) => isBad(tracks.get(c)!)))
      .sort((a, b) => (nodeCardinalityRatio(b.node) ?? 0) - (nodeCardinalityRatio(a.node) ?? 0))
      .slice(0, 2);
    for (const tr of origins) {
      const est = Math.max(1, Math.round(tr.rowsEstimate ?? 1));
      const crossT = curveTimeWhen(tr.emit, est);
      if (crossT === undefined) continue;
      chapters.push({
        t: crossT,
        kind: 'estimate',
        title: `#${tr.id} passes its estimate`,
        caption: `${tr.label} has produced ${n0(est)} row${est === 1 ? '' : 's'}: everything the optimizer expected. It will end at ${n0(tr.rowsTotal)} (${formatCardinalityRatio(nodeCardinalityRatio(tr.node))}). The plan above it was chosen for ${n0(est)}.`,
        focus: [tr.id, ...parentFocus(tr)],
      });
    }
  }

  // Loops: the busiest per-start operations.
  const loopers = script.order
    .filter((t) => t.perStart && t.startsTotal >= 50 && t.spans.length > 0)
    .sort((a, b) => b.startsTotal - a.startsTotal)
    .slice(0, 2);
  loopers.forEach((tr, i) => {
    const busy = tr.spans.find((s) => s.role !== 'wait');
    if (!busy) return;
    const planned = tr.plannedStarts;
    const off = hasActual && planned > 0 && tr.startsTotal / planned >= 10;
    chapters.push({
      t: busy.from + (busy.to - busy.from) * (0.2 + i * 0.18),
      kind: 'loops',
      title: `#${tr.id} runs ${n0(tr.startsTotal)} times`,
      caption: `${tr.label} is on the inner side of a loop, so it runs once per incoming row: ${n0(tr.startsTotal)} times${off ? `. The optimizer planned for about ${n0(planned)}` : ''}.`,
      focus: [tr.id, ...parentFocus(tr)],
    });
  });

  // First row to the client.
  const firstRowT = curveTimeWhen(root.emit, 1);
  if (firstRowT !== undefined) {
    chapters.push({
      t: firstRowT,
      kind: 'first-row',
      title: 'First row to the client',
      caption: `The first row reaches the client at ${fmtT(firstRowT)}${firstRowT > duration * 0.5 ? '. Late: something below had to finish first' : ''}.`,
      focus: [root.id, ...root.childIds],
    });
  }

  const hot = script.hotspotId !== undefined ? tracks.get(script.hotspotId) : undefined;
  const rows = `${n0(root.rowsTotal)} row${root.rowsTotal === 1 ? '' : 's'}`;
  const took = script.durationMs !== undefined ? formatMs(script.durationMs) : undefined;
  const outcome = script.stillRunning
    ? `Still executing when the report was taken${took ? `, ${took} in` : ''}: ${rows} so far.`
    : `${rows} returned${took ? ` in ${took}` : ''}.`;
  chapters.push({
    t: duration,
    kind: 'done',
    title: script.stillRunning ? 'End of the report' : 'Done',
    caption: `${outcome}${hot ? ` Most of the work: #${hot.id} ${hot.label} (${Math.round(hot.work * 100)}%).` : ''}`,
    focus: hot ? [hot.id] : [root.id],
  });

  chapters.sort((a, b) => a.t - b.t || CHAPTER_ORDER[a.kind] - CHAPTER_ORDER[b.kind]);
  // Chapters at the same instant get a sliver of script time each; the player's
  // pacing then gives every chapter its own moment on screen.
  const sliver = duration * 0.004;
  for (let i = 1; i < chapters.length; i++) {
    if (chapters[i].t - chapters[i - 1].t < sliver) chapters[i].t = chapters[i - 1].t + sliver;
  }
  const lastT = chapters[chapters.length - 1].t;
  if (lastT > duration) {
    // Squeeze the tail back inside the script, keeping the order.
    const pivot = duration * 0.9;
    const k = (duration - pivot) / (lastT - pivot);
    for (const c of chapters) if (c.t > pivot) c.t = pivot + (c.t - pivot) * k;
  }
  return chapters;
}

/** Script time as shown to the user: seconds (measured) or share of the work. */
export function formatReplayTime(script: ReplayScript, t: number): string {
  return script.unit === 's' ? `${t.toFixed(1)} s` : `${Math.round(t)}%`;
}
