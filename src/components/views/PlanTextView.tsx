import { memo, useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import type { KeyboardEvent as ReactKeyboardEvent, MouseEvent as ReactMouseEvent } from 'react';
import { usePlan } from '../../hooks/usePlanContext';
import { copyToClipboard } from '../../lib/clipboard';
import {
  buildLineOperationMap,
  findTextMatches,
  parsePlanTableRowId,
  segmentLine,
  splitLines,
} from '../../lib/planText';
import type { HighlightRange } from '../../lib/planText';

const FOCUS_RING =
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/60 dark:focus-visible:ring-blue-400/60';

const PREFS_STORAGE_KEY = 'planTextView.prefs.v1';
interface PlanTextPrefs {
  lineNumbers: boolean;
  wrap: boolean;
}
const DEFAULT_PREFS: PlanTextPrefs = { lineNumbers: false, wrap: false };

function loadPrefs(): PlanTextPrefs {
  try {
    const saved = localStorage.getItem(PREFS_STORAGE_KEY);
    if (saved) {
      const parsed = JSON.parse(saved) as Partial<PlanTextPrefs>;
      return {
        lineNumbers: typeof parsed.lineNumbers === 'boolean' ? parsed.lineNumbers : DEFAULT_PREFS.lineNumbers,
        wrap: typeof parsed.wrap === 'boolean' ? parsed.wrap : DEFAULT_PREFS.wrap,
      };
    }
  } catch { /* ignore */ }
  return { ...DEFAULT_PREFS };
}

/** Highlight kinds, lowest → highest priority. */
type MarkKind = 'filter' | 'match' | 'current';
const MARK_PRIORITY: readonly MarkKind[] = ['filter', 'match', 'current'];
const MARK_CLASS: Record<MarkKind, string> = {
  // Same yellow as the global search highlight in the other views.
  filter: 'bg-yellow-200/80 dark:bg-yellow-700/40 text-slate-900 dark:text-yellow-100 rounded-sm',
  match: 'bg-orange-200 dark:bg-orange-500/35 text-slate-900 dark:text-orange-50 rounded-sm',
  current: 'bg-orange-500 dark:bg-orange-500 text-white ring-1 ring-orange-700 dark:ring-orange-300 rounded-sm',
};

const EMPTY_RANGES: HighlightRange<MarkKind>[] = [];

type CopyStatus = 'idle' | 'copied' | 'failed';

interface PlanTextLineProps {
  index: number;
  text: string;
  ranges: HighlightRange<MarkKind>[];
  /** Operation this line refers to (validated against the parsed plan), if any. */
  opId: number | null;
  selected: boolean;
  lineNumbers: boolean;
  gutterChars: number;
  wrap: boolean;
  onSelect: (opId: number, event: ReactMouseEvent) => void;
}

const PlanTextLine = memo(function PlanTextLine({
  index,
  text,
  ranges,
  opId,
  selected,
  lineNumbers,
  gutterChars,
  wrap,
  onSelect,
}: PlanTextLineProps) {
  const content = ranges.length === 0
    ? text
    : segmentLine(text.length, ranges, MARK_PRIORITY).map((segment) => {
        const slice = text.slice(segment.start, segment.end);
        if (!segment.kind) return <span key={segment.start}>{slice}</span>;
        return (
          <mark
            key={segment.start}
            className={MARK_CLASS[segment.kind]}
            data-current-match={segment.kind === 'current' ? '' : undefined}
          >
            {slice}
          </mark>
        );
      });

  const clickable = opId !== null;

  return (
    <div
      data-line={index}
      onClick={clickable ? (event) => onSelect(opId, event) : undefined}
      title={clickable ? `Select operation ${opId}` : undefined}
      className={`flex min-h-[1.625em] ${
        selected
          ? 'bg-blue-100/70 dark:bg-blue-900/30'
          : clickable
            ? 'hover:bg-slate-200/60 dark:hover:bg-slate-800/70'
            : ''
      } ${clickable ? 'cursor-pointer' : ''}`}
    >
      {lineNumbers && (
        <span
          aria-hidden="true"
          className="sticky left-0 shrink-0 select-none pr-3 pl-2 text-right text-slate-400 dark:text-slate-600 bg-slate-50 dark:bg-slate-950 border-r border-slate-200 dark:border-slate-800 mr-3"
          style={{ minWidth: `${gutterChars + 2}ch` }}
        >
          {index + 1}
        </span>
      )}
      <span className={wrap ? 'min-w-0 flex-1 whitespace-pre-wrap break-words' : 'whitespace-pre'}>
        {content}
      </span>
    </div>
  );
});

/**
 * Raw plan text with in-view search (Enter / Shift+Enter to step, Escape to
 * clear), highlighting of the global filter search, line-number and wrap
 * toggles, copy-to-clipboard, and click-to-select for lines that refer to an
 * operation (plan-table rows and "identified by operation id" sections).
 */
export function PlanTextView() {
  const { rawInput, filters, nodeById, selectNode, selectedNodeIds } = usePlan();
  const text = rawInput ?? '';

  const lines = useMemo(() => splitLines(text), [text]);
  const lineOps = useMemo(() => buildLineOperationMap(text), [text]);
  // Only lines whose operation exists in the parsed plan are selectable.
  const validLineOps = useMemo(
    () => lineOps.map((id) => (id !== null && nodeById.has(id) ? id : null)),
    [lineOps, nodeById]
  );
  // First plan-table row per operation — the scroll target when the selection
  // changes elsewhere.
  const tableRowLineByOp = useMemo(() => {
    const map = new Map<number, number>();
    lines.forEach((line, i) => {
      const id = validLineOps[i];
      if (id !== null && !map.has(id) && parsePlanTableRowId(line) !== null) map.set(id, i);
    });
    return map;
  }, [lines, validLineOps]);

  const [query, setQuery] = useState('');
  const [currentIndex, setCurrentIndex] = useState(0);
  const [prefs, setPrefs] = useState<PlanTextPrefs>(loadPrefs);
  const [copyStatus, setCopyStatus] = useState<CopyStatus>('idle');
  const copyTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const scrollerRef = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const lastClickedOpRef = useRef<number | null>(null);
  const matchCountId = useId();

  useEffect(() => {
    try { localStorage.setItem(PREFS_STORAGE_KEY, JSON.stringify(prefs)); } catch { /* ignore */ }
  }, [prefs]);

  useEffect(() => () => { if (copyTimerRef.current) clearTimeout(copyTimerRef.current); }, []);

  const matches = useMemo(() => findTextMatches(lines, query), [lines, query]);
  const current = matches.length > 0 ? Math.min(currentIndex, matches.length - 1) : -1;

  const filterQuery = filters.searchText?.trim() ?? '';
  const filterMatches = useMemo(() => findTextMatches(lines, filterQuery), [lines, filterQuery]);

  const rangesByLine = useMemo(() => {
    const map = new Map<number, HighlightRange<MarkKind>[]>();
    const push = (line: number, range: HighlightRange<MarkKind>) => {
      const list = map.get(line);
      if (list) list.push(range);
      else map.set(line, [range]);
    };
    for (const m of filterMatches) push(m.line, { start: m.start, end: m.end, kind: 'filter' });
    matches.forEach((m, i) => push(m.line, { start: m.start, end: m.end, kind: i === current ? 'current' : 'match' }));
    return map;
  }, [filterMatches, matches, current]);

  const selectedSet = useMemo(() => new Set(selectedNodeIds), [selectedNodeIds]);

  // Bring the current match into view whenever it changes.
  useEffect(() => {
    if (current < 0) return;
    const el = scrollerRef.current?.querySelector<HTMLElement>('[data-current-match]');
    el?.scrollIntoView({ block: 'center', inline: 'nearest' });
  }, [current, matches]);

  // When the selection changes elsewhere (tree, table, details panel), bring
  // that operation's plan-table row into view. Skipped for clicks made here so
  // clicking a predicate line doesn't jump to the table row.
  const primarySelectedId = selectedNodeIds.length > 0 ? selectedNodeIds[selectedNodeIds.length - 1] : null;
  useEffect(() => {
    if (primarySelectedId === null) return;
    if (lastClickedOpRef.current === primarySelectedId) {
      lastClickedOpRef.current = null;
      return;
    }
    const lineIndex = tableRowLineByOp.get(primarySelectedId);
    if (lineIndex === undefined) return;
    const el = scrollerRef.current?.querySelector<HTMLElement>(`[data-line="${lineIndex}"]`);
    el?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }, [primarySelectedId, tableRowLineByOp]);

  const handleLineSelect = useCallback((opId: number, event: ReactMouseEvent) => {
    // A drag that selected text is not a click on the line.
    const selection = window.getSelection();
    if (selection && !selection.isCollapsed && selection.toString().length > 0) return;
    lastClickedOpRef.current = opId;
    selectNode(opId, { additive: event.metaKey || event.ctrlKey });
  }, [selectNode]);

  const step = useCallback((delta: 1 | -1) => {
    if (matches.length === 0) return;
    setCurrentIndex((current + delta + matches.length) % matches.length);
  }, [matches.length, current]);

  const handleSearchKeyDown = (event: ReactKeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      step(event.shiftKey ? -1 : 1);
    } else if (event.key === 'Escape') {
      if (query) {
        event.preventDefault();
        event.stopPropagation();
        setQuery('');
        setCurrentIndex(0);
      } else {
        searchInputRef.current?.blur();
      }
    }
  };

  // Cmd/Ctrl+F while focus is inside this view jumps to the in-view search.
  const handleRootKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if ((event.metaKey || event.ctrlKey) && !event.altKey && event.key.toLowerCase() === 'f') {
      event.preventDefault();
      searchInputRef.current?.focus();
      searchInputRef.current?.select();
    }
  };

  const handleCopy = async () => {
    if (copyTimerRef.current) clearTimeout(copyTimerRef.current);
    const ok = await copyToClipboard(text);
    setCopyStatus(ok ? 'copied' : 'failed');
    copyTimerRef.current = setTimeout(() => setCopyStatus('idle'), ok ? 1500 : 2500);
  };

  const togglePref = (key: keyof PlanTextPrefs) => setPrefs((prev) => ({ ...prev, [key]: !prev[key] }));

  const gutterChars = String(lines.length).length;
  const hasText = text.length > 0;

  const toggleClass = (pressed: boolean) =>
    `px-2 py-1 rounded-md text-[11px] font-medium border transition-colors ${FOCUS_RING} ${
      pressed
        ? 'bg-blue-50 dark:bg-blue-900/30 border-blue-200 dark:border-blue-800 text-blue-700 dark:text-blue-300'
        : 'bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800'
    }`;
  const iconButtonClass = `p-1 rounded-md text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 disabled:opacity-40 disabled:hover:bg-transparent ${FOCUS_RING}`;

  return (
    <div className="h-full flex flex-col bg-slate-50 dark:bg-slate-950" onKeyDown={handleRootKeyDown}>
      <div className="flex flex-wrap items-center gap-2 px-3 py-1.5 border-b border-slate-200 dark:border-slate-800 bg-white/80 dark:bg-slate-900/80">
        <div className="relative flex items-center">
          <svg
            className="pointer-events-none absolute left-2 h-3.5 w-3.5 text-slate-400"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={2}
            aria-hidden="true"
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-4.35-4.35M11 18a7 7 0 100-14 7 7 0 000 14z" />
          </svg>
          <input
            ref={searchInputRef}
            type="search"
            value={query}
            onChange={(e) => { setQuery(e.target.value); setCurrentIndex(0); }}
            onKeyDown={handleSearchKeyDown}
            placeholder="Search plan text"
            aria-label="Search plan text"
            aria-describedby={matchCountId}
            className={`w-56 pl-7 pr-2 py-1 text-xs rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-800 dark:text-slate-100 placeholder:text-slate-400 ${FOCUS_RING}`}
          />
        </div>
        <span
          id={matchCountId}
          aria-live="polite"
          className="min-w-[5.5rem] text-[11px] font-mono tabular-nums text-slate-500 dark:text-slate-400"
        >
          {query.trim() === '' ? '' : matches.length === 0 ? 'No matches' : `${current + 1} of ${matches.length}`}
        </span>
        <div className="flex items-center gap-0.5">
          <button
            type="button"
            onClick={() => step(-1)}
            disabled={matches.length === 0}
            aria-label="Previous match"
            title="Previous match (Shift+Enter)"
            className={iconButtonClass}
          >
            <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5} aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" d="M5 15l7-7 7 7" />
            </svg>
          </button>
          <button
            type="button"
            onClick={() => step(1)}
            disabled={matches.length === 0}
            aria-label="Next match"
            title="Next match (Enter)"
            className={iconButtonClass}
          >
            <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5} aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
            </svg>
          </button>
        </div>

        {filterQuery && (
          <span className="flex items-center gap-1 text-[11px] text-slate-500 dark:text-slate-400" title="The Filters panel search is highlighted in yellow">
            <span className="inline-block h-2.5 w-2.5 rounded-sm bg-yellow-200 dark:bg-yellow-700/60 ring-1 ring-yellow-400/60" aria-hidden="true" />
            Filter search
          </span>
        )}

        <div className="ml-auto flex items-center gap-1.5">
          <button
            type="button"
            aria-pressed={prefs.lineNumbers}
            onClick={() => togglePref('lineNumbers')}
            className={toggleClass(prefs.lineNumbers)}
          >
            Line numbers
          </button>
          <button
            type="button"
            aria-pressed={prefs.wrap}
            onClick={() => togglePref('wrap')}
            className={toggleClass(prefs.wrap)}
          >
            Wrap lines
          </button>
          <button
            type="button"
            onClick={handleCopy}
            disabled={!hasText}
            className={`${toggleClass(false)} disabled:opacity-40`}
          >
            Copy
          </button>
          <span role="status" className="min-w-[4.5rem] text-[11px] font-medium">
            {copyStatus === 'copied' && <span className="text-emerald-600 dark:text-emerald-400">Copied</span>}
            {copyStatus === 'failed' && <span className="text-red-600 dark:text-red-400">Copy failed</span>}
          </span>
        </div>
      </div>

      <div
        ref={scrollerRef}
        tabIndex={0}
        role="region"
        aria-label="Plan text"
        className={`flex-1 min-h-0 overflow-auto font-mono text-xs leading-relaxed text-slate-800 dark:text-slate-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-blue-500/60 ${
          prefs.lineNumbers ? 'py-3 pr-4' : 'p-4'
        }`}
      >
        {hasText ? (
          <div className={prefs.wrap ? '' : 'w-max min-w-full'}>
            {lines.map((line, i) => {
              const opId = validLineOps[i];
              return (
                <PlanTextLine
                  key={i}
                  index={i}
                  text={line}
                  ranges={rangesByLine.get(i) ?? EMPTY_RANGES}
                  opId={opId}
                  selected={opId !== null && selectedSet.has(opId)}
                  lineNumbers={prefs.lineNumbers}
                  gutterChars={gutterChars}
                  wrap={prefs.wrap}
                  onSelect={handleLineSelect}
                />
              );
            })}
          </div>
        ) : (
          <p className="text-slate-500 dark:text-slate-400">No plan text available.</p>
        )}
      </div>
    </div>
  );
}
