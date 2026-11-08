/**
 * API-key storage for the AI analysis feature.
 *
 * Follows the ConnectPanel convention: keys live in sessionStorage by default
 * (gone when the tab closes); an opt-in "remember on this device" mirrors the
 * key to localStorage. Reads fall back sessionStorage -> localStorage.
 *
 * Keys are NEVER written to the settings blob (settings.ts) or share URLs
 * (url.ts). Every storage access is try/catch-wrapped — storage may be
 * unavailable (private browsing, sandboxed iframes) — with an in-memory Map
 * as a same-session fallback.
 */

export type AiSecretKey = 'anthropic' | 'openai';

const STORAGE_KEYS: Record<AiSecretKey, string> = {
  anthropic: 'oraplanviz.aiAnthropicKey',
  openai: 'oraplanviz.aiOpenAiKey',
};

/** Same-session fallback when web storage is unavailable. */
const memoryStore = new Map<string, string>();

function safeGet(storage: () => Storage, key: string): string | null {
  try {
    return storage().getItem(key);
  } catch {
    return null;
  }
}

function safeSet(storage: () => Storage, key: string, value: string): boolean {
  try {
    storage().setItem(key, value);
    return true;
  } catch {
    return false;
  }
}

function safeRemove(storage: () => Storage, key: string): void {
  try {
    storage().removeItem(key);
  } catch {
    // Storage unavailable; nothing to remove.
  }
}

/** Read a secret: sessionStorage first, then localStorage, then memory. */
export function getAiSecret(key: AiSecretKey): string | null {
  const storageKey = STORAGE_KEYS[key];
  const session = safeGet(() => sessionStorage, storageKey);
  if (session !== null) return session;
  const local = safeGet(() => localStorage, storageKey);
  if (local !== null) return local;
  return memoryStore.get(storageKey) ?? null;
}

/**
 * Store a secret for this session. With `remember` it is also mirrored to
 * localStorage; without it any previously remembered copy is removed.
 */
export function setAiSecret(key: AiSecretKey, value: string, remember: boolean): void {
  const storageKey = STORAGE_KEYS[key];
  const wroteSession = safeSet(() => sessionStorage, storageKey, value);
  if (!wroteSession) {
    memoryStore.set(storageKey, value);
  } else {
    memoryStore.delete(storageKey);
  }
  if (remember) {
    safeSet(() => localStorage, storageKey, value);
  } else {
    safeRemove(() => localStorage, storageKey);
  }
}

/** Remove a secret from every store (session, local, memory). */
export function clearAiSecret(key: AiSecretKey): void {
  const storageKey = STORAGE_KEYS[key];
  safeRemove(() => sessionStorage, storageKey);
  safeRemove(() => localStorage, storageKey);
  memoryStore.delete(storageKey);
}
