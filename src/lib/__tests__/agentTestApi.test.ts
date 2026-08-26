import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  AGENT_TOKEN_STORAGE_KEY,
  AGENT_URL_STORAGE_KEY,
  DEFAULT_AGENT_BASE_URL,
  loadStoredAgentConfig,
  testConnect,
  testDisconnect,
  testExec,
  testExplain,
} from '../agent/client';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

const CONFIG = { baseUrl: 'http://127.0.0.1:8521', token: 'tok' };

describe('agent test-connection API', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

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

  it('surfaces the server error message via AgentError on a non-OK response', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ error: 'test connection not open' }, 409));

    await expect(testExec(CONFIG, { script: 'SELECT 1 FROM dual;' })).rejects.toMatchObject({
      name: 'AgentError',
      message: 'test connection not open',
      status: 409,
    });
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
