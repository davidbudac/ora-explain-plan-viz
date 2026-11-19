// Replay layout "Story": chapter by chapter. The camera moves to the
// operations the current chapter is about and fades the rest; the side panel
// lists the chapters with the numbers behind the current one.

import { useEffect, useMemo, useRef } from 'react';
import { formatBytes } from '../../../../lib/format';
import { formatReplayTime, replayStateAt } from '../../../../lib/replay';
import type { ReplayScript } from '../../../../lib/replay';
import { FOCUS_RING } from '../../../ui';
import { buildEdges, CARD_H, CARD_W, CLIENT_ROOM, drawScene } from './drawScene';
import { ChapterChip, Transport } from './ReplayControls';
import { currentChapter, fmtFull, hitTest, layoutTree, misestimateVisible, readReplayColors } from './replayUi';
import type { ReplayColors, ReplayLayoutProps, TreeGeometry } from './replayUi';
import type { ReplayClock } from './useReplayClock';
import { useElementSize } from './useElementSize';

const GAP_X = 48;
const GAP_Y = 60;
const FLOW_SPEED = 18;
const MAX_ZOOM = 1.3;

interface Cam {
  x: number;
  y: number;
  z: number;
}

function fitAll(geo: TreeGeometry, w: number, h: number): Cam {
  const totalH = geo.height + CLIENT_ROOM;
  return {
    x: geo.width / 2,
    y: geo.height / 2 - CLIENT_ROOM / 2,
    z: Math.min(1.1, (w - 48) / geo.width, (h - 48) / totalH),
  };
}

function focusCam(geo: TreeGeometry, ids: readonly number[], w: number, h: number): Cam {
  const all = fitAll(geo, w, h);
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const id of ids) {
    const b = geo.boxes.get(id);
    if (!b) continue;
    x0 = Math.min(x0, b.x - b.w / 2);
    x1 = Math.max(x1, b.x + b.w / 2);
    y0 = Math.min(y0, b.y);
    y1 = Math.max(y1, b.y + b.h);
  }
  if (!Number.isFinite(x0)) return all;
  const z = Math.max(all.z, Math.min(MAX_ZOOM, (w * 0.7) / (x1 - x0 + 160), (h * 0.7) / (y1 - y0 + 160)));
  return { x: (x0 + x1) / 2, y: (y0 + y1) / 2, z };
}

export function ReplayStory({ script, clock, isDark, palette, selectedIds, onSelect }: ReplayLayoutProps) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const size = useElementSize(wrapRef);
  const geo = useMemo(() => layoutTree(script, CARD_W, CARD_H, GAP_X, GAP_Y), [script]);
  const edges = useMemo(() => buildEdges(script, geo), [script, geo]);

  const chapter = currentChapter(script, clock);
  const focusIds = chapter?.focus;
  // Before the first chapter and at the end, the camera shows the whole plan.
  const overview = !chapter || chapter.kind === 'done';
  const live = useRef({ selectedIds, focusIds: focusIds ?? [], overview, themeKey: `${isDark}|${palette}`, isDark });
  useEffect(() => {
    live.current = { selectedIds, focusIds: focusIds ?? [], overview, themeKey: `${isDark}|${palette}`, isDark };
  }, [selectedIds, focusIds, overview, isDark, palette]);
  const camRef = useRef<Cam | null>(null);

  const { tRef, playingRef, speedRef } = clock;
  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.floor(size.w * dpr);
    canvas.height = Math.floor(size.h * dpr);

    let raf = 0;
    let last = performance.now();
    let flowOffset = 0;
    let colors: ReplayColors | null = null;
    let colorsKey = '';
    let drawnT = NaN;
    let drawnLive: typeof live.current | null = null;
    let settled = false;

    const frame = (now: number) => {
      raf = requestAnimationFrame(frame);
      const dt = Math.min(0.1, (now - last) / 1000);
      last = now;
      const playing = playingRef.current;
      if (playing) flowOffset += dt * speedRef.current * FLOW_SPEED;
      const l = live.current;

      const target = l.overview ? fitAll(geo, size.w, size.h) : focusCam(geo, l.focusIds, size.w, size.h);
      const cam = camRef.current ?? { ...target };
      const k = 1 - Math.exp(-dt * 3);
      cam.x += (target.x - cam.x) * k;
      cam.y += (target.y - cam.y) * k;
      cam.z += (target.z - cam.z) * k;
      camRef.current = cam;
      const moving = Math.abs(target.x - cam.x) > 0.5 || Math.abs(target.y - cam.y) > 0.5 || Math.abs(target.z - cam.z) > 0.002;

      // Paused, camera at rest and nothing changed: keep the last frame.
      if (!playing && !moving && settled && tRef.current === drawnT && l === drawnLive) return;
      settled = !moving;
      drawnT = tRef.current;
      drawnLive = l;
      if (!colors || colorsKey !== l.themeKey) {
        colors = readReplayColors(l.isDark);
        colorsKey = l.themeKey;
      }

      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.fillStyle = colors.bg;
      ctx.fillRect(0, 0, size.w, size.h);
      ctx.setTransform(dpr * cam.z, 0, 0, dpr * cam.z, dpr * (size.w / 2 - cam.x * cam.z), dpr * (size.h / 2 - cam.y * cam.z));
      drawScene(ctx, script, geo, edges, {
        t: tRef.current,
        colors,
        flowOffset,
        selectedIds: l.selectedIds,
        focusIds: l.focusIds,
        dimOutsideFocus: !l.overview,
      });
      drawMinimap(ctx, script, geo, cam, size, dpr, colors, tRef.current);
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, [size, geo, edges, script, tRef, playingRef, speedRef]);

  const onClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const cam = camRef.current;
    if (!cam) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const x = (e.clientX - rect.left - size.w / 2) / cam.z + cam.x;
    const y = (e.clientY - rect.top - size.h / 2) / cam.z + cam.y;
    const id = hitTest(geo, x, y);
    if (id !== undefined) onSelect(id);
  };

  return (
    <div className="h-full flex flex-col">
      <div className="flex-1 min-h-0 flex">
        <div ref={wrapRef} className="flex-1 min-w-0 relative">
          <canvas
            ref={canvasRef}
            onClick={onClick}
            className="absolute inset-0 w-full h-full cursor-pointer"
            role="img"
            aria-label="Plan tree, zoomed to the current chapter"
          />
        </div>
        <ChapterPanel script={script} clock={clock} />
      </div>
      <Transport script={script} clock={clock} />
    </div>
  );
}

function drawMinimap(
  ctx: CanvasRenderingContext2D,
  script: ReplayScript,
  geo: TreeGeometry,
  cam: Cam,
  size: { w: number; h: number },
  dpr: number,
  colors: ReplayColors,
  t: number,
) {
  // Only useful while zoomed in.
  if (cam.z <= fitAll(geo, size.w, size.h).z * 1.05) return;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  const mw = 132;
  const mh = Math.max(56, Math.min(110, (geo.height / geo.width) * mw));
  const mx = size.w - mw - 12;
  const my = 12;
  const ms = Math.min((mw - 12) / geo.width, (mh - 12) / geo.height);
  ctx.globalAlpha = 0.92;
  ctx.fillStyle = colors.card;
  ctx.fillRect(mx, my, mw, mh);
  ctx.globalAlpha = 1;
  ctx.strokeStyle = colors.border;
  ctx.lineWidth = 1;
  ctx.strokeRect(mx + 0.5, my + 0.5, mw - 1, mh - 1);
  const mox = mx + (mw - geo.width * ms) / 2;
  const moy = my + (mh - geo.height * ms) / 2;
  for (const tr of script.order) {
    const b = geo.boxes.get(tr.id)!;
    const st = replayStateAt(tr, t);
    const busy = st.role !== undefined && st.role !== 'wait';
    ctx.globalAlpha = busy ? 0.7 : 1;
    ctx.fillStyle = busy ? colors.accent : colors.edge;
    ctx.fillRect(mox + (b.x - b.w / 2) * ms, moy + b.y * ms, Math.max(2, b.w * ms), Math.max(1.5, b.h * ms));
  }
  ctx.globalAlpha = 1;
  const vw = size.w / cam.z;
  const vh = size.h / cam.z;
  ctx.save();
  ctx.beginPath();
  ctx.rect(mx, my, mw, mh);
  ctx.clip();
  ctx.strokeStyle = colors.muted;
  ctx.strokeRect(mox + (cam.x - vw / 2) * ms, moy + (cam.y - vh / 2) * ms, vw * ms, vh * ms);
  ctx.restore();
}

function ChapterPanel({ script, clock }: { script: ReplayScript; clock: ReplayClock }) {
  const listRef = useRef<HTMLOListElement>(null);
  const idx = clock.chapterIndex;
  useEffect(() => {
    const el = listRef.current?.querySelector<HTMLElement>('[aria-current="step"]');
    el?.scrollIntoView?.({ block: 'nearest' });
  }, [idx]);

  return (
    <aside className="w-80 shrink-0 border-l border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 flex flex-col min-h-0">
      <div className="px-4 py-2 border-b border-slate-200 dark:border-slate-800 text-[11px] text-slate-500 dark:text-slate-400">
        {idx >= 0 ? `Chapter ${idx + 1} of ${script.chapters.length}` : `${script.chapters.length} chapters · press play (Space)`}
      </div>
      <ol ref={listRef} className="flex-1 min-h-0 overflow-auto py-1" aria-label="Chapters">
        {script.chapters.map((c, i) => {
          const current = i === idx;
          return (
            <li key={i} aria-current={current ? 'step' : undefined}>
              <button
                type="button"
                onClick={() => clock.seek(c.t)}
                className={`w-full text-left px-4 py-2 ${FOCUS_RING} ${
                  current ? 'bg-blue-50/70 dark:bg-blue-500/10' : 'hover:bg-slate-50 dark:hover:bg-slate-800/60'
                } ${i > idx ? 'opacity-60' : ''}`}
              >
                <div className="flex items-center gap-2">
                  <span className="w-4 text-[11px] font-mono text-slate-400 tabular-nums">{i + 1}</span>
                  <ChapterChip kind={c.kind} />
                  <span className="ml-auto text-[10px] font-mono text-slate-400">{formatReplayTime(script, c.t)}</span>
                </div>
                <div className={`mt-1 pl-6 text-[13px] ${current ? 'font-semibold text-slate-900 dark:text-slate-50' : 'text-slate-700 dark:text-slate-200'}`}>
                  {c.title}
                </div>
              </button>
              {current && (
                <div className="px-4 pb-3 pl-10 bg-blue-50/70 dark:bg-blue-500/10">
                  <p className="text-xs leading-relaxed text-slate-600 dark:text-slate-300">{c.caption}</p>
                  <FocusNumbers script={script} id={c.focus[0]} t={clock.t} />
                </div>
              )}
            </li>
          );
        })}
      </ol>
    </aside>
  );
}

/** Live numbers for the chapter's main operation. */
function FocusNumbers({ script, id, t }: { script: ReplayScript; id: number | undefined; t: number }) {
  const tr = id !== undefined ? script.tracks.get(id) : undefined;
  if (!tr) return null;
  const st = replayStateAt(tr, t);
  const alert = misestimateVisible(tr, st.rows, st.done);
  const hasActual = tr.node.actualRows !== undefined;
  return (
    <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-[11px]">
      <dt className="col-span-2 mb-0.5 text-slate-500 dark:text-slate-400 truncate">
        #{tr.id} {tr.label}
      </dt>
      <dt className="text-slate-500 dark:text-slate-400">Rows</dt>
      <dd className="font-mono tabular-nums">
        <span className={`font-semibold ${alert ? 'text-red-600 dark:text-red-400' : 'text-slate-900 dark:text-slate-100'}`}>{fmtFull(st.rows)}</span>
        {hasActual && tr.rowsPlanned !== undefined && <span className="text-slate-400"> · planned ≈ {fmtFull(tr.rowsPlanned)}</span>}
      </dd>
      {tr.startsTotal > 1 && (
        <>
          <dt className="text-slate-500 dark:text-slate-400">Starts</dt>
          <dd className="font-mono tabular-nums">
            <span className="font-semibold text-slate-900 dark:text-slate-100">{fmtFull(st.starts)}</span>
            {hasActual && <span className="text-slate-400"> · planned ≈ {fmtFull(tr.plannedStarts)}</span>}
          </dd>
        </>
      )}
      {tr.tempBytes !== undefined && tr.spillAt !== undefined && t >= tr.spillAt && (
        <>
          <dt className="text-slate-500 dark:text-slate-400">TEMP</dt>
          <dd className="font-mono font-semibold text-red-600 dark:text-red-400">
            {tr.spillPredicted ? '~' : ''}{formatBytes(tr.tempBytes)}
          </dd>
        </>
      )}
    </dl>
  );
}
