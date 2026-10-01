import { describeBrush, getHighlightColorDef } from '../../lib/annotations';
import type { HighlightBrush, HighlightColor } from '../../lib/annotations';

/** The app theme is a `dark` class on <html>; node paint reads it live (as PlanNode does). */
function isDarkMode(): boolean {
  return typeof document !== 'undefined' && document.documentElement.classList.contains('dark');
}

/** The colour's hex for the current theme (SVG strokes, shadows, swatch bars). */
export function brushHex(color: HighlightColor): string {
  const def = getHighlightColorDef(color);
  return isDarkMode() ? def.hexDark : def.hex;
}

/** Accessible name / tooltip of the paint button: it toggles, so it says which way. */
export function paintButtonLabel(brush: HighlightBrush, matches: boolean): string {
  return matches
    ? `Remove ${describeBrush(brush)} highlight`
    : `Paint with ${describeBrush(brush)} highlight`;
}
