import { describe, it, expect } from 'vitest';
import { parseBundle, looksLikeMetadataBundle, emptyBundleWarning } from '../bundle';
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
      /not valid JSON/i,
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

describe('parseBundle — partitioning and DDL fields', () => {
  it('round-trips a bundle carrying the new partitioning, locality, and ddl fields without loss', () => {
    const json = JSON.stringify({
      format: 'ora-plan-metadata',
      version: 1,
      captured_at: '2026-07-05T10:00:00Z',
      source: { db_name: 'PROD1', oracle_version: '19.0.0.0.0', container_name: 'PDB1' },
      plan_ref: { sql_id: 'an05rsj1up1k5', plan_hash_value: 3001234567 },
      objects: {
        'ADHOC.SALES': {
          type: 'TABLE',
          ddl: 'CREATE TABLE "ADHOC"."SALES" (...) PARTITION BY RANGE ("SALE_DATE") INTERVAL (NUMTOYMINTERVAL(1,\'MONTH\')) (...) ;',
          stats: {
            num_rows: 9600000,
            blocks: 168000,
            avg_row_len: 48,
            last_analyzed: '2026-06-01T02:00:00Z',
            stale_stats: 'NO',
            partitioned: true,
            partition_count: 24,
            partition_type: 'RANGE',
            subpartition_type: 'NONE',
            interval: "NUMTOYMINTERVAL(1,'MONTH')",
            partition_key: ['SALE_DATE'],
            subpartition_key: [],
          },
          columns: {},
          indexes: ['ADHOC.SALES_CUST_IX'],
        },
        'ADHOC.SALES_CUST_IX': {
          type: 'INDEX',
          ddl: 'CREATE INDEX "ADHOC"."SALES_CUST_IX" ON "ADHOC"."SALES" ("CUSTOMER_ID") LOCAL ;',
          stats: {
            uniqueness: 'NONUNIQUE',
            index_type: 'NORMAL',
            status: 'VALID',
            visibility: 'VISIBLE',
            partitioned: true,
            clustering_factor: 5400000,
            blevel: 2,
            leaf_blocks: 21000,
            distinct_keys: 120000,
            partition_type: 'RANGE',
            locality: 'LOCAL',
            partition_key: ['SALE_DATE'],
          },
          columns: ['CUSTOMER_ID'],
          table: 'ADHOC.SALES',
        },
      },
      coverage_warnings: [],
    });

    const bundle = parseBundle(json);

    const sales = bundle.objects['ADHOC.SALES'];
    expect(sales?.type).toBe('TABLE');
    if (sales?.type === 'TABLE') {
      expect(sales.ddl).toContain('PARTITION BY RANGE');
      expect(sales.stats.partition_type).toBe('RANGE');
      expect(sales.stats.subpartition_type).toBe('NONE');
      expect(sales.stats.interval).toBe("NUMTOYMINTERVAL(1,'MONTH')");
      expect(sales.stats.partition_key).toEqual(['SALE_DATE']);
      expect(sales.stats.subpartition_key).toEqual([]);
    }

    const idx = bundle.objects['ADHOC.SALES_CUST_IX'];
    expect(idx?.type).toBe('INDEX');
    if (idx?.type === 'INDEX') {
      expect(idx.ddl).toContain('LOCAL');
      expect(idx.stats.locality).toBe('LOCAL');
      expect(idx.stats.partition_type).toBe('RANGE');
      expect(idx.stats.partition_key).toEqual(['SALE_DATE']);
    }
  });

  it('still parses an existing v1 bundle that omits all the new optional fields (regression guard)', () => {
    const json = JSON.stringify({
      format: 'ora-plan-metadata',
      version: 1,
      captured_at: '2026-05-15T10:23:00Z',
      source: { db_name: 'PROD1', oracle_version: '19.0.0.0.0', container_name: 'PDB1' },
      plan_ref: { sql_id: 'abc123def456', plan_hash_value: 1234567890 },
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
          indexes: ['SH.SALES_IDX'],
        },
        'SH.SALES_IDX': {
          type: 'INDEX',
          stats: {
            uniqueness: 'NONUNIQUE',
            index_type: 'NORMAL',
            status: 'VALID',
            visibility: 'VISIBLE',
            partitioned: false,
            clustering_factor: 100,
            blevel: 1,
            leaf_blocks: 50,
            distinct_keys: 10,
          },
          columns: ['ID'],
          table: 'SH.SALES',
        },
      },
      coverage_warnings: [],
    });

    const bundle = parseBundle(json);

    const sales = bundle.objects['SH.SALES'];
    expect(sales?.type).toBe('TABLE');
    if (sales?.type === 'TABLE') {
      expect(sales.stats.partition_type).toBeUndefined();
      expect(sales.ddl).toBeUndefined();
    }

    const idx = bundle.objects['SH.SALES_IDX'];
    expect(idx?.type).toBe('INDEX');
    if (idx?.type === 'INDEX') {
      expect(idx.stats.locality).toBeUndefined();
      expect(idx.ddl).toBeUndefined();
    }
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
