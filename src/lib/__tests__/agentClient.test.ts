import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  AgentError,
  connect,
  disconnect,
  fetchPlan,
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
});
