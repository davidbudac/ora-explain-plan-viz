import { describe, it, expect } from 'vitest';
import { evaluateBadges } from '../badges';
import type { TableObject } from '../bundle';

const baseTable = (overrides: Partial<TableObject['stats']> = {}): TableObject => ({
  type: 'TABLE',
  stats: {
    num_rows: 1000,
    blocks: 10,
    avg_row_len: 50,
    last_analyzed: '2026-05-01T00:00:00Z',
    stale_stats: 'NO',
    partitioned: false,
    ...overrides,
  },
  columns: {},
  indexes: [],
});

describe('evaluateBadges', () => {
  it('returns no badges when there is no matched bundle entry', () => {
    expect(evaluateBadges({ match: null })).toEqual([]);
  });

  it('fires stale-stats when matched table has stale_stats=YES', () => {
    const match = { key: 'SH.SALES', object: baseTable({ stale_stats: 'YES' }) };
    const badges = evaluateBadges({ match });
    expect(badges).toHaveLength(1);
    expect(badges[0].kind).toBe('stale-stats');
    expect(badges[0].reason).toContain('SH.SALES');
  });

  it('does not fire stale-stats when stale_stats is NO', () => {
    const match = { key: 'SH.SALES', object: baseTable({ stale_stats: 'NO' }) };
    expect(evaluateBadges({ match }).some((b) => b.kind === 'stale-stats')).toBe(false);
  });

  it('fires missing-stats when last_analyzed is null', () => {
    const match = { key: 'SH.SALES', object: baseTable({ last_analyzed: null }) };
    const badges = evaluateBadges({ match });
    const missing = badges.find((b) => b.kind === 'missing-stats');
    expect(missing).toBeDefined();
    expect(missing!.reason).toContain('SH.SALES');
  });

  it('fires missing-stats when num_rows is null', () => {
    const match = { key: 'SH.SALES', object: baseTable({ num_rows: null }) };
    expect(evaluateBadges({ match }).some((b) => b.kind === 'missing-stats')).toBe(true);
  });

  it('fires both badges when stats are stale AND missing', () => {
    const match = {
      key: 'SH.SALES',
      object: baseTable({ stale_stats: 'YES', last_analyzed: null }),
    };
    const kinds = evaluateBadges({ match }).map((b) => b.kind);
    expect(kinds).toContain('stale-stats');
    expect(kinds).toContain('missing-stats');
  });

  it('omits badges disabled via the enabled set', () => {
    const match = {
      key: 'SH.SALES',
      object: baseTable({ stale_stats: 'YES', last_analyzed: null }),
    };
    const kinds = evaluateBadges({
      match,
      enabled: { 'stale-stats': true, 'missing-stats': false },
    }).map((b) => b.kind);
    expect(kinds).toEqual(['stale-stats']);
  });

  it('returns no badges for an INDEX match (table-only signals in this slice)', () => {
    const indexMatch = {
      key: 'SH.SALES_IDX',
      object: {
        type: 'INDEX' as const,
        stats: {
          uniqueness: 'NONUNIQUE' as const,
          index_type: 'NORMAL',
          status: 'VALID',
          visibility: 'VISIBLE' as const,
          partitioned: false,
          clustering_factor: 10,
          blevel: 1,
          leaf_blocks: 5,
          distinct_keys: 8,
        },
        columns: ['ID'],
        table: 'SH.SALES',
      },
    };
    expect(evaluateBadges({ match: indexMatch })).toEqual([]);
  });
});
