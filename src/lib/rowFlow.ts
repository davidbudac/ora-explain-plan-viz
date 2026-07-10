import type { ParsedPlan, PlanNode } from './types';

export interface RowFlowEntry {
  node: PlanNode;
  output: number;
  outputIsEstimate: boolean;
  input: number;
  factor: number | undefined;
  kind: 'reduction' | 'amplification' | 'passthrough' | 'source';
}

export interface RowFlowResult {
  entries: RowFlowEntry[];
  leafRowsRead: number;
  rootRowsReturned: number;
  hasActuals: boolean;
}

function nodeOutput(node: PlanNode): { output: number; outputIsEstimate: boolean } {
  const output = node.actualRows ?? node.rows ?? 0;
  return { output, outputIsEstimate: node.actualRows === undefined };
}

export function computeRowFlow(plan: ParsedPlan): RowFlowResult {
  const entries: RowFlowEntry[] = [];
  let leafRowsRead = 0;

  for (const node of plan.allNodes) {
    const { output, outputIsEstimate } = nodeOutput(node);

    if (node.children.length === 0) {
      entries.push({ node, output, outputIsEstimate, input: 0, factor: undefined, kind: 'source' });
      leafRowsRead += output;
      continue;
    }

    const input = node.children.reduce((sum, child) => sum + nodeOutput(child).output, 0);
    const factor = input === 0 ? undefined : output / input;
    let kind: RowFlowEntry['kind'] = 'passthrough';
    if (factor !== undefined) {
      if (factor < 1 / 1.5) kind = 'reduction';
      else if (factor > 1.5) kind = 'amplification';
    }
    entries.push({ node, output, outputIsEstimate, input, factor, kind });
  }

  const rootRowsReturned = plan.rootNode ? nodeOutput(plan.rootNode).output : 0;

  return {
    entries,
    leafRowsRead,
    rootRowsReturned,
    hasActuals: plan.hasActualStats,
  };
}
