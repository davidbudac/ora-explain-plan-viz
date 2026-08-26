// PROTOTYPE — throwaway UI prototype for wayfinder ticket 08 (non-expert analysis report design). Not production code.

/**
 * Variant C — "The Guided Path".
 *
 * A walkthrough: a numbered stepper where each step is a thing to *do*. The
 * repro builder is the natural last step rather than a bolted-on upsell.
 */

import { useState } from 'react';
import type { ReactNode } from 'react';
import type { MockFinding } from './mockReport';
import {
  BuilderPreviewCard,
  EffortChip,
  GoDeeperPill,
  Narrative,
  NarrativeSkeleton,
  NodePill,
  QuotaChip,
  SourceChip,
  SqlBlock,
  StatChip,
  type VariantProps,
} from './shared';
import { SEVERITY_DOT, SEVERITY_EDGE, SEVERITY_STYLES } from './styles';

function Step({
  index,
  title,
  locked,
  children,
  last = false,
}: {
  index: number;
  title: string;
  locked: boolean;
  children: ReactNode;
  last?: boolean;
}) {
  return (
    <li className="relative pl-11 pb-6">
      {!last && (
        <span
          className="absolute left-[13px] top-7 bottom-0 w-px bg-slate-200 dark:bg-slate-800"
          aria-hidden="true"
        />
      )}
      <span
        className={`absolute left-0 top-0 w-7 h-7 rounded-full flex items-center justify-center text-[12px] font-bold transition-colors duration-500 ${
          locked
            ? 'bg-slate-200 dark:bg-slate-800 text-slate-400 dark:text-slate-600'
            : 'bg-blue-600 text-white ring-4 ring-blue-500/10'
        }`}
      >
        {index}
      </span>
      <h2
        className={`text-[13px] font-semibold pt-1 transition-colors duration-500 ${
          locked ? 'text-slate-400 dark:text-slate-600' : 'text-slate-900 dark:text-slate-50'
        }`}
      >
        {title}
      </h2>
      <div
        className={`mt-2 transition-all duration-500 ease-out ${
          locked ? 'opacity-40 saturate-0 pointer-events-none' : 'opacity-100'
        }`}
      >
        {children}
      </div>
    </li>
  );
}

function EvidenceAccordionRow({ finding }: { finding: MockFinding }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="border-b border-slate-200 dark:border-slate-800 last:border-b-0">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="w-full flex items-center gap-2 px-2.5 py-2 text-left hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors"
      >
        <svg
          className={`w-3 h-3 shrink-0 text-slate-400 transition-transform ${open ? 'rotate-90' : ''}`}
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          aria-hidden="true"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M9 5l7 7-7 7" />
        </svg>
        <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${SEVERITY_DOT[finding.severity]}`} aria-hidden="true" />
        <span className="flex-1 min-w-0 text-[12px] font-semibold text-slate-700 dark:text-slate-200">
          {finding.title}
        </span>
        <SourceChip source={finding.source} />
      </button>
      {open && (
        <div className="px-2.5 pb-2.5 pl-8 space-y-2">
          <p className="text-[12px] leading-relaxed text-slate-600 dark:text-slate-300">{finding.explanation}</p>
          <div className="flex flex-wrap gap-1.5">
            {finding.nodeRefs.map((ref) => (
              <NodePill key={`${finding.id}-${ref.id}`} nodeRef={ref} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function BeforeAfter() {
  return (
    <div className="flex flex-wrap items-center gap-2 rounded-md border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-900/50 px-3 py-2">
      <span className="inline-flex items-center rounded-full border border-red-300 dark:border-red-900 bg-red-50 dark:bg-red-950/40 px-2 py-0.5 font-mono text-[11px] font-semibold text-red-700 dark:text-red-300 line-through decoration-red-500/70">
        NESTED LOOPS (20,000 starts)
      </span>
      <span className="text-slate-400 dark:text-slate-600" aria-hidden="true">
        →
      </span>
      <span className="inline-flex items-center rounded-full border border-emerald-300 dark:border-emerald-900 bg-emerald-50 dark:bg-emerald-950/40 px-2 py-0.5 font-mono text-[11px] font-semibold text-emerald-700 dark:text-emerald-300">
        HASH JOIN (1 pass)
      </span>
    </div>
  );
}

export function VariantC({ report, phase, streamedParagraphs }: VariantProps) {
  const complete = phase === 'complete';
  const locked = !complete;
  const [stopgapOpen, setStopgapOpen] = useState(false);

  const [fixAction, verifyAction, stopgapAction] = report.actions;

  return (
    <div className="h-full overflow-auto bg-white dark:bg-slate-900">
      <div className="mx-auto max-w-2xl px-6 py-6 pb-28">
        {/* Hero verdict */}
        <div className="text-center">
          <div className="flex items-center justify-center gap-2">
            <span
              className={`inline-flex items-center rounded-full px-2 py-px text-[10px] font-bold uppercase tracking-wide ${SEVERITY_STYLES[report.verdict.severity].chip}`}
            >
              Critical
            </span>
            <GoDeeperPill label={report.deepAnalysisChip} />
          </div>
          <h1
            className={`mx-auto mt-3 max-w-xl text-[19px] font-semibold leading-snug text-slate-900 dark:text-slate-50 border-l-4 ${SEVERITY_EDGE[report.verdict.severity]} pl-4 text-left`}
          >
            {report.verdict.headline}
          </h1>
          <p className="mt-3 text-[13px] leading-relaxed text-slate-600 dark:text-slate-300">
            {report.verdict.detail}
          </p>
          <div className="mt-3 flex flex-wrap justify-center gap-1.5">
            {report.verdict.statChips.map((chip) => (
              <StatChip key={chip} label={chip} />
            ))}
          </div>
        </div>

        {/* Stepper */}
        <ol className="mt-8">
          <Step index={1} title="See what went wrong" locked={false}>
            <div className="space-y-3">
              {phase === 'verdict' ? (
                <NarrativeSkeleton lines={7} />
              ) : (
                <div>
                  {streamedParagraphs.map((text, i) => (
                    <p key={i} className="text-[13px] leading-[1.75] text-slate-700 dark:text-slate-200 mb-3">
                      <Narrative text={text} caret={i === streamedParagraphs.length - 1 && phase === 'streaming'} />
                    </p>
                  ))}
                </div>
              )}

              <div className="rounded-lg border border-slate-200 dark:border-slate-800 overflow-hidden">
                <div className="px-2.5 py-1.5 bg-slate-50 dark:bg-slate-900/60 border-b border-slate-200 dark:border-slate-800 text-[10px] font-bold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                  Evidence · {report.findings.length} findings
                </div>
                {report.findings.map((finding) => (
                  <EvidenceAccordionRow key={finding.id} finding={finding} />
                ))}
              </div>
            </div>
          </Step>

          <Step index={2} title="Fix the statistics" locked={locked}>
            <div className="space-y-2">
              <div className="flex flex-wrap items-center gap-2">
                <h3 className="text-[12.5px] font-semibold text-slate-800 dark:text-slate-100">{fixAction.title}</h3>
                <EffortChip label={fixAction.effortChip} />
              </div>
              <p className="text-[12.5px] leading-relaxed text-slate-600 dark:text-slate-300">{fixAction.body}</p>
              {fixAction.sql && <SqlBlock sql={fixAction.sql} />}
            </div>
          </Step>

          <Step index={3} title="Verify the new plan" locked={locked}>
            <div className="space-y-2.5">
              <div className="flex flex-wrap items-center gap-2">
                <h3 className="text-[12.5px] font-semibold text-slate-800 dark:text-slate-100">
                  {verifyAction.title}
                </h3>
                <EffortChip label={verifyAction.effortChip} />
              </div>
              <p className="text-[12.5px] leading-relaxed text-slate-600 dark:text-slate-300">{verifyAction.body}</p>
              <BeforeAfter />

              <div className="pt-1">
                <button
                  type="button"
                  onClick={() => setStopgapOpen((v) => !v)}
                  aria-expanded={stopgapOpen}
                  className="text-[11px] font-semibold text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200 underline decoration-dotted underline-offset-2 transition-colors"
                >
                  Can’t change statistics? {stopgapOpen ? 'Hide' : 'Show'} the stopgap
                </button>
                {stopgapOpen && (
                  <div className="mt-2 space-y-2 border-l-2 border-slate-200 dark:border-slate-800 pl-3">
                    <div className="flex flex-wrap items-center gap-2">
                      <h4 className="text-[12px] font-semibold text-slate-700 dark:text-slate-200">
                        {stopgapAction.title}
                      </h4>
                      <EffortChip label={stopgapAction.effortChip} />
                    </div>
                    <p className="text-[12px] leading-relaxed text-slate-600 dark:text-slate-300">
                      {stopgapAction.body}
                    </p>
                    {stopgapAction.sql && <SqlBlock sql={stopgapAction.sql} />}
                  </div>
                )}
              </div>
            </div>
          </Step>

          <Step index={4} title="Prove it before production" locked={locked} last>
            <BuilderPreviewCard preview={report.builderPreview} />
          </Step>
        </ol>

        <div className="flex justify-center pt-2">
          <QuotaChip label={report.quotaChip} />
        </div>
      </div>
    </div>
  );
}
