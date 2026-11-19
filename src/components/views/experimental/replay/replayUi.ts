// Non-component helpers shared by the Replay layouts: labels, formatting,
// the tree geometry and the canvas colours.

import { cardinalityRatioSeverity, formatNumberShort, nodeCardinalityRatio } from '../../../../lib/format';
import type { ReplayChapter, ReplayChapterKind, ReplayRole, ReplayScript, ReplayTrack } from '../../../../lib/replay';
import type { ReplayClock } from './useReplayClock';

export interface ReplayLayoutProps {
  script: ReplayScript;
  clock: ReplayClock;
  isDark: boolean;
  /** App palette id; canvases re-read their colours when it changes. */
  palette: string;
  selectedIds: ReadonlySet<number>;
  onSelect: (id: number) => void;
}

export const CHAPTER_LABEL: Record<ReplayChapterKind, string> = {
  start: 'Start',
  build: 'Hash build',
  spill: 'Spill',
  drain: 'Blocking step',
  loops: 'Loops',
  estimate: 'Misestimate',
  'first-row': 'First row',
  done: 'Done',
};

/** Chapters that report a problem get the warning colour; the rest stay neutral. */
export const isAlertChapter = (kind: ReplayChapterKind) => kind === 'spill' || kind === 'estimate';

export function roleLabel(tr: ReplayTrack, role: ReplayRole): string {
  switch (role) {
    case 'fill':
      return tr.kind === 'hashjoin' ? 'building hash table' : 'consuming input';
    case 'drain':
      return 'returning rows';
    case 'wait':
      return tr.kind === 'hashjoin' ? 'holding hash table' : 'waiting on input';
    case 'emit':
      return tr.perStart ? 'running per row' : tr.kind === 'hashjoin' ? 'probing' : 'streaming rows';
  }
}

export const fmtRows = (v: number) => formatNumberShort(Math.floor(v)) ?? '0';
/** Count with thousands separators. */
export const fmtFull = (v: number) => Math.floor(v).toLocaleString('en-US');

export function truncate(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, Math.max(0, max - 1))}…`;
}

export function currentChapter(script: ReplayScript, clock: ReplayClock): ReplayChapter | undefined {
  return clock.chapterIndex >= 0 ? script.chapters[clock.chapterIndex] : undefined;
}

/**
 * The cardinality error as it becomes visible during playback: an
 * over-estimate shows once the rows pass 10× the estimate, an under-estimate
 * once the operation has finished well short of it. Estimate-only plans never warn.
 */
export function misestimateVisible(tr: ReplayTrack, rows: number, done: boolean): boolean {
  if (tr.node.actualRows === undefined || tr.rowsEstimate === undefined) return false;
  if (cardinalityRatioSeverity(nodeCardinalityRatio(tr.node)) !== 'bad') return false;
  const est = Math.max(1, tr.rowsEstimate);
  return rows > est * 10 || (done && tr.rowsTotal * 10 < est);
}

// ---------------------------------------------------------------------------
// Tree geometry (top-down, root on top, rows flow upward)
// ---------------------------------------------------------------------------

export interface Box {
  id: number;
  /** Centre x. */
  x: number;
  /** Top y. */
  y: number;
  w: number;
  h: number;
}

export interface TreeGeometry {
  boxes: Map<number, Box>;
  width: number;
  height: number;
}

export function layoutTree(script: ReplayScript, nodeW: number, nodeH: number, gapX: number, gapY: number): TreeGeometry {
  const boxes = new Map<number, Box>();
  let slot = 0;
  let maxDepth = 0;
  const place = (id: number, depth: number): number => {
    const tr = script.tracks.get(id)!;
    maxDepth = Math.max(maxDepth, depth);
    let x: number;
    if (tr.childIds.length === 0) {
      x = slot * (nodeW + gapX) + nodeW / 2;
      slot++;
    } else {
      const xs = tr.childIds.map((c) => place(c, depth + 1));
      x = (xs[0] + xs[xs.length - 1]) / 2;
    }
    boxes.set(id, { id, x, y: depth * (nodeH + gapY), w: nodeW, h: nodeH });
    return x;
  };
  place(script.rootId, 0);
  return {
    boxes,
    width: Math.max(nodeW, slot * (nodeW + gapX) - gapX),
    height: (maxDepth + 1) * (nodeH + gapY) - gapY,
  };
}

export function hitTest(geo: TreeGeometry, x: number, y: number): number | undefined {
  for (const box of geo.boxes.values()) {
    if (x >= box.x - box.w / 2 && x <= box.x + box.w / 2 && y >= box.y && y <= box.y + box.h) return box.id;
  }
  return undefined;
}

// ---------------------------------------------------------------------------
// Canvas colours
// ---------------------------------------------------------------------------

export interface ReplayColors {
  bg: string;
  card: string;
  border: string;
  text: string;
  muted: string;
  faint: string;
  edge: string;
  labelBg: string;
  accent: string;
  selected: string;
  /** Spill and misestimates: the only warning colour. */
  alert: string;
}

/**
 * Canvas colours from the live CSS variables, so the app palette (which
 * redefines the slate and blue ramps) applies here too. Read them after the
 * theme class is on <html>, i.e. not during the render that changed it.
 */
export function readReplayColors(isDark: boolean): ReplayColors {
  const style = typeof document !== 'undefined' ? getComputedStyle(document.documentElement) : undefined;
  const v = (name: string, fallback: string) => style?.getPropertyValue(name).trim() || fallback;
  return isDark
    ? {
        bg: v('--canvas-bg', '#0e1526'),
        card: v('--color-slate-900', '#0f172a'),
        border: v('--color-slate-700', '#334155'),
        text: v('--color-slate-100', '#f1f5f9'),
        muted: v('--color-slate-400', '#94a3b8'),
        faint: v('--color-slate-500', '#64748b'),
        edge: v('--color-slate-700', '#334155'),
        labelBg: v('--canvas-label-bg', '#101a2e'),
        accent: v('--color-blue-400', '#60a5fa'),
        selected: v('--color-blue-500', '#3b82f6'),
        alert: '#f87171',
      }
    : {
        bg: v('--canvas-bg', '#f3f6fa'),
        card: '#ffffff',
        border: v('--color-slate-300', '#cbd5e1'),
        text: v('--color-slate-900', '#0f172a'),
        muted: v('--color-slate-500', '#64748b'),
        faint: v('--color-slate-400', '#94a3b8'),
        edge: v('--color-slate-300', '#cbd5e1'),
        labelBg: v('--canvas-label-bg', '#ffffff'),
        accent: v('--color-blue-600', '#2563eb'),
        selected: v('--color-blue-500', '#3b82f6'),
        alert: '#dc2626',
      };
}
