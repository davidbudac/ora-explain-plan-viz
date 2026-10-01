import { useCallback, useEffect, useRef, useState } from 'react';
import type { KeyboardEvent, ReactNode } from 'react';
import { usePlan } from '../hooks/usePlanContext';
import {
  AGENT_TOKEN_STORAGE_KEY,
  AGENT_URL_STORAGE_KEY,
  AgentError,
  DEFAULT_AGENT_BASE_URL,
  MIN_AGENT_VERSION,
  compareAgentVersions,
  connect as agentConnect,
  disconnect as agentDisconnect,
  fetchPlanWithMetadata,
  health as agentHealth,
  normalizeBaseUrl,
  recentSql as agentRecentSql,
  testConnect as agentTestConnect,
  testDisconnect as agentTestDisconnect,
  verifyToken as agentVerifyToken,
  type AgentHealth,
  type FetchPlanParams,
  type PlanSource,
  type RecentSqlItem,
} from '../lib/agent/client';
import {
  AGENT_DOCS_URL,
  AGENT_INSTALL_COMMAND,
  agentHostLabel,
  buildAgentStartCommand,
  computeConnectSteps,
  describeAgentError,
  type StepStatus,
  type TokenStatus,
} from '../lib/agent/connectGuide';
import { CopyButton, FOCUS_RING } from './ui';

const POLL_INTERVAL_MS = 3000;
const TOKEN_VERIFY_DEBOUNCE_MS = 400;

function loadStoredBaseUrl(): string {
  try {
    return localStorage.getItem(AGENT_URL_STORAGE_KEY) || DEFAULT_AGENT_BASE_URL;
  } catch {
    return DEFAULT_AGENT_BASE_URL;
  }
}

function loadStoredToken(): string {
  try {
    return sessionStorage.getItem(AGENT_TOKEN_STORAGE_KEY) || '';
  } catch {
    return '';
  }
}

function isCursorItem(item: RecentSqlItem): item is Extract<RecentSqlItem, { childNumber: number }> {
  return 'childNumber' in item;
}

function formatElapsed(sec: number | null): string {
  if (sec == null) return '—';
  if (sec < 1) return `${Math.round(sec * 1000)}ms`;
  return `${sec.toFixed(1)}s`;
}

function pageOrigin(): string {
  try {
    return window.location.origin;
  } catch {
    return '';
  }
}

/** Host (and port) of the page the app is served from, for the flow diagram. */
function pageHost(): string {
  try {
    return window.location.host || 'this page';
  } catch {
    return 'this page';
  }
}

// --- Style recipes (compact: this panel lives in the top input drawer) ---

const inputClass =
  'h-8 px-2 text-xs bg-white dark:bg-slate-950 border border-slate-200 dark:border-slate-700 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500/60 text-slate-900 dark:text-slate-100 placeholder-slate-400 dark:placeholder-slate-500 disabled:opacity-60';
const labelClass = 'text-[11px] font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wide';
const hintClass = 'text-[11px] text-slate-500 dark:text-slate-400';
const buttonClass = `h-8 px-3 text-xs border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-300 rounded-md hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors font-semibold disabled:opacity-50 disabled:cursor-not-allowed ${FOCUS_RING}`;
const primaryButtonClass = `h-8 px-3 text-xs bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors font-semibold ${FOCUS_RING}`;
const linkButtonClass = `text-[11px] font-semibold text-blue-600 dark:text-blue-400 underline-offset-2 hover:underline rounded ${FOCUS_RING}`;
const errorTextClass = 'text-xs text-red-600 dark:text-red-400 break-words [overflow-wrap:anywhere]';
const warnTextClass = 'text-xs text-amber-700 dark:text-amber-400 break-words [overflow-wrap:anywhere]';
const okTextClass = 'text-xs text-emerald-700 dark:text-emerald-400';

function onEnter(handler: () => void) {
  return (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      handler();
    }
  };
}

// --- Small presentational pieces ---

type Tone = 'unknown' | 'ok' | 'warn' | 'error';

const BOX_TONES: Record<Tone, string> = {
  unknown: 'border-slate-200 bg-white text-slate-500 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-400',
  ok: 'border-emerald-300 bg-emerald-50 text-emerald-800 dark:border-emerald-700/60 dark:bg-emerald-950/40 dark:text-emerald-300',
  warn: 'border-amber-300 bg-amber-50 text-amber-800 dark:border-amber-700/60 dark:bg-amber-950/40 dark:text-amber-300',
  error: 'border-red-300 bg-red-50 text-red-800 dark:border-red-700/60 dark:bg-red-950/40 dark:text-red-300',
};

const ARROW_TONES: Record<Tone, string> = {
  unknown: 'text-slate-300 dark:text-slate-600',
  ok: 'text-emerald-500 dark:text-emerald-400',
  warn: 'text-amber-500 dark:text-amber-400',
  error: 'text-red-500 dark:text-red-400',
};

function DiagramBox({ tone, title, detail }: { tone: Tone; title: string; detail: string }) {
  return (
    <div className={`min-w-0 flex-1 rounded-md border px-2 py-1 text-center leading-tight ${BOX_TONES[tone]}`}>
      <div className="truncate text-[11px] font-semibold">{title}</div>
      <div className="truncate text-[10px] opacity-80">{detail}</div>
    </div>
  );
}

function DiagramArrow({ tone }: { tone: Tone }) {
  return (
    <span aria-hidden="true" className={`shrink-0 text-sm font-bold ${ARROW_TONES[tone]}`}>
      ⇄
    </span>
  );
}

function CommandBlock({ command }: { command: string }) {
  return (
    <div className="flex items-center gap-1 rounded-md border border-slate-200 bg-white py-0.5 pl-2 pr-1 dark:border-slate-700 dark:bg-slate-900">
      <code className="min-w-0 flex-1 select-all break-all font-mono text-[11px] text-slate-800 dark:text-slate-200">
        {command}
      </code>
      <CopyButton text={command} />
    </div>
  );
}

const MARKER_TONES: Record<StepStatus, string> = {
  done: 'border-emerald-500 bg-emerald-500 text-white dark:border-emerald-400 dark:bg-emerald-400 dark:text-slate-950',
  current: 'border-blue-600 bg-blue-600 text-white dark:border-blue-400 dark:bg-blue-400 dark:text-slate-950',
  error: 'border-red-500 bg-red-500 text-white dark:border-red-400 dark:bg-red-400 dark:text-slate-950',
  locked: 'border-slate-300 bg-transparent text-slate-400 dark:border-slate-700 dark:text-slate-600',
};

const STATUS_LABELS: Record<StepStatus, string> = {
  done: 'done',
  current: 'current step',
  error: 'needs attention',
  locked: 'locked',
};

function StepItem({
  index,
  title,
  status,
  last = false,
  children,
}: {
  index: number;
  title: string;
  status: StepStatus;
  last?: boolean;
  children: ReactNode;
}) {
  const marker = status === 'done' ? '✓' : status === 'error' ? '!' : String(index);
  return (
    <li
      className="flex gap-2"
      aria-current={status === 'current' || status === 'error' ? 'step' : undefined}
      data-step={index}
      data-status={status}
    >
      <div className="flex shrink-0 flex-col items-center">
        <span
          role="img"
          aria-label={`Step ${index}, ${STATUS_LABELS[status]}`}
          className={`flex h-5 w-5 items-center justify-center rounded-full border text-[11px] font-bold ${MARKER_TONES[status]}`}
        >
          {marker}
        </span>
        {!last && (
          <span
            aria-hidden="true"
            className={`mt-0.5 w-px flex-1 ${status === 'done' ? 'bg-emerald-300 dark:bg-emerald-700' : 'bg-slate-200 dark:bg-slate-700'}`}
          />
        )}
      </div>
      <div className={`min-w-0 flex-1 ${last ? '' : 'pb-3'}`}>
        <div
          className={`text-xs font-semibold leading-5 ${status === 'locked' ? 'text-slate-400 dark:text-slate-600' : 'text-slate-800 dark:text-slate-100'}`}
        >
          {title}
        </div>
        {status === 'locked' ? (
          <div className="text-[11px] text-slate-400 dark:text-slate-600">Complete step {index - 1} first</div>
        ) : (
          <div className="mt-1 flex flex-col gap-1.5">{children}</div>
        )}
      </div>
    </li>
  );
}

type PickTab = 'recent' | 'sqlid';

export function ConnectPanel() {
  const { loadAndParsePlan } = usePlan();

  const [baseUrl, setBaseUrl] = useState(loadStoredBaseUrl);
  const [token, setToken] = useState(loadStoredToken);
  const [showToken, setShowToken] = useState(false);
  const [editingToken, setEditingToken] = useState(false);
  const [showSetup, setShowSetup] = useState(false);

  // Step 1 — agent reachability
  const [healthState, setHealthState] = useState<AgentHealth | null>(null);
  const [healthErr, setHealthErr] = useState<unknown>(null);
  const [agentReachable, setAgentReachable] = useState<boolean | null>(null);
  const [healthLoading, setHealthLoading] = useState(false);

  // Step 2 — token check, keyed by the (url, token) pair it was run for so a
  // stale verdict can never unlock steps for a token that has since changed.
  const [tokenCheck, setTokenCheck] = useState<{ key: string; status: 'checking' | 'valid' | 'invalid' } | null>(null);
  const [tokenErr, setTokenErr] = useState<string | null>(null);

  // Step 3 — database connection
  const [dsn, setDsn] = useState('');
  const [dbUser, setDbUser] = useState('');
  const [dbPassword, setDbPassword] = useState('');
  const [localConnected, setLocalConnected] = useState(false);
  const [localOracleVersion, setLocalOracleVersion] = useState<string | null>(null);
  const [connectError, setConnectError] = useState<string | null>(null);
  const [connectLoading, setConnectLoading] = useState(false);

  // Step 4 — statement picking
  const [pickTab, setPickTab] = useState<PickTab>('recent');
  const [source, setSource] = useState<'cursor' | 'monitor'>('cursor');
  const [items, setItems] = useState<RecentSqlItem[]>([]);
  const [recentError, setRecentError] = useState<string | null>(null);
  const [recentLoading, setRecentLoading] = useState(false);
  const [recentLoaded, setRecentLoaded] = useState(false);
  const [loadingRowKey, setLoadingRowKey] = useState<string | null>(null);

  const [manualSqlId, setManualSqlId] = useState('');
  const [manualSource, setManualSource] = useState<PlanSource>('cursor');
  const [manualChildNumber, setManualChildNumber] = useState('');
  const [manualLoading, setManualLoading] = useState(false);
  const [manualError, setManualError] = useState<string | null>(null);

  const [loadedSqlId, setLoadedSqlId] = useState<string | null>(null);

  // Separate TEST connection (scratch DB for AI-proposed scripts) — distinct
  // from the read-only source connection above; see /api/test/* in client.ts.
  const [testDsn, setTestDsn] = useState('');
  const [testUser, setTestUser] = useState('');
  const [testPassword, setTestPassword] = useState('');
  const [testConnected, setTestConnected] = useState(false);
  const [testOracleVersion, setTestOracleVersion] = useState<string | null>(null);
  const [testConnectError, setTestConnectError] = useState<string | null>(null);
  const [testConnectLoading, setTestConnectLoading] = useState(false);

  const [attachMetadata, setAttachMetadata] = useState(true);
  // Non-blocking: set when a plan loaded fine but its metadata gather failed.
  const [metadataNotice, setMetadataNotice] = useState<string | null>(null);

  // Drop outcomes tied to the previous URL/token (errors, notices, the
  // "Loaded …" line) as soon as either changes — adjusting state during render
  // rather than in an effect, so stale text never paints.
  const credentialsKey = `${baseUrl}\n${token}`;
  const [seenCredentialsKey, setSeenCredentialsKey] = useState(credentialsKey);
  if (seenCredentialsKey !== credentialsKey) {
    setSeenCredentialsKey(credentialsKey);
    setConnectError(null);
    setRecentError(null);
    setManualError(null);
    setTestConnectError(null);
    setMetadataNotice(null);
    setLoadedSqlId(null);
  }

  const origin = pageOrigin();
  const normalizedUrl = normalizeBaseUrl(baseUrl);
  const tokenKey = `${normalizedUrl}\n${token}`;

  const agentOutdated =
    healthState !== null && compareAgentVersions(healthState.version, MIN_AGENT_VERSION) < 0;

  const tokenStatus: TokenStatus =
    agentReachable !== true || !token.trim()
      ? 'unknown'
      : tokenCheck && tokenCheck.key === tokenKey
        ? tokenCheck.status
        : 'unknown';

  const dbConnected = localConnected || healthState?.connected === true;
  const oracleVersion = localOracleVersion ?? healthState?.oracleVersion ?? null;

  const tokenMessage =
    tokenErr ??
    (tokenStatus === 'invalid'
      ? describeAgentError(new AgentError('', 401), { baseUrl: normalizedUrl, origin })
      : null);

  const steps = computeConnectSteps({ agentReachable, agentOutdated, tokenStatus, dbConnected });

  /** Friendly error text; a 401 anywhere also marks the token as rejected. */
  const describe = (err: unknown): string => {
    if (err instanceof AgentError && err.status === 401) {
      setTokenCheck({ key: tokenKey, status: 'invalid' });
    }
    return describeAgentError(err, { baseUrl: normalizedUrl, origin });
  };

  useEffect(() => {
    try {
      localStorage.setItem(AGENT_URL_STORAGE_KEY, baseUrl);
    } catch {
      // localStorage may be unavailable (private browsing); ignore.
    }
  }, [baseUrl]);

  useEffect(() => {
    try {
      sessionStorage.setItem(AGENT_TOKEN_STORAGE_KEY, token);
    } catch {
      // sessionStorage may be unavailable; ignore.
    }
  }, [token]);

  // --- Health probe (manual button, mount, and 3 s polling until found) ---

  const baseUrlRef = useRef(normalizedUrl);
  baseUrlRef.current = normalizedUrl;
  const probeInFlight = useRef(false);

  const probe = useCallback(async (silent: boolean) => {
    if (probeInFlight.current) return;
    const url = baseUrlRef.current;
    probeInFlight.current = true;
    if (!silent) setHealthLoading(true);
    try {
      const result = await agentHealth(url);
      if (baseUrlRef.current !== url) return;
      setHealthState(result);
      setHealthErr(null);
      setAgentReachable(true);
    } catch (err) {
      if (baseUrlRef.current !== url) return;
      setHealthState(null);
      setHealthErr(err);
      setAgentReachable(false);
    } finally {
      probeInFlight.current = false;
      if (!silent) setHealthLoading(false);
    }
  }, []);

  useEffect(() => {
    void probe(false);
  }, [probe]);

  useEffect(() => {
    if (agentReachable === true) return undefined;
    const id = setInterval(() => void probe(true), POLL_INTERVAL_MS);
    return () => clearInterval(id);
  }, [agentReachable, probe]);

  // --- Token verification (debounced; also runs once the agent is found) ---

  const tokenSeq = useRef(0);
  const invalidateVerify = useCallback(() => {
    tokenSeq.current++;
  }, []);

  const runVerify = useCallback(
    async (url: string, tok: string) => {
      const key = `${url}\n${tok}`;
      const seq = ++tokenSeq.current;
      setTokenCheck({ key, status: 'checking' });
      setTokenErr(null);
      try {
        const ok = await agentVerifyToken({ baseUrl: url, token: tok });
        if (seq !== tokenSeq.current) return;
        setTokenCheck({ key, status: ok ? 'valid' : 'invalid' });
        if (!ok) setTokenErr(describeAgentError(new AgentError('', 401), { baseUrl: url, origin }));
      } catch (err) {
        if (seq !== tokenSeq.current) return;
        setTokenCheck(null);
        setTokenErr(describeAgentError(err, { baseUrl: url, origin }));
      }
    },
    [origin],
  );

  useEffect(() => {
    if (agentReachable !== true || !token.trim()) return undefined;
    const timer = setTimeout(() => void runVerify(normalizedUrl, token), TOKEN_VERIFY_DEBOUNCE_MS);
    return () => {
      clearTimeout(timer);
      invalidateVerify();
    };
  }, [agentReachable, token, normalizedUrl, runVerify, invalidateVerify]);

  // --- Database connection ---

  const handleConnect = async () => {
    setConnectLoading(true);
    setConnectError(null);
    try {
      const result = await agentConnect({ baseUrl: normalizedUrl, token }, { dsn, user: dbUser, password: dbPassword });
      setLocalConnected(true);
      setLocalOracleVersion(result.oracleVersion);
      setDbPassword('');
      void probe(true);
    } catch (err) {
      setConnectError(describe(err));
    } finally {
      setConnectLoading(false);
    }
  };

  const handleDisconnect = async () => {
    setConnectLoading(true);
    setConnectError(null);
    try {
      await agentDisconnect({ baseUrl: normalizedUrl, token });
      setLocalConnected(false);
      setLocalOracleVersion(null);
      // Don't let the stale health snapshot keep step 3 "done" until the next probe.
      setHealthState((h) => (h ? { ...h, connected: false, oracleVersion: null } : h));
      setItems([]);
      setRecentLoaded(false);
      void probe(true);
    } catch (err) {
      setConnectError(describe(err));
    } finally {
      setConnectLoading(false);
    }
  };

  const handleTestConnect = async () => {
    setTestConnectLoading(true);
    setTestConnectError(null);
    try {
      const result = await agentTestConnect(
        { baseUrl: normalizedUrl, token },
        { dsn: testDsn, user: testUser, password: testPassword },
      );
      setTestConnected(true);
      setTestOracleVersion(result.oracleVersion);
      setTestPassword('');
    } catch (err) {
      setTestConnectError(describe(err));
    } finally {
      setTestConnectLoading(false);
    }
  };

  const handleTestDisconnect = async () => {
    setTestConnectLoading(true);
    setTestConnectError(null);
    try {
      await agentTestDisconnect({ baseUrl: normalizedUrl, token });
      setTestConnected(false);
      setTestOracleVersion(null);
    } catch (err) {
      setTestConnectError(describe(err));
    } finally {
      setTestConnectLoading(false);
    }
  };

  // --- Recent statements ---

  const handleRefreshRecent = async () => {
    setRecentLoading(true);
    setRecentError(null);
    try {
      const result = await agentRecentSql({ baseUrl: normalizedUrl, token }, source);
      setItems(result.items);
    } catch (err) {
      setItems([]);
      setRecentError(describe(err));
    } finally {
      setRecentLoading(false);
      setRecentLoaded(true);
    }
  };

  // Always call the latest closure from the auto-refresh effect.
  const refreshRef = useRef(handleRefreshRecent);
  refreshRef.current = handleRefreshRecent;

  const planStepOpen = steps.plan === 'current';
  useEffect(() => {
    if (planStepOpen) void refreshRef.current();
  }, [planStepOpen, source]);

  const rowKey = (item: RecentSqlItem): string =>
    isCursorItem(item) ? `${item.sqlId}-${item.childNumber}` : `${item.sqlId}-${item.sqlExecId}`;

  const loadPlan = async (params: FetchPlanParams, planHash?: number | null) => {
    setMetadataNotice(null);
    setLoadedSqlId(null);
    const result = await fetchPlanWithMetadata(
      { baseUrl: normalizedUrl, token },
      params,
      { attachMetadata: attachMetadata && !agentOutdated, planHash },
    );
    if (result.metadataError) {
      setMetadataNotice(`Plan loaded without DB metadata: ${result.metadataError}`);
    }
    const loaded = await loadAndParsePlan(result.text, result.metadataText);
    if (loaded !== false) setLoadedSqlId(params.sqlId);
  };

  const handleLoadRow = async (item: RecentSqlItem) => {
    const key = rowKey(item);
    setLoadingRowKey(key);
    setRecentError(null);
    try {
      const params = isCursorItem(item)
        ? { sqlId: item.sqlId, source: 'cursor' as PlanSource, childNumber: item.childNumber }
        : { sqlId: item.sqlId, source: 'monitor' as PlanSource, sqlExecId: item.sqlExecId };
      await loadPlan(params, item.planHashValue);
    } catch (err) {
      setRecentError(describe(err));
    } finally {
      setLoadingRowKey(null);
    }
  };

  const handleManualLoad = async () => {
    if (!manualSqlId.trim()) return;
    setManualLoading(true);
    setManualError(null);
    try {
      const extra = manualChildNumber.trim();
      await loadPlan({
        sqlId: manualSqlId.trim(),
        source: manualSource,
        childNumber: manualSource === 'cursor' && extra ? Number(extra) : undefined,
        sqlExecId: manualSource === 'monitor' ? extra || undefined : undefined,
      });
    } catch (err) {
      setManualError(describe(err));
    } finally {
      setManualLoading(false);
    }
  };

  // --- Diagram state ---

  const connectorTone: Tone =
    agentReachable === null ? 'unknown' : agentReachable === false ? 'warn' : agentOutdated || tokenStatus === 'invalid' ? 'warn' : 'ok';
  const dbTone: Tone = dbConnected ? 'ok' : connectError ? 'error' : 'unknown';
  const tabLinkTone: Tone =
    agentReachable === null ? 'unknown' : agentReachable === false ? 'warn' : tokenStatus === 'valid' ? 'ok' : tokenStatus === 'invalid' ? 'warn' : 'unknown';
  const dbLinkTone: Tone = dbConnected ? 'ok' : connectError ? 'error' : 'unknown';

  const hostLabel = agentHostLabel(baseUrl);
  const connectorDetail =
    agentReachable === true ? `v${healthState?.version ?? '?'} · ${hostLabel}` : agentReachable === false ? `waiting · ${hostLabel}` : `looking… · ${hostLabel}`;
  const dbDetail = dbConnected ? (oracleVersion ?? 'connected') : 'not connected';
  const diagramLabel = [
    'Connection path: this browser tab to the connector to the Oracle database.',
    agentReachable === true
      ? `Connector running at ${hostLabel}${agentOutdated ? ' (older than expected)' : ''}.`
      : agentReachable === false
        ? `Connector not found at ${hostLabel}.`
        : 'Looking for the connector.',
    tokenStatus === 'valid' ? 'Token accepted.' : tokenStatus === 'invalid' ? 'Token rejected.' : 'Token not verified yet.',
    dbConnected ? `Database connected${oracleVersion ? ` (${oracleVersion})` : ''}.` : 'Database not connected.',
  ].join(' ');

  const startCommand = buildAgentStartCommand(origin, baseUrl);
  const attachDisabled = agentOutdated;

  const connectReady = !connectLoading && dsn.trim() !== '' && dbUser.trim() !== '' && dbPassword !== '';

  return (
    <section
      aria-label="Connect to a database"
      className="mb-2 flex flex-col gap-2.5 rounded-md border border-slate-200 bg-slate-50 p-3 text-xs dark:border-slate-700 dark:bg-slate-950/50"
    >
      {/* Header */}
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-sm font-semibold text-slate-800 dark:text-slate-100">Connect to a database</h2>
        <a
          href={AGENT_DOCS_URL}
          target="_blank"
          rel="noreferrer"
          className={`text-[11px] font-semibold text-blue-600 hover:underline dark:text-blue-400 rounded ${FOCUS_RING}`}
        >
          Setup guide ↗
        </a>
      </div>

      {/* Live flow diagram */}
      <div className="flex flex-col gap-1">
        <div role="img" aria-label={diagramLabel} className="flex items-center gap-1.5">
          <DiagramBox tone="ok" title="This browser tab" detail={pageHost()} />
          <DiagramArrow tone={tabLinkTone} />
          <DiagramBox tone={connectorTone} title="Connector" detail={connectorDetail} />
          <DiagramArrow tone={dbLinkTone} />
          <DiagramBox tone={dbTone} title="Oracle database" detail={dbDetail} />
        </div>
        <p className={hintClass}>
          Credentials and plans travel only between this tab, the connector on your machine, and your database.
        </p>
      </div>

      <ol className="m-0 flex list-none flex-col p-0">
        {/* 1 — connector */}
        <StepItem index={1} title="Start the connector" status={steps.agent}>
          {agentReachable === true ? (
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
              <span className={okTextClass}>
                Connector v{healthState?.version} running at {hostLabel}
              </span>
              <button type="button" className={linkButtonClass} aria-expanded={showSetup} onClick={() => setShowSetup((v) => !v)}>
                {showSetup ? 'Hide setup commands' : 'Show setup commands'}
              </button>
            </div>
          ) : agentReachable === null ? (
            <span className={hintClass}>Looking for the connector…</span>
          ) : (
            <div className={warnTextClass} role="status">
              {describeAgentError(healthErr, { baseUrl: normalizedUrl, origin })}
            </div>
          )}
          {agentOutdated && (
            <div className={warnTextClass}>
              Connector v{healthState?.version} is older than this app expects (≥ {MIN_AGENT_VERSION}) — metadata is
              unavailable; upgrade it with <code className="font-mono">pipx upgrade oraplanviz-agent</code>.
            </div>
          )}
          {(agentReachable === false || showSetup) && (
            <ol className="m-0 flex list-none flex-col gap-1.5 p-0">
              <li className="flex flex-col gap-1">
                <span className="text-slate-700 dark:text-slate-300">
                  <b>a.</b> Install it once <span className={hintClass}>(needs Python 3.9+ and pipx)</span>
                </span>
                <CommandBlock command={AGENT_INSTALL_COMMAND} />
              </li>
              <li className="flex flex-col gap-1">
                <span className="text-slate-700 dark:text-slate-300">
                  <b>b.</b> Start it <span className={hintClass}>— it prints a “Bearer token” you’ll paste in step 2</span>
                </span>
                <CommandBlock command={startCommand} />
              </li>
              <li className="flex flex-wrap items-center gap-2">
                <span className="text-slate-700 dark:text-slate-300">
                  <b>c.</b> Then
                </span>
                <button type="button" onClick={() => void probe(false)} disabled={healthLoading} className={buttonClass}>
                  {healthLoading ? 'Checking…' : 'Check again'}
                </button>
                {agentReachable !== true && <span className={hintClass}>(also checked automatically every few seconds)</span>}
              </li>
            </ol>
          )}
          <details className="group">
            <summary className={`cursor-pointer select-none text-[11px] text-slate-500 dark:text-slate-400 rounded ${FOCUS_RING}`}>
              Connector runs on a different port?
            </summary>
            <div className="mt-1 flex flex-wrap items-end gap-2">
              <div className="flex flex-col gap-1">
                <label className={labelClass} htmlFor="agent-base-url">Agent URL</label>
                <input
                  id="agent-base-url"
                  type="text"
                  value={baseUrl}
                  onChange={(e) => setBaseUrl(e.target.value)}
                  onKeyDown={onEnter(() => void probe(false))}
                  placeholder={DEFAULT_AGENT_BASE_URL}
                  className={`${inputClass} w-56 max-w-full font-mono`}
                />
              </div>
              <button type="button" onClick={() => void probe(false)} disabled={healthLoading} className={buttonClass}>
                {healthLoading ? 'Checking…' : 'Check'}
              </button>
            </div>
          </details>
        </StepItem>

        {/* 2 — token */}
        <StepItem index={2} title="Paste the access token" status={steps.token}>
          {tokenStatus === 'valid' && !editingToken ? (
            <div className="flex flex-wrap items-center gap-2">
              <span className={okTextClass}>Token accepted</span>
              <button type="button" className={linkButtonClass} onClick={() => setEditingToken(true)}>
                Change
              </button>
            </div>
          ) : (
            <>
              <p className={hintClass}>
                Copy the value after <b>Bearer token:</b> in the connector’s terminal.
              </p>
              <div className="flex flex-wrap items-center gap-2">
                <label className="sr-only" htmlFor="agent-token">Token</label>
                <div className="flex items-center gap-1">
                  <input
                    id="agent-token"
                    type={showToken ? 'text' : 'password'}
                    value={token}
                    onChange={(e) => setToken(e.target.value)}
                    onKeyDown={onEnter(() => { if (token.trim() && agentReachable) void runVerify(normalizedUrl, token); })}
                    placeholder="bearer token"
                    autoComplete="off"
                    spellCheck={false}
                    className={`${inputClass} w-56 max-w-full font-mono`}
                  />
                  <button
                    type="button"
                    onClick={() => setShowToken((v) => !v)}
                    aria-pressed={showToken}
                    aria-label={showToken ? 'Hide token' : 'Show token'}
                    className={`h-8 px-2 text-[11px] font-semibold rounded-md border border-slate-200 bg-white text-slate-600 hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700 ${FOCUS_RING}`}
                  >
                    {showToken ? 'Hide' : 'Show'}
                  </button>
                </div>
                <button
                  type="button"
                  onClick={() => void runVerify(normalizedUrl, token)}
                  disabled={!token.trim() || tokenStatus === 'checking' || agentReachable !== true}
                  className={buttonClass}
                >
                  {tokenStatus === 'checking' ? 'Verifying…' : 'Verify'}
                </button>
                {tokenStatus === 'valid' && (
                  <>
                    <span className={okTextClass}>✓ Token accepted</span>
                    <button type="button" className={linkButtonClass} onClick={() => setEditingToken(false)}>
                      Done
                    </button>
                  </>
                )}
              </div>
              {tokenMessage && <div className={errorTextClass} role="alert">{tokenMessage}</div>}
            </>
          )}
        </StepItem>

        {/* 3 — database */}
        <StepItem index={3} title="Connect to your database" status={steps.database}>
          {dbConnected ? (
            <div className="flex flex-wrap items-center gap-2">
              <span className={okTextClass}>Connected — {oracleVersion ?? 'Oracle'}</span>
              <button type="button" onClick={handleDisconnect} disabled={connectLoading} className={buttonClass}>
                {connectLoading ? 'Disconnecting…' : 'Disconnect'}
              </button>
            </div>
          ) : (
            <>
              <div className="flex flex-wrap items-start gap-2">
                <div className="flex flex-col gap-1">
                  <label className={labelClass} htmlFor="agent-dsn">DSN</label>
                  <input
                    id="agent-dsn"
                    type="text"
                    value={dsn}
                    onChange={(e) => setDsn(e.target.value)}
                    placeholder="dbhost:1521/service_name"
                    aria-describedby="agent-dsn-hint"
                    className={`${inputClass} w-52 max-w-full font-mono`}
                  />
                  <span id="agent-dsn-hint" className={hintClass}>Easy Connect: host:port/service_name</span>
                </div>
                <div className="flex flex-col gap-1">
                  <label className={labelClass} htmlFor="agent-user">User</label>
                  <input
                    id="agent-user"
                    type="text"
                    value={dbUser}
                    onChange={(e) => setDbUser(e.target.value)}
                    autoComplete="off"
                    className={`${inputClass} w-28`}
                  />
                </div>
                <div className="flex flex-col gap-1">
                  <label className={labelClass} htmlFor="agent-password">Password</label>
                  <input
                    id="agent-password"
                    type="password"
                    value={dbPassword}
                    onChange={(e) => setDbPassword(e.target.value)}
                    onKeyDown={onEnter(() => { if (connectReady) void handleConnect(); })}
                    autoComplete="off"
                    className={`${inputClass} w-32`}
                  />
                </div>
                <div className="flex flex-col gap-1">
                  <span className={`${labelClass} invisible`} aria-hidden="true">Go</span>
                  <button type="button" onClick={handleConnect} disabled={!connectReady} className={primaryButtonClass}>
                    {connectLoading ? 'Connecting…' : 'Connect'}
                  </button>
                </div>
              </div>
              <p className={hintClass}>
                A read-only user is enough — <code className="font-mono">GRANT SELECT_CATALOG_ROLE TO &lt;user&gt;</code>{' '}
                covers everything.
              </p>
            </>
          )}
          {connectError && <div className={errorTextClass} role="alert">{connectError}</div>}
        </StepItem>

        {/* 4 — statement */}
        <StepItem index={4} title="Pick a statement" status={steps.plan} last>
          <div role="tablist" aria-label="How to pick a statement" className="flex gap-1">
            {([['recent', 'Recent statements'], ['sqlid', 'By SQL ID']] as const).map(([id, label]) => (
              <button
                key={id}
                type="button"
                role="tab"
                id={`connect-tab-${id}`}
                aria-selected={pickTab === id}
                aria-controls={`connect-tabpanel-${id}`}
                onClick={() => setPickTab(id)}
                className={`h-7 px-2.5 text-[11px] font-semibold rounded-md border transition-colors ${FOCUS_RING} ${
                  pickTab === id
                    ? 'border-blue-600 bg-blue-600 text-white dark:border-blue-400 dark:bg-blue-400 dark:text-slate-950'
                    : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700'
                }`}
              >
                {label}
              </button>
            ))}
          </div>

          {pickTab === 'recent' ? (
            <div role="tabpanel" id="connect-tabpanel-recent" aria-labelledby="connect-tab-recent" className="flex flex-col gap-2">
              <div className="flex flex-wrap items-center gap-2">
                <div className="flex overflow-hidden rounded-md border border-slate-200 dark:border-slate-700">
                  <button
                    type="button"
                    aria-pressed={source === 'cursor'}
                    onClick={() => setSource('cursor')}
                    className={`h-7 px-2 text-[11px] font-semibold ${FOCUS_RING} ${source === 'cursor' ? 'bg-blue-600 text-white' : 'bg-white text-slate-700 dark:bg-slate-800 dark:text-slate-300'}`}
                  >
                    Cursor cache
                  </button>
                  <button
                    type="button"
                    aria-pressed={source === 'monitor'}
                    onClick={() => setSource('monitor')}
                    title="SQL Monitor requires the Oracle Tuning Pack license"
                    className={`flex h-7 items-center gap-1 px-2 text-[11px] font-semibold ${FOCUS_RING} ${source === 'monitor' ? 'bg-blue-600 text-white' : 'bg-white text-slate-700 dark:bg-slate-800 dark:text-slate-300'}`}
                  >
                    SQL Monitor
                    <span className={`rounded px-1 text-[9px] font-bold uppercase ${source === 'monitor' ? 'bg-white/25' : 'bg-amber-100 text-amber-800 dark:bg-amber-900/50 dark:text-amber-300'}`}>
                      Tuning Pack
                    </span>
                  </button>
                </div>
                <button type="button" onClick={handleRefreshRecent} disabled={recentLoading} className={buttonClass}>
                  {recentLoading ? 'Loading…' : 'Refresh'}
                </button>
              </div>
              {recentError && <div className={errorTextClass} role="alert">{recentError}</div>}
              {items.length > 0 && (
                <div className="max-h-56 overflow-auto">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="text-left text-slate-500 dark:text-slate-400">
                        <th className="py-1 pr-2 font-medium">SQL ID</th>
                        <th className="py-1 pr-2 font-medium">SQL Text</th>
                        <th className="py-1 pr-2 font-medium whitespace-nowrap">Elapsed</th>
                        <th className="py-1 pr-2 font-medium whitespace-nowrap">Last Active</th>
                        <th className="py-1 pr-2 font-medium" />
                      </tr>
                    </thead>
                    <tbody>
                      {items.map((item) => {
                        const key = rowKey(item);
                        return (
                          <tr key={key} className="border-t border-slate-200 dark:border-slate-800">
                            <td className="py-1 pr-2 font-mono">{item.sqlId}</td>
                            <td className="max-w-xs truncate py-1 pr-2" title={item.sqlText}>{item.sqlText}</td>
                            <td className="py-1 pr-2 whitespace-nowrap">{formatElapsed(item.elapsedSec)}</td>
                            <td className="py-1 pr-2 whitespace-nowrap">{item.lastActive ?? '—'}</td>
                            <td className="py-1 pr-2">
                              <button
                                type="button"
                                onClick={() => handleLoadRow(item)}
                                disabled={loadingRowKey === key}
                                className={buttonClass}
                              >
                                {loadingRowKey === key ? 'Loading…' : 'Load'}
                              </button>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
              {recentLoaded && !recentLoading && !recentError && items.length === 0 && (
                <div className={hintClass}>No statements found — run your query, then Refresh.</div>
              )}
            </div>
          ) : (
            <div role="tabpanel" id="connect-tabpanel-sqlid" aria-labelledby="connect-tab-sqlid" className="flex flex-col gap-1.5">
              <div className="flex flex-wrap items-end gap-2">
                <div className="flex flex-col gap-1">
                  <label className={labelClass} htmlFor="manual-sql-id">SQL ID</label>
                  <input
                    id="manual-sql-id"
                    type="text"
                    value={manualSqlId}
                    onChange={(e) => setManualSqlId(e.target.value)}
                    onKeyDown={onEnter(() => void handleManualLoad())}
                    className={`${inputClass} w-32 font-mono`}
                  />
                </div>
                <div className="flex flex-col gap-1">
                  <label className={labelClass} htmlFor="manual-source">Source</label>
                  <select
                    id="manual-source"
                    value={manualSource}
                    onChange={(e) => {
                      setManualSource(e.target.value as PlanSource);
                      setManualChildNumber('');
                    }}
                    className={inputClass}
                  >
                    <option value="cursor">Cursor cache</option>
                    <option value="monitor">SQL Monitor</option>
                    <option value="awr">AWR</option>
                  </select>
                </div>
                {manualSource !== 'awr' && (
                  <div className="flex flex-col gap-1">
                    <label className={labelClass} htmlFor="manual-child">
                      {manualSource === 'monitor' ? 'Exec ID' : 'Child #'}
                    </label>
                    <input
                      id="manual-child"
                      type="text"
                      value={manualChildNumber}
                      onChange={(e) => setManualChildNumber(e.target.value)}
                      onKeyDown={onEnter(() => void handleManualLoad())}
                      placeholder="optional"
                      className={`${inputClass} w-20`}
                    />
                  </div>
                )}
                <button
                  type="button"
                  onClick={handleManualLoad}
                  disabled={manualLoading || !manualSqlId.trim()}
                  className={buttonClass}
                >
                  {manualLoading ? 'Loading…' : 'Load'}
                </button>
              </div>
              {manualSource === 'monitor' && (
                <p className={hintClass}>SQL Monitor data requires the Oracle Tuning Pack license.</p>
              )}
              {manualSource === 'awr' && (
                <p className={hintClass}>AWR history requires the Oracle Diagnostics Pack license.</p>
              )}
              {manualError && <div className={errorTextClass} role="alert">{manualError}</div>}
            </div>
          )}

          <label
            className="flex cursor-pointer items-start gap-1.5 text-[11px] text-slate-600 dark:text-slate-400"
            title={
              attachDisabled
                ? `Connector v${healthState?.version} predates the metadata API (needs ≥ ${MIN_AGENT_VERSION})`
                : undefined
            }
          >
            <input
              type="checkbox"
              checked={attachMetadata && !attachDisabled}
              disabled={attachDisabled}
              onChange={(e) => setAttachMetadata(e.target.checked)}
              className="mt-0.5 accent-blue-600"
            />
            <span>
              <b className="font-semibold">Attach DB metadata</b> — adds table/index/column statistics; powers the
              Metadata tab and advisor.
            </span>
          </label>
          {metadataNotice && (
            <div className="flex items-center gap-2 text-xs text-amber-700 dark:text-amber-400">
              <span className="min-w-0 break-words [overflow-wrap:anywhere]">{metadataNotice}</span>
              <button type="button" onClick={() => setMetadataNotice(null)} className={`underline hover:no-underline rounded ${FOCUS_RING}`}>
                dismiss
              </button>
            </div>
          )}
          {loadedSqlId && (
            <div className={okTextClass} role="status">
              Loaded <span className="font-mono">{loadedSqlId}</span> — see the plan below.
            </div>
          )}
        </StepItem>
      </ol>

      {/* Optional: test connection (scratch DB for AI-proposed scripts) */}
      <details className="border-t border-slate-200 pt-2 dark:border-slate-800">
        <summary className={`cursor-pointer select-none text-[11px] font-semibold text-slate-600 dark:text-slate-400 rounded ${FOCUS_RING}`}>
          Optional · Test connection for AI scripts
        </summary>
        <div className="mt-2 flex flex-col gap-2">
          <p className={hintClass}>
            A second, separate session to a scratch schema. Scripts proposed by AI analysis run there only after you
            approve each one — never point this at production.
          </p>
          <div className="flex flex-wrap items-end gap-2">
            <div className="flex flex-col gap-1">
              <label className={labelClass} htmlFor="agent-test-dsn">DSN</label>
              <input
                id="agent-test-dsn"
                type="text"
                value={testDsn}
                onChange={(e) => setTestDsn(e.target.value)}
                placeholder="dbhost:1521/scratch_service"
                disabled={testConnected}
                className={`${inputClass} w-52 max-w-full font-mono`}
              />
            </div>
            <div className="flex flex-col gap-1">
              <label className={labelClass} htmlFor="agent-test-user">User</label>
              <input
                id="agent-test-user"
                type="text"
                value={testUser}
                onChange={(e) => setTestUser(e.target.value)}
                disabled={testConnected}
                className={`${inputClass} w-28`}
              />
            </div>
            {!testConnected && (
              <div className="flex flex-col gap-1">
                <label className={labelClass} htmlFor="agent-test-password">Password</label>
                <input
                  id="agent-test-password"
                  type="password"
                  value={testPassword}
                  onChange={(e) => setTestPassword(e.target.value)}
                  className={`${inputClass} w-32`}
                />
              </div>
            )}
            {testConnected ? (
              <button type="button" onClick={handleTestDisconnect} disabled={testConnectLoading} className={buttonClass}>
                {testConnectLoading ? 'Disconnecting…' : 'Disconnect'}
              </button>
            ) : (
              <button
                type="button"
                onClick={handleTestConnect}
                disabled={testConnectLoading || !testDsn.trim() || !testUser.trim() || !testPassword}
                className={primaryButtonClass}
              >
                {testConnectLoading ? 'Connecting…' : 'Connect'}
              </button>
            )}
            {testConnected && (
              <span className={okTextClass}>
                Test connection ready{testOracleVersion ? ` — ${testOracleVersion}` : ''}
              </span>
            )}
          </div>
          {testConnectError && <div className={errorTextClass} role="alert">{testConnectError}</div>}
        </div>
      </details>
    </section>
  );
}
