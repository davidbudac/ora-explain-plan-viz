/**
 * Re-export from the new parser module for backward compatibility.
 * The parsePlan function now supports multiple input formats with auto-detection.
 */
export {
  parsePlan as parseExplainPlan,
  parsePlan,
  parsePlans,
  extractDbmsXplanSegments,
  splitDbmsXplanPlanBatches,
  detectFormat,
  hasRuntimeStats,
  getSourceDisplayName,
} from './parser/index';
