/* eslint-disable react-refresh/only-export-components */
/**
 * AI plan analysis context — dialog state + the streaming state machine.
 *
 * Kept separate from usePlanContext so the (already large) plan context does
 * not grow a streaming state machine. Must be mounted INSIDE PlanProvider:
 * it reads the plan slots (for valid node ids and report invalidation) and
 * switches the view mode to 'ai' when an analysis starts.
 */
import { createContext, useContext, useCallback, useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { usePlan } from './usePlanContext';
import type { AiReport, AiReportKind, AiStopReason, BuiltContext } from '../lib/ai/types';
import { AiError } from '../lib/ai/types';
import type { AiRunConfig } from '../lib/ai/provider';
import { streamAnalysis } from '../lib/ai/provider';
import { buildSystemPrompt, DEFAULT_MAX_TOKENS } from '../lib/ai/prompts';
import { parseAiFindings } from '../lib/ai/findings';

export type AiDialogMode = 'analyze' | 'compare';
export type AiStatus = 'idle' | 'streaming' | 'done' | 'error' | 'cancelled';

/** Flush the internal stream buffer to React state at most this often (ms). */
const STREAM_FLUSH_INTERVAL_MS = 100;

interface AiContextValue {
  aiDialogOpen: boolean;
  aiDialogMode: AiDialogMode;
  report: AiReport | null;
  status: AiStatus;
  /** Text streamed so far (throttled — updated on a ~100 ms interval). */
  streamText: string;
  error: AiError | null;
  openAiDialog: (mode: AiDialogMode) => void;
  closeAiDialog: () => void;
  runAnalysis: (
    runConfig: AiRunConfig,
    builtContext: BuiltContext,
    kind: AiReportKind,
    slotIds: number[],
  ) => Promise<void>;
  cancel: () => void;
  clearReport: () => void;
}

const AiContext = createContext<AiContextValue | null>(null);

export function AiProvider({ children }: { children: ReactNode }) {
  const { plans, setViewMode } = usePlan();

  const [aiDialogOpen, setAiDialogOpen] = useState(false);
  const [aiDialogMode, setAiDialogMode] = useState<AiDialogMode>('analyze');
  const [report, setReport] = useState<AiReport | null>(null);
  const [status, setStatus] = useState<AiStatus>('idle');
  const [streamText, setStreamText] = useState('');
  const [error, setError] = useState<AiError | null>(null);

  const abortRef = useRef<AbortController | null>(null);
  const bufferRef = useRef('');
  const flushTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  // Cancel() marks the current run so its AbortError resolves to 'cancelled'.
  const cancelledRef = useRef(false);
  // Slot indices the current report (or in-flight run) was generated from.
  const sourceSlotIdsRef = useRef<number[]>([]);

  const stopFlushTimer = useCallback(() => {
    if (flushTimerRef.current !== null) {
      clearInterval(flushTimerRef.current);
      flushTimerRef.current = null;
    }
  }, []);

  const flushBuffer = useCallback(() => {
    setStreamText(bufferRef.current);
  }, []);

  const openAiDialog = useCallback((mode: AiDialogMode) => {
    setAiDialogMode(mode);
    setAiDialogOpen(true);
  }, []);

  const closeAiDialog = useCallback(() => {
    setAiDialogOpen(false);
  }, []);

  const cancel = useCallback(() => {
    if (abortRef.current) {
      cancelledRef.current = true;
      abortRef.current.abort();
    }
  }, []);

  const clearReport = useCallback(() => {
    setReport(null);
    setStreamText('');
    setError(null);
    setStatus('idle');
    bufferRef.current = '';
    sourceSlotIdsRef.current = [];
  }, []);

  const runAnalysis = useCallback(
    async (
      runConfig: AiRunConfig,
      builtContext: BuiltContext,
      kind: AiReportKind,
      slotIds: number[],
    ) => {
      // One report at a time: abort any in-flight run first.
      if (abortRef.current) {
        cancelledRef.current = true;
        abortRef.current.abort();
      }
      const controller = new AbortController();
      abortRef.current = controller;
      cancelledRef.current = false;
      sourceSlotIdsRef.current = slotIds;

      bufferRef.current = '';
      setStreamText('');
      setReport(null);
      setError(null);
      setStatus('streaming');
      setAiDialogOpen(false);
      setViewMode('ai');

      stopFlushTimer();
      flushTimerRef.current = setInterval(flushBuffer, STREAM_FLUSH_INTERVAL_MS);

      // Snapshot valid node ids from the primary source slot for findings validation.
      const sourcePlan = plans[slotIds[0]]?.parsedPlan ?? null;
      const validNodeIds = new Set<number>(sourcePlan ? sourcePlan.allNodes.map((n) => n.id) : []);

      try {
        const stream = streamAnalysis(
          runConfig,
          {
            system: buildSystemPrompt(kind),
            user: builtContext.userMessage,
            model: runConfig.model,
            maxTokens: DEFAULT_MAX_TOKENS,
          },
          controller.signal,
        );

        let stopReason: AiStopReason = 'other';
        for await (const event of stream) {
          if (event.type === 'text') {
            bufferRef.current += event.text;
          } else {
            stopReason = event.stopReason;
          }
        }

        const markdown = bufferRef.current;
        setReport({
          kind,
          markdown,
          findings: parseAiFindings(markdown, validNodeIds),
          provider: runConfig.provider,
          model: runConfig.model,
          createdAt: Date.now(),
          slotIds,
          truncated: stopReason === 'max_tokens',
        });
        setStatus('done');
      } catch (err) {
        const isAbort =
          cancelledRef.current ||
          controller.signal.aborted ||
          (err instanceof DOMException && err.name === 'AbortError') ||
          (err instanceof Error && err.name === 'AbortError') ||
          (err instanceof AiError && err.kind === 'aborted');
        if (isAbort) {
          // Cancel keeps the partial text; never surfaces as a failure.
          setStatus('cancelled');
        } else {
          setError(
            err instanceof AiError
              ? err
              : new AiError('unknown', err instanceof Error ? err.message : 'Unknown error'),
          );
          setStatus('error');
        }
      } finally {
        stopFlushTimer();
        flushBuffer();
        if (abortRef.current === controller) {
          abortRef.current = null;
        }
      }
    },
    [plans, setViewMode, stopFlushTimer, flushBuffer],
  );

  // A report belongs to the plan(s) it was generated from: when the source
  // slot re-parses (new plan loaded / cleared), drop the report — same
  // lifecycle idea as metadata bundles in usePlanContext.
  const primarySlotIndex = (report?.slotIds ?? sourceSlotIdsRef.current)[0] ?? null;
  const sourceParsedPlan = primarySlotIndex !== null ? plans[primarySlotIndex]?.parsedPlan ?? null : null;
  const prevSourcePlanRef = useRef(sourceParsedPlan);
  useEffect(() => {
    if (prevSourcePlanRef.current !== sourceParsedPlan) {
      prevSourcePlanRef.current = sourceParsedPlan;
      if (report || status !== 'idle') {
        if (abortRef.current) {
          cancelledRef.current = true;
          abortRef.current.abort();
        }
        clearReport();
      }
    }
  }, [sourceParsedPlan, report, status, clearReport]);

  // Abort any in-flight stream on unmount.
  useEffect(() => {
    return () => {
      if (abortRef.current) {
        cancelledRef.current = true;
        abortRef.current.abort();
      }
      stopFlushTimer();
    };
  }, [stopFlushTimer]);

  const value: AiContextValue = {
    aiDialogOpen,
    aiDialogMode,
    report,
    status,
    streamText,
    error,
    openAiDialog,
    closeAiDialog,
    runAnalysis,
    cancel,
    clearReport,
  };

  return <AiContext.Provider value={value}>{children}</AiContext.Provider>;
}

export function useAi(): AiContextValue {
  const context = useContext(AiContext);
  if (!context) {
    throw new Error('useAi must be used within an AiProvider (inside PlanProvider)');
  }
  return context;
}
