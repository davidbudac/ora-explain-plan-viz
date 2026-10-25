import { afterEach, describe, expect, it, vi } from 'vitest';
import { loadSettings, saveSettings } from '../settings';
import { DENSITY_PRESETS, matchDensityPreset } from '../density';

afterEach(() => vi.unstubAllGlobals());

function stubStorage(initial: Record<string, unknown> | null) {
  let stored: string | null = initial ? JSON.stringify(initial) : null;
  vi.stubGlobal('localStorage', {
    getItem: () => stored,
    setItem: (_key: string, value: string) => { stored = value; },
  });
  return () => (stored ? JSON.parse(stored) : null);
}

describe('saveSettings', () => {
  it('persists partial updates without touching other keys', () => {
    const read = stubStorage({ version: 1, legendVisible: true });
    saveSettings({ treeLayoutDirection: 'LR' });
    const saved = read();
    expect(saved.treeLayoutDirection).toBe('LR');
    expect(saved.legendVisible).toBe(true);
  });
});

describe('workspace display preferences', () => {
  it('starts new users with compact nodes and filters on demand', () => {
    stubStorage(null);
    const settings = loadSettings();
    expect(settings.filterPanelCollapsed).toBe(true);
    expect(matchDensityPreset(settings.nodeDisplayOptions)).toBe('compact');
  });

  it('preserves saved detailed nodes and pinned filters', () => {
    stubStorage({ version: 1, filterPanelCollapsed: false, nodeDisplayOptions: DENSITY_PRESETS.detailed });
    const settings = loadSettings();
    expect(settings.filterPanelCollapsed).toBe(false);
    expect(settings.nodeDisplayOptions).toEqual(DENSITY_PRESETS.detailed);
  });
});

describe('tree layout settings', () => {
  it('defaults to a top-down layout with an automatic minimap', () => {
    stubStorage(null);
    const settings = loadSettings();
    expect(settings.treeLayoutDirection).toBe('TB');
    expect(settings.treeMinimap).toBe('auto');
  });

  it('restores saved values', () => {
    stubStorage({ version: 1, treeLayoutDirection: 'LR', treeMinimap: 'off' });
    const settings = loadSettings();
    expect(settings.treeLayoutDirection).toBe('LR');
    expect(settings.treeMinimap).toBe('off');
  });

  it('drops unknown values back to the defaults', () => {
    stubStorage({ version: 1, treeLayoutDirection: 'BT', treeMinimap: 'sometimes' });
    const settings = loadSettings();
    expect(settings.treeLayoutDirection).toBe('TB');
    expect(settings.treeMinimap).toBe('auto');
  });
});

describe('highlight brush settings', () => {
  it('defaults to a red circle brush', () => {
    stubStorage(null);
    const settings = loadSettings();
    expect(settings.highlightBrushColor).toBe('red');
    expect(settings.highlightStyle).toBe('circle');
  });

  it('restores a saved brush', () => {
    stubStorage({ version: 1, highlightBrushColor: 'purple', highlightStyle: 'hachure' });
    const settings = loadSettings();
    expect(settings.highlightBrushColor).toBe('purple');
    expect(settings.highlightStyle).toBe('hachure');
  });

  it('drops an unknown brush colour or style back to the defaults', () => {
    stubStorage({ version: 1, highlightBrushColor: 'teal', highlightStyle: 'sparkle' });
    const settings = loadSettings();
    expect(settings.highlightBrushColor).toBe('red');
    expect(settings.highlightStyle).toBe('circle');
  });

  it('keeps users on older settings (no brush colour saved) on the default', () => {
    stubStorage({ version: 1, highlightStyle: 'glow' });
    const settings = loadSettings();
    expect(settings.highlightBrushColor).toBe('red');
    expect(settings.highlightStyle).toBe('glow');
  });
});
