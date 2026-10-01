# Functional review backlog (2026-10-01)

A functional review on 2026-10-01 looked at parsing coverage, analysis correctness,
large-plan behaviour, workflow gaps and engineering hygiene. The UI/UX audit merged the
day before (39f6ce1) covered visual polish, so this review left that out. Three read-only
passes looked at the code, and every headline finding was confirmed in the source.

**Phase 1 — "fix the numbers" — is done** (`fix/plan-numbers`, merged to `main`). The
semantics are documented in `CLAUDE.md` under "Plan Numbers". Everything below is open.

---

## Open question from Phase 1

- [ ] **Per-start estimates on node cards.** Compact tree nodes still show the per-start
  `Est. rows 4` next to the cumulative `Actual 80K` without a mismatch badge. That is correct,
  but it invites the naive comparison. Options:
  - show the total estimate;
  - show `4 × 20K starts`;
  - add a tooltip only.

  This needs a design decision.

## Phase 2 — Parse real Oracle output faithfully

Ranked by how often a DBA would hit each one.

- [ ] **DISPLAY_CURSOR `ALLSTATS LAST` goes to the SQL Monitor text parser.** Any header with
  `A-Rows` matches `sqlMonitorParser.ts` `canParse`, so:
  - the `Buffers` column is dropped (map it to `logicalReads`);
  - `OMem`, `1Mem` and `Used-Mem` all map to `memoryUsed`, so the last one wins;
  - `1385K (0)` is read as 1385 bytes, and the pass count is lost;
  - SQL text, query blocks, Pstart/Pstop and TQ/IN-OUT/PQ Distrib are lost;
  - the plan is labelled "SQL Monitor".

  Suggested fix: route DISPLAY_CURSOR output (has `Plan hash value:`, no
  `SQL Plan Monitoring Details`) to the DBMS_XPLAN parser. Extend that parser's column map with
  the runtime columns (Starts, E-Rows, A-Rows, A-Time, Buffers, Reads, Writes, OMem, 1Mem,
  Used-Mem, Used-Tmp), sharing value parsers. The real 19c fixtures in
  `src/lib/parser/__tests__/fixtures/allstats-*.txt` are a starting point.
- [ ] **A predicate line without an Id is dropped.** Oracle prints `filter(...)` under
  `access(...)` without a leading Id, and Exadata prints `storage(...)` the same way
  (`dbmsXplanParser.ts` `parsePredicates`, and the same logic in the SQL Monitor parser).
- [ ] **Query Block / Object Alias never attaches on real output.** The parser stops at the
  blank line after the dashes (`dbmsXplanParser.ts` `parseQueryBlocks`). Examples 25 and 26
  have that blank line; 01 and 02 don't, which is why it went unnoticed.
- [ ] **Adaptive plans.** Inactive rows (`-` prefix) and STATISTICS COLLECTOR show as live
  operations and are counted in totals. Add `inactive?: boolean`, exclude those rows from
  totals, and dim or hide them.
- [ ] **Text robustness.**
  - Normalise CRLF at parse entry; file drops keep `\r`, which breaks Notes.
  - Support T/P/E size suffixes.
  - Parse suffixed costs (`4823K`).
  - Count tabs in indentation.
- [ ] **Multi-child and AWR pastes.** The `SQL_ID …, child number N` header of plan N+1 ends up
  in segment N, so SQL_ID and SQL text slide onto the wrong plan. The child number is never
  captured.
- [ ] **ADVANCED sections.** Outline Data, Hint Report, Column Projection, Remote SQL and Peeked
  Binds from text output are ignored. SQL Monitor XML `<info>` notes, outline hints and
  `<parallel_info>` per-server stats are ignored too.
- [ ] **SQL Monitor ACTIVE (HTML) reports.** Support base64/zlib-compressed XML via
  `DecompressionStream`, which is already used for `#gz` links.
- [ ] **Partial-parse warnings.** Add `plan.warnings[]` and show them, covering dropped columns
  or sections, the wrong parser route, a truncated CLOB (suggest `SET LONG`), and XML with a
  SQL*Plus preamble. Today these all fail silently or give a generic message.
- [ ] **JSON parser.**
  - The CPU% formula is wrong.
  - Starts defaults to the DOP.
  - Partition and PX keys aren't read.
- [ ] **Docs contradiction.** `docs/input-formats.md:19` says DBMS_XPLAN has "No runtime
  statistics".

## Phase 3 — CI and large-plan performance

- [ ] **Add a PR CI job** running `npm run lint`, `npx vitest run --environment jsdom` and
  `tsc -b`. Add `test` and `typecheck` scripts to `package.json`. Today `deploy.yml` only builds
  and deploys on push to `main`.
- [ ] **Memoize the plan-context value** (`usePlanContext.tsx`, the provider value), or split it
  into data and actions. All ~46 consumers re-render on every keystroke.
- [ ] **Re-check `PlanNode`.** It is deliberately not memoized, and the comment explaining why is
  stale. Re-evaluate `React.memo`.
- [ ] **Sankey.** Restyle the diagram on selection or search instead of tearing it down and
  re-laying it out. The quadratic label-collision check needs a spatial grid or a cap.
- [ ] **Run the advisor once per plan.** It runs both in `usePlanContext` and in
  `HierarchicalView`.
- [ ] **Add a generated 2,000-operation plan** as a test fixture and performance benchmark. The
  largest example today has 22 operations.
- [ ] **Smaller hot paths in `HierarchicalView`:**
  - all nodes and aria labels are rebuilt on every selection;
  - an O(n·groups) annotation lookup;
  - keyboard navigation filters the whole plan on each arrow press.

## Phase 4 — Advisor rules a DBA expects

- [ ] **Root-cause cardinality.** Flag the lowest operation whose inputs are accurate but whose
  own estimate is off, instead of the whole ancestor chain.
- [ ] **Per-row re-execution.** Flag FILTER or scalar subqueries and nested-loop inner sides
  with high Starts, and REMOTE operations inside nested loops.
- [ ] **Rows discarded after an index.** Flag when index A-Rows is much larger than the
  TABLE ACCESS BY ROWID A-Rows (the filter column is missing from the index).
- [ ] **Buffers per row and per start.** Needs the Phase 2 Buffers parsing.
- [ ] **Findings from Notes.** Dynamic sampling, adaptive plan, SQL plan directives and SQL
  profile/baseline/patch are already parsed in `noteSection.ts`, but no rule uses them.
- [ ] **Work-area passes.** Flag one-pass and multipass sorts and hashes, from the Used-Mem
  pass count or SQL Monitor.
- [ ] **Functions wrapping indexed columns** (UPPER, TRUNC, NVL, SUBSTR).
- [ ] **Hash join build side larger than the probe side.**
- [ ] **Parallel.**
  - Flag S->P serialization.
  - Flag skew from per-server stats.
  - The current P->S check can never fire.
- [ ] **Partition `ALL`.** Only flag it when there is a predicate on the partition key.
- [ ] **Existing rule fixes.**
  - The cartesian rule overcounts: BUFFER SORT A-Rows is already N×M.
  - `selective-full-scan` uses whole-table num_rows for partitioned tables.
  - `index-exists-unused` ignores non-sargable predicates and the table alias.
- [ ] **Multi-select aggregates.** Check the remaining aggregate labels after the Phase 1
  self-cost and self-time change.

## Phase 5 — Workflow and housekeeping

- [ ] **"Open plan file" button.** Today drag-and-drop is the only way to load a plan file.
- [ ] **"Copy plan as Markdown"**, for tickets and chats.
- [ ] **Deep links.** Add `?node=` and filters, and allow compare mode in `#gz` share links
  (codex suggestion #7). Also add a "return to selected" breadcrumb for large plans
  (suggestion #9).
- [ ] **Post-parse findings overview** (codex suggestion #1).
- [ ] **Offline / installable PWA** (manifest and service worker).
- [ ] **Version.** `package.json` still says `0.0.0`, while `v1.1.0` is tagged.
- [ ] **Stale plan docs.** `docs/plans/db-generated-share-url.md` and
  `share-url-large-plans.md` say "not implemented", but both features exist.
- [ ] **Branch pruning.** About 30 stale local and remote branches. Deleting them needs
  explicit approval.
- [ ] **`changelog_claude.md`.** It was abandoned in March 2026; revive it or remove it.
- [ ] **Ignore `prototypes/`.** It holds Xcode build output and is untracked. Add it to
  `.gitignore` on the main line.
