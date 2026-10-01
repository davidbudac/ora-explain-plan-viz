/**
 * Accessible name for a plan node on the tree canvas — one sentence a screen
 * reader announces when the node receives focus, e.g.
 * "#4 TABLE ACCESS FULL ORDERS, estimated 32 rows, actual 20K rows, cost 973, hotspot".
 */

import { effectiveExecutions } from './format';

/** Hover text for the "inactive" tag/legend on adaptive-plan operations the optimizer skipped. */
export const INACTIVE_NODE_TOOLTIP = 'Adaptive plan: the optimizer did not use this operation';

export interface NodeAriaLabelInput {
  id: number;
  operation: string;
  objectName?: string;
  rows?: number;
  /** Estimate over all executions (`estimatedRowsTotal`). */
  estimatedRowsTotal?: number;
  actualRows?: number;
  cost?: number;
  actualTime?: number;
  /** Adaptive-plan operation the optimizer did not use. */
  inactive?: boolean;
}

export interface NodeAriaLabelOptions {
  hasActualStats?: boolean;
  isHotspot?: boolean;
  /** Advisor finding count on the node. */
  findingCount?: number;
  /** Number of descendants hidden under this node (collapsed subtree). */
  hiddenCount?: number;
}

const compactNumber = new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 });

function formatCount(value: number): string {
  return compactNumber.format(value);
}

function formatDuration(ms: number): string {
  if (ms >= 1000) return `${(ms / 1000).toFixed(ms >= 10000 ? 0 : 1)} seconds`;
  return `${Math.round(ms)} milliseconds`;
}

export function planNodeAriaLabel(node: NodeAriaLabelInput, options: NodeAriaLabelOptions = {}): string {
  const head = `#${node.id} ${node.operation}${node.objectName ? ` ${node.objectName}` : ''}`;
  const parts: string[] = [head];
  if (node.rows !== undefined) {
    const executions = options.hasActualStats ? effectiveExecutions(node) : undefined;
    parts.push(
      executions !== undefined
        ? `estimated ${formatCount(node.rows)} rows per execution × ${executions.toLocaleString('en-US')} executions`
        : `estimated ${formatCount(node.rows)} rows`,
    );
  }
  if (options.hasActualStats && node.actualRows !== undefined) {
    parts.push(`actual ${formatCount(node.actualRows)} rows`);
  }
  if (options.hasActualStats && node.actualTime !== undefined) {
    parts.push(`time ${formatDuration(node.actualTime)}`);
  }
  if (node.cost !== undefined) parts.push(`cost ${formatCount(node.cost)}`);
  if (node.inactive) parts.push('inactive (adaptive plan)');
  if (options.isHotspot) parts.push('hotspot');
  if (options.findingCount && options.findingCount > 0) {
    parts.push(`${options.findingCount} advisor finding${options.findingCount === 1 ? '' : 's'}`);
  }
  if (options.hiddenCount && options.hiddenCount > 0) {
    parts.push(`collapsed, ${options.hiddenCount} hidden operation${options.hiddenCount === 1 ? '' : 's'}`);
  }
  return parts.join(', ');
}
