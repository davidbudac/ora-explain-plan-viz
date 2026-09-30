import { describe, expect, it } from 'vitest';
import { computeTopBarLayout, fitViewTabs, PRIORITY_LABELS, type TitleMode, type TopBarMeasurements } from '../topBarLayout';

// Realistic widths measured in the app (text-xs tabs, 40px icon-only tabs) with
// one plan loaded and a SQL Monitor XML plan, i.e. ten views:
// Tree, Compare, Tabular, Sankey, Flame, Plan Text, SQL, Metadata, Monitor, Experimental.
const LABELLED = [72, 100, 90, 89, 81, 100, 70, 101, 92, 123];
const ICONS = LABELLED.map(() => 40);
const sum = (values: number[]) => values.reduce((a, b) => a + b, 0);
// Ribbon width (12px chrome included) with `k` leading labels and icons for the rest.
const strip = (k: number, labelled = LABELLED) => 12 + sum(labelled.slice(0, k)) + 40 * (labelled.length - k);

// Fixed clusters at desktop width (File / Appearance / Help inline) and below
// 1100px (actions folded into one "⋯" menu).
const DESKTOP_FIXED = { fixedLabelled: 792, fixedCollapsed: 401 };
const FOLDED_FIXED = { fixedLabelled: 369, fixedCollapsed: 185 };

/**
 * The budget the ribbon computes for a window of `viewport` px: the bar's
 * 12px side padding, the 8px gaps between its five children, and 2px of slack.
 */
const barBudget = (viewport: number) => viewport - 24 - 4 * 8 - 2;

function measurements(overrides: Partial<TopBarMeasurements> = {}): TopBarMeasurements {
  return {
    budget: 2400,
    ...DESKTOP_FIXED,
    planFull: 304,
    planCompact: 113,
    tabLabelled: LABELLED,
    tabIcon: ICONS,
    stripChrome: 12,
    overflowTrigger: 34,
    // "SQL ID: 96d05a34rtfqx" — prefix, id, drawer chevron and padding.
    titleFull: 195,
    // The same title without "SQL ID: " (the 13-char id in its mono font, chevron and padding).
    titleBare: 142,
    titleMin: 24,
    ...overrides,
  };
}

// Fixed 401 + compact plan tabs 113; the ribbon and the title come on top.
const BESIDE = 401 + 113;

describe('fitViewTabs', () => {
  it('keeps every label when they all fit', () => {
    expect(fitViewTabs([50, 50], [20, 20], 100, 30)).toEqual({ labelledCount: 2, visibleCount: 2, width: 100 });
  });

  it('drops labels from the tail first', () => {
    expect(fitViewTabs([50, 50, 50], [20, 20, 20], 125, 30)).toEqual({ labelledCount: 2, visibleCount: 3, width: 120 });
    expect(fitViewTabs([50, 50, 50], [20, 20, 20], 95, 30)).toEqual({ labelledCount: 1, visibleCount: 3, width: 90 });
  });

  it('goes icon-only before overflowing', () => {
    expect(fitViewTabs([50, 50, 50], [20, 20, 20], 60, 30)).toEqual({ labelledCount: 0, visibleCount: 3, width: 60 });
  });

  it('moves the tail into the overflow menu when even icons do not fit', () => {
    // 59 - 30 (trigger) = 29 → one 20px icon fits.
    expect(fitViewTabs([50, 50, 50], [20, 20, 20], 59, 30)).toEqual({ labelledCount: 0, visibleCount: 1, width: 50 });
  });

  it('always keeps at least one tab visible', () => {
    expect(fitViewTabs([50, 50], [20, 20], 5, 30)).toEqual({ labelledCount: 0, visibleCount: 1, width: 50 });
  });
});

describe('computeTopBarLayout give-up order', () => {
  it('shows everything when the bar is wide', () => {
    const layout = computeTopBarLayout(measurements());
    expect(layout).toMatchObject({
      labelsCollapsed: false, planCompact: false, planSqueezed: false, titleMode: 'full', labelledCount: 10, visibleCount: 10,
    });
    expect(layout.stripWidth).toBe(strip(10));
  });

  it('1. collapses action labels before touching the plan tabs, the ribbon or the title', () => {
    const layout = computeTopBarLayout(measurements({ budget: 401 + 304 + strip(10) + 195 }));
    expect(layout).toMatchObject({ labelsCollapsed: true, planCompact: false, titleMode: 'full', labelledCount: 10, visibleCount: 10 });
    // One pixel less and the plan tabs compact next.
    expect(computeTopBarLayout(measurements({ budget: 401 + 304 + strip(10) + 195 - 1 })).planCompact).toBe(true);
    // The action labels come back only once everything, labels included, fits.
    expect(computeTopBarLayout(measurements({ budget: 792 + 304 + strip(10) + 195 })).labelsCollapsed).toBe(false);
    expect(computeTopBarLayout(measurements({ budget: 792 + 304 + strip(10) + 195 - 1 })).labelsCollapsed).toBe(true);
  });

  it('2. compacts the plan tabs before dropping view-tab labels', () => {
    const layout = computeTopBarLayout(measurements({ budget: 401 + 113 + strip(10) + 195 }));
    expect(layout).toMatchObject({ labelsCollapsed: true, planCompact: true, planSqueezed: false, titleMode: 'full', labelledCount: 10, visibleCount: 10 });
  });

  it('3. drops view-tab labels from the tail while the title keeps its full width', () => {
    // One pixel short of every label: only the last tab (Experimental) goes icon-only.
    const layout = computeTopBarLayout(measurements({ budget: BESIDE + strip(10) + 195 - 1 }));
    expect(layout).toMatchObject({ planCompact: true, labelledCount: 9, visibleCount: 10, titleMode: 'full' });
    expect(layout.stripWidth).toBe(strip(9));
  });

  it('keeps the first three labels and the whole title at the last step before the prefix goes', () => {
    const layout = computeTopBarLayout(measurements({ budget: BESIDE + strip(PRIORITY_LABELS) + 195 }));
    expect(layout).toMatchObject({ labelledCount: 3, visibleCount: 10, titleMode: 'full', planSqueezed: false });
    expect(layout.stripWidth).toBe(strip(3));
  });

  it('4a. drops the "SQL ID:" prefix before any of the first three labels goes', () => {
    const layout = computeTopBarLayout(measurements({ budget: BESIDE + strip(PRIORITY_LABELS) + 195 - 1 }));
    expect(layout).toMatchObject({ labelledCount: 3, visibleCount: 10, titleMode: 'bare', planSqueezed: false });
    expect(layout.stripWidth).toBe(strip(3));
    // The bare id keeps its whole natural width all the way down to 142px.
    const floor = computeTopBarLayout(measurements({ budget: BESIDE + strip(PRIORITY_LABELS) + 142 }));
    expect(floor).toMatchObject({ labelledCount: 3, visibleCount: 10, titleMode: 'bare' });
  });

  it('4b. truncates the bare id before any of the first three labels goes', () => {
    const layout = computeTopBarLayout(measurements({ budget: BESIDE + strip(PRIORITY_LABELS) + 142 - 1 }));
    expect(layout).toMatchObject({ labelledCount: 3, visibleCount: 10, titleMode: 'truncated', planSqueezed: false });
    expect(layout.stripWidth).toBe(strip(3));
    // All the way down to the title's minimum.
    const floor = computeTopBarLayout(measurements({ budget: BESIDE + strip(PRIORITY_LABELS) + 24 }));
    expect(floor).toMatchObject({ labelledCount: 3, visibleCount: 10, titleMode: 'truncated' });
  });

  it('5. drops the remaining leading labels only once the title is at its minimum', () => {
    const layout = computeTopBarLayout(measurements({ budget: BESIDE + strip(PRIORITY_LABELS) + 24 - 1 }));
    // 541px of ribbon space: two labels + eight icons = 492 fit, three labels = 542 do not.
    expect(layout).toMatchObject({ labelledCount: 2, visibleCount: 10, titleMode: 'truncated', planSqueezed: false });
    expect(layout.stripWidth).toBe(strip(2));
  });

  it('6. goes icon-only before overflowing', () => {
    const layout = computeTopBarLayout(measurements({ budget: BESIDE + 24 + strip(0) }));
    expect(layout).toMatchObject({ labelledCount: 0, visibleCount: 10, titleMode: 'truncated', planSqueezed: false });
    expect(layout.stripWidth).toBe(strip(0));
  });

  it('7. falls back to icons plus overflow on a narrow bar, without squeezing the plan tabs', () => {
    const layout = computeTopBarLayout(measurements({ budget: BESIDE + 24 + 12 + 34 + 3 * 40 }));
    expect(layout).toMatchObject({ labelledCount: 0, visibleCount: 3, planSqueezed: false });
    expect(layout.stripWidth).toBe(12 + 3 * 40 + 34);
  });

  it('8. lets the plan tabs scroll only when even one tab and the trigger do not fit', () => {
    const layout = computeTopBarLayout(measurements({ budget: BESIDE + 24 + 12 + 8 }));
    expect(layout).toMatchObject({ planCompact: true, planSqueezed: true, visibleCount: 1 });
    // The smallest ribbon (12 + 40 + 34 = 86) keeps its width; the plan tabs get the rest.
    expect(layout.stripWidth).toBe(86);
    expect(layout.planWidth).toBe(113 - (86 - 20));
  });

  it('reports no plan width unless squeezed', () => {
    expect(computeTopBarLayout(measurements()).planWidth).toBeNull();
    expect(computeTopBarLayout(measurements({ budget: BESIDE + strip(3) + 195 })).planWidth).toBeNull();
  });

  it('never marks absent plan tabs as squeezed', () => {
    const layout = computeTopBarLayout(measurements({ budget: 400, planFull: 0, planCompact: 0 }));
    expect(layout.planSqueezed).toBe(false);
  });

  it('never reports a shortened title when the bar has none', () => {
    const layout = computeTopBarLayout(measurements({
      budget: 401 + 113 + strip(PRIORITY_LABELS), titleFull: 0, titleBare: 0, titleMin: 0,
    }));
    expect(layout).toMatchObject({ labelledCount: 3, visibleCount: 10, titleMode: 'full' });
    // Not even when the ribbon has to shed labels and overflow.
    expect(computeTopBarLayout(measurements({ budget: 300, titleFull: 0, titleBare: 0, titleMin: 0 })).titleMode).toBe('full');
  });

  it('skips the bare step when the title has no prefix to drop (no SQL ID yet)', () => {
    // "Oracle Execution Plan Input" is the same width either way: it truncates straight away.
    const noPrefix = { titleFull: 195, titleBare: 195 };
    const fits = computeTopBarLayout(measurements({ budget: BESIDE + strip(PRIORITY_LABELS) + 195, ...noPrefix }));
    expect(fits).toMatchObject({ labelledCount: 3, titleMode: 'full' });
    const short = computeTopBarLayout(measurements({ budget: BESIDE + strip(PRIORITY_LABELS) + 195 - 1, ...noPrefix }));
    expect(short).toMatchObject({ labelledCount: 3, titleMode: 'truncated' });
  });

  it('labels every view when a plan has no more than three', () => {
    const labelled = LABELLED.slice(0, 3);
    const layout = computeTopBarLayout(measurements({
      tabLabelled: labelled,
      tabIcon: labelled.map(() => 40),
      budget: BESIDE + 12 + sum(labelled) + 24,
    }));
    // The title goes bare and truncates before any of those three labels goes.
    expect(layout).toMatchObject({ labelledCount: 3, visibleCount: 3, titleMode: 'truncated' });
    const roomy = computeTopBarLayout(measurements({
      tabLabelled: labelled,
      tabIcon: labelled.map(() => 40),
      budget: BESIDE + 12 + sum(labelled) + 142,
    }));
    expect(roomy).toMatchObject({ labelledCount: 3, visibleCount: 3, titleMode: 'bare' });
  });

  it('degrades monotonically, pixel by pixel, in the documented order', () => {
    const rank: Record<TitleMode, number> = { full: 0, bare: 1, truncated: 2 };
    let prev = computeTopBarLayout(measurements({ budget: 2400 }));
    for (let budget = 2399; budget >= 100; budget -= 1) {
      const next = computeTopBarLayout(measurements({ budget }));
      // Nothing that was given up ever comes back as the bar narrows.
      expect(rank[next.titleMode]).toBeGreaterThanOrEqual(rank[prev.titleMode]);
      expect(next.labelledCount).toBeLessThanOrEqual(prev.labelledCount);
      expect(next.visibleCount).toBeLessThanOrEqual(prev.visibleCount);
      expect(Number(next.labelsCollapsed)).toBeGreaterThanOrEqual(Number(prev.labelsCollapsed));
      expect(Number(next.planCompact)).toBeGreaterThanOrEqual(Number(prev.planCompact));
      // The SQL ID outranks every label but the first three...
      if (next.titleMode !== 'full') expect(next.labelledCount).toBeLessThanOrEqual(PRIORITY_LABELS);
      // ...the first three labels outrank the bare id...
      if (next.labelledCount < PRIORITY_LABELS) expect(next.titleMode).toBe('truncated');
      // ...and the title is at its floor before the ribbon overflows or the plan tabs scroll.
      if (next.visibleCount < 10 || next.planSqueezed) expect(next.titleMode).toBe('truncated');
      prev = next;
    }
  });
});

describe('computeTopBarLayout at real window widths (one plan, measured)', () => {
  it('1440px, ten views: the full SQL ID stays, and so do the first five views\' labels', () => {
    const layout = computeTopBarLayout(measurements({ budget: barBudget(1440) }));
    expect(layout).toMatchObject({
      labelsCollapsed: true, planCompact: true, planSqueezed: false, titleMode: 'full', labelledCount: 5, visibleCount: 10,
    });
    expect(layout.stripWidth).toBe(644);
    // Everything measured fits beside the untruncated title.
    expect(401 + 113 + layout.stripWidth + 195).toBeLessThanOrEqual(barBudget(1440));
  });

  it('1440px, eight views: more labels than the three-label floor fit beside the full title', () => {
    const labelled = [72, 100, 90, 89, 81, 100, 101, 123]; // no SQL text, no Monitor tab
    const layout = computeTopBarLayout(measurements({
      budget: barBudget(1440),
      tabLabelled: labelled,
      tabIcon: labelled.map(() => 40),
    }));
    expect(layout).toMatchObject({ titleMode: 'full', labelledCount: 6, visibleCount: 8 });
  });

  it('1280px, six views: the full SQL ID stays beside five labelled tabs', () => {
    const labelled = LABELLED.slice(0, 6);
    const layout = computeTopBarLayout(measurements({
      budget: barBudget(1280),
      tabLabelled: labelled,
      tabIcon: labelled.map(() => 40),
    }));
    expect(layout).toMatchObject({ labelsCollapsed: true, planCompact: true, titleMode: 'full', labelledCount: 5, visibleCount: 6 });
  });

  it('1280px, ten views: the SQL ID stays readable (bare id, never truncated) beside three labels', () => {
    const layout = computeTopBarLayout(measurements({ budget: barBudget(1280) }));
    expect(layout).toMatchObject({ labelledCount: 3, visibleCount: 10, titleMode: 'bare', planSqueezed: false });
    expect(layout.titleMode).not.toBe('truncated');
    expect(layout.labelledCount).toBeGreaterThanOrEqual(3);
    // What the title is left with: 1222 - 401 - 113 - 554 = 154px, more than the bare id's 142px.
    const left = barBudget(1280) - 401 - 113 - layout.stripWidth;
    expect(left).toBe(154);
    expect(left).toBeGreaterThanOrEqual(142);
  });

  it('1280px, eight views: the full title fits beside three labels', () => {
    const labelled = [72, 100, 90, 89, 81, 100, 101, 123];
    const layout = computeTopBarLayout(measurements({
      budget: barBudget(1280),
      tabLabelled: labelled,
      tabIcon: labelled.map(() => 40),
    }));
    expect(layout).toMatchObject({ labelledCount: 3, visibleCount: 8, titleMode: 'full' });
  });

  it('1024px, ten views: actions fold into one menu; all ten views stay and the id truncates (114px left of the 142px it wants)', () => {
    // The arithmetic does not allow the bare id here: 966 - 185 - 113 - 554 = 114 < 142.
    const layout = computeTopBarLayout(measurements({ budget: barBudget(1024), ...FOLDED_FIXED }));
    expect(layout).toMatchObject({
      labelsCollapsed: true, planCompact: true, planSqueezed: false, titleMode: 'truncated', labelledCount: 3, visibleCount: 10,
    });
    expect(layout.stripWidth).toBe(554);
    expect(barBudget(1024) - 185 - 113 - layout.stripWidth).toBe(114);
  });

  it('1000px, ten views: still three labels, and the id keeps a readable stretch', () => {
    const layout = computeTopBarLayout(measurements({ budget: barBudget(1000), ...FOLDED_FIXED }));
    expect(layout).toMatchObject({ titleMode: 'truncated', planSqueezed: false, visibleCount: 10, labelledCount: 3 });
    expect(barBudget(1000) - 185 - 113 - layout.stripWidth).toBe(90);
  });

  it('900px, ten views: the remaining labels drop before the ribbon overflows', () => {
    const layout = computeTopBarLayout(measurements({ budget: barBudget(900), ...FOLDED_FIXED }));
    expect(layout).toMatchObject({ titleMode: 'truncated', planSqueezed: false, visibleCount: 10 });
    expect(layout.labelledCount).toBeLessThan(3);
  });
});
