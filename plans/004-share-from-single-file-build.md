# Plan 004: Share works in the single-file build opened from disk, and a failed share is always reported

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**:
> `git diff --stat b5635d8..HEAD -- src/hooks/usePlanContext.tsx src/lib/url.ts src/hooks/__tests__`
> If any in-scope file changed since this plan was written, compare the
> "Current state" excerpts against the live code before proceeding; on a
> mismatch, treat it as a STOP condition. Other plans may have landed first and
> shifted line numbers; match on the quoted code, not the line number.
> `src/hooks/usePlanContext.tsx` is also edited by
> `plans/002-keep-session-on-corrupt-share-link.md`,
> `plans/003-flag-stale-session-when-autosave-skipped.md` and
> `plans/005-guard-theme-storage.md` (other regions of the file).

## Status

- **Priority**: P1
- **Effort**: S
- **Risk**: LOW
- **Depends on**: none (`plans/001-typecheck-tests.md` first is recommended, not required)
- **Category**: bug
- **Planned at**: commit `b5635d8`, 2026-11-11

## Why this matters

Every release ships the whole app as one HTML file (`oraplanviz-vX.Y.Z.html`,
built by `npm run build:single`) that users open straight from disk; the README
leads with it. In that copy the **Share** button does nothing at all: no link,
no dialog, no error. The share link built from a `file://` page points at the
hosted app (by design — a `file://` link is useless to a recipient), the code
then tries to put that link into the address bar with
`history.replaceState`, and browsers refuse a cross-origin URL there with a
`SecurityError`. Nothing catches it. After this plan the link is produced and
copied without touching the address bar when the page cannot adopt it, and any
unexpected failure while sharing surfaces as an error notice instead of
vanishing.

## Current state

- `src/lib/url.ts:288-299` — where the link's base comes from (leave as is):

  ```ts
  /** Public app URL; share links made from a downloaded copy point here. */
  export const PUBLIC_APP_URL = 'https://davidbudac.github.io/ora-explain-plan-viz/';

  /**
   * Base for a share link: the current page, or the public app when this is the
   * single-file release opened from disk (a `file://` link means nothing to the
   * recipient). The plan rides in the hash, which never reaches the server.
   */
  export function shareBaseUrl(href: string): URL {
    const url = new URL(href);
    return url.protocol === 'file:' ? new URL(PUBLIC_APP_URL) : url;
  }
  ```

- `src/hooks/usePlanContext.tsx` — `sharePlan` and `share`, inside `PlanProvider`.

  `src/hooks/usePlanContext.tsx:2648-2664` (end of `sharePlan`):
  ```ts
    const result = await buildShareLink(entries, { viewMode: state.viewMode, workspace });
    const warning = result.ok && result.warnings.length > 0 ? result.warnings.join(' ') : undefined;

    if (result.ok) {
      window.history.replaceState(null, '', result.url);
      // Remember what the address-bar link encodes; once the plans or their
      // annotations change, the autosave drops the (now stale) link so a
      // reload restores the session instead of the older shared snapshot.
      sharedContentRef.current = sessionContentSignature(buildSavedSession(stateRef.current));
      // Robust copy with an execCommand fallback for insecure (HTTP) origins and
      // unfocused documents. `copied` is surfaced so the UI can offer a reliable
      // manual-copy affordance instead of falsely claiming success.
      const copied = await copyToClipboard(result.url);
      return { ok: true, url: result.url, warning, copied };
    }
    return result;
  }, [stablePlans, state.viewMode]);
  ```

  `src/hooks/usePlanContext.tsx:2666-2682` (`share`):
  ```ts
  // Perform a share and publish the outcome as a dismissable notice, so every
  // entry point (header button, command palette) gives consistent, recoverable
  // feedback — especially when the clipboard write is blocked.
  const share = useCallback(async () => {
    const result = await sharePlan();
    if (!result.ok) {
      setShareNotice({ kind: 'error', message: result.error });
      return;
    }
    if (!result.copied) {
      setShareNotice({ kind: 'manual', url: result.url, warning: result.warning });
    } else if (result.warning) {
      setShareNotice({ kind: 'warning', url: result.url, warning: result.warning });
    } else {
      setShareNotice({ kind: 'copied', url: result.url });
    }
  }, [sharePlan]);
  ```

  `ShareNotice` (`:875-879`) already has an error variant, which the header
  and the command palette already render:
  ```ts
  export type ShareNotice =
    | { kind: 'copied'; url: string }
    | { kind: 'warning'; url: string; warning?: string }
    | { kind: 'manual'; url: string; warning?: string }
    | { kind: 'error'; message: string };
  ```

- Callers fire and forget, so a rejection is an unhandled promise rejection:
  `src/components/Header.tsx:402` — `const handleShare = useCallback(() => { void share(); }, [share]);`
  and `src/components/CommandPalette.tsx:664` — `execute: () => { void share(); },`.

- `sharedContentRef` records "what the link currently in the address bar
  encodes" (`:1208`); `persistSessionNow` uses it to strip a stale link from
  the address bar. If the address bar was not updated it must not be set.

- `site/docs.html:278` already tells users that "share links made from it point
  at the hosted app". The documentation is correct; the code is not. **No docs
  change in this plan.**

- Existing share tests: `src/hooks/__tests__/shareLinkRestore.test.tsx` renders
  the real provider with `renderPlanContext()` / `loadPlan()` from
  `src/components/ui/__tests__/planContext.tsx` and overrides one export of
  `../../lib/url` with `vi.mock(…, async (importOriginal) => ({ ...actual, … }))`.
  The new test file follows that pattern. jsdom reproduces the browser error:
  `SecurityError: replaceState() cannot update history to the URL https://davidbudac.github.io/…`.

- Conventions: TypeScript strict; `import type` for type-only imports; tests
  are vitest (`import { describe, it, expect } from 'vitest'`), no Testing Library.

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Install | `npm ci` | exit 0 |
| Lint | `npm run lint` | exit 0 |
| Typecheck | `npm run typecheck` | exit 0, no output after the script header |
| This test file | `npx vitest run --environment jsdom src/hooks/__tests__/shareFromFile.test.tsx` | all pass |
| All tests | `npm test` | builds the core package, then vitest; baseline `Test Files  155 passed (155)`, `Tests  1787 passed (1787)`, ~15 s |

## Scope

**In scope** (the only files you should modify):
- `src/hooks/usePlanContext.tsx` (`sharePlan` and `share` only)
- `src/hooks/__tests__/shareFromFile.test.tsx` (create)

**Out of scope** (do NOT touch):
- `src/lib/url.ts` — `shareBaseUrl` pointing `file://` pages at the hosted app
  is intended and documented.
- `src/components/Header.tsx`, `src/components/CommandPalette.tsx`,
  `src/components/ShareResultDialog.tsx` — they already render every
  `ShareNotice` kind; `void share()` is fine once `share` cannot reject.
- `site/docs.html`, `README.md` — already accurate.
- The share payload (what a link contains) — unchanged.

## Git workflow

- Branch: `fix/share-from-single-file-build`
- Conventional-commit message, like the repo's
  `fix(lint): satisfy eslint-plugin-react-hooks 7.1 / react-refresh 0.5`. Suggested:
  `fix(share): don't rewrite the address bar with a cross-origin link; report share failures`
- Do NOT push or open a PR unless the operator instructed it.

## Steps

### Step 1: Add the failing tests

Create `src/hooks/__tests__/shareFromFile.test.tsx`:

```tsx
import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup } from '../../components/ui/__tests__/testUtils';
import { loadPlan, renderPlanContext } from '../../components/ui/__tests__/planContext';

// What buildShareLink returns is decided per test: the single-file build opened
// from file:// produces links to the hosted app (see shareBaseUrl in lib/url.ts).
const link = vi.hoisted(() => ({ url: '', fail: false }));
vi.mock('../../lib/url', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../lib/url')>();
  return {
    ...actual,
    buildShareLink: async () => {
      if (link.fail) throw new Error('boom');
      return { ok: true as const, url: link.url, warnings: [] };
    },
  };
});

const PUBLIC_LINK = 'https://davidbudac.github.io/ora-explain-plan-viz/#gz=H4sIAAAA';

beforeEach(() => {
  link.url = '';
  link.fail = false;
  localStorage.clear();
  window.history.replaceState(null, '', '/');
});
afterEach(() => {
  cleanup();
  localStorage.clear();
  vi.restoreAllMocks();
  window.history.replaceState(null, '', '/');
});

describe('share', () => {
  it('hands out a link to the hosted app without touching the address bar when the page cannot adopt it', async () => {
    link.url = PUBLIC_LINK;
    const handle = renderPlanContext();
    await loadPlan(handle);
    const replaceState = vi.spyOn(window.history, 'replaceState');

    await act(async () => {
      await handle.current().share();
    });

    expect(replaceState).not.toHaveBeenCalled();
    const notice = handle.current().shareNotice;
    expect(notice).not.toBeNull();
    expect(notice?.kind).not.toBe('error');
    expect(notice && 'url' in notice ? notice.url : '').toBe(PUBLIC_LINK);
    expect(window.location.hash).toBe('');
  });

  it('still puts a same-origin link in the address bar', async () => {
    link.url = `${window.location.origin}/#gz=H4sIAAAA`;
    const handle = renderPlanContext();
    await loadPlan(handle);

    await act(async () => {
      await handle.current().share();
    });

    expect(window.location.hash).toBe('#gz=H4sIAAAA');
    expect(handle.current().shareNotice?.kind).not.toBe('error');
  });

  it('reports a failure instead of rejecting', async () => {
    link.fail = true;
    const handle = renderPlanContext();
    await loadPlan(handle);

    await act(async () => {
      await handle.current().share();
    });

    expect(handle.current().shareNotice).toEqual({ kind: 'error', message: 'Could not create a share link: boom' });
  });
});
```

**Verify**: `npx vitest run --environment jsdom src/hooks/__tests__/shareFromFile.test.tsx`
→ 2 failed, 1 passed: the first test fails with
`SecurityError: replaceState() cannot update history to the URL https://davidbudac.github.io/ora-explain-plan-viz/#gz=H4sIAAAA.`,
the third with `Error: boom`; `still puts a same-origin link in the address bar` passes.

### Step 2: `sharePlan` — only adopt a same-origin link

In `src/hooks/usePlanContext.tsx`, inside `sharePlan`, replace

```ts
    if (result.ok) {
      window.history.replaceState(null, '', result.url);
      // Remember what the address-bar link encodes; once the plans or their
      // annotations change, the autosave drops the (now stale) link so a
      // reload restores the session instead of the older shared snapshot.
      sharedContentRef.current = sessionContentSignature(buildSavedSession(stateRef.current));
```

with

```ts
    if (result.ok) {
      // The address bar can only take a same-origin URL. The single-file build
      // opened from disk (file://) makes links to the hosted app; replaceState
      // would throw a SecurityError for those, so the address bar is left alone.
      let addressBarUpdated = false;
      try {
        if (new URL(result.url).origin === window.location.origin) {
          window.history.replaceState(null, '', result.url);
          addressBarUpdated = true;
        }
      } catch {
        // Not fatal: the link is still copied / shown below.
      }
      if (addressBarUpdated) {
        // Remember what the address-bar link encodes; once the plans or their
        // annotations change, the autosave drops the (now stale) link so a
        // reload restores the session instead of the older shared snapshot.
        sharedContentRef.current = sessionContentSignature(buildSavedSession(stateRef.current));
      }
```

Leave the following lines (the `copyToClipboard` call and both `return`s) and
the dependency array `[stablePlans, state.viewMode]` unchanged.

### Step 3: `share` — never reject

Replace the first two lines of the `share` callback body

```ts
  const share = useCallback(async () => {
    const result = await sharePlan();
    if (!result.ok) {
```

with

```ts
  const share = useCallback(async () => {
    let result: Awaited<ReturnType<typeof sharePlan>>;
    try {
      result = await sharePlan();
    } catch (err) {
      // Callers fire-and-forget (`void share()`): never let a failure vanish.
      const detail = err instanceof Error && err.message ? `: ${err.message}` : '.';
      setShareNotice({ kind: 'error', message: `Could not create a share link${detail}` });
      return;
    }
    if (!result.ok) {
```

The rest of the callback and its dependency array `[sharePlan]` stay as they are.

**Verify**: `npx vitest run --environment jsdom src/hooks/__tests__/shareFromFile.test.tsx`
→ `Tests  3 passed (3)`. Then
`npx vitest run --environment jsdom src/hooks/__tests__/shareLinkRestore.test.tsx src/components/__tests__/modals.test.tsx`
→ all pass (existing share behaviour unchanged).

### Step 4: Full gates

**Verify**: `npm run lint` → exit 0; `npm run typecheck` → exit 0;
`npm test` → all pass, 1 more test file and 3 more tests than before this plan.

## Test plan

- New file `src/hooks/__tests__/shareFromFile.test.tsx` (code in Step 1;
  structural pattern: `src/hooks/__tests__/shareLinkRestore.test.tsx`):
  1. cross-origin link (what a `file://` page produces) → `replaceState` not
     called, a non-error notice carrying the link is published, address bar
     untouched — **the regression test**;
  2. same-origin link → address bar still updated (unchanged behaviour);
  3. `buildShareLink` throws → `shareNotice` is
     `{ kind: 'error', message: 'Could not create a share link: boom' }`.
- Optional manual check (only if the operator asks; it writes `dist-single/`):
  `npm run build:single`, open `dist-single/index.html` from disk, load an
  example, click Share → a dialog/toast with a link starting
  `https://davidbudac.github.io/ora-explain-plan-viz/#gz=` appears.

## Done criteria

Machine-checkable. ALL must hold:

- [ ] `npx vitest run --environment jsdom src/hooks/__tests__/shareFromFile.test.tsx` → 3 passed, 0 failed
- [ ] `grep -c "window.history.replaceState(null, '', result.url)" src/hooks/usePlanContext.tsx` prints `1`
- [ ] `grep -c "addressBarUpdated" src/hooks/usePlanContext.tsx` prints `3`
- [ ] `grep -c "Could not create a share link" src/hooks/usePlanContext.tsx` prints `1`
- [ ] `npm run lint` exits 0
- [ ] `npm run typecheck` exits 0
- [ ] `npm test` exits 0 (baseline + 1 file, + 3 tests)
- [ ] `git status --porcelain` lists only `src/hooks/usePlanContext.tsx` and `src/hooks/__tests__/shareFromFile.test.tsx` (plus `plans/README.md`)
- [ ] `plans/README.md` status row updated

## STOP conditions

Stop and report back (do not improvise) if:

- `sharePlan` no longer contains the unconditional
  `window.history.replaceState(null, '', result.url);` quoted in "Current state".
- In Step 1 the first test passes before the fix (jsdom did not throw) — the
  premise of this plan would be wrong; report the output.
- The same-origin test fails after Step 2 (the address bar is no longer updated
  for normal hosted use).
- ESLint's `react-hooks/exhaustive-deps` asks for a dependency change in
  `sharePlan` or `share` after your edit.
- You think `shareBaseUrl` or the docs should change — they should not.
- A step's verification fails twice after a reasonable fix attempt.

## Maintenance notes

- The check is "same origin", not "is `file:`", on purpose: it also covers any
  future case where the share base differs from the page (for example a
  self-hosted copy configured to hand out links to another host).
- `share()` now never rejects; `sharePlan()` (also exposed on the context) can
  still throw if `buildShareLink` throws. Callers that use `sharePlan()`
  directly must handle that themselves.
- Not addressed here: reloading right after Share on the hosted app restores
  from the link rather than the session, which loses custom tab names (the
  share payload has no `customLabel`). Separate change.
- Reviewer: check that `sharedContentRef` is only set when the address bar
  really changed, and try the single-file build by hand once before a release.
