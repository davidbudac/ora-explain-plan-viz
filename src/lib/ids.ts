/**
 * Generate a random RFC 4122 version-4 UUID string.
 *
 * `crypto.randomUUID()` only exists in secure contexts (HTTPS / localhost).
 * On a plain-HTTP origin — e.g. a self-hosted Docker/nginx build reached over
 * the LAN — it is `undefined` and calling it throws. This helper degrades
 * gracefully:
 *
 *   1. `crypto.randomUUID()` when available.
 *   2. A v4 UUID assembled from `crypto.getRandomValues()` (available in
 *      insecure contexts too).
 *   3. `Math.random()` as a last resort (not cryptographically strong; these
 *      IDs are only used as local identifiers, never as secrets).
 */
export function generateId(): string {
  const c: Crypto | undefined = typeof globalThis !== 'undefined' ? globalThis.crypto : undefined;

  if (c && typeof c.randomUUID === 'function') {
    try {
      return c.randomUUID();
    } catch {
      // Fall through to the manual path.
    }
  }

  const bytes = new Uint8Array(16);
  if (c && typeof c.getRandomValues === 'function') {
    c.getRandomValues(bytes);
  } else {
    for (let i = 0; i < bytes.length; i++) bytes[i] = Math.floor(Math.random() * 256);
  }

  // Per RFC 4122 section 4.4: set the version (4) and variant (10xx) bits.
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;

  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0'));
  return (
    hex.slice(0, 4).join('') +
    '-' +
    hex.slice(4, 6).join('') +
    '-' +
    hex.slice(6, 8).join('') +
    '-' +
    hex.slice(8, 10).join('') +
    '-' +
    hex.slice(10, 16).join('')
  );
}
