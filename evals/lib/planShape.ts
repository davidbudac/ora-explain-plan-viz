/**
 * Plan-shape normalization for the repro-fidelity backtest.
 *
 * Plan hash values differ across environments, so scenarios are compared on
 * a normalized shape instead: one `OPERATION|OBJECT` string per plan line,
 * with schema qualifiers and the harness's EVAL_ prefix stripped from object
 * names. Pure — no DB, no side effects.
 */

import type { ParsedPlan } from '../../src/lib/types';

/** Normalized shape: one `OPERATION|OBJECT` (or bare `OPERATION`) per line. */
export function planShape(plan: ParsedPlan): string[] {
  return plan.allNodes.map((node) => {
    const op = node.operation.trim().replace(/\s+/g, ' ').toUpperCase();
    let name = (node.objectName ?? '').trim().toUpperCase();
    // Strip a schema qualifier (SCOTT.EMP -> EMP), then the eval prefix.
    const dot = name.lastIndexOf('.');
    if (dot !== -1) name = name.slice(dot + 1);
    name = name.replace(/^EVAL_/, '');
    return name ? `${op}|${name}` : op;
  });
}

/** True when both shapes have the same lines in the same order. */
export function shapesMatch(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((line, i) => line === b[i]);
}
