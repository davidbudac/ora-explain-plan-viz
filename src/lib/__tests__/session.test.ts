import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  SESSION_KEY,
  RECENT_KEY,
  MAX_SESSION_CHARS,
  MAX_RECENT_ENTRIES,
  MAX_RECENT_ENTRY_CHARS,
  MAX_RECENT_TOTAL_CHARS,
  saveSession,
  loadSession,
  clearSession,
  mergeRecentPlan,
  writeRecentPlans,
  loadRecentPlans,
  addRecentPlan,
  removeRecentPlan,
  recentPlanId,
  subscribeRecentPlans,
  getRecentPlansSnapshot,
  describeRecentPlan,
  formatRelativeTime,
  isViewMode,
  type SavedSession,
  type RecentPlan,
} from '../session';

function session(overrides: Partial<SavedSession> = {}): SavedSession {
  return {
    version: 1,
    savedAt: '2026-09-30T10:00:00.000Z',
    activePlanIndex: 0,
    viewMode: 'tabular',
    slots: [{ text: 'Plan hash value: 1\n| Id | Operation |', customLabel: 'Before' }],
    ...overrides,
  };
}

/** Storage whose setItem throws (quota exceeded / disabled site data). */
function throwingStorage(): Storage {
  return {
    length: 0,
    clear: () => {},
    key: () => null,
    getItem: () => null,
    removeItem: () => {},
    setItem: () => {
      throw new DOMException('QuotaExceededError', 'QuotaExceededError');
    },
  };
}

beforeEach(() => {
  localStorage.clear();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('session autosave', () => {
  it('round-trips a saved session through localStorage', () => {
    const saved = session({
      activePlanIndex: 1,
      slots: [
        { text: 'plan A', metadataText: '{"format":"ora-plan-metadata"}' },
        {
          text: 'plan B',
          annotations: { nodeAnnotations: { '1': { nodeId: 1, text: 'hot', createdAt: 'x', updatedAt: 'x' } }, nodeHighlights: {}, groups: [] },
        },
      ],
    });
    expect(saveSession(saved)).toMatchObject({ ok: true });
    expect(localStorage.getItem(SESSION_KEY)).not.toBeNull();

    const loaded = loadSession();
    expect(loaded).toEqual(saved);
  });

  it('removes the key when there is nothing to save', () => {
    saveSession(session());
    expect(saveSession(session({ slots: [] }))).toEqual({ ok: true, chars: 0 });
    expect(localStorage.getItem(SESSION_KEY)).toBeNull();
  });

  it('skips (and logs at info level) payloads over the size limit, keeping the previous save', () => {
    const info = vi.spyOn(console, 'info').mockImplementation(() => {});
    saveSession(session());
    const before = localStorage.getItem(SESSION_KEY);

    const huge = session({ slots: [{ text: 'x'.repeat(MAX_SESSION_CHARS + 10) }] });
    const result = saveSession(huge);

    expect(result).toMatchObject({ ok: false, reason: 'too-large' });
    expect(info).toHaveBeenCalledTimes(1);
    expect(localStorage.getItem(SESSION_KEY)).toBe(before);
  });

  it('never throws when storage is full or unavailable', () => {
    vi.spyOn(console, 'info').mockImplementation(() => {});
    expect(saveSession(session(), throwingStorage())).toMatchObject({ ok: false, reason: 'storage-error' });
    expect(saveSession(session(), null)).toEqual({ ok: false, reason: 'unavailable' });
    expect(loadSession(null)).toBeNull();
    expect(() => clearSession(null)).not.toThrow();
  });

  it('rejects corrupt or foreign payloads', () => {
    localStorage.setItem(SESSION_KEY, '{not json');
    expect(loadSession()).toBeNull();
    localStorage.setItem(SESSION_KEY, JSON.stringify({ version: 2, slots: [{ text: 'x' }] }));
    expect(loadSession()).toBeNull();
    localStorage.setItem(SESSION_KEY, JSON.stringify({ version: 1, slots: [{ nope: true }, { text: '   ' }] }));
    expect(loadSession()).toBeNull();
  });

  it('sanitizes the active index and view mode', () => {
    localStorage.setItem(
      SESSION_KEY,
      JSON.stringify({ version: 1, activePlanIndex: 7, viewMode: 'bogus', slots: [{ text: 'a' }, { text: 'b' }] }),
    );
    const loaded = loadSession();
    expect(loaded?.activePlanIndex).toBe(1);
    expect(loaded?.viewMode).toBe('hierarchical');
  });

  it('clearSession removes the saved session', () => {
    saveSession(session());
    clearSession();
    expect(loadSession()).toBeNull();
  });

  it('isViewMode accepts only known view modes', () => {
    expect(isViewMode('sankey')).toBe(true);
    expect(isViewMode('nope')).toBe(false);
    expect(isViewMode(3)).toBe(false);
  });
});

describe('recent plans', () => {
  const base = { label: 'Plan', text: 'plan text' };

  it('puts the newest entry first and dedupes by SQL_ID + plan hash', () => {
    let list: RecentPlan[] = [];
    list = mergeRecentPlan(list, { ...base, sqlId: 'abc', planHash: '1', loadedAt: '2026-01-01T00:00:00Z' });
    list = mergeRecentPlan(list, { ...base, sqlId: 'def', planHash: '2', loadedAt: '2026-01-02T00:00:00Z' });
    list = mergeRecentPlan(list, { ...base, sqlId: 'abc', planHash: '1', label: 'Again', loadedAt: '2026-01-03T00:00:00Z' });

    expect(list.map((e) => e.sqlId)).toEqual(['abc', 'def']);
    expect(list[0].label).toBe('Again');
    expect(list[0].id).toBe(recentPlanId('abc', '1', 'plan text'));
  });

  it('dedupes plans without SQL_ID / plan hash by their text', () => {
    let list = mergeRecentPlan([], { ...base, text: 'same' });
    list = mergeRecentPlan(list, { ...base, text: 'same' });
    list = mergeRecentPlan(list, { ...base, text: 'different' });
    expect(list).toHaveLength(2);
  });

  it(`keeps at most ${MAX_RECENT_ENTRIES} entries, evicting the oldest`, () => {
    let list: RecentPlan[] = [];
    for (let i = 0; i < MAX_RECENT_ENTRIES + 3; i++) {
      list = mergeRecentPlan(list, { ...base, sqlId: `sql${i}` });
    }
    expect(list).toHaveLength(MAX_RECENT_ENTRIES);
    expect(list[0].sqlId).toBe(`sql${MAX_RECENT_ENTRIES + 2}`);
    expect(list.some((e) => e.sqlId === 'sql0')).toBe(false);
  });

  it('drops the metadata of an oversized entry, then the entry itself', () => {
    const bigMeta = 'm'.repeat(MAX_RECENT_ENTRY_CHARS);
    const withMeta = mergeRecentPlan([], { ...base, sqlId: 'a', metadataText: bigMeta });
    expect(withMeta).toHaveLength(1);
    expect(withMeta[0].metadataText).toBeUndefined();

    const existing = mergeRecentPlan([], { ...base, sqlId: 'keep' });
    const tooBig = mergeRecentPlan(existing, { ...base, sqlId: 'b', text: 't'.repeat(MAX_RECENT_ENTRY_CHARS + 1) });
    expect(tooBig.map((e) => e.sqlId)).toEqual(['keep']);
  });

  it('evicts the oldest entries to stay under the total size cap', () => {
    const chunk = 'p'.repeat(Math.floor(MAX_RECENT_ENTRY_CHARS * 0.9));
    let list: RecentPlan[] = [];
    for (let i = 0; i < 6; i++) {
      list = mergeRecentPlan(list, { ...base, sqlId: `s${i}`, text: chunk });
    }
    const total = list.reduce((sum, e) => sum + e.text.length, 0);
    expect(total).toBeLessThanOrEqual(MAX_RECENT_TOTAL_CHARS);
    expect(list[0].sqlId).toBe('s5');
    expect(list.length).toBeLessThan(6);
  });

  it('evicts entries until the write fits when storage reports quota errors', () => {
    const accepted: string[] = [];
    const storage: Storage = {
      length: 0,
      clear: () => {},
      key: () => null,
      getItem: () => null,
      removeItem: () => {},
      setItem: (_key, value) => {
        if (value.length > 400) throw new DOMException('full', 'QuotaExceededError');
        accepted.push(value);
      },
    };
    let list: RecentPlan[] = [];
    for (let i = 0; i < 5; i++) list = mergeRecentPlan(list, { ...base, sqlId: `q${i}` });
    const written = writeRecentPlans(list, storage);
    expect(written.length).toBeGreaterThan(0);
    expect(written.length).toBeLessThan(5);
    expect(written[0].sqlId).toBe('q4');
    expect(accepted).toHaveLength(1);
  });

  it('persists through add/remove and notifies subscribers', () => {
    const listener = vi.fn();
    const unsubscribe = subscribeRecentPlans(listener);

    addRecentPlan({ ...base, sqlId: 'one', planHash: '11' });
    const [entry] = addRecentPlan({ ...base, sqlId: 'two', planHash: '22' });
    expect(loadRecentPlans().map((e) => e.sqlId)).toEqual(['two', 'one']);
    expect(getRecentPlansSnapshot().map((e) => e.sqlId)).toEqual(['two', 'one']);

    removeRecentPlan(entry.id);
    expect(loadRecentPlans().map((e) => e.sqlId)).toEqual(['one']);
    expect(listener).toHaveBeenCalledTimes(3);

    unsubscribe();
    addRecentPlan({ ...base, sqlId: 'three' });
    expect(listener).toHaveBeenCalledTimes(3);
  });

  it('ignores a corrupt recent list', () => {
    localStorage.setItem(RECENT_KEY, '{oops');
    expect(loadRecentPlans()).toEqual([]);
    localStorage.setItem(RECENT_KEY, JSON.stringify([{ id: 'x' }, { id: 'ok', text: 'plan' }]));
    expect(loadRecentPlans().map((e) => e.id)).toEqual(['ok']);
  });

  it('describes an entry for display', () => {
    const now = Date.parse('2026-09-30T12:00:00Z');
    const entry = mergeRecentPlan([], {
      label: 'plan.txt',
      sqlId: 'abc',
      planHash: '42',
      text: 'x'.repeat(2048),
      metadataText: '{}',
      loadedAt: '2026-09-30T10:00:00Z',
    })[0];
    expect(describeRecentPlan(entry, now)).toBe('SQL_ID abc · PHV 42 · 2 KB · + metadata · 2 h ago');
    expect(formatRelativeTime('2026-09-30T11:59:30Z', now)).toBe('just now');
    expect(formatRelativeTime('2026-09-01T00:00:00Z', now)).toBe('2026-09-01');
    expect(formatRelativeTime('garbage', now)).toBe('');
  });
});
