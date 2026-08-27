import type { FindingSeverity } from '../advisor/types';
import type { AiFinding } from './types';

export interface SplitReport {
  /** Markdown narrative with the trailing findings JSON block removed. */
  narrative: string;
  /** Content of the last complete ```json fence, or null. */
  jsonBlock: string | null;
  /** True while a ```json fence has opened but not yet closed (streaming). */
  partialFence: boolean;
}

const FENCE_OPEN = /(?:^|\n)```json[^\S\n]*\n/g;

/**
 * Split a (possibly partially streamed) report into narrative and the
 * trailing findings JSON block. While the final fence is still streaming in,
 * the half-received block is hidden from the narrative instead of being
 * rendered as broken markdown.
 */
export function splitReport(markdown: string): SplitReport {
  FENCE_OPEN.lastIndex = 0;
  let lastOpen: RegExpExecArray | null = null;
  for (let m = FENCE_OPEN.exec(markdown); m; m = FENCE_OPEN.exec(markdown)) {
    lastOpen = m;
  }
  if (!lastOpen) {
    // An opening fence may itself be arriving character by character ("``",
    // "```js"...) at the very end of the buffer; hide that tail too. Fences
    // start at a line beginning, which keeps inline code spans untouched.
    const tail = markdown.match(/(?:^|\n)`{1,3}(?:json)?[^\S\n]*$/);
    if (tail && tail.index !== undefined) {
      const cut = tail.index + (tail[0].startsWith('\n') ? 1 : 0);
      return { narrative: markdown.slice(0, cut), jsonBlock: null, partialFence: true };
    }
    return { narrative: markdown, jsonBlock: null, partialFence: false };
  }

  const bodyStart = lastOpen.index + lastOpen[0].length;
  const closeMatch = markdown.slice(bodyStart).match(/\n?```/);
  const narrative = markdown.slice(0, lastOpen.index).trimEnd();
  if (!closeMatch || closeMatch.index === undefined) {
    return { narrative, jsonBlock: null, partialFence: true };
  }
  const jsonBlock = markdown.slice(bodyStart, bodyStart + closeMatch.index);
  return { narrative, jsonBlock, partialFence: false };
}

const SEVERITIES: FindingSeverity[] = ['info', 'warning', 'critical'];

/**
 * Parse the model's findings block into structured findings. Lenient: any
 * failure (missing block, garbled JSON, wrong shape) returns null and the
 * report degrades to narrative-only. Severities are clamped to the advisor's
 * FindingSeverity union; nodeIds the plan doesn't contain are dropped.
 */
export function parseAiFindings(markdown: string, validNodeIds: Set<number>): AiFinding[] | null {
  const { jsonBlock } = splitReport(markdown);
  if (!jsonBlock) return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonBlock);
  } catch {
    return null;
  }
  if (typeof parsed !== 'object' || parsed === null) return null;
  const findings = (parsed as { findings?: unknown }).findings;
  if (!Array.isArray(findings)) return null;

  const result: AiFinding[] = [];
  for (const entry of findings) {
    if (typeof entry !== 'object' || entry === null) continue;
    const f = entry as Record<string, unknown>;
    if (typeof f.title !== 'string' || typeof f.explanation !== 'string') continue;
    const severity = SEVERITIES.includes(f.severity as FindingSeverity)
      ? (f.severity as FindingSeverity)
      : 'info';
    const nodeIds = Array.isArray(f.nodeIds)
      ? f.nodeIds.filter((id): id is number => typeof id === 'number' && validNodeIds.has(id))
      : [];
    result.push({
      severity,
      title: f.title,
      explanation: f.explanation,
      suggestion: typeof f.suggestion === 'string' && f.suggestion ? f.suggestion : undefined,
      nodeIds,
    });
  }
  return result;
}
