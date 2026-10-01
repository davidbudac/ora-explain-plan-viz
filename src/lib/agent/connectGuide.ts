/**
 * Pure helpers behind the guided DB-connect walkthrough (ConnectPanel):
 * the commands to show, the step-status state machine, and friendly error text.
 */
import { AgentError, DEFAULT_AGENT_BASE_URL } from './client';

/** Origins the connector accepts out of the box (the Vite dev server). */
export const DEFAULT_AGENT_ALLOWED_ORIGINS = ['http://localhost:5173', 'http://127.0.0.1:5173'];

/** The connector is not on PyPI yet — install straight from GitHub. */
export const AGENT_INSTALL_COMMAND =
  'pipx install git+https://github.com/davidbudac/oraplanviz-db-connector.git';

export const AGENT_DOCS_URL = 'https://github.com/davidbudac/oraplanviz-db-connector#quick-start';

const DEFAULT_PORT = '8521';

/** Port of `baseUrl`, or the connector default when it can't be parsed. */
function portOf(baseUrl: string): string {
  try {
    const url = new URL(baseUrl.trim());
    if (url.port) return url.port;
    return url.protocol === 'https:' ? '443' : '80';
  } catch {
    return DEFAULT_PORT;
  }
}

/** `host:port` of `baseUrl` for display; falls back to the raw text for unparseable URLs. */
export function agentHostLabel(baseUrl: string): string {
  try {
    return new URL(baseUrl.trim()).host || baseUrl.trim();
  } catch {
    return baseUrl.trim() || DEFAULT_AGENT_BASE_URL.replace(/^https?:\/\//, '');
  }
}

function isUsableOrigin(origin: string): boolean {
  const o = origin.trim();
  return o !== '' && o !== 'null';
}

/**
 * Command that starts the connector for this page: adds `--port` when the
 * agent URL isn't on the default port, and `--allow-origin` when this page's
 * origin isn't one the connector allows by default.
 */
export function buildAgentStartCommand(appOrigin: string, baseUrl: string): string {
  let cmd = 'oraplanviz-agent';
  const port = portOf(baseUrl);
  if (port !== DEFAULT_PORT) cmd += ` --port ${port}`;
  const origin = appOrigin.trim();
  if (isUsableOrigin(origin) && !DEFAULT_AGENT_ALLOWED_ORIGINS.includes(origin)) {
    cmd += ` --allow-origin ${origin}`;
  }
  return cmd;
}

export type StepStatus = 'done' | 'current' | 'locked' | 'error';
export type TokenStatus = 'unknown' | 'checking' | 'valid' | 'invalid';
export type ConnectStepId = 'agent' | 'token' | 'database' | 'plan';

export interface ConnectStepsInput {
  /** null = still probing for the first time. */
  agentReachable: boolean | null;
  agentOutdated: boolean;
  tokenStatus: TokenStatus;
  dbConnected: boolean;
}

/**
 * Status of each walkthrough step. A step is only `current` once every earlier
 * step is `done`; later steps stay `locked`. An outdated agent still counts as
 * reachable (the warning is informational — plans load, metadata doesn't).
 * A connector that isn't reachable yet (not started, or still probing) is a
 * waiting state, not a failure: step 1 stays `current`, never `error`. `error`
 * is reserved for genuinely rejected input (e.g. a rejected token).
 */
export function computeConnectSteps(input: ConnectStepsInput): Record<ConnectStepId, StepStatus> {
  const { agentReachable, tokenStatus, dbConnected } = input;

  const agent: StepStatus = agentReachable === true ? 'done' : 'current';
  if (agent !== 'done') {
    return { agent, token: 'locked', database: 'locked', plan: 'locked' };
  }

  const token: StepStatus = tokenStatus === 'valid' ? 'done' : tokenStatus === 'invalid' ? 'error' : 'current';
  if (token !== 'done') {
    return { agent, token, database: 'locked', plan: 'locked' };
  }

  const database: StepStatus = dbConnected ? 'done' : 'current';
  if (database !== 'done') {
    return { agent, token, database, plan: 'locked' };
  }

  return { agent, token, database, plan: 'current' };
}

export interface AgentErrorContext {
  /** Agent base URL the request went to. */
  baseUrl: string;
  /** This page's origin (what the connector must allow via --allow-origin). */
  origin: string;
}

/** Friendly, actionable text for the failures first-time users actually hit. */
export function describeAgentError(err: unknown, ctx: AgentErrorContext): string {
  const message = err instanceof Error ? err.message : typeof err === 'string' ? err : '';
  const status = err instanceof AgentError ? err.status : null;

  if (status === 401) {
    return "The connector rejected the token — copy the 'Bearer token' line from its terminal again (it changes every restart unless you pass --token).";
  }

  const networkFailure = err instanceof TypeError || (err instanceof AgentError && status === null);
  if (networkFailure) {
    const origin = isUsableOrigin(ctx.origin) ? ctx.origin.trim() : '<this page\'s origin>';
    return `Can't reach the connector at ${ctx.baseUrl.trim()}. Is it running? If it is, it may not allow this page's origin — restart it with --allow-origin ${origin}.`;
  }

  if (/ORA-01017/i.test(message)) {
    return `Oracle rejected the username or password (ORA-01017). Double-check both and try again.${tail(message)}`;
  }
  if (/ORA-12514|ORA-12541|ORA-12154|ORA-12504|ORA-12545|DPY-6001|DPY-6005|DPY-6003|DPY-4026/i.test(message)) {
    return `The connector couldn't reach the database. Check the host, port and service name in the DSN (format host:1521/service_name).${tail(message)}`;
  }

  return message || 'Something went wrong talking to the connector.';
}

function tail(message: string): string {
  return message ? ` (${message})` : '';
}
