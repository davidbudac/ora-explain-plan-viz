// PROTOTYPE — throwaway UI prototype for wayfinder ticket 08 (non-expert analysis report design). Not production code.

/**
 * Shell for the three AI-report design variants.
 *
 * Owns the simulated stream so switching variants keeps the stream phase —
 * you can flip A/B/C mid-stream and compare how each one behaves while text
 * is still arriving. Variant lives in `?variant=A|B|C` so a specific layout
 * can be linked to during review.
 */

import { useCallback, useEffect, useState } from 'react';
import { usePlan } from '../../../hooks/usePlanContext';
import { MOCK_EXAMPLE_NAME, MOCK_REPORT, MOCK_SQL_ID } from './mockReport';
import { useSimulatedStream } from './useSimulatedStream';
import { VariantA } from './VariantA';
import { VariantB } from './VariantB';
import { VariantC } from './VariantC';
import type { VariantProps } from './shared';

type VariantKey = 'A' | 'B' | 'C';

const VARIANTS: { key: VariantKey; label: string; Component: (props: VariantProps) => React.JSX.Element }[] = [
  { key: 'A', label: 'A — The Memo', Component: VariantA },
  { key: 'B', label: 'B — The Triage Board', Component: VariantB },
  { key: 'C', label: 'C — The Guided Path', Component: VariantC },
];

function readVariantFromUrl(): VariantKey {
  if (typeof window === 'undefined') return 'A';
  const raw = new URLSearchParams(window.location.search).get('variant');
  return raw === 'B' || raw === 'C' ? raw : 'A';
}

function writeVariantToUrl(key: VariantKey) {
  if (typeof window === 'undefined') return;
  const url = new URL(window.location.href);
  url.searchParams.set('variant', key);
  window.history.replaceState(null, '', url.toString());
}

function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || target.isContentEditable;
}

export function AiReportPrototypeView() {
  const { parsedPlan } = usePlan();
  const [variant, setVariant] = useState<VariantKey>(readVariantFromUrl);
  const { phase, streamedParagraphs, restart } = useSimulatedStream(MOCK_REPORT.narrativeParagraphs);

  useEffect(() => {
    writeVariantToUrl(variant);
  }, [variant]);

  const cycle = useCallback((delta: number) => {
    setVariant((current) => {
      const index = VARIANTS.findIndex((v) => v.key === current);
      const next = (index + delta + VARIANTS.length) % VARIANTS.length;
      return VARIANTS[next].key;
    });
  }, []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
      if (isTypingTarget(event.target)) return;
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      event.preventDefault();
      cycle(event.key === 'ArrowRight' ? 1 : -1);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [cycle]);

  // Dev-only scaffolding: never ship in a production bundle.
  if (!import.meta.env.DEV) return null;

  const active = VARIANTS.find((v) => v.key === variant) ?? VARIANTS[0];
  const ActiveVariant = active.Component;
  const mismatchedPlan = parsedPlan?.sqlId !== MOCK_SQL_ID;

  return (
    <div className="h-full flex flex-col min-h-0 relative">
      {mismatchedPlan && (
        <div className="shrink-0 flex items-center gap-2 px-3 py-1 bg-amber-50 dark:bg-amber-950/40 border-b border-amber-300/60 dark:border-amber-800/60 text-[11px] text-amber-800 dark:text-amber-200">
          <svg className="w-3.5 h-3.5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v3.5m0 3.5h.01M10.3 4.2L2.9 17a2 2 0 001.7 3h14.8a2 2 0 001.7-3L13.7 4.2a2 2 0 00-3.4 0z" />
          </svg>
          <span>
            Mock content — written for example ‘{MOCK_EXAMPLE_NAME}’. Load that example for matching numbers.
          </span>
        </div>
      )}

      <div className="flex-1 min-h-0">
        <ActiveVariant report={MOCK_REPORT} phase={phase} streamedParagraphs={streamedParagraphs} />
      </div>

      {/* Floating variant switcher */}
      <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-50 flex items-center gap-1 rounded-full bg-slate-900 dark:bg-slate-800 text-white shadow-lg ring-1 ring-black/20 px-1.5 py-1.5">
        <button
          type="button"
          onClick={() => cycle(-1)}
          title="Previous variant (←)"
          className="w-7 h-7 flex items-center justify-center rounded-full hover:bg-white/15 transition-colors"
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M15 19l-7-7 7-7" />
          </svg>
        </button>

        <span className="px-2 text-xs font-semibold tabular-nums whitespace-nowrap select-none">{active.label}</span>

        <button
          type="button"
          onClick={() => cycle(1)}
          title="Next variant (→)"
          className="w-7 h-7 flex items-center justify-center rounded-full hover:bg-white/15 transition-colors"
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M9 5l7 7-7 7" />
          </svg>
        </button>

        <span className="mx-1 w-px h-5 bg-white/20" aria-hidden="true" />

        <button
          type="button"
          onClick={restart}
          title="Replay the simulated stream"
          className="flex items-center gap-1.5 rounded-full px-2.5 h-7 text-xs font-semibold hover:bg-white/15 transition-colors"
        >
          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h5M20 20v-5h-5M20 9A8 8 0 006.3 5.3L4 8m0 7a8 8 0 0013.7 3.7L20 16" />
          </svg>
          Replay stream
        </button>
      </div>
    </div>
  );
}
