import type { ParsedPlan } from '../types';
import type { DetectedFormat, PlanParser } from './types';
import { dbmsXplanParser, extractDbmsXplanSegments } from './dbmsXplanParser';
import { sqlMonitorTextParser, sqlMonitorXmlParser } from './sqlMonitorParser';
import { jsonPlanParser } from './jsonPlanParser';

/**
 * List of available parsers in priority order.
 * JSON parser is checked first as it has the most unambiguous detection (starts with '[').
 * XML parser is next as it has distinctive markers.
 */
const parsers: Array<{ format: DetectedFormat; parser: PlanParser }> = [
  { format: 'json', parser: jsonPlanParser },
  { format: 'sql_monitor_xml', parser: sqlMonitorXmlParser },
  { format: 'sql_monitor_text', parser: sqlMonitorTextParser },
  { format: 'dbms_xplan', parser: dbmsXplanParser },
];

/**
 * Detect the format of the input string.
 * @param input Raw plan text or XML
 * @returns Detected format type
 */
export function detectFormat(input: string): DetectedFormat {
  for (const { format, parser } of parsers) {
    if (parser.canParse(input)) {
      return format;
    }
  }
  return 'unknown';
}

/**
 * Parse an execution plan from any supported format.
 * Automatically detects the format and uses the appropriate parser.
 *
 * @param input Raw plan text (DBMS_XPLAN output, SQL Monitor text, or SQL Monitor XML)
 * @returns Parsed plan structure with source metadata
 */
export function parsePlan(input: string): ParsedPlan {
  const format = detectFormat(input);

  for (const { format: parserFormat, parser } of parsers) {
    if (parserFormat === format) {
      return parser.parse(input);
    }
  }

  // Fallback to DBMS_XPLAN parser for unknown formats
  return dbmsXplanParser.parse(input);
}

export const splitDbmsXplanPlanBatches = extractDbmsXplanSegments;

export function parsePlans(input: string): ParsedPlan[] {
  return splitDbmsXplanPlanBatches(input)
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
