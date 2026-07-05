import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { compressToEncodedURIComponent } from 'lz-string';
import {
  getPlanFromUrl,
  getGzipPlanParamFromHash,
  clearPlanFromUrl,
  buildShareUrl,
  type SharePayload,
} from '../url';

function setUrl(url: string) {
  window.history.replaceState(null, '', url);
}

describe('getPlanFromUrl (legacy lz-string ?plan= regression)', () => {
  afterEach(() => {
    setUrl('http://localhost:3000/');
  });

  it('decodes a legacy plain-text ?plan= link', () => {
    const planText = 'Plan hash value: 1234567890\n\nSELECT STATEMENT';
    const compressed = compressToEncodedURIComponent(planText);
    setUrl(`http://localhost:3000/?plan=${compressed}`);

    const result = getPlanFromUrl();
    expect(result).not.toBeNull();
    expect(result?.type).toBe('legacy');
    if (result?.type === 'legacy') {
      expect(result.planText).toBe(planText);
    }
  });

  it('decodes a legacy JSON SharePayload ?plan= link', () => {
    const payload: SharePayload = { plans: [{ rawInput: 'raw plan text' }] };
    const compressed = compressToEncodedURIComponent(JSON.stringify(payload));
    setUrl(`http://localhost:3000/?plan=${compressed}`);

    const result = getPlanFromUrl();
    expect(result?.type).toBe('payload');
    if (result?.type === 'payload') {
      expect(result.payload.plans[0].rawInput).toBe('raw plan text');
    }
  });

  it('returns null when there is no ?plan= param', () => {
    setUrl('http://localhost:3000/');
    expect(getPlanFromUrl()).toBeNull();
  });
});

describe('getGzipPlanParamFromHash', () => {
  afterEach(() => {
    setUrl('http://localhost:3000/');
  });

  it('reads the gz value from the hash', () => {
    setUrl('http://localhost:3000/#gz=abc123');
    expect(getGzipPlanParamFromHash()).toBe('abc123');
  });

  it('returns null when no gz hash param is present', () => {
    setUrl('http://localhost:3000/#foo=bar');
    expect(getGzipPlanParamFromHash()).toBeNull();
  });

  it('returns null when there is no hash at all', () => {
    setUrl('http://localhost:3000/');
    expect(getGzipPlanParamFromHash()).toBeNull();
  });
});

describe('clearPlanFromUrl', () => {
  afterEach(() => {
    setUrl('http://localhost:3000/');
  });

  it('removes ?plan= from the URL', () => {
    setUrl('http://localhost:3000/?plan=xyz');
    clearPlanFromUrl();
    expect(window.location.search).toBe('');
  });

  it('removes #gz= from the URL', () => {
    setUrl('http://localhost:3000/#gz=xyz');
    clearPlanFromUrl();
    expect(window.location.hash).toBe('');
  });

  it('removes both ?plan= and #gz=', () => {
    setUrl('http://localhost:3000/?plan=xyz#gz=abc');
    clearPlanFromUrl();
    expect(window.location.search).toBe('');
    expect(window.location.hash).toBe('');
  });

  it('preserves other hash params when clearing gz', () => {
    setUrl('http://localhost:3000/#gz=abc&view=sankey');
    clearPlanFromUrl();
    expect(getGzipPlanParamFromHash()).toBeNull();
    expect(window.location.hash).toContain('view=sankey');
  });

  it('preserves other query params when clearing plan', () => {
    setUrl('http://localhost:3000/?plan=xyz&example=foo');
    clearPlanFromUrl();
    expect(window.location.search).not.toContain('plan=');
    expect(window.location.search).toContain('example=foo');
  });
});

describe('buildShareUrl (jsdom: no CompressionStream, exercises legacy fallback)', () => {
  afterEach(() => {
    setUrl('http://localhost:3000/');
  });

  it('falls back to lz-string ?plan= URL when CompressionStream is unavailable', async () => {
    setUrl('http://localhost:3000/');
    const payload: SharePayload = { plans: [{ rawInput: 'small plan text' }] };
    const result = await buildShareUrl(payload);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.url).toContain('?plan=');
      expect(result.url).not.toContain('#gz=');
    }
  });

  it('errors when the legacy-encoded URL exceeds the 8000-char cap', async () => {
    setUrl('http://localhost:3000/');
    // Random, low-redundancy text so lz-string can't compress it away —
    // repetitive input (e.g. 'x'.repeat(n)) compresses too well to hit the cap.
    const hugeInput = Array.from({ length: 50_000 }, () =>
      Math.random().toString(36).charAt(2)
    ).join('');
    const payload: SharePayload = { plans: [{ rawInput: hugeInput }] };
    const result = await buildShareUrl(payload);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toMatch(/too large to share/i);
      expect(result.error).toContain('8000');
    }
  });

  it('removes a stale ?plan= param when re-sharing', async () => {
    setUrl('http://localhost:3000/?plan=stale');
    const payload: SharePayload = { plans: [{ rawInput: 'small plan text' }] };
    const result = await buildShareUrl(payload);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.url).not.toContain('plan=stale');
    }
  });
});
