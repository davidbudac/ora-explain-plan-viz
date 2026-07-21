import { useCallback, useEffect, useState } from 'react';
import { usePlan } from '../hooks/usePlanContext';
import {
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
  type AgentHealth,
  type FetchPlanParams,
  type PlanSource,
  type RecentSqlItem,
} from '../lib/agent/client';

const AGENT_URL_STORAGE_KEY = 'oraplanviz.agentUrl';
const AGENT_TOKEN_STORAGE_KEY = 'oraplanviz.agentToken';

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

export function ConnectPanel() {
  const { loadAndParsePlan } = usePlan();

  const [baseUrl, setBaseUrl] = useState(loadStoredBaseUrl);
  const [token, setToken] = useState(loadStoredToken);

  const [healthState, setHealthState] = useState<AgentHealth | null>(null);
  const [healthError, setHealthError] = useState<string | null>(null);
  const [healthLoading, setHealthLoading] = useState(false);

  const [dsn, setDsn] = useState('');
  const [dbUser, setDbUser] = useState('');
  const [dbPassword, setDbPassword] = useState('');
  const [connected, setConnected] = useState(false);
  const [oracleVersion, setOracleVersion] = useState<string | null>(null);
  const [connectError, setConnectError] = useState<string | null>(null);
  const [connectLoading, setConnectLoading] = useState(false);

  const [source, setSource] = useState<'cursor' | 'monitor'>('cursor');
  const [items, setItems] = useState<RecentSqlItem[]>([]);
  const [recentError, setRecentError] = useState<string | null>(null);
  const [recentLoading, setRecentLoading] = useState(false);
  const [loadingRowKey, setLoadingRowKey] = useState<string | null>(null);

  const [manualSqlId, setManualSqlId] = useState('');
  const [manualSource, setManualSource] = useState<PlanSource>('cursor');
  const [manualChildNumber, setManualChildNumber] = useState('');
  const [manualLoading, setManualLoading] = useState(false);
  const [manualError, setManualError] = useState<string | null>(null);

  const [attachMetadata, setAttachMetadata] = useState(true);
  // Non-blocking: set when a plan loaded fine but its metadata gather failed.
  const [metadataNotice, setMetadataNotice] = useState<string | null>(null);

  const agentOutdated =
    healthState !== null && compareAgentVersions(healthState.version, MIN_AGENT_VERSION) < 0;

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

  const checkHealth = useCallback(async () => {
    setHealthLoading(true);
    setHealthError(null);
    try {
      const result = await agentHealth(baseUrl);
      setHealthState(result);
    } catch (err) {
      setHealthState(null);
      setHealthError(err instanceof AgentError ? err.message : 'Failed to reach agent.');
    } finally {
      setHealthLoading(false);
    }
  }, [baseUrl]);

  // Auto-probe once on mount so the status line is populated without a click.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    checkHealth();
  }, []);

  const handleConnect = async () => {
    setConnectLoading(true);
    setConnectError(null);
    try {
      const result = await agentConnect(
        { baseUrl: normalizeBaseUrl(baseUrl), token },
        { dsn, user: dbUser, password: dbPassword }
      );
      setConnected(true);
      setOracleVersion(result.oracleVersion);
      setDbPassword('');
      checkHealth();
    } catch (err) {
      setConnectError(err instanceof AgentError ? err.message : 'Failed to connect.');
    } finally {
      setConnectLoading(false);
    }
  };

  const handleDisconnect = async () => {
    setConnectLoading(true);
    setConnectError(null);
    try {
      await agentDisconnect({ baseUrl: normalizeBaseUrl(baseUrl), token });
      setConnected(false);
      setOracleVersion(null);
      checkHealth();
    } catch (err) {
      setConnectError(err instanceof AgentError ? err.message : 'Failed to disconnect.');
    } finally {
      setConnectLoading(false);
    }
  };

  const handleRefreshRecent = useCallback(async () => {
    setRecentLoading(true);
    setRecentError(null);
    try {
      const result = await agentRecentSql({ baseUrl: normalizeBaseUrl(baseUrl), token }, source);
      setItems(result.items);
    } catch (err) {
      setItems([]);
      setRecentError(err instanceof AgentError ? err.message : 'Failed to fetch recent SQL.');
    } finally {
      setRecentLoading(false);
    }
  }, [baseUrl, token, source]);

  const rowKey = (item: RecentSqlItem): string =>
    isCursorItem(item) ? `${item.sqlId}-${item.childNumber}` : `${item.sqlId}-${item.sqlExecId}`;

  const loadPlan = async (params: FetchPlanParams, planHash?: number | null) => {
    setMetadataNotice(null);
    const result = await fetchPlanWithMetadata(
      { baseUrl: normalizeBaseUrl(baseUrl), token },
      params,
      { attachMetadata: attachMetadata && !agentOutdated, planHash }
    );
    if (result.metadataError) {
      setMetadataNotice(`Plan loaded without DB metadata: ${result.metadataError}`);
    }
    loadAndParsePlan(result.text, result.metadataText);
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
      setRecentError(err instanceof AgentError ? err.message : 'Failed to fetch plan.');
    } finally {
      setLoadingRowKey(null);
    }
  };

  const handleManualLoad = async () => {
    if (!manualSqlId.trim()) return;
    setManualLoading(true);
    setManualError(null);
    try {
      const childNum = manualChildNumber.trim() ? Number(manualChildNumber.trim()) : undefined;
      await loadPlan({
        sqlId: manualSqlId.trim(),
        source: manualSource,
        childNumber: manualSource === 'cursor' ? childNum : undefined,
        sqlExecId: manualSource === 'monitor' ? manualChildNumber.trim() || undefined : undefined,
      });
    } catch (err) {
      setManualError(err instanceof AgentError ? err.message : 'Failed to fetch plan.');
    } finally {
      setManualLoading(false);
    }
  };

  const inputClass =
    'h-8 px-2 text-xs bg-neutral-50 dark:bg-neutral-950 border border-neutral-200 dark:border-neutral-700 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500/60 text-neutral-900 dark:text-neutral-100 placeholder-neutral-400 dark:placeholder-neutral-500';
  const labelClass = 'text-[11px] font-semibold text-neutral-600 dark:text-neutral-400 uppercase tracking-wide';
  const buttonClass =
    'h-8 px-3 text-xs border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-neutral-800 text-neutral-700 dark:text-neutral-300 rounded-md hover:bg-neutral-100 dark:hover:bg-neutral-700 transition-colors font-semibold disabled:opacity-50 disabled:cursor-not-allowed';

  return (
    <div className="flex flex-col gap-3 p-3 mb-2 border border-neutral-200 dark:border-neutral-700 rounded-md bg-neutral-50 dark:bg-neutral-950/50">
      {/* Agent settings */}
      <div className="flex flex-wrap items-end gap-2">
        <div className="flex flex-col gap-1">
          <label className={labelClass} htmlFor="agent-base-url">Agent URL</label>
          <input
            id="agent-base-url"
            type="text"
            value={baseUrl}
            onChange={(e) => setBaseUrl(e.target.value)}
            placeholder={DEFAULT_AGENT_BASE_URL}
            className={`${inputClass} w-56 font-mono`}
          />
        </div>
        <div className="flex flex-col gap-1">
          <label className={labelClass} htmlFor="agent-token">Token</label>
          <input
            id="agent-token"
            type="password"
            value={token}
            onChange={(e) => setToken(e.target.value)}
            placeholder="bearer token"
            className={`${inputClass} w-40 font-mono`}
          />
        </div>
        <button type="button" onClick={checkHealth} disabled={healthLoading} className={buttonClass}>
          {healthLoading ? 'Checking…' : 'Check'}
        </button>
        <div className="text-xs ml-1">
          {healthState ? (
            <span className="text-emerald-600 dark:text-emerald-400">
              Agent v{healthState.version} — {healthState.connected ? `connected (${healthState.oracleVersion ?? 'Oracle'})` : 'not connected to a DB'}
            </span>
          ) : healthError ? (
            <span className="text-neutral-500 dark:text-neutral-400">
              No agent detected — run <code className="font-mono">oraplanviz-agent</code>
            </span>
          ) : (
            <span className="text-neutral-500 dark:text-neutral-400">Probing…</span>
          )}
        </div>
      </div>

      {/* DB connect form */}
      <div className="flex flex-wrap items-end gap-2">
        <div className="flex flex-col gap-1">
          <label className={labelClass} htmlFor="agent-dsn">DSN</label>
          <input
            id="agent-dsn"
            type="text"
            value={dsn}
            onChange={(e) => setDsn(e.target.value)}
            placeholder="//host:1521/service"
            disabled={connected}
            className={`${inputClass} w-48 font-mono`}
          />
        </div>
        <div className="flex flex-col gap-1">
          <label className={labelClass} htmlFor="agent-user">User</label>
          <input
            id="agent-user"
            type="text"
            value={dbUser}
            onChange={(e) => setDbUser(e.target.value)}
            disabled={connected}
            className={`${inputClass} w-28`}
          />
        </div>
        {!connected && (
          <div className="flex flex-col gap-1">
            <label className={labelClass} htmlFor="agent-password">Password</label>
            <input
              id="agent-password"
              type="password"
              value={dbPassword}
              onChange={(e) => setDbPassword(e.target.value)}
              className={`${inputClass} w-32`}
            />
          </div>
        )}
        {connected ? (
          <button type="button" onClick={handleDisconnect} disabled={connectLoading} className={buttonClass}>
            {connectLoading ? 'Disconnecting…' : 'Disconnect'}
          </button>
        ) : (
          <button
            type="button"
            onClick={handleConnect}
            disabled={connectLoading || !dsn.trim() || !dbUser.trim() || !dbPassword}
            className="h-8 px-3 text-xs bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors font-semibold"
          >
            {connectLoading ? 'Connecting…' : 'Connect'}
          </button>
        )}
        {connected && oracleVersion && (
          <span className="text-xs text-emerald-600 dark:text-emerald-400">Connected — {oracleVersion}</span>
        )}
      </div>
      {connectError && (
        <div className="text-xs text-red-600 dark:text-red-400">{connectError}</div>
      )}

      {/* Recent SQL */}
      <div className="flex flex-col gap-2">
        <div className="flex items-center gap-2">
          <div className="flex rounded-md border border-neutral-200 dark:border-neutral-700 overflow-hidden">
            <button
              type="button"
              onClick={() => setSource('cursor')}
              className={`h-7 px-2 text-[11px] font-semibold ${source === 'cursor' ? 'bg-blue-600 text-white' : 'bg-white dark:bg-neutral-800 text-neutral-700 dark:text-neutral-300'}`}
            >
              Cursor cache
            </button>
            <button
              type="button"
              onClick={() => setSource('monitor')}
              className={`h-7 px-2 text-[11px] font-semibold ${source === 'monitor' ? 'bg-blue-600 text-white' : 'bg-white dark:bg-neutral-800 text-neutral-700 dark:text-neutral-300'}`}
              title="SQL Monitor requires the Diagnostics + Tuning Pack license"
            >
              SQL Monitor (Tuning Pack)
            </button>
          </div>
          <button type="button" onClick={handleRefreshRecent} disabled={recentLoading} className={buttonClass}>
            {recentLoading ? 'Loading…' : 'Refresh'}
          </button>
          <label
            className="flex items-center gap-1.5 text-[11px] font-semibold text-neutral-600 dark:text-neutral-400 ml-1 cursor-pointer"
            title={
              agentOutdated
                ? `Agent v${healthState?.version} predates the metadata API (needs ≥ ${MIN_AGENT_VERSION})`
                : 'Also fetch object/column/index statistics for the plan (adds one round trip)'
            }
          >
            <input
              type="checkbox"
              checked={attachMetadata && !agentOutdated}
              disabled={agentOutdated}
              onChange={(e) => setAttachMetadata(e.target.checked)}
              className="accent-blue-600"
            />
            Attach DB metadata
          </label>
        </div>
        {agentOutdated && (
          <div className="text-xs text-amber-600 dark:text-amber-400">
            Agent v{healthState?.version} is older than this app expects (≥ {MIN_AGENT_VERSION}) — metadata is unavailable; consider upgrading the agent.
          </div>
        )}
        {recentError && <div className="text-xs text-red-600 dark:text-red-400">{recentError}</div>}
        {metadataNotice && (
          <div className="flex items-center gap-2 text-xs text-amber-600 dark:text-amber-400">
            <span>{metadataNotice}</span>
            <button
              type="button"
              onClick={() => setMetadataNotice(null)}
              className="underline hover:no-underline"
            >
              dismiss
            </button>
          </div>
        )}
        {items.length > 0 && (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="text-left text-neutral-500 dark:text-neutral-400">
                  <th className="pr-2 py-1 font-medium">SQL ID</th>
                  <th className="pr-2 py-1 font-medium">SQL Text</th>
                  <th className="pr-2 py-1 font-medium">Elapsed</th>
                  <th className="pr-2 py-1 font-medium">Last Active</th>
                  <th className="pr-2 py-1 font-medium" />
                </tr>
              </thead>
              <tbody>
                {items.map((item) => {
                  const key = rowKey(item);
                  return (
                    <tr key={key} className="border-t border-neutral-200 dark:border-neutral-800">
                      <td className="pr-2 py-1 font-mono">{item.sqlId}</td>
                      <td className="pr-2 py-1 max-w-xs truncate" title={item.sqlText}>{item.sqlText}</td>
                      <td className="pr-2 py-1">{formatElapsed(item.elapsedSec)}</td>
                      <td className="pr-2 py-1">{item.lastActive ?? '—'}</td>
                      <td className="pr-2 py-1">
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
      </div>

      {/* Manual fetch */}
      <div className="flex flex-wrap items-end gap-2 pt-1 border-t border-neutral-200 dark:border-neutral-800">
        <div className="flex flex-col gap-1">
          <label className={labelClass} htmlFor="manual-sql-id">SQL ID</label>
          <input
            id="manual-sql-id"
            type="text"
            value={manualSqlId}
            onChange={(e) => setManualSqlId(e.target.value)}
            className={`${inputClass} w-32 font-mono`}
          />
        </div>
        <div className="flex flex-col gap-1">
          <label className={labelClass} htmlFor="manual-source">Source</label>
          <select
            id="manual-source"
            value={manualSource}
            onChange={(e) => setManualSource(e.target.value as PlanSource)}
            className={inputClass}
          >
            <option value="cursor">Cursor cache</option>
            <option value="monitor">SQL Monitor</option>
            <option value="awr">AWR</option>
          </select>
        </div>
        <div className="flex flex-col gap-1">
          <label className={labelClass} htmlFor="manual-child">Child #</label>
          <input
            id="manual-child"
            type="text"
            value={manualChildNumber}
            onChange={(e) => setManualChildNumber(e.target.value)}
            placeholder="optional"
            className={`${inputClass} w-20`}
          />
        </div>
        <button
          type="button"
          onClick={handleManualLoad}
          disabled={manualLoading || !manualSqlId.trim()}
          className={buttonClass}
        >
          {manualLoading ? 'Loading…' : 'Load'}
        </button>
      </div>
      {manualError && <div className="text-xs text-red-600 dark:text-red-400">{manualError}</div>}
    </div>
  );
}
