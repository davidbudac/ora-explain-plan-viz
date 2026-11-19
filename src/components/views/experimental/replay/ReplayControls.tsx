// Controls shared by the Replay layouts: the tier badge, the chapter caption
// and the transport (play/pause, chapter steps, scrubber, speed, pacing).

import { useMemo, useRef } from 'react';
import { getWaitClassColor } from '../../../../lib/ash';
import { formatReplayTime, replayRoleAt } from '../../../../lib/replay';
import type { ReplayChapterKind, ReplayScript, ReplayTier } from '../../../../lib/replay';
import { FOCUS_RING } from '../../../ui';
import type { ReplayClock } from './useReplayClock';
import { CHAPTER_LABEL, currentChapter, isAlertChapter } from './replayUi';

const TIER_LABEL: Record<ReplayTier, string> = {
  measured: 'Measured timing',
  weighted: 'Approximate timing · actual rows',
  simulated: 'Simulated from estimates',
};

export function TierBadge({ script }: { script: ReplayScript }) {
  return (
    <span
      title={script.tierReason}
      className="inline-flex items-center px-2 py-0.5 text-[11px] font-medium rounded-full bg-slate-100 text-slate-600 ring-1 ring-slate-200 dark:bg-slate-800 dark:text-slate-300 dark:ring-slate-700 whitespace-nowrap"
    >
      {TIER_LABEL[script.tier]}
    </span>
  );
}

export function ChapterChip({ kind }: { kind: ReplayChapterKind }) {
  return (
    <span
      className={`shrink-0 px-1.5 py-0.5 rounded text-[10px] font-semibold ${
        isAlertChapter(kind)
          ? 'bg-red-50 text-red-700 ring-1 ring-red-200 dark:bg-red-500/10 dark:text-red-300 dark:ring-red-500/30'
          : 'bg-slate-100 text-slate-600 ring-1 ring-slate-200 dark:bg-slate-800 dark:text-slate-300 dark:ring-slate-700'
      }`}
    >
      {CHAPTER_LABEL[kind]}
    </span>
  );
}

export function CaptionStrip({ script, clock }: { script: ReplayScript; clock: ReplayClock }) {
  const ch = currentChapter(script, clock);
  return (
    <div
      className="min-h-[60px] px-4 py-2 border-t border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 flex items-start gap-3"
      aria-live="polite"
    >
      {ch ? (
        <>
          <span className="mt-0.5"><ChapterChip kind={ch.kind} /></span>
          <div className="min-w-0">
            <div className="text-sm font-semibold text-slate-800 dark:text-slate-100">{ch.title}</div>
            <div className="text-xs text-slate-600 dark:text-slate-300 leading-snug">{ch.caption}</div>
          </div>
          <span className="ml-auto shrink-0 text-[11px] text-slate-400 tabular-nums">
            {!clock.playing && clock.t === 0 ? 'Space to play · [ ] chapters' : `${clock.chapterIndex + 1} / ${script.chapters.length}`}
          </span>
        </>
      ) : (
        <div className="text-xs text-slate-500 dark:text-slate-400 self-center">
          Press play (Space) to replay how this plan ran. <kbd>[</kbd> and <kbd>]</kbd> step through the chapters.
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Transport
// ---------------------------------------------------------------------------

const SPEEDS = [0.5, 1, 2, 4];

function Icon({ d }: { d: string }) {
  return (
    <svg viewBox="0 0 16 16" width="14" height="14" fill="currentColor" aria-hidden="true">
      <path d={d} />
    </svg>
  );
}
const ICON_PLAY = 'M4 2.5v11l9-5.5z';
const ICON_PAUSE = 'M4 2.5h3v11H4zM9 2.5h3v11H9z';
const ICON_PREV = 'M3 2.5h2v11H3zM14 2.5v11L6 8z';
const ICON_NEXT = 'M11 2.5h2v11h-2zM2 2.5v11L10 8z';
const ICON_RESTART = 'M8 2.5a5.5 5.5 0 1 1-5.2 3.7l1.6.6A3.8 3.8 0 1 0 8 4.2V6L4.8 3.4 8 .8z';

/** What was happening over the run, drawn behind the scrubber. */
function Profile({ script }: { script: ReplayScript }) {
  const bars = useMemo(() => {
    const out: { x: number; w: number; segs: { color?: string; h: number }[] }[] = [];
    const d = script.duration;
    if (script.ash) {
      // Measured: ASH samples per bucket, stacked by wait class.
      const { ash } = script;
      for (const [bucket, classes] of ash.byBucket) {
        const segs = [...classes.entries()].map(([cls, n]) => ({ color: getWaitClassColor(cls), h: n / ash.maxBucketTotal }));
        out.push({ x: ((bucket - 1) * ash.bucketSecs) / d, w: ash.bucketSecs / d, segs });
      }
      return out;
    }
    // Otherwise: how many operations are busy at each moment.
    const N = 80;
    const counts: number[] = [];
    for (let i = 0; i < N; i++) {
      const t = ((i + 0.5) / N) * d;
      counts.push(script.order.filter((tr) => {
        const r = replayRoleAt(tr, t);
        return r !== undefined && r !== 'wait';
      }).length);
    }
    const max = Math.max(1, ...counts);
    counts.forEach((c, i) => out.push({ x: i / N, w: 1 / N, segs: [{ h: c / max }] }));
    return out;
  }, [script]);
  return (
    <svg className="absolute inset-0 w-full h-full" preserveAspectRatio="none" viewBox="0 0 1 1" aria-hidden="true">
      {bars.map((b, i) => {
        let y = 1;
        return (
          <g key={i}>
            {b.segs.map((s, j) => {
              const h = s.h * 0.85;
              y -= h;
              return s.color
                ? <rect key={j} x={b.x} y={y} width={b.w * 0.9} height={h} fill={s.color} opacity={0.35} />
                : <rect key={j} x={b.x} y={y} width={b.w * 0.9} height={h} className="fill-slate-200 dark:fill-slate-700" />;
            })}
          </g>
        );
      })}
    </svg>
  );
}

export function Transport({ script, clock }: { script: ReplayScript; clock: ReplayClock }) {
  const trackRef = useRef<HTMLDivElement>(null);
  const d = script.duration;
  const seekFromEvent = (clientX: number) => {
    const el = trackRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    if (r.width > 0) clock.seek(((clientX - r.left) / r.width) * d);
  };
  const onScrubKey = (event: React.KeyboardEvent) => {
    const step = d / 100;
    if (event.key === 'ArrowLeft' || event.key === 'ArrowDown') clock.seek(clock.t - step);
    else if (event.key === 'ArrowRight' || event.key === 'ArrowUp') clock.seek(clock.t + step);
    else if (event.key === 'Home') clock.seek(0);
    else if (event.key === 'End') clock.seek(d);
    else return;
    event.preventDefault();
    event.stopPropagation();
  };
  const btn = `w-8 h-8 grid place-items-center rounded-md text-slate-600 dark:text-slate-300 hover:bg-slate-200/70 dark:hover:bg-slate-800 ${FOCUS_RING}`;
  const pct = (clock.t / d) * 100;
  return (
    <div className="px-3 py-2 border-t border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 select-none flex items-center gap-1.5">
      <button type="button" className={btn} onClick={clock.prevChapter} title="Previous chapter ( [ )" aria-label="Previous chapter">
        <Icon d={ICON_PREV} />
      </button>
      <button
        type="button"
        onClick={clock.toggle}
        title="Play / pause (Space)"
        aria-label={clock.playing ? 'Pause' : 'Play'}
        className={`w-9 h-9 grid place-items-center rounded-full bg-blue-600 text-white hover:bg-blue-700 dark:bg-blue-500 dark:hover:bg-blue-400 dark:text-slate-950 ${FOCUS_RING}`}
      >
        <Icon d={clock.playing ? ICON_PAUSE : ICON_PLAY} />
      </button>
      <button type="button" className={btn} onClick={clock.nextChapter} title="Next chapter ( ] )" aria-label="Next chapter">
        <Icon d={ICON_NEXT} />
      </button>
      <button type="button" className={btn} onClick={clock.restart} title="Replay from the start" aria-label="Replay from the start">
        <Icon d={ICON_RESTART} />
      </button>
      <div className="flex-1 min-w-[120px] px-2">
        <div
          ref={trackRef}
          role="slider"
          tabIndex={0}
          aria-label="Replay position"
          aria-valuemin={0}
          aria-valuemax={Math.round(d)}
          aria-valuenow={Math.round(clock.t)}
          aria-valuetext={formatReplayTime(script, clock.t)}
          onKeyDown={onScrubKey}
          className={`relative h-8 rounded-md bg-white dark:bg-slate-900 ring-1 ring-slate-200 dark:ring-slate-800 cursor-pointer overflow-hidden ${FOCUS_RING}`}
          onPointerDown={(e) => {
            e.currentTarget.setPointerCapture?.(e.pointerId);
            seekFromEvent(e.clientX);
          }}
          onPointerMove={(e) => {
            if (e.buttons & 1) seekFromEvent(e.clientX);
          }}
        >
          <Profile script={script} />
          <div className="absolute inset-y-0 left-0 bg-blue-500/10 pointer-events-none" style={{ width: `${pct}%` }} />
          {script.chapters.map((c, i) => (
            <div
              key={i}
              title={`${formatReplayTime(script, c.t)} · ${c.title}`}
              className={`absolute top-0 bottom-0 w-[3px] -ml-[1px] ${
                isAlertChapter(c.kind) ? 'bg-red-500/70' : 'bg-slate-400 dark:bg-slate-500'
              } ${i <= clock.chapterIndex ? '' : 'opacity-40'}`}
              style={{ left: `${(c.t / d) * 100}%` }}
              onPointerDown={(e) => {
                e.stopPropagation();
                clock.seek(c.t);
              }}
            />
          ))}
          <div className="absolute top-0 bottom-0 w-0.5 bg-blue-600 dark:bg-blue-400 pointer-events-none" style={{ left: `${pct}%` }} />
        </div>
      </div>
      <div className="w-28 text-right font-mono text-[11px] text-slate-600 dark:text-slate-300 tabular-nums leading-tight">
        {formatReplayTime(script, clock.t)} / {formatReplayTime(script, d)}
        <div className="text-[10px] text-slate-400">
          {clock.slowMo && clock.playing ? 'slowed for chapter' : script.unit === '%' ? 'of the work' : 'elapsed'}
        </div>
      </div>
      <div role="group" aria-label="Playback speed" className="flex items-center gap-0.5 bg-slate-200/60 dark:bg-slate-800 rounded-md p-0.5">
        {SPEEDS.map((s) => (
          <button
            key={s}
            type="button"
            aria-pressed={clock.speed === s}
            onClick={() => clock.setSpeed(s)}
            className={`px-1.5 py-0.5 rounded text-[11px] font-medium ${FOCUS_RING} ${
              clock.speed === s ? 'bg-white dark:bg-slate-700 text-slate-900 dark:text-white shadow-sm' : 'text-slate-500 dark:text-slate-400'
            }`}
          >
            {s}×
          </button>
        ))}
      </div>
      <label
        className="ml-1 flex items-center gap-1 text-[11px] text-slate-600 dark:text-slate-300 whitespace-nowrap"
        title="Slow down at each chapter and skip idle stretches"
      >
        <input type="checkbox" checked={clock.smart} onChange={(e) => clock.setSmart(e.target.checked)} />
        Smart pacing
      </label>
    </div>
  );
}
