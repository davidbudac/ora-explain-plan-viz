import { describe, expect, it } from 'vitest';
import {
  WALKTHROUGH_STEPS,
  computeCardPosition,
  pickWalkthroughSample,
  spotlightRect,
} from '../walkthrough';

const VIEWPORT = { width: 1200, height: 800 };
const CARD = { width: 340, height: 200 };

describe('WALKTHROUGH_STEPS', () => {
  it('has unique ids and non-empty copy', () => {
    const ids = WALKTHROUGH_STEPS.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const step of WALKTHROUGH_STEPS) {
      expect(step.title.trim().length).toBeGreaterThan(0);
      expect(step.body.trim().length).toBeGreaterThan(0);
    }
  });

  it('opens and closes with an untargeted (centred) card', () => {
    expect(WALKTHROUGH_STEPS.length).toBeGreaterThanOrEqual(9);
    expect(WALKTHROUGH_STEPS[0].target).toBeUndefined();
    expect(WALKTHROUGH_STEPS[WALKTHROUGH_STEPS.length - 1].target).toBeUndefined();
  });

  it('selects the hot node on exactly one step', () => {
    expect(WALKTHROUGH_STEPS.filter((s) => s.action === 'selectHotNode')).toHaveLength(1);
  });
});

describe('computeCardPosition', () => {
  it('centres the card when there is no target', () => {
    const pos = computeCardPosition(null, CARD, VIEWPORT);
    expect(pos.placement).toBe('center');
    expect(pos.left).toBe((VIEWPORT.width - CARD.width) / 2);
    expect(pos.top).toBe((VIEWPORT.height - CARD.height) / 2);
  });

  it('auto prefers below the target when there is room', () => {
    const target = { top: 100, left: 400, width: 200, height: 40 };
    const pos = computeCardPosition(target, CARD, VIEWPORT, 'auto');
    expect(pos.placement).toBe('bottom');
    expect(pos.top).toBe(100 + 40 + 12);
    expect(pos.left).toBe(400 + 100 - CARD.width / 2);
  });

  it('flips to the opposite side when the requested one does not fit', () => {
    const target = { top: 700, left: 400, width: 200, height: 40 };
    const pos = computeCardPosition(target, CARD, VIEWPORT, 'bottom');
    expect(pos.placement).toBe('top');
    expect(pos.top).toBe(700 - 12 - CARD.height);
  });

  it('auto falls through to the right, then left, when top and bottom are full', () => {
    const tall = { top: 20, left: 20, width: 200, height: 760 };
    expect(computeCardPosition(tall, CARD, VIEWPORT, 'auto').placement).toBe('right');
    const tallRight = { top: 20, left: 980, width: 200, height: 760 };
    expect(computeCardPosition(tallRight, CARD, VIEWPORT, 'auto').placement).toBe('left');
  });

  it('honours a placement that fits', () => {
    const target = { top: 300, left: 700, width: 100, height: 100 };
    const pos = computeCardPosition(target, CARD, VIEWPORT, 'left');
    expect(pos.placement).toBe('left');
    expect(pos.left).toBe(700 - 12 - CARD.width);
  });

  it('clamps the card inside the viewport with an 8px margin', () => {
    const target = { top: 10, left: 0, width: 40, height: 20 };
    const pos = computeCardPosition(target, CARD, VIEWPORT, 'bottom');
    expect(pos.left).toBe(8);
    const edge = { top: 10, left: 1180, width: 20, height: 20 };
    const pos2 = computeCardPosition(edge, CARD, VIEWPORT, 'bottom');
    expect(pos2.left).toBe(VIEWPORT.width - CARD.width - 8);
    expect(pos2.top).toBeLessThanOrEqual(VIEWPORT.height - CARD.height - 8);
  });

  it('never leaves the viewport even when the card is larger than it', () => {
    const pos = computeCardPosition({ top: 5, left: 5, width: 10, height: 10 }, { width: 500, height: 500 }, { width: 300, height: 300 });
    expect(pos.left).toBe(8);
    expect(pos.top).toBe(8);
  });
});

describe('spotlightRect', () => {
  it('pads the target', () => {
    expect(spotlightRect({ top: 100, left: 100, width: 50, height: 30 }, VIEWPORT)).toEqual({
      top: 94, left: 94, width: 62, height: 42,
    });
  });

  it('clamps to the viewport', () => {
    const rect = spotlightRect({ top: 2, left: 2, width: 1300, height: 900 }, VIEWPORT, 6);
    expect(rect).toEqual({ top: 0, left: 0, width: 1200, height: 800 });
  });
});

describe('pickWalkthroughSample', () => {
  const mk = (name: string, featured = false) => ({ name, category: 'sql_monitor', featured });
  it('prefers the Cardinality Trap sample', () => {
    const trap = mk('Cardinality Trap (NL)');
    expect(pickWalkthroughSample({ sql_monitor: [mk('Other', true), trap] }, [mk('Simple')])).toBe(trap);
  });
  it('falls back to a featured monitor sample, then any featured, then any monitor sample', () => {
    const featuredMonitor = mk('A', true);
    expect(pickWalkthroughSample({ sql_monitor: [mk('B'), featuredMonitor] }, [])).toBe(featuredMonitor);
    const featured = mk('F', true);
    expect(pickWalkthroughSample({ sql_monitor: [mk('B')] }, [featured])).toBe(featured);
    const only = mk('B');
    expect(pickWalkthroughSample({ sql_monitor: [only] }, [])).toBe(only);
    expect(pickWalkthroughSample({ sql_monitor: [] }, [])).toBeNull();
  });
});
