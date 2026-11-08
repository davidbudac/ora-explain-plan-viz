const ACCESS = new Set([
    'FULL', 'INDEX', 'INDEX_ASC', 'INDEX_DESC', 'INDEX_RS', 'INDEX_RS_ASC', 'INDEX_RS_DESC', 'INDEX_FFS', 'INDEX_SS',
    'INDEX_SS_ASC', 'INDEX_SS_DESC', 'INDEX_JOIN', 'INDEX_COMBINE', 'INDEX_STATS', 'NO_INDEX', 'NO_INDEX_FFS', 'NO_INDEX_SS',
    'BATCH_TABLE_ACCESS_BY_ROWID', 'NO_BATCH_TABLE_ACCESS_BY_ROWID', 'CLUSTER', 'HASH', 'ROWID', 'INMEMORY', 'NO_INMEMORY',
    'CACHE', 'NOCACHE', 'TABLE_STATS', 'COLUMN_STATS', 'DYNAMIC_SAMPLING', 'CARDINALITY', 'DRIVING_SITE', 'ZONEMAP', 'NO_ZONEMAP',
    'INMEMORY_PRUNING', 'NO_INMEMORY_PRUNING', 'PX_FAULT_TOLERANCE', 'USE_BAND',
]);
const JOIN = new Set([
    'USE_NL', 'USE_NL_WITH_INDEX', 'USE_HASH', 'USE_MERGE', 'USE_MERGE_CARTESIAN', 'NO_USE_NL', 'NO_USE_HASH', 'NO_USE_MERGE',
    'NO_USE_CUBE', 'USE_CUBE', 'SWAP_JOIN_INPUTS', 'NO_SWAP_JOIN_INPUTS', 'NLJ_BATCHING', 'NO_NLJ_BATCHING', 'NLJ_PREFETCH',
    'NO_NLJ_PREFETCH', 'PX_JOIN_FILTER', 'NO_PX_JOIN_FILTER', 'SEMIJOIN', 'NO_SEMIJOIN', 'ANTIJOIN', 'NO_ANTIJOIN', 'NL_SJ',
    'HASH_SJ', 'MERGE_SJ', 'NL_AJ', 'HASH_AJ', 'MERGE_AJ', 'SEMI_TO_INNER', 'NO_SEMI_TO_INNER', 'JOIN_FILTER',
]);
const ORDER = new Set(['LEADING', 'ORDERED']);
const PARALLEL = new Set([
    'PARALLEL', 'NO_PARALLEL', 'NOPARALLEL', 'SHARED', 'PARALLEL_INDEX', 'NO_PARALLEL_INDEX', 'NOPARALLEL_INDEX',
    'PQ_DISTRIBUTE', 'PQ_MAP', 'PQ_NOMAP', 'PQ_SKEW', 'PQ_FILTER', 'PQ_REPLICATE', 'NO_PQ_REPLICATE', 'PQ_CONCURRENT_UNION',
    'NO_PQ_CONCURRENT_UNION', 'PX_JOIN_FILTER_PARALLEL', 'ENABLE_PARALLEL_DML', 'DISABLE_PARALLEL_DML', 'STATEMENT_QUEUING',
    'NO_STATEMENT_QUEUING', 'GBY_PUSHDOWN', 'NO_GBY_PUSHDOWN',
]);
const STATEMENT = new Set([
    'ALL_ROWS', 'FIRST_ROWS', 'RULE', 'CHOOSE', 'OPTIMIZER_FEATURES_ENABLE', 'DB_VERSION', 'OPT_PARAM',
    'IGNORE_OPTIM_EMBEDDED_HINTS', 'GATHER_PLAN_STATISTICS', 'MONITOR', 'NO_MONITOR', 'RESULT_CACHE', 'NO_RESULT_CACHE',
    'CURSOR_SHARING_EXACT', 'APPEND', 'APPEND_VALUES', 'NOAPPEND', 'NO_ADAPTIVE_PLAN', 'ADAPTIVE_PLAN', 'BIND_AWARE',
    'NO_BIND_AWARE', 'NO_CPU_COSTING', 'CPU_COSTING', 'FRESH_MV', 'MODEL_MIN_ANALYSIS', 'PRECOMPUTE_SUBQUERY',
    'NO_XML_QUERY_REWRITE', 'NO_XMLINDEX_REWRITE', 'NO_QUERY_TRANSFORMATION', 'OPT_ESTIMATE', 'DYNAMIC_SAMPLING_EST_CDN',
    'NO_SQL_TUNE', 'NO_SUBSTRB_PAD', 'NO_PARTIAL_COMMIT', 'ENABLE_PARALLEL_DDL', 'REWRITE', 'NO_REWRITE', 'NOREWRITE',
    'CHANGE_DUPKEY_ERROR_INDEX', 'IGNORE_ROW_ON_DUPKEY_INDEX', 'RETRY_ON_ROW_CHANGE', 'INLINE', 'MATERIALIZE',
    'NO_AUTO_REOPTIMIZE', 'AUTO_REOPTIMIZE', 'OPTIMIZER_MODE', 'MEMOPTIMIZE_WRITE', 'ANSI_REARCH', 'NO_ANSI_REARCH',
    'XMLINDEX_REWRITE', 'NO_PLSQL_MERGE', 'NO_SET_GBY_PUSHDOWN', 'SET_GBY_PUSHDOWN', 'DBMS_STATS', 'PDB_LOCAL_ONLY',
    'NO_PDB_LOCAL_ONLY', 'USE_DAGG_UNION_ALL_GSETS', 'NO_USE_DAGG_UNION_ALL_GSETS', 'SQL_SCOPE', 'USE_INVISIBLE_INDEXES',
    'NO_USE_INVISIBLE_INDEXES', 'EXPAND_TABLE', 'NO_EXPAND_TABLE',
]);
const TRANSFORM = new Set([
    'UNNEST', 'NO_UNNEST', 'MERGE', 'NO_MERGE', 'PUSH_PRED', 'NO_PUSH_PRED', 'PUSH_SUBQ', 'NO_PUSH_SUBQ', 'USE_CONCAT',
    'NO_EXPAND', 'STAR_TRANSFORMATION', 'NO_STAR_TRANSFORMATION', 'FACT', 'NO_FACT', 'OUTLINE', 'OUTLINE_LEAF',
    'ELIMINATE_JOIN', 'NO_ELIMINATE_JOIN', 'PLACE_GROUP_BY', 'NO_PLACE_GROUP_BY', 'ELIMINATE_OBY', 'NO_ELIMINATE_OBY',
    'OR_EXPAND', 'NO_OR_EXPAND', 'COALESCE_SQ', 'NO_COALESCE_SQ', 'EXPAND_GSET_TO_UNION', 'NO_EXPAND_GSET_TO_UNION',
    'FULL_OUTER_JOIN_TO_OUTER', 'NO_FULL_OUTER_JOIN_TO_OUTER', 'OUTER_JOIN_TO_INNER', 'NO_OUTER_JOIN_TO_INNER',
    'OUTER_JOIN_TO_ANTI', 'NO_OUTER_JOIN_TO_ANTI', 'VECTOR_TRANSFORM', 'NO_VECTOR_TRANSFORM', 'VECTOR_TRANSFORM_FACT',
    'VECTOR_TRANSFORM_DIMS', 'PARTIAL_JOIN', 'NO_PARTIAL_JOIN', 'DECORRELATE', 'NO_DECORRELATE', 'SUBQUERY_PRUNING',
    'NO_SUBQUERY_PRUNING', 'ELIM_GROUPBY', 'NO_ELIM_GROUPBY', 'USE_HASH_AGGREGATION', 'NO_USE_HASH_AGGREGATION',
    'CONNECT_BY_FILTERING', 'NO_CONNECT_BY_FILTERING', 'CONNECT_BY_COMBINE_SW', 'NO_CONNECT_BY_COMBINE_SW',
    'CONNECT_BY_CB_WHR_ONLY', 'NO_CONNECT_BY_CB_WHR_ONLY', 'CONNECT_BY_ELIM_DUPS', 'NO_CONNECT_BY_ELIM_DUPS',
    'CONNECT_BY_COST_BASED', 'NO_CONNECT_BY_COST_BASED', 'TRANSFORM_DISTINCT_AGG', 'NO_TRANSFORM_DISTINCT_AGG', 'QB_NAME',
    'ELIMINATE_SQ', 'NO_ELIMINATE_SQ', 'ANSWER_QUERY_USING_STATS', 'NO_ANSWER_QUERY_USING_STATS', 'DIST_AGG_PROLLUP_PUSHDOWN',
    'NO_DIST_AGG_PROLLUP_PUSHDOWN', 'ELIMINATE_SET_OPERATOR', 'NO_ELIMINATE_SET_OPERATOR', 'UNNEST_INNERJ_DISTINCT_VIEW',
    'NO_UNNEST_INNERJ_DISTINCT_VIEW', 'UNNEST_NOSEMIJ_NODISTINCTVIEW', 'UNNEST_SEMIJ_VIEW', 'SEMI_TO_INNER_ANY',
    'PUSH_HAVING_TO_GBY', 'NO_PUSH_HAVING_TO_GBY', 'CHECK_ACL_REWRITE', 'NO_CHECK_ACL_REWRITE', 'BUSHY_JOIN', 'NO_BUSHY_JOIN',
    'OLD_PUSH_PRED', 'NO_PRUNE_GSETS', 'NO_SEMI_TO_INNER', 'DATA_SECURITY_REWRITE_LIMIT', 'NO_DATA_SECURITY_REWRITE',
    'ORDER_SUBQ', 'NO_ORDER_SUBQ', 'STAR_TRANSFORMATION_TEMP_TABLE', 'OBY_PRUNING', 'NO_OBY_PRUNING', 'JSON_LENGTH',
    'INLINE_XMLTYPE_NT', 'NO_INLINE_XMLTYPE_NT', 'XML_DML_RWT_STMT', 'NO_XML_DML_REWRITE', 'FORCE_XML_QUERY_REWRITE',
    'DOMAIN_INDEX_FILTER', 'NO_DOMAIN_INDEX_FILTER', 'DOMAIN_INDEX_SORT', 'DOMAIN_INDEX_NO_SORT', 'NO_CARTESIAN',
    'CUBE_GB', 'NO_CUBE_GB', 'USE_TTT_FOR_GSETS', 'EXPAND_ROWSET', 'PULL_PRED', 'NO_PULL_PRED',
]);
export function hintFamily(name) {
    const n = name.toUpperCase();
    if (ACCESS.has(n))
        return 'access';
    if (JOIN.has(n))
        return 'join';
    if (ORDER.has(n))
        return 'order';
    if (PARALLEL.has(n))
        return 'parallel';
    if (STATEMENT.has(n))
        return 'statement';
    if (TRANSFORM.has(n))
        return 'transform';
    return 'other';
}
export const HINT_FAMILY_LABELS = {
    access: 'Access path',
    join: 'Join method',
    order: 'Join order',
    transform: 'Transformation',
    parallel: 'Parallelism',
    statement: 'Statement',
    other: 'Other',
};
/** Outline entries that describe the environment or the outline's own structure, not a plan decision. */
const OUTLINE_BOILERPLATE = new Set([
    'BEGIN_OUTLINE_DATA', 'END_OUTLINE_DATA', 'IGNORE_OPTIM_EMBEDDED_HINTS', 'OPTIMIZER_FEATURES_ENABLE', 'DB_VERSION',
    'OUTLINE', 'OUTLINE_LEAF', 'ALL_ROWS', 'FIRST_ROWS',
]);
export function isOutlineBoilerplate(name) {
    return OUTLINE_BOILERPLATE.has(name.toUpperCase());
}
/** Split `a b (c d) 'e f' g` on whitespace/commas at depth 0; parenthesised groups stay whole. */
function splitArgs(body) {
    const out = [];
    let depth = 0;
    let quote = null;
    let cur = '';
    for (const ch of body) {
        if (quote) {
            cur += ch;
            if (ch === quote)
                quote = null;
            continue;
        }
        if (ch === "'") {
            quote = ch;
            cur += ch;
            continue;
        }
        if (ch === '(')
            depth++;
        if (ch === ')')
            depth = Math.max(0, depth - 1);
        if (depth === 0 && (/\s/.test(ch) || ch === ',')) {
            if (cur)
                out.push(cur);
            cur = '';
            continue;
        }
        cur += ch;
    }
    if (cur)
        out.push(cur);
    return out;
}
const stripQuotes = (s) => s.replace(/"/g, '');
/** `"U"@"SEL$1"` / `U@SEL$1` / `u` → an alias token in upper case. */
function isAliasToken(token, family, index) {
    if (token.startsWith('@') || token.startsWith('(') || token.startsWith("'"))
        return false;
    if (/^\d/.test(token))
        return false;
    if (token.includes('@'))
        return true; // outline spelling always qualifies aliases
    // User spelling: the first argument is the alias for every family that takes one; join and
    // order hints list several (`use_nl(o u)`, `leading(u o)`); everything after the first
    // argument of an access/parallel hint is an index name, a degree or a keyword.
    if (family === 'join' || family === 'order')
        return true;
    if (family === 'statement')
        return false;
    return index === 0;
}
/** Parse one hint call. Never throws; a bare word is a hint with no arguments. */
export function parseHint(text) {
    const trimmed = text.trim();
    const m = trimmed.match(/^([A-Za-z_][\w$#]*)\s*(?:\(([\s\S]*)\))?\s*$/);
    const name = (m ? m[1] : trimmed.split(/[\s(]/)[0] ?? trimmed).toUpperCase();
    const family = hintFamily(name);
    const rawArgs = m && m[2] !== undefined ? splitArgs(m[2].trim()) : [];
    let queryBlock;
    const args = [];
    for (const raw of rawArgs) {
        if (raw.startsWith('@') && queryBlock === undefined && args.length === 0) {
            queryBlock = stripQuotes(raw.slice(1)).toUpperCase();
            continue;
        }
        args.push(stripQuotes(raw));
    }
    const aliases = [];
    args.forEach((arg, i) => {
        if (isAliasToken(arg, family, i))
            aliases.push(arg.toUpperCase());
    });
    return { text: trimmed, name, args, queryBlock, aliases, family };
}
// ---------------------------------------------------------------------------
// Target resolution
// ---------------------------------------------------------------------------
const JOIN_OP_RE = /^(NESTED LOOPS|HASH JOIN|MERGE JOIN)/;
function aliasMatches(node, alias, queryBlock) {
    const nodeAlias = node.objectAlias?.toUpperCase();
    if (!nodeAlias)
        return false;
    if (alias.includes('@'))
        return nodeAlias === alias;
    const [name, qb] = nodeAlias.split('@');
    if (name !== alias)
        return false;
    return queryBlock === undefined || qb === queryBlock;
}
function nodesForAlias(plan, alias, queryBlock) {
    return plan.allNodes.filter((n) => !n.inactive && aliasMatches(n, alias, queryBlock));
}
function nearestJoin(plan, node) {
    const byId = new Map(plan.allNodes.map((n) => [n.id, n]));
    let cur = node.parentId !== undefined ? byId.get(node.parentId) : undefined;
    while (cur) {
        if (JOIN_OP_RE.test(cur.operation.toUpperCase()))
            return cur;
        cur = cur.parentId !== undefined ? byId.get(cur.parentId) : undefined;
    }
    return undefined;
}
/**
 * Find the operations a hint acts on. Access and parallel hints land on the operations that
 * carry the alias (table access and its index scan); join hints on the nearest join above the
 * alias; LEADING on the aliases in order; query-block hints on every operation of that block;
 * statement-level hints on the root.
 */
export function resolveHintTargets(plan, hint) {
    const root = plan.rootNode;
    if (hint.aliases.length > 0) {
        if (hint.family === 'join') {
            const joins = new Set();
            const fallback = [];
            for (const alias of hint.aliases) {
                for (const node of nodesForAlias(plan, alias, hint.queryBlock)) {
                    const join = nearestJoin(plan, node);
                    if (join)
                        joins.add(join.id);
                    else
                        fallback.push(node.id);
                }
            }
            if (joins.size > 0)
                return { nodeIds: [...joins].sort((a, b) => a - b), kind: 'join' };
            if (fallback.length > 0)
                return { nodeIds: dedupe(fallback), kind: 'alias' };
            return { nodeIds: [], kind: 'none' };
        }
        if (hint.family === 'order') {
            const order = new Map();
            const ids = [];
            hint.aliases.forEach((alias, i) => {
                // The shallowest operation with the alias (the table access, not its index scan).
                const candidates = nodesForAlias(plan, alias, hint.queryBlock).sort((a, b) => a.depth - b.depth);
                const node = candidates[0];
                if (node && !order.has(node.id)) {
                    order.set(node.id, i + 1);
                    ids.push(node.id);
                }
            });
            return ids.length > 0 ? { nodeIds: ids, order, kind: 'alias' } : { nodeIds: [], kind: 'none' };
        }
        const ids = [];
        for (const alias of hint.aliases) {
            for (const node of nodesForAlias(plan, alias, hint.queryBlock))
                ids.push(node.id);
        }
        return ids.length > 0 ? { nodeIds: dedupe(ids), kind: 'alias' } : { nodeIds: [], kind: 'none' };
    }
    if (hint.queryBlock && hint.family !== 'statement') {
        const ids = plan.allNodes
            .filter((n) => !n.inactive && n.queryBlock?.toUpperCase() === hint.queryBlock)
            .map((n) => n.id);
        if (ids.length > 0)
            return { nodeIds: ids, kind: 'query-block' };
    }
    if (root)
        return { nodeIds: [root.id], kind: 'statement' };
    return { nodeIds: [], kind: 'none' };
}
function dedupe(ids) {
    return [...new Set(ids)].sort((a, b) => a - b);
}
// ---------------------------------------------------------------------------
// Decisions: relate the statement's hints to the outline
// ---------------------------------------------------------------------------
/**
 * Which plan decision a hint settles, regardless of spelling: `index(u)` and
 * `INDEX_RS_ASC(@"SEL$1" "U"@"SEL$1" (…))` are both the access path of U. Transformation
 * hints are keyed by their base name (UNNEST / NO_UNNEST decide the same thing).
 */
export function decisionName(hint) {
    const base = hint.name.replace(/^NO_/, '');
    switch (hint.family) {
        case 'access':
            return /^(FULL|INDEX|INDEX_[A-Z_]+|CLUSTER|HASH|ROWID)$/.test(base) ? 'access' : base.toLowerCase();
        case 'join':
            // The join *method* is one decision; batching, Bloom filters and input swaps are their own.
            return /^USE_/.test(base) || /_(SJ|AJ)$/.test(base) ? 'join' : base.toLowerCase();
        case 'order': return 'order';
        case 'parallel':
            return /^(PARALLEL|NOPARALLEL|SHARED)$/.test(base) ? 'parallel' : base.toLowerCase();
        case 'transform': return base.toLowerCase();
        default: return hint.name.toLowerCase();
    }
}
/** Decision key within one plan: the decision plus the operations it lands on. */
export function decisionKey(plan, hint) {
    const targets = resolveHintTargets(plan, hint);
    return `${decisionName(hint)}@${targets.nodeIds.join(',')}`;
}
export function planHasHints(plan) {
    if (!plan)
        return false;
    if (plan.outlineHints && plan.outlineHints.length > 0)
        return true;
    return plan.allNodes.some((n) => n.hints && n.hints.length > 0);
}
export function analyzeHints(plan) {
    const report = [];
    const counts = { used: 0, unused: 0, error: 0, other: 0 };
    const usedKeys = new Set();
    for (const node of plan.allNodes) {
        for (const entry of node.hints ?? []) {
            const parsed = parseHint(entry.text);
            const ids = [node.id];
            if (parsed.family === 'join' && entry.status === 'used') {
                const targets = resolveHintTargets(plan, { ...parsed, queryBlock: parsed.queryBlock ?? entry.queryBlock?.toUpperCase() });
                if (targets.kind === 'join')
                    ids.push(...targets.nodeIds);
            }
            counts[entry.status]++;
            if (entry.status === 'used') {
                usedKeys.add(decisionKey(plan, { ...parsed, queryBlock: parsed.queryBlock ?? entry.queryBlock?.toUpperCase() }));
            }
            report.push({
                text: entry.text,
                name: parsed.name,
                family: parsed.family,
                source: 'report',
                status: entry.status,
                code: entry.code,
                reason: entry.reason,
                queryBlock: entry.queryBlock,
                nodeIds: dedupe(ids),
            });
        }
    }
    const outline = [];
    for (const text of plan.outlineHints ?? []) {
        const parsed = parseHint(text);
        if (isOutlineBoilerplate(parsed.name))
            continue;
        const targets = resolveHintTargets(plan, parsed);
        const key = `${decisionName(parsed)}@${targets.nodeIds.join(',')}`;
        outline.push({
            text,
            name: parsed.name,
            family: parsed.family,
            source: 'outline',
            status: 'outline',
            queryBlock: parsed.queryBlock,
            nodeIds: targets.nodeIds,
            order: targets.order,
            hinted: usedKeys.has(key),
        });
    }
    const byNode = new Map();
    for (const mark of [...report, ...outline]) {
        for (const id of mark.nodeIds) {
            const list = byNode.get(id) ?? [];
            list.push(mark);
            byNode.set(id, list);
        }
    }
    return {
        report,
        outline,
        coverage: { decisions: outline.length, hinted: outline.filter((m) => m.hinted).length },
        byNode,
        counts,
    };
}
/** Worst status among marks: error > unused > other > used > outline. */
export function worstHintStatus(marks) {
    const rank = { error: 4, unused: 3, other: 2, used: 1, outline: 0 };
    let worst;
    for (const m of marks) {
        if (worst === undefined || rank[m.status] > rank[worst])
            worst = m.status;
    }
    return worst;
}
/** Hint comments in a statement, with each hint call tokenised (balanced parentheses). */
export function extractSqlHints(sql) {
    const comments = [];
    const re = /\/\*\+([\s\S]*?)\*\/|--\+([^\n]*)/g;
    let m;
    while ((m = re.exec(sql)) !== null) {
        const body = m[1] ?? m[2] ?? '';
        const bodyStart = m.index + (m[1] !== undefined ? 3 : 3);
        comments.push({ start: m.index, end: m.index + m[0].length, hints: tokenizeHintBody(body, bodyStart) });
    }
    return comments;
}
function tokenizeHintBody(body, offset) {
    const tokens = [];
    let i = 0;
    while (i < body.length) {
        if (!/[A-Za-z_]/.test(body[i])) {
            i++;
            continue;
        }
        const start = i;
        while (i < body.length && /[\w$#]/.test(body[i]))
            i++;
        // Optional whitespace then a parenthesised argument list
        let j = i;
        while (j < body.length && /\s/.test(body[j]))
            j++;
        if (body[j] === '(') {
            let depth = 0;
            let quote = null;
            for (; j < body.length; j++) {
                const ch = body[j];
                if (quote) {
                    if (ch === quote)
                        quote = null;
                    continue;
                }
                if (ch === "'" || ch === '"')
                    quote = ch;
                else if (ch === '(')
                    depth++;
                else if (ch === ')') {
                    depth--;
                    if (depth === 0) {
                        j++;
                        break;
                    }
                }
            }
            i = j;
        }
        tokens.push({ text: body.slice(start, i), start: offset + start, end: offset + i });
    }
    return tokens;
}
/** Spelling-insensitive identity of a hint: case and whitespace folded, quotes dropped. */
export function normalizeHintText(text) {
    return text.replace(/\s+/g, '').replace(/"/g, '').toUpperCase();
}
/** The SQL text without its hint comments (for an unhinted re-explain). */
export function stripHintComments(sql) {
    return sql.replace(/\/\*\+[\s\S]*?\*\//g, '').replace(/--\+[^\n]*/g, '').replace(/[ \t]+\n/g, '\n');
}
/** Cross-plan decision key: decision + the aliases (or query block) it names. */
export function outlineDecisionKey(hint) {
    const target = hint.aliases.length > 0
        ? [...hint.aliases].sort().join(',')
        : hint.queryBlock ?? '';
    // LEADING is one decision per query block, whatever the alias order.
    if (hint.family === 'order')
        return `order@${hint.queryBlock ?? ''}`;
    return `${decisionName(hint)}@${target}`;
}
export function diffOutlines(a, b) {
    const index = (hints) => {
        const map = new Map();
        for (const text of hints ?? []) {
            const parsed = parseHint(text);
            if (isOutlineBoilerplate(parsed.name))
                continue;
            let key = outlineDecisionKey(parsed);
            // Several hints can share a key (e.g. two OPT_PARAM); keep them apart by text.
            if (map.has(key) && normalizeHintText(map.get(key).text) !== normalizeHintText(text))
                key = `${key}#${normalizeHintText(text)}`;
            map.set(key, { text, family: parsed.family });
        }
        return map;
    };
    const ia = index(a);
    const ib = index(b);
    const diff = { changed: [], onlyA: [], onlyB: [], same: [] };
    for (const [key, va] of ia) {
        const vb = ib.get(key);
        if (!vb)
            diff.onlyA.push({ key, family: va.family, a: va.text });
        else if (normalizeHintText(va.text) === normalizeHintText(vb.text))
            diff.same.push({ key, family: va.family, a: va.text, b: vb.text });
        else
            diff.changed.push({ key, family: va.family, a: va.text, b: vb.text });
    }
    for (const [key, vb] of ib) {
        if (!ia.has(key))
            diff.onlyB.push({ key, family: vb.family, b: vb.text });
    }
    return diff;
}
/** One tooltip line per mark: status glyph, hint text, what it is / why it was dropped. */
export function formatHintMark(mark, nodeId) {
    const family = HINT_FAMILY_LABELS[mark.family].toLowerCase();
    const order = nodeId !== undefined ? mark.order?.get(nodeId) : undefined;
    const position = order !== undefined ? ` (#${order} in join order)` : '';
    switch (mark.status) {
        case 'used': return `✓ ${mark.text} — used (${family})`;
        case 'unused': return `✗ ${mark.text} — not used${mark.reason ? `: ${mark.reason}` : ''}`;
        case 'error': return `! ${mark.text} — syntax error, ignored`;
        case 'other': return `? ${mark.text} — status ${mark.code ?? '?'}${mark.reason ? `: ${mark.reason}` : ''}`;
        case 'outline': return `· ${mark.text} — ${mark.hinted ? 'your hint' : "optimizer's"} ${family} decision${position}`;
    }
}
/** Short label for the pin badge: hinted count, plus the LEADING position when the node has one. */
export function hintBadgeLabel(marks, nodeId) {
    const own = marks.filter((m) => m.source === 'report').length;
    const order = marks.find((m) => m.order?.has(nodeId))?.order?.get(nodeId);
    const parts = [];
    parts.push(String(own > 0 ? own : marks.length));
    if (order !== undefined)
        parts.push(`#${order}`);
    return parts.join(' · ');
}
