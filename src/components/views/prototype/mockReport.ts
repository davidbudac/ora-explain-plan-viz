// PROTOTYPE — throwaway UI prototype for wayfinder ticket 08 (non-expert analysis report design). Not production code.

/**
 * Hardcoded mock content for the "AI Report" prototype.
 *
 * The types below double as a first draft of the future report contract: the
 * shape a hosted analysis endpoint would return for a single plan.
 */

export type ReportSeverity = 'critical' | 'warning' | 'info';

/** Where a finding came from. Deterministic advisor rule vs. model interpretation. */
export type FindingSource = 'advisor' | 'ai';

/** A plain-language reference to a plan step. `label` leads, `id` is the fallback. */
export interface MockNodeRef {
  id: number;
  label: string;
}

export interface MockVerdict {
  severity: ReportSeverity;
  headline: string;
  detail: string;
  statChips: string[];
}

/** A single number worth showing as a tile (variant B "Evidence" grid). */
export interface MockEvidenceTile {
  label: string;
  value: string;
}

export interface MockFinding {
  id: string;
  severity: ReportSeverity;
  source: FindingSource;
  title: string;
  nodeRefs: MockNodeRef[];
  explanation: string;
  evidence: MockEvidenceTile[];
  /** Index into `MockAiReport.actions` for the fix that addresses this finding. */
  actionIndex?: number;
}

export interface MockAction {
  title: string;
  body: string;
  sql?: string;
  effortChip: string;
}

export type FidelityRungState = 'reached' | 'current' | 'locked';

export interface MockFidelityRung {
  id: 'F0' | 'F1' | 'F2' | 'F3';
  label: string;
  state: FidelityRungState;
}

export interface MockBuilderPreview {
  title: string;
  creditChip: string;
  rungs: MockFidelityRung[];
  /** May contain `**bold**` spans. */
  copy: string;
  files: string[];
  footnote: string;
  buttonLabel: string;
}

export interface MockAiReport {
  verdict: MockVerdict;
  /** Prose paragraphs. May contain `{{id|label}}` plan-step tokens. */
  narrativeParagraphs: string[];
  findings: MockFinding[];
  actions: MockAction[];
  builderPreview: MockBuilderPreview;
  quotaChip: string;
  deepAnalysisChip: string;
}

/** The example plan this mock was written against. */
export const MOCK_SQL_ID = '96d05a34rtfqx';
export const MOCK_EXAMPLE_NAME = "22 · Cardinality Trap (NL)";

export const DEEP_ANALYSIS_TOOLTIP =
  'Deep analysis (top model, cross-checks, metadata-aware) — prototype, not wired';

export const SOURCE_CHIP_TOOLTIP: Record<FindingSource, string> = {
  advisor: 'Found by the deterministic Plan Advisor — always shown, never AI-generated',
  ai: 'AI interpretation — grounded in the plan, may add context beyond the deterministic checks',
};

const ACTION_1_SQL = `SELECT DBMS_STATS.CREATE_EXTENDED_STATS(
         ownname   => 'PLANVIZ',
         tabname   => 'ORDERS',
         extension => '(SHIP_COUNTRY, SHIP_CURRENCY, SHIP_LANGUAGE)')
FROM dual;

EXEC DBMS_STATS.GATHER_TABLE_STATS('PLANVIZ', 'ORDERS', -
       method_opt => 'FOR ALL COLUMNS SIZE AUTO')`;

export const MOCK_REPORT: MockAiReport = {
  verdict: {
    severity: 'critical',
    headline:
      'This query does ~600× more work than the result needs — Oracle guessed 32 matching orders, but 20,000 matched.',
    detail:
      'One row comes back, yet the database touched 125,893 blocks to produce it. The root cause is a bad row estimate that picked the wrong join strategy.',
    statChips: ['0.15 s runtime', '125,893 buffer gets', 'est. 32 vs actual 20,000 rows · 625×'],
  },

  narrativeParagraphs: [
    'Your query filters ORDERS by three columns — country, currency and language — then joins each matching order to its line items. Oracle planned this as if the three filters were independent: it multiplied their individual selectivities and predicted only 32 orders would survive the WHERE clause. In reality those columns move together — a country largely implies a currency and a language — and 20,000 orders matched: a 625× underestimate on the {{4|full scan of ORDERS}}.',
    'That one estimate decided everything else. Expecting a handful of orders, Oracle chose {{3|NESTED LOOPS}} — a look-up-line-items-one-order-at-a-time strategy that is perfect for 32 orders and terrible for 20,000.',
    'The result: the {{5|index on ORDER_ITEMS}} was probed 20,000 times and the {{6|ORDER_ITEMS table}} was visited 80,000 times. Nearly all of the 125,893 block reads come from repeating that per-order lookup.',
    'The good news: this is a statistics problem, not a query problem. Give Oracle a column-group statistic on the three filter columns and it will see the correlation, estimate ~20,000 rows, and switch to a HASH JOIN that reads each table once.',
  ],

  findings: [
    {
      id: 'f1',
      severity: 'critical',
      source: 'advisor',
      title: 'Row estimate off by 625× on the ORDERS scan',
      nodeRefs: [{ id: 4, label: 'full scan of ORDERS' }],
      explanation:
        'Oracle estimated 32 rows from ORDERS; 20,000 came out. Estimates this far off cascade into wrong join methods and wrong join order.',
      evidence: [
        { label: 'Estimated rows', value: '32' },
        { label: 'Actual rows', value: '20,000' },
        { label: 'Mis-estimate', value: '625×' },
        { label: 'Buffer gets', value: '125,893' },
      ],
      actionIndex: 0,
    },
    {
      id: 'f2',
      severity: 'critical',
      source: 'advisor',
      title: 'Row-by-row join repeated 20,000 times',
      nodeRefs: [
        { id: 3, label: 'NESTED LOOPS' },
        { id: 5, label: 'index probe' },
        { id: 6, label: 'table lookup' },
      ],
      explanation:
        'NESTED LOOPS started the ORDER_ITEMS index probe 20,000 times and fetched 80,000 rows one at a time. A HASH JOIN would read ORDER_ITEMS once.',
      evidence: [
        { label: 'Index probes', value: '20,000' },
        { label: 'Rows fetched', value: '80,000' },
        { label: 'Buffer gets', value: '125,893' },
        { label: 'Runtime', value: '0.15 s' },
      ],
      actionIndex: 0,
    },
    {
      id: 'f3',
      severity: 'warning',
      source: 'ai',
      title: "Your three filters are correlated — Oracle assumes they're independent",
      nodeRefs: [{ id: 4, label: 'full scan of ORDERS' }],
      explanation:
        'SHIP_COUNTRY, SHIP_CURRENCY and SHIP_LANGUAGE move together in real data. Without a column-group statistic Oracle multiplies their selectivities and drastically underestimates matches. This is the root cause behind the other findings.',
      evidence: [
        { label: 'Filter columns', value: '3' },
        { label: 'Estimated rows', value: '32' },
        { label: 'Actual rows', value: '20,000' },
        { label: 'Mis-estimate', value: '625×' },
      ],
      actionIndex: 0,
    },
    {
      id: 'f4',
      severity: 'info',
      source: 'advisor',
      title: 'Full table scan on ORDERS',
      nodeRefs: [{ id: 4, label: 'full scan of ORDERS' }],
      explanation:
        'Every row of ORDERS is read to apply your filters. With 20,000 matching rows that is actually reasonable — fixing the join matters more than adding an index here.',
      evidence: [
        { label: 'Actual rows', value: '20,000' },
        { label: 'Buffer gets', value: '125,893' },
      ],
    },
  ],

  actions: [
    {
      title: 'Create a column-group statistic so Oracle sees the correlation',
      body:
        'This is the durable fix — it corrects the estimate itself, so the optimizer picks the right plan on its own.',
      sql: ACTION_1_SQL,
      effortChip: '5 min · low risk',
    },
    {
      title: 'Re-run and confirm the plan flipped to HASH JOIN',
      body:
        'After regathering, the ORDERS estimate should be close to 20,000 and the two NESTED LOOPS steps should become a single HASH JOIN.',
      effortChip: '2 min',
    },
    {
      title: "Stopgap if you can't touch statistics: force the join",
      body:
        'A hint is a patch, not a fix — it hardcodes today’s best plan even if the data changes.',
      sql: 'SELECT /*+ USE_HASH(o i) */ o.ship_country, ...',
      effortChip: '1 min · temporary',
    },
  ],

  builderPreview: {
    title: 'Reproducible test case',
    creditChip: '1 credit',
    rungs: [
      { id: 'F0', label: 'Sketch', state: 'reached' },
      { id: 'F1', label: 'Skeleton', state: 'current' },
      { id: 'F2', label: 'Faithful', state: 'locked' },
      { id: 'F3', label: 'Skew-Faithful', state: 'locked' },
    ],
    copy:
      "With what's attached now, your repro would reach **F1 · Skeleton** — synthetic tables matching your plan's shape, ready to run on any scratch DB. Attach the stats bundle to reach F2 · Faithful (real row counts & column stats).",
    files: ['setup.sql', 'repro.sql', 'verify.sql'],
    footnote: 'Runs on your own test database — the repro never needs your data.',
    buttonLabel: 'Build test case',
  },

  quotaChip: 'Free analysis · 2 of 3 left',
  deepAnalysisChip: 'Go deeper · ¼ credit',
};
