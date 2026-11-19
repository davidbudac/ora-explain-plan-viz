// Playback clock shared by the three Replay layouts (it lives in the view
// shell, so switching layouts keeps the playhead). With "smart pacing" on,
// wall time is warped so each chapter gets a few seconds on screen even when
// the script packs several into one instant, and idle stretches are skipped;
// the scrubber always shows script time.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ReplayScript } from '../../../../lib/replay';

/** Wall seconds for a whole replay at 1× without pacing. */
const BASE_WALL_SECS = 18;
/** Wall seconds each chapter holds the screen at 1× with pacing. */
const CHAPTER_DWELL_SECS = 2.8;
/** Longest an idle stretch (nothing busy) may take with pacing. */
const IDLE_MAX_SECS = 0.4;

interface Pacing {
  /** Script times. */
  s: number[];
  /** Matching wall times. */
  w: number[];
}

function buildPacing(script: ReplayScript, smart: boolean): Pacing {
  const d = script.duration;
  if (!smart) return { s: [0, d], w: [0, BASE_WALL_SECS] };
  const clampT = (v: number) => Math.min(d, Math.max(0, v));
  const spanEdges = script.order.flatMap((tr) => tr.spans.flatMap((s) => [s.from, s.to]));
  const marks = [...new Set([0, ...script.chapters.map((c) => clampT(c.t)), ...spanEdges.map(clampT), d])].sort((a, b) => a - b);
  const chapterTimes = new Set(script.chapters.filter((c) => c.kind !== 'done').map((c) => clampT(c.t)));
  const w = [0];
  for (let i = 0; i < marks.length - 1; i++) {
    const mid = (marks[i] + marks[i + 1]) / 2;
    const busy = script.order.some((tr) => tr.spans.some((s) => s.role !== 'wait' && mid >= s.from && mid < s.to));
    let share = ((marks[i + 1] - marks[i]) / d) * BASE_WALL_SECS;
    if (!busy) share = Math.min(share, IDLE_MAX_SECS);
    const dwell = chapterTimes.has(marks[i]) ? CHAPTER_DWELL_SECS : 0;
    w.push(w[i] + Math.max(share, dwell, 0.0001));
  }
  return { s: marks, w };
}

function interp(xs: number[], ys: number[], x: number): number {
  if (x <= xs[0]) return ys[0];
  for (let i = 1; i < xs.length; i++) {
    if (x <= xs[i]) {
      const span = xs[i] - xs[i - 1];
      return span === 0 ? ys[i] : ys[i - 1] + ((ys[i] - ys[i - 1]) * (x - xs[i - 1])) / span;
    }
  }
  return ys[ys.length - 1];
}

export interface ReplayClock {
  /** Script time of the playhead. */
  t: number;
  playing: boolean;
  speed: number;
  smart: boolean;
  /** Pacing currently plays this stretch much slower than linear playback. */
  slowMo: boolean;
  /** Live values for canvas animation loops (read them in rAF callbacks, not during render). */
  tRef: React.RefObject<number>;
  playingRef: React.RefObject<boolean>;
  speedRef: React.RefObject<number>;
  /** Index of the latest chapter at or before the playhead (-1 before the first). */
  chapterIndex: number;
  play: () => void;
  pause: () => void;
  toggle: () => void;
  seek: (t: number) => void;
  setSpeed: (s: number) => void;
  setSmart: (on: boolean) => void;
  restart: () => void;
  nextChapter: () => void;
  prevChapter: () => void;
}

export function useReplayClock(script: ReplayScript): ReplayClock {
  const [t, setT] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeedState] = useState(1);
  const [smart, setSmart] = useState(true);
  const tRef = useRef(0);
  const wRef = useRef(0);
  const playingRef = useRef(false);
  const speedRef = useRef(1);
  const pacing = useMemo(() => buildPacing(script, smart), [script, smart]);
  const pacingRef = useRef(pacing);
  const duration = script.duration;

  // Re-anchor the wall position when the pacing map changes.
  useEffect(() => {
    pacingRef.current = pacing;
    wRef.current = interp(pacing.s, pacing.w, tRef.current);
  }, [pacing]);

  useEffect(() => {
    playingRef.current = playing;
    if (!playing) return;
    let raf = 0;
    let last = performance.now();
    const tick = (now: number) => {
      const dt = Math.min(0.1, (now - last) / 1000);
      last = now;
      const p = pacingRef.current;
      const wEnd = p.w[p.w.length - 1];
      wRef.current = Math.min(wEnd, wRef.current + dt * speedRef.current);
      const next = interp(p.w, p.s, wRef.current);
      tRef.current = next;
      setT(next);
      if (wRef.current >= wEnd) {
        playingRef.current = false;
        setPlaying(false);
        return;
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playing]);

  const seek = useCallback((next: number) => {
    const clamped = Math.min(duration, Math.max(0, next));
    tRef.current = clamped;
    wRef.current = interp(pacingRef.current.s, pacingRef.current.w, clamped);
    setT(clamped);
  }, [duration]);

  const play = useCallback(() => {
    if (tRef.current >= duration - 1e-9) seek(0);
    setPlaying(true);
  }, [duration, seek]);
  const pause = useCallback(() => setPlaying(false), []);
  const toggle = useCallback(() => (playingRef.current ? pause() : play()), [pause, play]);
  const restart = useCallback(() => {
    seek(0);
    setPlaying(true);
  }, [seek]);
  const setSpeed = useCallback((s: number) => {
    speedRef.current = s;
    setSpeedState(s);
  }, []);

  const chapters = script.chapters;
  const chapterIndex = useMemo(() => {
    let idx = -1;
    for (let i = 0; i < chapters.length; i++) if (chapters[i].t <= t + 1e-9) idx = i;
    return idx;
  }, [chapters, t]);

  const nextChapter = useCallback(() => {
    const c = chapters.find((ch) => ch.t > tRef.current + 1e-6);
    if (c) seek(c.t);
  }, [chapters, seek]);
  const prevChapter = useCallback(() => {
    const before = chapters.filter((ch) => ch.t < tRef.current - 1e-6);
    seek(before.length ? before[before.length - 1].t : 0);
  }, [chapters, seek]);

  const slowMo = useMemo(() => {
    if (!smart) return false;
    const { s, w } = pacing;
    for (let i = 1; i < s.length; i++) {
      if (t <= s[i]) {
        const local = (w[i] - w[i - 1]) / Math.max(1e-9, s[i] - s[i - 1]);
        return local > (BASE_WALL_SECS / duration) * 2.5;
      }
    }
    return false;
  }, [pacing, smart, t, duration]);

  return {
    t,
    playing,
    speed,
    smart,
    slowMo,
    tRef,
    playingRef,
    speedRef,
    chapterIndex,
    play,
    pause,
    toggle,
    seek,
    setSpeed,
    setSmart,
    restart,
    nextChapter,
    prevChapter,
  };
}
