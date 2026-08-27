/**
 * Layer 2 — repro-fidelity backtest runner.
 *
 * Per scenario: drop EVAL_% objects, run setup.sql, EXPLAIN PLAN the query
 * (original plan), gather a v3 metadata bundle, build the deterministic
 * test-case script (buildTestCaseScript), drop the objects again, execute the
 * generated script (which recreates them EMPTY with stats), EXPLAIN PLAN
 * again and compare the normalized plan shapes.
 *
 * Usage: npm run eval:repro -- [--run-id my-run] [scenario-name-filter ...]
 * Requires ORA_EVAL_USER / ORA_EVAL_PASSWORD / ORA_EVAL_CONNECT (see README).
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parsePlan } from '../src/lib/parser';
import { buildTestCaseScript } from '../src/lib/ai/testCase';
import { connect, dropEvalObjects, runScript } from './lib/db';
import { gatherBundle } from './lib/gather';
import { explainPlanText, listEvalTables } from './lib/explain';
import { planShape, shapesMatch } from './lib/planShape';
import { loadScenarios, queryStatement, type Scenario } from './lib/scenarios';

const RESULTS_DIR = fileURLToPath(new URL('./results', import.meta.url));

interface ScenarioResult {
  scenario: string;
  tags: string[];
  matched: boolean;
  originalShape: string[];
  reproShape: string[];
  scriptErrors: { statement: string; message: string }[];
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

async function runScenario(scenario: Scenario): Promise<ScenarioResult> {
  const conn = await connect();
  try {
    await dropEvalObjects(conn);
    await runScript(conn, scenario.setupSql);

    const query = queryStatement(scenario);
    const originalText = await explainPlanText(conn, query);
    const originalPlan = parsePlan(originalText);

    const tables = await listEvalTables(conn);
    const bundle = await gatherBundle(conn, tables);
    const script = buildTestCaseScript({ plan: originalPlan, bundle });

    await dropEvalObjects(conn);
    const scriptRun = await runScript(conn, script, { continueOnError: true });

    const reproText = await explainPlanText(conn, query);
    const reproPlan = parsePlan(reproText);

    const originalShape = planShape(originalPlan);
    const reproShape = planShape(reproPlan);

    await dropEvalObjects(conn);

    return {
      scenario: scenario.name,
      tags: scenario.expect.tags,
      matched: shapesMatch(originalShape, reproShape),
      originalShape,
      reproShape,
      scriptErrors: scriptRun.errors,
    };
  } finally {
    await conn.close();
  }
}

function summarize(results: ScenarioResult[]): void {
  const pct = (n: number, d: number) => (d === 0 ? '-' : `${Math.round((100 * n) / d)}%`);
  console.log('\nScenario                              Match');
  console.log('-------------------------------------------');
  for (const r of results) {
    const status = r.error ? `ERROR (${r.error})` : r.matched ? 'yes' : 'NO';
    console.log(`${r.scenario.padEnd(38)}${status}`);
  }
  const ok = results.filter((r) => r.matched).length;
  console.log(`\nRepro rate: ${ok}/${results.length} (${pct(ok, results.length)})`);

  const byTag = new Map<string, { ok: number; total: number }>();
  for (const r of results) {
    for (const tag of r.tags) {
      const entry = byTag.get(tag) ?? { ok: 0, total: 0 };
      entry.total++;
      if (r.matched) entry.ok++;
      byTag.set(tag, entry);
    }
  }
  console.log('\nPer tag:');
  for (const [tag, { ok: tagOk, total }] of [...byTag.entries()].sort()) {
    console.log(`  ${tag.padEnd(24)}${tagOk}/${total} (${pct(tagOk, total)})`);
  }
}

async function main(): Promise<void> {
  const { runId, filters } = parseArgs(process.argv.slice(2));
  const scenarios = loadScenarios(filters);
  if (scenarios.length === 0) {
    console.error(`No scenarios match ${JSON.stringify(filters)}`);
    process.exit(1);
  }

  const results: ScenarioResult[] = [];
  for (const scenario of scenarios) {
    console.log(`Running ${scenario.name} ...`);
    try {
      results.push(await runScenario(scenario));
    } catch (err) {
      results.push({
        scenario: scenario.name,
        tags: scenario.expect.tags,
        matched: false,
        originalShape: [],
        reproShape: [],
        scriptErrors: [],
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  mkdirSync(RESULTS_DIR, { recursive: true });
  const outPath = join(RESULTS_DIR, `${runId}.json`);
  writeFileSync(
    outPath,
    JSON.stringify({ kind: 'repro', runId, createdAt: new Date().toISOString(), results }, null, 2),
  );
  summarize(results);
  console.log(`\nResults written to ${outPath}`);
  process.exitCode = results.every((r) => r.matched) ? 0 : 1;
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
