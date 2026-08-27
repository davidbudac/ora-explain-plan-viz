// PROTOTYPE — throwaway UI prototype for wayfinder ticket 08 (non-expert analysis report design). Not production code.

import { useState } from 'react';
import type { ReactNode } from 'react';
import { usePlan } from '../../../hooks/usePlanContext';
import { copyToClipboard } from '../../../lib/clipboard';
import {
  DEEP_ANALYSIS_TOOLTIP,
  SOURCE_CHIP_TOOLTIP,
  type FindingSource,
  type MockAiReport,
  type MockBuilderPreview,
  type MockNodeRef,
} from './mockReport';
import type { StreamPhase } from './useSimulatedStream';

/** Props every variant receives from the switcher shell. */
export interface VariantProps {
  report: MockAiReport;
  phase: StreamPhase;
  streamedParagraphs: string[];
}

// ---------------------------------------------------------------------------
// Icons (outline, matching the app's existing icon style)
// ---------------------------------------------------------------------------

export function SparkleIcon({ className = 'w-3 h-3' }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 3l1.8 4.7L18.5 9.5 13.8 11.3 12 16l-1.8-4.7L5.5 9.5l4.7-1.8L12 3zM18 15l.9 2.3 2.3.9-2.3.9L18 21.4l-.9-2.3-2.3-.9 2.3-.9L18 15z" />
    </svg>
  );
}

export function ShieldIcon({ className = 'w-3 h-3' }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 3l7 3v5.5c0 4.2-2.9 8.1-7 9.5-4.1-1.4-7-5.3-7-9.5V6l7-3z" />
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.5 12l1.8 1.8 3.4-3.6" />
    </svg>
  );
}

export function LockIcon({ className = 'w-3 h-3' }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 11V8a5 5 0 0110 0v3M6 11h12a1 1 0 011 1v7a1 1 0 01-1 1H6a1 1 0 01-1-1v-7a1 1 0 011-1z" />
    </svg>
  );
}

// ---------------------------------------------------------------------------
// Inline plan-step links
// ---------------------------------------------------------------------------

/**
 * A plain-language link into the plan tree. The label leads; the step number is
 * secondary, so a non-expert never has to read the plan to follow the prose.
 */
export function NodePill({ nodeRef }: { nodeRef: MockNodeRef }) {
  const { selectNode, setViewMode } = usePlan();
  return (
    <button
      type="button"
      onClick={() => {
        selectNode(nodeRef.id);
        setViewMode('hierarchical');
      }}
      title={`Show "${nodeRef.label}" (step ${nodeRef.id}) in the plan tree`}
      className="inline-flex items-baseline gap-1 rounded border border-slate-300 dark:border-slate-600 bg-slate-100/70 dark:bg-slate-800/70 px-1.5 py-px text-[11px] font-medium text-slate-700 dark:text-slate-200 hover:bg-blue-100 dark:hover:bg-blue-900/40 hover:border-blue-400 dark:hover:border-blue-500 transition-colors align-baseline"
    >
      <span>{nodeRef.label}</span>
      <span className="font-mono text-[10px] text-slate-500 dark:text-slate-400">· step {nodeRef.id}</span>
    </button>
  );
}

const NARRATIVE_TOKEN = /(\{\{\d+\|[^}]*\}\})/g;

/**
 * Render a narrative paragraph, turning `{{id|label}}` tokens into node pills.
 * Deliberately dumb: one split, one map.
 */
export function Narrative({ text, caret = false }: { text: string; caret?: boolean }) {
  const parts = text.split(NARRATIVE_TOKEN);
  return (
    <>
      {parts.map((part, i) => {
        const match = /^\{\{(\d+)\|([^}]*)\}\}$/.exec(part);
        if (match) {
          return <NodePill key={i} nodeRef={{ id: Number(match[1]), label: match[2] }} />;
        }
        return <span key={i}>{part}</span>;
      })}
      {caret && <span className="animate-pulse text-blue-500 dark:text-blue-400">▍</span>}
    </>
  );
}

/** Render `**bold**` spans in mock copy. */
export function BoldText({ text }: { text: string }) {
  return (
    <>
      {text.split(/(\*\*[^*]+\*\*)/g).map((part, i) =>
        part.startsWith('**') && part.endsWith('**') ? (
          <strong key={i} className="font-semibold text-slate-800 dark:text-slate-100">
            {part.slice(2, -2)}
          </strong>
        ) : (
          <span key={i}>{part}</span>
        ),
      )}
    </>
  );
}

// ---------------------------------------------------------------------------
// Chips
// ---------------------------------------------------------------------------

export function SourceChip({ source }: { source: FindingSource }) {
  const isAdvisor = source === 'advisor';
  return (
    <span
      title={SOURCE_CHIP_TOOLTIP[source]}
      className={`inline-flex items-center gap-1 rounded-full border px-1.5 py-px text-[10px] font-semibold whitespace-nowrap ${
        isAdvisor
          ? 'border-slate-300 dark:border-slate-600 text-slate-600 dark:text-slate-300 bg-slate-50 dark:bg-slate-800/60'
          : 'border-violet-300 dark:border-violet-700 text-violet-700 dark:text-violet-300 bg-violet-50 dark:bg-violet-950/40'
      }`}
    >
      {isAdvisor ? <ShieldIcon /> : <SparkleIcon />}
      {isAdvisor ? 'Verified check' : 'AI insight'}
    </span>
  );
}

export function StatChip({ label }: { label: string }) {
  return (
    <span className="inline-flex items-center rounded-full border border-slate-200 dark:border-slate-700 bg-white/70 dark:bg-slate-900/50 px-2 py-0.5 text-[11px] font-medium text-slate-700 dark:text-slate-200 whitespace-nowrap">
      {label}
    </span>
  );
}

export function QuotaChip({ label }: { label: string }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-full border border-emerald-300 dark:border-emerald-800 bg-emerald-50 dark:bg-emerald-950/40 px-2 py-0.5 text-[10px] font-semibold text-emerald-700 dark:text-emerald-300 whitespace-nowrap">
      <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" aria-hidden="true" />
      {label}
    </span>
  );
}

export function GoDeeperPill({ label }: { label: string }) {
  return (
    <button
      type="button"
      disabled
      title={DEEP_ANALYSIS_TOOLTIP}
      className="inline-flex items-center gap-1 rounded-full border border-dashed border-violet-300 dark:border-violet-800 bg-violet-50/60 dark:bg-violet-950/30 px-2.5 py-1 text-[11px] font-semibold text-violet-600/80 dark:text-violet-300/80 cursor-not-allowed"
    >
      <LockIcon className="w-3 h-3" />
      {label}
    </button>
  );
}

export function EffortChip({ label }: { label: string }) {
  return (
    <span className="inline-flex items-center rounded border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/60 px-1.5 py-px text-[10px] font-medium text-slate-500 dark:text-slate-400 whitespace-nowrap">
      {label}
    </span>
  );
}

// ---------------------------------------------------------------------------
// SQL block
// ---------------------------------------------------------------------------

export function SqlBlock({ sql }: { sql: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="relative group">
      <pre className="rounded border border-slate-800 bg-slate-950 px-3 py-2 pr-16 text-[11px] leading-relaxed font-mono text-slate-100 overflow-x-auto">
        {sql}
      </pre>
      <button
        type="button"
        onClick={async () => {
          const ok = await copyToClipboard(sql);
          if (ok) {
            setCopied(true);
            setTimeout(() => setCopied(false), 1200);
          }
        }}
        className="absolute top-1.5 right-1.5 rounded border border-slate-700 bg-slate-800/90 px-1.5 py-0.5 text-[10px] font-semibold text-slate-300 hover:bg-slate-700 hover:text-white transition-colors"
      >
        {copied ? 'Copied' : 'Copy'}
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Builder preview (the locked upsell)
// ---------------------------------------------------------------------------

function FidelityMeter({ preview, compact }: { preview: MockBuilderPreview; compact: boolean }) {
  return (
    <div className="flex items-stretch gap-1">
      {preview.rungs.map((rung, i) => (
        <div key={rung.id} className="flex items-stretch gap-1 flex-1 min-w-0">
          <div
            className={`flex-1 min-w-0 rounded border px-1.5 py-1 transition-colors ${
              rung.state === 'locked'
                ? 'border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-900/40 text-slate-400 dark:text-slate-600'
                : rung.state === 'current'
                  ? 'border-blue-400 dark:border-blue-600 bg-blue-50 dark:bg-blue-950/50 text-blue-800 dark:text-blue-200 ring-1 ring-blue-400/60'
                  : 'border-blue-200 dark:border-blue-900 bg-blue-50/50 dark:bg-blue-950/25 text-blue-700 dark:text-blue-300'
            }`}
          >
            <div className="flex items-center gap-1 font-mono text-[10px] font-bold">
              {rung.id}
              {rung.state === 'locked' && <LockIcon className="w-2.5 h-2.5" />}
            </div>
            <div className="truncate text-[10px] font-medium">{rung.label}</div>
            {rung.state === 'current' && !compact && (
              <div className="mt-0.5 text-[9px] font-semibold uppercase tracking-wide text-blue-600 dark:text-blue-400">
                you are here
              </div>
            )}
          </div>
          {i < preview.rungs.length - 1 && (
            <span className="self-center text-[10px] text-slate-300 dark:text-slate-700" aria-hidden="true">
              →
            </span>
          )}
        </div>
      ))}
    </div>
  );
}

function FilePreviewRow({ files }: { files: string[] }) {
  return (
    <div className="flex items-center gap-2 rounded border border-dashed border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-900/40 px-2 py-1.5 select-none">
      {files.map((file) => (
        <span
          key={file}
          className="font-mono text-[10px] text-slate-500 dark:text-slate-500 blur-[1.6px] opacity-70"
        >
          {file}
        </span>
      ))}
    </div>
  );
}

/**
 * The locked "reproducible test case" card. Reads as the next natural step of
 * the analysis (with a concrete fidelity readout), not as an ad.
 */
export function BuilderPreviewCard({
  preview,
  compact = false,
  leadIn,
}: {
  preview: MockBuilderPreview;
  compact?: boolean;
  leadIn?: string;
}) {
  return (
    <div className="rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-900/60 p-3">
      {leadIn && (
        <p className="mb-2 text-[12px] italic text-slate-500 dark:text-slate-400 leading-relaxed">{leadIn}</p>
      )}
      <div className="flex items-center gap-2 mb-2">
        <LockIcon className="w-3.5 h-3.5 text-slate-400 dark:text-slate-500" />
        <h3 className="text-sm font-semibold text-slate-800 dark:text-slate-100">{preview.title}</h3>
        <span className="rounded-full bg-amber-100 dark:bg-amber-950/60 text-amber-700 dark:text-amber-300 px-2 py-px text-[10px] font-semibold">
          {preview.creditChip}
        </span>
      </div>

      <div className={compact ? 'grid grid-cols-2 gap-3 items-start' : 'space-y-2.5'}>
        <div className={compact ? '' : 'space-y-2.5'}>
          <FidelityMeter preview={preview} compact={compact} />
          {compact && (
            <p className="mt-2 text-[11px] text-slate-600 dark:text-slate-300 leading-relaxed">
              <BoldText text={preview.copy} />
            </p>
          )}
        </div>

        {!compact && (
          <p className="text-[12px] text-slate-600 dark:text-slate-300 leading-relaxed">
            <BoldText text={preview.copy} />
          </p>
        )}

        <div className={compact ? 'space-y-2' : 'space-y-2'}>
          <FilePreviewRow files={preview.files} />
          <div className="flex items-center justify-between gap-2">
            <p className="text-[10px] text-slate-500 dark:text-slate-500">{preview.footnote}</p>
            <button
              type="button"
              disabled
              title="Prototype — not wired"
              className="shrink-0 rounded-md bg-slate-300 dark:bg-slate-700 px-3 py-1.5 text-[11px] font-semibold text-slate-500 dark:text-slate-400 cursor-not-allowed"
            >
              {preview.buttonLabel}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Streaming affordances
// ---------------------------------------------------------------------------

/** Shimmer placeholder shown while the narrative hasn't started arriving. */
export function NarrativeSkeleton({ lines = 6 }: { lines?: number }) {
  const widths = ['w-full', 'w-11/12', 'w-full', 'w-10/12', 'w-full', 'w-8/12', 'w-full', 'w-9/12'];
  return (
    <div className="space-y-2 animate-pulse" aria-hidden="true">
      {Array.from({ length: lines }).map((_, i) => (
        <div key={i} className={`h-3 rounded bg-slate-200 dark:bg-slate-800 ${widths[i % widths.length]}`} />
      ))}
    </div>
  );
}

/** Fade/slide-in wrapper for structured content that lands after the stream. */
export function RevealOnComplete({
  show,
  children,
  className = '',
}: {
  show: boolean;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={`transition-all duration-500 ease-out ${
        show ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-2 pointer-events-none'
      } ${className}`}
    >
      {children}
    </div>
  );
}
