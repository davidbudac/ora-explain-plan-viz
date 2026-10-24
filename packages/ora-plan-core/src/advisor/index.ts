export type { FindingSeverity, Finding, RuleContext, AdvisorRule, AdvisorReport, FindObjectFn } from './types.ts';
export { DEFAULT_THRESHOLDS, type AdvisorThresholds } from './config.ts';
export { runAdvisor } from './engine.ts';
export { findImplicitConversions, type ConversionHit } from './predicates.ts';
export { ALL_RULES } from './rules/index.ts';
