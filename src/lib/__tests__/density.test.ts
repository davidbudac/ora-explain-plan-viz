import { describe, it, expect } from 'vitest';
import { DENSITY_PRESETS, matchDensityPreset } from '../density';
import { defaultNodeDisplayOptions } from '../settings';

describe('density presets', () => {
  it('settings defaults derive the balanced preset', () => {
    expect(matchDensityPreset(defaultNodeDisplayOptions)).toBe('balanced');
  });

  it('each preset table maps back to itself', () => {
    expect(matchDensityPreset(DENSITY_PRESETS.compact)).toBe('compact');
    expect(matchDensityPreset(DENSITY_PRESETS.balanced)).toBe('balanced');
    expect(matchDensityPreset(DENSITY_PRESETS.detailed)).toBe('detailed');
  });

  it('any manual toggle derives custom', () => {
    const tweaked = { ...DENSITY_PRESETS.compact, showBytes: true };
    expect(matchDensityPreset(tweaked)).toBe('custom');
  });

  it('presets cover every display option key', () => {
    const keys = Object.keys(defaultNodeDisplayOptions).sort();
    for (const preset of Object.values(DENSITY_PRESETS)) {
      expect(Object.keys(preset).sort()).toEqual(keys);
    }
  });
});
