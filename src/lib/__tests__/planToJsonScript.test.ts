import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const scripts = join(__dirname, '../../../scripts');

describe('scripts/plan_to_json.sql', () => {
  it('embeds the current gather_plan_metadata.sql block (run node scripts/sync-plan-to-json.mjs)', () => {
    expect(() =>
      execFileSync(process.execPath, [join(scripts, 'sync-plan-to-json.mjs'), '--check'], { stdio: 'pipe' }),
    ).not.toThrow();
  });

  it('uses no substitution variables in the embedded gather block beyond arg1 / arg2', () => {
    const script = readFileSync(join(scripts, 'plan_to_json.sql'), 'utf-8');
    const block = script.slice(script.indexOf('-- @@GATHER:BEGIN@@'), script.indexOf('-- @@GATHER:END@@'));
    const vars = new Set([...block.matchAll(/&(\w+)/g)].map((m) => m[1]));
    expect([...vars].sort()).toEqual(['arg1', 'arg2']);
  });
});
