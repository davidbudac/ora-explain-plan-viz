/**
 * Layer 3 skeleton — analysis-quality evals over the scenario corpus.
 *
 * Per scenario: provision the schema (setup.sql), EXPLAIN PLAN the query,
 * gather a bundle, build the analyze context EXACTLY like the app
 * (buildAnalyzeSections + assembleContext + buildSystemPrompt), stream the
 * analysis from the Anthropic provider, then score the report:
 *   - hard checks (no judge): findings JSON parses, nodeIds valid, object
 *     names mentioned in findings exist in the bundle, expect.planFeatures
 *     referenced in the report;
 *   - root-cause hit: case-insensitive keyword match against expect.rootCause.
 *
 * Usage: npm run eval:analyze -- [--run-id my-run] [scenario-name-filter ...]
 * Requires the ORA_EVAL_* vars plus ANTHROPIC_API_KEY (model from
 * ORA_EVAL_MODEL, default 'claude-opus-5').
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parsePlan } from '../src/lib/parser';
import { assembleContext, buildAnalyzeSections } from '../src/lib/ai/context';
import { buildSystemPrompt } from '../src/lib/ai/prompts';
import { parseAiFindings } from '../src/lib/ai/findings';
import { streamAnalysis } from '../src/lib/ai/provider';
import type { AiFinding } from '../src/lib/ai/types';
import type { MetadataBundle } from '../src/lib/metadata/bundle';
import { connect, dropEvalObjects, runScript } from './lib/db';
import { gatherBundle } from './lib/gather';
import { explainPlanText, listEvalTables } from './lib/explain';
import { loadScenarios, queryStatement, type Scenario } from './lib/scenarios';

const RESULTS_DIR = fileURLToPath(new URL('./results', import.meta.url));
const DEFAULT_MODEL = 'claude-opus-5';

interface HardChecks {
  findingsParsed: boolean;
  objectNamesValid: boolean;
  invalidObjectNames: string[];
  planFeaturesReferenced: boolean;
  missingPlanFeatures: string[];
}

interface AnalyzeResult {
  scenario: string;
  tags: string[];
  model: string;
  markdown: string;
  findings: AiFinding[] | null;
  hardChecks: HardChecks;
  rootCauseHit: boolean;
  rootCauseKeywordCoverage: number;
  error?: string;
}

function parseArgs(argv: string[]): { runId: string; filters: string[] } {
  let runId = new Date().toISOString().replace(/[:.]/g, '-');
  const filters: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--run-id') runId = argv[++i];
    else filters.push(argv[i]);
  }
  return { runId, filters };
}

/** Object-ish identifiers a finding mentions (EVAL_ names in this corpus). */
function mentionedObjectNames(findings: AiFinding[]): string[] {
  const names = new Set<string>();
  for (const finding of findings) {
    const text = `${finding.title} ${finding.explanation} ${finding.suggestion ?? ''}`;
    for (const match of text.toUpperCase().matchAll(/\bEVAL_[A-Z0-9_$#]+\b/g)) {
      names.add(match[0]);
    }
  }
  return [...names];
}

function runHardChecks(
  markdown: string,
  findings: AiFinding[] | null,
  bundle: MetadataBundle,
  scenario: Scenario,
): HardChecks {
  const bundleNames = new Set(Object.keys(bundle.objects).map((k) => k.toUpperCase()));
  const invalidObjectNames = findings
    ? mentionedObjectNames(findings).filter((name) => !bundleNames.has(name))
    : [];
  const upper = markdown.toUpperCase();
  const missingPlanFeatures = scenario.expect.planFeatures.filter(
    (feature) => !upper.includes(feature.toUpperCase()),
  );
  return {
    findingsParsed: findings !== null,
    objectNamesValid: invalidObjectNames.length === 0,
    invalidObjectNames,
    planFeaturesReferenced: missingPlanFeatures.length === 0,
    missingPlanFeatures,
  };
}

/** Case-insensitive keyword coverage of expect.rootCause in the report. */
function scoreRootCause(markdown: string, rootCause: string): { hit: boolean; coverage: number } {
  const stop = new Set(['the', 'and', 'that', 'with', 'over', 'into', 'from', 'for', 'has', 'its', 'was', 'are', 'not', 'most', 'much', 'very', 'instead', 'despite', 'before', 'after', 'chooses', 'grew', 'gathered', 'tells', 'matches', 'requires', 'fetching', 'single', 'wider', 'forces', 'applied', 'compared']);
  const keywords = [...new Set(
    rootCause
      .toUpperCase()
      .split(/[^A-Z0-9_']+/)
      .filter((word) => word.length >= 4 && !stop.has(word.toLowerCase())),
  )];
  const upper = markdown.toUpperCase();
  const found = keywords.filter((word) => upper.includes(word));
  const coverage = keywords.length === 0 ? 0 : found.length / keywords.length;
  return { hit: coverage >= 0.5, coverage: Math.round(coverage * 100) / 100 };
}

async function analyzeScenario(scenario: Scenario, model: string): Promise<AnalyzeResult> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY is not set — see evals/README.md.');

  const conn = await connect();
  let markdown = '';
  let plan;
  let bundle: MetadataBundle;
  try {
    await dropEvalObjects(conn);
    await runScript(conn, scenario.setupSql);
    const planText = await explainPlanText(conn, queryStatement(scenario));
    plan = parsePlan(planText);
    bundle = await gatherBundle(conn, await listEvalTables(conn));
    await dropEvalObjects(conn);
  } finally {
    await conn.close();
  }

  // Build the context exactly like the app's analyze flow (all sections on).
  const { core, sections } = buildAnalyzeSections(plan, bundle, null);
  const built = assembleContext(core, sections);
  const system = buildSystemPrompt('analyze');

  const controller = new AbortController();
  const stream = streamAnalysis(
    { provider: 'anthropic', apiKey, model },
    { system, user: built.userMessage, model, maxTokens: 32_000 },
    controller.signal,
  );
  for await (const event of stream) {
    if (event.type === 'text') markdown += event.text;
  }

  const validNodeIds = new Set(plan.allNodes.map((n) => n.id));
  // parseAiFindings already filters invented nodeIds against the plan.
  const findings = parseAiFindings(markdown, validNodeIds);
  const hardChecks = runHardChecks(markdown, findings, bundle, scenario);
  const { hit, coverage } = scoreRootCause(markdown, scenario.expect.rootCause);

  // TODO(LLM judge): add rubric-based judging per the plan doc — "Did the
  // report identify <rootCause>? Did it point at the correct plan line(s)?
  // Score 0-2 with a quote as evidence", run with a fixed cheap model
  // (claude-haiku-4-5), 3 samples, majority vote. The keyword match above is
  // a placeholder for that judge.

  return {
    scenario: scenario.name,
    tags: scenario.expect.tags,
    model,
    markdown,
    findings,
    hardChecks,
    rootCauseHit: hit,
    rootCauseKeywordCoverage: coverage,
  };
}

async function main(): Promise<void> {
  const { runId, filters } = parseArgs(process.argv.slice(2));
  const model = process.env.ORA_EVAL_MODEL || DEFAULT_MODEL;
  const scenarios = loadScenarios(filters);
  if (scenarios.length === 0) {
    console.error(`No scenarios match ${JSON.stringify(filters)}`);
    process.exit(1);
  }

  const results: AnalyzeResult[] = [];
  for (const scenario of scenarios) {
    console.log(`Analyzing ${scenario.name} (${model}) ...`);
    try {
      results.push(await analyzeScenario(scenario, model));
    } catch (err) {
      results.push({
        scenario: scenario.name,
        tags: scenario.expect.tags,
        model,
        markdown: '',
        findings: null,
        hardChecks: {
          findingsParsed: false,
          objectNamesValid: false,
          invalidObjectNames: [],
          planFeaturesReferenced: false,
          missingPlanFeatures: scenario.expect.planFeatures,
        },
        rootCauseHit: false,
        rootCauseKeywordCoverage: 0,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  mkdirSync(RESULTS_DIR, { recursive: true });
  const outPath = join(RESULTS_DIR, `${runId}-analyze.json`);
  writeFileSync(
    outPath,
    JSON.stringify({ kind: 'analyze', runId, model, createdAt: new Date().toISOString(), results }, null, 2),
  );

  console.log('\nScenario                              Findings  Objects  Features  RootCause');
  console.log('-----------------------------------------------------------------------------');
  for (const r of results) {
    const c = r.hardChecks;
    console.log(
      `${r.scenario.padEnd(38)}${(c.findingsParsed ? 'ok' : 'FAIL').padEnd(10)}${(c.objectNamesValid ? 'ok' : 'FAIL').padEnd(9)}${(c.planFeaturesReferenced ? 'ok' : 'FAIL').padEnd(10)}${r.rootCauseHit ? 'hit' : 'MISS'}${r.error ? `  (${r.error})` : ''}`,
    );
  }
  const hits = results.filter((r) => r.rootCauseHit).length;
  console.log(`\nRoot-cause hit rate: ${hits}/${results.length}`);
  console.log(`Results written to ${outPath}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
