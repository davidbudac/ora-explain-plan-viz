import { useEffect, useMemo, useRef, useState } from 'react';
import { usePlan } from '../hooks/usePlanContext';
import { getSourceDisplayName } from '../lib/parser';
import { hasAnnotations } from '../lib/annotations';
import {
  buildClientReport,
  clientReportFilename,
  DEFAULT_REPORT_SECTIONS,
  type ClientReportSections,
} from '../lib/clientReport';

interface ClientReportModalProps {
  onClose: () => void;
}

interface SectionToggleDef {
  key: keyof ClientReportSections;
  label: string;
  description: string;
}

const FOCUS_RING =
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/60 dark:focus-visible:ring-blue-400/60';

const INPUT_CLASS =
  'w-full px-2.5 py-1.5 text-xs rounded-md bg-white dark:bg-slate-950 text-slate-900 dark:text-slate-100 placeholder-slate-400 border border-slate-200 dark:border-slate-700 focus:outline-none focus:ring-2 focus:ring-blue-500/60';

export function ClientReportModal({ onClose }: ClientReportModalProps) {
  const { parsedPlan, rawInput, annotations, advisorReport, hottestNodeId } = usePlan();
  const [title, setTitle] = useState('');
  const [summaryText, setSummaryText] = useState('');
  const [sections, setSections] = useState<ClientReportSections>({ ...DEFAULT_REPORT_SECTIONS });
  const [showPreview, setShowPreview] = useState(false);
  const titleRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    titleRef.current?.focus();
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const sectionToggles = useMemo<SectionToggleDef[]>(() => {
    if (!parsedPlan) return [];
    const defs: SectionToggleDef[] = [
      { key: 'summary', label: 'Executive summary', description: 'Your summary text plus headline statistics' },
      { key: 'planTable', label: 'Execution plan table', description: 'Full plan with estimates, actuals, and note markers' },
    ];
    if (parsedPlan.sqlText) {
      defs.push({ key: 'sqlText', label: 'SQL statement', description: 'The full query text' });
    }
    if (hasAnnotations(annotations)) {
      defs.push({ key: 'annotations', label: 'Consultant notes', description: 'Your node notes, highlights, and groups' });
    }
    if (advisorReport && advisorReport.findings.length > 0) {
      defs.push({ key: 'findings', label: 'Automated findings', description: 'Plan advisor findings with recommendations' });
    }
    if (parsedPlan.hasActualStats) {
      defs.push(
        { key: 'hotspots', label: 'Time hotspots', description: 'Top operations by self time' },
        { key: 'cardinality', label: 'Estimate accuracy', description: 'Worst cardinality mismatches' },
      );
    }
    if (parsedPlan.allNodes.some((n) => n.accessPredicates || n.filterPredicates)) {
      defs.push({ key: 'predicates', label: 'Predicates', description: 'Access and filter predicates per operation' });
    }
    if (parsedPlan.monitorMetadata || (parsedPlan.bindVariables?.length ?? 0) > 0) {
      defs.push({ key: 'environment', label: 'Execution details', description: 'Environment, time breakdown, bind variables' });
    }
    defs.push({ key: 'rawPlan', label: 'Raw plan appendix', description: 'The original plan text as pasted' });
    return defs;
  }, [parsedPlan, annotations, advisorReport]);

  const html = useMemo(() => {
    if (!parsedPlan) return null;
    return buildClientReport(
      {
        plan: parsedPlan,
        rawPlanText: rawInput,
        annotations,
        advisorReport,
        hottestNodeId,
        sourceLabel: getSourceDisplayName(parsedPlan.source),
        generatedAt: new Date(),
      },
      {
        title: title.trim() || 'Query Performance Documentation',
        summaryText,
        sections,
      }
    );
  }, [parsedPlan, rawInput, annotations, advisorReport, hottestNodeId, title, summaryText, sections]);

  const download = () => {
    if (!parsedPlan || !html) return;
    const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = clientReportFilename(parsedPlan);
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const openPrintView = () => {
    if (!html) return;
    const win = window.open('', '_blank');
    if (!win) return;
    win.document.open();
    win.document.write(html);
    win.document.close();
    // Give the new document a beat to lay out before opening the print dialog.
    setTimeout(() => {
      try {
        win.focus();
        win.print();
      } catch {
        /* window may have been closed */
      }
    }, 250);
  };

  if (!parsedPlan) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/40 dark:bg-black/60 overflow-y-auto p-4"
      onClick={onClose}
    >
      <div
        className="bg-white dark:bg-slate-900 rounded-lg shadow-xl border border-slate-200 dark:border-slate-700 w-[720px] max-w-[95vw] my-6"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-4 py-3 border-b border-slate-200 dark:border-slate-800">
          <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
            Export Client Report
          </h3>
          <button
            type="button"
            onClick={onClose}
            className="text-slate-500 hover:text-slate-700 dark:hover:text-slate-200 text-lg leading-none px-1"
            aria-label="Close"
          >
            ×
          </button>
        </div>

        <div className="p-4 space-y-4">
          <p className="text-[11px] text-slate-600 dark:text-slate-400 leading-snug">
            Packages this plan, your notes and highlights, and the app&apos;s analysis into a single
            self-contained HTML document for a nice handover — download it, or open the print view
            to save it as a PDF. Everything is generated in the browser; nothing is uploaded.
          </p>

          <div className="grid grid-cols-2 gap-3">
            <div className="col-span-2">
              <label className="block text-[11px] font-medium text-slate-500 dark:text-slate-400 mb-1 uppercase tracking-wide">
                Report title
              </label>
              <input
                ref={titleRef}
                type="text"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="Query Performance Documentation"
                className={INPUT_CLASS}
              />
            </div>
            <div className="col-span-2">
              <label className="block text-[11px] font-medium text-slate-500 dark:text-slate-400 mb-1 uppercase tracking-wide">
                Executive summary
              </label>
              <textarea
                value={summaryText}
                onChange={(e) => setSummaryText(e.target.value)}
                rows={4}
                placeholder={'What did you investigate, what did you find, and what do you recommend?\nBlank lines start new paragraphs.'}
                className={`${INPUT_CLASS} resize-y`}
              />
            </div>
          </div>

          <div>
            <span className="block text-[11px] font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wide mb-1.5">
              Sections
            </span>
            <div className="grid grid-cols-2 gap-x-4 gap-y-1.5">
              {sectionToggles.map((def) => (
                <label key={def.key} className="flex items-start gap-2 cursor-pointer" title={def.description}>
                  <input
                    type="checkbox"
                    checked={sections[def.key]}
                    onChange={(e) => setSections({ ...sections, [def.key]: e.target.checked })}
                    className="mt-0.5"
                  />
                  <span>
                    <span className="block text-xs font-semibold text-slate-800 dark:text-slate-200">
                      {def.label}
                    </span>
                    <span className="block text-[11px] text-slate-500 dark:text-slate-400 leading-snug">
                      {def.description}
                    </span>
                  </span>
                </label>
              ))}
            </div>
          </div>

          <div>
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={download}
                disabled={!html}
                className={`h-8 px-3 text-xs font-semibold rounded bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors ${FOCUS_RING}`}
              >
                Download .html
              </button>
              <button
                type="button"
                onClick={openPrintView}
                disabled={!html}
                className={`h-8 px-3 text-xs font-semibold rounded border border-slate-300 dark:border-slate-600 text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 disabled:opacity-50 disabled:cursor-not-allowed transition-colors ${FOCUS_RING}`}
              >
                Print / Save as PDF
              </button>
            </div>
            <button
              type="button"
              onClick={() => setShowPreview(!showPreview)}
              className={`mt-2 text-[10px] text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-300 select-none ${FOCUS_RING}`}
              aria-expanded={showPreview}
            >
              {showPreview ? '▾ Hide preview' : '▸ Show preview'}
            </button>
            {showPreview && html && (
              <iframe
                title="Report preview"
                sandbox=""
                srcDoc={html}
                className="mt-1 w-full h-96 rounded border border-slate-200 dark:border-slate-700 bg-white"
              />
            )}
          </div>
        </div>

        <div className="flex justify-end px-4 py-3 border-t border-slate-200 dark:border-slate-800">
          <button
            type="button"
            onClick={onClose}
            className={`text-xs px-3 py-1.5 rounded border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800 ${FOCUS_RING}`}
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
