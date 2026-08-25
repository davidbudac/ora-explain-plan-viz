# Non-DBA metadata gathering fallback

Research for ticket
[`06-non-dba-metadata-gathering-fallback`](../tickets/06-non-dba-metadata-gathering-fallback.md).

**Question.** How much of the metadata bundle (including the planned v3
histogram endpoints) can a non-privileged user gather from `ALL_*` / `USER_*`
views, and what does the fallback gather script look like?

**Method.** Two passes. (1) Source inventory: every dictionary view and column
`scripts/gather_plan_metadata.sql` reads today, taken from the file itself.
(2) Documentation pass: each view checked against the Oracle Database
Reference for 19c (23ai spot-checked for deltas) via `docs.oracle.com`. No
database was contacted — the ticket scopes live verification on `dbmint` to
the implementing session. Every "unavailable" claim below rests on a quoted
doc sentence or on a 404 for the `ALL_`-prefixed reference page, not on recall.

**Headline.** The single highest-value rung — v3 histogram endpoints — needs
no DBA privilege at all: `ALL_TAB_HISTOGRAMS` has **the same columns** as
`DBA_TAB_HISTOGRAMS` and covers every table the user can access. Nearly the
whole per-object bundle degrades cleanly. What genuinely breaks for a
non-privileged user is **not** the statistics; it is (a) resolving *which*
objects a `SQL_ID` touches, (b) segment sizes for objects the user does not
own, (c) optimizer environment and system parameters, and (d) the SQL
management section (baselines / profiles / patches / directives).

---

## 1. What the bundle reads today

From `scripts/gather_plan_metadata.sql` (v2 bundle; line numbers as of this
research). The script *already* auto-degrades `DBA_*` → `ALL_*` on `ORA-00942`
for most sections — `probe_dba_view` (l.282) plus per-section `g_use_dba_*`
flags (l.97–103) that flip and re-enter the writer procedure.

| Bundle field | Procedure | Views read today |
| --- | --- | --- |
| `objects[].stats` (num_rows, blocks, avg_row_len, last_analyzed, stale_stats) | `write_table_stats` l.428 | `{DBA\|ALL}_TAB_STATISTICS` |
| `objects[].stats.partition*` | `write_table_stats` l.467–521, `js_part_key_cols` l.247 | `{DBA\|ALL}_TABLES`, `{DBA\|ALL}_TAB_PARTITIONS`, `{DBA\|ALL}_PART_TABLES`, `{DBA\|ALL}_PART_KEY_COLUMNS`, `{DBA\|ALL}_SUBPART_KEY_COLUMNS` |
| `objects[].physical` (compression, compress_for, degree, temporary, cluster_name, iot_type, cache) | `write_table_physical` l.689 | `{DBA\|ALL}_TABLES` |
| `objects[].segment` (bytes, extents) | `write_segment` l.634 | `DBA_SEGMENTS` → `USER_SEGMENTS` (own schema only) |
| `objects[].columns.*` (data_type, nullable, num_distinct, num_nulls, low_value, high_value, density, histogram type + buckets, virtual, hidden) | `write_columns` l.545 | `{DBA\|ALL}_TAB_COLS` |
| `objects[].constraints` (PK/UK/FK/CHECK, incl. `search_condition_vc`) | `write_constraints` l.735 | `{DBA\|ALL}_CONSTRAINTS`, `{DBA\|ALL}_CONS_COLUMNS` |
| `objects[].extended_stats` | `write_extended_stats` l.967 | `{DBA\|ALL}_STAT_EXTENSIONS` + `{DBA\|ALL}_TAB_COLS` |
| `objects[].indexes` list | `write_indexes_list` l.1022 | `{DBA\|ALL}_INDEXES` |
| index objects (uniqueness, index_type, status, visibility, blevel, leaf_blocks, distinct_keys, clustering_factor, num_rows, avg_leaf/data_blocks_per_key, last_analyzed, degree, compression, columns, locality) | `write_index_object` l.1060 | `{DBA\|ALL}_INDEXES`, `{DBA\|ALL}_IND_COLUMNS`, `{DBA\|ALL}_PART_INDEXES` |
| `objects[].ddl` | `get_object_ddl` l.199 | `DBMS_METADATA.GET_DDL` |
| object resolution (SQL_ID mode) | `resolve_objects_for_sql_id` l.386 | `V$SQL_PLAN`, then `DBA_HIST_SQL_PLAN` |
| `source.db_name` / `oracle_version` | main block l.1634–1650 | `V$DATABASE`, `PRODUCT_COMPONENT_VERSION`, `SYS_CONTEXT('USERENV','CON_NAME')` |
| `system_params` (db_block_size, optimizer_features_enable, optimizer_index_cost_adj, optimizer_index_caching) | `write_system_params` l.1266 | `V$PARAMETER` |
| `optimizer_env[]` | `write_optimizer_env` l.1304 | `V$SQL`, `V$SQL_OPTIMIZER_ENV` |
| `sql_management` (baselines, profiles, patches, directives) | `write_sql_management` l.1357 | `V$SQL`, `DBA_SQL_PLAN_BASELINES`, `DBA_SQL_PROFILES`, `DBA_SQL_PATCHES`, `DBA_SQL_PLAN_DIRECTIVES`, `DBA_SQL_PLAN_DIR_OBJECTS` |

Consumer side (`src/lib/metadata/bundle.ts`): `SUPPORTED_BUNDLE_VERSIONS = [1, 2]`;
`HistogramInfo` today is `{ type, buckets }` only — **no endpoint array exists
yet**, confirming that "v3 histograms" is prospective, not a regression risk.
`src/lib/metadata/gatherScript.ts` already stamps two target modes
(`sqlid` and `manual` LIST), and `manualList.ts` parses `OWNER.OBJECT` tokens —
so a LIST-mode fallback is an existing, tested rail, not new machinery.

---

## 2. Baseline privilege assumption for the target user

The spec should state this assumption explicitly:

> The target user can connect, can `SELECT` the tables their query touches,
> and has **no** `DBA` role, **no** `SELECT ANY DICTIONARY`, and **no**
> `SELECT_CATALOG_ROLE`. They may or may not own the tables.

Grounding:

- `CONNECT` grants only `CREATE SESSION` (and `SET CONTAINER` from 12.1) —
  "Beginning in Oracle Database 10g Release 2, the `CONNECT` role has only the
  `CREATE SESSION` privilege, all other privileges are removed. Starting with
  Oracle Database 12c Release 1, the `CONNECT` role had the `CREATE SESSION`
  and `SET CONTAINER` privileges."
  ([19c Security Guide, Addressing the CONNECT Role Change](https://docs.oracle.com/en/database/oracle/oracle-database/19/dbseg/addressing-connect-role-change.html))
  So a `CONNECT`/`RESOURCE` app account has **zero** dictionary privilege
  beyond the automatic `USER_*` / `ALL_*` access.
- `USER_*` views: "displays all the information from the schema of the current
  user. **No special privileges are required to query these views.**"
- `ALL_*` views: "displays all the information accessible to the current user,
  including information from the current user's schema as well as information
  from objects in other schemas, **if the current user has access to those
  objects by way of grants of privileges or roles**."
- `DBA_*` views "can be queried only by users with" `SYSDBA`,
  `SELECT ANY DICTIONARY`, `SELECT_CATALOG_ROLE`, or direct grants.
  ([19c Database Reference, About Static Data Dictionary Views](https://docs.oracle.com/en/database/oracle/oracle-database/19/refrn/about-static-data-dictionary-views.html);
  wording is unchanged in
  [23ai](https://docs.oracle.com/en/database/oracle/oracle-database/23/refrn/about-static-data-dictionary-views.html))
- `V$` views: "After installation, only user `SYS` or anyone with `SYSDBA`
  privilege has access to the dynamic performance tables." `V$` names are
  public synonyms for `V_$` views; access comes from explicit grants (in
  practice `SELECT_CATALOG_ROLE`). In a CDB, `V$` views are additionally
  `CONTAINER_DATA` objects.
  ([19c Database Reference, About Dynamic Performance Views](https://docs.oracle.com/en/database/oracle/oracle-database/19/refrn/about-dynamic-performance-views.html))

One favourable subtlety worth keeping: the gather script runs as an
**anonymous PL/SQL block**, where roles *are* enabled. "Named PL/SQL blocks
that execute with invoker's rights and anonymous PL/SQL blocks are executed
based on privileges granted through enabled roles"; roles are disabled only in
definer's-rights named units.
([19c Security Guide, Role Privileges and Secure Application Roles](https://docs.oracle.com/en/database/oracle/oracle-database/19/dbseg/role-privileges-and-secure-application-roles.html))
So a user who *does* hold `SELECT_CATALOG_ROLE` gets full fidelity without
extra plumbing, and the same file serves both audiences. Do not move the
gather into a packaged procedure — that would silently drop `SELECT_CATALOG_ROLE`
and the cross-schema `DBMS_METADATA` path with it.

---

## 3. Per-section availability matrix

Legend — **Full**: `ALL_*` has the same columns and covers any table the user
can `SELECT`. **Own-schema**: only via `USER_*`, so only for objects the
connected schema owns. **DBA-only**: no `ALL_`/`USER_` form exists.

| Bundle section | View today | Non-DBA equivalent | Verdict | Notes / doc evidence |
| --- | --- | --- | --- | --- |
| Table stats | `DBA_TAB_STATISTICS` | `ALL_TAB_STATISTICS` / `USER_TAB_STATISTICS` | **Full** | "displays optimizer statistics for the tables accessible to the current user"; same columns (`NUM_ROWS`, `BLOCKS`, `AVG_ROW_LEN`, `LAST_ANALYZED`, `STALE_STATS`, `OBJECT_TYPE`). [ref](https://docs.oracle.com/en/database/oracle/oracle-database/19/refrn/ALL_TAB_STATISTICS.html) |
| Partition flag / method / keys | `DBA_TABLES`, `DBA_TAB_PARTITIONS`, `DBA_PART_TABLES`, `DBA_{SUB}PART_KEY_COLUMNS` | `ALL_*` for all five | **Full** | Already implemented as the `g_use_dba_part` fallback (l.474–519, l.260–262). |
| Table physical attrs | `DBA_TABLES` | `ALL_TABLES` | **Full** | "describes the relational tables accessible to the current user"; `COMPRESSION`, `COMPRESS_FOR`, `DEGREE`, `TEMPORARY`, `CLUSTER_NAME`, `IOT_TYPE`, `CACHE`, `PARTITIONED` all present. [ref](https://docs.oracle.com/en/database/oracle/oracle-database/19/refrn/ALL_TABLES.html) |
| Column stats | `DBA_TAB_COLS` | `ALL_TAB_COLS` / `USER_TAB_COLS` | **Full** | "describes the columns of the tables, views, and clusters accessible to the current user"; includes `NUM_DISTINCT`, `LOW_VALUE`, `HIGH_VALUE`, `DENSITY`, `NUM_NULLS`, `NUM_BUCKETS`, `HISTOGRAM`, `VIRTUAL_COLUMN`, `HIDDEN_COLUMN`, `INTERNAL_COLUMN_ID`. Differs from `ALL_TAB_COLUMNS` in that "system-generated hidden columns are not filtered out" — which the extended-stats join needs. [ref](https://docs.oracle.com/en/database/oracle/oracle-database/19/refrn/ALL_TAB_COLS.html) |
| **Histogram endpoints (v3)** | *(not read yet)* — would be `DBA_TAB_HISTOGRAMS` | `ALL_TAB_HISTOGRAMS` / `USER_TAB_HISTOGRAMS` | **Full** | "`DBA_TAB_HISTOGRAMS` … Its columns are the same as those in `ALL_TAB_HISTOGRAMS`." `ALL_` carries `ENDPOINT_NUMBER`, `ENDPOINT_VALUE`, `ENDPOINT_ACTUAL_VALUE`, `ENDPOINT_ACTUAL_VALUE_RAW`, `ENDPOINT_REPEAT_COUNT`, `SCOPE`. Identical in 23ai. [19c](https://docs.oracle.com/en/database/oracle/oracle-database/19/refrn/ALL_TAB_HISTOGRAMS.html) · [23ai](https://docs.oracle.com/en/database/oracle/oracle-database/23/refrn/ALL_TAB_HISTOGRAMS.html) |
| Constraints | `DBA_CONSTRAINTS` + `DBA_CONS_COLUMNS` | `ALL_CONSTRAINTS` + `ALL_CONS_COLUMNS` | **Full** | "describes constraint definitions on tables accessible to the current user"; `SEARCH_CONDITION_VC` present. All three prefixes have identical column structures. [ref](https://docs.oracle.com/en/database/oracle/oracle-database/19/refrn/ALL_CONSTRAINTS.html) |
| FK target resolution | `DBA_CONSTRAINTS` by `r_owner`/`r_constraint_name` | `ALL_CONSTRAINTS` | **Partial** | Works only if the *referenced* table is also accessible to the user. A FK to a table they cannot `SELECT` yields `ref_table: null` + `ref_columns: []` (already handled by `resolve_fk_target` l.795, but today it fails silently — it should warn). |
| Extended stats | `DBA_STAT_EXTENSIONS` | `ALL_STAT_EXTENSIONS` / `USER_STAT_EXTENSIONS` | **Full** | "displays information about the optimizer statistics extensions accessible to the current user". [ref](https://docs.oracle.com/en/database/oracle/oracle-database/19/refrn/ALL_STAT_EXTENSIONS.html) |
| Index list + index stats | `DBA_INDEXES`, `DBA_IND_COLUMNS`, `DBA_PART_INDEXES` | `ALL_INDEXES`, `ALL_IND_COLUMNS`, `ALL_PART_INDEXES` | **Full** | "`ALL_INDEXES` describes the indexes on the tables accessible to the current user" — note the scope is *tables*, not *indexes owned*, so cross-schema indexes on a readable table are visible. `CLUSTERING_FACTOR`, `BLEVEL`, `LEAF_BLOCKS`, `DISTINCT_KEYS`, `NUM_ROWS`, `AVG_LEAF_BLOCKS_PER_KEY`, `AVG_DATA_BLOCKS_PER_KEY`, `VISIBILITY`, `DEGREE`, `COMPRESSION`, `LAST_ANALYZED` all present. [ref](https://docs.oracle.com/en/database/oracle/oracle-database/19/refrn/ALL_INDEXES.html) |
| Segment size | `DBA_SEGMENTS` | `USER_SEGMENTS` only — **there is no `ALL_SEGMENTS`** (`refrn/ALL_SEGMENTS.html` → HTTP 404) | **Own-schema** | "`USER_SEGMENTS` describes the storage allocated for the segments owned by the current user's objects." [ref](https://docs.oracle.com/en/database/oracle/oracle-database/19/refrn/USER_SEGMENTS.html) Already the script's behaviour (l.657–675). |
| DDL | `DBMS_METADATA.GET_DDL` | same call, own schema only | **Own-schema** | Nonprivileged users can retrieve metadata for their own schema objects with no special role; "To retrieve metadata for objects in other schemas, you need `SELECT_CATALOG_ROLE` … or be connected as `SYS`". [ref](https://docs.oracle.com/en/database/oracle/oracle-database/19/arpls/DBMS_METADATA.html) The script already downgrades the failure to a coverage warning (l.212–218). |
| Object resolution from `SQL_ID` | `V$SQL_PLAN` → `DBA_HIST_SQL_PLAN` | **none** | **DBA-only** | `V$` needs an explicit grant; `DBMS_XPLAN.DISPLAY_CURSOR` documents exactly the same requirement — `GRANT SELECT ON V_$SESSION / V_$SQL / V_$SQL_PLAN / V_$SQL_PLAN_STATISTICS_ALL`. `DISPLAY_AWR` additionally needs `DBA_HIST_SQL_PLAN` + `DBA_HIST_SQLTEXT` + `V$DATABASE`. [ref](https://docs.oracle.com/en/database/oracle/oracle-database/19/arpls/DBMS_XPLAN.html) **See §4 for the workaround — this is the real blocker.** |
| `source.db_name` | `V$DATABASE` | none | **DBA-only** | Cosmetic; already null-tolerant (l.1638–1640). `SYS_CONTEXT('USERENV','CON_NAME')` and `'DB_NAME'` need no privilege and cover most of the intent. |
| `source.oracle_version` | `PRODUCT_COMPONENT_VERSION` | same | **Likely full** | Documented as a plain static view with `VERSION` / `VERSION_FULL`; no privilege note. [ref](https://docs.oracle.com/en/database/oracle/oracle-database/19/refrn/PRODUCT_COMPONENT_VERSION.html) *Flagged for dbmint verification* — it is `V$VERSION`-backed in modern releases. |
| `system_params.db_block_size` | `V$PARAMETER` | `USER_TABLESPACES.BLOCK_SIZE` | **Full (via substitute)** | "`USER_TABLESPACES` describes the tablespaces accessible to the current user"; columns are the same as `DBA_TABLESPACES` except `PLUGGED_IN`, and `DBA_TABLESPACES.BLOCK_SIZE` is "Tablespace block size (in bytes)". Take the block size of the tablespace holding the plan's objects (or the user's default tablespace) rather than the instance default. [ref](https://docs.oracle.com/en/database/oracle/oracle-database/19/refrn/USER_TABLESPACES.html) |
| `system_params.optimizer_*` | `V$PARAMETER` | **none** | **DBA-only** | `DBMS_UTILITY.GET_PARAMETER_VALUE` is *not* a way around it: "To execute the this function, you must have the `SELECT` privilege on the V$PARAMETER dynamic view", and it is deprecated since 12.2. [ref](https://docs.oracle.com/en/database/oracle/oracle-database/19/arpls/DBMS_UTILITY.html) |
| `optimizer_env[]` | `V$SQL` + `V$SQL_OPTIMIZER_ENV` | **none** | **DBA-only** | "`V$SQL_OPTIMIZER_ENV` displays the contents of the optimizer environment used to build the execution plan of a SQL cursor." Session/system siblings (`V$SES_OPTIMIZER_ENV`, `V$SYS_OPTIMIZER_ENV`) are equally `V$`. [ref](https://docs.oracle.com/en/database/oracle/oracle-database/19/refrn/V-SQL_OPTIMIZER_ENV.html) |
| `sql_management` | `DBA_SQL_PLAN_BASELINES`, `DBA_SQL_PROFILES`, `DBA_SQL_PATCHES`, `DBA_SQL_PLAN_DIRECTIVES`, `DBA_SQL_PLAN_DIR_OBJECTS` | **none** — `refrn/ALL_SQL_PLAN_BASELINES.html` and `refrn/ALL_SQL_PLAN_DIRECTIVES.html` both → HTTP 404 | **DBA-only** | These views exist only with the `DBA_` prefix in 19c. Partial consolation: `DBMS_XPLAN.DISPLAY_SQL_PLAN_BASELINE` still requires `SELECT`/`READ` on `DBA_SQL_PLAN_BASELINES`, so there is no package-level side door. |

### Deltas checked against 23ai

`ALL_TAB_HISTOGRAMS` (columns and description) and the static-dictionary
prefix/privilege rules are byte-for-byte the same in the 23ai Database
Reference. No 23ai feature was found that widens non-DBA dictionary access.
Treat the matrix as version-independent for 19c → 23ai.

---

## 4. The real blocker: resolving *which* objects the plan touches

Everything in §3 assumes the script already knows the `OWNER.OBJECT` list.
In `SQL_ID` mode it learns that from `V$SQL_PLAN` — which a non-DBA cannot
read. This, not the statistics, is what breaks the non-DBA flow first.

Three viable paths, in preference order:

1. **Derive the list in the app and stamp a LIST-mode script.** The visualizer
   has already parsed the plan; `gatherScript.ts` already supports
   `{ mode: 'manual', objectList }`. Gap: the parsers capture only
   `objectName` (`src/lib/types.ts:10`; `dbmsXplanParser.ts:390`,
   `sqlMonitorParser.ts:361`, `xbiParser.ts:304`), never an owner — DBMS_XPLAN's
   `Name` column does not carry one. Fix on the script side, not the app side:
   let LIST mode accept a bare `OBJECT` and resolve the owner through
   `ALL_OBJECTS` (accessible to the current user by definition — same `ALL_`
   semantics as §2), preferring `SYS_CONTEXT('USERENV','CURRENT_SCHEMA')`, then
   a unique accessible match, and emitting a coverage warning on ambiguity.
   This makes the whole non-DBA path work with **zero** dictionary grants.
2. **`EXPLAIN PLAN` into `PLAN_TABLE`.** If the user has the SQL text, they can
   re-explain it: "Oracle Database automatically creates a global temporary
   table `PLAN_TABLE$` in the `SYS` schema, and creates `PLAN_TABLE` as a
   synonym. **All necessary privileges to `PLAN_TABLE` are granted to
   `PUBLIC`.**" `EXPLAIN PLAN` itself needs only the privileges to run the
   statement plus insert/query on the output table.
   ([19c SQL Tuning Guide, Generating and Displaying Execution Plans](https://docs.oracle.com/en/database/oracle/oracle-database/19/tgsql/generating-and-displaying-execution-plans.html))
   `PLAN_TABLE.OBJECT_OWNER` / `OBJECT_NAME` then give an owner-qualified list
   for free. Caveat to state honestly: the re-explained plan is produced in
   *this* session's environment with unpeeked binds, so it may differ from the
   captured plan — it is being used only as an object-name oracle, which is
   safe, but the script should not silently swap it for the real plan.
3. **Ask the user.** Existing LIST mode with typed `OWNER.OBJECT` names — the
   current answer, and the one the coverage warning at l.388–390 already
   points at.

---

## 5. Alternatives evaluated and rejected

- **`DBMS_STATS.REPORT_*`.** `REPORT_COL_USAGE` "reports the recorded column
  (group) usage information" — column *usage* for extended-stats candidates,
  not table/column/histogram statistics. `REPORT_STATS_OPERATIONS` and the
  Optimizer Statistics Advisor reports require the `ADVISOR` privilege and
  return human-readable text, not machine-parseable stats. None of them closes
  a gap in the matrix.
  ([19c DBMS_STATS](https://docs.oracle.com/en/database/oracle/oracle-database/19/arpls/DBMS_STATS.html))
- **`DBMS_STATS.CREATE_STAT_TABLE` + `EXPORT_TABLE_STATS`.** Genuinely
  interesting: it "retrieves statistics for a specified table (including
  associated index statistics) and stores them in the user statistics table
  identified by `stattab`" — histograms included — and the stat table lives in
  the user's own schema. But it buys nothing the `ALL_*` views do not already
  give (which is now everything except segments), it writes a schema object
  (a hard sell for a read-only "paste this into SQL*Plus" script), and its
  cross-schema privilege story is exactly the ambiguity we are trying to avoid.
  **Rejected for the gather path.** It stays relevant on the *replay* side
  (§6): `SET_TABLE_STATS` / `SET_COLUMN_STATS` with an `SREC` are how the
  repro script reinstates skew, and there the sandbox schema owns the tables,
  so privileges are never the issue.
- **`DBMS_UTILITY.GET_PARAMETER_VALUE`** for optimizer parameters — requires
  `SELECT` on `V$PARAMETER` and is deprecated. Rejected (§3).
- **A second, separate "non-DBA" script.** Rejected on maintenance grounds —
  see §7.

---

## 6. Mapping to the repro fidelity ladder

Tying into [ticket 05](../tickets/05-repro-fidelity-ladder.md). The finding
that reshapes the ladder: **privilege level and ladder rung are close to
orthogonal up to L3.** A `CONNECT`-only developer who can `SELECT` their own
query's tables reaches L3 (skew-faithful) — they simply cannot reach the
optimizer-environment rung.

| Rung | Needs | Non-DBA reachable? | Degradation |
| --- | --- | --- | --- |
| L0 plan-only | parsed plan text | Yes — no DB contact | unchanged |
| L1 + SQL text | SQL text | Yes | unchanged |
| L2 + bundle v2 | table/column/index stats, constraints, DDL, partitioning | **Yes, with two holes**: `segment.bytes` null for non-owned objects; `ddl` null for non-owned objects (structure still reconstructible from `ALL_TAB_COLS` + `ALL_CONSTRAINTS` + `ALL_INDEXES` — the repro script can *synthesize* a `CREATE TABLE` instead of quoting `GET_DDL`) | mark synthesized DDL as "reconstructed, not `GET_DDL`" |
| L3 + bundle v3 histograms | `*_TAB_HISTOGRAMS` endpoints | **Yes, fully** — identical columns via `ALL_` | no degradation |
| L4 optimizer env (own rung) | `V$SQL_OPTIMIZER_ENV`, `V$PARAMETER` | **No** | falls back to `db_block_size` from `USER_TABLESPACES` + `optimizer_features_enable` inferred from `PRODUCT_COMPONENT_VERSION`; everything else declared "database defaults assumed" |
| L4+ SQL management context | `DBA_SQL_PLAN_*` | **No** | bundle omits the section; the report must not claim "no baseline/profile is in play" — only "not visible at this privilege level" |

This argues for the ladder to carry a **privilege axis** alongside the input
axis, and for the honesty contract to distinguish *absent* from *invisible*.
"No SQL profile found" and "could not check for SQL profiles" are different
promises, and a non-expert reading the report cannot tell them apart unless
the bundle says so.

---

## 7. Recommended fallback strategy

**One script, capability-probed, not a second non-DBA fork.** The existing
`ORA-00942` degradation ladder is the right shape and already covers most of
the matrix; forking would double the surface that `dbmint` e2e must verify and
would force the user to choose a script before knowing which one works.
Concretely, five changes:

1. **Probe once, up front; publish the result.** Run `probe_dba_view` for the
   handful of `DBA_` views at start-up plus a `V$SQL_PLAN` / `V$PARAMETER`
   probe, and emit a new bundle-level `capabilities` object
   (`{ dba_views, v_dollar, dba_segments, awr, dbms_metadata_cross_schema }`)
   alongside `coverage_warnings`. Today the consumer must reverse-engineer the
   privilege level from free-text warnings; the analysis layer and the fidelity
   ladder both need it as data. This is the one change that everything else in
   the AI-analysis feature depends on.
2. **Ship v3 histograms in v1 scope, sourced from `{DBA|ALL|USER}_TAB_HISTOGRAMS`.**
   The privilege objection to v3 does not survive the docs: the `ALL_` view is
   column-identical. Read `ENDPOINT_NUMBER`, `ENDPOINT_VALUE`,
   `ENDPOINT_ACTUAL_VALUE_RAW`, `ENDPOINT_REPEAT_COUNT`, and decode raw
   endpoints with the existing `decode_raw_value` helper (l.297). Gate the
   presence check on `*_TAB_COL_STATISTICS.HISTOGRAM` (or the `HISTOGRAM`
   column already read from `*_TAB_COLS`), because the docs warn the histogram
   view "may contain one-bucket histograms, which signify 'No histogram'. Do
   not query this view to determine histogram presence."
3. **Close the object-resolution hole** with owner-optional LIST mode resolved
   through `ALL_OBJECTS` (§4 path 1), and offer `EXPLAIN PLAN` + `PLAN_TABLE`
   (§4 path 2) as the assisted route when the user has the SQL text. Without
   this, a non-DBA never reaches L2 at all, no matter how good the `ALL_`
   coverage is.
4. **Substitute where a substitute exists, warn where none does.**
   `db_block_size` from `USER_TABLESPACES`; `db_name` from
   `SYS_CONTEXT('USERENV','DB_NAME')`; synthesized DDL from the dictionary when
   `GET_DDL` is refused. For `optimizer_env` and `sql_management`, emit an
   explicit `"unavailable_reason": "insufficient_privilege"` rather than an
   empty array — an empty array currently reads as "nothing to report".
5. **Publish the optional grant, do not require it.** Document a one-line
   `GRANT SELECT_CATALOG_ROLE TO <user>;` (or the narrower
   `GRANT SELECT ON V_$SQL_PLAN, V_$SQL, V_$SQL_OPTIMIZER_ENV, V_$PARAMETER`)
   as the "ask your DBA for full fidelity" upgrade, and have the app show which
   rungs it would unlock based on the probed `capabilities`. Keep the gather in
   an anonymous block so that role actually takes effect (§2).

Product framing to carry into the spec: **the non-DBA path is the default, not
the degraded path.** A `CONNECT`-only developer reaches skew-faithful repro
(L3) on their own tables. What they cannot have is the optimizer environment
and the SQL-management context — and the honest wording for that is
"invisible at your privilege level", never "not present".

---

## 8. Follow-ups for the implementing session (live verification on `dbmint`)

None of the below is doubted on documentation grounds; each is a behaviour the
docs do not fully pin down. Use the `dbmint-oracle-test` skill.

1. Create a `CONNECT`-only test user with `SELECT` on the `PLANVIZ` livetest
   tables (and *not* on their owner's schema wholesale), then run the gather
   end-to-end and diff the bundle against a DBA-run bundle. Confirm the exact
   set of null fields.
2. Confirm `ALL_TAB_HISTOGRAMS` really returns endpoints for a table the user
   only has `SELECT` on (not owns), for all four histogram types
   (frequency, top-frequency, height-balanced, hybrid).
3. Confirm `ENDPOINT_ACTUAL_VALUE_RAW` decoding via
   `DBMS_STATS.CONVERT_RAW_VALUE` round-trips for `VARCHAR2`, `NUMBER`, `DATE`
   and `TIMESTAMP` columns, and that a `SET_COLUMN_STATS` replay reproduces the
   same `DENSITY` / plan.
4. Confirm `PRODUCT_COMPONENT_VERSION` is readable by the `CONNECT`-only user
   on 19c (it is `V$VERSION`-backed in modern releases and the doc says nothing
   about privileges).
5. Confirm the `ORA-00942` fallbacks actually fire: several `EXECUTE IMMEDIATE`
   sites swallow `WHEN OTHERS` before the `-942` check can reach the
   `g_use_dba_*` flag (e.g. `write_table_physical` l.712–714 and
   `js_part_key_cols` l.275–277 return silently), so a DBA-privileged run can
   mask a non-DBA bug. Test with the DBA views revoked, not simulated.
6. Confirm `ALL_OBJECTS`-based owner resolution behaves as expected for
   synonyms and for cross-schema name collisions.
7. Confirm the CDB/PDB `CONTAINER_DATA` behaviour of any `V$` probe when the
   user connects to a PDB (see the known PDB AWR-source split gotcha from the
   baseline feature).

---

## Sources

All Oracle Database 19c unless noted; 23ai pages checked where a delta was
plausible.

- [About Static Data Dictionary Views (19c)](https://docs.oracle.com/en/database/oracle/oracle-database/19/refrn/about-static-data-dictionary-views.html) ·
  [(23ai)](https://docs.oracle.com/en/database/oracle/oracle-database/23/refrn/about-static-data-dictionary-views.html)
- [About Dynamic Performance Views](https://docs.oracle.com/en/database/oracle/oracle-database/19/refrn/about-dynamic-performance-views.html)
- [ALL_TAB_HISTOGRAMS (19c)](https://docs.oracle.com/en/database/oracle/oracle-database/19/refrn/ALL_TAB_HISTOGRAMS.html) ·
  [(23ai)](https://docs.oracle.com/en/database/oracle/oracle-database/23/refrn/ALL_TAB_HISTOGRAMS.html) ·
  [DBA_TAB_HISTOGRAMS](https://docs.oracle.com/en/database/oracle/oracle-database/19/refrn/DBA_TAB_HISTOGRAMS.html)
- [ALL_TAB_STATISTICS](https://docs.oracle.com/en/database/oracle/oracle-database/19/refrn/ALL_TAB_STATISTICS.html) ·
  [ALL_TAB_COLS](https://docs.oracle.com/en/database/oracle/oracle-database/19/refrn/ALL_TAB_COLS.html) ·
  [ALL_TAB_COL_STATISTICS](https://docs.oracle.com/en/database/oracle/oracle-database/19/refrn/ALL_TAB_COL_STATISTICS.html)
- [ALL_TABLES](https://docs.oracle.com/en/database/oracle/oracle-database/19/refrn/ALL_TABLES.html) ·
  [ALL_INDEXES](https://docs.oracle.com/en/database/oracle/oracle-database/19/refrn/ALL_INDEXES.html) ·
  [ALL_CONSTRAINTS](https://docs.oracle.com/en/database/oracle/oracle-database/19/refrn/ALL_CONSTRAINTS.html) ·
  [ALL_STAT_EXTENSIONS](https://docs.oracle.com/en/database/oracle/oracle-database/19/refrn/ALL_STAT_EXTENSIONS.html)
- [USER_SEGMENTS](https://docs.oracle.com/en/database/oracle/oracle-database/19/refrn/USER_SEGMENTS.html)
  (`refrn/ALL_SEGMENTS.html` → HTTP 404, i.e. no such view)
- [USER_TABLESPACES](https://docs.oracle.com/en/database/oracle/oracle-database/19/refrn/USER_TABLESPACES.html) ·
  [DBA_TABLESPACES](https://docs.oracle.com/en/database/oracle/oracle-database/19/refrn/DBA_TABLESPACES.html)
- [V$SQL_OPTIMIZER_ENV](https://docs.oracle.com/en/database/oracle/oracle-database/19/refrn/V-SQL_OPTIMIZER_ENV.html) ·
  [PRODUCT_COMPONENT_VERSION](https://docs.oracle.com/en/database/oracle/oracle-database/19/refrn/PRODUCT_COMPONENT_VERSION.html)
  (`refrn/ALL_SQL_PLAN_BASELINES.html` and `refrn/ALL_SQL_PLAN_DIRECTIVES.html` → HTTP 404)
- [DBMS_METADATA (Security Model, GET_DDL)](https://docs.oracle.com/en/database/oracle/oracle-database/19/arpls/DBMS_METADATA.html) ·
  [DBMS_XPLAN (Security Model)](https://docs.oracle.com/en/database/oracle/oracle-database/19/arpls/DBMS_XPLAN.html) ·
  [DBMS_STATS](https://docs.oracle.com/en/database/oracle/oracle-database/19/arpls/DBMS_STATS.html) ·
  [DBMS_UTILITY](https://docs.oracle.com/en/database/oracle/oracle-database/19/arpls/DBMS_UTILITY.html)
- [Generating and Displaying Execution Plans (PLAN_TABLE, EXPLAIN PLAN privileges)](https://docs.oracle.com/en/database/oracle/oracle-database/19/tgsql/generating-and-displaying-execution-plans.html)
- [Addressing the CONNECT Role Change](https://docs.oracle.com/en/database/oracle/oracle-database/19/dbseg/addressing-connect-role-change.html) ·
  [Role Privileges and Secure Application Roles (roles in PL/SQL blocks)](https://docs.oracle.com/en/database/oracle/oracle-database/19/dbseg/role-privileges-and-secure-application-roles.html)
