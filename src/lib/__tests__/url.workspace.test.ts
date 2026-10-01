// @vitest-environment node
import { describe, it, expect } from 'vitest';
import {
  buildShareLink,
  buildShareWorkspace,
  classifyDecodedPlanText,
  decodeGzipPlanParam,
  diffShareFilters,
  encodeGzipPlanParam,
  parseDeepLinkParams,
  readShareWorkspace,
  readSharedSelection,
  SHARE_FILTER_DEFAULTS,
  SHARE_WORKSPACE_VERSION,
  type SharePayload,
  type ShareResult,
} from '../url';
import type { FilterState } from '../types';
import { defaultBehaviourOptions, defaultNodeDisplayOptions } from '../settings';

const baseFilters: FilterState = {
  ...SHARE_FILTER_DEFAULTS,
  showPredicates: true,
  ...defaultBehaviourOptions,
  nodeDisplayOptions: defaultNodeDisplayOptions,
};

describe('parseDeepLinkParams', () => {
  it('reads example, view, node and q together', () => {
    expect(parseDeepLinkParams('?example=22&view=tabular&node=4&q=HASH%20JOIN')).toEqual({
      example: '22', view: 'tabular', node: 4, q: 'HASH JOIN',
    });
  });

  it('returns nulls for absent params', () => {
    expect(parseDeepLinkParams('')).toEqual({ example: null, view: null, node: null, q: null });
  });

  it('accepts node=0 but rejects negative, fractional and non-numeric ids', () => {
    expect(parseDeepLinkParams('?node=0').node).toBe(0);
    expect(parseDeepLinkParams('?node=-1').node).toBeNull();
    expect(parseDeepLinkParams('?node=1.5').node).toBeNull();
    expect(parseDeepLinkParams('?node=abc').node).toBeNull();
    expect(parseDeepLinkParams('?node=').node).toBeNull();
  });

  it('treats a blank q as absent', () => {
    expect(parseDeepLinkParams('?q=%20%20').q).toBeNull();
  });
});

describe('diffShareFilters', () => {
  it('is undefined when every analysis filter is at its default', () => {
    expect(diffShareFilters(baseFilters)).toBeUndefined();
  });

  it('carries only the fields that differ, and ignores display options', () => {
    const filters: FilterState = {
      ...baseFilters,
      searchText: 'ORDERS',
      minCost: 10,
      predicateTypes: ['access'],
      animateEdges: !baseFilters.animateEdges,
      showPredicates: false,
    };
    expect(diffShareFilters(filters)).toEqual({ searchText: 'ORDERS', minCost: 10, predicateTypes: ['access'] });
  });
});

describe('buildShareWorkspace / readShareWorkspace', () => {
  const input = {
    keptIndices: [0, 1],
    activePlanIndex: 1,
    comparePlanIndices: [1, 0] as [number, number],
    compareMetrics: ['cost', 'actualTime'] as const,
    treeCompareEnabled: true,
    filters: { ...baseFilters, searchText: 'x' },
  };

  it('captures active plan, compare pair + metrics, tree flag and filters', () => {
    const ws = buildShareWorkspace({ ...input, compareMetrics: [...input.compareMetrics] });
    expect(ws).toEqual({
      v: SHARE_WORKSPACE_VERSION,
      activePlan: 1,
      compare: { pair: [1, 0], metrics: ['cost', 'actualTime'], tree: true },
      filters: { searchText: 'x' },
    });
  });

  it('remaps indices when an unparsed slot is left out of the link', () => {
    const ws = buildShareWorkspace({
      ...input,
      compareMetrics: ['cost'],
      keptIndices: [0, 2],
      activePlanIndex: 2,
      comparePlanIndices: [0, 2],
      treeCompareEnabled: false,
    });
    expect(ws.activePlan).toBe(1);
    expect(ws.compare).toEqual({ pair: [0, 1], metrics: ['cost'] });
  });

  it('omits compare for a single plan and activePlan when it is the first', () => {
    const ws = buildShareWorkspace({ ...input, compareMetrics: ['cost'], keptIndices: [0], activePlanIndex: 0 });
    expect(ws.compare).toBeUndefined();
    expect(ws.activePlan).toBeUndefined();
  });

  it('round-trips through JSON and drops invalid fields on read', () => {
    const payload = JSON.parse(JSON.stringify({
      plans: [{ rawInput: 'a' }, { rawInput: 'b' }],
      workspace: {
        v: 1,
        activePlan: 9,
        compare: { pair: [0, 1], metrics: ['cost', 'bogus'], tree: 'yes' },
        filters: { minCost: -1, maxCost: 50, searchText: 7, predicateTypes: ['access', 'x'], extra: 1 },
        future: true,
      },
    })) as SharePayload;
    expect(readShareWorkspace(payload, 2)).toEqual({
      v: 1,
      compare: { pair: [0, 1], metrics: ['cost'] },
      filters: { maxCost: 50, predicateTypes: ['access'] },
    });
  });

  it('returns null for an old link without a workspace block', () => {
    expect(readShareWorkspace({ plans: [{ rawInput: 'a' }], viewMode: 'compare' }, 1)).toBeNull();
  });

  it('rejects a compare pair that points outside the plans or at one plan twice', () => {
    expect(readShareWorkspace({ plans: [], workspace: { v: 1, compare: { pair: [0, 5] } } }, 2)?.compare).toBeUndefined();
    expect(readShareWorkspace({ plans: [], workspace: { v: 1, compare: { pair: [1, 1] } } }, 2)?.compare).toBeUndefined();
  });
});

describe('readSharedSelection', () => {
  it('keeps non-negative integers only', () => {
    expect(readSharedSelection({ rawInput: '', selectedNodeIds: [3, -1, 2.5, 'x', 0] as unknown as number[] })).toEqual([3, 0]);
    expect(readSharedSelection({ rawInput: '' })).toEqual([]);
  });
});

describe('compare view survives both link kinds', () => {
  const planA = 'Plan hash value: 1\n';
  const planB = 'Plan hash value: 2\n';
  const workspace = buildShareWorkspace({
    keptIndices: [0, 1],
    activePlanIndex: 1,
    comparePlanIndices: [0, 1],
    compareMetrics: ['cost'],
    treeCompareEnabled: false,
    filters: baseFilters,
  });

  it('puts view, selection and workspace into the payload built for the link', async () => {
    const payloads: SharePayload[] = [];
    const build = async (payload: SharePayload): Promise<ShareResult> => {
      payloads.push(payload);
      return { ok: true, url: 'https://x/#gz=abc' };
    };
    await buildShareLink(
      [{ rawInput: planA }, { rawInput: planB, selectedNodeIds: [2] }],
      { viewMode: 'compare', workspace, build },
    );
    expect(payloads[0].viewMode).toBe('compare');
    expect(payloads[0].workspace).toEqual(workspace);
    expect(payloads[0].plans[1].selectedNodeIds).toEqual([2]);
    expect(payloads[0].plans[0].selectedNodeIds).toBeUndefined();
  });

  it('round-trips through the gzip #gz= encoding', async () => {
    const payload: SharePayload = {
      plans: [{ rawInput: planA }, { rawInput: planB, selectedNodeIds: [2] }],
      viewMode: 'compare',
      workspace,
    };
    const decoded = classifyDecodedPlanText(await decodeGzipPlanParam(await encodeGzipPlanParam(JSON.stringify(payload))));
    expect(decoded.type).toBe('payload');
    if (decoded.type === 'payload') {
      expect(decoded.payload).toEqual(payload);
      expect(readShareWorkspace(decoded.payload, 2)).toMatchObject({ activePlan: 1, compare: { pair: [0, 1] } });
    }
  });

  it('round-trips through the legacy lz-string encoding', async () => {
    const { compressToEncodedURIComponent, decompressFromEncodedURIComponent } = await import('lz-string');
    const payload: SharePayload = { plans: [{ rawInput: planA }, { rawInput: planB }], viewMode: 'compare', workspace };
    const decoded = classifyDecodedPlanText(decompressFromEncodedURIComponent(compressToEncodedURIComponent(JSON.stringify(payload))));
    expect(decoded.type === 'payload' && decoded.payload.workspace).toEqual(workspace);
  });

  it('still decodes an old-format (pre-workspace) link fixture', async () => {
    // Exactly what share links carried before the workspace block existed.
    const oldLink = '{"plans":[{"rawInput":"Plan hash value: 1\\n","annotations":{"version":1,"nodes":{}}},{"rawInput":"Plan hash value: 2\\n"}],"viewMode":"compare"}';
    const decoded = classifyDecodedPlanText(await decodeGzipPlanParam(await encodeGzipPlanParam(oldLink)));
    expect(decoded.type).toBe('payload');
    if (decoded.type === 'payload') {
      expect(decoded.payload.viewMode).toBe('compare');
      expect(readShareWorkspace(decoded.payload, 2)).toBeNull();
      expect(readSharedSelection(decoded.payload.plans[0])).toEqual([]);
    }
  });
});
