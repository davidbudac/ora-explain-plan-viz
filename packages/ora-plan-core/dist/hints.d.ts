/**
 * Optimizer hints as plan data: parse a hint call, classify it, find the operations it
 * targets, and relate the statement's own hints (Hint Report) to the outline (every decision
 * the optimizer made, written as hints).
 *
 * Two hint spellings reach us. The outline is fully qualified:
 *   `INDEX_RS_ASC(@"SEL$1" "U"@"SEL$1" ("USER$"."NAME"))`, `USE_NL(@"SEL$1" "O"@"SEL$1")`
 * The Hint Report and the SQL text carry what the user wrote: `index(u)`, `use_nl(o u)`.
 * Both are reduced to a name, an optional query block and alias arguments, and the aliases
 * are matched against `PlanNode.objectAlias` (`U@SEL$1`, quotes already stripped).
 */
import type { ParsedPlan, PlanHint } from './types.js';
export type HintFamily = 'access' | 'join' | 'order' | 'transform' | 'parallel' | 'statement' | 'other';
export interface ParsedHint {
    /** Verbatim text. */
    text: string;
    /** Upper-case hint name. */
    name: string;
    /** Arguments after the optional leading `@qb`, quotes stripped, parenthesised groups kept whole. */
    args: string[];
    /** Query block from a leading `@"SEL$1"` argument (upper-case, no quotes). */
    queryBlock?: string;
    /** Alias arguments, upper-case: `U@SEL$1` (outline) or `U` (user spelling). */
    aliases: string[];
    family: HintFamily;
}
export declare function hintFamily(name: string): HintFamily;
export declare const HINT_FAMILY_LABELS: Record<HintFamily, string>;
export declare function isOutlineBoilerplate(name: string): boolean;
/** Parse one hint call. Never throws; a bare word is a hint with no arguments. */
export declare function parseHint(text: string): ParsedHint;
export interface HintTargets {
    /** Operations the hint applies to (empty when nothing in the plan matches). */
    nodeIds: number[];
    /** Join-order position per node for LEADING / ORDERED (1-based). */
    order?: Map<number, number>;
    /** How the targets were found. */
    kind: 'alias' | 'join' | 'query-block' | 'statement' | 'none';
}
/**
 * Find the operations a hint acts on. Access and parallel hints land on the operations that
 * carry the alias (table access and its index scan); join hints on the nearest join above the
 * alias; LEADING on the aliases in order; query-block hints on every operation of that block;
 * statement-level hints on the root.
 */
export declare function resolveHintTargets(plan: ParsedPlan, hint: ParsedHint): HintTargets;
/**
 * Which plan decision a hint settles, regardless of spelling: `index(u)` and
 * `INDEX_RS_ASC(@"SEL$1" "U"@"SEL$1" (…))` are both the access path of U. Transformation
 * hints are keyed by their base name (UNNEST / NO_UNNEST decide the same thing).
 */
export declare function decisionName(hint: ParsedHint): string;
/** Decision key within one plan: the decision plus the operations it lands on. */
export declare function decisionKey(plan: ParsedPlan, hint: ParsedHint): string;
export type HintMarkStatus = PlanHint['status'] | 'outline';
/** One hint drawn on the plan. */
export interface HintMark {
    text: string;
    name: string;
    family: HintFamily;
    /** `report` = the statement's hint as reported by Oracle; `outline` = an optimizer decision. */
    source: 'report' | 'outline';
    status: HintMarkStatus;
    code?: string;
    reason?: string;
    queryBlock?: string;
    /** Operations the mark is drawn on. */
    nodeIds: number[];
    /** Join-order position per node (LEADING). */
    order?: Map<number, number>;
    /** Outline decisions only: the statement's own (used) hint settled this decision. */
    hinted?: boolean;
}
export interface HintCoverage {
    /** Outline entries that are plan decisions (boilerplate excluded). */
    decisions: number;
    /** Decisions that one of the statement's used hints settled. */
    hinted: number;
}
export interface HintAnalysis {
    /** Hint Report entries, each on the operation Oracle reported it on (join hints also mark the join). */
    report: HintMark[];
    /** Outline decisions, placed on the operations they act on. */
    outline: HintMark[];
    coverage: HintCoverage;
    /** Marks per operation id, report entries first. */
    byNode: Map<number, HintMark[]>;
    counts: {
        used: number;
        unused: number;
        error: number;
        other: number;
    };
}
export declare function planHasHints(plan: ParsedPlan | null | undefined): boolean;
export declare function analyzeHints(plan: ParsedPlan): HintAnalysis;
/** Worst status among marks: error > unused > other > used > outline. */
export declare function worstHintStatus(marks: HintMark[]): HintMarkStatus | undefined;
export interface SqlHintToken {
    text: string;
    /** Offsets into the SQL text. */
    start: number;
    end: number;
}
export interface SqlHintComment {
    /** Offsets of the whole comment (`/*+ … *\/` or `--+ …`) in the SQL text. */
    start: number;
    end: number;
    hints: SqlHintToken[];
}
/** Hint comments in a statement, with each hint call tokenised (balanced parentheses). */
export declare function extractSqlHints(sql: string): SqlHintComment[];
/** Spelling-insensitive identity of a hint: case and whitespace folded, quotes dropped. */
export declare function normalizeHintText(text: string): string;
/** The SQL text without its hint comments (for an unhinted re-explain). */
export declare function stripHintComments(sql: string): string;
export interface OutlineDiffEntry {
    /** Decision + target aliases, stable across plans of the same statement. */
    key: string;
    family: HintFamily;
    a?: string;
    b?: string;
}
export interface OutlineDiff {
    changed: OutlineDiffEntry[];
    onlyA: OutlineDiffEntry[];
    onlyB: OutlineDiffEntry[];
    same: OutlineDiffEntry[];
}
/** Cross-plan decision key: decision + the aliases (or query block) it names. */
export declare function outlineDecisionKey(hint: ParsedHint): string;
export declare function diffOutlines(a: string[] | undefined, b: string[] | undefined): OutlineDiff;
/** One tooltip line per mark: status glyph, hint text, what it is / why it was dropped. */
export declare function formatHintMark(mark: HintMark, nodeId?: number): string;
/** Short label for the pin badge: hinted count, plus the LEADING position when the node has one. */
export declare function hintBadgeLabel(marks: HintMark[], nodeId: number): string;
