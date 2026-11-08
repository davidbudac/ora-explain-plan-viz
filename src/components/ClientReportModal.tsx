import { useId, useMemo, useRef, useState } from 'react';
import { usePlan } from '../hooks/usePlanContext';
import { getSourceDisplayName } from '../lib/parser';
import { hasAnnotations } from '../lib/annotations';
import {
  buildClientReport,
  clientReportFilename,
  DEFAULT_REPORT_SECTIONS,
  type ClientReportSections,
} from '../lib/clientReport';
import { downloadTextFile, printHtml } from '../lib/fileExport';
import { BTN_SECONDARY, Dialog, DialogBody, DialogFooter, FOCUS_RING, useToast } from './ui';

interface ClientReportModalProps {
  onClose: () => void;
}

interface SectionToggleDef {
  key: keyof ClientReportSections;
  label: string;
  description: string;
}

const INPUT_CLASS =
  'w-full px-2.5 py-1.5 text-xs rounded-md bg-white dark:bg-slate-950 text-slate-900 dark:text-slate-100 placeholder-slate-400 border border-slate-200 dark:border-slate-700 focus:outline-none focus:ring-2 focus:ring-blue-500/60';

export function ClientReportModal({ onClose }: ClientReportModalProps) {
  const { parsedPlan, rawInput, annotations, advisorReport, hottestNodeId } = usePlan();
  const [title, setTitle] = useState('');
  const [sections, setSections] = useState<ClientReportSections>({ ...DEFAULT_REPORT_SECTIONS });
  const [showPreview, setShowPreview] = useState(false);
  const titleRef = useRef<HTMLInputElement>(null);

  const toast = useToast();
  const titleId = useId();

  // A typed title: Escape and backdrop clicks ask before discarding it
  const dirty = title !== '';

  const sectionToggles = useMemo<SectionToggleDef[]>(() => {
    if (!parsedPlan) return [];
    const defs: SectionToggleDef[] = [
      { key: 'planTable', label: 'Execution plan table', description: 'Full plan with estimates, actuals, and note markers' },
    ];
    if (parsedPlan.sqlText) {
      defs.push({ key: 'sqlText', label: 'SQL statement', description: 'The full query text' });
    }
    if (hasAnnotations(annotations)) {
      defs.push({ key: 'annotations', label: 'Consultant notes', description: 'Your node notes, highlights, and groups' });
    }
    if (advisorReport && advisorReport.findings.length > 0) {
      defs.push({ key: 'findings', label: 'Automated findings', description: 'Plan advisor findings' });
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
      defs.push({ key: 'environment', label: 'Execution details', description: 'Environment, optimizer notes, time breakdown, bind variables' });
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
        sections,
      }
    );
  }, [parsedPlan, rawInput, annotations, advisorReport, hottestNodeId, title, sections]);

  const download = () => {
    if (!parsedPlan || !html) return;
    if (downloadTextFile(html, clientReportFilename(parsedPlan), 'text/html;charset=utf-8')) {
      toast.show({ tone: 'success', message: 'Report downloaded' });
    }
  };

  const openPrintView = () => {
    if (!html) return;
    // Shows its own error toast when the popup is blocked
    printHtml(html);
  };

  if (!parsedPlan) return null;

  return (
    <Dialog
      open
      onClose={onClose}
      title="Export client report"
      size="lg"
      initialFocusRef={titleRef}
      dirty={dirty}
    >
      <DialogBody className="space-y-4 pb-4">
        <p className="text-[11px] text-slate-600 dark:text-slate-400 leading-snug">
          Packages this plan, your notes and highlights, and the app&apos;s analysis into a single
          self-contained HTML document: an informal, facts-only handover. Download it, or open the
          print view to save it as a PDF. Everything is generated in the browser; nothing is uploaded.
        </p>

        <div>
          <label htmlFor={titleId} className="block text-[11px] font-medium text-slate-500 dark:text-slate-400 mb-1">
            Report title
          </label>
          <input
            id={titleId}
            ref={titleRef}
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Query performance documentation"
            className={INPUT_CLASS}
          />
        </div>

        <div>
          <span className="block text-[11px] font-medium text-slate-500 dark:text-slate-400 mb-1.5">
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
                  <span className="block text-xs font-medium text-slate-800 dark:text-slate-200">
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
              className={`h-8 px-3 text-xs font-medium rounded bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors ${FOCUS_RING}`}
            >
              Download .html
            </button>
            <button
              type="button"
              onClick={openPrintView}
              disabled={!html}
              className={`h-8 px-3 text-xs font-medium rounded border border-slate-300 dark:border-slate-600 text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 disabled:opacity-50 disabled:cursor-not-allowed transition-colors ${FOCUS_RING}`}
            >
              Print / save as PDF
            </button>
          </div>
          <button
            type="button"
            onClick={() => setShowPreview(!showPreview)}
            className={`mt-2 text-[11px] text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-300 select-none ${FOCUS_RING}`}
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
      </DialogBody>

      <DialogFooter>
        <button type="button" onClick={onClose} className={BTN_SECONDARY}>
          Close
        </button>
      </DialogFooter>
    </Dialog>
  );
}
