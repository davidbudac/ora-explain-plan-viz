# Plan: DB-to-URL — generate a shareable visualizer link directly from the database

Status: **approved design, not yet implemented** (2026-07-05)

## Context

Today, getting a plan into the visualizer means running DBMS_XPLAN / SQL Monitor in the
database, copying the output, and pasting it into the app. The app already has a
share-via-URL feature (`?plan=` + lz-string, `src/lib/url.ts`), but the encoding happens
only in the browser. Goal: a **fully read-only SQL*Plus/SQLcl script** that, given a
`sql_id`, fetches the plan text, compresses and encodes it **in the database**, and prints
a complete ready-to-click URL — zero pasting.

**Feasibility verified.** Measured on all 14 bundled example plans (`src/examples/*.txt`):
gzip+base64url produces URLs of 640–6,200 chars (worst: 30KB SQL Monitor plan → 6.2K chars).
A single 32,767-char DBMS_OUTPUT line carries a ~200KB raw plan — effectively every
realistic plan fits.

**Key constraint:** existing share URLs use **lz-string**, a JS-specific algorithm
impractical to reimplement in PL/SQL. So the DB script emits a second, Oracle-friendly
encoding — **gzip (`UTL_COMPRESS.LZ_COMPRESS`, RFC-1952) + base64url** — and the app gains
read support via native `DecompressionStream('gzip')` (no new dependencies). The lz-string
share button stays untouched.

**Decisions confirmed with the user:**
- Sources v1: **DISPLAY_CURSOR** (default, no pack license) + **SQL Monitor TEXT**
  (optional, Tuning Pack). No AWR in v1.
- Encoded plan in the **hash fragment** (`#gz=...`) — never sent to GitHub Pages/CDN
  (no length caps, no SQL in server logs; nginx/CDN request-line limits ~8KB would break
  a query param anyway).
- Default base URL: `https://davidbudac.github.io/ora-explain-plan-viz/`
  (overridable DEFINE at the top of the script).
- In-app share button keeps lz-string; app only *reads* the new format.

## App-side changes

### `src/lib/url.ts` — add hash-fragment codec

Keep `getPlanFromUrl()` sync and untouched. Add:

```ts
const HASH_PARAM = 'gz';

/** Sync: read raw #gz= value via new URLSearchParams(location.hash.slice(1)), or null. */
export function getGzipPlanParamFromHash(): string | null;

/** Pure async decoder, no window access (unit-testable in Node):
 *  base64url -> +/ translate + re-pad -> atob -> Uint8Array
 *  -> new Response(new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'))).text()
 *  Throws on corrupt/truncated input. */
export async function decodeGzipPlanParam(value: string): Promise<string>;
```

Update `clearPlanFromUrl()` to also delete `gz` from the hash params (write back empty
`url.hash` when none remain).

### `src/hooks/usePlanContext.tsx` — mount effect (~line 1006)

Effect stays synchronous; decode is a guarded fire-and-forget promise. Insert after the
existing `?plan=` block (which wins for back-compat), before `?example=`:

```ts
const gzParam = getGzipPlanParamFromHash();
if (gzParam) {
  clearPlanFromUrl();
  void decodeGzipPlanParam(gzParam)
    .then((text) => importPlanInput(text))   // parser auto-detects DBMS_XPLAN vs Monitor text
    .catch(() => dispatch({ type: 'SET_ERROR', payload:
      'The plan link is corrupt or truncated. Ask for a fresh link or paste the plan text directly.' }));
  return;
}
```

`importPlanInput` already handles parse errors per slot; the `SET_ERROR` action already
exists. Double-mount is guarded by the existing `hasLoadedDefaultRef`.

## DB-side: new `scripts/plan_to_url.sql`

Model on `scripts/gather_plan_metadata.sql` (settings block, zero-row
`COLUMN n NEW_VALUE n` idiom for optional args, read-only, restore-defaults footer).
Output to screen, no spool.

**Arguments:** `&1` sql_id (required); `&2` child number (optional, default 0, CURSOR
source only); `&3` source `CURSOR` (default) | `MONITOR`.
`DEFINE base_url = 'https://davidbudac.github.io/ora-explain-plan-viz/'` near the top
with a comment for self-hosted overrides.

**Settings:** `SET SERVEROUTPUT ON SIZE UNLIMITED FORMAT WRAPPED`, `LINESIZE 32767`,
`TRIMOUT ON`, `PAGESIZE 0`, `FEEDBACK OFF`, `VERIFY OFF`, `TAB OFF` — a ≤32767-char
PUT_LINE emits unbroken in both SQL*Plus and SQLcl.

**Anonymous-block pipeline:**

1. **Fetch plan CLOB:**
   - `CURSOR`: loop `TABLE(DBMS_XPLAN.DISPLAY_CURSOR(sql_id, child, 'ALLSTATS LAST'))`,
     append lines + `CHR(10)`. Scan first rows for `cannot be found` → abort with a clear
     message (plan aged out of cursor cache).
   - `MONITOR`: **dynamic SQL**
     `DBMS_SQLTUNE.REPORT_SQL_MONITOR(sql_id => :1, type => 'TEXT', report_level => 'ALL')`
     so the block compiles without the privilege; catch and report friendly errors.
2. **CLOB → BLOB:** `DBMS_LOB.CONVERTTOBLOB` with
   `blob_csid => NLS_CHARSET_ID('AL32UTF8')` — guarantees UTF-8 bytes regardless of DB
   charset (matches `Response.text()` decode).
3. **Compress:** `UTL_COMPRESS.LZ_COMPRESS(src => l_blob, quality => 9)` — gzip format,
   accepted by `DecompressionStream('gzip')`.
4. **Base64url:** loop compressed BLOB in **12,000-byte chunks** (multiple of 48 → no
   mid-stream `=` padding, no cross-chunk seams; 16,000 encoded chars < 32767
   RAW/VARCHAR2 limits). Per chunk:
   `UTL_RAW.CAST_TO_VARCHAR2(UTL_ENCODE.BASE64_ENCODE(chunk))`, strip CR/LF (Oracle
   inserts them every 64 chars), `TRANSLATE(.., '+/', '-_')`; final `RTRIM(.., '=')`.
5. **Assemble & print:** `base_url || '#gz=' || encoded`.
   - ≤32767 chars: single `DBMS_OUTPUT.PUT_LINE` framed by blank lines (linkifies cleanly
     in terminals).
   - Else: print in 1,000-char lines between `----8<---- join all lines ----` markers
     with instructions.
   - Summary: sql_id/child/source, plan line count, raw → gzip bytes (ratio), URL length.
     Warnings at >2,000 chars ("may truncate in chat/email paste") and >32,767 (wrapped
     case). MONITOR source prints a Tuning Pack license reminder.

**Read-only guarantee:** only DBMS_XPLAN/DBMS_SQLTUNE reads, temp LOBs, DBMS_OUTPUT.
Header documents privileges: CURSOR needs V$ access (`SELECT_CATALOG_ROLE`-ish); MONITOR
needs `DBMS_SQLTUNE` execute + **Tuning Pack license**.

## Tests & verification

1. **New `src/lib/__tests__/url.gz.test.ts`** with `// @vitest-environment node` at the
   top (jsdom lacks `DecompressionStream`; Node ≥18 has it plus `atob` — that's why the
   decoder is window-free):
   - Roundtrip: `node:zlib gzipSync` → `toString('base64url')` → `decodeGzipPlanParam`
     equals fixture (a real DBMS_XPLAN text + a multibyte string for UTF-8 proof).
   - Corrupt input rejects: invalid base64 chars, truncated gzip, empty string.
   - Padding math: base64 lengths % 4 ∈ {0, 2, 3}.
2. **jsdom tests** (default env): `getGzipPlanParamFromHash()` parsing;
   `clearPlanFromUrl()` removes `gz` while preserving other hash params.
3. **dbmint end-to-end** (Oracle 19c, `//poug-dg1.localdomain:1521/pdb1.world`, PLANVIZ
   schema): run a `SELECT /*+ gather_plan_statistics */ ...`, grab its sql_id,
   `@plan_to_url.sql <sql_id>`, open the printed URL against `npm run dev` (base_url
   temporarily `http://localhost:5173/`), confirm the plan renders. Repeat for MONITOR
   source, a missing sql_id, and a large plan (>12,000 compressed bytes to exercise
   multi-chunk encoding).
4. **Pin Oracle compatibility:** paste the actual dbmint-produced `#gz=` payload into a
   test constant and assert it decodes — locks in UTL_COMPRESS ↔ DecompressionStream
   compatibility forever.
5. Run full suite: `npx vitest run --environment jsdom` (the node-env pragma overrides
   per-file).

## Docs

- `scripts/README.md`: usage, privileges, licensing notes.
- Main README: short "Generate a link from the database" section.

## Known limitations (documented, accepted)

- Plan must be in the cursor cache (CURSOR) or monitored (MONITOR); AWR source is a
  possible v2.
- URLs >~2,000 chars may be truncated by some chat/email clients when pasted as plain
  text (clicking/copying the whole line is fine). Measured real plans: 0.6–6.2K chars.
- `DecompressionStream` requires a modern browser (Chrome 80+, Firefox 113+,
  Safari 16.4+).
- MONITOR source requires a Tuning Pack license; the script prints a reminder.
- Sensitive SQL literals end up in the URL — mitigated by the hash fragment (never sent
  to the server), but the URL itself is still shareable data.

## Implementation order

1. `src/lib/url.ts` codec + `clearPlanFromUrl` update + unit tests.
2. `usePlanContext.tsx` mount-effect branch.
3. `scripts/plan_to_url.sql`.
4. dbmint end-to-end; capture the UTL_COMPRESS fixture into the tests.
5. Docs.

## Critical files

- `src/lib/url.ts` (modify)
- `src/hooks/usePlanContext.tsx` (modify, mount effect ~line 1006)
- `scripts/plan_to_url.sql` (new)
- `scripts/gather_plan_metadata.sql` (pattern reference only)
- `src/lib/__tests__/url.gz.test.ts` (new)
