import type { ParsedPlan, PlanNode, PlanSource } from '../../types';

/** A plan node by id; `op` defaults to `OP <id>`, `kids` to none. Depth and parentId are derived. */
export interface PlanSpec extends Partial<Omit<PlanNode, 'children' | 'id' | 'operation' | 'depth' | 'parentId'>> {
  id: number;
  op?: string;
  kids?: PlanSpec[];
}

/** Builds a ParsedPlan from a nested spec; `allNodes` is in pre-order (plan Id order). */
export function buildPlan(spec: PlanSpec, source: PlanSource = 'sql_monitor_text'): ParsedPlan {
  const allNodes: PlanNode[] = [];
  const build = (s: PlanSpec, depth: number, parentId?: number): PlanNode => {
    const { op, kids, ...rest } = s;
    const node: PlanNode = { ...rest, operation: op ?? `OP ${s.id}`, depth, parentId, children: [] };
    allNodes.push(node);
    node.children = (kids ?? []).map((c) => build(c, depth + 1, s.id));
    return node;
  };
  const rootNode = build(spec, 0);
  return {
    rootNode,
    allNodes,
    totalCost: 0,
    maxRows: 0,
    source,
    hasActualStats: allNodes.some((n) => n.actualTime !== undefined || n.actualRows !== undefined),
  };
}

export const nodeById = (plan: ParsedPlan, id: number): PlanNode => plan.allNodes.find((n) => n.id === id)!;
