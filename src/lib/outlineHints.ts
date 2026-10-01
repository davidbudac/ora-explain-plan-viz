import type { HintSummary } from './types';

/** `Hint report: 3 hints (1 unused, 2 syntax errors)` — one line for the Hint Report totals. */
export function formatHintSummary(summary: HintSummary): string {
  const plural = (n: number, word: string): string => `${n} ${word}${n === 1 ? '' : 's'}`;
  const problems = [
    summary.unused > 0 ? `${summary.unused} unused` : '',
    summary.errors > 0 ? plural(summary.errors, 'syntax error') : '',
  ].filter(Boolean);
  return `Hint report: ${plural(summary.total, 'hint')}${problems.length > 0 ? ` (${problems.join(', ')})` : ', all used'}`;
}

/** Ready-to-paste optimizer hint comment for the outline hints, one hint per line. */
export function outlineHintBlock(hints: string[]): string {
  return `/*+\n${hints.map((hint) => `  ${hint}`).join('\n')}\n*/`;
}
