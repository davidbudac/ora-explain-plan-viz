import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { marked } from 'marked';
import DOMPurify from 'dompurify';
import { usePlan } from '../../hooks/usePlanContext';
import { useAi } from '../../hooks/useAiAnalysis';
import { splitReport } from '../../lib/ai/findings';
import type { AiChatMessage, AiError, AiFinding, AiProviderId } from '../../lib/ai/types';
import { SEVERITY_STYLES } from '../../lib/severityStyles';
import { copyToClipboard } from '../../lib/clipboard';
import { testCaseScriptFilename } from '../../lib/ai/testCase';
import { getAiSecret } from '../../lib/ai/secrets';
import { isHostedAiEnabled } from '../../lib/ai/provider';
import { loadSettings } from '../../lib/settings';
import {
  AgentError,
  health as agentHealth,
  isDbAgentEnabled,
  loadStoredAgentConfig,
  testExec as agentTestExec,
} from '../../lib/agent/client';

const PROVIDER_LABELS: Record<AiProviderId, string> = {
  hosted: 'oraplanviz cloud',
  anthropic: 'Anthropic',
  'openai-compat': 'OpenAI-compatible',
  agent: 'Local agent',
};

/** Whether the provider the dialog will initially select has enough configuration to run. */
function hasConfiguredAiProvider(): boolean {
  const settings = loadSettings();
  let provider = settings.aiProvider;

  // Mirror the dialog's fallback when a build-gated provider is unavailable.
  if ((provider === 'hosted' && !isHostedAiEnabled()) || (provider === 'agent' && !isDbAgentEnabled())) {
    provider = 'anthropic';
  }

  switch (provider) {
    case 'hosted':
      return Boolean(getAiSecret('hosted')?.trim());
    case 'anthropic':
      return Boolean(getAiSecret('anthropic')?.trim() && settings.aiAnthropicModel.trim());
    case 'openai-compat':
      return Boolean(settings.aiOpenAiBaseUrl.trim() && settings.aiOpenAiModel.trim());
    case 'agent':
      return Boolean(loadStoredAgentConfig().token.trim());
  }
}

/**
 * Hand-rolled "prose" styling — the repo does not use @tailwindcss/typography,
 * so element styles are targeted with Tailwind v4 arbitrary-variant selectors.
 */
const MARKDOWN_CLASSES = [
  'text-sm leading-relaxed text-slate-700 dark:text-slate-300',
  '[&_h1]:text-lg [&_h1]:font-bold [&_h1]:mt-6 [&_h1]:mb-2 [&_h1]:text-slate-900 dark:[&_h1]:text-slate-100',
  '[&_h2]:text-base [&_h2]:font-bold [&_h2]:mt-5 [&_h2]:mb-2 [&_h2]:text-slate-900 dark:[&_h2]:text-slate-100 [&_h2]:border-b [&_h2]:border-slate-200 dark:[&_h2]:border-slate-700 [&_h2]:pb-1',
  '[&_h3]:text-sm [&_h3]:font-semibold [&_h3]:mt-4 [&_h3]:mb-1.5 [&_h3]:text-slate-800 dark:[&_h3]:text-slate-200',
  '[&_h4]:text-sm [&_h4]:font-semibold [&_h4]:mt-3 [&_h4]:mb-1 [&_h4]:text-slate-800 dark:[&_h4]:text-slate-200',
  '[&_p]:my-2',
  '[&_ul]:my-2 [&_ul]:pl-5 [&_ul]:list-disc [&_ol]:my-2 [&_ol]:pl-5 [&_ol]:list-decimal [&_li]:my-0.5',
  '[&_strong]:font-semibold [&_strong]:text-slate-900 dark:[&_strong]:text-slate-100',
  '[&_a]:text-blue-600 dark:[&_a]:text-blue-400 [&_a]:underline',
  '[&_code]:font-mono [&_code]:text-[0.85em] [&_code]:bg-slate-100 dark:[&_code]:bg-slate-800 [&_code]:rounded [&_code]:px-1 [&_code]:py-0.5',
  '[&_pre]:my-3 [&_pre]:p-3 [&_pre]:rounded-md [&_pre]:bg-slate-100 dark:[&_pre]:bg-slate-900 [&_pre]:border [&_pre]:border-slate-200 dark:[&_pre]:border-slate-700 [&_pre]:overflow-x-auto [&_pre]:text-xs [&_pre_code]:bg-transparent [&_pre_code]:p-0',
  '[&_blockquote]:my-3 [&_blockquote]:pl-3 [&_blockquote]:border-l-2 [&_blockquote]:border-slate-300 dark:[&_blockquote]:border-slate-600 [&_blockquote]:text-slate-600 dark:[&_blockquote]:text-slate-400 [&_blockquote]:italic',
  '[&_table]:my-3 [&_table]:w-auto [&_table]:border-collapse [&_table]:text-xs',
  '[&_th]:border [&_th]:border-slate-300 dark:[&_th]:border-slate-600 [&_th]:px-2 [&_th]:py-1 [&_th]:bg-slate-100 dark:[&_th]:bg-slate-800 [&_th]:font-semibold [&_th]:text-left',
  '[&_td]:border [&_td]:border-slate-300 dark:[&_td]:border-slate-600 [&_td]:px-2 [&_td]:py-1',
  '[&_hr]:my-4 [&_hr]:border-slate-200 dark:[&_hr]:border-slate-700',
].join(' ');

function errorMessage(error: AiError): { title: string; detail: string } {
  switch (error.kind) {
    case 'auth':
      return { title: 'Invalid API key', detail: 'The provider rejected the credentials. Check the API key and try again.' };
    case 'rate-limit':
      return { title: 'Rate limited', detail: 'The provider is rate-limiting requests. Wait a moment and retry.' };
    case 'overloaded':
      return { title: 'Provider overloaded', detail: 'The provider is temporarily overloaded. Retrying usually works.' };
    case 'network':
      return {
        title: 'Network error',
        detail: `Could not reach the provider endpoint. Check the base URL, that the server is running, and that it allows CORS from this origin. (${error.message})`,
      };
    case 'refusal':
      return { title: 'Analysis refused', detail: error.message || 'The model declined to produce an analysis for this input.' };
    case 'bad-request':
      return { title: 'Bad request', detail: error.message || 'The provider rejected the request (check the model name).' };
    default:
      return { title: 'Analysis failed', detail: error.message || 'An unknown error occurred.' };
  }
}

/** Split markdown into prose and ```sql fenced segments (test-case reports). */
function splitSqlFences(markdown: string): { type: 'md' | 'sql'; text: string }[] {
  const segments: { type: 'md' | 'sql'; text: string }[] = [];
  const fence = /```sql[^\S\n]*\r?\n([\s\S]*?)```/g;
  let last = 0;
  let match: RegExpExecArray | null;
  while ((match = fence.exec(markdown)) !== null) {
    if (match.index > last) segments.push({ type: 'md', text: markdown.slice(last, match.index) });
    segments.push({ type: 'sql', text: match[1] });
    last = match.index + match[0].length;
  }
  if (last < markdown.length) segments.push({ type: 'md', text: markdown.slice(last) });
  return segments;
}

/** Statements that change or destroy data/objects — flagged in the approval card. */
const DESTRUCTIVE_SQL = /\b(DROP|TRUNCATE|DELETE|ALTER|GRANT|REVOKE|UPDATE|INSERT|MERGE|PURGE)\b/i;

/** Formats a testExec result as a quoted block the user can send as a chat turn. */
function formatExecResultQuote(result: { ok: boolean; output: string; errors: string[] }): string {
  const lines: string[] = [
    `Result of running the script via the local agent (${result.ok ? 'ok' : 'failed'}):`,
  ];
  const body = [result.output, ...result.errors].filter(Boolean).join('\n');
  for (const line of (body || '(no output)').split('\n')) {
    lines.push(`> ${line}`);
  }
  return lines.join('\n');
}

function SqlScriptBlock({
  sql,
  filename,
  canRunViaAgent = false,
  onAppendResult,
}: {
  sql: string;
  filename: string;
  /** True when the local agent is reachable — shows the approval-gated "Run via agent" button. */
  canRunViaAgent?: boolean;
  /** Receives the quoted exec result to place into the chat input (the user sends it — never auto-sent). */
  onAppendResult?: (quoted: string) => void;
}) {
  const [copied, setCopied] = useState(false);
  const [approvalOpen, setApprovalOpen] = useState(false);
  const [running, setRunning] = useState(false);
  const [runError, setRunError] = useState<string | null>(null);

  const confirmRun = async () => {
    setRunning(true);
    setRunError(null);
    try {
      const result = await agentTestExec(loadStoredAgentConfig(), { script: sql });
      onAppendResult?.(formatExecResultQuote(result));
      setApprovalOpen(false);
    } catch (err) {
      setRunError(err instanceof AgentError ? err.message : 'Failed to run the script.');
    } finally {
      setRunning(false);
    }
  };

  const copy = async () => {
    const ok = await copyToClipboard(sql);
    if (ok) {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  const download = () => {
    const blob = new Blob([sql], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  };

  const buttonClass =
    'px-2 py-0.5 text-[10px] font-medium rounded border border-slate-300 dark:border-slate-600 text-slate-600 dark:text-slate-300 bg-white dark:bg-slate-800 hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors';

  return (
    <div className="my-3 rounded-md border border-slate-200 dark:border-slate-700 overflow-hidden">
      <div className="flex items-center gap-2 px-2 py-1 bg-slate-100 dark:bg-slate-800 border-b border-slate-200 dark:border-slate-700">
        <span className="flex-1 text-[10px] font-mono text-slate-500 dark:text-slate-400 truncate">{filename}</span>
        <button type="button" onClick={copy} className={buttonClass}>
          {copied ? 'Copied' : 'Copy'}
        </button>
        <button type="button" onClick={download} className={buttonClass}>
          Download
        </button>
        {canRunViaAgent && (
          <button type="button" onClick={() => setApprovalOpen((v) => !v)} className={buttonClass}>
            Run via agent
          </button>
        )}
      </div>
      {approvalOpen && (
        <div className="p-2 space-y-2 border-b border-slate-200 dark:border-slate-700 bg-amber-50 dark:bg-amber-950/20">
          <div className="text-[11px] font-semibold text-slate-700 dark:text-slate-200">
            Run this exact script on the agent's test connection?
          </div>
          {DESTRUCTIVE_SQL.test(sql) && (
            <div className="text-[11px] text-amber-700 dark:text-amber-300">
              Warning: the script contains statements that modify or drop objects/data (DROP, ALTER, DELETE, …).
              Only run it against a scratch schema.
            </div>
          )}
          <pre className="max-h-48 p-2 rounded border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 overflow-auto text-[11px] font-mono text-slate-800 dark:text-slate-200">
            {sql}
          </pre>
          {runError && <div className="text-[11px] text-red-600 dark:text-red-400">{runError}</div>}
          <div className="flex gap-2">
            <button
              type="button"
              onClick={confirmRun}
              disabled={running}
              className="px-2.5 py-1 text-[11px] font-semibold rounded-md bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white transition-colors"
            >
              {running ? 'Running…' : 'Confirm & run'}
            </button>
            <button
              type="button"
              onClick={() => setApprovalOpen(false)}
              disabled={running}
              className={buttonClass}
            >
              Cancel
            </button>
          </div>
        </div>
      )}
      <pre className="p-3 bg-slate-50 dark:bg-slate-900 overflow-x-auto text-xs font-mono text-slate-800 dark:text-slate-200">
        {sql}
      </pre>
    </div>
  );
}

/** Renders one assistant chat turn: markdown prose with ```sql fences broken out into runnable script blocks. */
function AssistantChatContent({
  content,
  canRunViaAgent,
  onAppendResult,
}: {
  content: string;
  canRunViaAgent: boolean;
  onAppendResult: (quoted: string) => void;
}) {
  const segments = useMemo(
    () =>
      splitSqlFences(content).map((seg) =>
        seg.type === 'md'
          ? { type: 'md' as const, html: DOMPurify.sanitize(marked.parse(seg.text, { async: false, gfm: true, breaks: false })) }
          : { type: 'sql' as const, sql: seg.text },
      ),
    [content],
  );
  return (
    <div>
      {segments.map((seg, index) =>
        seg.type === 'md' ? (
          <div key={index} className={MARKDOWN_CLASSES} dangerouslySetInnerHTML={{ __html: seg.html }} />
        ) : (
          <SqlScriptBlock
            key={index}
            sql={seg.sql}
            filename="chat_snippet.sql"
            canRunViaAgent={canRunViaAgent}
            onAppendResult={onAppendResult}
          />
        ),
      )}
    </div>
  );
}

function AiFindingRow({ finding, onNavigate }: { finding: AiFinding; onNavigate: (nodeId: number) => void }) {
  const [expanded, setExpanded] = useState(false);
  const styles = SEVERITY_STYLES[finding.severity];
  const dotColor =
    finding.severity === 'critical' ? 'bg-red-500' : finding.severity === 'warning' ? 'bg-amber-500' : 'bg-sky-500';

  return (
    <div className="rounded border border-transparent hover:border-slate-200 dark:hover:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors">
      <div className="w-full flex items-center gap-1.5 px-2 py-1.5 text-[11px]">
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="p-0.5 text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 shrink-0"
          title={expanded ? 'Collapse' : 'Expand'}
          aria-expanded={expanded}
        >
          <svg className={`w-3 h-3 transition-transform ${expanded ? 'rotate-90' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M9 5l7 7-7 7" />
          </svg>
        </button>
        <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${dotColor}`} aria-hidden="true" />
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="flex-1 min-w-0 text-left font-mono truncate font-semibold text-slate-700 dark:text-slate-200"
        >
          {finding.title}
        </button>
        {finding.nodeIds.length > 0 && (
          <span className="flex items-center gap-1 shrink-0">
            {finding.nodeIds.map((nodeId) => (
              <button
                key={nodeId}
                type="button"
                onClick={() => onNavigate(nodeId)}
                title={`Go to plan line ${nodeId}`}
                className="min-w-4 h-4 px-0.5 rounded bg-slate-700 dark:bg-slate-300 text-white dark:text-slate-900 text-[9px] font-bold flex items-center justify-center hover:bg-blue-600 dark:hover:bg-blue-400 transition-colors"
              >
                {nodeId}
              </button>
            ))}
          </span>
        )}
      </div>
      {expanded && (
        <div className="px-2 pb-2 pl-9 space-y-1">
          <p className="text-[11px] text-slate-600 dark:text-slate-300 leading-snug">{finding.explanation}</p>
          {finding.suggestion && (
            <p className={`text-[11px] italic leading-snug ${styles.text}`}>{finding.suggestion}</p>
          )}
        </div>
      )}
    </div>
  );
}

export function AiReportView() {
  const { selectNode, plans } = usePlan();
  const {
    report,
    status,
    streamText,
    error,
    openAiDialog,
    cancel,
    chatMessages,
    chatStatus,
    chatStreamText,
    chatError,
    sendChatMessage,
  } = useAi();
  const [copied, setCopied] = useState(false);
  const [providerConfigured] = useState(hasConfiguredAiProvider);

  // Follow-up chat input; exec results are appended here as quoted text for
  // the user to review and send — never sent automatically.
  const [chatInput, setChatInput] = useState('');
  const chatInputRef = useRef<HTMLTextAreaElement | null>(null);

  const appendToChatInput = useCallback((quoted: string) => {
    setChatInput((prev) => (prev.trim() ? `${prev.trimEnd()}\n\n${quoted}\n` : `${quoted}\n`));
    chatInputRef.current?.focus();
  }, []);

  // Probe the local agent (build-time gated) so sql fences can offer
  // approval-gated "Run via agent".
  const [agentReachable, setAgentReachable] = useState(false);
  useEffect(() => {
    if (!isDbAgentEnabled()) return;
    let stale = false;
    agentHealth(loadStoredAgentConfig().baseUrl)
      .then(() => {
        if (!stale) setAgentReachable(true);
      })
      .catch(() => {
        if (!stale) setAgentReachable(false);
      });
    return () => {
      stale = true;
    };
  }, [report]);
  const canRunViaAgent = isDbAgentEnabled() && agentReachable;

  const handleSendChat = useCallback(() => {
    const text = chatInput.trim();
    if (!text || chatStatus === 'streaming') return;
    setChatInput('');
    void sendChatMessage(text);
  }, [chatInput, chatStatus, sendChatMessage]);

  const markdown = report?.markdown ?? streamText;
  const { narrative } = useMemo(() => splitReport(markdown), [markdown]);

  const isTestCase = report?.kind === 'testcase';

  const narrativeHtml = useMemo(() => {
    if (!narrative || isTestCase) return '';
    const raw = marked.parse(narrative, { async: false, gfm: true, breaks: false });
    return DOMPurify.sanitize(raw);
  }, [narrative, isTestCase]);

  // Test-case reports: split out ```sql fences so each script gets its own
  // copy/download controls; prose in between renders as normal markdown.
  const testCaseSegments = useMemo(() => {
    if (!isTestCase || !narrative) return null;
    return splitSqlFences(narrative).map((seg) =>
      seg.type === 'md'
        ? { type: 'md' as const, html: DOMPurify.sanitize(marked.parse(seg.text, { async: false, gfm: true, breaks: false })) }
        : { type: 'sql' as const, sql: seg.text },
    );
  }, [isTestCase, narrative]);

  const sourcePlan = report ? plans[report.slotIds[0]]?.parsedPlan ?? null : null;
  const scriptFilename = sourcePlan ? testCaseScriptFilename(sourcePlan) : 'test_case.sql';

  const dialogMode = report?.kind ?? 'analyze';

  const handleCopy = async () => {
    const ok = await copyToClipboard(markdown);
    if (ok) {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  // Empty state: nothing streamed, no report, no error.
  if (status === 'idle' && !report) {
    return (
      <div className="h-full flex items-center justify-center bg-neutral-50 dark:bg-neutral-950">
        <div className="max-w-md px-6 text-center">
          <span className="inline-flex rounded-full border border-blue-200 bg-blue-50 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-blue-700 dark:border-blue-800 dark:bg-blue-950/50 dark:text-blue-300">
            Beta
          </span>
          <h2 className="mt-3 text-base font-semibold text-neutral-900 dark:text-neutral-100">
            AI analysis is in beta
          </h2>
          <p className="mt-2 text-sm leading-relaxed text-neutral-600 dark:text-neutral-400">
            Connect your own Anthropic or OpenAI-compatible provider to generate an expert report for the loaded plan.
          </p>
          {!isHostedAiEnabled() && (
            <p className="mt-1 text-xs text-neutral-500 dark:text-neutral-500">
              One-click hosted analysis is coming soon.
            </p>
          )}
          <button
            type="button"
            onClick={() => openAiDialog('analyze')}
            className="mt-4 px-4 py-2 text-sm font-medium rounded-md bg-blue-600 hover:bg-blue-700 text-white transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/60 focus-visible:ring-offset-2 dark:focus-visible:ring-offset-neutral-950"
          >
            {providerConfigured ? 'Analyze plan' : 'Configure AI provider'}
          </button>
        </div>
      </div>
    );
  }

  const providerBadge = report ? (
    <span className="flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-[11px] text-slate-600 dark:text-slate-300">
      <span className="font-semibold">{PROVIDER_LABELS[report.provider]}</span>
      <span className="font-mono text-slate-500 dark:text-slate-400">{report.model}</span>
    </span>
  ) : null;

  const statusIndicator =
    status === 'streaming' ? (
      <span className="flex items-center gap-1.5 text-[11px] text-blue-600 dark:text-blue-400">
        <span className="w-2 h-2 rounded-full bg-blue-500 animate-pulse" aria-hidden="true" />
        Streaming…
      </span>
    ) : status === 'done' ? (
      <span className="text-[11px] text-emerald-600 dark:text-emerald-400">Done</span>
    ) : status === 'cancelled' ? (
      <span className="text-[11px] text-amber-600 dark:text-amber-400">Cancelled</span>
    ) : status === 'error' ? (
      <span className="text-[11px] text-red-600 dark:text-red-400">Error</span>
    ) : null;

  const smallButton =
    'flex items-center gap-1 px-2.5 py-1 text-[11px] font-medium rounded-md border transition-colors text-slate-600 dark:text-slate-400 border-slate-300 dark:border-slate-600 hover:bg-slate-100 dark:hover:bg-slate-800';

  return (
    <div className="h-full flex flex-col bg-neutral-50 dark:bg-neutral-950">
      {/* Header bar */}
      <div className="flex items-center gap-2 px-4 py-2 border-b border-slate-200 dark:border-slate-800 shrink-0">
        <span className="text-xs font-semibold text-slate-700 dark:text-slate-200">
          AI {dialogMode === 'compare' ? 'plan comparison' : dialogMode === 'testcase' ? 'test case' : 'plan analysis'}
        </span>
        {providerBadge}
        {statusIndicator}
        <div className="flex-1" />
        {status === 'streaming' && (
          <button
            type="button"
            onClick={cancel}
            className="px-2.5 py-1 text-[11px] font-medium rounded-md border border-red-300 dark:border-red-700 text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/40 transition-colors"
          >
            Cancel
          </button>
        )}
        {status !== 'streaming' && (
          <button type="button" onClick={() => openAiDialog(dialogMode)} className={smallButton}>
            Regenerate
          </button>
        )}
        {markdown && (
          <button type="button" onClick={handleCopy} className={smallButton}>
            {copied ? 'Copied' : 'Copy'}
          </button>
        )}
      </div>

      <div className="flex-1 overflow-auto">
        <div className="max-w-3xl mx-auto px-4 py-4 space-y-3">
          {/* Truncation banner */}
          {report?.truncated && (
            <div className="rounded-md border border-amber-500/20 bg-amber-50 dark:bg-amber-950/30 px-3 py-2 text-xs text-amber-700 dark:text-amber-300">
              The response was cut off at the token limit — the report below may be incomplete.
            </div>
          )}

          {/* Cancelled banner */}
          {status === 'cancelled' && (
            <div className="rounded-md border border-amber-500/20 bg-amber-50 dark:bg-amber-950/30 px-3 py-2 text-xs text-amber-700 dark:text-amber-300">
              Analysis cancelled — showing the partial response received so far.
            </div>
          )}

          {/* Error state (refusal explanation surfaces here too) */}
          {status === 'error' && error && (
            <div className="rounded-md border border-red-500/20 bg-red-50 dark:bg-red-950/30 px-3 py-2 space-y-2">
              <div className="text-xs font-semibold text-red-700 dark:text-red-300">{errorMessage(error).title}</div>
              <div className="text-xs text-red-700/90 dark:text-red-300/90 leading-snug">{errorMessage(error).detail}</div>
              <div className="flex gap-2">
                {error.kind === 'auth' ? (
                  <button
                    type="button"
                    onClick={() => openAiDialog(dialogMode)}
                    className="px-2.5 py-1 text-[11px] font-medium rounded-md bg-red-600 hover:bg-red-700 text-white transition-colors"
                  >
                    Update API key
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={() => openAiDialog(dialogMode)}
                    className="px-2.5 py-1 text-[11px] font-medium rounded-md bg-red-600 hover:bg-red-700 text-white transition-colors"
                  >
                    Retry
                  </button>
                )}
              </div>
            </div>
          )}

          {/* Streamed / final narrative */}
          {testCaseSegments ? (
            <div>
              {testCaseSegments.map((seg, index) =>
                seg.type === 'md' ? (
                  <div key={index} className={MARKDOWN_CLASSES} dangerouslySetInnerHTML={{ __html: seg.html }} />
                ) : (
                  <SqlScriptBlock
                    key={index}
                    sql={seg.sql}
                    filename={scriptFilename}
                    canRunViaAgent={canRunViaAgent}
                    onAppendResult={appendToChatInput}
                  />
                ),
              )}
            </div>
          ) : narrativeHtml ? (
            <div className={MARKDOWN_CLASSES} dangerouslySetInnerHTML={{ __html: narrativeHtml }} />
          ) : status === 'streaming' ? (
            <p className="text-sm text-slate-500 dark:text-slate-400">Waiting for the model…</p>
          ) : null}

          {/* Structured findings under the narrative */}
          {report?.findings && report.findings.length > 0 && (
            <div className="pt-2 border-t border-slate-200 dark:border-slate-800">
              <div className="mb-1.5 text-[10px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                Findings
              </div>
              <div className="space-y-1">
                {report.findings.map((finding, index) => (
                  <AiFindingRow
                    key={`${finding.title}-${index}`}
                    finding={finding}
                    onNavigate={selectNode}
                  />
                ))}
              </div>
            </div>
          )}

          {/* Follow-up conversation (after a completed report) */}
          {report && status === 'done' && (
            <div className="pt-3 border-t border-slate-200 dark:border-slate-800 space-y-3">
              <div className="text-[10px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                Follow-up chat
              </div>

              {chatMessages.map((message: AiChatMessage, index: number) =>
                message.role === 'user' ? (
                  <div
                    key={index}
                    className="ml-8 rounded-md border border-blue-200 dark:border-blue-900 bg-blue-50 dark:bg-blue-950/30 px-3 py-2 text-sm text-slate-700 dark:text-slate-300 whitespace-pre-wrap"
                  >
                    {message.content}
                  </div>
                ) : (
                  <div key={index} className="mr-4">
                    <AssistantChatContent
                      content={message.content}
                      canRunViaAgent={canRunViaAgent}
                      onAppendResult={appendToChatInput}
                    />
                  </div>
                ),
              )}

              {/* In-flight reply */}
              {chatStatus === 'streaming' && (
                <div className="mr-4 space-y-1">
                  {chatStreamText ? (
                    <AssistantChatContent
                      content={chatStreamText}
                      canRunViaAgent={false}
                      onAppendResult={appendToChatInput}
                    />
                  ) : null}
                  <span className="flex items-center gap-1.5 text-[11px] text-blue-600 dark:text-blue-400">
                    <span className="w-2 h-2 rounded-full bg-blue-500 animate-pulse" aria-hidden="true" />
                    Streaming…
                    <button
                      type="button"
                      onClick={cancel}
                      className="ml-2 px-2 py-0.5 text-[10px] font-medium rounded border border-red-300 dark:border-red-700 text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/40 transition-colors"
                    >
                      Cancel
                    </button>
                  </span>
                </div>
              )}

              {chatStatus === 'error' && chatError && (
                <div className="rounded-md border border-red-500/20 bg-red-50 dark:bg-red-950/30 px-3 py-2 text-xs text-red-700 dark:text-red-300">
                  {errorMessage(chatError).title}: {errorMessage(chatError).detail}
                </div>
              )}

              {/* Input */}
              <div className="flex flex-col gap-1.5">
                <textarea
                  ref={chatInputRef}
                  value={chatInput}
                  onChange={(e) => setChatInput(e.target.value)}
                  onKeyDown={(e) => {
                    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
                      e.preventDefault();
                      handleSendChat();
                    }
                  }}
                  rows={3}
                  placeholder="Ask a follow-up question about this report… (Cmd/Ctrl-Enter to send)"
                  className="w-full px-3 py-2 text-sm rounded-md border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900 text-slate-800 dark:text-slate-200 placeholder-slate-400 dark:placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-blue-500/60 font-mono resize-y"
                />
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={handleSendChat}
                    disabled={!chatInput.trim() || chatStatus === 'streaming'}
                    className="px-3 py-1.5 text-xs font-semibold rounded-md bg-blue-600 hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed text-white transition-colors"
                  >
                    Send
                  </button>
                  <span className="text-[10px] text-slate-400 dark:text-slate-500">
                    Replies go to the same provider as the report{canRunViaAgent ? ' · agent script runs always require your confirmation' : ''}
                  </span>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
