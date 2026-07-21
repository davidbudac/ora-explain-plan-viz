/**
 * HTTP client for the optional local DB-connect agent (see docs/plans/db-connect-agent.md).
 *
 * This module is the app's only HTTP module. The agent is a small local
 * process the user runs on their own machine; it exposes a localhost HTTP
 * API that this client talks to over `fetch`. Credentials and plan text
 * never touch any server other than the user's own agent.
 *
 * The whole feature is build-time gated via `isDbAgentEnabled()` — it is
 * only ever surfaced when `VITE_ENABLE_DB_AGENT` is set to '1' or 'true' at
 * build time (self-hosted/dev builds). The GitHub Pages build does not set
 * this flag, so none of this code renders anything there.
 */

/** Default base URL the agent listens on (127.0.0.1 only, per its security model). */
export const DEFAULT_AGENT_BASE_URL = 'http://127.0.0.1:8521';

/** Returns true when the DB-connect agent feature was enabled at build time. */
export function isDbAgentEnabled(): boolean {
  const flag = (import.meta.env?.VITE_ENABLE_DB_AGENT ?? '') as string;
  return flag === '1' || flag === 'true';
}

export interface AgentHealth {
  version: string;
  connected: boolean;
  oracleVersion: string | null;
}

export type PlanSource = 'cursor' | 'monitor' | 'awr';

export interface RecentSqlItemCursor {
  sqlId: string;
  childNumber: number;
  planHashValue: number | null;
  sqlText: string;
  elapsedSec: number | null;
  executions: number | null;
  lastActive: string | null;
}

export interface RecentSqlItemMonitor {
  sqlId: string;
  sqlExecId: number | string;
  planHashValue: number | null;
  status: string | null;
  sqlText: string;
  elapsedSec: number | null;
  lastActive: string | null;
}

export type RecentSqlItem = RecentSqlItemCursor | RecentSqlItemMonitor;

export interface ConnectCredentials {
  dsn: string;
  user: string;
  password: string;
}

export interface ConnectResult {
  ok: true;
  oracleVersion: string | null;
}

export interface FetchPlanParams {
  sqlId: string;
  source: PlanSource;
  childNumber?: number;
  sqlExecId?: number | string;
}

export interface FetchPlanResult {
  source: PlanSource;
  text: string;
}

export interface AgentConfig {
  baseUrl: string;
  token: string;
}

/** Error raised for any failed agent request; carries the HTTP status (when known) and server message. */
export class AgentError extends Error {
  status: number | null;

  constructor(message: string, status: number | null = null) {
    super(message);
    this.name = 'AgentError';
    this.status = status;
  }
}

/** Strips a trailing slash so callers can freely mix `http://host:port` and `http://host:port/`. */
export function normalizeBaseUrl(baseUrl: string): string {
  const trimmed = baseUrl.trim();
  return trimmed.endsWith('/') ? trimmed.slice(0, -1) : trimmed;
}

const HEALTH_TIMEOUT_MS = 10_000;
const DEFAULT_TIMEOUT_MS = 10_000;
const PLAN_TIMEOUT_MS = 30_000;

async function request<T>(
  baseUrl: string,
  path: string,
  options: {
    method?: string;
    token?: string;
    body?: unknown;
    query?: Record<string, string | number | undefined>;
    timeoutMs?: number;
  } = {}
): Promise<T> {
  const { method = 'GET', token, body, query, timeoutMs = DEFAULT_TIMEOUT_MS } = options;
  const base = normalizeBaseUrl(baseUrl);

  let url = `${base}${path}`;
  if (query) {
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(query)) {
      if (value !== undefined && value !== null) params.set(key, String(value));
    }
    const qs = params.toString();
    if (qs) url += `?${qs}`;
  }

  const headers: Record<string, string> = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  if (body !== undefined) headers['Content-Type'] = 'application/json';

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  let response: Response;
  try {
    response = await fetch(url, {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal: controller.signal,
    });
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') {
      throw new AgentError(`Agent request to ${base} timed out.`);
    }
    throw new AgentError(`Agent not reachable at ${base}. Is it running?`);
  } finally {
    clearTimeout(timer);
  }

  let data: unknown = null;
  const text = await response.text();
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      // Non-JSON body; leave data null, fall back to status text below.
    }
  }

  if (!response.ok) {
    const message =
      (data && typeof data === 'object' && 'error' in data && typeof (data as { error?: unknown }).error === 'string'
        ? (data as { error: string }).error
        : null) ?? `Agent request failed (${response.status})`;
    throw new AgentError(message, response.status);
  }

  return data as T;
}

/** Probes agent health. No auth header is sent — matches the agent's unauthenticated /api/health. */
export async function health(baseUrl: string): Promise<AgentHealth> {
  return request<AgentHealth>(baseUrl, '/api/health', { timeoutMs: HEALTH_TIMEOUT_MS });
}

export async function connect(config: AgentConfig, creds: ConnectCredentials): Promise<ConnectResult> {
  return request<ConnectResult>(config.baseUrl, '/api/connect', {
    method: 'POST',
    token: config.token,
    body: creds,
  });
}

export async function disconnect(config: AgentConfig): Promise<{ ok: true }> {
  return request<{ ok: true }>(config.baseUrl, '/api/disconnect', {
    method: 'POST',
    token: config.token,
  });
}

export async function recentSql(config: AgentConfig, source: 'cursor' | 'monitor'): Promise<{ items: RecentSqlItem[] }> {
  return request<{ items: RecentSqlItem[] }>(config.baseUrl, '/api/sql/recent', {
    token: config.token,
    query: { source },
  });
}

export async function fetchPlan(config: AgentConfig, params: FetchPlanParams): Promise<FetchPlanResult> {
  return request<FetchPlanResult>(config.baseUrl, '/api/plan', {
    token: config.token,
    timeoutMs: PLAN_TIMEOUT_MS,
    query: {
      sqlId: params.sqlId,
      source: params.source,
      childNumber: params.childNumber,
      sqlExecId: params.sqlExecId,
    },
  });
}

/** Thin object wrapper bundling a fixed AgentConfig with the free functions above, for convenience call sites. */
export class AgentClient {
  private config: AgentConfig;

  constructor(config: AgentConfig) {
    this.config = config;
  }

  health(): Promise<AgentHealth> {
    return health(this.config.baseUrl);
  }

  connect(creds: ConnectCredentials): Promise<ConnectResult> {
    return connect(this.config, creds);
  }

  disconnect(): Promise<{ ok: true }> {
    return disconnect(this.config);
  }

  recentSql(source: 'cursor' | 'monitor'): Promise<{ items: RecentSqlItem[] }> {
    return recentSql(this.config, source);
  }

  fetchPlan(params: FetchPlanParams): Promise<FetchPlanResult> {
    return fetchPlan(this.config, params);
  }
}
