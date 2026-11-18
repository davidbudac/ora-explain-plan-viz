import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { parsePlan } from '../parser';
import {
  parseHint,
  hintFamily,
  resolveHintTargets,
  analyzeHints,
  extractSqlHints,
  normalizeHintText,
  stripHintComments,
  diffOutlines,
  worstHintStatus,
  planHasHints,
  hintChipsForNode,
  estimateHintChipRows,
} from '../hints';

// Real Oracle 19c capture (dbmint, ADVANCED ALLSTATS LAST): used, unused and erroneous hints in one report.
const FIXTURE = readFileSync(join(__dirname, '../parser/__tests__/fixtures/advanced-hint-report-19c.txt'), 'utf8');

describe('parseHint', () => {
  it('reads the outline spelling: query block, qualified alias, column list', () => {
    const h = parseHint('INDEX_RS_ASC(@"SEL$1" "U"@"SEL$1" ("USER$"."NAME"))');
    expect(h.name).toBe('INDEX_RS_ASC');
    expect(h.queryBlock).toBe('SEL$1');
    expect(h.aliases).toEqual(['U@SEL$1']);
    expect(h.args).toEqual(['U@SEL$1', '(USER$.NAME)']);
    expect(h.family).toBe('access');
  });

  it('reads the user spelling: bare aliases, several for join and order hints', () => {
    expect(parseHint('index(u)').aliases).toEqual(['U']);
    expect(parseHint('index(u i_user1)').aliases).toEqual(['U']);
    expect(parseHint('use_nl(o u)').aliases).toEqual(['O', 'U']);
    expect(parseHint('leading(u o)').aliases).toEqual(['U', 'O']);
    expect(parseHint('parallel(o 8)').aliases).toEqual(['O']);
    expect(parseHint('no_merge(@sel$2 v)')).toMatchObject({ queryBlock: 'SEL$2', aliases: ['V'], family: 'transform' });
  });

  it('keeps statement-level hints alias-free and tolerates bare words', () => {
    expect(parseHint("OPT_PARAM('optimizer_index_cost_adj' 10)")).toMatchObject({ family: 'statement', aliases: [] });
    expect(parseHint('gather_plan_statistics')).toMatchObject({ name: 'GATHER_PLAN_STATISTICS', args: [], family: 'statement' });
    expect(parseHint('no_such_hint')).toMatchObject({ family: 'other' });
  });

  it('classifies families', () => {
    expect(hintFamily('full')).toBe('access');
    expect(hintFamily('USE_HASH')).toBe('join');
    expect(hintFamily('LEADING')).toBe('order');
    expect(hintFamily('PQ_DISTRIBUTE')).toBe('parallel');
    expect(hintFamily('UNNEST')).toBe('transform');
    expect(hintFamily('ALL_ROWS')).toBe('statement');
  });
});

describe('resolveHintTargets on the 19c capture', () => {
  const plan = parsePlan(FIXTURE);

  it('lands access hints on the operations carrying the alias', () => {
    expect(resolveHintTargets(plan, parseHint('full(o)'))).toMatchObject({ nodeIds: [5], kind: 'alias' });
    // U@SEL$1 is both the table access (3) and its index scan (4)
    expect(resolveHintTargets(plan, parseHint('INDEX_RS_ASC(@"SEL$1" "U"@"SEL$1" ("USER$"."NAME"))')).nodeIds).toEqual([3, 4]);
  });

  it('lands join hints on the join above the alias', () => {
    expect(resolveHintTargets(plan, parseHint('USE_NL(@"SEL$1" "O"@"SEL$1")'))).toMatchObject({ nodeIds: [2], kind: 'join' });
    expect(resolveHintTargets(plan, parseHint('use_nl(o u)')).nodeIds).toEqual([2]);
  });

  it('numbers LEADING aliases on the table accesses', () => {
    const t = resolveHintTargets(plan, parseHint('LEADING(@"SEL$1" "U"@"SEL$1" "O"@"SEL$1")'));
    expect(t.nodeIds).toEqual([3, 5]);
    expect(t.order?.get(3)).toBe(1);
    expect(t.order?.get(5)).toBe(2);
  });

  it('puts statement hints on the root and unknown aliases nowhere', () => {
    expect(resolveHintTargets(plan, parseHint('ALL_ROWS'))).toMatchObject({ nodeIds: [0], kind: 'statement' });
    expect(resolveHintTargets(plan, parseHint('full(zzz)'))).toMatchObject({ nodeIds: [], kind: 'none' });
  });
});

describe('analyzeHints on the 19c capture', () => {
  const plan = parsePlan(FIXTURE);
  const analysis = analyzeHints(plan);

  it('parses the capture cleanly and sees hints', () => {
    expect(plan.warnings ?? []).toEqual([]);
    expect(planHasHints(plan)).toBe(true);
    expect(plan.hintSummary).toEqual({ total: 7, unused: 1, errors: 2 });
  });

  it('keeps every Hint Report entry on the operation Oracle reported it on', () => {
    expect(analysis.counts).toEqual({ used: 4, unused: 1, error: 2, other: 0 });
    const texts = (id: number) => analysis.report.filter((m) => m.nodeIds.includes(id)).map((m) => `${m.status}:${m.text}`).sort();
    expect(texts(1)).toEqual(['error:no_such_hint', 'error:planviz_hr', 'used:leading(u o)']);
    expect(texts(3)).toEqual(['unused:use_nl(o u)', 'used:index(u)']);
    // use_nl(o u) is reported twice: unused on the driving table U, used on O
    expect(texts(5)).toEqual(['used:full(o)', 'used:use_nl(o u)']);
    // a used join hint also marks the join it decided
    expect(texts(2)).toEqual(['used:use_nl(o u)']);
  });

  it('places outline decisions and credits the ones the statement hinted', () => {
    const byText = Object.fromEntries(analysis.outline.map((m) => [m.name, m]));
    expect(Object.keys(byText).sort()).toEqual(['FULL', 'INDEX_RS_ASC', 'LEADING', 'USE_NL']);
    expect(byText.FULL).toMatchObject({ nodeIds: [5], hinted: true });
    expect(byText.INDEX_RS_ASC).toMatchObject({ nodeIds: [3, 4], hinted: true });
    expect(byText.LEADING).toMatchObject({ nodeIds: [3, 5], hinted: true });
    expect(byText.USE_NL).toMatchObject({ nodeIds: [2], hinted: true });
    expect(analysis.coverage).toEqual({ decisions: 4, hinted: 4 });
  });

  it('indexes marks per operation, report entries first', () => {
    const atThree = analysis.byNode.get(3)!;
    expect(atThree.map((m) => m.source)).toEqual(['report', 'report', 'outline', 'outline']);
    expect(worstHintStatus(atThree)).toBe('unused');
    expect(worstHintStatus(analysis.byNode.get(1)!)).toBe('error');
    expect(worstHintStatus(analysis.byNode.get(2)!)).toBe('used');
  });
});

describe('extractSqlHints', () => {
  it('tokenises hint calls inside the comment, wrapped lines included', () => {
    const sql = 'select /*+ gather_plan_statistics full(o) use_nl(o\nu) leading(u o) */ count(*) from t';
    const [comment] = extractSqlHints(sql);
    expect(comment.hints.map((h) => h.text)).toEqual(['gather_plan_statistics', 'full(o)', 'use_nl(o\nu)', 'leading(u o)']);
    expect(sql.slice(comment.hints[1].start, comment.hints[1].end)).toBe('full(o)');
    expect(sql.slice(comment.start, comment.end)).toMatch(/^\/\*\+.*\*\/$/s);
  });

  it('handles nested parentheses, quoted strings and --+ comments', () => {
    const sql = "select --+ opt_param('optimizer_index_cost_adj' 10) index(t (t.a))\n* from t";
    const [comment] = extractSqlHints(sql);
    expect(comment.hints.map((h) => h.text)).toEqual(["opt_param('optimizer_index_cost_adj' 10)", 'index(t (t.a))']);
  });

  it('folds spelling so a wrapped SQL hint matches its Hint Report entry', () => {
    expect(normalizeHintText('use_nl(o\nu)')).toBe(normalizeHintText('use_nl(o u)'));
    expect(normalizeHintText('INDEX(@"SEL$1" "U"@"SEL$1")')).toBe('INDEX(@SEL$1U@SEL$1)');
  });

  it('strips hint comments for an unhinted re-explain', () => {
    expect(stripHintComments('select /*+ full(t) */ * from t --+ index(t)\nwhere 1=1')).toBe('select  * from t\nwhere 1=1');
  });
});

describe('diffOutlines', () => {
  const a = ['BEGIN_OUTLINE_DATA', 'ALL_ROWS', 'OUTLINE_LEAF(@"SEL$1")', 'FULL(@"SEL$1" "O"@"SEL$1")', 'LEADING(@"SEL$1" "U"@"SEL$1" "O"@"SEL$1")', 'USE_NL(@"SEL$1" "O"@"SEL$1")', 'END_OUTLINE_DATA'];
  const b = ['INDEX_RS_ASC(@"SEL$1" "O"@"SEL$1" ("OBJ$"."OWNER#"))', 'LEADING(@"SEL$1" "U"@"SEL$1" "O"@"SEL$1")', 'USE_HASH(@"SEL$1" "O"@"SEL$1")', 'PX_JOIN_FILTER(@"SEL$1" "O"@"SEL$1")'];

  it('reports decisions that changed, appeared or disappeared, ignoring boilerplate', () => {
    const d = diffOutlines(a, b);
    expect(d.same.map((e) => e.key)).toEqual(['order@SEL$1']);
    expect(d.changed.map((e) => [e.a, e.b])).toEqual([
      ['FULL(@"SEL$1" "O"@"SEL$1")', 'INDEX_RS_ASC(@"SEL$1" "O"@"SEL$1" ("OBJ$"."OWNER#"))'],
      ['USE_NL(@"SEL$1" "O"@"SEL$1")', 'USE_HASH(@"SEL$1" "O"@"SEL$1")'],
    ]);
    expect(d.onlyA).toEqual([]);
    expect(d.onlyB.map((e) => e.b)).toEqual(['PX_JOIN_FILTER(@"SEL$1" "O"@"SEL$1")']);
  });

  it('is empty for two plans without an outline', () => {
    expect(diffOutlines(undefined, undefined)).toEqual({ changed: [], onlyA: [], onlyB: [], same: [] });
  });

  describe('OPT_PARAM entries', () => {
    const FEEDBACK = "OPT_PARAM('_optimizer_use_feedback' 'false')";
    const COST_ADJ = "OPT_PARAM('optimizer_index_cost_adj' 20)";

    it('matches the same parameters whatever their order', () => {
      const d = diffOutlines([FEEDBACK, COST_ADJ], [COST_ADJ, FEEDBACK]);
      expect(d.same.map((e) => e.key).sort()).toEqual(['opt_param@_optimizer_use_feedback', 'opt_param@optimizer_index_cost_adj']);
      expect(d.changed).toEqual([]);
      expect(d.onlyA).toEqual([]);
      expect(d.onlyB).toEqual([]);
    });

    it('reports a parameter that only one plan sets as "only in" that plan', () => {
      const d = diffOutlines([FEEDBACK], [COST_ADJ, FEEDBACK]);
      expect(d.same.map((e) => e.a)).toEqual([FEEDBACK]);
      expect(d.changed).toEqual([]);
      expect(d.onlyA).toEqual([]);
      expect(d.onlyB.map((e) => e.b)).toEqual([COST_ADJ]);
    });

    it('reports a parameter whose value differs as changed', () => {
      const d = diffOutlines([COST_ADJ], ["OPT_PARAM('optimizer_index_cost_adj' 50)"]);
      expect(d.changed.map((e) => [e.key, e.a, e.b])).toEqual([
        ['opt_param@optimizer_index_cost_adj', COST_ADJ, "OPT_PARAM('optimizer_index_cost_adj' 50)"],
      ]);
      expect(d.same).toEqual([]);
    });
  });
});

describe('hintChipsForNode (what the lens draws)', () => {
  const plan = parsePlan(FIXTURE);
  const { byNode } = analyzeHints(plan);
  const labels = (id: number) => hintChipsForNode(byNode.get(id) ?? [], id).map((c) => `${c.status}${c.hinted ? '*' : ''}:${c.label}`);

  it('shows the statement\'s hints as written, then the optimizer\'s own decisions and the join-order position', () => {
    expect(labels(1)).toEqual(['error:! no_such_hint', 'error:! planviz_hr', 'used:✓ leading(u o)']);
    expect(labels(3)).toEqual(['unused:✗ use_nl(o u)', 'used:✓ index(u)', 'outline*:#1']);
    expect(labels(5)).toEqual(['used:✓ full(o)', 'used:✓ use_nl(o u)', 'outline*:#2']);
    // the join: the user's use_nl chip says it, so the outline USE_NL is not repeated
    expect(labels(2)).toEqual(['used:✓ use_nl(o u)']);
  });

  it('still names a hinted decision on a node that only inherits it', () => {
    expect(labels(4)).toEqual(['outline*:INDEX_RS_ASC']);
  });

  it('estimates chip rows for the node height', () => {
    const chips = hintChipsForNode(byNode.get(3) ?? [], 3);
    expect(estimateHintChipRows(chips, 232)).toBe(1);
    expect(estimateHintChipRows(chips, 120)).toBe(2);
    expect(estimateHintChipRows([], 232)).toBe(0);
  });
});
