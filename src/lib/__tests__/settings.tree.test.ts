import { afterEach, describe, expect, it, vi } from 'vitest';
import { loadSettings, saveSettings } from '../settings';

afterEach(() => vi.unstubAllGlobals());

function stubStorage(initial: Record<string, unknown> | null) {
  let stored: string | null = initial ? JSON.stringify(initial) : null;
  const storage = {
    getItem: () => stored,
    setItem: (_key: string, value: string) => { stored = value; },
  };
  vi.stubGlobal('localStorage', storage);
  return () => (stored ? JSON.parse(stored) : null);
}

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

  it('persists partial updates without touching other keys', () => {
    const read = stubStorage({ version: 1, legendVisible: true });
    saveSettings({ treeLayoutDirection: 'LR' });
    const saved = read();
    expect(saved.treeLayoutDirection).toBe('LR');
    expect(saved.legendVisible).toBe(true);
  });
});
