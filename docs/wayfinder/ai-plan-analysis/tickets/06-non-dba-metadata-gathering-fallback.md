---
title: Non-DBA metadata gathering fallback
labels: [wayfinder:research]
status: closed
assignee: research-agent
blocked-by: []
---

## Question

How much of the metadata bundle (incl. v3 histogram endpoints) can a non-privileged user gather from `ALL_*`/`USER_*` views, and what does the fallback gather script look like?

The current `scripts/gather_plan_metadata.sql` reads DBA_* views; the target customer is a non-expert dev who may only have object privileges. Research against Oracle 19c/23ai documentation (primary sources):

- for each bundle section (table/index stats, columns, DDL via DBMS_METADATA, constraints, histograms via DBA_TAB_HISTOGRAMS, optimizer_env), the ALL_*/USER_* equivalent and its privilege requirements;
- what is genuinely unavailable without DBA/SELECT_CATALOG_ROLE (e.g. optimizer env of another session, V$ access) and how the bundle should degrade — tie into the [repro fidelity ladder](05-repro-fidelity-ladder.md) levels;
- whether `DBMS_STATS.REPORT_*`/dictionary alternatives close any gaps;
- privileges commonly granted to app-dev accounts (baseline assumption to state in the spec).

Findings → `../research/non-dba-gather.md` with a per-section availability matrix. Live verification on dbmint (skill `dbmint-oracle-test`) is a follow-up for the implementing session, not this ticket. Resolve with the fallback strategy recommendation.

## Resolution

Full findings, with per-section matrix and primary-source citations, in
[`../research/non-dba-gather.md`](../research/non-dba-gather.md). Documentation
only (Oracle 19c Database Reference / PL/SQL Packages / SQL Tuning Guide /
Security Guide, spot-checked against 23ai); no live database was contacted.

**Headline: the privilege objection to v3 histograms does not survive the docs.**
`DBA_TAB_HISTOGRAMS` "columns are the same as those in `ALL_TAB_HISTOGRAMS`",
and the `ALL_` view covers every table the user can access — so
`ENDPOINT_NUMBER` / `ENDPOINT_VALUE` / `ENDPOINT_ACTUAL_VALUE_RAW` /
`ENDPOINT_REPEAT_COUNT` are all reachable by a `CONNECT`-only developer. v3
stays in v1 scope.

**What degrades, and how far.** Table stats, column stats, constraints,
extended stats, index stats, partitioning and physical attributes are all
column-identical in `ALL_*` ("accessible to the current user"), and the script
already auto-falls-back on `ORA-00942`. Only four things genuinely break:

1. **Object resolution from a `SQL_ID`** — `V$SQL_PLAN` needs an explicit
   grant. This, not the statistics, is what stops a non-DBA first.
2. **`segment.bytes`** for objects the user does not own — there is no
   `ALL_SEGMENTS` (the reference page 404s); `USER_SEGMENTS` only.
3. **`ddl`** for objects the user does not own — `DBMS_METADATA` needs
   `SELECT_CATALOG_ROLE` cross-schema.
4. **`optimizer_env` + `system_params.optimizer_*` + `sql_management`** —
   `V$`-only and `DBA_`-only respectively; no `ALL_`/`USER_` forms exist
   (`ALL_SQL_PLAN_BASELINES`, `ALL_SQL_PLAN_DIRECTIVES` both 404), and
   `DBMS_UTILITY.GET_PARAMETER_VALUE` is not a side door (needs `SELECT` on
   `V$PARAMETER`, deprecated since 12.2).

**Recommendation — one capability-probed script, not a non-DBA fork:**

1. Probe privileges once at start-up and emit a bundle-level `capabilities`
   object next to `coverage_warnings`, so the consumer reads privilege level as
   data instead of reverse-engineering it from free text.
2. Add v3 histograms from `{DBA|ALL|USER}_TAB_HISTOGRAMS`, gating presence on
   the `HISTOGRAM` column (the docs warn one-bucket rows mean "no histogram").
3. Close the object-resolution hole: owner-optional LIST mode resolved through
   `ALL_OBJECTS`, plus an `EXPLAIN PLAN` → `PLAN_TABLE` assisted route (all
   `PLAN_TABLE` privileges are granted to `PUBLIC`).
4. Substitute where possible (`db_block_size` from `USER_TABLESPACES`,
   `db_name` from `SYS_CONTEXT`, DDL synthesized from the dictionary), and emit
   `unavailable_reason: "insufficient_privilege"` where not — an empty array
   currently reads as "nothing to report".
5. Publish the optional `SELECT_CATALOG_ROLE` grant as an upgrade, never a
   requirement. Keep the gather in an anonymous PL/SQL block so that role is
   actually in effect (roles are disabled in definer's-rights units).

**Ladder tie-in (→ [05](05-repro-fidelity-ladder.md)):** privilege level and
ladder rung are near-orthogonal up to L3. A `CONNECT`-only developer reaches
L3 skew-faithful repro on tables they can `SELECT`; L2 has two null holes
(non-owned segment size, non-owned `GET_DDL` — the latter recoverable by
synthesizing DDL from the dictionary). The optimizer-environment rung is the
first genuinely unreachable one, so the ladder should carry a **privilege axis**
and the honesty contract must distinguish *absent* from *invisible* ("no SQL
profile found" ≠ "could not check for SQL profiles"). Baseline assumption to
state in the spec: connect + `SELECT` on the query's tables, no `DBA`, no
`SELECT ANY DICTIONARY`, no `SELECT_CATALOG_ROLE`.

Seven dbmint verification items are listed in §8 of the research file for the
implementing session — including a real revoked-privilege run, since several
`WHEN OTHERS` handlers in the current script can mask a non-DBA bug when a
DBA runs it.
