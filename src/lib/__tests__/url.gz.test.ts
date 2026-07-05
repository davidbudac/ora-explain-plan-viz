// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { gzipSync, gunzipSync } from 'zlib';
import {
  encodeGzipPlanParam,
  decodeGzipPlanParam,
  classifyDecodedPlanText,
} from '../url';

function readExample(filename: string): string {
  return readFileSync(join(__dirname, '../../examples', filename), 'utf-8');
}

function base64UrlFromBuffer(buffer: Buffer): string {
  return buffer.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

describe('encodeGzipPlanParam / decodeGzipPlanParam roundtrip', () => {
  it('roundtrips a small DBMS_XPLAN fixture', async () => {
    const text = readExample('01-dbms_xplan-Simple Plan.txt');
    const encoded = await encodeGzipPlanParam(text);
    const decoded = await decodeGzipPlanParam(encoded);
    expect(decoded).toBe(text);
  });

  it('roundtrips the large 37KB SQL Monitor example (exercises chunked btoa)', async () => {
    const text = readExample('27-sql_monitor-Partitioned Star Query.txt');
    expect(text.length).toBeGreaterThan(30_000);
    const encoded = await encodeGzipPlanParam(text);
    const decoded = await decodeGzipPlanParam(encoded);
    expect(decoded).toBe(text);
    // Sanity: gzip should meaningfully shrink the encoded payload vs raw text.
    expect(encoded.length).toBeLessThan(text.length);
  });

  it('roundtrips a multibyte UTF-8 string', async () => {
    const text = 'SELECT * FROM tábüle WHERE näme = \'日本語\' -- emoji 🚀 test';
    const encoded = await encodeGzipPlanParam(text);
    const decoded = await decodeGzipPlanParam(encoded);
    expect(decoded).toBe(text);
  });

  it('roundtrips a JSON SharePayload', async () => {
    const payload = {
      plans: [
        { rawInput: readExample('01-dbms_xplan-Simple Plan.txt') },
        { rawInput: 'plan B text', annotations: { version: 1, nodes: {} } },
      ],
    };
    const json = JSON.stringify(payload);
    const encoded = await encodeGzipPlanParam(json);
    const decoded = await decodeGzipPlanParam(encoded);
    expect(decoded).toBe(json);
    expect(JSON.parse(decoded)).toEqual(payload);
  });

  it('produces a base64url-safe string (no +, /, or = characters)', async () => {
    const text = readExample('27-sql_monitor-Partitioned Star Query.txt');
    const encoded = await encodeGzipPlanParam(text);
    expect(encoded).toMatch(/^[A-Za-z0-9_-]+$/);
  });
});

describe('cross-check with node:zlib (RFC-1952 gzip compatibility)', () => {
  it('decodeGzipPlanParam decodes payloads produced by node:zlib gzipSync', async () => {
    const text = readExample('01-dbms_xplan-Simple Plan.txt');
    const gzipped = gzipSync(Buffer.from(text, 'utf-8'));
    const encoded = base64UrlFromBuffer(gzipped);
    const decoded = await decodeGzipPlanParam(encoded);
    expect(decoded).toBe(text);
  });

  it('output of encodeGzipPlanParam can be gunzipped with node:zlib', async () => {
    const text = readExample('01-dbms_xplan-Simple Plan.txt');
    const encoded = await encodeGzipPlanParam(text);
    const base64 = encoded.replace(/-/g, '+').replace(/_/g, '/');
    const padded = base64 + '='.repeat((4 - (base64.length % 4)) % 4);
    const buffer = Buffer.from(padded, 'base64');
    const decompressed = gunzipSync(buffer).toString('utf-8');
    expect(decompressed).toBe(text);
  });
});

describe('decodeGzipPlanParam rejects corrupt input', () => {
  it('rejects invalid characters', async () => {
    await expect(decodeGzipPlanParam('not valid base64url!!!')).rejects.toThrow();
  });

  it('rejects empty string', async () => {
    await expect(decodeGzipPlanParam('')).rejects.toThrow();
  });

  it('rejects truncated gzip data', async () => {
    const text = readExample('01-dbms_xplan-Simple Plan.txt');
    const encoded = await encodeGzipPlanParam(text);
    const truncated = encoded.slice(0, Math.floor(encoded.length / 2));
    await expect(decodeGzipPlanParam(truncated)).rejects.toThrow();
  });

  it('rejects non-gzip bytes that are otherwise valid base64url', async () => {
    const notGzip = base64UrlFromBuffer(Buffer.from('this is definitely not gzip data', 'utf-8'));
    await expect(decodeGzipPlanParam(notGzip)).rejects.toThrow();
  });
});

describe('classifyDecodedPlanText', () => {
  it('classifies JSON with a plans array as a payload', () => {
    const json = JSON.stringify({ plans: [{ rawInput: 'foo' }] });
    const result = classifyDecodedPlanText(json);
    expect(result.type).toBe('payload');
    if (result.type === 'payload') {
      expect(result.payload.plans).toHaveLength(1);
      expect(result.payload.plans[0].rawInput).toBe('foo');
    }
  });

  it('classifies other JSON (no plans array) as legacy text', () => {
    const json = JSON.stringify({ foo: 'bar' });
    const result = classifyDecodedPlanText(json);
    expect(result.type).toBe('legacy');
    if (result.type === 'legacy') {
      expect(result.planText).toBe(json);
    }
  });

  it('classifies raw plain text as legacy', () => {
    const text = 'Plan hash value: 1234567890\n\nSELECT STATEMENT';
    const result = classifyDecodedPlanText(text);
    expect(result.type).toBe('legacy');
    if (result.type === 'legacy') {
      expect(result.planText).toBe(text);
    }
  });
});
