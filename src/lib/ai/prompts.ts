import type { AiReportKind } from './types';

/**
 * Bumped whenever the system prompt or context layout changes in a way that
 * could shift report quality. Joins offline eval results with production
 * feedback (see docs/plans/ai-plan-analysis.md, Phase 2.5).
 */
export const PROMPT_VERSION = 1;

export interface ModelPreset {
  id: string;
  label: string;
}

/** Anthropic model presets; the model field also accepts free text. */
export const MODEL_PRESETS: ModelPreset[] = [
  { id: 'claude-opus-5', label: 'Claude Opus 5 (best quality)' },
  { id: 'claude-sonnet-4-6', label: 'Claude Sonnet 4.6 (balanced)' },
  { id: 'claude-haiku-4-5', label: 'Claude Haiku 4.5 (fastest)' },
];

export const DEFAULT_ANTHROPIC_MODEL = MODEL_PRESETS[0].id;
export const DEFAULT_MAX_TOKENS = 32_000;

const SHARED_RULES = `
Ground rules:
- Base every claim ONLY on the data provided in the user message. If something
  cannot be determined from the data (e.g. no runtime statistics), say so
  instead of guessing.
- Refer to plan operations by their Id ("line 7"), matching the plan table.
- Numbers in the plan table may be abbreviated (1.2K, 3.4M); treat them as
  approximate.
- If a "heuristic pre-analysis" section is present, it comes from a fixed rule
  engine: verify each hint against the plan yourself — confirm, refute, or
  refine it. Do not simply restate it.
- Write the report as GitHub-flavored markdown.

End your response with EXACTLY ONE fenced \`\`\`json block, as the very last
thing in the response, containing your findings in this shape:
{"findings":[{"severity":"info|warning|critical","title":"...","explanation":"...","suggestion":"...","nodeIds":[3,7]}]}
- nodeIds are plan line Ids from the plan table; use [] when a finding is not
  tied to specific lines.
- Order findings by severity, most severe first. Use an empty array when the
  plan looks healthy.`;

const ANALYZE_TASK = `
Analyze the Oracle execution plan provided by the user and produce an expert
performance report with these sections:
## Summary
Two or three sentences: what the statement does, where it spends its time (or
where the cost concentrates when only estimates are available), and the single
most impactful issue if any.
## Where the time goes
The dominant operations by actual time / activity (or by cost), with the plan
line Ids and why they are expensive.
## Cardinality & statistics issues
E-Rows vs A-Rows divergences and their likely causes (stale stats, skew
without histograms, correlated predicates, binds), and how they cascade into
plan choices.
## Recommendations
Concrete, prioritized actions (indexes, statistics, rewrites, hints, plan
control). For each: what to do, why it should help, and the expected effect.`;

const COMPARE_TASK = `
Compare the two Oracle execution plans provided by the user (Plan A is the
baseline, Plan B the candidate) and produce an expert report with these
sections:
## Summary
Which plan is better overall and why, in two or three sentences.
## What changed
The structural differences (join order/methods, access paths, partition
pruning, parallelism) using the node match digest, with line Ids from both
plans ("A#3 -> B#5").
## Why it changed
The likely optimizer reasoning behind each significant difference (statistics,
predicates, environment).
## Recommendations
Whether to adopt Plan B, and concrete follow-up actions either way.`;

/** Build the system prompt for an analysis run. */
export function buildSystemPrompt(kind: AiReportKind): string {
  const task = kind === 'compare' ? COMPARE_TASK : ANALYZE_TASK;
  return `You are an expert Oracle database performance engineer with deep knowledge of
the cost-based optimizer, execution plans, wait events, and SQL tuning.
${task}
${SHARED_RULES}`;
}
