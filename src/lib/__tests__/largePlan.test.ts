import { describe, expect, it } from 'vitest';
import { parsePlan } from '../parser';
import { runAdvisor } from '../advisor';
import { matchesFilters } from '../filtering';
import { buildDepthIndex, stepAtSameDepth } from '../treeNavigation';
import { calculateNodeHeight, getLayoutedElements, NODE_WIDTH } from '../treeLayout';
import { generateLargePlan, neutralFilters } from './fixtures/largePlan';
import { defaultNodeDisplayOptions } from '../settings';
import type { Edge, Node } from '@xyflow/react';

const generated = generateLargePlan();
const plan = parsePlan(generated.text);

describe('large plan fixture (~2,000 operations)', () => {
  it('generates the requested shape deterministically', () => {
    expect(generated.operationCount).toBe(2000);
    expect(generated.maxDepth).toBeGreaterThanOrEqual(30);
    expect(generated.maxDepth).toBeLessThanOrEqual(45);
    expect(generated.predicateNodeCount).toBeGreaterThanOrEqual(200);
    expect(generateLargePlan().text).toBe(generated.text);
    expect(generateLargePlan({ seed: 1 }).text).not.toBe(generated.text);
  });

  it('parses into a single connected tree', () => {
    expect(plan.allNodes).toHaveLength(generated.operationCount);
    expect(plan.rootNode?.id).toBe(0);
    expect(plan.rootNode?.operation).toBe('SELECT STATEMENT');
    expect(plan.rootNode?.parentId).toBeUndefined();

    const byId = new Map(plan.allNodes.map((node) => [node.id, node]));
    let withPredicates = 0;
    for (const node of plan.allNodes) {
      if (node.accessPredicates || node.filterPredicates) withPredicates++;
      if (node.id === 0) continue;
      const parent = byId.get(node.parentId!);
      expect(parent, `parent of ${node.id}`).toBeDefined();
      expect(parent!.children).toContain(node);
      expect(node.depth).toBe(parent!.depth + 1);
    }
    expect(withPredicates).toBe(generated.predicateNodeCount);
    expect(Math.max(...plan.allNodes.map((n) => n.depth)) - plan.rootNode!.depth).toBe(generated.maxDepth);
  });

  it('runs the advisor to completion, once per plan object', () => {
    const report = runAdvisor(plan, null);
    expect(report.findings.length).toBeGreaterThanOrEqual(0);
    // The context and the tree view both ask; the second call must be free.
    expect(runAdvisor(plan, null)).toBe(report);
  });

  it('filters the whole plan', () => {
    const everything = plan.allNodes.filter((node) => matchesFilters(node, neutralFilters(), false));
    expect(everything).toHaveLength(plan.allNodes.length);

    const joins = plan.allNodes.filter((node) =>
      matchesFilters(node, neutralFilters({ searchText: 'HASH JOIN' }), false),
    );
    expect(joins.length).toBeGreaterThan(0);
    expect(joins.length).toBeLessThan(plan.allNodes.length);
    expect(joins.every((node) => node.operation.includes('HASH JOIN'))).toBe(true);
  });

  it('lays the tree out without overlapping siblings at the same depth', () => {
    const nodes: Node[] = plan.allNodes.map((node) => ({ id: String(node.id), position: { x: 0, y: 0 }, data: {} }));
    const edges: Edge[] = plan.allNodes
      .filter((node) => node.parentId !== undefined)
      .map((node) => ({ id: `e${node.parentId}-${node.id}`, source: String(node.parentId), target: String(node.id) }));
    const dims = new Map(
      plan.allNodes.map((node) => [
        String(node.id),
        { width: NODE_WIDTH, height: calculateNodeHeight(node, defaultNodeDisplayOptions, false, false, true) },
      ]),
    );
    const laid = getLayoutedElements(nodes, edges, dims, { direction: 'TB', depthSpacing: 32, breadthSpacing: 80 });
    expect(laid.nodes).toHaveLength(plan.allNodes.length);

    const byDepth = new Map<number, number[]>();
    for (const node of plan.allNodes) {
      const x = laid.nodes.find((n) => n.id === String(node.id))!.position.x;
      byDepth.set(node.depth, [...(byDepth.get(node.depth) ?? []), x]);
    }
    for (const xs of byDepth.values()) {
      const sorted = [...xs].sort((a, b) => a - b);
      for (let i = 1; i < sorted.length; i++) {
        expect(sorted[i] - sorted[i - 1]).toBeGreaterThanOrEqual(NODE_WIDTH);
      }
    }
  });
});

describe('same-depth keyboard index', () => {
  it('steps through visible nodes at one depth in plan order, skipping hidden ones', () => {
    const hidden = new Set<number>();
    const index = buildDepthIndex(plan.allNodes, hidden);
    const atDepth = plan.allNodes.filter((n) => n.depth === 3);
    expect(atDepth.length).toBeGreaterThan(2);

    expect(stepAtSameDepth(index, atDepth[0], -1)).toBeNull();
    expect(stepAtSameDepth(index, atDepth[0], 1)).toBe(atDepth[1].id);
    expect(stepAtSameDepth(index, atDepth[atDepth.length - 1], 1)).toBeNull();

    hidden.add(atDepth[1].id);
    const withHidden = buildDepthIndex(plan.allNodes, hidden);
    expect(stepAtSameDepth(withHidden, atDepth[0], 1)).toBe(atDepth[2].id);
    // A hidden node has no position, so it cannot be stepped from.
    expect(stepAtSameDepth(withHidden, atDepth[1], 1)).toBeNull();
  });

  it('matches the old filter-and-findIndex behaviour for every node and direction', () => {
    const hidden = new Set(plan.allNodes.filter((n) => n.id % 7 === 3).map((n) => n.id));
    const index = buildDepthIndex(plan.allNodes, hidden);
    for (const node of plan.allNodes.filter((n) => n.id % 11 === 0 && !hidden.has(n.id))) {
      const sameDepth = plan.allNodes.filter((n) => n.depth === node.depth && !hidden.has(n.id));
      const at = sameDepth.findIndex((n) => n.id === node.id);
      expect(stepAtSameDepth(index, node, -1)).toBe(sameDepth[at - 1]?.id ?? null);
      expect(stepAtSameDepth(index, node, 1)).toBe(sameDepth[at + 1]?.id ?? null);
    }
  });
});
