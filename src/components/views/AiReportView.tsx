import { useMemo, useState } from 'react';
import { marked } from 'marked';
import DOMPurify from 'dompurify';
import { usePlan } from '../../hooks/usePlanContext';
import { useAi } from '../../hooks/useAiAnalysis';
import { splitReport } from '../../lib/ai/findings';
import type { AiError, AiFinding, AiProviderId } from '../../lib/ai/types';
import { SEVERITY_STYLES } from '../../lib/severityStyles';
import { copyToClipboard } from '../../lib/clipboard';

const PROVIDER_LABELS: Record<AiProviderId, string> = {
  anthropic: 'Anthropic',
  'openai-compat': 'OpenAI-compatible',
  agent: 'Local agent',
};

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
  const { selectNode } = usePlan();
  const { report, status, streamText, error, openAiDialog, cancel } = useAi();
  const [copied, setCopied] = useState(false);

  const markdown = report?.markdown ?? streamText;
  const { narrative } = useMemo(() => splitReport(markdown), [markdown]);

  const narrativeHtml = useMemo(() => {
    if (!narrative) return '';
    const raw = marked.parse(narrative, { async: false, gfm: true, breaks: false });
    return DOMPurify.sanitize(raw);
  }, [narrative]);

  const dialogMode = report?.kind === 'compare' ? 'compare' : 'analyze';

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
        <div className="text-center space-y-3">
          <p className="text-sm text-neutral-500 dark:text-neutral-400">
            No AI analysis yet. Send the loaded plan to an AI provider for an expert report.
          </p>
          <button
            type="button"
            onClick={() => openAiDialog('analyze')}
            className="px-4 py-2 text-sm font-medium rounded-md bg-blue-600 hover:bg-blue-700 text-white transition-colors"
          >
            Analyze plan
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
          AI {dialogMode === 'compare' ? 'plan comparison' : 'plan analysis'}
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
          {narrativeHtml ? (
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
        </div>
      </div>
    </div>
  );
}
