import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { splitSqlScript } from '../lib/db';
import { listScenarioNames, loadScenario, queryStatement, SCENARIOS_DIR } from '../lib/scenarios';

describe('scenario corpus', () => {
  const names = listScenarioNames();

  // The corpus itself is private (oraplanviz-pro); the public repo may have
  // zero scenarios checked out. Whatever is present must be well-formed.
  it('lists only NN-name directories', () => {
    for (const name of names) expect(name).toMatch(/^\d{2}-[a-z0-9-]+$/);
  });

  for (const name of names) {
    describe(name, () => {
      it('has setup.sql, query.sql and a parseable expect.json', () => {
        for (const file of ['setup.sql', 'query.sql', 'expect.json']) {
          expect(existsSync(join(SCENARIOS_DIR, name, file)), `${name}/${file}`).toBe(true);
        }
        const scenario = loadScenario(name);
        expect(Array.isArray(scenario.expect.tags)).toBe(true);
        expect(scenario.expect.tags.length).toBeGreaterThan(0);
        expect(typeof scenario.expect.rootCause).toBe('string');
        expect(scenario.expect.rootCause.length).toBeGreaterThan(10);
        expect(Array.isArray(scenario.expect.planFeatures)).toBe(true);
        expect(scenario.expect.planFeatures.length).toBeGreaterThan(0);
      });

      it('setup.sql splits into executable statements without EXEC leftovers', () => {
        const scenario = loadScenario(name);
        const { statements } = splitSqlScript(scenario.setupSql);
        expect(statements.length).toBeGreaterThan(0);
        // Objects must all carry the EVAL_ prefix.
        for (const stmt of statements) {
          const created = stmt.match(/CREATE\s+(?:UNIQUE\s+)?(?:TABLE|INDEX)\s+(\S+)/i);
          if (created) expect(created[1].toUpperCase().startsWith('EVAL_')).toBe(true);
        }
      });

      it('query.sql reduces to a single SELECT statement', () => {
        const stmt = queryStatement(loadScenario(name));
        expect(stmt.toUpperCase().startsWith('SELECT')).toBe(true);
        expect(stmt.includes(';')).toBe(false);
      });
    });
  }
});
