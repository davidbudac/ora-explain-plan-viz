# Plan: Share-via-URL for large plans (gzip + hash fragment)

Status: **approved design, not yet implemented** (2026-07-05)

## Context

The share button builds `?plan=<lz-string>` URLs capped at `MAX_URL_LENGTH = 8000`
(`src/lib/url.ts:5`). Large SQL Monitor reports don't fit — 7 of the 15 bundled
examples produce 11K–17K char URLs and fail with "Plan is too large to share."

**Why 8000 exists:** `?plan=` is a query parameter, sent to the server on every request.
GitHub Pages / nginx / CDNs cap the request line at ~8KB, so that limit is real for query
params and cannot simply be raised.

**The fix — two multiplying levers:**
1. **Move the payload to the URL hash fragment (`#gz=...`).** Fragments never leave the
   browser, so the server-side 8KB limit disappears. Practical limit becomes what
   browsers/chat clients tolerate (~100K chars comfortably).
2. **Compress with native gzip** (`CompressionStream('gzip')`, zero new dependencies)
   instead of lz-string. Measured on all bundled examples: ~55% smaller
   (worst: 37.5KB raw → 7,558 chars vs 16,884 with lz-string).

| Example | Raw bytes | lz-string URL | gzip URL |
|---|---|---|---|
| 27-Partitioned Star Query (largest) | 37,563 | 16,884 ❌ | 7,558 ✓ |
| 24-Recursive BOM | 29,862 | 13,722 ❌ | 6,178 ✓ |
| 21-Star Schema Rollup | 24,443 | 11,842 ❌ | 5,454 ✓ |

This converges with the approved `docs/plans/db-generated-share-url.md`, which already
specifies a `#gz=<base64url(gzip(...))>` **read** path for a future DB-side SQL*Plus
script. This work implements that read path; the share button also *writes* the same
format (JSON payload variant). It supersedes that doc's "share button keeps lz-string"
statement.

**On pruning the source instead:** `stripUnusedXmlSections()` (`src/lib/url.ts:69`)
already does this as a fallback — but it is lossy: it strips `<activity_sampled>`, which
the parser *does* use (activity-% feature). So pruning stays a last resort only. With
gzip + hash fragment it becomes practically unreachable (only above the new 100K cap).
Nothing breaks: legacy `?plan=` links keep decoding forever.

## Changes

### 1. `src/lib/url.ts` — codec + new size policy

Constants: replace `MAX_URL_LENGTH` with
`HASH_PARAM = 'gz'`, `SOFT_WARN_URL_LENGTH = 8000`, `HARD_MAX_URL_LENGTH = 100_000`,
`LEGACY_MAX_URL_LENGTH = 8000`.

New **window-free async codec** (node-testable, matches the DB-doc spec):
- `encodeGzipPlanParam(text): Promise<string>` — TextEncoder → Blob stream →
  `CompressionStream('gzip')` → `Response.arrayBuffer()` → **chunked** btoa
  (~0x8000-byte `String.fromCharCode` chunks — naive spread blows the call stack on
  37KB inputs) → `+/`→`-_`, strip `=` padding.
- `decodeGzipPlanParam(value): Promise<string>` — validate `/^[A-Za-z0-9_-]+$/`,
  re-pad, atob → `DecompressionStream('gzip')` → `Response.text()`; throws on
  corrupt/truncated/empty.

New sync helper `getGzipPlanParamFromHash(): string | null` — reads via
`new URLSearchParams(location.hash.slice(1))`.

Extract the JSON-vs-plain-text logic from `getPlanFromUrl` (lines 38–48) into
`classifyDecodedPlanText(text): UrlPlanData` — reused by both the legacy lz-string path
and the new gz path. This is what makes one decoder handle both the app's JSON
`SharePayload` and the future DB script's raw plan text. `getPlanFromUrl()` keeps its
exact signature/behavior.

`clearPlanFromUrl()` — also delete `gz` from hash params (write back empty `url.hash`
when none remain; preserve any other hash params).

`buildShareUrl(payload)` becomes **async**:
1. If `typeof CompressionStream === 'undefined'` (old browsers) → keep current lz-string
   `?plan=` implementation as private `buildLegacyShareUrl` with the 8000 cap (graceful
   degradation; lz-string stays a dependency for reading anyway).
2. Else: gz-encode `JSON.stringify(payload)`; build URL from `location.href`,
   **`searchParams.delete('plan')`** (removes stale legacy param when re-sharing an
   opened old link), set `gz` in hash params.
3. Size tiers on final URL length:
   - `> 100_000` → error "Plan is too large to share via URL (N chars, max 100000)…"
     (caller's strip-retry still applies, as today)
   - `> 8_000` → ok + warning "Link copied, but it is very long (N chars) — some chat
     and email clients may truncate it. Verify the pasted link works."
   - else → ok, no warning.

### 2. `src/hooks/usePlanContext.tsx`

`sharePlan()` (lines 1333–1379): just `await buildShareUrl(...)` at lines 1354 and 1360
(function is already async; Header/CommandPalette callers unaffected). If the strip-retry
succeeds and also carries a length warning, prefer the trim warning.

Mount effect (lines 1001–1071):
- Extract lines 1012–1045 (legacy-vs-payload dispatch, REPLACE_PLANS, annotations,
  panel collapse) into a local `applyUrlPlanData(urlData)`.
- Precedence `?plan=` > `#gz=` > `?example=`/`?view=` (matches the DB doc):

```ts
const gzParam = getGzipPlanParamFromHash();
if (gzParam) {
  clearPlanFromUrl();   // clears hash too; gzParam already captured
  void decodeGzipPlanParam(gzParam)
    .then((text) => applyUrlPlanData(classifyDecodedPlanText(text)))
    .catch(() => dispatch({ type: 'SET_ERROR', payload:
      'The shared plan link is corrupt or truncated. Ask for a fresh link or paste the plan text directly.' }));
  return;
}
```

Effect stays synchronous (decode is guarded fire-and-forget); StrictMode double-mount is
already handled by `hasLoadedDefaultRef` being set before any async work.

### 3. `src/components/Header.tsx` (line 178)

Warning tooltip is hardcoded to "URL copied — some data was trimmed"; change to
`shareMessage ?? 'URL copied with a warning'` since warnings can now also be
length warnings. The inline warning bubble already shows `shareMessage`. No other UI
changes (warning renders as success-green "copied", which is right — the link works).

### 4. Tests

**New `src/lib/__tests__/url.gz.test.ts`** with `// @vitest-environment node` pragma
(jsdom lacks Compression/DecompressionStream; Node ≥18 has both):
- Roundtrip encode→decode: real DBMS_XPLAN fixture, the 37KB SQL Monitor example
  (guards the chunked-btoa path), multibyte string (UTF-8 proof), JSON SharePayload.
- Cross-check with `node:zlib`: `gunzipSync(Buffer.from(encoded, 'base64url'))` equals
  input, and `gzipSync(text).toString('base64url')` decodes via `decodeGzipPlanParam` —
  pins RFC-1952 compatibility with the future DB script's `UTL_COMPRESS` output.
- Corrupt input rejects: invalid chars, truncated gzip, empty, non-gzip bytes.
- `classifyDecodedPlanText`: JSON-with-plans → payload; other JSON / raw text → legacy.

**New `src/lib/__tests__/url.test.ts`** (jsdom):
- Legacy regression: `getPlanFromUrl()` decodes lz-string `?plan=` (payload + plain-text
  variants) — pins the old format forever.
- `getGzipPlanParamFromHash()` parsing; `clearPlanFromUrl()` removes `?plan=`, `#gz=`,
  both, and preserves other params.
- `buildShareUrl` in jsdom naturally exercises the lz-string fallback branch (no
  CompressionStream there) — assert `?plan=` URL + 8K cap behavior.

Run: `npx vitest run --environment jsdom` (per-file node pragma overrides), plus the
full existing suite.

### 5. Docs

Update the app-side section of `docs/plans/db-generated-share-url.md` (its "share button
keeps lz-string" statement is superseded: the button now writes `#gz=` too; the DB-script
section is unchanged and its raw-text payloads are covered by the unified classifier).

## Verification

1. Full test suite passes.
2. `npm run dev`: share the 37KB example (works, ~7.5K chars, no warning); open the
   copied `#gz=` link in a fresh tab → plan + annotations restore, URL cleared.
3. Open an old-format `?plan=` link → still works (back-compat).
4. Simulate the DB script: `node -e` gzip+base64url of raw DBMS_XPLAN text → `#gz=` link
   renders.
5. Corrupt `#gz=xxxx` link → friendly error, app still usable.

## Implementation order

1. `src/lib/url.ts` codec + refactors + tiers + legacy fallback
2. Both test files
3. `src/hooks/usePlanContext.tsx` (sharePlan await, mount-effect gz branch)
4. `src/components/Header.tsx` tooltip copy
5. Docs update, full suite, manual verification

## Critical files

- `src/lib/url.ts` (modify)
- `src/hooks/usePlanContext.tsx` (modify: sharePlan ~1333, mount effect ~1001)
- `src/components/Header.tsx` (modify: line 178 tooltip)
- `src/lib/__tests__/url.gz.test.ts` (new)
- `src/lib/__tests__/url.test.ts` (new)
- `docs/plans/db-generated-share-url.md` (update app-side section)
