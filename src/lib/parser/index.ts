import type { ParsedPlan } from '../types';
import type { DetectedFormat, PlanParser } from './types';
import { dbmsXplanParser, extractDbmsXplanSegments } from './dbmsXplanParser';
import { sqlMonitorTextParser, sqlMonitorXmlParser } from './sqlMonitorParser';
import { jsonPlanParser } from './jsonPlanParser';
import { csvPlanParser, splitCsvPlanBatches } from './csvPlanParser';
import { xbiParser } from './xbiParser';
import { normalizeNewlines } from './values';
import { computeEstimatedRowTotals, computeSelfCosts, computeSelfTimes } from '../analysis';

const SUPPORTED_FORMATS_HINT =
  'Supported: DBMS_XPLAN, SQL Monitor (text / XML / ACTIVE), V$SQL_PLAN JSON / CSV and xbi.sql output.';

/**
 * List of available parsers in priority order.
 * JSON parser is checked first as it has the most unambiguous detection (starts with '[').
 * XML parser is next as it has distinctive markers.
 */
const parsers: Array<{ format: DetectedFormat; parser: PlanParser }> = [
  { format: 'json', parser: jsonPlanParser },
  { format: 'csv', parser: csvPlanParser },
  { format: 'sql_monitor_xml', parser: sqlMonitorXmlParser },
  { format: 'sql_monitor_text', parser: sqlMonitorTextParser },
  { format: 'xbi', parser: xbiParser },
  { format: 'dbms_xplan', parser: dbmsXplanParser },
];

/**
 * Detect the format of the input string.
 * @param input Raw plan text or XML
 * @returns Detected format type
 */
/** Strip leading/trailing double-quotes that users sometimes copy from SQL*Plus or shells. */
function stripWrappingQuotes(input: string): string {
  const trimmed = input.trim();
  // A fully quoted CSV ("ID","PARENT_ID",... first, a quoted last field at the end) is not a wrapped paste.
  if (csvPlanParser.canParse(trimmed)) return trimmed;
  if (trimmed.length >= 2 && trimmed[0] === '"' && trimmed[trimmed.length - 1] === '"') {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

export function detectFormat(input: string): DetectedFormat {
  const cleaned = stripWrappingQuotes(normalizeNewlines(input));
  for (const { format, parser } of parsers) {
    if (parser.canParse(cleaned)) {
      return format;
    }
  }
  return 'unknown';
}

/** Post-parse derivations shared by every source (self times first; the rest are independent). */
function finalizePlan(plan: ParsedPlan): ParsedPlan {
  computeSelfTimes(plan);
  computeEstimatedRowTotals(plan);
  computeSelfCosts(plan);
  return plan;
}

/**
 * Parse an execution plan from any supported format.
 * Automatically detects the format and uses the appropriate parser.
 *
 * @param input Raw plan text (DBMS_XPLAN output, SQL Monitor text, or SQL Monitor XML)
 * @returns Parsed plan structure with source metadata
 */
export function parsePlan(input: string): ParsedPlan {
  input = stripWrappingQuotes(normalizeNewlines(input));
  const format = detectFormat(input);

  for (const { format: parserFormat, parser } of parsers) {
    if (parserFormat === format) {
      const plan = parser.parse(input);
      return finalizePlan(plan);
    }
  }

  // Fallback to DBMS_XPLAN parser for unknown formats
  const plan = dbmsXplanParser.parse(input);
  if (!plan.rootNode) {
    plan.warnings = [
      ...(plan.warnings ?? []),
      {
        code: 'unrecognised_format',
        message: `The text matched none of the supported formats, so it was tried as DBMS_XPLAN output and no plan table was found. ${SUPPORTED_FORMATS_HINT}`,
      },
    ];
  }
  return finalizePlan(plan);
}

/**
 * Split a paste holding several plans into one text per plan: CSV by SQL_ID / child number /
 * plan hash, everything else by DBMS_XPLAN "Plan hash value" blocks.
 */
export function splitPlanBatches(input: string): string[] {
  const normalized = normalizeNewlines(input);
  return csvPlanParser.canParse(normalized) ? splitCsvPlanBatches(normalized) : extractDbmsXplanSegments(normalized);
}

/** @deprecated Kept for existing imports; use `splitPlanBatches`. */
export const splitDbmsXplanPlanBatches = splitPlanBatches;

export function parsePlans(input: string): ParsedPlan[] {
  return splitPlanBatches(input)
    .map((batch) => parsePlan(batch))
    .filter((plan) => Boolean(plan.rootNode));
}

/**
 * Check if the parsed plan has actual runtime statistics available.
 * @param plan Parsed plan
 * @returns true if actual statistics are present
 */
export function hasRuntimeStats(plan: ParsedPlan): boolean {
  return plan.hasActualStats;
}

/**
 * Get display name for the plan source.
 * @param source Plan source type
 * @returns Human-readable source name
 */
export function getSourceDisplayName(source: ParsedPlan['source']): string {
  switch (source) {
    case 'dbms_xplan':
      return 'DBMS_XPLAN';
    case 'sql_monitor_text':
      return 'SQL Monitor (Text)';
    case 'sql_monitor_xml':
      return 'SQL Monitor (XML)';
    case 'json':
      return 'JSON (V$SQL_PLAN)';
    case 'csv':
      return 'CSV (V$SQL_PLAN)';
    case 'xbi':
      return 'XBI (Tanel Poder)';
    default:
      return 'Unknown';
  }
}

// Re-export types
export type { DetectedFormat, PlanParser } from './types';

// Re-export individual parsers for direct use if needed
export { dbmsXplanParser } from './dbmsXplanParser';
export { extractDbmsXplanSegments, parseDbmsXplanPlans } from './dbmsXplanParser';
export { sqlMonitorTextParser, sqlMonitorXmlParser } from './sqlMonitorParser';
export { jsonPlanParser } from './jsonPlanParser';
export { csvPlanParser, splitCsvPlanBatches } from './csvPlanParser';
export { xbiParser } from './xbiParser';
