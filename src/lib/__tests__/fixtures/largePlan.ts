import type { FilterState } from '../../types';
import { defaultNodeDisplayOptions } from '../../settings';

/**
 * Deterministic generator for a large, realistic DBMS_XPLAN.DISPLAY plan —
 * used to exercise parse / advisor / filter / layout at ~2,000 operations
 * (the largest bundled example has 22).
 *
 * Shape: SELECT STATEMENT → UNION-ALL → many left-deep join chains of varying
 * length (so depth runs from a handful up to ~40), each join pairing the chain
 * with either a full scan or an index range scan + rowid lookup. Roughly a
 * third of the joins are hash joins, the rest nested loops; hash joins,
 * index scans and a share of full scans carry predicates.
 */

interface GenNode {
  op: string;
  name?: string;
  access?: string;
  filter?: string;
  rows: number;
  children: GenNode[];
}

export interface LargePlanOptions {
  /** Exact number of plan operations (rows in the plan table). Default 2000. */
  operations?: number;
  /** Maximum nesting depth of a join chain. Default 36 (→ plan depth ≈ 40). */
  maxChainLength?: number;
  seed?: number;
}

export interface LargePlan {
  text: string;
  operationCount: number;
  /** Operation ids that carry an access or filter predicate (the `*` rows). */
  predicateNodeCount: number;
  maxDepth: number;
}

/** mulberry32: tiny seeded PRNG so every run builds the identical plan. */
function prng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const TABLES = [
  'ORDERS', 'ORDER_ITEMS', 'CUSTOMERS', 'PRODUCTS', 'SUPPLIERS', 'REGIONS', 'COUNTRIES',
  'SHIPMENTS', 'INVOICES', 'PAYMENTS', 'WAREHOUSES', 'INVENTORY', 'EMPLOYEES', 'DEPARTMENTS',
];

function formatCount(n: number): string {
  if (n < 100000) return String(n);
  if (n < 100000000) return `${Math.round(n / 1000)}K`;
  return `${Math.round(n / 1000000)}M`;
}

function formatBytes(n: number): string {
  if (n < 10000) return String(n);
  if (n < 10000000) return `${Math.round(n / 1024)}K`;
  return `${Math.round(n / 1048576)}M`;
}

function formatTime(cost: number): string {
  const seconds = Math.min(359999, Math.max(1, Math.round(cost / 80)));
  const h = String(Math.floor(seconds / 3600)).padStart(2, '0');
  const m = String(Math.floor((seconds % 3600) / 60)).padStart(2, '0');
  const s = String(seconds % 60).padStart(2, '0');
  return `${h}:${m}:${s}`;
}

export function generateLargePlan(options: LargePlanOptions = {}): LargePlan {
  const { operations = 2000, maxChainLength = 36, seed = 20261001 } = options;
  const rand = prng(seed);
  const pick = <T,>(items: readonly T[]): T => items[Math.floor(rand() * items.length)];
  const between = (lo: number, hi: number) => lo + Math.floor(rand() * (hi - lo + 1));

  let budget = operations - 2; // SELECT STATEMENT + UNION-ALL
  if (budget < 1) throw new Error('operations must be at least 3');
  let aliasSeq = 0;

  /** A scan leaf: 1 op (full scan) or 2 ops (rowid lookup over an index range scan). */
  const buildScan = (): GenNode => {
    const table = pick(TABLES);
    const alias = `T${++aliasSeq}`;
    const rows = between(1, 5000) * (rand() < 0.2 ? 100 : 1);
    if (budget >= 2 && rand() < 0.45) {
      budget -= 2;
      return {
        op: 'TABLE ACCESS BY INDEX ROWID',
        name: table,
        rows,
        children: [{
          op: 'INDEX RANGE SCAN',
          name: `${table}_IDX${between(1, 4)}`,
          access: `"${alias}"."${table.slice(0, 3)}_ID"=:B${aliasSeq}`,
          rows,
          children: [],
        }],
      };
    }
    budget -= 1;
    return {
      op: 'TABLE ACCESS FULL',
      name: table,
      filter: rand() < 0.3 ? `"${alias}"."STATUS"='${pick(['OPEN', 'SHIPPED', 'CLOSED', 'NEW'])}'` : undefined,
      rows,
      children: [],
    };
  };

  /** A left-deep chain of `length` joins ending in a scan; consumes budget as it goes. */
  const buildChain = (length: number): GenNode => {
    if (length === 0 || budget < 3) return buildScan();
    budget -= 1; // the join itself
    const hash = rand() < 0.34;
    const inner = buildChain(length - 1);
    const outer = buildScan();
    const alias = `T${++aliasSeq}`;
    return {
      op: hash ? 'HASH JOIN' : 'NESTED LOOPS',
      access: hash ? `"${alias}"."KEY_ID"="J${aliasSeq}"."KEY_ID"` : undefined,
      rows: Math.max(1, Math.round((inner.rows * outer.rows) / between(2, 40))),
      children: [inner, outer],
    };
  };

  const branches: GenNode[] = [];
  while (budget > 0) {
    // Varied depth: a few very deep chains, mostly moderate ones.
    const length = rand() < 0.2 ? between(Math.floor(maxChainLength * 0.7), maxChainLength) : between(2, 14);
    const before = budget;
    branches.push(buildChain(length));
    if (budget === before) budget -= 1; // unreachable guard against a zero-progress loop
  }

  const root: GenNode = {
    op: 'SELECT STATEMENT',
    rows: 1,
    children: [{ op: 'UNION-ALL', rows: 1, children: branches }],
  };

  // Flatten pre-order and compute cumulative costs bottom-up.
  interface Row { id: number; depth: number; node: GenNode; cost: number; hasPredicate: boolean }
  const rows: Row[] = [];
  const costOf = new Map<GenNode, number>();
  const visit = (node: GenNode, depth: number): number => {
    const row: Row = { id: rows.length, depth, node, cost: 0, hasPredicate: !!(node.access || node.filter) };
    rows.push(row);
    const childCost = node.children.reduce((sum, child) => sum + visit(child, depth + 1), 0);
    const own = node.children.length === 0 ? between(2, 400) : between(1, 20);
    row.cost = childCost + own;
    costOf.set(node, row.cost);
    return row.cost;
  };
  visit(root, 0);

  // The Operation column grows with the deepest indent, like real DBMS_XPLAN output.
  const idDigits = String(rows.length - 1).length;
  const idWidth = idDigits + 2; // marker + digits + space
  const opWidth = Math.max(...rows.map((r) => 1 + r.depth + r.node.op.length)) + 1;
  const lines: string[] = [];
  const width = 1 + idWidth + 1 + opWidth + 1 + 22 + 1 + 7 + 1 + 7 + 1 + 12 + 1 + 10 + 1 + 1;
  const rule = '-'.repeat(width);
  lines.push(`Plan hash value: ${between(1000000000, 4000000000)}`, '', rule);
  lines.push(`|${' Id'.padEnd(idWidth)}|${' Operation'.padEnd(opWidth)}| Name                 | Rows  | Bytes | Cost (%CPU)| Time     |`);
  lines.push(rule);
  let maxDepth = 0;
  for (const { id, depth, node, cost, hasPredicate } of rows) {
    maxDepth = Math.max(maxDepth, depth);
    const marker = hasPredicate ? '*' : ' ';
    const idCell = `${marker}${String(id).padStart(idDigits)} `;
    const opCell = ` ${' '.repeat(depth)}${node.op}`.padEnd(opWidth);
    const nameCell = ` ${node.name ?? ''}`.padEnd(22);
    const rowsCell = formatCount(node.rows).padStart(6) + ' ';
    const bytesCell = formatBytes(node.rows * 37).padStart(6) + ' ';
    const costCell = `${String(cost).padStart(7)} (${between(0, 9)})`.padEnd(12);
    lines.push(`|${idCell}|${opCell}|${nameCell}|${rowsCell}|${bytesCell}|${costCell}| ${formatTime(cost)} |`);
  }
  lines.push(rule, '', 'Predicate Information (identified by operation id):', '---------------------------------------------------', '');
  let predicateNodeCount = 0;
  for (const { id, node } of rows) {
    if (node.access) {
      lines.push(`${String(id).padStart(4)} - access(${node.access})`);
    }
    if (node.filter) {
      lines.push(`${String(id).padStart(4)} - filter(${node.filter})`);
    }
    if (node.access || node.filter) predicateNodeCount++;
  }
  lines.push('');

  return { text: lines.join('\n'), operationCount: rows.length, predicateNodeCount, maxDepth };
}

/** Neutral filter state (matches everything) with the app's default display options. */
export function neutralFilters(overrides: Partial<FilterState> = {}): FilterState {
  return {
    operationTypes: [],
    minCost: 0,
    maxCost: Infinity,
    searchText: '',
    showPredicates: true,
    predicateTypes: [],
    animateEdges: false,
    scaleEdgeWidth: true,
    focusSelection: false,
    nodeDisplayOptions: { ...defaultNodeDisplayOptions },
    minActualRows: 0,
    maxActualRows: Infinity,
    minActualTime: 0,
    maxActualTime: Infinity,
    minCardinalityMismatch: 0,
    ...overrides,
  };
}
