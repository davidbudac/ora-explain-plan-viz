# Plan patterns

Common shapes of a slow Oracle plan. Each entry gives the **signature** (what the plan shows), the usual causes, and the fixes to consider. A signature is a lead, not a verdict: confirm it with the numbers on the lines involved.

## Cardinality misestimate

**Signature**: A-Rows differs from E-Rows × Starts by 10× or more on a line whose inputs were estimated well (the first divergence). Lines above it inherit the error, often as a wrong join method or join order.

**Causes**: stale or missing statistics (Note: `dynamic statistics used`; `last_analyzed` old; `stale_stats = YES`); skewed column without a histogram; correlated predicates on one table (`city = :a AND country = :b`); a function or expression on the column; a value above the column's recorded high value (out-of-range, common on dates and sequences); a bind peeked from an unrepresentative value; a join on columns whose distinct counts differ wildly.

**Fixes**: gather statistics (`DBMS_STATS.GATHER_TABLE_STATS`); a histogram on the skewed column (`METHOD_OPT => 'FOR COLUMNS <col> SIZE 254'`); extended statistics for the column group or expression (`DBMS_STATS.CREATE_EXTENDED_STATS`); adaptive cursor sharing or literals for a skewed bind; a SQL patch with `OPT_ESTIMATE` or `CARDINALITY` only as a stopgap.

## Nested loops over a large driving set

**Signature**: NESTED LOOPS whose inner lines show Starts in the tens of thousands or more; the inner index and table access carry most of the time and buffers; the outer line's E-Rows was small and its A-Rows large.

**Causes**: an underestimate on the outer row source (see cardinality misestimate); a missing hash-join-capable equality predicate; `FIRST_ROWS` optimizer mode or a `ROWNUM` limit that made nested loops look cheap.

**Fixes**: fix the outer estimate first; then, if needed, `USE_HASH` / `LEADING` in a SQL patch. An index covering the inner lookup cuts the cost per start when nested loops are right.

## Full scan returning few rows

**Signature**: `TABLE ACCESS FULL` (or `INDEX FAST FULL SCAN`) with a selective filter predicate: A-Rows is a small fraction of the table's rows, and the line carries the time or the reads.

**Causes**: no usable index on the filter columns; an index exists but the predicate is not sargable (function on the column, implicit conversion, leading wildcard `LIKE '%x'`, `OR` across columns); the optimizer overestimated the rows and found the full scan cheaper.

**Fixes**: an index on the filter columns (most selective, equality columns first); a sargable rewrite; a function-based index or virtual column when the function is fixed; correct the estimate.

## Index access with a discarding table filter

**Signature**: an index range scan returns many rowids, the `TABLE ACCESS BY INDEX ROWID` above it applies a filter predicate, and its A-Rows is far below the index line's A-Rows.

**Causes**: the index covers only part of the predicate; the filtering columns live only in the table.

**Fixes**: add the filtering columns to the index (composite index); order index columns equality first, range last.

## High buffer gets per row

**Signature**: Buffers on a line divided by its A-Rows is in the hundreds or more, mainly on index-driven table access.

**Causes**: poor clustering factor (rows for one key spread over many blocks); row chaining or migration; repeated visits to the same blocks through nested loops; read consistency on a busy table (undo).

**Fixes**: a covering index to skip the table; check `clustering_factor` against blocks and rows; batch the access with a hash join when many rows are needed.

## Implicit datatype conversion

**Signature**: predicates with `INTERNAL_FUNCTION("COL")`, `TO_NUMBER("COL")`, `TO_CHAR("COL")` or `SYS_OP_C2C("COL")` wrapped around a column; often a full scan where an index was expected.

**Causes**: a bind or literal whose datatype differs from the column (number bound to VARCHAR2, NVARCHAR2 vs VARCHAR2, TIMESTAMP vs DATE).

**Fixes**: bind with the column's datatype; convert the literal side, not the column.

## Function on an indexed column

**Signature**: a predicate like `UPPER("NAME")=:B1` or `TRUNC("CREATED")=:B1` on a column that has an index, with the index unused.

**Fixes**: rewrite to a range on the bare column (`created >= :d AND created < :d + 1`); a function-based index matching the expression exactly.

## Merge join cartesian

**Signature**: `MERGE JOIN CARTESIAN` with `BUFFER SORT`; usually an outer row source estimated at one row whose A-Rows is much larger.

**Causes**: a missing join predicate in the SQL; a one-row underestimate that made a cartesian product look free.

**Fixes**: add the join predicate if missing; fix the underestimate; a `USE_HASH` / `LEADING` SQL patch as a stopgap.

## Hash join building on the large side

**Signature**: HASH JOIN whose first child (the build input) has the larger A-Rows; high memory or temp on the join.

**Causes**: misestimated inputs; join order forced by hints or a view.

**Fixes**: fix the estimates; `SWAP_JOIN_INPUTS` or `LEADING` in a SQL patch.

## Spill to temp

**Signature**: `Used-Tmp` / Temp on a SORT, HASH JOIN, WINDOW or HASH GROUP BY line; one-pass or multipass work areas (`Used-Mem` with `(1)` or more; O/1/M column); time in `direct path read temp` / `direct path write temp`.

**Causes**: more rows than estimated reaching the work area; PGA too small for the work area; sorting or hashing wide rows.

**Fixes**: reduce rows and columns before the operation (filter earlier, select fewer columns); fix the estimate so the optimizer sizes and orders work correctly; raise `pga_aggregate_target` only when spills are widespread, not for one statement.

## Filter subquery executed per row

**Signature**: a `FILTER` line with a subquery child whose Starts tracks the outer row count; or a scalar subquery in the select list with high Starts.

**Causes**: a subquery the optimizer could not unnest (`NOT IN` with nullable columns, `OR` with the subquery, `ROWNUM` inside it, a correlated aggregate).

**Fixes**: rewrite as a join or `NOT EXISTS`; make join columns `NOT NULL` so `NOT IN` can unnest; `UNNEST` hint. Scalar subquery caching helps only when few distinct outer values exist.

## No partition pruning

**Signature**: `PARTITION RANGE ALL` (or `Pstart`/`Pstop` spanning every partition) while the SQL filters on the partition key; or `KEY`/`KEY` that pruned little at run time (Starts on the iterator).

**Causes**: a function or conversion on the partition key; a predicate on a column other than the key; a join to the key that needs subquery pruning or bloom-filter pruning.

**Fixes**: predicate on the bare partition key with the matching datatype; check `Pstart`/`Pstop` after the rewrite.

## Parallel execution problems

**Signature**: `P->S` (parallel to serial) below the top of the plan; a line where one PX server did most of the work (SQL Monitor parallel servers, skew); DOP downgraded (servers requested vs allocated); `PX SEND BROADCAST` of a large row source.

**Causes**: a serial step inside a parallel plan (a function, `ROWNUM`, a serial-only operation); skewed join or distribution keys; too few PX servers available; misestimates choosing broadcast.

**Fixes**: remove the serialization point; `PQ_DISTRIBUTE` hint or a different distribution key; check `parallel_max_servers` and concurrent PX load; fix the estimate behind the broadcast.

## Time outside the plan

**Signature**: the plan's root A-Time is far below the elapsed time the user reports; or many executions each fast.

**Causes**: fetch round trips (small array size), PL/SQL functions called per row (time shows as recursive SQL or `PL/SQL exec time` in SQL Monitor), the statement called once per row from application code, network.

**Fixes**: larger fetch array size; replace per-row function calls with joins or scalar subquery caching; batch the calls in the application.

## Plan instability or regression

**Signature**: Notes mention a SQL plan baseline, SQL profile, SQL patch, cardinality feedback, statistics feedback, adaptive plan or dynamic statistics; several child cursors or plan hash values for one SQL_ID; the user says it "used to be fast".

**Causes**: new statistics; a bind-sensitive cursor peeked with a different value; an environment change (parameters, optimizer version); data growth.

**Fixes**: compare the good and bad plans (DISPLAY_AWR for the old plan hash); pin the good plan with a SQL plan baseline while fixing the underlying statistics; check `V$SQL_SHARED_CURSOR` for why child cursors split.

## Remote SQL over a database link

**Signature**: `REMOTE` lines (Remote SQL Information), time spent waiting on `SQL*Net message from dblink`; large A-Rows coming back from the remote side.

**Causes**: filters or joins applied locally instead of at the remote site; the remote query fetches whole tables.

**Fixes**: push filters into the remote query; `DRIVING_SITE` hint; move the join to the side with the large table.
