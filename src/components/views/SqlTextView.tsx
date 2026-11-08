import { useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { usePlan } from '../../hooks/usePlanContext';
import { useToast } from '../ui';
import { AgentError, health as agentHealth, isDbAgentEnabled, loadStoredAgentConfig, testExplain as agentTestExplain } from '../../lib/agent/client';
import hljs from 'highlight.js/lib/core';
import sql from 'highlight.js/lib/languages/sql';
import { CopyButton, FOCUS_RING, FOCUS_RING_INSET } from '../ui';
import { formatHintSummary, outlineHintBlock } from '../../lib/outlineHints';
import { analyzeHints, extractSqlHints, normalizeHintText, parseHint, planHasHints, stripHintComments, HINT_FAMILY_LABELS } from '../../lib/hints';
import type { HintAnalysis, HintMark, HintMarkStatus, SqlHintComment } from '../../lib/hints';

hljs.registerLanguage('sql', sql);

function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function highlightSql(text: string): string {
  if (!text) return '';
  try {
    return hljs.highlight(text, { language: 'sql' }).value;
  } catch {
    return escapeHtml(text);
  }
}

const STATUS_CLASSES: Record<HintMarkStatus | 'unknown', string> = {
  used: 'text-emerald-800 dark:text-emerald-300 bg-emerald-100/80 dark:bg-emerald-900/40 decoration-emerald-400',
  unused: 'text-amber-800 dark:text-amber-300 bg-amber-100/80 dark:bg-amber-900/40 decoration-amber-400',
  error: 'text-red-800 dark:text-red-300 bg-red-100/80 dark:bg-red-900/40 decoration-red-400',
  other: 'text-slate-700 dark:text-slate-300 bg-slate-100 dark:bg-slate-800 decoration-slate-400',
  outline: 'text-slate-700 dark:text-slate-300 bg-slate-100 dark:bg-slate-800 decoration-slate-400',
  unknown: 'text-slate-500 dark:text-slate-400 decoration-slate-300 dark:decoration-slate-600',
};

const STATUS_LABEL: Record<HintMarkStatus | 'unknown', string> = {
  used: 'used',
  unused: 'not used',
  error: 'syntax error',
  other: 'reported',
  outline: 'outline',
  unknown: 'not in the Hint Report',
};

/** The Hint Report entries that spell this SQL hint (case/whitespace folded), merged. */
interface SqlHintStatus {
  status: HintMarkStatus | 'unknown';
  nodeIds: number[];
  reasons: string[];
}

function statusIndex(analysis: HintAnalysis | null): Map<string, SqlHintStatus> {
  const index = new Map<string, SqlHintStatus>();
  if (!analysis) return index;
  // Oracle reports a hint it could not parse by name only (`no_such_hint`), while the SQL says
  // `no_such_hint(x)`: a name-only entry stands in for every spelling of that name.
  const byName = new Map<string, HintMark[]>();
  for (const mark of analysis.report) {
    const list = byName.get(parseHint(mark.text).name) ?? [];
    list.push(mark);
    byName.set(parseHint(mark.text).name, list);
  }
  const rank: Record<HintMarkStatus, number> = { used: 4, unused: 3, error: 2, other: 1, outline: 0 };
  for (const mark of analysis.report) {
    const key = normalizeHintText(mark.text);
    const entry = index.get(key) ?? { status: mark.status, nodeIds: [], reasons: [] };
    // A hint reported on several operations (use_nl(o u): unused on U, used on O) counts as used.
    if (entry.status === 'unknown' || rank[mark.status] > rank[entry.status as HintMarkStatus]) entry.status = mark.status;
    for (const id of mark.nodeIds) if (!entry.nodeIds.includes(id)) entry.nodeIds.push(id);
    if (mark.reason && !entry.reasons.includes(mark.reason)) entry.reasons.push(mark.reason);
    index.set(key, entry);
  }
  return index;
}

function lookupStatus(index: Map<string, SqlHintStatus>, analysis: HintAnalysis | null, text: string): SqlHintStatus | undefined {
  const exact = index.get(normalizeHintText(text));
  if (exact || !analysis) return exact;
  const name = parseHint(text).name;
  const sameName = analysis.report.filter((m) => parseHint(m.text).name === name && m.text.indexOf('(') === -1);
  if (sameName.length === 0) return undefined;
  return {
    status: sameName[0].status,
    nodeIds: [...new Set(sameName.flatMap((m) => m.nodeIds))],
    reasons: sameName.flatMap((m) => (m.reason ? [m.reason] : [])),
  };
}

/**
 * The statement with its hint comments marked up: each hint is a button coloured by its Hint
 * Report status (used / not used / syntax error), its tooltip carries Oracle's reason, and a
 * click selects the operation Oracle reported it on. Everything outside the hint comments is
 * ordinary syntax highlighting.
 */
function HintedSql({ sqlText, comments, index, analysis, onPick }: {
  sqlText: string;
  comments: SqlHintComment[];
  index: Map<string, SqlHintStatus>;
  analysis: HintAnalysis | null;
  onPick: (nodeIds: number[]) => void;
}) {
  const parts: ReactNode[] = [];
  let cursor = 0;
  comments.forEach((comment, ci) => {
    if (comment.start > cursor) {
      parts.push(<code key={`sql-${ci}`} className="hljs language-sql" dangerouslySetInnerHTML={{ __html: highlightSql(sqlText.slice(cursor, comment.start)) }} />);
    }
    const inner: ReactNode[] = [];
    let c = comment.start;
    comment.hints.forEach((hint, hi) => {
      if (hint.start > c) inner.push(<span key={`ws-${hi}`}>{sqlText.slice(c, hint.start)}</span>);
      const status = lookupStatus(index, analysis, hint.text);
      const kind = status?.status ?? 'unknown';
      const where = status && status.nodeIds.length > 0 ? ` on operation${status.nodeIds.length > 1 ? 's' : ''} ${status.nodeIds.join(', ')}` : '';
      const title = `${STATUS_LABEL[kind]}${where}${status?.reasons.length ? ` — ${status.reasons.join('; ')}` : ''}${status && status.nodeIds.length > 0 ? '\nClick to select the operation in the tree' : ''}`;
      const clickable = !!status && status.nodeIds.length > 0;
      inner.push(
        clickable ? (
          <button
            key={`h-${hi}`}
            type="button"
            data-testid="sql-hint"
            data-status={kind}
            className={`rounded px-0.5 underline decoration-dotted underline-offset-2 ${STATUS_CLASSES[kind]} ${FOCUS_RING}`}
            title={title}
            onClick={() => onPick(status.nodeIds)}
          >
            {hint.text}
          </button>
        ) : (
          <span key={`h-${hi}`} data-testid="sql-hint" data-status={kind} className={`rounded px-0.5 underline decoration-dotted underline-offset-2 ${STATUS_CLASSES[kind]}`} title={title}>
            {hint.text}
          </span>
        ),
      );
      c = hint.end;
    });
    if (comment.end > c) inner.push(<span key="tail">{sqlText.slice(c, comment.end)}</span>);
    parts.push(<span key={`c-${ci}`} className="hljs-comment">{inner}</span>);
    cursor = comment.end;
  });
  if (cursor < sqlText.length) {
    parts.push(<code key="sql-tail" className="hljs language-sql" dangerouslySetInnerHTML={{ __html: highlightSql(sqlText.slice(cursor)) }} />);
  }
  return <>{parts}</>;
}

/**
 * Outline coverage: every decision the optimizer wrote into the outline, credited to the
 * statement's own hint when one settled it. "3 of 5 decisions hinted" is the one-line answer
 * to "how much of this plan did my hints pin?".
 */
function PlanDecisions({ analysis, onPick }: { analysis: HintAnalysis; onPick: (nodeIds: number[]) => void }) {
  const { coverage, outline } = analysis;
  if (outline.length === 0) return null;
  const byFamily = new Map<string, HintMark[]>();
  for (const mark of outline) {
    const list = byFamily.get(mark.family) ?? [];
    list.push(mark);
    byFamily.set(mark.family, list);
  }
  return (
    <details className="group mt-4 rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900" data-testid="plan-decisions">
      <summary className={`flex items-center justify-between gap-2 px-3 py-2 cursor-pointer list-none select-none rounded-md ${FOCUS_RING_INSET}`}>
        <span className="text-[11px] font-medium text-slate-500 dark:text-slate-400">
          Plan decisions{' '}
          <span className="font-normal">
            — {coverage.decisions} in the outline, {coverage.hinted} settled by your hints
          </span>
        </span>
        <svg className="w-4 h-4 text-slate-300 group-open:rotate-180 transition-transform duration-200" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M19 9l-7 7-7-7" />
        </svg>
      </summary>
      <div className="px-3 pb-3 space-y-2">
        {[...byFamily.entries()].map(([family, marks]) => (
          <div key={family}>
            <div className="text-[10px] uppercase tracking-wide text-slate-400 dark:text-slate-500 mb-1">{HINT_FAMILY_LABELS[marks[0].family]}</div>
            <ul className="space-y-0.5">
              {marks.map((mark) => (
                <li key={mark.text} className="flex items-start gap-2 text-[11px]">
                  <span
                    className={`shrink-0 mt-px px-1.5 py-0.5 rounded border text-[10px] font-medium ${mark.hinted ? 'bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-900/30 dark:text-emerald-300 dark:border-emerald-800' : 'bg-slate-100 text-slate-600 border-slate-200 dark:bg-slate-800 dark:text-slate-300 dark:border-slate-700'}`}
                    title={mark.hinted ? 'Your hint settled this decision' : 'The optimizer made this decision on its own'}
                  >
                    {mark.hinted ? 'yours' : 'optimizer'}
                  </span>
                  {mark.nodeIds.length > 0 ? (
                    <button
                      type="button"
                      className={`min-w-0 text-left font-mono text-slate-800 dark:text-slate-200 break-all hover:underline ${FOCUS_RING}`}
                      title={`Select operation${mark.nodeIds.length > 1 ? 's' : ''} ${mark.nodeIds.join(', ')} in the tree`}
                      onClick={() => onPick(mark.nodeIds)}
                    >
                      {mark.text}
                    </button>
                  ) : (
                    <code className="min-w-0 font-mono text-slate-800 dark:text-slate-200 break-all">{mark.text}</code>
                  )}
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </details>
  );
}

/**
 * Counterfactual (DB-connector builds only): EXPLAIN PLAN the statement with its hint comments
 * removed on the connector's test connection and load the result as the second plan, so the
 * Compare tab's outline diff shows exactly which decisions the hints bought. EXPLAIN PLAN
 * peeks no binds and runs on the test schema, so the result is indicative, not proof.
 */
function ExplainWithoutHints({ sqlText }: { sqlText: string }) {
  const { plans, addPlanSlot, loadAndParsePlan, renamePlanSlot, setViewMode } = usePlan();
  const toast = useToast();
  const [reachable, setReachable] = useState(false);
  const [running, setRunning] = useState(false);
  useEffect(() => {
    let stale = false;
    agentHealth(loadStoredAgentConfig().baseUrl)
      .then(() => { if (!stale) setReachable(true); })
      .catch(() => { if (!stale) setReachable(false); });
    return () => { stale = true; };
  }, []);
  if (!reachable) return null;
  const full = plans.length >= 2;
  const run = async () => {
    setRunning(true);
    try {
      const { dbmsXplanText } = await agentTestExplain(loadStoredAgentConfig(), { sql: stripHintComments(sqlText) });
      const newIndex = plans.length;
      addPlanSlot();
      const ok = await loadAndParsePlan(dbmsXplanText, undefined, { recordRecent: false, skipConfirm: true });
      if (ok) {
        renamePlanSlot(newIndex, 'Without hints');
        setViewMode('compare');
        toast.show({ tone: 'info', title: 'Explained without hints', message: 'Loaded as the second plan. The Compare tab lists the decisions that changed; EXPLAIN PLAN peeks no binds, so treat it as indicative.' });
      }
    } catch (err) {
      toast.show({ tone: 'error', title: 'Explain without hints failed', message: err instanceof AgentError ? err.message : 'Connect the test database in DB Connect first.' });
    } finally {
      setRunning(false);
    }
  };
  return (
    <button
      type="button"
      className={`min-h-8 px-2.5 rounded-md border border-slate-300 dark:border-slate-600 text-xs text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 disabled:opacity-50 ${FOCUS_RING}`}
      disabled={running || full}
      title={full ? 'Two plans are already loaded — remove one to explain the unhinted statement into a new slot' : 'EXPLAIN PLAN this statement with its hint comments removed, on the connector\'s test connection, and compare'}
      onClick={() => void run()}
    >
      {running ? 'Explaining…' : 'Explain without hints'}
    </button>
  );
}

export function SqlTextView() {
  const { parsedPlan, selectNode, setViewMode, hintLens, setHintLens } = usePlan();

  const sqlText = parsedPlan?.sqlText;
  const outlineHints = parsedPlan?.outlineHints;
  const hintSummary = parsedPlan?.hintSummary;

  const analysis = useMemo(() => (parsedPlan && planHasHints(parsedPlan) ? analyzeHints(parsedPlan) : null), [parsedPlan]);
  const comments = useMemo(() => (sqlText ? extractSqlHints(sqlText) : []), [sqlText]);
  const index = useMemo(() => statusIndex(analysis), [analysis]);
  const highlightedHtml = useMemo(() => (sqlText && comments.length === 0 ? highlightSql(sqlText) : ''), [sqlText, comments.length]);

  const pick = (nodeIds: number[]) => {
    if (nodeIds.length === 0) return;
    selectNode(nodeIds[0]);
    setViewMode('hierarchical');
  };

  if (!sqlText && !(outlineHints && outlineHints.length > 0)) {
    return (
      <div className="h-full flex items-center justify-center bg-slate-50 dark:bg-slate-950">
        <p className="text-sm text-slate-500 dark:text-slate-400">
          No SQL text available for this plan.
        </p>
      </div>
    );
  }

  const counts = analysis?.counts;
  const hasReport = !!counts && counts.used + counts.unused + counts.error + counts.other > 0;

  return (
    <div className="h-full flex flex-col bg-slate-50 dark:bg-slate-950">
      {sqlText && (
        <div className="flex items-center justify-end gap-2 px-4 pt-3 pb-1">
          {isDbAgentEnabled() && comments.length > 0 && <ExplainWithoutHints sqlText={sqlText} />}
          {analysis && (
            <button
              type="button"
              className={`min-h-8 px-2.5 rounded-md border text-xs ${FOCUS_RING} ${hintLens ? 'border-slate-400 bg-slate-200/90 text-slate-900 dark:border-slate-500 dark:bg-slate-600/80 dark:text-white' : 'border-slate-300 dark:border-slate-600 text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800'}`}
              aria-pressed={hintLens}
              title="Hints lens — pin every operation a hint acts on in the tree and dim the rest"
              onClick={() => {
                setHintLens(!hintLens);
                if (!hintLens) setViewMode('hierarchical');
              }}
            >
              {hintLens ? 'Hints lens on' : 'Show hints in tree'}
            </button>
          )}
          <CopyButton
            text={sqlText}
            label="Copy SQL"
            copiedLabel="Copied"
            size="sm"
            className="border border-slate-300 dark:border-slate-600"
          />
        </div>
      )}
      <div className="flex-1 overflow-auto px-4 pb-4">
        {sqlText ? (
          <pre className="text-sm font-mono leading-relaxed whitespace-pre-wrap break-words">
            {comments.length > 0 ? (
              <HintedSql sqlText={sqlText} comments={comments} index={index} analysis={analysis} onPick={pick} />
            ) : (
              <code className="hljs language-sql" dangerouslySetInnerHTML={{ __html: highlightedHtml }} />
            )}
          </pre>
        ) : (
          <p className="pt-3 text-sm text-slate-500 dark:text-slate-400">No SQL text available for this plan.</p>
        )}

        {hasReport && counts && (
          <p className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-slate-500 dark:text-slate-400" data-testid="hint-legend">
            <span className="font-medium text-slate-600 dark:text-slate-300">Hints:</span>
            <span><span className={`inline-block w-2 h-2 rounded-sm mr-1 align-middle bg-emerald-400`} aria-hidden />{counts.used} used</span>
            {counts.unused > 0 && <span><span className="inline-block w-2 h-2 rounded-sm mr-1 align-middle bg-amber-400" aria-hidden />{counts.unused} not used</span>}
            {counts.error > 0 && <span><span className="inline-block w-2 h-2 rounded-sm mr-1 align-middle bg-red-400" aria-hidden />{counts.error} syntax error{counts.error === 1 ? '' : 's'}</span>}
            <span className="text-slate-400 dark:text-slate-500">Click a hint to select its operation.</span>
          </p>
        )}

        {hintSummary && (
          <p
            className={`mt-4 text-xs ${
              hintSummary.unused + hintSummary.errors > 0
                ? 'text-amber-700 dark:text-amber-300'
                : 'text-slate-500 dark:text-slate-400'
            }`}
          >
            {formatHintSummary(hintSummary)}
          </p>
        )}

        {analysis && <PlanDecisions analysis={analysis} onPick={pick} />}

        {outlineHints && outlineHints.length > 0 && (
          <details className="group mt-4 rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900">
            <summary
              className={`flex items-center justify-between gap-2 px-3 py-2 cursor-pointer list-none select-none rounded-md ${FOCUS_RING_INSET}`}
            >
              <span className="text-[11px] font-medium text-slate-500 dark:text-slate-400">
                Outline hints <span className="font-mono normal-case tracking-normal">({outlineHints.length})</span>
              </span>
              <svg className="w-4 h-4 text-slate-300 group-open:rotate-180 transition-transform duration-200" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M19 9l-7 7-7-7" />
              </svg>
            </summary>
            <div className="px-3 pb-3">
              <div className="flex justify-end mb-1.5">
                <CopyButton
                  text={outlineHintBlock(outlineHints)}
                  label="Copy as hint block"
                  copiedLabel="Copied"
                  size="sm"
                  className="border border-slate-300 dark:border-slate-600"
                />
              </div>
              <ul className="max-h-72 overflow-auto rounded border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 p-3 space-y-0.5">
                {outlineHints.map((hint, i) => (
                  <li key={i} className="text-xs font-mono text-slate-800 dark:text-slate-200 break-all">{hint}</li>
                ))}
              </ul>
            </div>
          </details>
        )}
      </div>
    </div>
  );
}
