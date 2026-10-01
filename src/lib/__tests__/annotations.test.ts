import { describe, expect, it } from 'vitest';
import {
  HIGHLIGHT_COLORS,
  HIGHLIGHT_STYLES,
  createEmptyAnnotationState,
  describeBrush,
  deserializeAnnotations,
  highlightMatchesBrush,
  isHighlightColor,
  isHighlightStyle,
  serializeAnnotations,
  validateExport,
} from '../annotations';
import type { HighlightBrush, NodeHighlight, SerializedAnnotationState } from '../annotations';

const RED_GLOW: HighlightBrush = { color: 'red', style: 'glow' };

function exportWith(nodeHighlights: Record<string, unknown>) {
  return {
    version: 2,
    exportedAt: '2026-10-01T00:00:00.000Z',
    rawPlanText: 'Plan hash value: 1',
    planSource: 'dbms_xplan',
    annotations: { nodeAnnotations: {}, nodeHighlights, groups: [] },
  };
}

describe('isHighlightStyle / isHighlightColor', () => {
  it('accepts every defined style and colour', () => {
    for (const def of HIGHLIGHT_STYLES) expect(isHighlightStyle(def.name)).toBe(true);
    for (const def of HIGHLIGHT_COLORS) expect(isHighlightColor(def.name)).toBe(true);
  });

  it('rejects anything else', () => {
    for (const value of ['sparkle', '', 'Circle', 7, null, undefined, {}, ['glow']]) {
      expect(isHighlightStyle(value)).toBe(false);
    }
    for (const value of ['teal', '', 'Red', 0, null, undefined]) {
      expect(isHighlightColor(value)).toBe(false);
    }
  });
});

describe('highlightMatchesBrush', () => {
  it('is false when the node has no highlight', () => {
    expect(highlightMatchesBrush(undefined, RED_GLOW, 'circle')).toBe(false);
  });

  it('is true for the same colour and style', () => {
    const highlight: NodeHighlight = { nodeId: 3, color: 'red', style: 'glow' };
    expect(highlightMatchesBrush(highlight, RED_GLOW, 'circle')).toBe(true);
  });

  it('is false when either colour or style differs', () => {
    expect(highlightMatchesBrush({ nodeId: 3, color: 'blue', style: 'glow' }, RED_GLOW, 'circle')).toBe(false);
    expect(highlightMatchesBrush({ nodeId: 3, color: 'red', style: 'tint' }, RED_GLOW, 'circle')).toBe(false);
  });

  it('treats a legacy highlight (no style) as drawn in the fallback style', () => {
    const legacy: NodeHighlight = { nodeId: 3, color: 'red' };
    expect(highlightMatchesBrush(legacy, RED_GLOW, 'glow')).toBe(true);
    expect(highlightMatchesBrush(legacy, RED_GLOW, 'circle')).toBe(false);
  });
});

describe('describeBrush', () => {
  it('reads as "Colour style"', () => {
    expect(describeBrush({ color: 'red', style: 'glow' })).toBe('Red glow');
    expect(describeBrush({ color: 'purple', style: 'hachure' })).toBe('Purple hachure');
  });
});

describe('validateExport with per-node styles', () => {
  it('accepts highlights with a valid style and legacy highlights without one', () => {
    expect(validateExport(exportWith({ '1': { nodeId: 1, color: 'red', style: 'underline' }, '2': { nodeId: 2, color: 'blue' } }))).toBe(true);
  });

  it('rejects a highlight whose style is present but unknown', () => {
    expect(validateExport(exportWith({ '1': { nodeId: 1, color: 'red', style: 'sparkle' } }))).toBe(false);
    expect(validateExport(exportWith({ '1': { nodeId: 1, color: 'red', style: 42 } }))).toBe(false);
    expect(validateExport(exportWith({ '1': { nodeId: 1, color: 'red', style: null } }))).toBe(false);
  });

  it('still rejects an unknown colour', () => {
    expect(validateExport(exportWith({ '1': { nodeId: 1, color: 'teal', style: 'glow' } }))).toBe(false);
  });
});

describe('deserializeAnnotations with per-node styles', () => {
  it('keeps a valid style', () => {
    const data: SerializedAnnotationState = {
      nodeAnnotations: {},
      nodeHighlights: { '4': { nodeId: 4, color: 'green', style: 'dot' } },
      groups: [],
    };
    expect(deserializeAnnotations(data).nodeHighlights.get(4)).toEqual({ nodeId: 4, color: 'green', style: 'dot' });
  });

  it('keeps legacy highlights untouched (no style key invented)', () => {
    const data: SerializedAnnotationState = {
      nodeAnnotations: {},
      nodeHighlights: { '4': { nodeId: 4, color: 'green' } },
      groups: [],
    };
    const highlight = deserializeAnnotations(data).nodeHighlights.get(4);
    expect(highlight).toEqual({ nodeId: 4, color: 'green' });
    expect(highlight && 'style' in highlight).toBe(false);
  });

  it('drops an unknown style but keeps the highlight, without mutating the input', () => {
    const raw = { nodeId: 4, color: 'green', style: 'sparkle' };
    const data = {
      nodeAnnotations: {},
      nodeHighlights: { '4': raw },
      groups: [],
    } as unknown as SerializedAnnotationState;
    const highlight = deserializeAnnotations(data).nodeHighlights.get(4);
    expect(highlight).toEqual({ nodeId: 4, color: 'green' });
    expect(highlight && 'style' in highlight).toBe(false);
    expect(raw.style).toBe('sparkle');
  });

  it('round-trips through serialize', () => {
    const state = createEmptyAnnotationState();
    state.nodeHighlights.set(2, { nodeId: 2, color: 'pink', style: 'hachure' });
    state.nodeHighlights.set(3, { nodeId: 3, color: 'black' });
    const back = deserializeAnnotations(serializeAnnotations(state));
    expect(back.nodeHighlights.get(2)).toEqual({ nodeId: 2, color: 'pink', style: 'hachure' });
    expect(back.nodeHighlights.get(3)).toEqual({ nodeId: 3, color: 'black' });
  });
});
