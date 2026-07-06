import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  buildGatherScript,
  downloadFilename,
  SCREEN_BEGIN_MARKER,
  SCREEN_END_MARKER,
} from '../gatherScript';
import { parseBundle } from '../bundle';

const template = readFileSync(
  join(__dirname, '../../../../scripts/gather_plan_metadata.sql'),
  'utf-8',
);

describe('buildGatherScript', () => {
  it('stamps SQL_ID and plan hash into a spool script with no positional args', () => {
    const script = buildGatherScript(
      template,
      { mode: 'sqlid', sqlId: 'an05rsj1up1k5', planHash: '3001234567' },
      'spool',
    );
    expect(script).toContain('DEFINE arg1 = "an05rsj1up1k5"');
    expect(script).toContain('DEFINE arg2 = "3001234567"');
    expect(script).toContain('DEFINE spool_target = "bundle.json"');
    // No leftover positional-arg plumbing that would make SQL*Plus prompt
    expect(script).not.toMatch(/&1|&2|&3/);
    expect(script).not.toContain('COLUMN 2 NEW_VALUE');
    // No generator markers survive stamping
    expect(script).not.toMatch(/^-- @@GEN:/m);
    // Still spools itself
    expect(script).toMatch(/^SPOOL &spool_target$/m);
    expect(script).toMatch(/^SPOOL OFF$/m);
    expect(script).toMatch(/^UNDEFINE spool_target$/m);
  });

  it('omits the plan hash define value when not provided', () => {
    const script = buildGatherScript(template, { mode: 'sqlid', sqlId: 'abc123' }, 'spool');
    expect(script).toContain('DEFINE arg2 = ""');
  });

  it('builds a screen script that prints between markers instead of spooling', () => {
    const script = buildGatherScript(
      template,
      { mode: 'sqlid', sqlId: 'an05rsj1up1k5' },
      'screen',
    );
    expect(script).not.toMatch(/^SPOOL /m);
    expect(script).not.toContain('spool_target');
    expect(script).toContain(`PROMPT ${SCREEN_BEGIN_MARKER}`);
    expect(script).toContain(`PROMPT ${SCREEN_END_MARKER}`);
    expect(script).not.toMatch(/&1|&2|&3/);
    expect(script).not.toMatch(/^-- @@GEN:/m);
    // JSON must stay on screen for copy-back
    const openIdx = script.indexOf(SCREEN_BEGIN_MARKER);
    const emitIdx = script.indexOf('DBMS_OUTPUT.PUT_LINE');
    expect(openIdx).toBeGreaterThan(-1);
    expect(script.slice(openIdx, emitIdx)).not.toContain('SET TERMOUT OFF');
  });

  it('stamps LIST mode with the object list', () => {
    const script = buildGatherScript(
      template,
      { mode: 'manual', objectList: 'HR.EMPLOYEES,HR.DEPARTMENTS' },
      'screen',
    );
    expect(script).toContain('DEFINE arg1 = "LIST"');
    expect(script).toContain('DEFINE arg2 = "HR.EMPLOYEES,HR.DEPARTMENTS"');
  });

  it('strips characters that would escape the DEFINE quoting', () => {
    const script = buildGatherScript(
      template,
      { mode: 'sqlid', sqlId: 'abc"&\'123', planHash: '12"34' },
      'spool',
    );
    expect(script).toContain('DEFINE arg1 = "abc123"');
    expect(script).toContain('DEFINE arg2 = "1234"');
  });

  it('leaves the template runnable as-is (markers intact, args still positional)', () => {
    expect(template).toContain('-- @@GEN:ARGS:BEGIN@@');
    expect(template).toContain('-- @@GEN:OPEN:BEGIN@@');
    expect(template).toContain('-- @@GEN:CLOSE:BEGIN@@');
    expect(template).toContain('-- @@GEN:CLEANUP:BEGIN@@');
    expect(template).toContain('DEFINE arg1 = "&1"');
  });

  it('emits bundle format version 2', () => {
    expect(template).toContain('"version":2');
  });
});

describe('screen output round-trip', () => {
  it('parseBundle recovers the bundle from a copied terminal session', () => {
    const bundle = {
      format: 'ora-plan-metadata',
      version: 1,
      captured_at: '2026-07-03T10:00:00Z',
      source: { db_name: 'PROD1', oracle_version: '19.27', container_name: 'PDB1' },
      plan_ref: { sql_id: 'an05rsj1up1k5', plan_hash_value: 3001234567 },
      objects: {
        'HR.EMPLOYEES': {
          type: 'TABLE',
          stats: {
            num_rows: 107,
            blocks: 5,
            avg_row_len: 69,
            last_analyzed: '2026-07-01T00:00:00Z',
            stale_stats: 'NO',
            partitioned: false,
          },
          columns: {},
          indexes: [],
        },
      },
      coverage_warnings: [],
    };
    const json = JSON.stringify(bundle);
    // DBMS_OUTPUT chunking breaks the payload at arbitrary positions,
    // including mid-string; simulate with small chunks.
    const chunks: string[] = [];
    for (let i = 0; i < json.length; i += 40) chunks.push(json.slice(i, i + 40));
    const session = [
      'SQL> PROMPT Gathering plan metadata - the JSON bundle will print below.',
      'Gathering plan metadata - the JSON bundle will print below.',
      SCREEN_BEGIN_MARKER,
      ...chunks,
      SCREEN_END_MARKER,
      'Done. Copy everything between the two markers and paste it into',
      "the visualizer's gather dialog to attach it to your plan.",
      'SQL> ',
    ].join('\n');

    const parsed = parseBundle(session);
    expect(parsed.plan_ref.sql_id).toBe('an05rsj1up1k5');
    expect(Object.keys(parsed.objects)).toEqual(['HR.EMPLOYEES']);
  });
});
