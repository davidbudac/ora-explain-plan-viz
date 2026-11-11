# Plan 002: A corrupt or truncated share link no longer deletes the autosaved session

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**:
> `git diff --stat b5635d8..HEAD -- src/hooks/usePlanContext.tsx src/hooks/__tests__/shareLinkRestore.test.tsx src/lib/session.ts`
> If any in-scope file changed since this plan was written, compare the
> "Current state" excerpts against the live code before proceeding; on a
> mismatch, treat it as a STOP condition. Other plans may have landed first and
> shifted line numbers; match on the quoted code, not the line number.
> `src/hooks/usePlanContext.tsx` is also edited by
> `plans/003-flag-stale-session-when-autosave-skipped.md`,
> `plans/004-share-from-single-file-build.md` and
> `plans/005-guard-theme-storage.md` (different regions of the file).

## Status

- **Priority**: P1
- **Effort**: S
- **Risk**: LOW
- **Depends on**: none (`plans/001-typecheck-tests.md` first is recommended, not required)
- **Category**: bug
- **Planned at**: commit `b5635d8`, 2026-11-11

## Why this matters

The app autosaves the workspace (loaded plans, tab names, notes, highlights,
metadata bundles) to `localStorage` and restores it on the next visit. If the
user opens a share link whose `#gz=` payload cannot be decoded — the classic
case is a link cut short by a mail or chat client — the app shows "link is
corrupt or truncated" and, about one second later, **deletes the saved
session**. The user loses their notes because someone sent them a broken link.
After this plan a broken link restores the saved session and reports the link
problem in a toast; with no saved session the behaviour is unchanged.

## Current state

- `src/hooks/usePlanContext.tsx` — global state provider (`PlanProvider`).
  The relevant pieces, all inside that one component:

  Startup effect (`src/hooks/usePlanContext.tsx:1979-2018`):

  ```ts
  useEffect(() => {
    if (hasLoadedDefaultRef.current) return;
    hasLoadedDefaultRef.current = true;
    // From here on state changes are autosaved (restore below happens first).
    sessionReadyRef.current = true;
    …
    // New gzip hash-fragment format. Effect stays synchronous; decode is a
    // guarded fire-and-forget promise. StrictMode double-mount is already
    // handled by hasLoadedDefaultRef being set before any async work.
    const gzParam = getGzipPlanParamFromHash();
    if (gzParam) {
      clearPlanFromUrl({ includeDeepLinks: true });
      void decodeGzipPlanParam(gzParam)
        .then((text) => {
          applyUrlPlanData(classifyDecodedPlanText(text));
          applyDeepLinkExtras(true);
        })
        .catch(() => dispatch({
          type: 'SET_ERROR',
          payload: 'The shared plan link is corrupt or truncated. Ask for a fresh link or paste the plan text directly.',
        }));
      return;
    }
  ```

  The `return` skips the session restore that sits further down in the same
  effect (`src/hooks/usePlanContext.tsx:2034-2047`):

  ```ts
    // No plan in the URL: bring back the previous session, if any.
    let restored = false;
    if (!loadedFromUrl) {
      const saved = loadSession();
      if (saved && restoreSession(saved)) {
        restored = true;
        toastApi.show({
          tone: 'info',
          message: 'Restored your previous session',
          duration: 8000,
          action: { label: 'Start fresh', onClick: () => { void startFresh(); } },
        });
      }
    }
  ```

  The effect's dependency list (`:2059`) is already
  `[applyUrlPlanData, importPlanInput, restoreSession, startFresh, toastApi]`;
  `loadSession` is already imported from `'../lib/session'` (`:21`), and
  `restoreSession` is defined above the effect (`:1880`).

  Why the session is deleted: `SET_ERROR` (reducer, `:596`) rewrites the active
  slot, so `state.plans` changes; the debounced autosave effect
  (`:1940-1944`, 1 s) then saves the current state, which has no loaded plan:

  ```ts
  useEffect(() => {
    if (!sessionReadyRef.current) return;
    const timer = setTimeout(persistSessionNow, 1000);
    return () => clearTimeout(timer);
  }, [state.plans, state.activePlanIndex, state.viewMode, persistSessionNow]);
  ```

- `src/lib/session.ts:94-97` — an empty session removes the stored one:

  ```ts
  if (session.slots.length === 0) {
    removeKey(storage, SESSION_KEY);
    return { ok: true, chars: 0 };
  }
  ```

  This is correct for "the user cleared everything" and must stay.

- A corrupt *legacy* `?plan=` link does not have the problem: `getPlanFromUrl()`
  returns `null` for it and startup falls through to the session restore.

- Toast API (`src/components/ui/Toast.tsx`): `toastApi.show({ title?, message, tone?: 'success' | 'error' | 'info' | 'warning', duration?, action? })`.
  Repo convention: `toast` for outcomes that would otherwise be invisible.

- Existing tests: `src/hooks/__tests__/shareLinkRestore.test.tsx` renders the
  real provider with `renderPlanContext()` (from
  `src/components/ui/__tests__/planContext.tsx`) and already mocks the decoder,
  so any `#gz=` value that is not gzip data rejects:

  ```ts
  // jsdom's Blob has no stream(), so the real gzip decoder cannot run here.
  vi.mock('../../lib/url', async (importOriginal) => {
    const actual = await importOriginal<typeof import('../../lib/url')>();
    const { gunzipSync } = await import('zlib');
    return {
      ...actual,
      decodeGzipPlanParam: async (value: string) => gunzipSync(Buffer.from(value, 'base64url')).toString('utf8'),
    };
  });
  …
  const flush = () => act(async () => { await new Promise((resolve) => setTimeout(resolve, 20)); });
  ```

  Toast text is read in tests from the toast region, as in
  `src/components/__tests__/modals.test.tsx:72`:
  `document.querySelector<HTMLElement>('[data-ui-toast-region]')?.textContent ?? ''`.

- Conventions: TypeScript strict; `import type` for type-only imports; tests
  are vitest (`import { describe, it, expect } from 'vitest'`), no Testing
  Library; all `localStorage` access in app code is try/catch-guarded
  (`loadSession()` already is).

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Install | `npm ci` | exit 0 |
| Lint | `npm run lint` | exit 0 |
| Typecheck | `npm run typecheck` | exit 0, no output after the script header |
| This test file | `npx vitest run --environment jsdom src/hooks/__tests__/shareLinkRestore.test.tsx` | all pass |
| All tests | `npm test` | builds the core package, then vitest; baseline `Test Files  155 passed (155)`, `Tests  1787 passed (1787)`, ~15 s |

## Scope

**In scope** (the only files you should modify):
- `src/hooks/usePlanContext.tsx` (only the `.catch(...)` of the `#gz=` branch)
- `src/hooks/__tests__/shareLinkRestore.test.tsx` (add tests)

**Out of scope** (do NOT touch):
- `src/lib/session.ts` — removing the key for an empty session is correct.
- `src/lib/url.ts` — decoding is fine; only the failure handling changes.
- The autosave effect and `persistSessionNow` — do not add "autosave off"
  flags; the fix is to restore the session, which makes the autosave harmless.
- The legacy `?plan=` branch and the successful-link path: a *valid* share link
  replacing the session is intended behaviour.
- `site/docs.html` — no documented behaviour changes (the docs do not describe
  what a broken link does).

## Git workflow

- Branch: `fix/keep-session-on-corrupt-share-link`
- Conventional-commit message, like the repo's
  `fix(lint): satisfy eslint-plugin-react-hooks 7.1 / react-refresh 0.5`. Suggested:
  `fix(share): restore the saved session when a share link cannot be decoded`
- Do NOT push or open a PR unless the operator instructed it.

## Steps

### Step 1: Add the failing tests

In `src/hooks/__tests__/shareLinkRestore.test.tsx`:

1. Add an import after the existing `import type { SamplePlan } from '../../examples';`:

   ```ts
   import { SESSION_KEY, loadSession } from '../../lib/session';
   ```

2. Directly above the existing `const flush = …` line add:

   ```ts
   const toastText = () => document.querySelector<HTMLElement>('[data-ui-toast-region]')?.textContent ?? '';
   const LINK_ERROR = 'The shared plan link is corrupt or truncated. Ask for a fresh link or paste the plan text directly.';
   ```

3. Append at the end of the file:

   ```ts
   describe('corrupt #gz= link', () => {
     // Not gzip data: the decoder rejects, like a link cut short by a mail or chat client.
     const CORRUPT = '/#gz=AAAA';

     function saveSessionWith(text: string, customLabel: string) {
       localStorage.setItem(
         SESSION_KEY,
         JSON.stringify({ version: 1, savedAt: '', activePlanIndex: 0, viewMode: 'hierarchical', slots: [{ text, customLabel }] }),
       );
     }

     it('restores the autosaved session and keeps it in storage', async () => {
       saveSessionWith(PLAN_A, 'Kept');
       setUrl(CORRUPT);
       const ctx = renderPlanContext();
       await flush();

       expect(ctx.current().parsedPlan).not.toBeNull();
       expect(ctx.current().plans[0].customLabel).toBe('Kept');
       expect(ctx.current().error).toBeNull();
       expect(toastText()).toContain(LINK_ERROR);
       expect(toastText()).toContain('Your previous session was restored.');
       expect(window.location.hash).toBe('');

       // Force the autosave that would otherwise run after its 1 s debounce.
       act(() => {
         window.dispatchEvent(new Event('pagehide'));
       });
       expect(loadSession()?.slots[0].customLabel).toBe('Kept');
     });

     it('shows the link error in the input panel when there is no session to restore', async () => {
       setUrl(CORRUPT);
       const ctx = renderPlanContext();
       await flush();

       expect(ctx.current().parsedPlan).toBeNull();
       expect(ctx.current().error).toBe(LINK_ERROR);
       expect(localStorage.getItem(SESSION_KEY)).toBeNull();
     });
   });
   ```

   (`PLAN_A`, `setUrl`, `renderPlanContext`, `act` already exist in the file.
   The `pagehide` event makes the provider flush its autosave immediately — see
   the `window.addEventListener('pagehide', flush)` effect in `usePlanContext.tsx`.)

**Verify**: `npx vitest run --environment jsdom src/hooks/__tests__/shareLinkRestore.test.tsx`
→ exactly 1 failing test, `corrupt #gz= link > restores the autosaved session and keeps it in storage`
(`expected null not to be null`); the second new test and the 8 existing ones pass.

### Step 2: Restore the session when the link cannot be decoded

In `src/hooks/usePlanContext.tsx`, in the startup effect, replace

```ts
        .catch(() => dispatch({
          type: 'SET_ERROR',
          payload: 'The shared plan link is corrupt or truncated. Ask for a fresh link or paste the plan text directly.',
        }));
      return;
```

with

```ts
        .catch(() => {
          const linkError = 'The shared plan link is corrupt or truncated. Ask for a fresh link or paste the plan text directly.';
          // A broken link must not cost the user their autosaved workspace:
          // SET_ERROR alone would leave zero loaded plans, and the autosave
          // would then delete the saved session. Bring the session back and
          // report the link problem as a toast instead.
          const saved = loadSession();
          if (saved && restoreSession(saved)) {
            toastApi.show({
              tone: 'error',
              title: 'Shared link could not be opened',
              message: `${linkError} Your previous session was restored.`,
              duration: 12000,
            });
            return;
          }
          dispatch({ type: 'SET_ERROR', payload: linkError });
        });
      return;
```

Do not change the effect's dependency list — `restoreSession` and `toastApi`
are already in it. Do not move `sessionReadyRef.current = true`.

**Verify**: `npx vitest run --environment jsdom src/hooks/__tests__/shareLinkRestore.test.tsx`
→ `Tests  10 passed (10)`.

### Step 3: Full gates

**Verify**: `npm run lint` → exit 0; `npm run typecheck` → exit 0;
`npm test` → all pass, 2 more tests than before this plan.

## Test plan

- New tests in `src/hooks/__tests__/shareLinkRestore.test.tsx`, describe
  `corrupt #gz= link` (code given in Step 1):
  1. *restores the autosaved session and keeps it in storage* — the regression:
     saved session + undecodable `#gz=` → plans restored, no slot error, toast
     carries the link error, session still in storage after a forced autosave.
  2. *shows the link error in the input panel when there is no session to
     restore* — pins the unchanged behaviour without a saved session.
- Structural pattern: the existing tests in the same file.
- Verification: `npx vitest run --environment jsdom src/hooks/__tests__/shareLinkRestore.test.tsx` → 10 passed.

## Done criteria

Machine-checkable. ALL must hold:

- [ ] `npx vitest run --environment jsdom src/hooks/__tests__/shareLinkRestore.test.tsx` → 10 passed, 0 failed
- [ ] `grep -c "Your previous session was restored." src/hooks/usePlanContext.tsx` prints `1`
- [ ] `grep -c "The shared plan link is corrupt or truncated" src/hooks/usePlanContext.tsx` prints `1`
- [ ] `npm run lint` exits 0
- [ ] `npm run typecheck` exits 0
- [ ] `npm test` exits 0 (baseline + 2 tests)
- [ ] `git status --porcelain` lists only `src/hooks/usePlanContext.tsx` and `src/hooks/__tests__/shareLinkRestore.test.tsx` (plus `plans/README.md`)
- [ ] `plans/README.md` status row updated

## STOP conditions

Stop and report back (do not improvise) if:

- The `.catch(() => dispatch({ type: 'SET_ERROR', …` block quoted in "Current
  state" is not in the `#gz=` branch of the startup effect any more.
- `restoreSession`, `loadSession` or `toastApi` is not in scope inside the
  startup effect, or ESLint's `react-hooks/exhaustive-deps` asks for a
  dependency change after your edit.
- In Step 1 the first new test passes *before* the fix (the bug is already
  fixed) or the second new test fails (the no-session behaviour differs from
  what this plan assumes).
- The fix seems to need a change in `src/lib/session.ts` or in the autosave effect.
- A step's verification fails twice after a reasonable fix attempt.

## Maintenance notes

- Deferred, same family: a link that *decodes* but whose text does not parse as
  a plan still replaces the workspace with an error slot, and the autosave then
  clears the saved session. Fixing that means making `applyUrlPlanData` report
  whether anything loaded and falling back to the session otherwise; it changes
  what a recipient sees for a syntactically valid but unparsable link, so it
  was left out of this plan.
- If the startup effect is ever split into a `useStartupLoad` hook, keep the
  invariant this plan establishes: every startup branch that ends with zero
  loaded plans must either restore the session or leave storage untouched.
- Reviewer: confirm the valid-link path is untouched (a good share link still
  replaces the session — intended) and that the toast is the only new UI.
