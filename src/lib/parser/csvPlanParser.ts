import type { ParsedPlan, PlanWarning } from '../types';
import type { PlanParser } from './types';
import { buildPlanFromRows } from './jsonPlanParser';
import { normalizeNewlines } from './values';

/**
 * Parser for V$SQL_PLAN / V$SQL_PLAN_STATISTICS_ALL query results exported as CSV:
 * SQL*Plus `SET MARKUP CSV ON`, SQLcl `set sqlformat csv`, SQL Developer's CSV export,
 * plus tab-separated grid copies and `;`-delimited (European locale) exports.
 *
 * The header row carries the view's column names (ID, PARENT_ID, OPERATION, ...); each
 * record becomes one row object that the shared row-to-tree builder (jsonPlanParser) reads.
 */

const DELIMITERS = [',', ';', '\t'] as const;
/** The header must show up within this many non-empty lines (SQL*Plus may print a prompt or banner first). */
const HEADER_SEARCH_LINES = 5;
const KEY_COLUMNS_FOR_SPLIT = ['SQL_ID', 'CHILD_NUMBER', 'PLAN_HASH_VALUE'] as const;

interface CsvRecord {
  cells: string[];
  /** Offsets of the raw record text in the (newline-normalised) input; `end` is exclusive. */
  start: number;
  end: number;
}

interface CsvTable {
  text: string;
  delimiter: string;
  /** Upper-cased, unquoted, trimmed header cells. */
  header: string[];
  /** Raw header line, from its first non-blank character. */
  headerText: string;
  records: CsvRecord[];
}

/**
 * Read one RFC-4180 record starting at `pos`. A quote opens a quoted field only at the start of
 * a field; inside one, `""` is a literal quote and delimiters / newlines are data.
 * Expects `\n` line endings.
 */
function readRecord(text: string, pos: number, delimiter: string): { cells: string[]; end: number; next: number } {
  const cells: string[] = [];
  const n = text.length;
  let field = '';
  let i = pos;
  let atFieldStart = true;

  while (i < n) {
    const ch = text[i];
    if (atFieldStart && ch === '"') {
      i++;
      while (i < n) {
        if (text[i] === '"') {
          if (text[i + 1] === '"') {
            field += '"';
            i += 2;
            continue;
          }
          i++;
          break;
        }
        field += text[i++];
      }
      atFieldStart = false;
      continue;
    }
    if (ch === delimiter) {
      cells.push(field);
      field = '';
      atFieldStart = true;
      i++;
      continue;
    }
    if (ch === '\n') break;
    field += ch;
    atFieldStart = false;
    i++;
  }
  cells.push(field);
  return { cells, end: i, next: i < n ? i + 1 : n };
}

function normalizeHeaderCell(cell: string): string {
  return cell.trim().toUpperCase();
}

function isPlanHeader(header: string[]): boolean {
  return header.includes('ID') && header.includes('OPERATION') && (header.includes('PARENT_ID') || header.includes('DEPTH'));
}

/** Find the header line (and its delimiter) within the first few non-empty lines. */
function findHeader(text: string): { delimiter: string; start: number; end: number; next: number; header: string[] } | null {
  let pos = 0;
  let seen = 0;
  while (pos < text.length && seen < HEADER_SEARCH_LINES) {
    let lineEnd = text.indexOf('\n', pos);
    if (lineEnd < 0) lineEnd = text.length;
    const line = text.slice(pos, lineEnd);
    const lead = line.length - line.trimStart().length;
    if (line.trim() !== '') {
      seen++;
      for (const delimiter of DELIMITERS) {
        // A header never spans lines, so reading the line on its own is exact.
        const { cells } = readRecord(line, lead, delimiter);
        const header = cells.map(normalizeHeaderCell);
        if (isPlanHeader(header)) {
          return { delimiter, start: pos + lead, end: lineEnd, next: Math.min(lineEnd + 1, text.length), header };
        }
      }
    }
    pos = lineEnd + 1;
  }
  return null;
}

/** BOM off, line endings normalised to `\n`. */
function prepare(input: string): string {
  return normalizeNewlines(input.replace(/^\uFEFF/, ''));
}

function readTable(input: string): CsvTable | null {
  const text = prepare(input);
  const found = findHeader(text);
  if (!found) return null;

  const records: CsvRecord[] = [];
  let pos = found.next;
  while (pos < text.length) {
    const { cells, end, next } = readRecord(text, pos, found.delimiter);
    if (!(cells.length === 1 && cells[0].trim() === '')) {
      records.push({ cells, start: pos, end });
    }
    pos = next;
  }
  return { text, delimiter: found.delimiter, header: found.header, headerText: text.slice(found.start, found.end), records };
}

const INTEGER = /^\s*\d+\s*$/;

/** SQL*Plus / SQLcl chatter after the data: "3 rows selected.", "Elapsed: ...", prompts, or a single stray cell. */
function isNoise(record: CsvRecord, header: string[]): boolean {
  const { cells } = record;
  if (cells.length === 1) return true;
  if (cells.every((c) => c.trim() === '')) return true;
  // Header repeated (SQL*Plus PAGESIZE, concatenated exports)
  return cells.length === header.length && cells.every((c, i) => normalizeHeaderCell(c) === header[i]);
}

function truncateLine(line: string, max = 90): string {
  const trimmed = line.trim();
  return trimmed.length > max ? `${trimmed.slice(0, max - 1)}…` : trimmed;
}

export const csvPlanParser: PlanParser = {
  canParse(input: string): boolean {
    return findHeader(prepare(input)) !== null;
  },

  parse(input: string): ParsedPlan {
    const table = readTable(input);
    if (!table) return buildPlanFromRows([], 'csv');

    const idIndex = table.header.indexOf('ID');
    const rows: Record<string, unknown>[] = [];
    const seenIds = new Set<number>();
    const duplicateIds = new Set<number>();
    const rejected: CsvRecord[] = [];

    for (const record of table.records) {
      if (isNoise(record, table.header)) continue;
      const idCell = record.cells[idIndex] ?? '';
      if (!INTEGER.test(idCell)) {
        rejected.push(record);
        continue;
      }
      const id = parseInt(idCell, 10);
      if (seenIds.has(id)) {
        duplicateIds.add(id);
        continue;
      }
      seenIds.add(id);
      const row: Record<string, unknown> = {};
      table.header.forEach((name, i) => {
        // The row builder lower-cases keys, so the upper-cased header names match.
        row[name] = record.cells[i] ?? '';
      });
      rows.push(row);
    }

    const plan = buildPlanFromRows(rows, 'csv');

    const warnings: PlanWarning[] = [];
    if (rejected.length > 0) {
      const n = rejected.length;
      warnings.push({
        code: 'unparsed_rows',
        message: `${n} CSV row${n === 1 ? '' : 's'} had no numeric ID and ${n === 1 ? 'was' : 'were'} skipped, so ${n === 1 ? 'it is' : 'they are'} missing from the tree. Check that the export is complete and was not reformatted.`,
        detail: rejected.slice(0, 3).map((r) => truncateLine(table.text.slice(r.start, r.end))).join('\n'),
      });
    }
    if (duplicateIds.size > 0) {
      const ids = [...duplicateIds].sort((a, b) => a - b);
      const shown = ids.slice(0, 10).join(', ') + (ids.length > 10 ? ` … (+${ids.length - 10} more)` : '');
      warnings.push({
        code: 'duplicate_ids',
        message: `Operation id${ids.length === 1 ? '' : 's'} ${shown} appear${ids.length === 1 ? 's' : ''} more than once, so the export holds several plans (SQL_IDs or child cursors). Only the first row of each id was read; export one plan at a time (WHERE sql_id = … AND child_number = …).`,
      });
    }
    if (warnings.length > 0) plan.warnings = [...(plan.warnings ?? []), ...warnings];
    return plan;
  },
};

/**
 * Split a CSV holding several plans (SQL_ID / CHILD_NUMBER / PLAN_HASH_VALUE) into one text per
 * plan, each with the original header. Returns `[input]` when there is a single plan (or no
 * column to tell plans apart) and `[]` when the input is not a plan CSV.
 */
export function splitCsvPlanBatches(input: string): string[] {
  const table = readTable(input);
  if (!table) return [];

  const idIndex = table.header.indexOf('ID');
  const keyIndexes = KEY_COLUMNS_FOR_SPLIT.map((name) => table.header.indexOf(name)).filter((i) => i >= 0);
  if (keyIndexes.length === 0) return [input];

  const groups = new Map<string, string[]>();
  for (const record of table.records) {
    if (isNoise(record, table.header) || !INTEGER.test(record.cells[idIndex] ?? '')) continue;
    const key = keyIndexes.map((i) => (record.cells[i] ?? '').trim()).join('\u0000');
    const raw = table.text.slice(record.start, record.end);
    const group = groups.get(key);
    if (group) group.push(raw);
    else groups.set(key, [raw]);
  }

  if (groups.size <= 1) return [input];
  return [...groups.values()].map((raws) => [table.headerText, ...raws].join('\n'));
}
