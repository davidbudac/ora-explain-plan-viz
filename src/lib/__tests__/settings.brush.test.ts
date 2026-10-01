import { afterEach, describe, expect, it, vi } from 'vitest';
import { loadSettings, saveSettings } from '../settings';

afterEach(() => vi.unstubAllGlobals());

function stubStorage(initial: Record<string, unknown> | null) {
  let stored: string | null = initial ? JSON.stringify(initial) : null;
  vi.stubGlobal('localStorage', {
    getItem: () => stored,
    setItem: (_key: string, value: string) => { stored = value; },
  });
  return () => (stored ? JSON.parse(stored) : null);
}

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

  it('persists the brush colour without touching other keys', () => {
    const read = stubStorage({ version: 1, legendVisible: true });
    saveSettings({ highlightBrushColor: 'blue' });
    const saved = read();
    expect(saved.highlightBrushColor).toBe('blue');
    expect(saved.legendVisible).toBe(true);
  });
});
