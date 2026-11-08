#!/usr/bin/env node
// Copies gather_plan_metadata.sql's PL/SQL block (the DECLARE ... END; between
// its OPEN and CLOSE sections) into plan_to_json.sql between the
// `-- @@GATHER:BEGIN@@` / `-- @@GATHER:END@@` markers, so plan_to_json.sql
// stays a single self-contained file. Run after editing the gather script:
//
//   node scripts/sync-plan-to-json.mjs          # rewrite plan_to_json.sql
//   node scripts/sync-plan-to-json.mjs --check  # exit 1 when out of date
//
// src/lib/__tests__/planToJsonScript.test.ts runs the same check.
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const GATHER = join(here, 'gather_plan_metadata.sql');
const TARGET = join(here, 'plan_to_json.sql');

/** The gather script's PL/SQL block: from `DECLARE` after the OPEN section to its `END;`. */
export function extractGatherBlock(gather) {
  const lines = gather.split('\n');
  const openEnd = lines.findIndex((l) => l.trim() === '-- @@GEN:OPEN:END@@');
  const closeBegin = lines.findIndex((l) => l.trim() === '-- @@GEN:CLOSE:BEGIN@@');
  if (openEnd === -1 || closeBegin === -1) throw new Error('gather_plan_metadata.sql: OPEN/CLOSE markers not found');
  const start = lines.findIndex((l, i) => i > openEnd && l.trim() === 'DECLARE');
  let slash = -1;
  for (let i = closeBegin - 1; i > start; i--) {
    if (lines[i].trim() === '/') { slash = i; break; }
  }
  if (start === -1 || slash === -1) throw new Error('gather_plan_metadata.sql: PL/SQL block not found');
  return lines.slice(start, slash).join('\n').replace(/\s+$/, '');
}

/** plan_to_json.sql with the gather block between its markers replaced by `block`. */
export function embedGatherBlock(target, block) {
  const lines = target.split('\n');
  const begin = lines.findIndex((l) => l.trim() === '-- @@GATHER:BEGIN@@');
  const end = lines.findIndex((l) => l.trim() === '-- @@GATHER:END@@');
  if (begin === -1 || end === -1 || end < begin) throw new Error('plan_to_json.sql: @@GATHER markers not found');
  return [...lines.slice(0, begin + 1), block, ...lines.slice(end)].join('\n');
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const current = readFileSync(TARGET, 'utf-8');
  const next = embedGatherBlock(current, extractGatherBlock(readFileSync(GATHER, 'utf-8')));
  if (process.argv.includes('--check')) {
    if (next !== current) {
      console.error('plan_to_json.sql is out of date - run: node scripts/sync-plan-to-json.mjs');
      process.exit(1);
    }
    console.log('plan_to_json.sql is in sync with gather_plan_metadata.sql');
  } else if (next !== current) {
    writeFileSync(TARGET, next);
    console.log('Updated plan_to_json.sql from gather_plan_metadata.sql');
  } else {
    console.log('plan_to_json.sql already in sync');
  }
}
