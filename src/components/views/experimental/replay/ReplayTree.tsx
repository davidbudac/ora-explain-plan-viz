// Replay layout "Tree": the whole plan tree, fitted to the view. Cards show
// what each operation is doing and how many rows it has produced; edges carry
// rows up to the parent while they flow.

import { useEffect, useMemo, useRef } from 'react';
import { buildEdges, CARD_H, CARD_W, CLIENT_ROOM, drawScene } from './drawScene';
import { CaptionStrip, Transport } from './ReplayControls';
import { currentChapter, hitTest, layoutTree, readReplayColors } from './replayUi';
import type { ReplayColors, ReplayLayoutProps } from './replayUi';
import { useElementSize } from './useElementSize';

const GAP_X = 48;
const MIN_GAP_Y = 30;
const MAX_GAP_Y = 64;
const PAD = 24;
/** Dash travel per wall second at 1×. */
const FLOW_SPEED = 18;

export function ReplayTree({ script, clock, isDark, palette, selectedIds, onSelect }: ReplayLayoutProps) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const size = useElementSize(wrapRef);

  const maxDepth = useMemo(() => Math.max(1, ...script.order.map((tr) => tr.depth)), [script]);
  const gapY = Math.round(Math.min(MAX_GAP_Y, Math.max(MIN_GAP_Y, (size.h - PAD * 2 - CLIENT_ROOM - (maxDepth + 1) * CARD_H) / maxDepth)));
  const geo = useMemo(() => layoutTree(script, CARD_W, CARD_H, GAP_X, gapY), [script, gapY]);
  const edges = useMemo(() => buildEdges(script, geo), [script, geo]);

  const scale = Math.min(1.1, (size.w - PAD * 2) / geo.width, (size.h - PAD * 2 - CLIENT_ROOM) / geo.height);
  const ox = (size.w - geo.width * scale) / 2;
  const oy = PAD + CLIENT_ROOM * scale;

  // Latest props for the animation loop, without restarting it.
  const focusIds = currentChapter(script, clock)?.focus;
  const live = useRef({ selectedIds, focusIds: focusIds ?? [], themeKey: `${isDark}|${palette}`, isDark });
  useEffect(() => {
    live.current = { selectedIds, focusIds: focusIds ?? [], themeKey: `${isDark}|${palette}`, isDark };
  }, [selectedIds, focusIds, isDark, palette]);

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
    const frame = (now: number) => {
      raf = requestAnimationFrame(frame);
      const dt = Math.min(0.1, (now - last) / 1000);
      last = now;
      const playing = playingRef.current;
      if (playing) flowOffset += dt * speedRef.current * FLOW_SPEED;
      const l = live.current;
      // Paused and nothing changed: keep the last frame.
      if (!playing && tRef.current === drawnT && l === drawnLive) return;
      drawnT = tRef.current;
      drawnLive = l;
      if (!colors || colorsKey !== l.themeKey) {
        colors = readReplayColors(l.isDark);
        colorsKey = l.themeKey;
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.fillStyle = colors.bg;
      ctx.fillRect(0, 0, size.w, size.h);
      ctx.setTransform(dpr * scale, 0, 0, dpr * scale, dpr * ox, dpr * oy);
      drawScene(ctx, script, geo, edges, {
        t: tRef.current,
        colors,
        flowOffset,
        selectedIds: l.selectedIds,
        focusIds: l.focusIds,
      });
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, [size, geo, edges, script, scale, ox, oy, tRef, playingRef, speedRef]);

  const onClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const id = hitTest(geo, (e.clientX - rect.left - ox) / scale, (e.clientY - rect.top - oy) / scale);
    if (id !== undefined) onSelect(id);
  };

  return (
    <div className="h-full flex flex-col">
      <div ref={wrapRef} className="flex-1 min-h-0 relative">
        <canvas
          ref={canvasRef}
          onClick={onClick}
          className="absolute inset-0 w-full h-full cursor-pointer"
          role="img"
          aria-label={`Animated plan tree with ${script.order.length} operations`}
        />
      </div>
      <CaptionStrip script={script} clock={clock} />
      <Transport script={script} clock={clock} />
    </div>
  );
}
