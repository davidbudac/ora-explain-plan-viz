import { useState } from 'react';
import { usePlan } from '../hooks/usePlanContext';
import type { FindingSeverity, Finding } from '../lib/advisor';
import { SEVERITY_STYLES } from '../lib/severityStyles';

const SEVERITY_ORDER: FindingSeverity[] = ['critical', 'warning', 'info'];
const SEVERITY_LABELS: Record<FindingSeverity, { singular: string; plural: string }> = {
  critical: { singular: 'critical', plural: 'critical' },
  warning: { singular: 'warning', plural: 'warnings' },
  info: { singular: 'info', plural: 'info' },
};

function severityCountsLabel(counts: Record<FindingSeverity, number>): string {
  return SEVERITY_ORDER
    .filter((severity) => counts[severity] > 0)
    .map((severity) => {
      const count = counts[severity];
      const label = count === 1 ? SEVERITY_LABELS[severity].singular : SEVERITY_LABELS[severity].plural;
      return `${count} ${label}`;
    })
    .join(' · ');
}

function SeverityDot({ severity }: { severity: FindingSeverity }) {
  const dotColor = severity === 'critical' ? 'bg-red-500' : severity === 'warning' ? 'bg-amber-500' : 'bg-sky-500';
  return <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${dotColor}`} aria-hidden="true" />;
}

function FindingRow({ finding, onNavigate }: { finding: Finding; onNavigate: (nodeId: number) => void }) {
  const [expanded, setExpanded] = useState(false);
  const styles = SEVERITY_STYLES[finding.severity];
  const nodeId = finding.nodeIds[0];
  const canNavigate = nodeId !== undefined;

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
        <SeverityDot severity={finding.severity} />
        <button
          type="button"
          onClick={() => canNavigate && onNavigate(nodeId)}
          disabled={!canNavigate}
          className={`flex-1 min-w-0 flex items-center gap-1.5 text-left font-mono ${canNavigate ? '' : 'cursor-default'}`}
        >
          {canNavigate && (
            <span className="w-4 h-4 rounded bg-slate-700 dark:bg-slate-300 text-white dark:text-slate-900 text-[9px] font-bold flex items-center justify-center shrink-0">
              {nodeId}
            </span>
          )}
          <span className="truncate font-semibold text-slate-700 dark:text-slate-200">{finding.title}</span>
        </button>
      </div>
      {expanded && (
        <div className="px-2 pb-2 pl-9 space-y-1">
          <p className="text-[11px] text-slate-600 dark:text-slate-300 leading-snug">{finding.explanation}</p>
          <p className={`text-[11px] italic leading-snug ${styles.text}`}>{finding.suggestion}</p>
        </div>
      )}
    </div>
  );
}

export function FindingsList() {
  const { advisorReport, selectNode } = usePlan();
  if (!advisorReport || advisorReport.findings.length === 0) return null;

  const countsLabel = severityCountsLabel(advisorReport.counts);

  return (
    <div>
      {countsLabel && (
        <div className="mb-1.5 text-[10px] font-semibold text-slate-500 dark:text-slate-400">
          {countsLabel}
        </div>
      )}
      <div className="space-y-1">
        {advisorReport.findings.map((finding, index) => (
          <FindingRow key={`${finding.ruleId}-${finding.nodeIds.join(',')}-${index}`} finding={finding} onNavigate={selectNode} />
        ))}
      </div>
    </div>
  );
}

export function NodeFindings({ nodeId }: { nodeId: number }) {
  const { advisorReport } = usePlan();
  const findings = advisorReport?.findingsByNodeId.get(nodeId);
  if (!findings || findings.length === 0) return null;

  return (
    <>
      {findings.map((finding, index) => {
        const styles = SEVERITY_STYLES[finding.severity];
        return (
          <div
            key={`${finding.ruleId}-${index}`}
            className={`p-3 border-b border-neutral-200 dark:border-neutral-800 ${styles.banner}`}
          >
            <div className={`text-xs font-semibold tracking-wide ${styles.text}`}>{finding.title}</div>
            <div className="mt-1 text-xs text-neutral-600 dark:text-neutral-400 leading-snug">{finding.explanation}</div>
            <div className={`mt-1 text-xs italic leading-snug ${styles.text}`}>{finding.suggestion}</div>
          </div>
        );
      })}
    </>
  );
}
