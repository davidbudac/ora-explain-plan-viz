/**
 * Pure helpers for the Plan Text view (`PlanTextView.tsx`): mapping raw plan
 * lines to operation ids, finding search matches, and splitting a line into
 * highlight segments.
 */

// ---------------------------------------------------------------------------
// Line → operation id
// ---------------------------------------------------------------------------

/**
 * A plan-table row in DBMS_XPLAN / SQL Monitor text output:
 *   `|   4 |`, `|*  2 |`, `|* 12 |`, `|  -> 6 |` (SQL Monitor active line),
 *   `|-* 3 |` / `|-  4 |` (adaptive plan inactive rows).
 */
const PLAN_TABLE_ROW = /^\s*\|\s*(?:->\s*)?[-*]*\s*(\d+)\s*\|/;

/**
 * Sections listed "identified by operation id" below the plan table; their
 * entries start with `   N - ...` and may wrap onto indented continuation lines.
 */
const ID_SECTION_HEADER = /^(Predicate Information|Query Block Name|Column Projection Information|Hint Report)\b/i;
const ID_SECTION_ENTRY = /^\s+(\d+)\s+-(?:\s|$)/;
const RULE_LINE = /^[-=\s]+$/;

/** Operation id of a plan-table row line, or null when the line is not one. */
export function parsePlanTableRowId(line: string): number | null {
  const match = PLAN_TABLE_ROW.exec(line);
  return match ? Number(match[1]) : null;
}

/**
 * For every line of `text`, the operation id it refers to (or null):
 * plan-table rows, plus entries (and their wrapped continuation lines) in the
 * Predicate Information / Query Block Name / Column Projection / Hint Report
 * sections. Callers should still check the id exists in the parsed plan.
 */
export function buildLineOperationMap(text: string): Array<number | null> {
  const lines = splitLines(text);
  const result: Array<number | null> = new Array(lines.length).fill(null);
  let inIdSection = false;
  let currentEntryId: number | null = null;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    const rowId = parsePlanTableRowId(line);
    if (rowId !== null) {
      result[i] = rowId;
      inIdSection = false;
      currentEntryId = null;
      continue;
    }

    if (ID_SECTION_HEADER.test(line)) {
      inIdSection = true;
      currentEntryId = null;
      continue;
    }

    if (!inIdSection) continue;

    if (line.trim() === '') {
      currentEntryId = null;
      continue;
    }
    if (RULE_LINE.test(line)) continue;
    // "Total hints for statement: 1" sits between the Hint Report header and its rule.
    if (/^Total hints\b/i.test(line)) continue;

    // Any other text starting in column 0 ("Note", "Plan hash value", …) ends the section.
    if (!/^\s/.test(line)) {
      inIdSection = false;
      currentEntryId = null;
      continue;
    }

    const entry = ID_SECTION_ENTRY.exec(line);
    if (entry) {
      currentEntryId = Number(entry[1]);
      result[i] = currentEntryId;
    } else if (currentEntryId !== null) {
      result[i] = currentEntryId;
    }
  }

  return result;
}

/** Split on \n, tolerating \r\n line endings (the \r is dropped). */
export function splitLines(text: string): string[] {
  return text.split('\n').map((line) => (line.endsWith('\r') ? line.slice(0, -1) : line));
}

// ---------------------------------------------------------------------------
// Search
// ---------------------------------------------------------------------------

export interface TextMatch {
  /** 0-based line index. */
  line: number;
  /** Start offset within the line (inclusive). */
  start: number;
  /** End offset within the line (exclusive). */
  end: number;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Case-insensitive, non-overlapping literal matches of `query` in each line,
 * in document order. A blank / whitespace-only query matches nothing.
 * Matches never span lines.
 */
export function findTextMatches(lines: readonly string[], query: string): TextMatch[] {
  if (!query || query.trim() === '') return [];
  const regex = new RegExp(escapeRegExp(query), 'gi');
  const matches: TextMatch[] = [];
  lines.forEach((line, lineIndex) => {
    regex.lastIndex = 0;
    for (const m of line.matchAll(regex)) {
      const start = m.index ?? 0;
      matches.push({ line: lineIndex, start, end: start + m[0].length });
    }
  });
  return matches;
}

// ---------------------------------------------------------------------------
// Highlight segments
// ---------------------------------------------------------------------------

export interface HighlightRange<K extends string> {
  start: number;
  end: number;
  kind: K;
}

export interface LineSegment<K extends string> {
  start: number;
  end: number;
  /** Highest-priority highlight covering this segment, or null for plain text. */
  kind: K | null;
}

/**
 * Split a line of `length` characters into contiguous segments, labelling
 * each with the highest-priority range covering it. `priority` lists kinds
 * from lowest to highest priority; overlapping ranges resolve to the later
 * kind. Adjacent segments with the same kind are merged.
 */
export function segmentLine<K extends string>(
  length: number,
  ranges: readonly HighlightRange<K>[],
  priority: readonly K[],
): LineSegment<K>[] {
  if (length <= 0) return [];
  const clamped = ranges
    .map((r) => ({ start: Math.max(0, r.start), end: Math.min(length, r.end), kind: r.kind }))
    .filter((r) => r.end > r.start);
  if (clamped.length === 0) return [{ start: 0, end: length, kind: null }];

  const cuts = new Set<number>([0, length]);
  for (const r of clamped) {
    cuts.add(r.start);
    cuts.add(r.end);
  }
  const points = [...cuts].sort((a, b) => a - b);
  const rank = (kind: K) => priority.indexOf(kind);

  const segments: LineSegment<K>[] = [];
  for (let i = 0; i < points.length - 1; i++) {
    const start = points[i];
    const end = points[i + 1];
    let best: K | null = null;
    for (const r of clamped) {
      if (r.start <= start && r.end >= end && (best === null || rank(r.kind) > rank(best))) {
        best = r.kind;
      }
    }
    const prev = segments[segments.length - 1];
    if (prev && prev.kind === best && prev.end === start) {
      prev.end = end;
    } else {
      segments.push({ start, end, kind: best });
    }
  }
  return segments;
}
