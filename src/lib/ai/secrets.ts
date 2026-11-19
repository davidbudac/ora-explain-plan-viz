/**
 * API-key storage for the AI analysis feature.
 *
 * Keys live in sessionStorage only (gone when the tab closes), as SECURITY.md
 * promises. Earlier versions could mirror a key to localStorage ("remember on
 * this device"); any such copy is deleted, unused, on the next read or write.
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

/** Read a secret: sessionStorage first, then memory. */
export function getAiSecret(key: AiSecretKey): string | null {
  const storageKey = STORAGE_KEYS[key];
  // Drop a copy left behind by the old "remember on this device" option.
  safeRemove(() => localStorage, storageKey);
  const session = safeGet(() => sessionStorage, storageKey);
  if (session !== null) return session;
  return memoryStore.get(storageKey) ?? null;
}

/** Store a secret for this session (sessionStorage, or memory when storage is unavailable). */
export function setAiSecret(key: AiSecretKey, value: string): void {
  const storageKey = STORAGE_KEYS[key];
  const wroteSession = safeSet(() => sessionStorage, storageKey, value);
  if (!wroteSession) {
    memoryStore.set(storageKey, value);
  } else {
    memoryStore.delete(storageKey);
  }
  safeRemove(() => localStorage, storageKey);
}

/** Remove a secret from every store (session, local, memory). */
export function clearAiSecret(key: AiSecretKey): void {
  const storageKey = STORAGE_KEYS[key];
  safeRemove(() => sessionStorage, storageKey);
  safeRemove(() => localStorage, storageKey);
  memoryStore.delete(storageKey);
}
