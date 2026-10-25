import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  AGENT_TOKEN_STORAGE_KEY,
  AGENT_URL_STORAGE_KEY,
  AgentError,
  DEFAULT_AGENT_BASE_URL,
  compareAgentVersions,
  connect,
  disconnect,
  fetchMetadata,
  fetchPlan,
  fetchPlanWithMetadata,
  health,
  isDbAgentEnabled,
  loadStoredAgentConfig,
  normalizeBaseUrl,
  recentSql,
  testConnect,
  testDisconnect,
  testExec,
  testExplain,
  verifyToken,
} from '../agent/client';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

const CONFIG = { baseUrl: 'http://127.0.0.1:8521', token: 'tok' };

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

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

  it.each<[string, string, boolean]>([
    ['unset', '', false],
    ['"1"', '1', true],
    ['"true"', 'true', true],
    ['any other value ("0")', '0', false],
  ])('VITE_ENABLE_DB_AGENT %s → %s', (_label, value, expected) => {
    vi.stubEnv('VITE_ENABLE_DB_AGENT', value);
    expect(isDbAgentEnabled()).toBe(expected);
  });
});

describe('agent client', () => {
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

    await disconnect(CONFIG);

    const [, init] = fetchMock.mock.calls[0];
    const headers = init?.headers as Record<string, string>;
    expect(headers.Authorization).toBe('Bearer tok');
  });

  it('recentSql() builds the query string with source', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ items: [] }));

    await recentSql(CONFIG, 'monitor');

    const [url] = fetchMock.mock.calls[0];
    expect(url).toBe('http://127.0.0.1:8521/api/sql/recent?source=monitor');
  });

  it('fetchPlan() builds the query string with sqlId, source and optional params', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ source: 'cursor', text: 'plan text' }));

    await fetchPlan(
      CONFIG,
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
      connect(CONFIG, { dsn: 'x', user: 'y', password: 'z' })
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
      CONFIG,
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

    await fetchMetadata(CONFIG, { sqlId: 'abc123' });

    const parsed = new URL(fetchMock.mock.calls[0][0] as string);
    expect(parsed.searchParams.has('planHash')).toBe(false);
  });
});

describe('fetchPlanWithMetadata', () => {
  const params = { sqlId: 'abc123', source: 'cursor' as const };

  it('returns plan text and the stringified bundle', async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ source: 'cursor', text: 'PLAN' }))
      .mockResolvedValueOnce(jsonResponse({ bundle: { format: 'ora-plan-metadata', version: 2 } }));

    const result = await fetchPlanWithMetadata(CONFIG, params, { attachMetadata: true, planHash: 42 });

    expect(result.text).toBe('PLAN');
    expect(result.metadataError).toBeUndefined();
    expect(JSON.parse(result.metadataText!)).toEqual({ format: 'ora-plan-metadata', version: 2 });
    const metadataUrl = new URL(fetchMock.mock.calls[1][0] as string);
    expect(metadataUrl.searchParams.get('planHash')).toBe('42');
  });

  it('skips the metadata request when attachMetadata is false', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ source: 'cursor', text: 'PLAN' }));

    const result = await fetchPlanWithMetadata(CONFIG, params, { attachMetadata: false });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(result.metadataText).toBeUndefined();
    expect(result.metadataError).toBeUndefined();
  });

  it('degrades to a plain plan with metadataError when the gather fails', async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ source: 'cursor', text: 'PLAN' }))
      .mockResolvedValueOnce(jsonResponse({ error: 'Not connected to a database' }, 409));

    const result = await fetchPlanWithMetadata(CONFIG, params, { attachMetadata: true });

    expect(result.text).toBe('PLAN');
    expect(result.metadataText).toBeUndefined();
    expect(result.metadataError).toBe('Not connected to a database');
  });

  it('still rejects when the plan fetch itself fails', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ error: 'No plan found for the given sql_id' }, 404));

    await expect(
      fetchPlanWithMetadata(CONFIG, params, { attachMetadata: true })
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
});

describe('verifyToken', () => {
  it('probes /api/test/log with the Bearer token and resolves true on 200', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ entries: [] }));

    await expect(verifyToken(CONFIG)).resolves.toBe(true);

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('http://127.0.0.1:8521/api/test/log');
    expect((init?.headers as Record<string, string>).Authorization).toBe('Bearer tok');
  });

  it('treats 404 (agent < 0.2.0, token already accepted) as valid', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ error: 'Not found' }, 404));
    await expect(verifyToken(CONFIG)).resolves.toBe(true);
  });

  it('resolves false on 401', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ error: 'Missing or invalid bearer token' }, 401));
    await expect(verifyToken(CONFIG)).resolves.toBe(false);
  });

  it('rethrows other failures (server error, unreachable agent)', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ error: 'boom' }, 500));
    await expect(verifyToken(CONFIG)).rejects.toMatchObject({ name: 'AgentError', status: 500 });

    fetchMock.mockRejectedValueOnce(new TypeError('Failed to fetch'));
    await expect(verifyToken(CONFIG)).rejects.toMatchObject({ name: 'AgentError', status: null });
  });
});

describe('agent test-connection API', () => {
  it('testConnect() POSTs the credentials with a Bearer token', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ ok: true, oracleVersion: '23ai' }));

    const result = await testConnect(CONFIG, { dsn: '//host:1521/scratch', user: 'eval', password: 'pw' });

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('http://127.0.0.1:8521/api/test/connect');
    expect(init?.method).toBe('POST');
    expect((init?.headers as Record<string, string>).Authorization).toBe('Bearer tok');
    expect(JSON.parse(init?.body as string)).toEqual({ dsn: '//host:1521/scratch', user: 'eval', password: 'pw' });
    expect(result).toEqual({ ok: true, oracleVersion: '23ai' });
  });

  it('testExec() POSTs the script and returns ok/output/errors', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ ok: true, output: 'Table created.', errors: [] }));

    const result = await testExec(CONFIG, { script: 'CREATE TABLE t (id NUMBER);' });

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('http://127.0.0.1:8521/api/test/exec');
    expect(init?.method).toBe('POST');
    expect(JSON.parse(init?.body as string)).toEqual({ script: 'CREATE TABLE t (id NUMBER);' });
    expect(result).toEqual({ ok: true, output: 'Table created.', errors: [] });
  });

  it('testExplain() POSTs the sql and returns the DBMS_XPLAN text', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ dbmsXplanText: 'Plan hash value: 1' }));

    const result = await testExplain(CONFIG, { sql: 'SELECT 1 FROM dual' });

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('http://127.0.0.1:8521/api/test/explain');
    expect(JSON.parse(init?.body as string)).toEqual({ sql: 'SELECT 1 FROM dual' });
    expect(result.dbmsXplanText).toBe('Plan hash value: 1');
  });

  it('testDisconnect() POSTs with a Bearer token', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ ok: true }));

    await testDisconnect(CONFIG);

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('http://127.0.0.1:8521/api/test/disconnect');
    expect(init?.method).toBe('POST');
    expect((init?.headers as Record<string, string>).Authorization).toBe('Bearer tok');
  });
});

describe('loadStoredAgentConfig', () => {
  afterEach(() => {
    localStorage.removeItem(AGENT_URL_STORAGE_KEY);
    sessionStorage.removeItem(AGENT_TOKEN_STORAGE_KEY);
  });

  it('falls back to the default base URL and empty token', () => {
    expect(loadStoredAgentConfig()).toEqual({ baseUrl: DEFAULT_AGENT_BASE_URL, token: '' });
  });

  it('reads and normalizes what ConnectPanel stored', () => {
    localStorage.setItem(AGENT_URL_STORAGE_KEY, 'http://127.0.0.1:9999/');
    sessionStorage.setItem(AGENT_TOKEN_STORAGE_KEY, 'secret');
    expect(loadStoredAgentConfig()).toEqual({ baseUrl: 'http://127.0.0.1:9999', token: 'secret' });
  });
});
