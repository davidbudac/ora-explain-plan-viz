// PROTOTYPE — throwaway UI prototype for wayfinder ticket 08 (non-expert analysis report design). Not production code.

/**
 * Variant A — "The Memo".
 *
 * A written report from an expert: one centered scrolling column, document
 * hierarchy, findings landing as marginal callouts inside the prose they
 * belong to. The primary affordance is *reading*.
 */

import type { MockFinding } from './mockReport';
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
import { SEVERITY_DOT, SEVERITY_EDGE, SEVERITY_STYLES } from './styles';

/** Which findings interrupt the prose after each paragraph (0-based). */
const FINDINGS_AFTER_PARAGRAPH: Record<number, string[]> = {
  0: ['f1', 'f3'],
  2: ['f2'],
  3: ['f4'],
};

function FindingCallout({ finding }: { finding: MockFinding }) {
  const styles = SEVERITY_STYLES[finding.severity];
  return (
    <div
      className={`my-3 ml-4 rounded-r border-l-2 ${SEVERITY_EDGE[finding.severity]} ${styles.banner} border-y border-r border-slate-200 dark:border-slate-800 px-3 py-2`}
    >
      <div className="flex items-start gap-2">
        <span className={`mt-1.5 w-1.5 h-1.5 rounded-full shrink-0 ${SEVERITY_DOT[finding.severity]}`} aria-hidden="true" />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h4 className="text-[12px] font-semibold text-slate-800 dark:text-slate-100">{finding.title}</h4>
            <SourceChip source={finding.source} />
          </div>
          <p className="mt-1 text-[12px] leading-relaxed text-slate-600 dark:text-slate-300">
            {finding.explanation}
          </p>
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            {finding.nodeRefs.map((ref) => (
              <NodePill key={`${finding.id}-${ref.id}`} nodeRef={ref} />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

export function VariantA({ report, phase, streamedParagraphs }: VariantProps) {
  const complete = phase === 'complete';
  const byId = new Map(report.findings.map((f) => [f.id, f]));

  return (
    <div className="h-full overflow-auto bg-white dark:bg-slate-900">
      <div className="mx-auto max-w-3xl px-6 py-6 pb-28">
        {/* Document header */}
        <div className="flex items-start justify-between gap-4 border-b border-slate-200 dark:border-slate-800 pb-3">
          <div>
            <h1 className="text-lg font-semibold text-slate-900 dark:text-slate-50">AI analysis</h1>
            <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">
              Plan 96d05a34rtfqx · written for a developer, not a DBA
            </p>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <QuotaChip label={report.quotaChip} />
            <GoDeeperPill label={report.deepAnalysisChip} />
          </div>
        </div>

        {/* Verdict */}
        <div
          className={`mt-5 rounded-r border-l-4 ${SEVERITY_EDGE[report.verdict.severity]} ${SEVERITY_STYLES[report.verdict.severity].banner} px-4 py-3`}
        >
          <h2 className="text-[17px] font-semibold leading-snug text-slate-900 dark:text-slate-50">
            {report.verdict.headline}
          </h2>
          <p className="mt-2 text-[13px] leading-relaxed text-slate-600 dark:text-slate-300">
            {report.verdict.detail}
          </p>
          <div className="mt-3 flex flex-wrap gap-1.5">
            {report.verdict.statChips.map((chip) => (
              <StatChip key={chip} label={chip} />
            ))}
          </div>
        </div>

        {/* Narrative + inline finding callouts */}
        <div className="mt-6">
          {phase === 'verdict' ? (
            <NarrativeSkeleton lines={8} />
          ) : (
            streamedParagraphs.map((text, i) => {
              const isLast = i === streamedParagraphs.length - 1;
              const inlineFindings = complete ? FINDINGS_AFTER_PARAGRAPH[i] ?? [] : [];
              return (
                <div key={i}>
                  <p className="text-[13.5px] leading-[1.75] text-slate-700 dark:text-slate-200 mb-3">
                    <Narrative text={text} caret={isLast && phase === 'streaming'} />
                  </p>
                  {inlineFindings.map((id) => {
                    const finding = byId.get(id);
                    return finding ? (
                      <RevealOnComplete key={id} show={complete}>
                        <FindingCallout finding={finding} />
                      </RevealOnComplete>
                    ) : null;
                  })}
                </div>
              );
            })
          )}
        </div>

        {/* What to do next */}
        <RevealOnComplete show={complete} className="mt-7">
          <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-50 border-b border-slate-200 dark:border-slate-800 pb-1.5">
            What to do next
          </h2>
          <ol className="mt-4 space-y-5">
            {report.actions.map((action, i) => (
              <li key={action.title} className="flex gap-3">
                <span className="mt-0.5 shrink-0 w-6 h-6 rounded-full bg-slate-800 dark:bg-slate-200 text-white dark:text-slate-900 text-[11px] font-bold flex items-center justify-center">
                  {i + 1}
                </span>
                <div className="min-w-0 flex-1 space-y-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <h3 className="text-[13px] font-semibold text-slate-800 dark:text-slate-100">{action.title}</h3>
                    <EffortChip label={action.effortChip} />
                  </div>
                  <p className="text-[12.5px] leading-relaxed text-slate-600 dark:text-slate-300">{action.body}</p>
                  {action.sql && <SqlBlock sql={action.sql} />}
                </div>
              </li>
            ))}
          </ol>
        </RevealOnComplete>

        {/* Closing recommendation */}
        <RevealOnComplete show={complete} className="mt-7">
          <BuilderPreviewCard
            preview={report.builderPreview}
            leadIn="To be sure the fix works before production, reproduce this exact plan on a scratch database first."
          />
        </RevealOnComplete>
      </div>
    </div>
  );
}
