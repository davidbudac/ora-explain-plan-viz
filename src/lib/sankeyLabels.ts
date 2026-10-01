/** A measured label box (SVG `getBBox()` output). */
export interface LabelBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Spatial-grid cell size. Labels are ~11px tall and up to a few hundred px wide. */
const CELL_W = 96;
const CELL_H = 24;
/** A box spanning more cells than this is compared directly instead of being bucketed. */
const MAX_CELLS_PER_BOX = 256;

function isFiniteBox(b: LabelBox): boolean {
  return Number.isFinite(b.x) && Number.isFinite(b.y) && Number.isFinite(b.width) && Number.isFinite(b.height);
}

/** Two boxes collide when they overlap or sit closer than `pad` to each other. */
function collides(box: LabelBox, k: LabelBox, pad: number): boolean {
  return (
    box.x < k.x + k.width + pad &&
    box.x + box.width + pad > k.x &&
    box.y < k.y + k.height + pad &&
    box.y + box.height + pad > k.y
  );
}

/**
 * Decide which labels stay visible: greedy top-to-bottom (then left-to-right),
 * a label is dropped when its box collides with one already kept. Returns a
 * flag per input box, in input order.
 *
 * Kept boxes are bucketed in a uniform grid so each label is only compared
 * against the kept boxes in the cells its padded box touches (roughly linear
 * overall instead of comparing every label with every kept one). The result is
 * identical to the straightforward all-pairs scan.
 */
export function selectVisibleLabels(boxes: readonly LabelBox[], pad = 2): boolean[] {
  const order = boxes.map((_, i) => i);
  order.sort((a, b) => boxes[a].y - boxes[b].y || boxes[a].x - boxes[b].x);

  const keep: boolean[] = new Array(boxes.length).fill(false);
  const grid = new Map<string, LabelBox[]>();
  const keptAll: LabelBox[] = [];
  // Kept boxes too large to bucket cheaply; every candidate is checked against them
  const oversized: LabelBox[] = [];

  const cellRange = (lo: number, hi: number, size: number): [number, number] => [Math.floor(lo / size), Math.floor(hi / size)];

  for (const index of order) {
    const box = boxes[index];

    // Non-finite coordinates never satisfy a comparison, so such a box neither
    // collides with anything nor blocks anything.
    if (!isFiniteBox(box)) {
      keep[index] = true;
      continue;
    }

    // Any kept box that collides has an extent overlapping this box grown by `pad`
    const [cx0, cx1] = cellRange(box.x - pad, box.x + box.width + pad, CELL_W);
    const [cy0, cy1] = cellRange(box.y - pad, box.y + box.height + pad, CELL_H);
    const queryCells = (cx1 - cx0 + 1) * (cy1 - cy0 + 1);

    let hit = false;
    if (queryCells > MAX_CELLS_PER_BOX) {
      hit = keptAll.some((k) => collides(box, k, pad));
    } else {
      hit = oversized.some((k) => collides(box, k, pad));
      for (let cx = cx0; cx <= cx1 && !hit; cx++) {
        for (let cy = cy0; cy <= cy1 && !hit; cy++) {
          const bucket = grid.get(`${cx},${cy}`);
          if (bucket && bucket.some((k) => collides(box, k, pad))) hit = true;
        }
      }
    }
    if (hit) continue;

    keep[index] = true;
    keptAll.push(box);
    const [kx0, kx1] = cellRange(box.x, box.x + box.width, CELL_W);
    const [ky0, ky1] = cellRange(box.y, box.y + box.height, CELL_H);
    if ((kx1 - kx0 + 1) * (ky1 - ky0 + 1) > MAX_CELLS_PER_BOX) {
      oversized.push(box);
      continue;
    }
    for (let cx = kx0; cx <= kx1; cx++) {
      for (let cy = ky0; cy <= ky1; cy++) {
        const key = `${cx},${cy}`;
        const bucket = grid.get(key);
        if (bucket) bucket.push(box);
        else grid.set(key, [box]);
      }
    }
  }

  return keep;
}
