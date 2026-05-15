import { describe, it, expect } from 'vitest';
import { parseBundle } from '../bundle';

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
});
