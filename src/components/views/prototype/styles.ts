// PROTOTYPE — throwaway UI prototype for wayfinder ticket 08 (non-expert analysis report design). Not production code.

/** Severity styling shared by the three variants (kept out of the .tsx files so fast refresh stays happy). */

import { SEVERITY_STYLES } from '../../../lib/severityStyles';
import type { ReportSeverity } from './mockReport';

export { SEVERITY_STYLES };

export const SEVERITY_DOT: Record<ReportSeverity, string> = {
  critical: 'bg-red-500',
  warning: 'bg-amber-500',
  info: 'bg-sky-500',
};

export const SEVERITY_EDGE: Record<ReportSeverity, string> = {
  critical: 'border-red-500',
  warning: 'border-amber-500',
  info: 'border-sky-500',
};

export const SEVERITY_LABEL: Record<ReportSeverity, string> = {
  critical: 'Critical',
  warning: 'Warning',
  info: 'Info',
};
