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
  it('stores session-only when remember=false', () => {
    setAiSecret('anthropic', 'sk-ant-123', false);
    expect(getAiSecret('anthropic')).toBe('sk-ant-123');
    expect(sessionStorage.getItem(ANTHROPIC_KEY)).toBe('sk-ant-123');
    expect(localStorage.getItem(ANTHROPIC_KEY)).toBeNull();
  });

  it('mirrors to localStorage when remember=true', () => {
    setAiSecret('openai', 'sk-oai-456', true);
    expect(sessionStorage.getItem(OPENAI_KEY)).toBe('sk-oai-456');
    expect(localStorage.getItem(OPENAI_KEY)).toBe('sk-oai-456');
  });

  it('remember=false removes a previously remembered localStorage copy', () => {
    setAiSecret('anthropic', 'old', true);
    setAiSecret('anthropic', 'new', false);
    expect(getAiSecret('anthropic')).toBe('new');
    expect(localStorage.getItem(ANTHROPIC_KEY)).toBeNull();
  });

  it('falls back to localStorage when sessionStorage has no value', () => {
    localStorage.setItem(ANTHROPIC_KEY, 'remembered');
    expect(getAiSecret('anthropic')).toBe('remembered');
  });

  it('prefers sessionStorage over localStorage', () => {
    localStorage.setItem(OPENAI_KEY, 'local-value');
    sessionStorage.setItem(OPENAI_KEY, 'session-value');
    expect(getAiSecret('openai')).toBe('session-value');
  });

  it('keeps the two providers independent', () => {
    setAiSecret('anthropic', 'a', false);
    setAiSecret('openai', 'b', false);
    expect(getAiSecret('anthropic')).toBe('a');
    expect(getAiSecret('openai')).toBe('b');
  });

  it('returns null when nothing is stored', () => {
    expect(getAiSecret('anthropic')).toBeNull();
  });
});

describe('clearAiSecret', () => {
  it('removes both session and local copies', () => {
    setAiSecret('anthropic', 'sk-ant-789', true);
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
    setAiSecret('anthropic', 'memory-only', false);
    expect(getAiSecret('anthropic')).toBe('memory-only');

    clearAiSecret('anthropic');
    expect(getAiSecret('anthropic')).toBeNull();
  });
});
