import type { AdvisorRule } from '../types.js';
/**
 * Findings from the DBMS_XPLAN Hint Report (19c+) and the Note section: hints Oracle rejected
 * (syntax errors), hints it could not apply (unused, with its reason), and embedded hints that a
 * SQL plan baseline, profile or patch is likely overriding.
 */
export declare const hintsRule: AdvisorRule;
