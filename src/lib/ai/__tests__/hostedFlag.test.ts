import { afterEach, describe, expect, it, vi } from 'vitest';
import { isHostedAiEnabled } from '../provider';

afterEach(() => vi.unstubAllEnvs());

describe('isHostedAiEnabled', () => {
  it('is off by default', () => {
    vi.stubEnv('VITE_ENABLE_HOSTED', '');
    expect(isHostedAiEnabled()).toBe(false);
  });
  it.each(['1', 'true'])('is on for VITE_ENABLE_HOSTED=%s', (v) => {
    vi.stubEnv('VITE_ENABLE_HOSTED', v);
    expect(isHostedAiEnabled()).toBe(true);
  });
  it('ignores other values', () => {
    vi.stubEnv('VITE_ENABLE_HOSTED', 'yes');
    expect(isHostedAiEnabled()).toBe(false);
  });
});
