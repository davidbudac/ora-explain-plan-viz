/**
 * Single source of truth for the input formats the app accepts.
 *
 * The textarea placeholder, parse-error messages and the start screen all read
 * from here so the lists can no longer drift apart (they used to disagree on
 * whether xbi.sql output and metadata bundles were supported).
 */
import { detectFormat } from './parser/index';
import type { DetectedFormat } from './parser/index';
import { isActiveReport } from './parser/activeReport';

export type SupportedFormatId =
  | 'dbms_xplan'
  | 'sql_monitor_text'
  | 'sql_monitor_xml'
  | 'sql_monitor_active'
  | 'json'
  | 'xbi'
  | 'metadata_bundle';

export interface SupportedFormat {
  id: SupportedFormatId;
  /** Short display name, e.g. "SQL Monitor XML report". */
  name: string;
  /** One-line hint on where the text comes from. */
  hint: string;
  /** False for inputs that enrich a plan rather than being a plan themselves. */
  isPlan: boolean;
}

export const SUPPORTED_FORMATS: readonly SupportedFormat[] = [
  {
    id: 'dbms_xplan',
    name: 'DBMS_XPLAN output',
    hint: 'DISPLAY, DISPLAY_CURSOR or DISPLAY_AWR text, incl. ALLSTATS runtime columns',
    isPlan: true,
  },
  {
    id: 'sql_monitor_text',
    name: 'SQL Monitor text report',
    hint: "DBMS_SQL_MONITOR.REPORT_SQL_MONITOR(type => 'TEXT')",
    isPlan: true,
  },
  {
    id: 'sql_monitor_xml',
    name: 'SQL Monitor XML report',
    hint: "REPORT_SQL_MONITOR(type => 'XML') — richest: actuals, ASH activity, binds",
    isPlan: true,
  },
  {
    id: 'sql_monitor_active',
    name: 'SQL Monitor ACTIVE report (HTML)',
    hint: "REPORT_SQL_MONITOR(type => 'ACTIVE') saved as .html — decoded to the XML report on load",
    isPlan: true,
  },
  {
    id: 'json',
    name: 'V$SQL_PLAN JSON',
    hint: 'V$SQL_PLAN / V$SQL_PLAN_STATISTICS_ALL rows as a JSON array',
    isPlan: true,
  },
  {
    id: 'xbi',
    name: 'xbi.sql output',
    hint: "Tanel Poder's eXplain Better script",
    isPlan: true,
  },
  {
    id: 'metadata_bundle',
    name: 'Metadata bundle',
    hint: 'gather_plan_metadata.sql output — attaches schema stats to a loaded plan',
    isPlan: false,
  },
];

/** Short labels used in the one-sentence summary. */
const SHORT_NAMES: Record<SupportedFormatId, string> = {
  dbms_xplan: 'DBMS_XPLAN',
  sql_monitor_text: 'SQL Monitor text',
  sql_monitor_xml: 'SQL Monitor XML',
  sql_monitor_active: 'SQL Monitor ACTIVE (HTML)',
  json: 'V$SQL_PLAN JSON',
  xbi: 'xbi.sql output',
  metadata_bundle: 'metadata bundles',
};

function joinWithAnd(items: string[]): string {
  if (items.length <= 1) return items.join('');
  return `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`;
}

/** "Supported formats: DBMS_XPLAN, SQL Monitor text, … and metadata bundles." */
export const SUPPORTED_FORMATS_SENTENCE = `Supported formats: ${joinWithAnd(
  SUPPORTED_FORMATS.map((f) => SHORT_NAMES[f.id]),
)}.`;

/** Generic message when nothing in the text looks like a plan. */
export const PARSE_FAILED_MESSAGE = `Could not parse this as an execution plan. ${SUPPORTED_FORMATS_SENTENCE}`;

/** Placeholder for the plan input textarea. */
export const INPUT_PLACEHOLDER = [
  'Paste an Oracle execution plan here, drop a file anywhere on the page, or pick one from Load Example.',
  '',
  'Supported formats:',
  ...SUPPORTED_FORMATS.map((f) => `  • ${f.name}`),
  '',
  'Multiple DBMS_XPLAN plans in one paste are split into separate tabs.',
].join('\n');

const DETECTED_FORMAT_NAMES: Record<Exclude<DetectedFormat, 'unknown'>, string> = {
  dbms_xplan: 'DBMS_XPLAN output',
  sql_monitor_text: 'a SQL Monitor text report',
  sql_monitor_xml: 'SQL Monitor XML',
  json: 'V$SQL_PLAN JSON',
  xbi: 'xbi.sql output',
};

/** Human name for a detected plan format, or null when nothing was recognised. */
export function describeDetectedFormat(format: DetectedFormat): string | null {
  return format === 'unknown' ? null : DETECTED_FORMAT_NAMES[format];
}

/**
 * Explain why `input` produced no plan. When the text was recognised as a
 * known format but yielded no operations, say so (that usually means a
 * truncated copy); otherwise fall back to the supported-formats message.
 */
export function describeParseFailure(input: string, detected: DetectedFormat = safeDetect(input)): string {
  const name = describeDetectedFormat(detected);
  if (name) {
    return `Looks like ${name} but no plan operations were found. Check that the copy includes the whole plan table.`;
  }
  return PARSE_FAILED_MESSAGE;
}

function safeDetect(input: string): DetectedFormat {
  try {
    return detectFormat(input);
  } catch {
    return 'unknown';
  }
}

/** True when the text is recognisably one of the plan formats (used for auto-parse on paste). */
export function looksLikePlan(input: string): boolean {
  if (!input.trim()) return false;
  if (isActiveReport(input)) return true;
  return safeDetect(input) !== 'unknown';
}
