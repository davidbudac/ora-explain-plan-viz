import { afterEach, describe, expect, it, vi } from 'vitest';
import { clearAiSecret, getAiSecret, setAiSecret } from '../secrets';

const ANTHROPIC_KEY = 'oraplanviz.aiAnthropicKey';
const OPENAI_KEY = 'oraplanviz.aiOpenAiKey';

afterEach(() => {
  vi.restoreAllMocks();
  sessionStorage.clear();
  localStorage.clear();
  clearAiSecret('anthropic');
  clearAiSecret('openai');
});

describe('setAiSecret / getAiSecret', () => {
  it('stores the key in sessionStorage only', () => {
    setAiSecret('anthropic', 'test-key-1');
    expect(getAiSecret('anthropic')).toBe('test-key-1');
    expect(sessionStorage.getItem(ANTHROPIC_KEY)).toBe('test-key-1');
    expect(localStorage.getItem(ANTHROPIC_KEY)).toBeNull();
  });

  it('never writes a key to localStorage', () => {
    const setItem = vi.spyOn(Storage.prototype, 'setItem');
    setAiSecret('anthropic', 'test-key-1');
    setAiSecret('openai', 'test-key-2');
    getAiSecret('anthropic');
    getAiSecret('openai');
    expect(localStorage.length).toBe(0);
    // every write went to sessionStorage
    expect(setItem.mock.contexts.every((storage) => storage === sessionStorage)).toBe(true);
  });

  it('setAiSecret deletes a copy an older version left in localStorage', () => {
    localStorage.setItem(ANTHROPIC_KEY, 'old-remembered');
    setAiSecret('anthropic', 'new');
    expect(getAiSecret('anthropic')).toBe('new');
    expect(localStorage.getItem(ANTHROPIC_KEY)).toBeNull();
  });

  it('getAiSecret ignores and deletes a copy an older version left in localStorage', () => {
    localStorage.setItem(ANTHROPIC_KEY, 'old-remembered');
    expect(getAiSecret('anthropic')).toBeNull();
    expect(localStorage.getItem(ANTHROPIC_KEY)).toBeNull();
  });

  it('reads sessionStorage and drops a stale localStorage copy', () => {
    localStorage.setItem(OPENAI_KEY, 'local-value');
    sessionStorage.setItem(OPENAI_KEY, 'session-value');
    expect(getAiSecret('openai')).toBe('session-value');
    expect(localStorage.getItem(OPENAI_KEY)).toBeNull();
  });

  it('keeps the two providers independent', () => {
    setAiSecret('anthropic', 'a');
    setAiSecret('openai', 'b');
    expect(getAiSecret('anthropic')).toBe('a');
    expect(getAiSecret('openai')).toBe('b');
  });

  it('returns null when nothing is stored', () => {
    expect(getAiSecret('anthropic')).toBeNull();
  });
});

describe('clearAiSecret', () => {
  it('removes the session copy and any old local copy', () => {
    setAiSecret('anthropic', 'test-key-3');
    localStorage.setItem(ANTHROPIC_KEY, 'old-remembered');
    clearAiSecret('anthropic');
    expect(sessionStorage.getItem(ANTHROPIC_KEY)).toBeNull();
    expect(localStorage.getItem(ANTHROPIC_KEY)).toBeNull();
    expect(getAiSecret('anthropic')).toBeNull();
  });
});

describe('in-memory fallback when storage throws', () => {
  it('round-trips via the memory store when sessionStorage.setItem throws', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('QuotaExceededError');
    });
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('SecurityError');
    });
    setAiSecret('anthropic', 'memory-only');
    expect(getAiSecret('anthropic')).toBe('memory-only');

    clearAiSecret('anthropic');
    expect(getAiSecret('anthropic')).toBeNull();
  });
});
