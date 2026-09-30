/**
 * Ranked matching for the Cmd/Ctrl-K command palette.
 *
 * The palette used to filter by plain substring and keep definition order, so
 * typing "light" ran "Toggle focus selection path" (its keyword "highlight"
 * contains "light") ahead of "Switch to light mode". This module scores every
 * query token against a command's label and keywords and sorts by the sum, so
 * whole-word and prefix hits beat incidental substring hits.
 */

/** The minimal shape of a palette command that search needs. */
export interface SearchableCommand {
  label: string;
  keywords: string[];
}

/**
 * Per-token score for each kind of hit, best-wins. The gaps are deliberate:
 * `VERBATIM_BONUS` is smaller than every gap that separates two of the spec'd
 * tiers, so it only reorders commands that sit in the same tier.
 *
 * Spec order: exact label > label prefix > label word prefix > keyword equal >
 * keyword word prefix > label substring > keyword substring. `labelWordExact`
 * is a refinement inside the label-word tier: a whole-word hit ("Tree") beats
 * a longer word sharing the prefix ("trees").
 */
export const TOKEN_SCORES = {
  labelExact: 100,
  labelPrefix: 80,
  labelWordExact: 65,
  labelWordPrefix: 60,
  keywordExact: 50,
  keywordWordPrefix: 40,
  labelContains: 20,
  keywordContains: 10,
} as const;

/** Added once when the whole (normalised) query appears verbatim in the label. */
export const VERBATIM_BONUS = 8;

const WORD_SPLIT = /[^\p{L}\p{N}]+/u;

function wordsOf(text: string): string[] {
  return text.split(WORD_SPLIT).filter(Boolean);
}

/** Lowercased query split on whitespace; empty for a blank query. */
export function tokenizeQuery(query: string): string[] {
  const trimmed = query.trim().toLowerCase();
  return trimmed ? trimmed.split(/\s+/) : [];
}

interface PreparedCommand {
  label: string;
  labelWords: string[];
  keywords: string[];
  keywordWords: string[][];
}

function prepare(command: SearchableCommand): PreparedCommand {
  const keywords = command.keywords.map(k => k.toLowerCase());
  return {
    label: command.label.toLowerCase(),
    labelWords: wordsOf(command.label.toLowerCase()),
    keywords,
    keywordWords: keywords.map(wordsOf),
  };
}

/** Best score for one token against a prepared command; 0 means "no match". */
function scoreToken(token: string, cmd: PreparedCommand): number {
  const S = TOKEN_SCORES;
  if (cmd.label === token) return S.labelExact;
  if (cmd.label.startsWith(token)) return S.labelPrefix;
  if (cmd.labelWords.includes(token)) return S.labelWordExact;
  if (cmd.labelWords.some(w => w.startsWith(token))) return S.labelWordPrefix;
  if (cmd.keywords.includes(token)) return S.keywordExact;
  if (cmd.keywordWords.some(ws => ws.some(w => w.startsWith(token)))) return S.keywordWordPrefix;
  if (cmd.label.includes(token)) return S.labelContains;
  if (cmd.keywords.some(k => k.includes(token))) return S.keywordContains;
  return 0;
}

/**
 * Total score for a tokenised query, or 0 when any token fails to match
 * (every token must hit the label or a keyword).
 */
export function scoreCommand(tokens: string[], command: SearchableCommand): number {
  if (tokens.length === 0) return 0;
  const cmd = prepare(command);
  let total = 0;
  for (const token of tokens) {
    const s = scoreToken(token, cmd);
    if (s === 0) return 0;
    total += s;
  }
  if (cmd.label.includes(tokens.join(' '))) total += VERBATIM_BONUS;
  return total;
}

/**
 * Filter `commands` to those matching every query token and sort them best
 * match first; ties keep their original order. A blank query returns every
 * command in its original order. The input array is never mutated.
 */
export function rankCommands<T extends SearchableCommand>(query: string, commands: T[]): T[] {
  const tokens = tokenizeQuery(query);
  if (tokens.length === 0) return commands.slice();

  const scored: { command: T; score: number; index: number }[] = [];
  commands.forEach((command, index) => {
    const score = scoreCommand(tokens, command);
    if (score > 0) scored.push({ command, score, index });
  });
  scored.sort((a, b) => b.score - a.score || a.index - b.index);
  return scored.map(s => s.command);
}
