import { useMemo, useState } from 'react';
import { usePlan } from '../hooks/usePlanContext';
import type { FindingSeverity, Finding } from '../lib/advisor';
import { SEVERITY_STYLES } from '../lib/severityStyles';
import { walkPlanTree } from '../lib/analysis';

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

/**
 * Splits a finding title so the leading, repetitive part ("Cardinality mismatch
 * on ") can be truncated while the distinguishing tail stays visible.
 */
function splitTitle(title: string): { head: string; tail: string } {
  const index = title.lastIndexOf(' on ');
  if (index === -1) return { head: title, tail: '' };
  return { head: title.slice(0, index + 4), tail: title.slice(index + 4) };
}

function humanizeRuleId(ruleId: string): string {
  const words = ruleId.replace(/-/g, ' ');
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/** Longest shared prefix of the titles, trimmed back to a word boundary. */
function commonTitlePrefix(findings: Finding[]): string {
  const [first, ...rest] = findings.map((f) => f.title);
  let prefix = first ?? '';
  for (const title of rest) {
    let i = 0;
    while (i < prefix.length && i < title.length && prefix[i] === title[i]) i += 1;
    prefix = prefix.slice(0, i);
  }
  return prefix.replace(/\s+(on|in)?\s*$/, '').trim();
}

interface FindingGroup {
  ruleId: string;
  label: string;
  severity: FindingSeverity;
  findings: Finding[];
}

function groupFindingsByRule(findings: Finding[]): FindingGroup[] {
  const groups = new Map<string, Finding[]>();
  for (const finding of findings) {
    const existing = groups.get(finding.ruleId);
    if (existing) existing.push(finding);
    else groups.set(finding.ruleId, [finding]);
  }

  return [...groups.entries()].map(([ruleId, ruleFindings]) => {
    const prefix = commonTitlePrefix(ruleFindings);
    return {
      ruleId,
      label: prefix.length >= 8 ? prefix : humanizeRuleId(ruleId),
      severity:
        SEVERITY_ORDER.find((severity) => ruleFindings.some((f) => f.severity === severity)) ?? 'info',
      findings: ruleFindings,
    };
  });
}

/** The bit of a finding row that tells one finding apart from its siblings. */
function FindingLabel({ finding, objectName, compact }: { finding: Finding; objectName?: string; compact: boolean }) {
  const { head, tail } = splitTitle(finding.title);
  const showHead = !compact || tail === '';
  return (
    <span className="flex-1 min-w-0 flex items-baseline gap-1">
      {showHead && (
        <span className="truncate font-semibold text-slate-700 dark:text-slate-200">{head}</span>
      )}
      {tail && (
        <span className="shrink-0 font-semibold text-slate-700 dark:text-slate-200">{tail}</span>
      )}
      {objectName && (
        <span className="truncate text-slate-500 dark:text-slate-400">{objectName}</span>
      )}
    </span>
  );
}

function FindingRow({
  finding,
  onNavigate,
  objectName,
  compact = false,
}: {
  finding: Finding;
  onNavigate: (nodeId: number) => void;
  objectName?: string;
  compact?: boolean;
}) {
  const { showAdvisorSuggestions } = usePlan();
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
          title={finding.title}
        >
          {canNavigate && (
            <span className="w-4 h-4 rounded bg-slate-700 dark:bg-slate-300 text-white dark:text-slate-900 text-[10px] font-bold flex items-center justify-center shrink-0">
              {nodeId}
            </span>
          )}
          <FindingLabel finding={finding} objectName={objectName} compact={compact} />
        </button>
      </div>
      {expanded && (
        <div className="px-2 pb-2 pl-9 space-y-1">
          <p className="text-[11px] text-slate-600 dark:text-slate-300 leading-snug">{finding.explanation}</p>
          {showAdvisorSuggestions && (
            <p className={`text-[11px] italic leading-snug ${styles.text}`}>{finding.suggestion}</p>
          )}
        </div>
      )}
    </div>
  );
}

function FindingGroupRow({
  group,
  onNavigate,
  objectNames,
}: {
  group: FindingGroup;
  onNavigate: (nodeId: number) => void;
  objectNames: Map<number, string>;
}) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="rounded border border-transparent">
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        aria-expanded={expanded}
        className="w-full flex items-center gap-1.5 px-2 py-1.5 text-[11px] rounded hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
      >
        <svg
          className={`w-3 h-3 shrink-0 text-slate-400 transition-transform ${expanded ? 'rotate-90' : ''}`}
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M9 5l7 7-7 7" />
        </svg>
        <SeverityDot severity={group.severity} />
        <span className="flex-1 min-w-0 truncate text-left font-mono font-semibold text-slate-700 dark:text-slate-200">
          {group.label}
        </span>
        <span className="shrink-0 px-1.5 rounded-full bg-slate-200 dark:bg-slate-700 text-slate-600 dark:text-slate-300 text-[10px] font-semibold tabular-nums">
          {group.findings.length}
        </span>
      </button>
      {expanded && (
        <div className="pl-4 space-y-1 pb-1">
          {group.findings.map((finding, index) => (
            <FindingRow
              key={`${finding.ruleId}-${finding.nodeIds.join(',')}-${index}`}
              finding={finding}
              onNavigate={onNavigate}
              objectName={objectNames.get(finding.nodeIds[0])}
              compact
            />
          ))}
        </div>
      )}
    </div>
  );
}

export function FindingsList() {
  const { advisorReport, selectNode, parsedPlan } = usePlan();

  const objectNames = useMemo(() => {
    const map = new Map<number, string>();
    if (parsedPlan?.rootNode) {
      walkPlanTree(parsedPlan.rootNode, (node) => {
        if (node.objectName) map.set(node.id, node.objectName);
      });
    }
    return map;
  }, [parsedPlan]);

  const groups = useMemo(
    () => groupFindingsByRule(advisorReport?.findings ?? []),
    [advisorReport]
  );

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
        {groups.map((group) =>
          group.findings.length > 1 ? (
            <FindingGroupRow
              key={group.ruleId}
              group={group}
              onNavigate={selectNode}
              objectNames={objectNames}
            />
          ) : (
            <FindingRow
              key={group.ruleId}
              finding={group.findings[0]}
              onNavigate={selectNode}
              objectName={objectNames.get(group.findings[0].nodeIds[0])}
            />
          )
        )}
      </div>
    </div>
  );
}

export function NodeFindings({ nodeId }: { nodeId: number }) {
  const { advisorReport, showAdvisorSuggestions } = usePlan();
  const findings = advisorReport?.findingsByNodeId.get(nodeId);
  if (!findings || findings.length === 0) return null;

  return (
    <>
      {findings.map((finding, index) => {
        const styles = SEVERITY_STYLES[finding.severity];
        return (
          <div
            key={`${finding.ruleId}-${index}`}
            className={`p-3 border-b border-slate-200 dark:border-slate-800 ${styles.banner}`}
          >
            <div className={`text-xs font-semibold tracking-wide ${styles.text}`}>{finding.title}</div>
            <div className="mt-1 text-xs text-slate-600 dark:text-slate-400 leading-snug">{finding.explanation}</div>
            {showAdvisorSuggestions && (
              <div className={`mt-1 text-xs italic leading-snug ${styles.text}`}>{finding.suggestion}</div>
            )}
          </div>
        );
      })}
    </>
  );
}
