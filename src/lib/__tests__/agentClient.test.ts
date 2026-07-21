import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  AgentError,
  MIN_AGENT_VERSION,
  compareAgentVersions,
  connect,
  disconnect,
  fetchMetadata,
  fetchPlan,
  fetchPlanWithMetadata,
  health,
  isDbAgentEnabled,
  normalizeBaseUrl,
  recentSql,
} from '../agent/client';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('normalizeBaseUrl', () => {
  it('strips a trailing slash', () => {
    expect(normalizeBaseUrl('http://127.0.0.1:8521/')).toBe('http://127.0.0.1:8521');
  });

  it('leaves a URL without a trailing slash unchanged', () => {
    expect(normalizeBaseUrl('http://127.0.0.1:8521')).toBe('http://127.0.0.1:8521');
  });

  it('trims surrounding whitespace', () => {
    expect(normalizeBaseUrl('  http://127.0.0.1:8521/  ')).toBe('http://127.0.0.1:8521');
  });
});

describe('isDbAgentEnabled', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('is false when VITE_ENABLE_DB_AGENT is unset', () => {
    vi.stubEnv('VITE_ENABLE_DB_AGENT', '');
    expect(isDbAgentEnabled()).toBe(false);
  });

  it('is true when VITE_ENABLE_DB_AGENT is "1"', () => {
    vi.stubEnv('VITE_ENABLE_DB_AGENT', '1');
    expect(isDbAgentEnabled()).toBe(true);
  });

  it('is true when VITE_ENABLE_DB_AGENT is "true"', () => {
    vi.stubEnv('VITE_ENABLE_DB_AGENT', 'true');
    expect(isDbAgentEnabled()).toBe(true);
  });

  it('is false for other values', () => {
    vi.stubEnv('VITE_ENABLE_DB_AGENT', '0');
    expect(isDbAgentEnabled()).toBe(false);
  });
});

describe('agent client', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('health() sends no Authorization header', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ version: '0.1.0', connected: false, oracleVersion: null }));

    const result = await health('http://127.0.0.1:8521/');

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('http://127.0.0.1:8521/api/health');
    const headers = init?.headers as Record<string, string> | undefined;
    expect(headers?.Authorization).toBeUndefined();
    expect(result).toEqual({ version: '0.1.0', connected: false, oracleVersion: null });
  });

  it('connect() sends a Bearer token and the credentials body', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ ok: true, oracleVersion: '19c' }));

    const result = await connect(
      { baseUrl: 'http://127.0.0.1:8521', token: 'secret-token' },
      { dsn: '//host:1521/pdb1', user: 'app', password: 'pw' }
    );

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('http://127.0.0.1:8521/api/connect');
    expect(init?.method).toBe('POST');
    const headers = init?.headers as Record<string, string>;
    expect(headers.Authorization).toBe('Bearer secret-token');
    expect(JSON.parse(init?.body as string)).toEqual({ dsn: '//host:1521/pdb1', user: 'app', password: 'pw' });
    expect(result).toEqual({ ok: true, oracleVersion: '19c' });
  });

  it('disconnect() sends a Bearer token', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ ok: true }));

    await disconnect({ baseUrl: 'http://127.0.0.1:8521', token: 'tok' });

    const [, init] = fetchMock.mock.calls[0];
    const headers = init?.headers as Record<string, string>;
    expect(headers.Authorization).toBe('Bearer tok');
  });

  it('recentSql() builds the query string with source', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ items: [] }));

    await recentSql({ baseUrl: 'http://127.0.0.1:8521', token: 'tok' }, 'monitor');

    const [url] = fetchMock.mock.calls[0];
    expect(url).toBe('http://127.0.0.1:8521/api/sql/recent?source=monitor');
  });

  it('fetchPlan() builds the query string with sqlId, source and optional params', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ source: 'cursor', text: 'plan text' }));

    await fetchPlan(
      { baseUrl: 'http://127.0.0.1:8521', token: 'tok' },
      { sqlId: 'abc123', source: 'cursor', childNumber: 2 }
    );

    const [url] = fetchMock.mock.calls[0];
    const parsed = new URL(url as string);
    expect(parsed.pathname).toBe('/api/plan');
    expect(parsed.searchParams.get('sqlId')).toBe('abc123');
    expect(parsed.searchParams.get('source')).toBe('cursor');
    expect(parsed.searchParams.get('childNumber')).toBe('2');
  });

  it('surfaces the server error message via AgentError on a non-OK response', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ error: 'invalid credentials' }, 401));

    await expect(
      connect({ baseUrl: 'http://127.0.0.1:8521', token: 'tok' }, { dsn: 'x', user: 'y', password: 'z' })
    ).rejects.toMatchObject({
      name: 'AgentError',
      message: 'invalid credentials',
      status: 401,
    });
  });

  it('wraps a network failure in a friendly AgentError', async () => {
    fetchMock.mockRejectedValue(new TypeError('Failed to fetch'));

    await expect(health('http://127.0.0.1:8521')).rejects.toBeInstanceOf(AgentError);
    await expect(health('http://127.0.0.1:8521')).rejects.toThrow(/not reachable/i);
  });

  it('fetchMetadata() builds the query string and sends the token', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ bundle: { format: 'ora-plan-metadata' } }));

    const result = await fetchMetadata(
      { baseUrl: 'http://127.0.0.1:8521', token: 'tok' },
      { sqlId: 'abc123', planHash: 987654321 }
    );

    const [url, init] = fetchMock.mock.calls[0];
    const parsed = new URL(url as string);
    expect(parsed.pathname).toBe('/api/metadata');
    expect(parsed.searchParams.get('sqlId')).toBe('abc123');
    expect(parsed.searchParams.get('planHash')).toBe('987654321');
    expect((init?.headers as Record<string, string>).Authorization).toBe('Bearer tok');
    expect(result.bundle).toEqual({ format: 'ora-plan-metadata' });
  });

  it('fetchMetadata() omits planHash when not given', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ bundle: {} }));

    await fetchMetadata({ baseUrl: 'http://127.0.0.1:8521', token: 'tok' }, { sqlId: 'abc123' });

    const parsed = new URL(fetchMock.mock.calls[0][0] as string);
    expect(parsed.searchParams.has('planHash')).toBe(false);
  });
});

describe('fetchPlanWithMetadata', () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  const config = { baseUrl: 'http://127.0.0.1:8521', token: 'tok' };
  const params = { sqlId: 'abc123', source: 'cursor' as const };

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('returns plan text and the stringified bundle', async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ source: 'cursor', text: 'PLAN' }))
      .mockResolvedValueOnce(jsonResponse({ bundle: { format: 'ora-plan-metadata', version: 2 } }));

    const result = await fetchPlanWithMetadata(config, params, { attachMetadata: true, planHash: 42 });

    expect(result.text).toBe('PLAN');
    expect(result.metadataError).toBeUndefined();
    expect(JSON.parse(result.metadataText!)).toEqual({ format: 'ora-plan-metadata', version: 2 });
    const metadataUrl = new URL(fetchMock.mock.calls[1][0] as string);
    expect(metadataUrl.searchParams.get('planHash')).toBe('42');
  });

  it('skips the metadata request when attachMetadata is false', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ source: 'cursor', text: 'PLAN' }));

    const result = await fetchPlanWithMetadata(config, params, { attachMetadata: false });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(result.metadataText).toBeUndefined();
    expect(result.metadataError).toBeUndefined();
  });

  it('degrades to a plain plan with metadataError when the gather fails', async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ source: 'cursor', text: 'PLAN' }))
      .mockResolvedValueOnce(jsonResponse({ error: 'Not connected to a database' }, 409));

    const result = await fetchPlanWithMetadata(config, params, { attachMetadata: true });

    expect(result.text).toBe('PLAN');
    expect(result.metadataText).toBeUndefined();
    expect(result.metadataError).toBe('Not connected to a database');
  });

  it('still rejects when the plan fetch itself fails', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ error: 'No plan found for the given sql_id' }, 404));

    await expect(
      fetchPlanWithMetadata(config, params, { attachMetadata: true })
    ).rejects.toMatchObject({ name: 'AgentError', status: 404 });
  });
});

describe('compareAgentVersions', () => {
  it('orders dotted versions numerically', () => {
    expect(compareAgentVersions('0.1.0', '0.1.0')).toBe(0);
    expect(compareAgentVersions('0.0.9', '0.1.0')).toBeLessThan(0);
    expect(compareAgentVersions('0.2.0', '0.1.9')).toBeGreaterThan(0);
    expect(compareAgentVersions('0.10.0', '0.9.0')).toBeGreaterThan(0);
    expect(compareAgentVersions('1.0', '1.0.1')).toBeLessThan(0);
  });

  it('current MIN_AGENT_VERSION is a valid dotted version', () => {
    expect(MIN_AGENT_VERSION).toMatch(/^\d+\.\d+\.\d+$/);
  });
});
