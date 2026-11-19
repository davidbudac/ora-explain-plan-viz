// Canvas drawing shared by the Tree and Story layouts: plan operations as
// cards, edges that carry rows up to the parent, and the client on top.
// Deliberately quiet: neutral cards, one accent for "running", one alert
// colour for spills and misestimates.

import { getWaitClassColor } from '../../../../lib/ash';
import { formatBytes } from '../../../../lib/format';
import { replayAshAt, replayStateAt, curveValueAt } from '../../../../lib/replay';
import type { ReplayScript, ReplayTrack } from '../../../../lib/replay';
import { fmtRows, misestimateVisible, roleLabel, truncate } from './replayUi';
import type { Box, ReplayColors, TreeGeometry } from './replayUi';

export const CARD_W = 200;
export const CARD_H = 76;
/** Room above the root for the client marker. */
export const CLIENT_ROOM = 56;

const MONO = 'ui-monospace, SFMono-Regular, Menlo, monospace';
const SANS = 'ui-sans-serif, system-ui, sans-serif';

export interface SceneEdge {
  child: ReplayTrack;
  /** Undefined: the edge from the root up to the client. */
  parentId?: number;
  p0: [number, number];
  p1: [number, number];
  p2: [number, number];
  p3: [number, number];
}

export function buildEdges(script: ReplayScript, geo: TreeGeometry): SceneEdge[] {
  const out: SceneEdge[] = [];
  for (const tr of script.order) {
    const box = geo.boxes.get(tr.id)!;
    if (tr.parentId === undefined) {
      out.push({
        child: tr,
        p0: [box.x, box.y],
        p1: [box.x, box.y - 14],
        p2: [box.x, box.y - 28],
        p3: [box.x, box.y - CLIENT_ROOM + 16],
      });
      continue;
    }
    const parent = script.tracks.get(tr.parentId)!;
    const pbox = geo.boxes.get(parent.id)!;
    const idx = parent.childIds.indexOf(tr.id);
    const n = parent.childIds.length;
    // Fan the edges out along the parent's bottom edge.
    const px = pbox.x + (idx - (n - 1) / 2) * Math.min(36, (pbox.w - 40) / Math.max(1, n - 1));
    const py = pbox.y + pbox.h;
    const mid = (box.y - py) * 0.5;
    out.push({
      child: tr,
      parentId: parent.id,
      p0: [box.x, box.y],
      p1: [box.x, box.y - mid],
      p2: [px, py + mid],
      p3: [px, py],
    });
  }
  return out;
}

function bezier(e: SceneEdge, u: number): [number, number] {
  const v = 1 - u;
  const a = v * v * v;
  const b = 3 * v * v * u;
  const c = 3 * v * u * u;
  const d = u * u * u;
  return [
    a * e.p0[0] + b * e.p1[0] + c * e.p2[0] + d * e.p3[0],
    a * e.p0[1] + b * e.p1[1] + c * e.p2[1] + d * e.p3[1],
  ];
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

export interface SceneOptions {
  t: number;
  colors: ReplayColors;
  /** Advances while playing; drives the slow dash on edges that carry rows. */
  flowOffset: number;
  selectedIds: ReadonlySet<number>;
  /** Operations the current chapter is about (outlined). */
  focusIds: readonly number[];
  /** Fade everything outside the focus (Story layout). */
  dimOutsideFocus?: boolean;
}

export function drawScene(ctx: CanvasRenderingContext2D, script: ReplayScript, geo: TreeGeometry, edges: SceneEdge[], o: SceneOptions) {
  const { t, colors } = o;
  const focus = new Set(o.focusIds);
  const alphaFor = (id: number) => (o.dimOutsideFocus && focus.size && !focus.has(id) ? 0.35 : 1);

  for (const e of edges) {
    const st = replayStateAt(e.child, t);
    const flowing = st.role === 'emit' || st.role === 'drain';
    const passed = curveValueAt(e.child.emit, t);
    ctx.globalAlpha = Math.min(alphaFor(e.child.id), e.parentId !== undefined ? alphaFor(e.parentId) : 1);
    ctx.beginPath();
    ctx.moveTo(...e.p0);
    ctx.bezierCurveTo(...e.p1, ...e.p2, ...e.p3);
    ctx.strokeStyle = flowing ? colors.accent : colors.edge;
    ctx.lineWidth = 1.25 + (passed > 0 ? Math.min(2.25, Math.log10(1 + passed) * 0.35) : 0);
    if (flowing) {
      ctx.setLineDash([6, 5]);
      ctx.lineDashOffset = -o.flowOffset; // dashes travel child → parent
    }
    ctx.stroke();
    ctx.setLineDash([]);
    if (passed >= 1) {
      const [mx, my] = bezier(e, 0.5);
      const label = fmtRows(passed);
      ctx.font = `10px ${MONO}`;
      const w = ctx.measureText(label).width;
      ctx.fillStyle = colors.labelBg;
      ctx.fillRect(mx + 4, my - 7, w + 6, 13);
      ctx.fillStyle = colors.muted;
      ctx.textAlign = 'left';
      ctx.fillText(label, mx + 7, my + 3);
    }
  }
  ctx.globalAlpha = 1;

  const rootBox = geo.boxes.get(script.rootId)!;
  ctx.font = `11px ${SANS}`;
  ctx.textAlign = 'center';
  ctx.fillStyle = colors.muted;
  ctx.fillText('client', rootBox.x, rootBox.y - CLIENT_ROOM + 8);

  for (const tr of script.order) {
    const box = geo.boxes.get(tr.id)!;
    ctx.globalAlpha = alphaFor(tr.id);
    drawCard(ctx, script, tr, box, o, focus.has(tr.id));
  }
  ctx.globalAlpha = 1;
}

function drawCard(ctx: CanvasRenderingContext2D, script: ReplayScript, tr: ReplayTrack, box: Box, o: SceneOptions, focused: boolean) {
  const { t, colors } = o;
  const st = replayStateAt(tr, t);
  const x = box.x - box.w / 2;
  const y = box.y;
  const { w, h } = box;
  const busy = st.role !== undefined && st.role !== 'wait';
  const base = ctx.globalAlpha;
  ctx.globalAlpha = base * (st.started ? 1 : 0.45);

  roundRect(ctx, x, y, w, h, 8);
  ctx.fillStyle = colors.card;
  ctx.fill();
  ctx.lineWidth = busy ? 1.5 : 1;
  ctx.strokeStyle = busy ? colors.accent : st.role === 'wait' ? colors.muted : colors.border;
  if (st.role === 'wait') ctx.setLineDash([4, 3]);
  ctx.stroke();
  ctx.setLineDash([]);

  if (focused) {
    ctx.save();
    ctx.globalAlpha = base * 0.45;
    ctx.lineWidth = 1;
    ctx.strokeStyle = colors.accent;
    roundRect(ctx, x - 5, y - 5, w + 10, h + 10, 11);
    ctx.stroke();
    ctx.restore();
  }
  if (o.selectedIds.has(tr.id)) {
    ctx.lineWidth = 2;
    ctx.strokeStyle = colors.selected;
    roundRect(ctx, x - 3, y - 3, w + 6, h + 6, 10);
    ctx.stroke();
  }

  // Line 1: id + operation.
  ctx.textAlign = 'left';
  ctx.font = `10px ${MONO}`;
  ctx.fillStyle = colors.faint;
  ctx.fillText(`#${tr.id}`, x + 10, y + 17);
  ctx.font = `600 12px ${SANS}`;
  ctx.fillStyle = colors.text;
  ctx.fillText(truncate(tr.node.operation, Math.floor((w - 44) / 6.6)), x + 34, y + 17);

  // Line 2: object name, TEMP once the spill has happened.
  const spillShown = tr.spillAt !== undefined && tr.tempBytes !== undefined && t >= tr.spillAt;
  const tempText = spillShown ? `TEMP ${tr.spillPredicted ? '~' : ''}${formatBytes(tr.tempBytes)}` : '';
  let tempW = 0;
  if (tempText) {
    ctx.font = `600 10px ${SANS}`;
    tempW = ctx.measureText(tempText).width + 8;
    ctx.fillStyle = colors.alert;
    ctx.textAlign = 'right';
    ctx.fillText(tempText, x + w - 10, y + 33);
    ctx.textAlign = 'left';
  }
  if (tr.node.objectName) {
    ctx.font = `11px ${SANS}`;
    ctx.fillStyle = colors.muted;
    ctx.fillText(truncate(tr.node.objectName, Math.floor((w - 20 - tempW) / 6.2)), x + 10, y + 33);
  }

  // Line 3: rows so far, with the optimizer's total next to it.
  const alert = misestimateVisible(tr, st.rows, st.done);
  ctx.font = `600 12px ${MONO}`;
  ctx.fillStyle = alert ? colors.alert : colors.text;
  const rowsText = `${fmtRows(st.rows)} rows`;
  ctx.fillText(rowsText, x + 10, y + 51);
  if (tr.rowsEstimate !== undefined && tr.node.actualRows !== undefined) {
    const rowsW = ctx.measureText(rowsText).width;
    ctx.font = `10px ${MONO}`;
    ctx.fillStyle = alert ? colors.alert : colors.faint;
    ctx.fillText(`est ${fmtRows(tr.rowsEstimate)}`, x + 16 + rowsW, y + 51);
  }

  // Line 4: what it is doing now; on the right, loop starts or (measured tier) the dominant ASH event.
  let roleW = 0;
  if (st.role) {
    ctx.font = `10px ${SANS}`;
    ctx.fillStyle = busy ? colors.accent : colors.muted;
    const label = roleLabel(tr, st.role);
    ctx.fillText(label, x + 10, y + 66);
    roleW = ctx.measureText(label).width;
  }
  const sample = st.role ? replayAshAt(script, tr.id, t) : undefined;
  if (tr.perStart && tr.startsTotal > 1 && st.started) {
    ctx.font = `10px ${MONO}`;
    ctx.fillStyle = colors.muted;
    ctx.textAlign = 'right';
    ctx.fillText(`×${fmtRows(st.starts)} starts`, x + w - 10, y + 66);
    ctx.textAlign = 'left';
  } else if (sample) {
    ctx.font = `10px ${SANS}`;
    const room = w - 20 - roleW - 22;
    let label = sample.event ?? sample.waitClass;
    while (label.length > 4 && ctx.measureText(label).width > room) label = `${label.slice(0, -2)}…`;
    const lw = ctx.measureText(label).width;
    ctx.fillStyle = colors.muted;
    ctx.textAlign = 'right';
    ctx.fillText(label, x + w - 10, y + 66);
    ctx.textAlign = 'left';
    ctx.beginPath();
    ctx.fillStyle = getWaitClassColor(sample.waitClass);
    ctx.arc(x + w - 10 - lw - 6, y + 62.5, 2.5, 0, Math.PI * 2);
    ctx.fill();
  }

  // Work area: how full it is, the memory limit, and the part that went to TEMP.
  if (tr.fill && st.started) {
    const bx = x + 10;
    const bw = w - 20;
    const by = y + h - 6;
    const level = Math.max(0, Math.min(1, st.fill));
    const lim = tr.memLimit ?? 1;
    ctx.fillStyle = colors.edge;
    ctx.fillRect(bx, by, bw, 2.5);
    ctx.fillStyle = busy ? colors.accent : colors.muted;
    ctx.fillRect(bx, by, bw * Math.min(level, lim), 2.5);
    if (level > lim) {
      ctx.fillStyle = colors.alert;
      ctx.fillRect(bx + bw * lim, by, bw * (level - lim), 2.5);
    }
    if (tr.memLimit !== undefined) {
      ctx.fillStyle = colors.text;
      ctx.fillRect(bx + bw * lim - 0.5, by - 2, 1, 6.5);
    }
  }

  ctx.globalAlpha = base;
}
