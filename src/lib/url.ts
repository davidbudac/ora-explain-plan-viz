import { compressToEncodedURIComponent, decompressFromEncodedURIComponent } from 'lz-string';
import type { SerializedAnnotationState } from './annotations';

const URL_PARAM = 'plan';
const MAX_URL_LENGTH = 8000;

/**
 * Shape of the new JSON payload stored in the URL.
 * Each plan slot only needs its rawInput text.
 */
export interface SharePayload {
  plans: { rawInput: string }[];
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

    // Try to parse as JSON (new format)
    try {
      const parsed = JSON.parse(decompressed);
      if (parsed && Array.isArray(parsed.plans)) {
        return { type: 'payload', payload: parsed as SharePayload };
      }
    } catch {
      // Not JSON — treat as legacy plain text
    }

    return { type: 'legacy', planText: decompressed };
  } catch {
    return null;
  }
}

/**
 * Remove the ?plan= parameter from the URL without triggering navigation.
 */
export function clearPlanFromUrl(): void {
  const url = new URL(window.location.href);
  url.searchParams.delete(URL_PARAM);
  window.history.replaceState(null, '', url.toString());
}

export type ShareResult = {
  ok: true;
  url: string;
} | {
  ok: false;
  error: string;
};

/**
 * Compress the share payload into a shareable URL.
 * Returns the URL string if within size limits, or an error message.
 */
export function buildShareUrl(payload: SharePayload): ShareResult {
  const json = JSON.stringify(payload);
  const compressed = compressToEncodedURIComponent(json);
  const url = new URL(window.location.href);
  url.searchParams.delete(URL_PARAM);
  url.searchParams.set(URL_PARAM, compressed);
  const fullUrl = url.toString();

  if (fullUrl.length > MAX_URL_LENGTH) {
    return {
      ok: false,
      error: `Plan is too large to share via URL (${fullUrl.length} chars, max ${MAX_URL_LENGTH}). Try a shorter plan.`,
    };
  }

  return { ok: true, url: fullUrl };
}
