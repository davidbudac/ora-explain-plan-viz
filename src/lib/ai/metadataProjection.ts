import type { ParsedPlan } from '../types';
import type { ColumnStats, IndexObject, MetadataBundle, TableObject } from '../metadata/bundle';
import { findObjectInBundle } from '../metadata/lookup';
import { extractPredicateColumns } from '../metadata/predicateColumns';

/** Character budget for the projected metadata section (~5k tokens). */
export const METADATA_CHAR_CAP = 20_000;

const TRUNCATION_NOTICE =
  '\n[metadata truncated to fit the context budget — remaining objects omitted]';

/**
 * Project a schema-metadata bundle down to what the model needs for this
 * plan: only objects the plan references (plus the indexes of referenced
 * tables), with DDL dropped and column stats limited to columns that appear
 * in the plan's predicates. Output is JSON, capped at METADATA_CHAR_CAP.
 */
export function projectMetadata(bundle: MetadataBundle, plan: ParsedPlan): string {
  const predicateCols = new Set(
    extractPredicateColumns(
      ...plan.allNodes.flatMap((n) => [n.accessPredicates, n.filterPredicates]),
    ),
  );

  // Objects directly referenced by plan lines.
  const keys = new Set<string>();
  for (const node of plan.allNodes) {
    const found = findObjectInBundle(bundle, node.objectName);
    if (found) keys.add(found.key);
  }
  // Indexes of referenced tables (the optimizer's alternatives matter too).
  for (const key of [...keys]) {
    const object = bundle.objects[key];
    if (object.type !== 'TABLE') continue;
    for (const indexName of object.indexes) {
      const found = findObjectInBundle(bundle, indexName);
      if (found) keys.add(found.key);
    }
  }
  if (keys.size === 0) return '';

  const objects: Record<string, unknown> = {};
  for (const key of [...keys].sort()) {
    objects[key] = projectObject(bundle.objects[key], predicateCols);
  }

  const projected: Record<string, unknown> = {
    source: bundle.source,
    objects,
  };
  if (bundle.system_params) projected.system_params = bundle.system_params;
  if (bundle.optimizer_env?.length) projected.optimizer_env = bundle.optimizer_env;
  if (bundle.sql_management) projected.sql_management = bundle.sql_management;

  const json = JSON.stringify(projected, null, 1);
  if (json.length <= METADATA_CHAR_CAP) return json;
  return json.slice(0, METADATA_CHAR_CAP) + TRUNCATION_NOTICE;
}

function projectObject(
  object: TableObject | IndexObject,
  predicateCols: Set<string>,
): unknown {
  if (object.type === 'INDEX') {
    const rest = { ...object };
    delete rest.ddl;
    delete rest.segment;
    return rest;
  }
  const rest = { ...object };
  delete rest.ddl;
  delete rest.segment;
  delete rest.physical;
  const projectedColumns: Record<string, ColumnStats> = {};
  for (const [name, stats] of Object.entries(object.columns)) {
    if (predicateCols.has(name.toUpperCase())) projectedColumns[name] = stats;
  }
  return { ...rest, columns: projectedColumns };
}
