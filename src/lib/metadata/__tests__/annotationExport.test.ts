import { describe, it, expect } from 'vitest';
import { validateExport } from '../../annotations';
import { parseBundle } from '../bundle';

const baseV1 = {
  version: 1,
  exportedAt: '2026-05-16T00:00:00Z',
  rawPlanText: 'Plan hash value: 1\nselect 1 from dual',
  planSource: 'dbms_xplan',
  annotations: {
    nodeAnnotations: {},
    nodeHighlights: {},
    groups: [],
  },
} as const;

const sampleBundle = {
  format: 'ora-plan-metadata',
  version: 1,
  captured_at: '2026-05-16T00:00:00Z',
  source: { db_name: 'X', oracle_version: '19', container_name: 'CDB$ROOT' },
  plan_ref: { sql_id: 'abc123', plan_hash_value: 42 },
  objects: {},
  coverage_warnings: [],
};

describe('annotation export v1/v2 backward compatibility', () => {
  it('accepts a v1 export with no metadataBundle field', () => {
    expect(validateExport(baseV1)).toBe(true);
  });

  it('accepts a v2 export with embedded metadataBundle', () => {
    const v2 = { ...baseV1, version: 2 as const, metadataBundle: sampleBundle };
    expect(validateExport(v2)).toBe(true);
  });

  it('accepts a v2 export with no metadataBundle (allowed when no bundle was attached)', () => {
    const v2 = { ...baseV1, version: 2 as const };
    expect(validateExport(v2)).toBe(true);
  });

  it('rejects unknown version numbers', () => {
    expect(validateExport({ ...baseV1, version: 3 })).toBe(false);
    expect(validateExport({ ...baseV1, version: 0 })).toBe(false);
  });

  it('embedded metadataBundle round-trips through parseBundle', () => {
    const v2 = { ...baseV1, version: 2 as const, metadataBundle: sampleBundle };
    expect(validateExport(v2)).toBe(true);
    const reparsed = parseBundle(JSON.stringify(v2.metadataBundle));
    expect(reparsed.format).toBe('ora-plan-metadata');
    expect(reparsed.plan_ref.sql_id).toBe('abc123');
  });
});
