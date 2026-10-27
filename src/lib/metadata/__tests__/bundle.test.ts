import { readFileSync } from 'node:fs';
import { describe, it, expect } from 'vitest';
import { parseBundle, looksLikeMetadataBundle, emptyBundleWarning, extractBundleJson } from '../bundle';
import type { MetadataBundle } from '../bundle';

/** A structurally valid bundle large enough to exercise chunked emission. */
function makeBigBundleJson(): string {
  const columns: Record<string, unknown> = {};
  for (let i = 0; i < 300; i++) {
    columns[`COL_${i}`] = {
      data_type: 'VARCHAR2',
      nullable: true,
      num_distinct: 1000 + i,
      num_nulls: 0,
      low_value: 'aaaaaaaaaaaaaaaaaaaa',
      high_value: 'zzzzzzzzzzzzzzzzzzzz',
      density: 0.001,
      histogram: { type: 'NONE', buckets: 0 },
    };
  }
  return JSON.stringify({
    format: 'ora-plan-metadata',
    version: 1,
    captured_at: '2026-07-02T10:00:00Z',
    source: { db_name: 'PROD1', oracle_version: '19.0.0.0.0', container_name: 'PDB1' },
    plan_ref: { sql_id: 'an05rsj1up1k5', plan_hash_value: 3001234567 },
    objects: {
      'HR.BIG': {
        type: 'TABLE',
        stats: {
          num_rows: 1,
          blocks: 1,
          avg_row_len: 1,
          last_analyzed: null,
          stale_stats: 'NO',
          partitioned: false,
        },
        columns,
        indexes: [],
      },
    },
    coverage_warnings: [],
  });
}

/** Break a JSON string into fixed-size lines, the way DBMS_OUTPUT chunking does. */
function chunkLines(json: string, size: number): string[] {
  const lines: string[] = [];
  for (let off = 0; off < json.length; off += size) {
    lines.push(json.slice(off, off + size));
  }
  return lines;
}

describe('parseBundle', () => {
  it('parses a well-formed bundle and preserves its envelope and objects', () => {
    const json = JSON.stringify({
      format: 'ora-plan-metadata',
      version: 1,
      captured_at: '2026-05-15T10:23:00Z',
      source: {
        db_name: 'PROD1',
        oracle_version: '19.0.0.0.0',
        container_name: 'PDB1',
      },
      plan_ref: {
        sql_id: 'abc123def456',
        plan_hash_value: 1234567890,
      },
      objects: {
        'SH.SALES': {
          type: 'TABLE',
          stats: {
            num_rows: 1200000,
            blocks: 15000,
            avg_row_len: 60,
            last_analyzed: '2026-05-01T00:00:00Z',
            stale_stats: 'NO',
            partitioned: false,
          },
          columns: {},
          indexes: [],
        },
      },
      coverage_warnings: [],
    });

    const bundle = parseBundle(json);

    expect(bundle.format).toBe('ora-plan-metadata');
    expect(bundle.version).toBe(1);
    expect(bundle.captured_at).toBe('2026-05-15T10:23:00Z');
    expect(bundle.source.db_name).toBe('PROD1');
    expect(bundle.plan_ref.sql_id).toBe('abc123def456');
    expect(bundle.plan_ref.plan_hash_value).toBe(1234567890);

    const sales = bundle.objects['SH.SALES'];
    expect(sales?.type).toBe('TABLE');
    if (sales?.type === 'TABLE') {
      expect(sales.stats.num_rows).toBe(1200000);
      expect(sales.stats.stale_stats).toBe('NO');
    }
    expect(bundle.coverage_warnings).toEqual([]);
  });

  it('throws with a message naming the field when `format` is missing', () => {
    const json = JSON.stringify({
      version: 1,
      captured_at: '2026-05-15T10:23:00Z',
      source: { db_name: 'PROD1', oracle_version: '19.0.0.0.0', container_name: 'PDB1' },
      plan_ref: { sql_id: 'abc123def456', plan_hash_value: 1234567890 },
      objects: {},
      coverage_warnings: [],
    });

    expect(() => parseBundle(json)).toThrow(/format/);
  });

  it('throws with a message naming the field when `plan_ref` is missing', () => {
    const json = JSON.stringify({
      format: 'ora-plan-metadata',
      version: 1,
      captured_at: '2026-05-15T10:23:00Z',
      source: { db_name: 'PROD1', oracle_version: '19.0.0.0.0', container_name: 'PDB1' },
      objects: {},
      coverage_warnings: [],
    });

    expect(() => parseBundle(json)).toThrow(/plan_ref/);
  });

  it('throws with a message naming the field when `objects` is missing', () => {
    const json = JSON.stringify({
      format: 'ora-plan-metadata',
      version: 1,
      captured_at: '2026-05-15T10:23:00Z',
      source: { db_name: 'PROD1', oracle_version: '19.0.0.0.0', container_name: 'PDB1' },
      plan_ref: { sql_id: 'abc123def456', plan_hash_value: 1234567890 },
      coverage_warnings: [],
    });

    expect(() => parseBundle(json)).toThrow(/objects/);
  });

  it('rejects bundles whose `format` value is not "ora-plan-metadata"', () => {
    const json = JSON.stringify({
      format: 'some-other-format',
      version: 1,
      captured_at: '2026-05-15T10:23:00Z',
      source: { db_name: 'PROD1', oracle_version: '19.0.0.0.0', container_name: 'PDB1' },
      plan_ref: { sql_id: 'abc123def456', plan_hash_value: 1234567890 },
      objects: {},
      coverage_warnings: [],
    });

    expect(() => parseBundle(json)).toThrow(/format/);
    expect(() => parseBundle(json)).toThrow(/ora-plan-metadata/);
  });

  it('rejects bundles whose `version` is one we do not support', () => {
    const json = JSON.stringify({
      format: 'ora-plan-metadata',
      version: 999,
      captured_at: '2026-05-15T10:23:00Z',
      source: { db_name: 'PROD1', oracle_version: '19.0.0.0.0', container_name: 'PDB1' },
      plan_ref: { sql_id: 'abc123def456', plan_hash_value: 1234567890 },
      objects: {},
      coverage_warnings: [],
    });

    expect(() => parseBundle(json)).toThrow(/version/);
    expect(() => parseBundle(json)).toThrow(/999/);
  });

  it('accepts a bundle with an empty `objects` map', () => {
    const json = JSON.stringify({
      format: 'ora-plan-metadata',
      version: 1,
      captured_at: '2026-05-15T10:23:00Z',
      source: { db_name: 'PROD1', oracle_version: '19.0.0.0.0', container_name: 'PDB1' },
      plan_ref: { sql_id: 'abc123def456', plan_hash_value: 1234567890 },
      objects: {},
      coverage_warnings: [],
    });

    const bundle = parseBundle(json);

    expect(bundle.objects).toEqual({});
  });

  it('wraps malformed JSON in a domain error rather than leaking SyntaxError', () => {
    expect(() => parseBundle('not json at all {')).toThrow(/bundle.*json|json.*bundle/i);
  });

  it('parses a spool file with DBMS_OUTPUT chunk line breaks landing mid-string', () => {
    const json = makeBigBundleJson();
    expect(json.length).toBeGreaterThan(32767);
    const spool = chunkLines(json, 8000).join('\n');
    // Sanity: the naive parse of this input is what used to break.
    expect(() => JSON.parse(spool)).toThrow();

    const bundle = parseBundle(spool);
    expect(bundle.plan_ref.sql_id).toBe('an05rsj1up1k5');
    const big = bundle.objects['HR.BIG'];
    expect(big?.type).toBe('TABLE');
    if (big?.type === 'TABLE') {
      expect(Object.keys(big.columns)).toHaveLength(300);
      expect(big.columns['COL_42'].low_value).toBe('aaaaaaaaaaaaaaaaaaaa');
    }
  });

  it('parses a spool file surrounded by SQL*Plus prompt noise', () => {
    const json = makeBigBundleJson();
    const spool = [
      'SQL> @gather_plan_metadata.sql an05rsj1up1k5',
      'Enter value for 3:',
      '',
      ...chunkLines(json, 8000),
      '',
      'PL/SQL procedure successfully completed.',
      'SQL> SPOOL OFF',
      '',
    ].join('\r\n');

    const bundle = parseBundle(spool);
    expect(bundle.format).toBe('ora-plan-metadata');
    expect(bundle.plan_ref.plan_hash_value).toBe(3001234567);
  });

  it('parses a live terminal capture where the first chunk shares its line with prompt echo', () => {
    // Observed against a real 19.27 session: piping/pasting the stamped
    // screen script leaves the accumulated PL/SQL continuation prompts and
    // the first DBMS_OUTPUT chunk on ONE line. A line-level noise filter
    // that drops `SQL>`-prefixed lines would discard the payload start.
    const json = makeBigBundleJson();
    const chunks = chunkLines(json, 8000);
    const promptEcho =
      'SQL> SQL>   2    3    4    5    6    7    8    9   10   11   12   13  ';
    const session = [
      'SQL> ',
      'Session altered.',
      '',
      'SQL> SQL> SQL> SQL> SQL> SQL> SQL> SQL>',
      'SQL> ==== PLAN-METADATA BUNDLE BEGIN ====',
      promptEcho + chunks[0],
      ...chunks.slice(1),
      'SQL> SQL> ==== PLAN-METADATA BUNDLE END ====',
      'SQL> Done. Copy everything between the two markers and paste it into',
      "SQL> the visualizer's gather dialog to attach it to your plan.",
      'SQL> Disconnected from Oracle Database 19c Enterprise Edition',
    ].join('\n');

    const bundle = parseBundle(session);
    expect(bundle.plan_ref.sql_id).toBe('an05rsj1up1k5');
    const big = bundle.objects['HR.BIG'];
    expect(big?.type).toBe('TABLE');
    if (big?.type === 'TABLE') {
      expect(Object.keys(big.columns)).toHaveLength(300);
    }
  });

  it('parses a small clean bundle with a UTF-8 BOM and trailing prompt line', () => {
    const json = JSON.stringify({
      format: 'ora-plan-metadata',
      version: 1,
      captured_at: '2026-07-02T10:00:00Z',
      source: { db_name: 'X', oracle_version: '19.0', container_name: 'PDB1' },
      plan_ref: { sql_id: 'abc', plan_hash_value: null },
      objects: {},
      coverage_warnings: [],
    });
    const spool = '\uFEFF' + json + '\nSQL> spool off\n';
    expect(parseBundle(spool).plan_ref.sql_id).toBe('abc');
  });

  it('still rejects noise-wrapped input that contains no valid JSON payload', () => {
    expect(() => parseBundle('SQL> select 1 from dual;\nORA-00942: table or view does not exist\n')).toThrow(
      /No metadata bundle found/,
    );
  });

  it('preserves `coverage_warnings` entries through parse', () => {
    const warnings = [
      { object: 'SH.OTHER', reason: 'insufficient privileges on DBA_TAB_STATISTICS' },
      { object: 'SH.MISSING', reason: 'not found in current container' },
    ];
    const json = JSON.stringify({
      format: 'ora-plan-metadata',
      version: 1,
      captured_at: '2026-05-15T10:23:00Z',
      source: { db_name: 'PROD1', oracle_version: '19.0.0.0.0', container_name: 'PDB1' },
      plan_ref: { sql_id: 'abc123def456', plan_hash_value: 1234567890 },
      objects: {},
      coverage_warnings: warnings,
    });

    const bundle = parseBundle(json);

    expect(bundle.coverage_warnings).toEqual(warnings);
  });
});

describe('parseBundle — versions and passthrough', () => {
  function envelope(version: number, extra: Record<string, unknown> = {}) {
    return {
      format: 'ora-plan-metadata',
      version,
      captured_at: '2026-05-15T10:23:00Z',
      source: { db_name: 'PROD1', oracle_version: '19.0.0.0.0', container_name: 'PDB1' },
      plan_ref: { sql_id: 'abc123def456', plan_hash_value: 1234567890 },
      objects: {},
      coverage_warnings: [],
      ...extra,
    };
  }

  it.each([1, 2, 3])('accepts version %i', (version) => {
    expect(parseBundle(JSON.stringify(envelope(version))).version).toBe(version);
  });

  // parseBundle only checks the envelope; every payload field (v1 partitioning/DDL, v2 constraints,
  // segment, extended stats, system params, SQL management, v3 histogram endpoints) must come back
  // exactly as written — nothing added, dropped or rewritten.
  it('returns every payload field unchanged', () => {
    const payload = envelope(3, {
      objects: {
        'ADHOC.SALES': {
          type: 'TABLE',
          ddl: 'CREATE TABLE "ADHOC"."SALES" (...) PARTITION BY RANGE ("SALE_DATE") ;',
          stats: {
            num_rows: 9600000, blocks: 168000, avg_row_len: 48, last_analyzed: '2026-06-01T02:00:00Z',
            stale_stats: 'NO', partitioned: true, partition_count: 24, partition_type: 'RANGE',
            subpartition_type: 'NONE', interval: "NUMTOYMINTERVAL(1,'MONTH')", partition_key: ['SALE_DATE'], subpartition_key: [],
          },
          columns: {
            STATUS: {
              data_type: 'VARCHAR2', nullable: true, num_distinct: 3, num_nulls: 0, low_value: 'ACTIVE', high_value: 'RETIRED', density: 0.000001,
              histogram: { type: 'FREQUENCY', buckets: 2, endpoints: [{ value: 'ACTIVE', endpoint_number: 480000 }, { value: 'RETIRED', endpoint_number: 500000 }] },
            },
            SYS_STUAB12$XK9F: {
              data_type: 'NUMBER', nullable: true, num_distinct: 160, num_nulls: 0, low_value: '1', high_value: '160', density: 0.00625,
              histogram: { type: 'HYBRID', buckets: 1, endpoints: [{ value: 42, endpoint_number: 9000, repeat_count: 8500 }] },
              virtual: true, hidden: true,
            },
          },
          indexes: ['ADHOC.SALES_CUST_IX'],
          constraints: {
            primary_key: { name: 'SALES_PK', columns: ['ID'] },
            foreign_keys: [{ name: 'SALES_CUST_FK', columns: ['CUSTOMER_ID'], ref_owner: 'ADHOC', ref_table: 'CUSTOMERS', ref_columns: ['ID'], delete_rule: 'SET NULL' }],
            checks: [{ name: 'SYS_C0080001', condition: '"ID" IS NOT NULL', generated: true }],
          },
          segment: { bytes: 34078720, extents: 42 },
          physical: { compression: 'DISABLED', degree: '1', temporary: false, cache: false },
          extended_stats: [{ extension_name: 'SYS_STUAB12$XK9F', extension: '("DEPT_ID","ROLE_ID")', has_histogram: true }],
        },
        'ADHOC.SALES_CUST_IX': {
          type: 'INDEX',
          ddl: 'CREATE INDEX "ADHOC"."SALES_CUST_IX" ON "ADHOC"."SALES" ("CUSTOMER_ID") LOCAL ;',
          stats: {
            uniqueness: 'NONUNIQUE', index_type: 'NORMAL', status: 'VALID', visibility: 'VISIBLE', partitioned: true,
            clustering_factor: 5400000, blevel: 2, leaf_blocks: 21000, distinct_keys: 120000, num_rows: 9600000,
            partition_type: 'RANGE', locality: 'LOCAL', partition_key: ['SALE_DATE'],
          },
          columns: ['CUSTOMER_ID'],
          table: 'ADHOC.SALES',
          segment: { bytes: 65536, extents: 8 },
        },
      },
      system_params: { db_block_size: 8192, optimizer_features_enable: '19.1.0' },
      optimizer_env: [{ name: 'optimizer_dynamic_sampling', value: '4' }],
      sql_management: {
        baselines: [{ plan_name: 'SQL_PLAN_abcdefgh', sql_handle: 'SQL_1234567890abcdef', enabled: true, accepted: true, fixed: false }],
        // NUMBER-backed directive_id exceeds 2^53, so the gather script emits it as a string.
        directives: [{
          directive_id: '13469005177969830000', type: 'DYNAMIC_SAMPLING', state: 'USABLE', reason: 'SINGLE TABLE CARDINALITY MISESTIMATE',
          objects: [{ owner: 'ADHOC', object_name: 'SALES', subobject_name: null, object_type: 'TABLE' }],
        }],
      },
    });

    expect(parseBundle(JSON.stringify(payload))).toStrictEqual(payload);
  });

  it('rejects version 4 with a message naming the supported versions', () => {
    const json = JSON.stringify(envelope(4));
    expect(() => parseBundle(json)).toThrow(/unsupported version: 4/);
    expect(() => parseBundle(json)).toThrow(/supports versions 1, 2, 3/);
  });
});

describe('looksLikeMetadataBundle', () => {
  it('matches bundle content even when wrapped in spool noise', () => {
    const spool = 'SQL> spool\n{"format":"ora-plan-metadata","version":1}\nSQL> spool off\n';
    expect(looksLikeMetadataBundle(spool)).toBe(true);
  });

  it('matches with arbitrary whitespace around the colon', () => {
    expect(looksLikeMetadataBundle('{ "format" : "ora-plan-metadata" }')).toBe(true);
  });

  it('does not match plan text or other JSON', () => {
    expect(looksLikeMetadataBundle('| 0 | SELECT STATEMENT |')).toBe(false);
    expect(looksLikeMetadataBundle('[{"id":0,"operation":"SELECT STATEMENT"}]')).toBe(false);
    expect(looksLikeMetadataBundle('{"format":"something-else"}')).toBe(false);
  });
});

describe('emptyBundleWarning', () => {
  function makeBundle(
    objects: MetadataBundle['objects'],
    coverage: MetadataBundle['coverage_warnings'],
  ): MetadataBundle {
    return {
      format: 'ora-plan-metadata',
      version: 1,
      captured_at: '2026-07-02T10:00:00Z',
      source: { db_name: 'X', oracle_version: '19.0', container_name: 'PDB1' },
      plan_ref: { sql_id: 'abc', plan_hash_value: null },
      objects,
      coverage_warnings: coverage,
    };
  }

  it('returns null when the bundle has objects', () => {
    const bundle = makeBundle(
      {
        'HR.T': {
          type: 'TABLE',
          stats: {
            num_rows: 1,
            blocks: 1,
            avg_row_len: 1,
            last_analyzed: null,
            stale_stats: null,
            partitioned: false,
          },
          columns: {},
          indexes: [],
        },
      },
      [],
    );
    expect(emptyBundleWarning(bundle)).toBeNull();
  });

  it('points at coverage warnings when the empty bundle has some', () => {
    const bundle = makeBundle({}, [{ object: 'X', reason: 'no privs' }]);
    expect(emptyBundleWarning(bundle)).toMatch(/coverage warnings/i);
  });

  it('suggests the SQL_ID aged out when the empty bundle has no coverage warnings', () => {
    const bundle = makeBundle({}, []);
    expect(emptyBundleWarning(bundle)).toMatch(/aged out/i);
  });
});

describe('parseBundle — terminal and spool captures of a real bundle', () => {
  // The bundled sample, compacted the way the gather script prints it, and
  // repeated under new object names until it spans several 8000-char chunks.
  const sample = JSON.parse(
    readFileSync('src/examples/22-sql_monitor-Cardinality Trap (NL).meta.json', 'utf8'),
  ) as MetadataBundle;
  const original: MetadataBundle = {
    ...sample,
    objects: Object.fromEntries(
      [1, 2, 3, 4].flatMap((n) => Object.entries(sample.objects).map(([k, v]) => [`${k}_${n}`, v])),
    ),
  };
  const json = JSON.stringify(original);
  const chunk = (s: string, n: number) => s.match(new RegExp(`[\\s\\S]{1,${n}}`, 'g'))!;
  const echo = 'SQL> SQL> ' + Array.from({ length: 300 }, (_, i) => `  ${i + 2}`).join('');
  const cutOff = /looks cut off/;

  it('has a payload big enough to span several DBMS_OUTPUT chunks', () => {
    expect(json.length).toBeGreaterThan(16000);
  });

  it('joins 8000-char chunks, including breaks inside strings', () => {
    expect(parseBundle(chunk(json, 8000).join('\n'))).toEqual(original);
  });

  it('cuts prompt echo glued to the first chunk, markers and trailing status lines', () => {
    const text = `Gathering plan metadata - the JSON bundle will print below.\n==== PLAN-METADATA BUNDLE BEGIN ====\n${echo} ${chunk(json, 8000).join('\n')}\n\nPL/SQL procedure successfully completed.\n\n==== PLAN-METADATA BUNDLE END ====\nDone. Copy everything between the two markers and paste it into\nthe visualizer's gather dialog to attach it to your plan.\nSQL> `;
    expect(parseBundle(text)).toEqual(original);
  });

  // A real space that happens to end a wrapped line is indistinguishable from
  // padding and is dropped, so these wrap tests pick geometry where no line ends in one.
  const endsInBlank = (lines: string[]) => lines.some((l) => /[ \t]$/.test(l));

  it('rejoins a terminal hard-wrap at 97 columns even when {"format" is split across lines', () => {
    // Prompt echo sized so the first wrap lands inside the opener: `{"f` / `ormat"`.
    const wrapped = Array.from({ length: 26 }, (_, i) => 85 + i)
      .flatMap((width) => [1, 2, 3, 4, 5, 6, 7, 8].map((back) => chunk(`SQL> ${'1'.repeat(width - back - 6)} ${json}`, width)))
      .find((lines) => !endsInBlank(lines.slice(1)))!;
    expect(wrapped).toBeDefined();
    expect(wrapped.some((l) => l.includes('{"format"'))).toBe(false);
    expect(parseBundle(wrapped.join('\n'))).toEqual(original);
  });

  it('removes trailing-space padding on wrapped lines', () => {
    const lines = Array.from({ length: 140 }, (_, i) => 60 + i)
      .map((w) => chunk(json, w))
      .find((l) => !endsInBlank(l))!;
    expect(lines).toBeDefined();
    const padded = lines.map((l) => l.padEnd(220)).join('\n');
    expect(padded).toMatch(/ \n/);
    expect(parseBundle(padded)).toEqual(original);
  });

  it('handles CRLF line endings', () => {
    expect(parseBundle(chunk(json, 8000).join('\r\n'))).toEqual(original);
  });

  it('ignores trailing text that itself contains braces', () => {
    const text = `${chunk(json, 8000).join('\n')}\n\nElapsed: 00:00:01.23\nSome text } with brace}`;
    expect(parseBundle(text)).toEqual(original);
  });

  it('parses the new script shape: one line break after every structural comma', () => {
    let inString = false;
    let escaped = false;
    let out = '';
    for (const ch of json) {
      out += ch;
      if (inString) {
        if (escaped) escaped = false;
        else if (ch === '\\') escaped = true;
        else if (ch === '"') inString = false;
      } else if (ch === '"') inString = true;
      else if (ch === ',') out += '\n';
    }
    expect(out.split('\n').length).toBeGreaterThan(50);
    expect(parseBundle(`SQL> ${out}\nPL/SQL procedure successfully completed.`)).toEqual(original);
  });

  it('escapes raw control characters inside a string value', () => {
    const text = json.replace('"sql_id":"', '"sql_id":"ab\fc\u0000d');
    expect(text).not.toBe(json);
    const bundle = parseBundle(text);
    expect(bundle.plan_ref.sql_id?.startsWith('ab\fc\u0000d')).toBe(true);
  });

  it('reports a bundle that stops before its closing brace as cut off', () => {
    expect(() => parseBundle(chunk(json.slice(0, json.length - 200), 8000).join('\n'))).toThrow(cutOff);
    expect(() => parseBundle(`SQL> ${json.slice(0, 500)}`)).toThrow(cutOff);
  });

  it('reports text without a bundle start as not found', () => {
    expect(() => parseBundle('SQL> select 1 from dual;\nno json here')).toThrow(/No metadata bundle found/);
    expect(() => parseBundle('Gathering...\n{ not a bundle')).toThrow(/Bundle is not valid JSON|cut off/);
  });

  it('extractBundleJson returns just the cleaned JSON, or null without a start', () => {
    const small = JSON.stringify({ format: 'ora-plan-metadata', version: 3, objects: { 'A.B': { ddl: 'x\ty' } } });
    expect(extractBundleJson(`noise ${chunk(small, 7).join('\n')} more noise }`)).toBe(small);
    expect(extractBundleJson('nothing to see')).toBeNull();
  });
});

describe('parseBundle — real Oracle 19c gather transcript', () => {
  // Real capture (dbmint, 19.27, PDB1, 2026-10-27): the stamped screen-mode
  // script piped into an interactive `sqlplus -L` session, as if pasted. The
  // JSON start shares its line with the continuation-prompt echo, and the
  // bundle is followed by the END marker and SQL*Plus status lines.
  const transcript = readFileSync(
    'src/lib/metadata/__tests__/fixtures/gather-screen-transcript-19c.txt',
    'utf8',
  );

  it('imports the whole transcript', () => {
    const bundle = parseBundle(transcript);
    expect(bundle.plan_ref.sql_id).toBe('btjfm8w40umc7');
    expect(Object.keys(bundle.objects)).toHaveLength(12);
    expect(bundle.coverage_warnings).toEqual([]);
  });

  it('prints lines that are valid JSON as they stand', () => {
    const start = transcript.indexOf('{"format"');
    const end = transcript.lastIndexOf('}', transcript.indexOf('==== PLAN-METADATA BUNDLE END ===='));
    const printed = transcript.slice(start, end + 1);
    expect(printed.split('\n').length).toBeGreaterThan(100);
    expect(() => JSON.parse(printed)).not.toThrow();
  });
});
