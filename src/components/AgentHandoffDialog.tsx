import { useId, useMemo, useRef, useState } from 'react';
import { usePlan } from '../hooks/usePlanContext';
import { runAdvisor } from '../lib/advisor';
import { copyToClipboard } from '../lib/clipboard';
import { downloadBinaryFile, downloadTextFile } from '../lib/fileExport';
import { loadSettings, saveSettings } from '../lib/settings';
import {
  agentHandoffFilename,
  buildAgentHandoff,
  buildHandoffParts,
  handoffTokenEstimate,
  isSectionIncluded,
  type HandoffPlanInput,
  type HandoffSectionId,
  type HandoffSource,
} from '../lib/agentHandoff';
import {
  AGENT_SKILL_INSTALL_COMMAND,
  AGENT_SKILL_NAME,
  AGENT_SKILL_URL,
  agentSkillPlaybook,
  agentSkillZip,
} from '../lib/agentSkill';
import type { PlanSlot } from '../lib/compare';
import { BTN_PRIMARY, BTN_SECONDARY, CopyButton, Dialog, DialogBody, DialogFooter, FOCUS_RING, useToast } from './ui';

interface AgentHandoffDialogProps {
  onClose: () => void;
}

type Mode = 'analyze' | 'compare';

const LABEL_CLASS = 'block text-[11px] font-medium text-slate-500 dark:text-slate-400 mb-1 uppercase tracking-wide';
const INPUT_CLASS =
  'w-full px-2.5 py-1.5 text-xs rounded-md bg-white dark:bg-slate-950 text-slate-900 dark:text-slate-100 placeholder-slate-400 border border-slate-200 dark:border-slate-700 focus:outline-none focus:ring-2 focus:ring-blue-500/60';

function slotInput(slot: PlanSlot): HandoffPlanInput | null {
  if (!slot.parsedPlan) return null;
  return {
    plan: slot.parsedPlan,
    label: slot.customLabel || slot.label,
    rawText: slot.rawInput,
    annotations: slot.annotations,
    bundle: slot.metadataBundle,
    advisorReport: runAdvisor(slot.parsedPlan, slot.metadataBundle),
  };
}

function formatTokens(tokens: number): string {
  return tokens >= 1000 ? `${(tokens / 1000).toFixed(1)}k` : String(tokens);
}

export function AgentHandoffDialog({ onClose }: AgentHandoffDialogProps) {
  const { plans, activePlanIndex, comparePlanIndices, viewMode } = usePlan();
  const toast = useToast();
  const [settings] = useState(loadSettings);
  const questionRef = useRef<HTMLTextAreaElement>(null);
  const uid = useId();

  const activeInput = useMemo(() => {
    const slot = plans[activePlanIndex];
    return slot ? slotInput(slot) : null;
  }, [plans, activePlanIndex]);

  const [leftIndex, rightIndex] = comparePlanIndices;
  const compareInputs = useMemo(() => {
    const a = plans[leftIndex];
    const b = plans[rightIndex];
    if (!a || !b || leftIndex === rightIndex) return null;
    const planA = slotInput(a);
    const planB = slotInput(b);
    return planA && planB ? { planA, planB } : null;
  }, [plans, leftIndex, rightIndex]);

  const [mode, setMode] = useState<Mode>(() => (viewMode === 'compare' && compareInputs ? 'compare' : 'analyze'));
  const [question, setQuestion] = useState('');
  const [overrides, setOverrides] = useState<Partial<Record<HandoffSectionId, boolean>>>(
    () => settings.agentHandoffSections as Partial<Record<HandoffSectionId, boolean>>,
  );
  const [embedPlaybook, setEmbedPlaybook] = useState(settings.agentHandoffPlaybook);
  const [showPreview, setShowPreview] = useState(false);

  const source = useMemo<HandoffSource | null>(() => {
    if (mode === 'compare' && compareInputs) return { mode: 'compare', ...compareInputs };
    return activeInput ? { mode: 'analyze', plan: activeInput } : null;
  }, [mode, compareInputs, activeInput]);

  const parts = useMemo(() => (source ? buildHandoffParts(source) : null), [source]);
  const playbook = useMemo(() => agentSkillPlaybook(), []);
  const playbookTokens = useMemo(() => handoffTokenEstimate(playbook), [playbook]);

  const markdown = useMemo(() => {
    if (!source || !parts) return null;
    return buildAgentHandoff(source, parts, {
      question,
      included: overrides,
      playbook: embedPlaybook ? playbook : null,
    });
  }, [source, parts, question, overrides, embedPlaybook, playbook]);

  if (!source || !parts || !markdown) return null;

  const persistChoices = () => {
    // The raw-text default depends on format and size, so that one choice is not remembered.
    const remembered: Record<string, boolean> = { ...overrides };
    delete remembered.rawPlan;
    saveSettings({ agentHandoffSections: remembered, agentHandoffPlaybook: embedPlaybook });
  };

  const copy = async () => {
    persistChoices();
    let ok = false;
    try {
      ok = await copyToClipboard(markdown);
    } catch {
      ok = false;
    }
    toast.show(
      ok
        ? { tone: 'success', message: 'Agent handoff copied — paste it into your agent' }
        : { tone: 'error', title: 'Could not copy the handoff', message: 'The browser blocked clipboard access. Download the .md file instead.' },
    );
  };

  const download = () => {
    persistChoices();
    if (downloadTextFile(markdown, agentHandoffFilename(source), 'text/markdown;charset=utf-8')) {
      toast.show({ tone: 'success', message: 'Agent handoff downloaded' });
    }
  };

  const downloadSkill = () => {
    if (downloadBinaryFile(agentSkillZip(), `${AGENT_SKILL_NAME}.zip`, 'application/zip')) {
      toast.show({ tone: 'success', message: 'Skill downloaded' });
    }
  };

  const tokens = handoffTokenEstimate(markdown);

  return (
    <Dialog
      open
      onClose={onClose}
      title="Agent Handoff"
      size="lg"
      initialFocusRef={questionRef}
      dirty={question.trim() !== ''}
    >
      <DialogBody className="space-y-4 pb-4">
        <p className="text-[11px] text-slate-600 dark:text-slate-400 leading-snug">
          Builds one Markdown prompt for a coding or chat agent (Claude Code, Codex, ChatGPT…): the plan and
          the app&apos;s analysis, plus instructions on how to read the numbers, what answer to give, and how to
          ask you for data that is missing. It is generated in your browser and goes nowhere until you paste
          it. It contains your SQL text, object names and any bind values, so review it first.
        </p>

        {compareInputs && (
          <fieldset>
            <legend className={LABEL_CLASS}>Hand off</legend>
            <div className="flex flex-wrap gap-x-4 gap-y-1.5">
              <label className="flex items-center gap-1.5 text-xs cursor-pointer">
                <input type="radio" name={`${uid}-mode`} checked={mode === 'analyze'} onChange={() => setMode('analyze')} />
                This plan ({activeInput?.label})
              </label>
              <label className="flex items-center gap-1.5 text-xs cursor-pointer">
                <input type="radio" name={`${uid}-mode`} checked={mode === 'compare'} onChange={() => setMode('compare')} />
                Comparison ({compareInputs.planA.label} vs {compareInputs.planB.label})
              </label>
            </div>
          </fieldset>
        )}

        <div>
          <label htmlFor={`${uid}-question`} className={LABEL_CLASS}>Your question for the agent</label>
          <textarea
            id={`${uid}-question`}
            ref={questionRef}
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            rows={3}
            placeholder={'Optional. e.g. "This report ran in 2 s last week and takes 40 s since Monday\'s stats job. Why?"\nBlank asks for a general performance review.'}
            className={`${INPUT_CLASS} resize-y`}
          />
        </div>

        <fieldset>
          <legend className={LABEL_CLASS}>Include</legend>
          <p className="mb-1.5 text-[11px] text-slate-500 dark:text-slate-400">
            The plan table is always included. Sections you leave out are listed to the agent as withheld.
          </p>
          <div className="grid grid-cols-2 gap-x-4 gap-y-1.5">
            {parts.sections.map((section) => (
              <label key={section.id} className="flex items-start gap-2 cursor-pointer" title={section.note}>
                <input
                  type="checkbox"
                  checked={isSectionIncluded(section, overrides)}
                  onChange={(e) => setOverrides({ ...overrides, [section.id]: e.target.checked })}
                  className="mt-0.5"
                />
                <span>
                  <span className="text-xs font-semibold text-slate-800 dark:text-slate-200">{section.label}</span>
                  <span className="ml-1.5 text-[11px] tabular-nums text-slate-500 dark:text-slate-400">
                    ~{formatTokens(handoffTokenEstimate(section.body))} tokens
                  </span>
                  {section.note && (
                    <span className="block text-[11px] text-slate-500 dark:text-slate-400 leading-snug">{section.note}</span>
                  )}
                </span>
              </label>
            ))}
          </div>
          <label className="mt-2 flex items-start gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={embedPlaybook}
              onChange={(e) => setEmbedPlaybook(e.target.checked)}
              className="mt-0.5"
            />
            <span>
              <span className="text-xs font-semibold text-slate-800 dark:text-slate-200">Embed the analysis playbook</span>
              <span className="ml-1.5 text-[11px] tabular-nums text-slate-500 dark:text-slate-400">~{formatTokens(playbookTokens)} tokens</span>
              <span className="block text-[11px] text-slate-500 dark:text-slate-400 leading-snug">
                The full <code>{AGENT_SKILL_NAME}</code> skill, for agents that don&apos;t have it installed
              </span>
            </span>
          </label>
        </fieldset>

        <div>
          <div className="flex items-center gap-2">
            <button type="button" onClick={() => { void copy(); }} className={BTN_PRIMARY}>
              Copy handoff
            </button>
            <button type="button" onClick={download} className={BTN_SECONDARY}>
              Download .md
            </button>
            <span className="ml-auto text-[11px] tabular-nums text-slate-500 dark:text-slate-400" aria-live="polite">
              ~{formatTokens(tokens)} tokens
            </span>
          </div>
          <button
            type="button"
            onClick={() => setShowPreview(!showPreview)}
            className={`mt-2 text-[10px] text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-300 select-none ${FOCUS_RING}`}
            aria-expanded={showPreview}
          >
            {showPreview ? '▾ Hide preview' : '▸ Show preview'}
          </button>
          {showPreview && (
            <pre
              aria-label="Handoff preview"
              className="mt-1 max-h-80 overflow-auto whitespace-pre-wrap break-words rounded border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 p-2 font-mono text-[11px] leading-snug text-slate-700 dark:text-slate-300"
            >
              {markdown}
            </pre>
          )}
        </div>

        <section aria-labelledby={`${uid}-skill`} className="rounded-md border border-slate-200 dark:border-slate-700 px-3 py-2.5">
          <h3 id={`${uid}-skill`} className="text-xs font-semibold text-slate-800 dark:text-slate-200">
            Companion skill: <code>{AGENT_SKILL_NAME}</code>
          </h3>
          <p className="mt-1 text-[11px] text-slate-600 dark:text-slate-400 leading-snug">
            Teaches the agent the analysis workflow, common plan patterns and the exact queries to ask you for.
            Unzip it into <code>~/.claude/skills/</code> for Claude Code, or upload the .zip as a skill in claude.ai.
            Or install it from the repository:
          </p>
          <div className="mt-1.5 flex items-center gap-1.5">
            <code className="flex-1 truncate rounded bg-slate-100 dark:bg-slate-800 px-2 py-1 font-mono text-[11px] text-slate-700 dark:text-slate-300">
              {AGENT_SKILL_INSTALL_COMMAND}
            </code>
            <CopyButton text={AGENT_SKILL_INSTALL_COMMAND} iconOnly ariaLabel="Copy install command" />
          </div>
          <div className="mt-2 flex items-center gap-3">
            <button type="button" onClick={downloadSkill} className={BTN_SECONDARY}>
              Download skill (.zip)
            </button>
            <a
              href={AGENT_SKILL_URL}
              target="_blank"
              rel="noopener noreferrer"
              className={`text-[11px] text-blue-600 dark:text-blue-400 hover:underline ${FOCUS_RING}`}
            >
              View on GitHub
            </a>
          </div>
        </section>
      </DialogBody>

      <DialogFooter>
        <button type="button" onClick={onClose} className={BTN_SECONDARY}>
          Close
        </button>
      </DialogFooter>
    </Dialog>
  );
}
