/**
 * Single source of truth for the keyboard focus ring used across the app.
 *
 * Previously each component file kept its own copy of these strings. New code
 * should import from here (or from `components/ui`); existing copies are being
 * migrated.
 *
 * `FOCUS_RING` draws the ring outside the element's box. Use `FOCUS_RING_INSET`
 * for full-bleed rows (dropdown items, accordion summaries, scrolling tab
 * strips) where an outset ring would be clipped by the container.
 */
export const FOCUS_RING =
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/60 dark:focus-visible:ring-blue-400/60';

export const FOCUS_RING_INSET =
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-blue-500/60 dark:focus-visible:ring-blue-400/60';
