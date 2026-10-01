import { describe, it, expect, afterEach } from 'vitest';
import { compressToEncodedURIComponent } from 'lz-string';
import {
  getPlanFromUrl,
  getGzipPlanParamFromHash,
  clearPlanFromUrl,
  buildShareUrl,
  buildShareLink,
  getSharedViewMode,
  classifyDecodedPlanText,
  SHARE_BUNDLE_MAX_URL_LENGTH,
  type SharePayload,
  type ShareResult,
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

describe('clearPlanFromUrl({ includeDeepLinks })', () => {
  afterEach(() => {
    setUrl('http://localhost:3000/');
  });

  it('also drops ?example= and ?view= once the plan they pointed at is replaced', () => {
    setUrl('http://localhost:3000/?example=22&view=sankey&keep=1#gz=abc');
    clearPlanFromUrl({ includeDeepLinks: true });
    expect(window.location.search).toBe('?keep=1');
    expect(window.location.hash).toBe('');
  });

  it('also drops ?node= and ?q=', () => {
    setUrl('http://localhost:3000/?example=22&view=tabular&node=4&q=hash&keep=1');
    clearPlanFromUrl({ includeDeepLinks: true });
    expect(window.location.search).toBe('?keep=1');
  });
});

describe('share payload: view mode + metadata bundles', () => {
  afterEach(() => {
    setUrl('http://localhost:3000/');
  });

  /** Fake builder that records payloads and returns a URL of a chosen length. */
  function recordingBuilder(urlLengthFor: (payload: SharePayload) => number | null) {
    const payloads: SharePayload[] = [];
    const build = async (payload: SharePayload): Promise<ShareResult> => {
      payloads.push(payload);
      const length = urlLengthFor(payload);
      if (length === null) return { ok: false, error: 'too large' };
      return { ok: true, url: `https://x/#gz=${'a'.repeat(length)}` };
    };
    return { build, payloads };
  }

  const bundle = { format: 'ora-plan-metadata', version: 2, plan_ref: { sql_id: 'abc' } };

  it('includes the view mode and bundles when the link stays short', async () => {
    const { build, payloads } = recordingBuilder(() => 500);
    const result = await buildShareLink([{ rawInput: 'plan', metadataBundle: bundle }], { viewMode: 'sankey', build });
    expect(result).toMatchObject({ ok: true, warnings: [] });
    expect(payloads).toHaveLength(1);
    expect(payloads[0].viewMode).toBe('sankey');
    expect(payloads[0].plans[0].metadataBundle).toEqual(bundle);
  });

  it('omits bundles (with a warning) when the link would pass ~32k chars', async () => {
    const { build, payloads } = recordingBuilder((p) =>
      p.plans.some((plan) => plan.metadataBundle) ? SHARE_BUNDLE_MAX_URL_LENGTH + 1 : 1000,
    );
    const result = await buildShareLink([{ rawInput: 'plan', metadataBundle: bundle }], { viewMode: 'flame', build });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.warnings.join(' ')).toMatch(/metadata bundle omitted: too large/i);
    expect(payloads).toHaveLength(2);
    expect(payloads[1].plans[0].metadataBundle).toBeUndefined();
    expect(payloads[1].viewMode).toBe('flame');
  });

  it('falls back to stripped SQL Monitor XML when even the bundle-less link fails', async () => {
    const xml = '<sql_monitor_report><plan_monitor/><other_xml>big</other_xml></sql_monitor_report>';
    const { build, payloads } = recordingBuilder((p) => (p.plans[0].rawInput.includes('<other_xml>') ? null : 100));
    const result = await buildShareLink([{ rawInput: xml }], { build });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.warnings.join(' ')).toMatch(/stripped/);
    expect(payloads[payloads.length - 1].plans[0].rawInput).not.toContain('<other_xml>');
  });

  it('never shares session-only AI views', async () => {
    const { build, payloads } = recordingBuilder(() => 100);
    await buildShareLink([{ rawInput: 'plan' }], { viewMode: 'ai', build });
    expect(payloads[0].viewMode).toBeUndefined();
  });

  it('round-trips view mode and bundle through a real (legacy, jsdom) share URL', async () => {
    setUrl('http://localhost:3000/');
    const result = await buildShareLink([{ rawInput: 'small plan', metadataBundle: bundle }], { viewMode: 'tabular' });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    setUrl(result.url);
    const decoded = getPlanFromUrl();
    expect(decoded?.type).toBe('payload');
    if (decoded?.type === 'payload') {
      expect(getSharedViewMode(decoded.payload)).toBe('tabular');
      expect(decoded.payload.plans[0].metadataBundle).toEqual(bundle);
    }
  });

  it('keeps decoding old payloads without view mode or bundles', () => {
    const decoded = classifyDecodedPlanText(JSON.stringify({ plans: [{ rawInput: 'old plan' }] }));
    expect(decoded.type).toBe('payload');
    if (decoded.type === 'payload') {
      expect(getSharedViewMode(decoded.payload)).toBeNull();
      expect(decoded.payload.plans[0].metadataBundle).toBeUndefined();
    }
  });

  it('ignores unknown or unsafe view modes on decode', () => {
    expect(getSharedViewMode({ plans: [], viewMode: 'ai-report' })).toBeNull();
    expect(getSharedViewMode({ plans: [], viewMode: '<script>' })).toBeNull();
    expect(getSharedViewMode({ plans: [], viewMode: 'compare' })).toBe('compare');
  });
});
