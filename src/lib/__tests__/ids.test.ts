import { afterEach, describe, expect, it, vi } from 'vitest';
import { webcrypto } from 'node:crypto';
import { generateId } from '../ids';
import { generateGroupId } from '../annotations';

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('generateId', () => {
  it('returns a v4-shaped UUID with the native crypto', () => {
    expect(generateId()).toMatch(UUID_V4);
  });

  it('delegates to crypto.randomUUID when it exists', () => {
    vi.stubGlobal('crypto', { randomUUID: () => 'native-uuid' });
    expect(generateId()).toBe('native-uuid');
  });

  it('builds a v4 UUID from getRandomValues when randomUUID is missing (plain-http origin)', () => {
    // Insecure contexts expose getRandomValues but not randomUUID.
    vi.stubGlobal('crypto', { getRandomValues: (array: Uint8Array) => webcrypto.getRandomValues(array) });
    const id = generateId();
    expect(id).toMatch(UUID_V4);
    const ids = new Set(Array.from({ length: 200 }, () => generateId()));
    expect(ids.size).toBe(200);
  });

  it('sets the version and variant bits even for an all-ones / all-zeros random source', () => {
    for (const fill of [0x00, 0xff]) {
      vi.stubGlobal('crypto', {
        getRandomValues: (array: Uint8Array) => {
          array.fill(fill);
          return array;
        },
      });
      expect(generateId()).toMatch(UUID_V4);
    }
  });

  it('falls back to Math.random when crypto is unavailable entirely', () => {
    vi.stubGlobal('crypto', undefined);
    expect(generateId()).toMatch(UUID_V4);
  });

  it('keeps generateGroupId working where crypto.randomUUID is undefined', () => {
    vi.stubGlobal('crypto', { getRandomValues: (array: Uint8Array) => webcrypto.getRandomValues(array) });
    expect(generateGroupId()).toMatch(UUID_V4);
  });
});
