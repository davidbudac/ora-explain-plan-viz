import type { PlanNode } from '../../types.ts';
import { effectiveChildren } from '../../analysis.ts';

export const INDEX_SCAN_RE = /^INDEX\b.*\bSCAN\b/;
export const FULL_SCAN_RE = /TABLE ACCESS (STORAGE )?FULL/;
export const TABLE_BY_ROWID_RE = /^TABLE ACCESS BY (?:(?:LOCAL|GLOBAL) )?INDEX ROWID/;

export function isIndexScan(node: PlanNode): boolean {
  return INDEX_SCAN_RE.test(node.operation.toUpperCase());
}

export function isTableByRowid(node: PlanNode): boolean {
  return TABLE_BY_ROWID_RE.test(node.operation.toUpperCase());
}

/**
 * Buffer gets this operation made itself. Buffers are cumulative (they include the children's),
 * so subtract them; the floor at 0 keeps sources whose per-line gets are already exclusive
 * from going negative (it can only under-report there, never over-report).
 */
export function selfBuffers(node: PlanNode): number | undefined {
  if (node.logicalReads === undefined) return undefined;
  const childGets = effectiveChildren(node).reduce((sum, c) => sum + (c.logicalReads ?? 0), 0);
  return Math.max(0, node.logicalReads - childGets);
}

/** Active descendants of `node` (excluding it). Inactive adaptive-plan rows are looked through, not returned. */
export function liveDescendants(node: PlanNode): PlanNode[] {
  const out: PlanNode[] = [];
  const walk = (n: PlanNode) => {
    for (const c of effectiveChildren(n)) {
      out.push(c);
      walk(c);
    }
  };
  walk(node);
  return out;
}
