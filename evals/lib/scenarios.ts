/**
 * Scenario corpus loader. Each scenario is a directory
 * `evals/scenarios/NN-name/` holding setup.sql, query.sql and expect.json.
 */

import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

export interface ScenarioExpectation {
  tags: string[];
  rootCause: string;
  planFeatures: string[];
}

export interface Scenario {
  name: string;
  dir: string;
  setupSql: string;
  querySql: string;
  expect: ScenarioExpectation;
}

function resolveScenariosDir(): string {
  try {
    // tsx / node: this module lives at evals/lib/scenarios.ts on disk.
    return fileURLToPath(new URL('../scenarios', import.meta.url));
  } catch {
    // vitest jsdom serves modules over http — fall back to the repo cwd.
    return join(process.cwd(), 'evals', 'scenarios');
  }
}

export const SCENARIOS_DIR = resolveScenariosDir();

export function listScenarioNames(dir: string = SCENARIOS_DIR): string[] {
  return readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
}

export function loadScenario(name: string, baseDir: string = SCENARIOS_DIR): Scenario {
  const dir = join(baseDir, name);
  const expect = JSON.parse(readFileSync(join(dir, 'expect.json'), 'utf8')) as ScenarioExpectation;
  return {
    name,
    dir,
    setupSql: readFileSync(join(dir, 'setup.sql'), 'utf8'),
    querySql: readFileSync(join(dir, 'query.sql'), 'utf8'),
    expect,
  };
}

/** Load all scenarios, optionally filtered by substring match on the name. */
export function loadScenarios(filters: string[] = []): Scenario[] {
  return listScenarioNames()
    .filter(
      (name) => filters.length === 0 || filters.some((f) => name.includes(f)),
    )
    .map((name) => loadScenario(name));
}

/** The single statement in query.sql, trailing `;`/`/` stripped. */
export function queryStatement(scenario: Scenario): string {
  return scenario.querySql
    .split(/\r?\n/)
    .filter((line) => !line.trim().startsWith('--'))
    .join('\n')
    .trim()
    .replace(/[;/]\s*$/, '')
    .trim();
}
