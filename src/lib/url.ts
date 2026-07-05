import { compressToEncodedURIComponent, decompressFromEncodedURIComponent } from 'lz-string';
import type { SerializedAnnotationState } from './annotations';

const URL_PARAM = 'plan';
const HASH_PARAM = 'gz';
/** Below this, share links get no warning. */
const SOFT_WARN_URL_LENGTH = 8000;
/** Hard ceiling for the new gzip+hash format — practical browser/clipboard limit. */
const HARD_MAX_URL_LENGTH = 100_000;
/** Cap for the legacy lz-string `?plan=` fallback (query params hit server request-line limits). */
const LEGACY_MAX_URL_LENGTH = 8000;

/**
 * Shape of the new JSON payload stored in the URL.
 * Each plan slot only needs its rawInput text.
 */
export interface SharePayload {
  plans: { rawInput: string; annotations?: SerializedAnnotationState }[];
  /** @deprecated Global annotations from older shares — migrated to per-plan on load */
  annotations?: SerializedAnnotationState;
}

/**
 * Result of reading the URL: either the new structured payload
 * or a legacy plain-text string (old format).
 */
export type UrlPlanData =
  | { type: 'payload'; payload: SharePayload }
  | { type: 'legacy'; planText: string };

/**
 * Classify decoded plan text as either the app's structured JSON payload
 * or legacy/raw plain text (e.g. a DB-generated plan dump). Shared by the
 * legacy lz-string `?plan=` path and the new gzip `#gz=` path.
 */
export function classifyDecodedPlanText(text: string): UrlPlanData {
  try {
    const parsed = JSON.parse(text);
    if (parsed && Array.isArray(parsed.plans)) {
      return { type: 'payload', payload: parsed as SharePayload };
    }
  } catch {
    // Not JSON — treat as legacy plain text
  }
  return { type: 'legacy', planText: text };
}

/**
 * Read compressed plan data from the current URL's ?plan= parameter.
 * Returns structured payload, legacy plain text, or null if not present.
 */
export function getPlanFromUrl(): UrlPlanData | null {
  const params = new URLSearchParams(window.location.search);
  const compressed = params.get(URL_PARAM);
  if (!compressed) return null;

  try {
    const decompressed = decompressFromEncodedURIComponent(compressed);
    if (!decompressed) return null;
    return classifyDecodedPlanText(decompressed);
  } catch {
    return null;
  }
}

/**
 * Read the gzip-encoded plan payload from the URL's #gz= hash param, if present.
 */
export function getGzipPlanParamFromHash(): string | null {
  const hashParams = new URLSearchParams(window.location.hash.slice(1));
  return hashParams.get(HASH_PARAM);
}

/**
 * Remove the ?plan= query param and #gz= hash param from the URL without
 * triggering navigation. Preserves any other hash params.
 */
export function clearPlanFromUrl(): void {
  const url = new URL(window.location.href);
  url.searchParams.delete(URL_PARAM);

  const hashParams = new URLSearchParams(url.hash.slice(1));
  hashParams.delete(HASH_PARAM);
  const remainingHash = hashParams.toString();
  url.hash = remainingHash ? `#${remainingHash}` : '';

  window.history.replaceState(null, '', url.toString());
}

/**
 * Strip bulky XML sections that the visualizer doesn't use.
 * Removes <statistic_buckets>, <bucket>, and <activity_sampled> elements
 * (with all their contents) which can dominate SQL Monitor XML size.
 * Non-XML input is returned unchanged.
 */
export function stripUnusedXmlSections(input: string): string {
  if (!/<sql_monitor_report|<plan_monitor/i.test(input)) return input;

  let result = input
    // Bulky data sections
    .replace(/<statistic_buckets\b[^>]*>[\s\S]*?<\/statistic_buckets>/gi, '')
    .replace(/<bucket\b[^>]*>[\s\S]*?<\/bucket>/gi, '')
    .replace(/<activity_sampled\b[^>]*>[\s\S]*?<\/activity_sampled>/gi, '')
    // Unused sections
    .replace(/<other_xml\b[^>]*>[\s\S]*?<\/other_xml>/gi, '')
    .replace(/<outline\b[^>]*>[\s\S]*?<\/outline>/gi, '')
    .replace(/<hint_usage\b[^>]*>[\s\S]*?<\/hint_usage>/gi, '')
    .replace(/<parallel\b[^>]*>[\s\S]*?<\/parallel>/gi, '')
    .replace(/<px_sets\b[^>]*>[\s\S]*?<\/px_sets>/gi, '')
    // XML comments
    .replace(/<!--[\s\S]*?-->/g, '');

  // Minify: collapse indentation and blank lines
  result = result
    .split('\n')
    .map(line => line.trim())
    .filter(line => line.length > 0)
    .join('\n');

  return result;
}

/**
 * Base64-encode an ArrayBuffer in ~32KB chunks (avoids blowing the call stack
 * on a naive `String.fromCharCode(...spread)` over large inputs), then
 * translate to base64url and strip padding.
 */
function bufferToBase64Url(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  const chunkSize = 0x8000;
  let binary = '';
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const chunk = bytes.subarray(i, i + chunkSize);
    binary += String.fromCharCode(...chunk);
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/**
 * Re-pad a base64url string back to standard base64 and translate the
 * alphabet back so it can be passed to atob().
 */
function base64UrlToBase64(value: string): string {
  const base64 = value.replace(/-/g, '+').replace(/_/g, '/');
  const paddingNeeded = (4 - (base64.length % 4)) % 4;
  return base64 + '='.repeat(paddingNeeded);
}

/**
 * Compress text with gzip and encode as base64url. Window-free (no
 * `window`/`location` access) so it can run under Node in tests.
 */
export async function encodeGzipPlanParam(text: string): Promise<string> {
  const bytes = new TextEncoder().encode(text);
  const compressedStream = new Blob([bytes]).stream().pipeThrough(new CompressionStream('gzip'));
  const compressedBuffer = await new Response(compressedStream).arrayBuffer();
  return bufferToBase64Url(compressedBuffer);
}

/**
 * Decode a base64url gzip payload back to text. Window-free (no
 * `window`/`location` access) so it can run under Node in tests. Throws on
 * corrupt, truncated, or empty input.
 */
export async function decodeGzipPlanParam(value: string): Promise<string> {
  if (!value || !/^[A-Za-z0-9_-]+$/.test(value)) {
    throw new Error('Invalid gzip plan parameter: unexpected characters.');
  }

  const base64 = base64UrlToBase64(value);
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }

  const decompressedStream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'));
  return new Response(decompressedStream).text();
}

export type ShareResult = {
  ok: true;
  url: string;
  warning?: string;
} | {
  ok: false;
  error: string;
};

/**
 * Legacy lz-string `?plan=` share URL builder. Used as a fallback for
 * browsers without CompressionStream, and kept so old links keep decoding.
 */
function buildLegacyShareUrl(payload: SharePayload): ShareResult {
  const json = JSON.stringify(payload);
  const compressed = compressToEncodedURIComponent(json);
  const url = new URL(window.location.href);
  url.searchParams.delete(URL_PARAM);
  url.searchParams.set(URL_PARAM, compressed);
  const fullUrl = url.toString();

  if (fullUrl.length > LEGACY_MAX_URL_LENGTH) {
    return {
      ok: false,
      error: `Plan is too large to share via URL (${fullUrl.length} chars, max ${LEGACY_MAX_URL_LENGTH}). Try a shorter plan.`,
    };
  }

  return { ok: true, url: fullUrl };
}

/**
 * Compress the share payload into a shareable URL. Prefers gzip in the hash
 * fragment (`#gz=...`), which avoids server-side query-length limits and
 * compresses far better than lz-string. Falls back to the legacy lz-string
 * `?plan=` query param on browsers without CompressionStream.
 */
export async function buildShareUrl(payload: SharePayload): Promise<ShareResult> {
  // Also guards jsdom (test env), which exposes Node's CompressionStream
  // global but ships a Blob without a working `.stream()`.
  if (typeof CompressionStream === 'undefined' || typeof Blob.prototype.stream !== 'function') {
    return buildLegacyShareUrl(payload);
  }

  const json = JSON.stringify(payload);
  const encoded = await encodeGzipPlanParam(json);

  const url = new URL(window.location.href);
  url.searchParams.delete(URL_PARAM);

  const hashParams = new URLSearchParams(url.hash.slice(1));
  hashParams.set(HASH_PARAM, encoded);
  url.hash = hashParams.toString();

  const fullUrl = url.toString();

  if (fullUrl.length > HARD_MAX_URL_LENGTH) {
    return {
      ok: false,
      error: `Plan is too large to share via URL (${fullUrl.length} chars, max ${HARD_MAX_URL_LENGTH}). Try a shorter plan.`,
    };
  }

  if (fullUrl.length > SOFT_WARN_URL_LENGTH) {
    return {
      ok: true,
      url: fullUrl,
      warning: `Link copied, but it is very long (${fullUrl.length} chars) — some chat and email clients may truncate it. Verify the pasted link works.`,
    };
  }

  return { ok: true, url: fullUrl };
}
