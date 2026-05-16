import type { MetadataBundle, IndexObject, MetadataObject } from './bundle';
import type { PlanNode } from '../types';
import { findObjectInBundle } from './lookup';

export interface ResolvedIndex {
  key: string;
  object: IndexObject;
}

export interface ResolvedIndexesForBlock {
  tableKey: string | null;
  indexes: ResolvedIndex[];
}

export function resolveIndexesForBlock(
  match: { key: string; object: MetadataObject },
  bundle: MetadataBundle,
): ResolvedIndexesForBlock {
  if (match.object.type === 'TABLE') {
    const table = match.object;
    const indexes: ResolvedIndex[] = [];
    for (const indexKey of table.indexes) {
      const obj = bundle.objects[indexKey];
      if (obj && obj.type === 'INDEX') {
        indexes.push({ key: indexKey, object: obj });
      }
    }
    return { tableKey: match.key, indexes };
  }

  const tableKey = match.object.table;
  const tableObj = bundle.objects[tableKey];
  if (!tableObj || tableObj.type !== 'TABLE') {
    return { tableKey: null, indexes: [] };
  }
  const indexes: ResolvedIndex[] = [];
  for (const indexKey of tableObj.indexes) {
    if (indexKey === match.key) continue;
    const obj = bundle.objects[indexKey];
    if (obj && obj.type === 'INDEX') {
      indexes.push({ key: indexKey, object: obj });
    }
  }
  return { tableKey, indexes };
}

export function findUsedIndexKeys(
  bundle: MetadataBundle,
  nodes: PlanNode[],
): Set<string> {
  const used = new Set<string>();
  for (const node of nodes) {
    if (!node.objectName) continue;
    const hit = findObjectInBundle(bundle, node.objectName);
    if (hit && hit.object.type === 'INDEX') {
      used.add(hit.key);
    }
  }
  return used;
}
