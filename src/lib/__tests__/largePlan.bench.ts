/**
 * Large-plan benchmarks (~2,000 operations). Run with:
 *   npx vitest bench --environment jsdom --run src/lib/__tests__/largePlan.bench.ts
 * Not part of `vitest run`; numbers are for humans, nothing asserts on time.
 */
import { bench, describe } from 'vitest';
import type { Edge, Node } from '@xyflow/react';
import { parsePlan } from '../parser';
import { runAdvisor } from '../advisor';
import { matchesFilters } from '../filtering';
import { planNodeAriaLabel } from '../nodeAriaLabel';
import { buildDepthIndex, stepAtSameDepth } from '../treeNavigation';
import { calculateNodeHeight, getLayoutedElements, NODE_WIDTH } from '../treeLayout';
import { defaultNodeDisplayOptions } from '../settings';
import { generateLargePlan, neutralFilters } from './fixtures/largePlan';

const generated = generateLargePlan();
const plan = parsePlan(generated.text);
const noHidden: ReadonlySet<number> = new Set();

const flowNodes: Node[] = plan.allNodes.map((node) => ({ id: String(node.id), position: { x: 0, y: 0 }, data: {} }));
const flowEdges: Edge[] = plan.allNodes
  .filter((node) => node.parentId !== undefined)
  .map((node) => ({ id: `e${node.parentId}-${node.id}`, source: String(node.parentId), target: String(node.id) }));
const dims = new Map(
  plan.allNodes.map((node) => [
    String(node.id),
    { width: NODE_WIDTH, height: calculateNodeHeight(node, defaultNodeDisplayOptions, false, false, true) },
  ]),
);

// Stand-ins for the tree's React Flow nodes (data carries the plan node).
interface FlowData { node: (typeof plan.allNodes)[number]; isSelected: boolean; isInFocusPath: boolean; isFocusDimmed: boolean }
const decorated = plan.allNodes.map((node) => ({
  id: String(node.id),
  ariaLabel: '',
  data: { node, isSelected: false, isInFocusPath: false, isFocusDimmed: false } as FlowData,
}));
const selectedIds = new Set([plan.allNodes[1000].id]);
const middle = plan.allNodes.find((n) => n.depth === 10)!;
const depthIndex = buildDepthIndex(plan.allNodes, noHidden);

describe(`parse + analyse (${plan.allNodes.length} operations)`, () => {
  bench('parsePlan', () => {
    parsePlan(generated.text);
  });
  bench('runAdvisor (cache miss: fresh plan object)', () => {
    runAdvisor({ ...plan }, null);
  });
  bench('runAdvisor (cache hit)', () => {
    runAdvisor(plan, null);
  });
  bench('filter all nodes (search text)', () => {
    const filters = neutralFilters({ searchText: 'HASH JOIN' });
    plan.allNodes.filter((node) => matchesFilters(node, filters, false));
  });
});

describe('tree layout', () => {
  bench('getLayoutedElements TB', () => {
    getLayoutedElements(flowNodes, flowEdges, dims, { direction: 'TB', depthSpacing: 32, breadthSpacing: 80 });
  });
  bench('getLayoutedElements LR', () => {
    getLayoutedElements(flowNodes, flowEdges, dims, { direction: 'LR', depthSpacing: 72, breadthSpacing: 28 });
  });
});

describe('selection change: per-node work', () => {
  bench('before: rebuild every node (aria label + data)', () => {
    decorated.map((n) => ({
      ...n,
      ariaLabel: planNodeAriaLabel(n.data.node, { hasActualStats: false, isHotspot: false }),
      data: { ...n.data, isSelected: selectedIds.has(n.data.node.id), isInFocusPath: false, isFocusDimmed: false },
    }));
  });
  bench('after: flag pass, reuse unchanged nodes', () => {
    decorated.map((n) => {
      const isSelected = selectedIds.has(n.data.node.id);
      if (n.data.isSelected === isSelected && !n.data.isInFocusPath && !n.data.isFocusDimmed) return n;
      return { ...n, data: { ...n.data, isSelected, isInFocusPath: false, isFocusDimmed: false } };
    });
  });
});

describe('keyboard: previous/next operation at the same depth', () => {
  bench('before: filter whole plan + findIndex', () => {
    const sameDepth = plan.allNodes.filter((n) => n.depth === middle.depth && !noHidden.has(n.id));
    const idx = sameDepth.findIndex((n) => n.id === middle.id);
    void sameDepth[idx + 1]?.id;
  });
  bench('after: depth index lookup', () => {
    stepAtSameDepth(depthIndex, middle, 1);
  });
  bench('after: build depth index (once per plan / collapse change)', () => {
    buildDepthIndex(plan.allNodes, noHidden);
  });
});
