import { describe, expect, it } from 'vitest';
import { selectVisibleLabels } from '../sankeyLabels';
import type { LabelBox } from '../sankeyLabels';

/** The original all-pairs algorithm from SankeyView, kept verbatim as the reference. */
function referenceVisible(boxes: readonly LabelBox[], pad = 2): boolean[] {
  const measured = boxes.map((box, index) => ({ index, box }));
  measured.sort((a, b) => a.box.y - b.box.y || a.box.x - b.box.x);
  const kept: LabelBox[] = [];
  const keep: boolean[] = new Array(boxes.length).fill(false);
  for (const { index, box } of measured) {
    const collides = kept.some(
      (k) =>
        box.x < k.x + k.width + pad &&
        box.x + box.width + pad > k.x &&
        box.y < k.y + k.height + pad &&
        box.y + box.height + pad > k.y,
    );
    if (!collides) {
      kept.push(box);
      keep[index] = true;
    }
  }
  return keep;
}

/** Small deterministic PRNG (mulberry32). */
function rng(seed: number) {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

describe('selectVisibleLabels', () => {
  it('keeps everything when nothing overlaps', () => {
    const boxes = [
      { x: 0, y: 0, width: 50, height: 12 },
      { x: 0, y: 40, width: 50, height: 12 },
      { x: 200, y: 0, width: 50, height: 12 },
    ];
    expect(selectVisibleLabels(boxes)).toEqual([true, true, true]);
  });

  it('drops the later label of an overlapping pair (top-to-bottom, then left-to-right)', () => {
    const boxes = [
      { x: 10, y: 20, width: 60, height: 12 }, // below
      { x: 10, y: 10, width: 60, height: 12 }, // above: wins
    ];
    expect(selectVisibleLabels(boxes)).toEqual([false, true]);
  });

  it('treats a gap smaller than the padding as a collision, but not a gap of exactly the padding', () => {
    const base = { x: 0, y: 0, width: 50, height: 12 };
    expect(selectVisibleLabels([base, { x: 0, y: 13, width: 50, height: 12 }])).toEqual([true, false]);
    expect(selectVisibleLabels([base, { x: 0, y: 14, width: 50, height: 12 }])).toEqual([true, true]);
  });

  it('handles empty input and non-finite boxes', () => {
    expect(selectVisibleLabels([])).toEqual([]);
    const boxes = [
      { x: NaN, y: 0, width: 10, height: 10 },
      { x: 0, y: 0, width: 10, height: 10 },
    ];
    expect(selectVisibleLabels(boxes)).toEqual(referenceVisible(boxes));
  });

  it('matches the all-pairs reference on random inputs (fixed seed)', () => {
    const rand = rng(20261001);
    for (let round = 0; round < 60; round++) {
      const n = 1 + Math.floor(rand() * 250);
      const spreadX = 100 + rand() * 1500;
      const spreadY = 50 + rand() * 1500;
      const boxes: LabelBox[] = [];
      for (let i = 0; i < n; i++) {
        boxes.push({
          x: Math.round(rand() * spreadX * 4) / 4,
          y: Math.round(rand() * spreadY * 4) / 4,
          width: Math.round(rand() * 260 * 4) / 4,
          height: 8 + Math.round(rand() * 6),
        });
      }
      const pad = round % 3 === 0 ? 0 : 2;
      expect(selectVisibleLabels(boxes, pad)).toEqual(referenceVisible(boxes, pad));
    }
  });

  it('matches the reference with ties, negative coordinates and giant boxes', () => {
    const rand = rng(7);
    const boxes: LabelBox[] = [];
    for (let i = 0; i < 200; i++) {
      boxes.push({
        // few distinct values so y/x ties are common
        x: Math.floor(rand() * 6) * 40 - 60,
        y: Math.floor(rand() * 10) * 12 - 20,
        width: 30 + Math.floor(rand() * 4) * 20,
        height: 12,
      });
    }
    boxes.push({ x: -5000, y: 300, width: 100000, height: 14 });
    boxes.push({ x: 0, y: -4000, width: 20, height: 9000 });
    expect(selectVisibleLabels(boxes)).toEqual(referenceVisible(boxes));
  });

  it('stays fast on a large plan', () => {
    // A plan with thousands of operations: all-pairs would be tens of millions of comparisons
    const boxes: LabelBox[] = [];
    for (let i = 0; i < 6000; i++) {
      boxes.push({ x: (i % 4) * 300, y: Math.floor(i / 4) * 5, width: 180, height: 12 });
    }
    const start = performance.now();
    const keep = selectVisibleLabels(boxes);
    expect(performance.now() - start).toBeLessThan(1000);
    expect(keep).toEqual(referenceVisible(boxes));
  });
});
