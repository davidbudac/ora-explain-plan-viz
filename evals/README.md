# Evaluation & backtesting harness

Backtests for the AI test-case builder and analysis features (plan doc:
`docs/plans/ai-plan-analysis.md`, Phase 2.5) against a **real, existing Oracle
database** — no Docker involved. Plain Node + TypeScript via `tsx`, DB access
via the `oracledb` package in thin mode (no Instant Client needed). Nothing in
this directory ships in the Vite build.

## Safety — read first

The harness **DROPs every `EVAL_`-prefixed object in the connected schema** at
the start and end of each scenario, and creates its own `EVAL_*` tables,
indexes and constraints. The connection MUST point at a **dedicated scratch
schema** used for nothing else. Never point it at a schema holding real data.

## Setup

Create a scratch schema (as a DBA):

```sql
CREATE USER eval_scratch IDENTIFIED BY "..." QUOTA UNLIMITED ON users;
GRANT CREATE SESSION, CREATE TABLE TO eval_scratch;
```

That is all the harness needs: `CREATE SESSION`, `CREATE TABLE` (covers the
indexes and constraints on its own tables) and tablespace quota. `EXPLAIN PLAN`,
`DBMS_XPLAN.DISPLAY`, `DBMS_STATS` and `UTL_RAW` are available to any user by
default. A private `PLAN_TABLE` is not required on 10g+ (the global temporary
`PLAN_TABLE$` synonym is used), but creating one via `utlxplan.sql` also works.

## Environment variables

| Variable | Meaning |
|---|---|
| `ORA_EVAL_USER` | scratch schema user (e.g. `eval_scratch`) |
| `ORA_EVAL_PASSWORD` | its password |
| `ORA_EVAL_CONNECT` | EZConnect string, e.g. `dbhost:1521/FREEPDB1` |
| `ANTHROPIC_API_KEY` | Layer 3 only (`eval:analyze`) |
| `ORA_EVAL_MODEL` | Layer 3 model override (default `claude-opus-5`) |

## Running

```bash
# Layer 2 — repro fidelity: does the deterministic test-case script make the
# optimizer reproduce the original plan shape in the same (emptied) schema?
npm run eval:repro                       # all scenarios
npm run eval:repro -- 01 03              # filter by name substring
npm run eval:repro -- --run-id my-run    # explicit results file name

# Layer 3 — analysis quality (calls the Anthropic API):
npm run eval:analyze
npm run eval:analyze -- --run-id nightly 04
```

Results land in `evals/results/<runId>.json` (repro) and
`evals/results/<runId>-analyze.json`; a summary table (repro rate overall and
per tag; hard-check + root-cause columns) is printed to the terminal. The
repro runner exits non-zero when any scenario's plan shape fails to match.

## Unit tests (no DB, no network)

```bash
npx vitest run --environment jsdom evals
```

Covers the pure pieces: the SQL*Plus script splitter (`splitSqlScript`),
plan-shape normalization (`planShape`/`shapesMatch`) and scenario-corpus
validation. `oracledb` is imported lazily inside the connect/run functions, so
these tests never load the driver.

## Layout

```
evals/
├── lib/
│   ├── db.ts        # connect (lazy oracledb, thin), splitSqlScript, runScript, dropEvalObjects
│   ├── explain.ts   # EXPLAIN PLAN + DBMS_XPLAN.DISPLAY capture, EVAL_ table listing
│   ├── gather.ts    # gatherBundle: minimal v3 ora-plan-metadata bundle from user_* views
│   ├── planShape.ts # normalized plan-shape comparison (pure)
│   └── scenarios.ts # scenario corpus loader (pure)
├── scenarios/NN-name/{setup.sql,query.sql,expect.json}
├── run.ts           # Layer 2 repro-fidelity runner
├── analyze.ts       # Layer 3 analysis-quality skeleton (LLM judge: TODO)
├── results/         # <runId>.json outputs (gitignored artifacts of local runs)
└── __tests__/       # pure unit tests, picked up by the repo's default vitest run
```

## Adding a scenario

Create `evals/scenarios/NN-name/` with the three files. Rules:

- every object name starts with `EVAL_`;
- no SQL*Plus `EXEC` — use `BEGIN ... END;` + `/` blocks (the splitter skips
  SQL*Plus-only lines);
- `query.sql` holds exactly one SELECT statement;
- `expect.json`: `{ "tags": [...], "rootCause": "...", "planFeatures": [...] }`
  — `planFeatures` are substrings the analysis report must mention (e.g.
  `"TABLE ACCESS FULL"`).

The scenario-loader unit test validates all of this automatically.
