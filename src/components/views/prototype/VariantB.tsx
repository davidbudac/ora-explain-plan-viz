// PROTOTYPE — throwaway UI prototype for wayfinder ticket 08 (non-expert analysis report design). Not production code.

/**
 * Variant B — "The Triage Board".
 *
 * An ops console: a severity-ranked list on the left, a working pane on the
 * right that swaps between an overview and per-finding detail. The primary
 * affordance is *scanning and drilling in*.
 */

import { useState } from 'react';
import type { MockAiReport, MockFinding, ReportSeverity } from './mockReport';
import {
  BuilderPreviewCard,
  EffortChip,
  GoDeeperPill,
  Narrative,
  NarrativeSkeleton,
  NodePill,
  QuotaChip,
  RevealOnComplete,
  SourceChip,
  SqlBlock,
  StatChip,
  type VariantProps,
} from './shared';
import { SEVERITY_DOT, SEVERITY_LABEL, SEVERITY_STYLES } from './styles';

const SEVERITY_RANK: Record<ReportSeverity, number> = { critical: 0, warning: 1, info: 2 };

function FindingRow({
  finding,
  selected,
  onSelect,
}: {
  finding: MockFinding;
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      className={`w-full text-left flex items-start gap-2 px-2.5 py-2 rounded-md border transition-colors ${
        selected
          ? 'border-blue-400 dark:border-blue-600 bg-blue-50 dark:bg-blue-950/40'
          : 'border-transparent hover:border-slate-200 dark:hover:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800/60'
      }`}
    >
      <span className={`mt-1.5 w-1.5 h-1.5 rounded-full shrink-0 ${SEVERITY_DOT[finding.severity]}`} aria-hidden="true" />
      <span className="min-w-0 flex-1">
        <span className="block text-[12px] font-semibold leading-snug text-slate-700 dark:text-slate-200">
          {finding.title}
        </span>
        <span className="mt-1 block">
          <SourceChip source={finding.source} />
        </span>
      </span>
      <svg
        className="mt-1 w-3 h-3 shrink-0 text-slate-400 dark:text-slate-600"
        fill="none"
        viewBox="0 0 24 24"
        stroke="currentColor"
        aria-hidden="true"
      >
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M9 5l7 7-7 7" />
      </svg>
    </button>
  );
}

function EvidenceGrid({ finding }: { finding: MockFinding }) {
  return (
    <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
      {finding.evidence.map((tile) => (
        <div
          key={tile.label}
          className="rounded-md border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-900/50 px-2.5 py-2"
        >
          <div className="text-[10px] uppercase tracking-wide text-slate-500 dark:text-slate-400">{tile.label}</div>
          <div className="mt-0.5 font-mono text-sm font-bold text-slate-800 dark:text-slate-100">{tile.value}</div>
        </div>
      ))}
    </div>
  );
}

function FindingDetail({
  finding,
  report,
  onBack,
}: {
  finding: MockFinding;
  report: MockAiReport;
  onBack: () => void;
}) {
  const action = finding.actionIndex !== undefined ? report.actions[finding.actionIndex] : undefined;
  const styles = SEVERITY_STYLES[finding.severity];

  return (
    <div className="space-y-4">
      <button
        type="button"
        onClick={onBack}
        className="inline-flex items-center gap-1 text-[11px] font-semibold text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200 transition-colors"
      >
        <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M15 19l-7-7 7-7" />
        </svg>
        Back to overview
      </button>

      <div>
        <div className="flex flex-wrap items-center gap-2">
          <span className={`inline-flex items-center rounded-full px-2 py-px text-[10px] font-bold uppercase tracking-wide ${styles.chip}`}>
            {SEVERITY_LABEL[finding.severity]}
          </span>
          <SourceChip source={finding.source} />
        </div>
        <h2 className="mt-2 text-base font-semibold leading-snug text-slate-900 dark:text-slate-50">
          {finding.title}
        </h2>
        <p className="mt-2 text-[13px] leading-relaxed text-slate-600 dark:text-slate-300">{finding.explanation}</p>
      </div>

      <div>
        <h3 className="text-[11px] font-bold uppercase tracking-wide text-slate-500 dark:text-slate-400 mb-1.5">
          Evidence
        </h3>
        <EvidenceGrid finding={finding} />
      </div>

      <div>
        <h3 className="text-[11px] font-bold uppercase tracking-wide text-slate-500 dark:text-slate-400 mb-1.5">
          Where in the plan
        </h3>
        <div className="flex flex-wrap gap-1.5">
          {finding.nodeRefs.map((ref) => (
            <NodePill key={`${finding.id}-${ref.id}`} nodeRef={ref} />
          ))}
        </div>
      </div>

      {action && (
        <div className="rounded-lg border border-slate-200 dark:border-slate-800 p-3 space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-[11px] font-bold uppercase tracking-wide text-slate-500 dark:text-slate-400">Fix</h3>
            <EffortChip label={action.effortChip} />
          </div>
          <p className="text-[13px] font-semibold text-slate-800 dark:text-slate-100">{action.title}</p>
          <p className="text-[12.5px] leading-relaxed text-slate-600 dark:text-slate-300">{action.body}</p>
          {action.sql && <SqlBlock sql={action.sql} />}
        </div>
      )}
    </div>
  );
}

function Overview({ report, phase, streamedParagraphs }: VariantProps) {
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-1.5">
        {report.verdict.statChips.map((chip) => (
          <StatChip key={chip} label={chip} />
        ))}
      </div>

      <p className="text-[13px] leading-relaxed text-slate-600 dark:text-slate-300">{report.verdict.detail}</p>

      <div className="border-t border-slate-200 dark:border-slate-800 pt-3">
        {phase === 'verdict' ? (
          <NarrativeSkeleton lines={7} />
        ) : (
          streamedParagraphs.map((text, i) => (
            <p key={i} className="text-[13px] leading-[1.75] text-slate-700 dark:text-slate-200 mb-3">
              <Narrative text={text} caret={i === streamedParagraphs.length - 1 && phase === 'streaming'} />
            </p>
          ))
        )}
      </div>

      <RevealOnComplete show={phase === 'complete'}>
        <p className="text-[11px] text-slate-500 dark:text-slate-400 italic">
          Pick a finding on the left for the numbers behind it and the fix.
        </p>
      </RevealOnComplete>
    </div>
  );
}

export function VariantB(props: VariantProps) {
  const { report, phase } = props;
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const ranked = [...report.findings].sort(
    (a, b) => SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity],
  );
  const selected = ranked.find((f) => f.id === selectedId) ?? null;

  return (
    <div className="h-full grid grid-cols-[20rem_1fr] bg-white dark:bg-slate-900">
      {/* Left rail */}
      <div className="flex flex-col min-h-0 border-r border-slate-200 dark:border-slate-800 bg-slate-50/60 dark:bg-slate-900/60">
        <div className="shrink-0 px-3 py-2.5 border-b border-slate-200 dark:border-slate-800">
          <div className="flex items-start gap-2">
            <span
              className={`mt-1.5 w-2 h-2 rounded-full shrink-0 ${SEVERITY_DOT[report.verdict.severity]}`}
              aria-hidden="true"
            />
            <p className="text-[12px] font-semibold leading-snug text-slate-800 dark:text-slate-100">
              {report.verdict.headline}
            </p>
          </div>
        </div>

        <div className="shrink-0 px-3 pt-2.5 pb-1 text-[10px] font-bold uppercase tracking-wide text-slate-500 dark:text-slate-400">
          Findings · {ranked.length}
        </div>

        <div className="flex-1 min-h-0 overflow-auto px-2 pb-2 space-y-1">
          {ranked.map((finding) => (
            <FindingRow
              key={finding.id}
              finding={finding}
              selected={finding.id === selectedId}
              onSelect={() => setSelectedId(finding.id)}
            />
          ))}
        </div>

        <div className="shrink-0 px-3 py-2 border-t border-slate-200 dark:border-slate-800">
          <QuotaChip label={report.quotaChip} />
        </div>
      </div>

      {/* Right pane */}
      <div className="flex flex-col min-h-0">
        <div className="shrink-0 flex items-center justify-between gap-3 px-4 py-2 border-b border-slate-200 dark:border-slate-800">
          <div className="flex items-center gap-2 min-w-0">
            <h1 className="text-sm font-semibold text-slate-900 dark:text-slate-50 truncate">
              {selected ? 'Finding detail' : 'Overview'}
            </h1>
            {phase !== 'complete' && (
              <span className="text-[10px] font-semibold text-blue-600 dark:text-blue-400 animate-pulse">
                analysing…
              </span>
            )}
          </div>
          <GoDeeperPill label={report.deepAnalysisChip} />
        </div>

        <div className="flex-1 min-h-0 overflow-auto px-4 py-4">
          {selected ? (
            <FindingDetail finding={selected} report={report} onBack={() => setSelectedId(null)} />
          ) : (
            <Overview {...props} />
          )}
        </div>

        {/* pb-14 keeps the dock clear of the floating variant switcher */}
        <div className="shrink-0 border-t border-slate-200 dark:border-slate-800 px-3 pt-3 pb-14 bg-slate-50/60 dark:bg-slate-900/60">
          <BuilderPreviewCard preview={report.builderPreview} compact />
        </div>
      </div>
    </div>
  );
}
