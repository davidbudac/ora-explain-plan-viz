/**
 * Local session persistence: autosave/restore of the loaded plans and a short
 * "Recent plans" list. Everything lives in this browser's localStorage only —
 * nothing is uploaded.
 *
 * All storage access is wrapped in try/catch: private windows, disabled site
 * data and quota errors must never break the app, only skip persistence.
 */
import type { SerializedAnnotationState } from './annotations';
import type { ViewMode } from './types';

export const SESSION_KEY = 'oraplanviz.session.v1';
export const RECENT_KEY = 'oraplanviz.recent.v1';

/** Autosave is skipped (not truncated) when the serialised session exceeds this many chars. */
export const MAX_SESSION_CHARS = 4 * 1024 * 1024;
/** A recent entry larger than this drops its metadata; if still too big it is not kept. */
export const MAX_RECENT_ENTRY_CHARS = 1024 * 1024;
/** Oldest recent entries are evicted until the list fits under this. */
export const MAX_RECENT_TOTAL_CHARS = 4 * 1024 * 1024;
export const MAX_RECENT_ENTRIES = 8;

const VIEW_MODES: readonly ViewMode[] = [
  'hierarchical', 'sankey', 'flame', 'tabular', 'text', 'sql', 'metadata',
  'compare', 'monitor', 'experimental', 'ai', 'ai-report',
];

export function isViewMode(value: unknown): value is ViewMode {
  return typeof value === 'string' && (VIEW_MODES as readonly string[]).includes(value);
}

function defaultStorage(): Storage | null {
  try {
    return typeof window !== 'undefined' && window.localStorage ? window.localStorage : null;
  } catch {
    return null;
  }
}

function readJson(storage: Storage | null, key: string): unknown {
  if (!storage) return null;
  try {
    const raw = storage.getItem(key);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function removeKey(storage: Storage | null, key: string): void {
  if (!storage) return;
  try {
    storage.removeItem(key);
  } catch {
    // ignore — storage unavailable
  }
}

// ---------------------------------------------------------------------------
// Session autosave
// ---------------------------------------------------------------------------

export interface SavedSlot {
  customLabel?: string;
  /** Source text of the loaded plan. */
  text: string;
  /** Attached metadata bundle, serialised (parseBundle() accepts it back). */
  metadataText?: string;
  annotations?: SerializedAnnotationState;
}

export interface SavedSession {
  version: 1;
  savedAt: string;
  activePlanIndex: number;
  viewMode: ViewMode;
  slots: SavedSlot[];
}

export type SaveSessionResult =
  | { ok: true; chars: number }
  | { ok: false; reason: 'too-large' | 'unavailable' | 'storage-error'; chars?: number };

export function serializeSession(session: SavedSession): string {
  return JSON.stringify(session);
}

/**
 * Persist the session. Oversized payloads are skipped and logged at info
 * level; an empty session (no slots) removes the key instead.
 */
export function saveSession(session: SavedSession, storage: Storage | null = defaultStorage()): SaveSessionResult {
  if (!storage) return { ok: false, reason: 'unavailable' };
  if (session.slots.length === 0) {
    removeKey(storage, SESSION_KEY);
    return { ok: true, chars: 0 };
  }
  const json = serializeSession(session);
  if (json.length > MAX_SESSION_CHARS) {
    console.info(
      `[session] Autosave skipped: session is ${(json.length / 1024 / 1024).toFixed(1)} MB, over the ${MAX_SESSION_CHARS / 1024 / 1024} MB limit.`,
    );
    return { ok: false, reason: 'too-large', chars: json.length };
  }
  try {
    storage.setItem(SESSION_KEY, json);
    return { ok: true, chars: json.length };
  } catch (err) {
    console.info('[session] Autosave failed (storage full or unavailable).', err);
    return { ok: false, reason: 'storage-error', chars: json.length };
  }
}

function sanitizeSlot(value: unknown): SavedSlot | null {
  if (!value || typeof value !== 'object') return null;
  const v = value as Record<string, unknown>;
  if (typeof v.text !== 'string' || !v.text.trim()) return null;
  const slot: SavedSlot = { text: v.text };
  if (typeof v.customLabel === 'string' && v.customLabel.trim()) slot.customLabel = v.customLabel;
  if (typeof v.metadataText === 'string' && v.metadataText) slot.metadataText = v.metadataText;
  if (v.annotations && typeof v.annotations === 'object') {
    slot.annotations = v.annotations as SerializedAnnotationState;
  }
  return slot;
}

/** Read and validate the saved session; null when absent or unusable. */
export function loadSession(storage: Storage | null = defaultStorage()): SavedSession | null {
  const raw = readJson(storage, SESSION_KEY);
  if (!raw || typeof raw !== 'object') return null;
  const obj = raw as Record<string, unknown>;
  if (obj.version !== 1 || !Array.isArray(obj.slots)) return null;
  const slots = obj.slots.map(sanitizeSlot).filter((s): s is SavedSlot => s !== null);
  if (slots.length === 0) return null;
  const activeRaw = typeof obj.activePlanIndex === 'number' && Number.isFinite(obj.activePlanIndex)
    ? Math.trunc(obj.activePlanIndex)
    : 0;
  return {
    version: 1,
    savedAt: typeof obj.savedAt === 'string' ? obj.savedAt : '',
    activePlanIndex: Math.min(Math.max(0, activeRaw), slots.length - 1),
    viewMode: isViewMode(obj.viewMode) ? obj.viewMode : 'hierarchical',
    slots,
  };
}

export function clearSession(storage: Storage | null = defaultStorage()): void {
  removeKey(storage, SESSION_KEY);
}

// ---------------------------------------------------------------------------
// Recent plans
// ---------------------------------------------------------------------------

export interface RecentPlan {
  /** Stable identity: SQL_ID + plan hash when known, else a hash of the text. */
  id: string;
  sqlId?: string;
  planHash?: string;
  label: string;
  /** ISO timestamp of the last load. */
  loadedAt: string;
  /** Size of the plan text, for display. */
  chars: number;
  text: string;
  metadataText?: string;
}

export interface RecentPlanInput {
  sqlId?: string;
  planHash?: string;
  label: string;
  text: string;
  metadataText?: string;
  loadedAt?: string;
}

/** Small, fast, non-cryptographic string hash (djb2 → base36). */
function hashText(text: string): string {
  let h = 5381;
  for (let i = 0; i < text.length; i++) {
    h = ((h << 5) + h + text.charCodeAt(i)) | 0;
  }
  return (h >>> 0).toString(36);
}

export function recentPlanId(sqlId: string | undefined, planHash: string | undefined, text: string): string {
  if (sqlId || planHash) return `plan:${sqlId ?? ''}:${planHash ?? ''}`;
  return `text:${hashText(text)}:${text.length}`;
}

function entrySize(entry: RecentPlan): number {
  return entry.text.length + (entry.metadataText?.length ?? 0) + entry.label.length + 200;
}

function totalSize(list: RecentPlan[]): number {
  return list.reduce((sum, e) => sum + entrySize(e), 0);
}

function sanitizeRecent(value: unknown): RecentPlan | null {
  if (!value || typeof value !== 'object') return null;
  const v = value as Record<string, unknown>;
  if (typeof v.id !== 'string' || typeof v.text !== 'string' || !v.text) return null;
  return {
    id: v.id,
    ...(typeof v.sqlId === 'string' && v.sqlId ? { sqlId: v.sqlId } : {}),
    ...(typeof v.planHash === 'string' && v.planHash ? { planHash: v.planHash } : {}),
    label: typeof v.label === 'string' && v.label ? v.label : 'Untitled plan',
    loadedAt: typeof v.loadedAt === 'string' ? v.loadedAt : '',
    chars: typeof v.chars === 'number' ? v.chars : v.text.length,
    text: v.text,
    ...(typeof v.metadataText === 'string' && v.metadataText ? { metadataText: v.metadataText } : {}),
  };
}

export function loadRecentPlans(storage: Storage | null = defaultStorage()): RecentPlan[] {
  const raw = readJson(storage, RECENT_KEY);
  if (!Array.isArray(raw)) return [];
  return raw.map(sanitizeRecent).filter((e): e is RecentPlan => e !== null).slice(0, MAX_RECENT_ENTRIES);
}

/**
 * Pure list update: put `input` first (deduped by id), apply the per-entry
 * cap (drop metadata, then the entry itself) and evict the oldest entries
 * until both the count and the total-size caps hold.
 */
export function mergeRecentPlan(list: RecentPlan[], input: RecentPlanInput): RecentPlan[] {
  const id = recentPlanId(input.sqlId, input.planHash, input.text);
  let entry: RecentPlan = {
    id,
    ...(input.sqlId ? { sqlId: input.sqlId } : {}),
    ...(input.planHash ? { planHash: input.planHash } : {}),
    label: input.label,
    loadedAt: input.loadedAt ?? new Date().toISOString(),
    chars: input.text.length,
    text: input.text,
    ...(input.metadataText ? { metadataText: input.metadataText } : {}),
  };
  if (entrySize(entry) > MAX_RECENT_ENTRY_CHARS && entry.metadataText) {
    const withoutMetadata: RecentPlan = { ...entry };
    delete withoutMetadata.metadataText;
    entry = withoutMetadata;
  }
  // Still too big: don't remember it (and leave the list untouched).
  if (entrySize(entry) > MAX_RECENT_ENTRY_CHARS) return list.slice(0, MAX_RECENT_ENTRIES);

  const capped = [entry, ...list.filter((e) => e.id !== id)].slice(0, MAX_RECENT_ENTRIES);
  while (capped.length > 1 && totalSize(capped) > MAX_RECENT_TOTAL_CHARS) capped.pop();
  return capped;
}

/** Write the list, evicting the oldest entries on quota errors. Returns what was stored. */
export function writeRecentPlans(list: RecentPlan[], storage: Storage | null = defaultStorage()): RecentPlan[] {
  if (!storage) return list;
  const working = [...list];
  for (;;) {
    try {
      if (working.length === 0) {
        storage.removeItem(RECENT_KEY);
      } else {
        storage.setItem(RECENT_KEY, JSON.stringify(working));
      }
      return working;
    } catch (err) {
      if (working.length === 0) {
        console.info('[session] Could not store recent plans.', err);
        return working;
      }
      working.pop();
    }
  }
}

// A tiny external store so React can subscribe (useSyncExternalStore) and
// several tabs stay in sync via the `storage` event.
const recentListeners = new Set<() => void>();
let recentSnapshot: RecentPlan[] | null = null;
const EMPTY_RECENT: RecentPlan[] = [];

function publishRecent(list: RecentPlan[]): RecentPlan[] {
  recentSnapshot = list;
  recentListeners.forEach((listener) => listener());
  return list;
}

/** Current recent-plans list (read from storage once, then cached). */
export function getRecentPlansSnapshot(): RecentPlan[] {
  if (recentSnapshot === null) recentSnapshot = loadRecentPlans();
  return recentSnapshot;
}

/** Server/test snapshot: always empty. */
export function getEmptyRecentPlans(): RecentPlan[] {
  return EMPTY_RECENT;
}

function onRecentStorageEvent(event: StorageEvent): void {
  if (event.key === RECENT_KEY || event.key === null) publishRecent(loadRecentPlans());
}

export function subscribeRecentPlans(listener: () => void): () => void {
  recentListeners.add(listener);
  if (recentListeners.size === 1 && typeof window !== 'undefined') {
    window.addEventListener('storage', onRecentStorageEvent);
  }
  return () => {
    recentListeners.delete(listener);
    if (recentListeners.size === 0 && typeof window !== 'undefined') {
      window.removeEventListener('storage', onRecentStorageEvent);
    }
  };
}

export function addRecentPlan(input: RecentPlanInput, storage: Storage | null = defaultStorage()): RecentPlan[] {
  return publishRecent(writeRecentPlans(mergeRecentPlan(loadRecentPlans(storage), input), storage));
}

export function removeRecentPlan(id: string, storage: Storage | null = defaultStorage()): RecentPlan[] {
  return publishRecent(writeRecentPlans(loadRecentPlans(storage).filter((e) => e.id !== id), storage));
}

function formatSize(chars: number): string {
  if (chars < 1024) return `${chars} chars`;
  if (chars < 1024 * 1024) return `${Math.round(chars / 1024)} KB`;
  return `${(chars / 1024 / 1024).toFixed(1)} MB`;
}

/** "3 min ago", "2 h ago", "4 d ago", or a date for older entries. */
export function formatRelativeTime(iso: string, now: number = Date.now()): string {
  const then = Date.parse(iso);
  if (!Number.isFinite(then)) return '';
  const seconds = Math.max(0, Math.round((now - then) / 1000));
  if (seconds < 60) return 'just now';
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  const days = Math.round(hours / 24);
  if (days < 14) return `${days} d ago`;
  return new Date(then).toISOString().slice(0, 10);
}

/** One-line secondary text for a recent entry: SQL_ID · PHV · size · age. */
export function describeRecentPlan(entry: RecentPlan, now: number = Date.now()): string {
  const parts: string[] = [];
  if (entry.sqlId && !entry.label.includes(entry.sqlId)) parts.push(`SQL_ID ${entry.sqlId}`);
  if (entry.planHash) parts.push(`PHV ${entry.planHash}`);
  parts.push(formatSize(entry.chars));
  if (entry.metadataText) parts.push('+ metadata');
  const age = formatRelativeTime(entry.loadedAt, now);
  if (age) parts.push(age);
  return parts.join(' · ');
}
