# Plan 006: Pasting a plan parses it immediately even when the clipboard has Windows (CRLF) line endings

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**:
> `git diff --stat b5635d8..HEAD -- src/components/InputPanel.tsx src/components/__tests__`
> If any in-scope file changed since this plan was written, compare the
> "Current state" excerpts against the live code before proceeding; on a
> mismatch, treat it as a STOP condition. Other plans may have landed first and
> shifted line numbers; match on the quoted code, not the line number. No other
> plan numbered 001–005 edits `src/components/InputPanel.tsx`.

## Status

- **Priority**: P1
- **Effort**: S
- **Risk**: LOW
- **Depends on**: none (`plans/001-typecheck-tests.md` first is recommended, not required)
- **Category**: bug
- **Planned at**: commit `b5635d8`, 2026-11-11

## Why this matters

The first thing a new user does is paste a plan into the input box. When the
paste replaces the whole box and looks like a plan, the app parses it at once;
otherwise it shows "Press Parse (⌘⏎ / Ctrl+Enter) when ready." The "replaced
the whole box" check compares the textarea's value with the raw clipboard text.
A textarea always reports its value with LF line endings, while text copied
from Windows applications (SQL Developer, Notepad, most terminals) carries
CRLF. The two never compare equal for a multi-line plan, so on Windows — where
a large share of Oracle DBAs work — the convenience never fires. After this
plan the comparison ignores line-ending style.

## Current state

- `src/components/InputPanel.tsx` — the input drawer with the plan textarea.

  `src/components/InputPanel.tsx:159-176`:
  ```ts
  // First-run nicety: a paste that is recognisably a plan (or a metadata
  // bundle) and fills the box parses immediately; anything else gets a hint.
  const handlePaste = (event: ReactClipboardEvent<HTMLTextAreaElement>) => {
    const pasted = event.clipboardData.getData('text');
    const textarea = event.currentTarget;
    // Let the paste land (and onChange run) before looking at the result.
    window.setTimeout(() => {
      const value = textarea.value;
      if (!value.trim()) return;
      const replacedWholeBox = value.trim() === pasted.trim();
      if (replacedWholeBox && (looksLikeMetadataBundle(value) || looksLikePlan(value))) {
        setShowParseHint(false);
        void parsePlan(value);
      } else {
        setShowParseHint(true);
      }
    }, 0);
  };
  ```

  The textarea (`:396-413`) has `aria-label="Plan text"`, `value={draftInput}`,
  `onChange={(e) => { setInput(e.target.value); … }}` and `onPaste={handlePaste}`.
  The hint paragraph (`:415-419`) renders the text
  `Press Parse (⌘⏎ / Ctrl+Enter) when ready.` while `showParseHint` is true.
  The panel body (and so the textarea) is only rendered while the input panel
  is expanded.

  Module-level constants sit near the top of the file, e.g. `:46-47`:
  ```ts
  /** Marks a top-bar button's text as collapsible (see `useTopBarMode`). */
  const topBarLabelProps = { [TOP_BAR_LABEL_ATTR]: '' };
  ```

- Why the values differ: the HTML specification makes `textarea.value` return
  line breaks as LF regardless of what was inserted; `clipboardData.getData('text')`
  returns the clipboard text untouched. jsdom (the test environment) implements
  the same normalisation, so the bug reproduces in a unit test.

- The parsers themselves already accept CRLF (text parsers normalise line
  endings), so only this comparison is affected.

- There is no existing test for the paste behaviour. `InputPanel` is rendered
  in one existing test, `src/components/__tests__/inactiveNodes.test.tsx`,
  inside the real provider:
  ```tsx
  import { InputPanel } from '../InputPanel';
  import { installLayoutShims, loadPlan, renderPlanContext } from '../ui/__tests__/planContext';
  …
  act(() => ctx().setInputPanelCollapsed(false));
  ```
  `renderPlanContext(ui)` (from `src/components/ui/__tests__/planContext.tsx`)
  renders `ui` inside `ToastProvider` / `ConfirmProvider` / `PlanProvider` and
  returns a handle whose `current()` is the context value. `SIMPLE_PLAN`, a
  minimal two-operation DBMS_XPLAN text with `Plan hash value: 1234567890`, is
  exported from the same helper file.

- Conventions: TypeScript strict; `import type` for type-only imports; tests
  are vitest (`import { describe, it, expect } from 'vitest'`), no Testing
  Library (helpers in `src/components/ui/__tests__/testUtils.tsx`); synthetic
  plan text for tests is written inline or taken from `SIMPLE_PLAN`, never
  added to the parser fixture directory (those are real Oracle captures).

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Install | `npm ci` | exit 0 |
| Lint | `npm run lint` | exit 0 |
| Typecheck | `npm run typecheck` | exit 0, no output after the script header |
| This test file | `npx vitest run --environment jsdom src/components/__tests__/InputPanelPaste.test.tsx` | all pass |
| All tests | `npm test` | builds the core package, then vitest; baseline `Test Files  155 passed (155)`, `Tests  1787 passed (1787)`, ~15 s |

## Scope

**In scope** (the only files you should modify):
- `src/components/InputPanel.tsx` (one helper line + the comparison in `handlePaste`)
- `src/components/__tests__/InputPanelPaste.test.tsx` (create)

**Out of scope** (do NOT touch):
- The rule itself ("the paste must replace the whole box and look like a plan
  or a metadata bundle") — a paste appended to existing text must still only
  show the hint.
- `looksLikePlan` (`src/lib/formats.ts`), `looksLikeMetadataBundle`, the parsers.
- The value passed to `parsePlan(value)` — keep passing the textarea value.
- `site/docs.html` — the docs do not describe this convenience; nothing to update.

## Git workflow

- Branch: `fix/crlf-paste-auto-parse`
- Conventional-commit message, like the repo's
  `fix(lint): satisfy eslint-plugin-react-hooks 7.1 / react-refresh 0.5`. Suggested:
  `fix(input): parse a pasted plan immediately when the clipboard uses CRLF`
- Do NOT push or open a PR unless the operator instructed it.

## Steps

### Step 1: Add the tests (one fails)

Create `src/components/__tests__/InputPanelPaste.test.tsx`:

```tsx
import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { InputPanel } from '../InputPanel';
import { cleanup } from '../ui/__tests__/testUtils';
import { SIMPLE_PLAN, renderPlanContext } from '../ui/__tests__/planContext';
import type { PlanHandle } from '../ui/__tests__/planContext';

const HINT = 'Press Parse';

function mountPanel(): { handle: PlanHandle; textarea: HTMLTextAreaElement } {
  const handle = renderPlanContext(<InputPanel />);
  act(() => handle.current().setInputPanelCollapsed(false));
  const textarea = document.querySelector<HTMLTextAreaElement>('textarea[aria-label="Plan text"]')!;
  expect(textarea).not.toBeNull();
  return { handle, textarea };
}

/**
 * What a browser does on Ctrl+V: a `paste` event carrying the raw clipboard
 * text, then the text lands in the textarea (whose `.value` always reports LF
 * line endings) and an `input` event fires.
 */
async function paste(textarea: HTMLTextAreaElement, clipboardText: string, resultingValue = clipboardText) {
  await act(async () => {
    const event = new Event('paste', { bubbles: true, cancelable: true });
    Object.defineProperty(event, 'clipboardData', { value: { getData: () => clipboardText } });
    textarea.dispatchEvent(event);

    const setValue = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!;
    setValue.call(textarea, resultingValue);
    textarea.dispatchEvent(new Event('input', { bubbles: true }));

    // handlePaste looks at the result on the next macrotask; parsing is async.
    await new Promise((resolve) => setTimeout(resolve, 20));
  });
}

beforeEach(() => {
  localStorage.clear();
  window.history.replaceState(null, '', '/');
});
afterEach(() => {
  cleanup();
  localStorage.clear();
});

describe('InputPanel paste', () => {
  it('parses a pasted plan straight away', async () => {
    const { handle, textarea } = mountPanel();
    await paste(textarea, SIMPLE_PLAN);
    expect(handle.current().parsedPlan?.planHashValue).toBe('1234567890');
    expect(document.body.textContent).not.toContain(HINT);
  });

  it('parses a pasted plan whose clipboard text has Windows (CRLF) line endings', async () => {
    const { handle, textarea } = mountPanel();
    const crlf = SIMPLE_PLAN.replace(/\n/g, '\r\n');
    expect(crlf).toContain('\r\n');
    await paste(textarea, crlf);
    // The textarea reports LF, so the comparison must not depend on line endings.
    expect(textarea.value).not.toContain('\r');
    expect(handle.current().parsedPlan?.planHashValue).toBe('1234567890');
    expect(document.body.textContent).not.toContain(HINT);
  });

  it('only hints when the paste is added to existing text', async () => {
    const { handle, textarea } = mountPanel();
    await paste(textarea, SIMPLE_PLAN, `-- my notes\n${SIMPLE_PLAN}`);
    expect(handle.current().parsedPlan).toBeNull();
    expect(document.body.textContent).toContain(HINT);
  });

  it('only hints when the pasted text is not a plan', async () => {
    const { handle, textarea } = mountPanel();
    await paste(textarea, 'select * from dual');
    expect(handle.current().parsedPlan).toBeNull();
    expect(document.body.textContent).toContain(HINT);
  });
});
```

(The native `value` setter is used because React tracks the input's value; a
plain `textarea.value = …` would not trigger `onChange`.)

**Verify**: `npx vitest run --environment jsdom src/components/__tests__/InputPanelPaste.test.tsx`
→ 1 failed, 3 passed. The failing one is
`parses a pasted plan whose clipboard text has Windows (CRLF) line endings`
(`expected undefined to be '1234567890'`).

### Step 2: Compare line-ending-blind

In `src/components/InputPanel.tsx`:

1. Add a module-level helper directly above the comment
   `/** Marks a top-bar button's text as collapsible (see `useTopBarMode`). */`:

   ```ts
   /** CRLF / lone CR line endings to LF. */
   const toLf = (text: string): string => text.replace(/\r\n?/g, '\n');
   ```

2. In `handlePaste` replace

   ```ts
      const replacedWholeBox = value.trim() === pasted.trim();
   ```

   with

   ```ts
      // The clipboard keeps its own line endings (CRLF from Windows apps);
      // textarea.value always reports LF. Compare them line-ending-blind.
      const replacedWholeBox = toLf(value).trim() === toLf(pasted).trim();
   ```

Change nothing else in `handlePaste`.

**Verify**: `npx vitest run --environment jsdom src/components/__tests__/InputPanelPaste.test.tsx`
→ `Tests  4 passed (4)`.

### Step 3: Full gates

**Verify**: `npm run lint` → exit 0; `npm run typecheck` → exit 0;
`npm test` → all pass, 1 more test file and 4 more tests than before this plan.

## Test plan

- New file `src/components/__tests__/InputPanelPaste.test.tsx` (code in Step 1;
  structural pattern: the `InputPanel` cases in
  `src/components/__tests__/inactiveNodes.test.tsx` for mounting, and the
  helper file `src/components/ui/__tests__/planContext.tsx`):
  1. LF clipboard, whole box → parsed immediately, no hint (pins today's behaviour);
  2. CRLF clipboard, whole box → parsed immediately, no hint — **the regression test**;
  3. paste added to existing text → not parsed, hint shown (rule unchanged);
  4. pasted text that is not a plan → not parsed, hint shown (rule unchanged).
- Verification: `npx vitest run --environment jsdom src/components/__tests__/InputPanelPaste.test.tsx` → 4 passed.

## Done criteria

Machine-checkable. ALL must hold:

- [ ] `npx vitest run --environment jsdom src/components/__tests__/InputPanelPaste.test.tsx` → 4 passed, 0 failed
- [ ] `grep -c "value.trim() === pasted.trim()" src/components/InputPanel.tsx` prints `0`
- [ ] `grep -c "toLf(value).trim() === toLf(pasted).trim()" src/components/InputPanel.tsx` prints `1`
- [ ] `grep -c "void parsePlan(value);" src/components/InputPanel.tsx` prints `1` (the parsed value is unchanged)
- [ ] `npm run lint` exits 0
- [ ] `npm run typecheck` exits 0
- [ ] `npm test` exits 0 (baseline + 1 file, + 4 tests)
- [ ] `git status --porcelain` lists only `src/components/InputPanel.tsx` and `src/components/__tests__/InputPanelPaste.test.tsx` (plus `plans/README.md`)
- [ ] `plans/README.md` status row updated

## STOP conditions

Stop and report back (do not improvise) if:

- `handlePaste` no longer contains `const replacedWholeBox = value.trim() === pasted.trim();`.
- In Step 1 the CRLF test passes before the fix (the environment no longer
  normalises `textarea.value`) — report the output instead of forcing a failure.
- In Step 1 any of the other three tests fails before the fix — the test
  harness assumption (how a paste is simulated) is wrong; report which one.
- `textarea[aria-label="Plan text"]` is not found after
  `setInputPanelCollapsed(false)` (the panel markup changed).
- A step's verification fails twice after a reasonable fix attempt.

## Maintenance notes

- If the paste check is ever loosened (for example "the paste replaced the
  current selection and the result looks like a plan"), keep the
  line-ending-blind comparison and tests 3 and 4.
- The same class of mismatch can appear anywhere clipboard or file text is
  compared with a form control's value; grep for `clipboardData.getData` when
  adding such code (today `InputPanel.tsx` is the only place that compares).
- Reviewer: one-line behavioural change; confirm the hint still appears for a
  partial paste on the hosted app by hand if in doubt.
