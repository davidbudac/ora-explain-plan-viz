import { describe, it, expect } from 'vitest';
import { pxSkewRule } from '../rules/pxSkew';
import { buildPlan, ruleCtx } from './helpers';
import type { ParallelServer } from '../../types';

const evaluate = (servers: ParallelServer[] | undefined, dop?: number) =>
  pxSkewRule.evaluate(ruleCtx(buildPlan(
    { id: 0, operation: 'SELECT STATEMENT' },
    { monitorMetadata: { parallelServers: servers, dop } },
  )));

const px = (name: string, set: number, elapsedMs: number, bufferGets?: number): ParallelServer =>
  ({ name, set, group: 1, elapsedMs, ...(bufferGets !== undefined ? { bufferGets } : {}) });
const qc: ParallelServer = { name: 'PX Coordinator', isCoordinator: true, elapsedMs: 60_000, bufferGets: 99_999_999 };

describe('pxSkewRule', () => {
  it('ignores a set whose busiest server is under 2x the average', () => {
    // avg 3.75 s, max 6 s -> 1.6x
    expect(evaluate([qc, px('p000', 1, 6_000), px('p001', 1, 3_000), px('p002', 1, 3_000), px('p003', 1, 3_000)], 4)).toEqual([]);
  });

  it('warns at 2x and is critical at 4x', () => {
    const warn = evaluate([px('p000', 1, 10_000), px('p001', 1, 2_000), px('p002', 1, 2_000), px('p003', 1, 2_000)], 4);
    expect(warn).toHaveLength(1);
    expect(warn[0]).toMatchObject({ ruleId: 'px-skew', severity: 'warning', nodeIds: [] });
    expect(warn[0].title).toContain('set 1');
    expect(warn[0].explanation).toContain('10.0 s');
    expect(warn[0].explanation).toContain('p000');
    expect(warn[0].explanation).toContain('DOP 4');
    expect(warn[0].suggestion).toContain('PQ_DISTRIBUTE');

    const critical = evaluate([px('p000', 1, 20_000), ...[1, 2, 3, 4, 5, 6, 7].map((i) => px(`p00${i}`, 1, 1_000))], 8);
    expect(critical[0].severity).toBe('critical');
  });

  it('stays quiet for a balanced set', () => {
    expect(evaluate([px('p000', 1, 5_000), px('p001', 1, 5_500), px('p002', 1, 4_800), px('p003', 1, 5_200)])).toEqual([]);
  });

  it('ignores tiny queries even when lopsided', () => {
    expect(evaluate([px('p000', 1, 600), px('p001', 1, 10), px('p002', 1, 10), px('p003', 1, 10)])).toEqual([]);
  });

  it('excludes the coordinator from every set', () => {
    // A huge coordinator must not make a balanced set look skewed (or count as a set member).
    expect(evaluate([qc, px('p000', 1, 5_000), px('p001', 1, 5_000)])).toEqual([]);
  });

  it('evaluates each server set on its own', () => {
    const findings = evaluate([
      px('p000', 1, 5_000), px('p001', 1, 5_000),
      px('p002', 2, 9_000), px('p003', 2, 500), px('p004', 2, 500), px('p005', 2, 500),
    ]);
    expect(findings).toHaveLength(1);
    expect(findings[0].title).toContain('set 2');
  });

  it('flags buffer-get skew when elapsed time is balanced but the gets are material', () => {
    const findings = evaluate([
      px('p000', 1, 100, 900_000), px('p001', 1, 100, 50_000), px('p002', 1, 100, 50_000), px('p003', 1, 100, 50_000),
    ]);
    expect(findings).toHaveLength(1);
    expect(findings[0].explanation).toContain('buffer gets');
    expect(findings[0].explanation).not.toContain('elapsed time');
  });

  it('counts a server that reported no elapsed time as idle', () => {
    const findings = evaluate([
      px('p000', 1, 8_000), { name: 'p001', set: 1, group: 1 }, { name: 'p002', set: 1, group: 1 }, { name: 'p003', set: 1, group: 1 },
    ]);
    expect(findings).toHaveLength(1);
    expect(findings[0].severity).toBe('critical');
  });

  it('does nothing without per-server stats (SQL Monitor text, DBMS_XPLAN)', () => {
    expect(evaluate(undefined)).toEqual([]);
    expect(evaluate([])).toEqual([]);
    expect(evaluate([qc])).toEqual([]);
    expect(evaluate([px('p000', 1, 50_000)])).toEqual([]);
  });
});
