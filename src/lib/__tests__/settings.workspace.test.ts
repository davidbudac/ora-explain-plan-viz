import { afterEach, describe, expect, it, vi } from 'vitest';
import { loadSettings } from '../settings';
import { DENSITY_PRESETS, matchDensityPreset } from '../density';

afterEach(() => vi.unstubAllGlobals());

describe('workspace display preferences', () => {
  it('starts new users with compact nodes and filters on demand', () => {
    vi.stubGlobal('localStorage', { getItem: () => null });
    const settings = loadSettings();
    expect(settings.filterPanelCollapsed).toBe(true);
    expect(matchDensityPreset(settings.nodeDisplayOptions)).toBe('compact');
  });

  it('preserves saved detailed nodes and pinned filters', () => {
    vi.stubGlobal('localStorage', { getItem: () => JSON.stringify({
      version: 1, filterPanelCollapsed: false, nodeDisplayOptions: DENSITY_PRESETS.detailed,
    }) });
    const settings = loadSettings();
    expect(settings.filterPanelCollapsed).toBe(false);
    expect(settings.nodeDisplayOptions).toEqual(DENSITY_PRESETS.detailed);
  });
});
