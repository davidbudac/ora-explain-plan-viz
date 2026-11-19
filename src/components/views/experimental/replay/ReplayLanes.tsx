// Replay layout "Lanes": one row per operation in plan order. Each lane fills
// in as the playhead passes (when the operation consumed input, produced rows
// or waited), next to a rows counter racing the optimizer's estimate.

import { useMemo } from 'react';
import { getWaitClassColor } from '../../../../lib/ash';
import { replayStateAt } from '../../../../lib/replay';
import type { ReplayScript, ReplayTrack } from '../../../../lib/replay';
import { FOCUS_RING } from '../../../ui';
import { CaptionStrip, Transport } from './ReplayControls';
import { currentChapter, fmtFull, fmtRows, misestimateVisible, roleLabel } from './replayUi';
import type { ReplayLayoutProps } from './replayUi';

const VB_W = 1000;
const LANE_H = 30;
const GRID = 'grid grid-cols-[40px_minmax(200px,300px)_1fr_190px_76px]';

const KIND_LABEL: Record<ReplayTrack['kind'], string> = {
  scan: 'row source',
  stream: 'streams',
  blocking: 'blocking',
  hashjoin: 'hash join',
  nestedloop: 'loop',
  merge: 'merge',
  nary: 'runs children in turn',
  stopkey: 'stops early',
};

function axisTicks(script: ReplayScript): number[] {
  const d = script.duration;
  if (script.unit === '%') return [0, 25, 50, 75, 100];
  const step = d <= 12 ? 1 : d <= 30 ? 5 : d <= 120 ? 10 : 60;
  const out: number[] = [];
  for (let v = 0; v <= d + 1e-9; v += step) out.push(v);
  return out;
}

function Lane({ tr, script, t, showAhead }: { tr: ReplayTrack; script: ReplayScript; t: number; showAhead: boolean }) {
  const d = script.duration;
  const ash = script.ash;
  const ashCells = useMemo(() => {
    if (!ash) return [];
    const X = (v: number) => (v / d) * VB_W;
    const out: { x: number; w: number; color: string; title: string }[] = [];
    for (let b = 1; b <= ash.bucketCount + 1; b++) {
      const samples = ash.byBucketLine.get(`${b}:${tr.id}`);
      if (!samples) continue;
      const top = samples.reduce((a, s) => (s.count > a.count ? s : a));
      out.push({ x: X((b - 1) * ash.bucketSecs), w: X(ash.bucketSecs), color: getWaitClassColor(top.waitClass), title: top.event ?? top.waitClass });
    }
    return out;
  }, [ash, tr.id, d]);
  const X = (v: number) => (v / d) * VB_W;
  const xt = X(t);

  return (
    <svg className="w-full h-full block" viewBox={`0 0 ${VB_W} ${LANE_H}`} preserveAspectRatio="none" aria-hidden="true">
      <rect x={0} y={LANE_H / 2 - 0.5} width={VB_W} height={1} className="fill-slate-200 dark:fill-slate-800" />
      {tr.spans.map((s, i) => {
        const isWait = s.role === 'wait';
        const y = isWait ? LANE_H / 2 - 1 : 8;
        const h = isWait ? 2 : LANE_H - 16;
        const seen = Math.min(s.to, t);
        const seenClass = isWait
          ? 'fill-slate-400 dark:fill-slate-500'
          : s.role === 'fill'
            ? 'fill-blue-600/35 dark:fill-blue-400/35'
            : 'fill-blue-600/85 dark:fill-blue-400/85';
        return (
          <g key={i}>
            {showAhead && (
              <rect x={X(s.from)} y={y} width={Math.max(0.5, X(s.to) - X(s.from))} height={h} rx={2} className="fill-slate-300/50 dark:fill-slate-700/50" />
            )}
            {seen > s.from && (
              <rect x={X(s.from)} y={y} width={Math.max(0.5, X(seen) - X(s.from))} height={h} rx={2} className={seenClass} />
            )}
          </g>
        );
      })}
      {tr.spillAt !== undefined && t > tr.spillAt && (
        <rect
          x={X(tr.spillAt)}
          y={LANE_H - 6}
          width={Math.max(0.5, X(Math.min(t, tr.lastActive)) - X(tr.spillAt))}
          height={3}
          className="fill-red-500"
        />
      )}
      {ashCells.filter((c) => c.x < xt).map((c, i) => (
        <rect key={`a${i}`} x={c.x + 1} y={2} width={Math.max(1, Math.min(c.w, xt - c.x) - 2)} height={3} fill={c.color} opacity={0.8}>
          <title>{c.title}</title>
        </rect>
      ))}
      <rect x={xt - 1} y={0} width={2} height={LANE_H} className="fill-blue-600 dark:fill-blue-400" />
    </svg>
  );
}

function RaceBar({ tr, rows, maxLog, alert }: { tr: ReplayTrack; rows: number; maxLog: number; alert: boolean }) {
  const pos = (v: number) => `${(Math.log10(1 + v) / maxLog) * 100}%`;
  const est = tr.rowsEstimate;
  return (
    <div className="relative h-1.5 rounded-full bg-slate-200 dark:bg-slate-800">
      <div
        className={`absolute inset-y-0 left-0 rounded-full ${alert ? 'bg-red-500' : 'bg-slate-400 dark:bg-slate-500'}`}
        style={{ width: pos(rows) }}
      />
      {tr.node.actualRows !== undefined && est !== undefined && (
        <div
          className="absolute -top-1 -bottom-1 w-[2px] bg-slate-700 dark:bg-slate-300"
          style={{ left: pos(est) }}
          title={`Optimizer estimate: ${fmtFull(est)}`}
        />
      )}
    </div>
  );
}

function Legend() {
  const item = 'flex items-center gap-1.5';
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 px-3 py-1 text-[11px] text-slate-500 dark:text-slate-400 border-b border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900">
      <span className={item}><span className="w-4 h-2 rounded-sm bg-blue-600/85 dark:bg-blue-400/85" />producing rows</span>
      <span className={item}><span className="w-4 h-2 rounded-sm bg-blue-600/35 dark:bg-blue-400/35" />consuming input (hash build, sort)</span>
      <span className={item}><span className="w-4 h-0.5 bg-slate-400 dark:bg-slate-500" />waiting</span>
      <span className={item}><span className="w-4 h-1 bg-red-500" />spilling to TEMP</span>
      <span className={item}><span className="w-0.5 h-3 bg-slate-700 dark:bg-slate-300" />optimizer estimate</span>
    </div>
  );
}

export function ReplayLanes({ script, clock, selectedIds, onSelect, showAhead }: ReplayLayoutProps & { showAhead: boolean }) {
  const t = clock.t;
  const focus = new Set(currentChapter(script, clock)?.focus ?? []);
  const maxLog = useMemo(() => {
    let m = 1;
    for (const tr of script.order) m = Math.max(m, tr.rowsTotal, tr.node.actualRows !== undefined ? (tr.rowsEstimate ?? 0) : 0);
    return Math.log10(1 + m);
  }, [script]);
  const ticks = axisTicks(script);

  return (
    <div className="h-full flex flex-col">
      <Legend />
      <div className="flex-1 min-h-0 overflow-auto bg-slate-50 dark:bg-slate-950">
        <div className="min-w-[860px]">
          <div className={`${GRID} sticky top-0 z-10 text-[10px] text-slate-500 dark:text-slate-400 bg-slate-50/95 dark:bg-slate-950/95 border-b border-slate-200 dark:border-slate-800`}>
            <div className="px-2 py-1">Id</div>
            <div className="px-2 py-1">Operation</div>
            <div className="relative h-6">
              {ticks.map((v, i) => (
                <span
                  key={v}
                  className={`absolute top-1 font-mono ${i === ticks.length - 1 && v >= script.duration - 1e-9 ? '-translate-x-full' : i === 0 ? '' : '-translate-x-1/2'}`}
                  style={{ left: `${(v / script.duration) * 100}%` }}
                >
                  {script.unit === '%' ? `${v}%` : `${v}s`}
                </span>
              ))}
            </div>
            <div className="px-3 py-1">Rows so far (log scale)</div>
            <div className="pl-2 pr-4 py-1 text-right">Starts</div>
          </div>
          {script.order.map((tr) => {
            const st = replayStateAt(tr, t);
            const busy = st.role !== undefined && st.role !== 'wait';
            const alert = misestimateVisible(tr, st.rows, st.done);
            return (
              <button
                type="button"
                key={tr.id}
                onClick={() => onSelect(tr.id)}
                aria-pressed={selectedIds.has(tr.id)}
                className={`relative w-full text-left ${GRID} items-center border-b border-slate-100 dark:border-slate-900 ${FOCUS_RING} ${
                  focus.has(tr.id) ? 'bg-blue-50/70 dark:bg-blue-500/10' : busy ? 'bg-white dark:bg-slate-900' : ''
                } ${selectedIds.has(tr.id) ? 'ring-2 ring-inset ring-blue-500' : ''} ${st.started ? '' : 'opacity-50'}`}
              >
                {busy && <span className="absolute left-0 inset-y-0 w-0.5 bg-blue-600 dark:bg-blue-400" aria-hidden="true" />}
                <div className="px-2 font-mono text-[11px] text-slate-400">{tr.id}</div>
                <div className="px-2 py-1 min-w-0" style={{ paddingLeft: 8 + tr.depth * 12 }}>
                  <span className="block truncate text-[12px] font-medium text-slate-800 dark:text-slate-100">
                    {tr.node.operation}
                    {tr.node.objectName && <span className="font-normal text-slate-500 dark:text-slate-400"> {tr.node.objectName}</span>}
                  </span>
                  <span className="block truncate text-[10px] text-slate-400 dark:text-slate-500">
                    {KIND_LABEL[tr.kind]}
                    {tr.perStart && ' · runs per row'}
                    {st.role && <span className={busy ? 'text-blue-600 dark:text-blue-400' : ''}> · {roleLabel(tr, st.role)}</span>}
                    {st.spilling && <span className="text-red-600 dark:text-red-400"> · spilling</span>}
                  </span>
                </div>
                <div style={{ height: LANE_H }}>
                  <Lane tr={tr} script={script} t={t} showAhead={showAhead} />
                </div>
                <div className="px-3">
                  <div className="flex items-baseline justify-between font-mono text-[11px] tabular-nums">
                    <span className={`font-semibold ${alert ? 'text-red-600 dark:text-red-400' : 'text-slate-800 dark:text-slate-100'}`}>{fmtFull(st.rows)}</span>
                    {tr.node.actualRows !== undefined && tr.rowsEstimate !== undefined && (
                      <span className="text-[10px] text-slate-400">est {fmtRows(tr.rowsEstimate)}</span>
                    )}
                  </div>
                  <RaceBar tr={tr} rows={st.rows} maxLog={maxLog} alert={alert} />
                </div>
                <div className="pl-2 pr-4 text-right font-mono text-[11px] tabular-nums text-slate-500 dark:text-slate-400">
                  {tr.startsTotal > 1 ? `×${fmtRows(st.starts)}` : st.started ? '1' : ''}
                </div>
              </button>
            );
          })}
        </div>
      </div>
      <CaptionStrip script={script} clock={clock} />
      <Transport script={script} clock={clock} />
    </div>
  );
}
