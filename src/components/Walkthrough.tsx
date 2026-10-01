import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { usePlan } from '../hooks/usePlanContext';
import { computeHottestNodeId } from '../lib/analysis';
import {
  WALKTHROUGH_STEPS,
  computeCardPosition,
  spotlightRect,
  type Rect,
  type Size,
  type WalkthroughStep,
} from '../lib/walkthrough';
import { BTN_PRIMARY, BTN_SECONDARY, FOCUS_RING, Z_WALKTHROUGH } from './ui';

const CARD_WIDTH = 340;
/** Used for the first paint, before the card has been measured. */
const FALLBACK_CARD_HEIGHT = 200;
const MEASURE_INTERVAL_MS = 250;

function readViewport(): Size {
  return { width: window.innerWidth, height: window.innerHeight };
}

function sameRect(a: Rect | null, b: Rect | null): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  return a.top === b.top && a.left === b.left && a.width === b.width && a.height === b.height;
}

/** First on-screen element carrying `data-tour="<name>"` (a hidden or zero-sized match is skipped). */
function findTourRect(names: Array<string | undefined>): Rect | null {
  for (const name of names) {
    if (!name) continue;
    const elements = document.querySelectorAll<HTMLElement>(`[data-tour="${name}"]`);
    for (const element of Array.from(elements)) {
      const r = element.getBoundingClientRect();
      if (r.width > 0 && r.height > 0) {
        return { top: r.top, left: r.left, width: r.width, height: r.height };
      }
    }
  }
  return null;
}

function focusableIn(root: HTMLElement): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>('button:not([disabled]), [href], [tabindex]:not([tabindex="-1"])'));
}

export interface WalkthroughViewProps {
  steps: WalkthroughStep[];
  index: number;
  onNext: () => void;
  onBack: () => void;
  /** Skip tour, Escape and Finish all end the tour. */
  onClose: () => void;
}

/**
 * The tour overlay: dimmed backdrop, spotlight over the current step's
 * `data-tour` anchor, and a card with the copy and controls. Props-only so it
 * can be tested without the plan context.
 */
export function WalkthroughView({ steps, index, onNext, onBack, onClose }: WalkthroughViewProps) {
  const step = steps[index];
  const isFirst = index === 0;
  const isLast = index === steps.length - 1;
  const titleId = useId();
  const bodyId = useId();
  const cardRef = useRef<HTMLDivElement>(null);
  const primaryRef = useRef<HTMLButtonElement>(null);
  const [targetRect, setTargetRect] = useState<Rect | null>(null);
  const [viewport, setViewport] = useState<Size>(() => readViewport());
  const [cardSize, setCardSize] = useState<Size>({ width: CARD_WIDTH, height: FALLBACK_CARD_HEIGHT });

  // Keep the latest handlers reachable from the document listener without
  // re-subscribing on every render.
  const handlers = useRef({ onNext, onBack, onClose, isFirst, isLast });
  useEffect(() => {
    handlers.current = { onNext, onBack, onClose, isFirst, isLast };
  });

  const measure = useCallback(() => {
    const next = step ? findTourRect([step.target, step.fallbackTarget]) : null;
    setTargetRect((prev) => (sameRect(prev, next) ? prev : next));
    const vp = readViewport();
    setViewport((prev) => (prev.width === vp.width && prev.height === vp.height ? prev : vp));
  }, [step]);

  // Anchors appear late (the example is still loading, React Flow measures
  // after mount), so re-measure on a timer as well as on resize / scroll.
  useEffect(() => {
    // Syncing with the DOM (an external system): read the anchor right away so
    // a step change never paints one frame at the old position.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    measure();
    const timer = window.setInterval(measure, MEASURE_INTERVAL_MS);
    window.addEventListener('resize', measure);
    window.addEventListener('scroll', measure, true);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener('resize', measure);
      window.removeEventListener('scroll', measure, true);
    };
  }, [measure]);

  useLayoutEffect(() => {
    const el = cardRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    if (r.width > 0 && r.height > 0) {
      setCardSize((prev) => (prev.width === r.width && prev.height === r.height ? prev : { width: r.width, height: r.height }));
    }
    // The card's content only changes with the step; its width with the viewport.
  }, [index, viewport.width]);

  // Remember where focus was (declared first so it runs before the focus move
  // below), focus the primary button on every step, and give focus back on close.
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    return () => {
      if (previous && previous.isConnected && typeof previous.focus === 'function') previous.focus();
    };
  }, []);
  useEffect(() => {
    primaryRef.current?.focus();
  }, [index]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const h = handlers.current;
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        h.onClose();
        return;
      }
      if (event.key !== 'ArrowRight' && event.key !== 'ArrowLeft') return;
      if (event.metaKey || event.ctrlKey || event.altKey || event.shiftKey) return;
      // Only when focus is in the card or nowhere in particular; never inside
      // a text field or other control of the page underneath.
      const target = event.target as Node | null;
      const inCard = !!target && !!cardRef.current && cardRef.current.contains(target);
      const onBody = target === document.body || target === document.documentElement || target === null;
      if (!inCard && !onBody) return;
      event.preventDefault();
      event.stopPropagation();
      if (event.key === 'ArrowRight') {
        if (h.isLast) h.onClose();
        else h.onNext();
      } else if (!h.isFirst) {
        h.onBack();
      }
    };
    document.addEventListener('keydown', onKeyDown, true);
    return () => document.removeEventListener('keydown', onKeyDown, true);
  }, []);

  // Keep Tab inside the card (the page underneath is dimmed and inert in spirit).
  const onCardKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== 'Tab' || !cardRef.current) return;
    const items = focusableIn(cardRef.current);
    if (items.length === 0) return;
    const first = items[0];
    const last = items[items.length - 1];
    const active = document.activeElement;
    if (event.shiftKey && active === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && active === last) {
      event.preventDefault();
      first.focus();
    }
  };

  if (!step) return null;

  const position = computeCardPosition(targetRect, cardSize, viewport, step.placement ?? 'auto');
  const spotlight = targetRect ? spotlightRect(targetRect, viewport) : null;

  return createPortal(
    <div className="fixed inset-0" style={{ zIndex: Z_WALKTHROUGH }} data-walkthrough-layer>
      {spotlight ? (
        <div
          aria-hidden="true"
          data-walkthrough-spotlight
          className="absolute rounded-lg pointer-events-none motion-safe:transition-[top,left,width,height] motion-safe:duration-200 motion-safe:ease-out"
          style={{
            top: spotlight.top,
            left: spotlight.left,
            width: spotlight.width,
            height: spotlight.height,
            boxShadow: '0 0 0 2px rgba(59,130,246,0.9), 0 0 0 9999px rgba(15,23,42,0.55)',
          }}
        />
      ) : (
        <div aria-hidden="true" className="absolute inset-0 bg-slate-900/55" />
      )}

      <div
        ref={cardRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={bodyId}
        data-placement={position.placement}
        onKeyDown={onCardKeyDown}
        className="absolute rounded-xl border border-slate-200 bg-white p-4 text-slate-700 shadow-xl dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 motion-safe:transition-[top,left] motion-safe:duration-200 motion-safe:ease-out"
        style={{ top: position.top, left: position.left, width: `min(${CARD_WIDTH}px, calc(100vw - 16px))` }}
      >
        <div className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
          Step {index + 1} of {steps.length}
        </div>
        <h2 id={titleId} className="text-sm font-semibold text-slate-900 dark:text-slate-100">
          {step.title}
        </h2>
        <p id={bodyId} className="mt-1.5 text-[13px] leading-snug text-slate-600 dark:text-slate-300">
          {step.body}
        </p>

        <div className="mt-3 flex items-center gap-1" aria-hidden="true">
          {steps.map((s, i) => (
            <span
              key={s.id}
              className={`h-1.5 rounded-full ${
                i === index ? 'w-4 bg-blue-600 dark:bg-blue-400' : 'w-1.5 bg-slate-300 dark:bg-slate-600'
              }`}
            />
          ))}
        </div>

        <div className="mt-3 flex items-center justify-between gap-2">
          <button
            type="button"
            onClick={onClose}
            className={`rounded px-1 py-0.5 text-xs font-medium text-slate-500 hover:text-slate-800 hover:underline dark:text-slate-400 dark:hover:text-slate-100 ${FOCUS_RING}`}
          >
            Skip tour
          </button>
          <div className="flex items-center gap-2">
            {!isFirst && (
              <button type="button" onClick={onBack} className={BTN_SECONDARY}>
                Back
              </button>
            )}
            <button
              ref={primaryRef}
              type="button"
              onClick={isLast ? onClose : onNext}
              className={BTN_PRIMARY}
            >
              {isLast ? 'Finish' : 'Next'}
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}

/** Context-wired tour: owns the step index and the per-step side effects. */
export function Walkthrough() {
  const {
    setWalkthroughOpen, parsedPlan, selectedNodeIds, selectNode, setDetailPanelCollapsed,
  } = usePlan();
  const [index, setIndex] = useState(0);
  const step = WALKTHROUGH_STEPS[index];

  const close = useCallback(() => setWalkthroughOpen(false), [setWalkthroughOpen]);
  const next = useCallback(() => setIndex((i) => Math.min(i + 1, WALKTHROUGH_STEPS.length - 1)), []);
  const back = useCallback(() => setIndex((i) => Math.max(i - 1, 0)), []);

  // Entering a step with an action runs it once per step (not on every re-render).
  const hasSelection = selectedNodeIds.length > 0;
  const selectionRef = useRef({ hasSelection, parsedPlan, selectNode, setDetailPanelCollapsed });
  useEffect(() => {
    selectionRef.current = { hasSelection, parsedPlan, selectNode, setDetailPanelCollapsed };
  });
  const action = step?.action;
  useEffect(() => {
    if (action !== 'selectHotNode') return;
    const { hasSelection: selected, parsedPlan: plan, selectNode: select, setDetailPanelCollapsed: expand } = selectionRef.current;
    expand(false);
    if (selected) return;
    const hot = computeHottestNodeId(plan);
    if (hot !== null) select(hot);
  }, [action, index]);

  return <WalkthroughView steps={WALKTHROUGH_STEPS} index={index} onNext={next} onBack={back} onClose={close} />;
}
