/**
 * Width allocation for the app's single top bar.
 *
 * The bar holds fixed clusters (brand, actions), the SQL-ID title, the plan
 * tabs and the view-tab ribbon. The SQL ID is what a DBA reads first, so the
 * title keeps its full natural width for as long as possible and everything
 * decorative gives way first. As the bar narrows, space is given up in this
 * order —
 *
 *   1. text labels on the fixed action buttons (File / Appearance / Help,
 *      DB Connect, Load Example) collapse to icons (`labelsCollapsed`);
 *   2. the plan tabs drop their secondary text — PHV, SPM, "Add Plan"
 *      (`planCompact`);
 *   3. view-tab labels drop from the tail of the list, down to the first
 *      `PRIORITY_LABELS` (Tree / Compare / Tabular) (`labelledCount`);
 *   4a. the title drops its "SQL ID:" prefix and shows the bare id
 *      (`titleMode: 'bare'`) — the id is the part that matters, and the prefix
 *      stays in the button's accessible name and tooltip;
 *   4b. the bare id truncates (`titleMode: 'truncated'`) — it never gives up
 *      more than its text, the chevron that opens the input drawer stays;
 *   5. the remaining leading labels drop (`labelledCount` → 0);
 *   6. the ribbon is icon-only;
 *   7. the tail of the view tabs moves into an overflow menu (`visibleCount`);
 *   8. only then may the plan tabs themselves scroll (`planSqueezed`).
 *
 * Pure: all widths are measured by the caller.
 */

/**
 * View tabs that keep their text label until the SQL-ID title has lost its
 * prefix and truncated. A deliberately small number: the SQL ID outranks the
 * labels of every view but the first three.
 */
export const PRIORITY_LABELS = 3;

/**
 * How much of the title is shown: `full` = "SQL ID: <id>", `bare` = just the
 * id, `truncated` = the id cut short with an ellipsis (or hidden entirely by
 * the caller when it would only be a sliver).
 */
export type TitleMode = 'full' | 'bare' | 'truncated';

export interface TopBarMeasurements {
  /**
   * Width the bar can hand to its children: the content box minus the gaps
   * between children. Nothing is held back for the title — `titleFull` and
   * `titleMin` describe what it claims.
   */
  budget: number;
  /** Combined width of the fixed (non-shrinking) siblings with their text labels shown. */
  fixedLabelled: number;
  /** The same siblings with their collapsible labels hidden (icons only). */
  fixedCollapsed: number;
  /** Plan-tab cluster at natural width with all its text; 0 when absent. */
  planFull: number;
  /** Plan-tab cluster with its secondary text hidden; 0 when absent. */
  planCompact: number;
  /** Width of each view tab with its label. */
  tabLabelled: number[];
  /** Width of each view tab as an icon only. */
  tabIcon: number[];
  /** The ribbon's own padding + border. */
  stripChrome: number;
  /** Width of the overflow ("⋯") trigger inside the ribbon. */
  overflowTrigger: number;
  /** Natural (untruncated) width of the shrinkable SQL-ID title with its "SQL ID:" prefix; 0 when absent. */
  titleFull: number;
  /**
   * Natural width of the same title with the prefix dropped (the bare id); 0
   * when absent. Equal to `titleFull` when the title has no prefix to drop.
   */
  titleBare: number;
  /** The least the title keeps once it truncates (chevron + padding, no text); 0 when absent. */
  titleMin: number;
}

export interface TopBarLayout {
  labelsCollapsed: boolean;
  planCompact: boolean;
  /** Even the smallest ribbon does not fit beside the compact plan tabs; they must scroll. */
  planSqueezed: boolean;
  /** Width the plan tabs get while squeezed (they scroll inside it); null otherwise. */
  planWidth: number | null;
  /** Tabs [0, labelledCount) show their label; the rest are icon-only. */
  labelledCount: number;
  /** Tabs [0, visibleCount) stay in the ribbon; the rest go to the overflow menu. */
  visibleCount: number;
  /** What the title shows; `truncated` means the ribbon claimed space the bare id needs. */
  titleMode: TitleMode;
  /** Width the ribbon needs for this layout, chrome included. */
  stripWidth: number;
}

const sum = (values: number[]) => values.reduce((a, b) => a + b, 0);

interface StripFit {
  labelledCount: number;
  visibleCount: number;
  /** Tabs (+ overflow trigger) only, chrome excluded. */
  width: number;
}

/**
 * Best ribbon layout inside `space` (chrome already excluded): as many leading
 * labels as fit, then all icons, then icons plus an overflow menu (never fewer
 * than one visible tab).
 */
export function fitViewTabs(
  tabLabelled: number[],
  tabIcon: number[],
  space: number,
  overflowTrigger: number,
): StripFit {
  const n = tabLabelled.length;
  for (let k = n; k >= 0; k -= 1) {
    const width = sum(tabLabelled.slice(0, k)) + sum(tabIcon.slice(k));
    if (width <= space) return { labelledCount: k, visibleCount: n, width };
  }

  const tabBudget = space - overflowTrigger;
  let used = 0;
  let count = 0;
  for (const width of tabIcon) {
    if (used + width > tabBudget) break;
    used += width;
    count += 1;
  }
  if (count === 0 && n > 0) {
    count = 1;
    used = tabIcon[0];
  }
  return { labelledCount: 0, visibleCount: count, width: used + (count < n ? overflowTrigger : 0) };
}

export function computeTopBarLayout(m: TopBarMeasurements): TopBarLayout {
  const n = m.tabLabelled.length;
  // Ribbon width (chrome included) with the first `k` labels shown, the rest icons.
  const stripWith = (k: number) => m.stripChrome + sum(m.tabLabelled.slice(0, k)) + sum(m.tabIcon.slice(k));
  const fullStrip = stripWith(n);
  const fit = (overrides: Partial<TopBarLayout>): TopBarLayout => ({
    labelsCollapsed: true,
    planCompact: false,
    planSqueezed: false,
    planWidth: null,
    labelledCount: n,
    visibleCount: n,
    titleMode: 'full',
    stripWidth: fullStrip,
    ...overrides,
  });

  // 0. Everything fits, title included, with every label.
  if (m.fixedLabelled + m.planFull + fullStrip + m.titleFull <= m.budget) {
    return fit({ labelsCollapsed: false });
  }
  // 1. Action-button labels collapse first.
  if (m.fixedCollapsed + m.planFull + fullStrip + m.titleFull <= m.budget) {
    return fit({});
  }
  // 2. Plan tabs go compact (PHV / SPM / "Add Plan" text).
  if (m.fixedCollapsed + m.planCompact + fullStrip + m.titleFull <= m.budget) {
    return fit({ planCompact: true });
  }

  // 3. View-tab labels drop from the tail, down to the priority labels, while
  //    the title still keeps its full width.
  const priority = Math.min(PRIORITY_LABELS, n);
  const beside = m.fixedCollapsed + m.planCompact;
  for (let k = n - 1; k >= priority; k -= 1) {
    if (beside + stripWith(k) + m.titleFull <= m.budget) {
      return fit({ planCompact: true, labelledCount: k, stripWidth: stripWith(k) });
    }
  }

  // 4a. The title drops its "SQL ID:" prefix and shows the bare id.
  const titleBare = Math.min(m.titleBare, m.titleFull);
  if (beside + stripWith(priority) + titleBare <= m.budget) {
    return fit({ planCompact: true, labelledCount: priority, titleMode: titleBare < m.titleFull ? 'bare' : 'full', stripWidth: stripWith(priority) });
  }

  // 4b. The bare id truncates, down to its minimum, before any priority label goes.
  const truncatedMode: TitleMode = m.titleFull > 0 ? 'truncated' : 'full';
  if (beside + stripWith(priority) + m.titleMin <= m.budget) {
    return fit({ planCompact: true, labelledCount: priority, titleMode: truncatedMode, stripWidth: stripWith(priority) });
  }

  // 5–7. The title is at its minimum: the remaining labels drop, then the
  //      ribbon goes icon-only, then its tail moves into the overflow menu.
  const space = m.budget - beside - m.titleMin - m.stripChrome;
  const strip = fitViewTabs(m.tabLabelled, m.tabIcon, space, m.overflowTrigger);
  // 8. Even one tab + the overflow trigger does not fit: the plan tabs scroll
  //    inside whatever the smallest ribbon leaves them.
  const planSqueezed = m.planCompact > 0 && strip.width > space;
  return fit({
    planCompact: true,
    planSqueezed,
    planWidth: planSqueezed ? Math.max(0, m.planCompact - (strip.width - space)) : null,
    labelledCount: strip.labelledCount,
    visibleCount: strip.visibleCount,
    titleMode: truncatedMode,
    stripWidth: m.stripChrome + strip.width,
  });
}
