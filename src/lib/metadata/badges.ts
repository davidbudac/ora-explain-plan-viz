import type { MetadataObject } from './bundle';

export type MetadataBadgeKind = 'stale-stats' | 'missing-stats';

export interface MetadataBadge {
  kind: MetadataBadgeKind;
  reason: string;
}

export interface EvaluateBadgesInput {
  match: { key: string; object: MetadataObject } | null;
  enabled?: Partial<Record<MetadataBadgeKind, boolean>>;
}

export function evaluateBadges(input: EvaluateBadgesInput): MetadataBadge[] {
  const badges: MetadataBadge[] = [];
  if (!input.match) return badges;
  const { key, object } = input.match;
  if (object.type !== 'TABLE') return badges;
  const isEnabled = (kind: MetadataBadgeKind): boolean =>
    input.enabled?.[kind] !== false;
  if (isEnabled('stale-stats') && object.stats.stale_stats === 'YES') {
    badges.push({
      kind: 'stale-stats',
      reason: `Stale stats — DBA_TAB_STATISTICS.STALE_STATS = 'YES' on ${key}.`,
    });
  }
  if (isEnabled('missing-stats') && (object.stats.last_analyzed === null || object.stats.num_rows === null)) {
    const detail =
      object.stats.last_analyzed === null && object.stats.num_rows === null
        ? 'last_analyzed and num_rows are null'
        : object.stats.last_analyzed === null
          ? 'last_analyzed is null'
          : 'num_rows is null';
    badges.push({
      kind: 'missing-stats',
      reason: `Missing stats — ${detail} on ${key}.`,
    });
  }
  return badges;
}
