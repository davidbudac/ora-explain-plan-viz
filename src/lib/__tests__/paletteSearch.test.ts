import { describe, expect, it } from 'vitest';
import { rankCommands, scoreCommand, tokenizeQuery } from '../paletteSearch';

interface Cmd {
  id: string;
  label: string;
  keywords: string[];
}

/** A slice of the real palette, in its real definition order. */
const COMMANDS: Cmd[] = [
  { id: 'view-hierarchical', label: 'Switch to Tree view', keywords: ['view', 'mode', 'switch', 'tree', 'hierarchical'] },
  { id: 'view-sankey', label: 'Switch to Sankey view', keywords: ['view', 'mode', 'switch', 'sankey'] },
  { id: 'view-tabular', label: 'Switch to Table view', keywords: ['view', 'mode', 'switch', 'table', 'tabular'] },
  { id: 'view-text', label: 'Switch to Plan Text view', keywords: ['view', 'mode', 'switch', 'plan text', 'text'] },
  { id: 'split-compare', label: 'Split compare (dual trees)', keywords: ['split', 'compare', 'dual', 'side by side', 'tree'] },
  { id: 'display-showObjectName', label: 'Toggle Object name', keywords: ['display', 'show', 'hide', 'toggle', 'node', 'object', 'name', 'table'] },
  { id: 'display-showCost', label: 'Toggle Cost', keywords: ['display', 'show', 'hide', 'toggle', 'node', 'cost', 'optimizer'] },
  { id: 'focus-selection', label: 'Toggle focus selection path', keywords: ['focus', 'selection', 'path', 'highlight'] },
  { id: 'toggle-theme', label: 'Switch to light mode', keywords: ['theme', 'dark', 'light', 'mode', 'toggle'] },
  { id: 'highlight-circle', label: 'Circle highlight style', keywords: ['highlight', 'style', 'circle', 'annotation'] },
  { id: 'sankey-rows', label: 'Sankey metric: Rows', keywords: ['sankey', 'metric', 'flow', 'rows'] },
  { id: 'sankey-cost', label: 'Sankey metric: Cost', keywords: ['sankey', 'metric', 'flow', 'cost'] },
  { id: 'indicator-cost', label: 'Node indicator: Cost', keywords: ['indicator', 'metric', 'badge', 'node', 'cost'] },
];

const labels = (cmds: Cmd[]) => cmds.map(c => c.label);

describe('tokenizeQuery', () => {
  it('lowercases and splits on whitespace', () => {
    expect(tokenizeQuery('  Sankey   COST ')).toEqual(['sankey', 'cost']);
  });

  it('returns no tokens for a blank query', () => {
    expect(tokenizeQuery('')).toEqual([]);
    expect(tokenizeQuery('   ')).toEqual([]);
  });
});

describe('rankCommands: required cases', () => {
  it('"light" puts "Switch to light mode" ahead of "highlight" substring hits', () => {
    const result = rankCommands('light', COMMANDS);
    expect(result[0].label).toBe('Switch to light mode');
    // The earlier-defined "highlight" commands still match, just lower.
    expect(result.map(c => c.id)).toContain('focus-selection');
    expect(result.map(c => c.id)).toContain('highlight-circle');
  });

  it('"tree" puts "Switch to Tree view" before "Split compare (dual trees)"', () => {
    const result = labels(rankCommands('tree', COMMANDS));
    expect(result[0]).toBe('Switch to Tree view');
    expect(result.indexOf('Switch to Tree view')).toBeLessThan(result.indexOf('Split compare (dual trees)'));
  });

  it('"tree" still wins when the plural-word command is defined first', () => {
    const reordered = [COMMANDS.find(c => c.id === 'split-compare')!, ...COMMANDS.filter(c => c.id !== 'split-compare')];
    expect(rankCommands('tree', reordered)[0].label).toBe('Switch to Tree view');
  });

  it('"sankey cost" puts "Sankey metric: Cost" first and drops non-matches', () => {
    const result = rankCommands('sankey cost', COMMANDS);
    expect(result[0].label).toBe('Sankey metric: Cost');
    expect(labels(result)).not.toContain('Sankey metric: Rows');
  });

  it('"table" puts "Switch to Table view" first', () => {
    const result = rankCommands('table', COMMANDS);
    expect(result[0].label).toBe('Switch to Table view');
    // "Toggle Object name" only has "table" as a keyword, so it ranks after.
    expect(labels(result)).toContain('Toggle Object name');
  });

  it('returns commands in original order for an empty query', () => {
    expect(rankCommands('', COMMANDS)).toEqual(COMMANDS);
    expect(rankCommands('   ', COMMANDS)).toEqual(COMMANDS);
  });
});

describe('rankCommands: matching rules', () => {
  it('requires every token to match the label or a keyword', () => {
    expect(rankCommands('light zzzz', COMMANDS)).toEqual([]);
    expect(rankCommands('zzzz', COMMANDS)).toEqual([]);
  });

  it('lets different tokens hit the label and the keywords', () => {
    // "node" is a keyword, "cost" is in the label.
    const result = rankCommands('node cost', COMMANDS).map(c => c.id);
    expect(result).toContain('display-showCost');
    expect(result).toContain('indicator-cost');
    expect(result).not.toContain('sankey-cost');
  });

  it('is case-insensitive', () => {
    expect(rankCommands('LIGHT', COMMANDS)[0].label).toBe('Switch to light mode');
  });

  it('matches multi-word keywords by their words', () => {
    expect(rankCommands('side', COMMANDS).map(c => c.id)).toEqual(['split-compare']);
  });

  it('prefers a verbatim phrase in the label over scattered tokens', () => {
    const cmds: Cmd[] = [
      { id: 'scattered', label: 'Dark mode or light', keywords: [] },
      { id: 'phrase', label: 'Switch to light mode', keywords: [] },
    ];
    expect(rankCommands('light mode', cmds)[0].id).toBe('phrase');
  });

  it('keeps original order for equal scores (stable)', () => {
    const cmds: Cmd[] = [
      { id: 'a', label: 'Alpha view', keywords: [] },
      { id: 'b', label: 'Bravo view', keywords: [] },
      { id: 'c', label: 'Charlie view', keywords: [] },
    ];
    expect(rankCommands('view', cmds).map(c => c.id)).toEqual(['a', 'b', 'c']);
  });

  it('does not mutate the input array', () => {
    const input = COMMANDS.slice();
    rankCommands('light', input);
    expect(input).toEqual(COMMANDS);
    expect(rankCommands('', input)).not.toBe(input);
  });
});

describe('rankCommands: score tiers', () => {
  it('orders hit kinds exact > prefix > word > keyword > substring', () => {
    // Deliberately defined in the reverse of the expected ranking.
    const cmds: Cmd[] = [
      { id: 'keyword-contains', label: 'zzz', keywords: ['xabcx'] },
      { id: 'label-contains', label: 'xabcx', keywords: [] },
      { id: 'keyword-word-prefix', label: 'zzz', keywords: ['x abcdef'] },
      { id: 'keyword-equals', label: 'zzz', keywords: ['abc'] },
      { id: 'label-word-prefix', label: 'the abcdef', keywords: [] },
      { id: 'label-word-equals', label: 'the abc', keywords: [] },
      { id: 'label-prefix', label: 'abcdef thing', keywords: [] },
      { id: 'label-exact', label: 'abc', keywords: [] },
    ];
    expect(rankCommands('abc', cmds).map(c => c.id)).toEqual([
      'label-exact',
      'label-prefix',
      'label-word-equals',
      'label-word-prefix',
      'keyword-equals',
      'keyword-word-prefix',
      'label-contains',
      'keyword-contains',
    ]);
  });

  it('scoreCommand is 0 when any token misses', () => {
    expect(scoreCommand(['light', 'nope'], COMMANDS[8])).toBe(0);
    expect(scoreCommand(['light'], COMMANDS[8])).toBeGreaterThan(0);
    expect(scoreCommand([], COMMANDS[8])).toBe(0);
  });
});
