# Plan 020: The `/welcome/` pages use a precompiled stylesheet instead of the Tailwind Play CDN script

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**:
> `git diff --stat b5635d8..HEAD -- site/index.html site/docs.html package.json CLAUDE.md`
> If any in-scope file changed since this plan was written, compare the
> "Current state" excerpts against the live code before proceeding; on a
> mismatch, treat it as a STOP condition. Other plans may have landed first
> and shifted line numbers; match on the quoted code, not the line number.
> Several other plans edit the body text of `site/docs.html` (plans 007, 008,
> 018, 019) and add npm scripts or lines to `CLAUDE.md`; that is expected.
> This plan only replaces lines 16–28 of each site page's `<head>`. If other
> plans changed class names in the pages, nothing special is needed: Step 3
> compiles whatever classes the pages use at that moment.

## Status

- **Priority**: P3
- **Effort**: S–M
- **Risk**: LOW (visual-only pages; needs one human look at the result)
- **Depends on**: none
- **Category**: security
- **Planned at**: commit `b5635d8`, 2026-11-11

## Why this matters

The two showcase pages (`site/index.html`, `site/docs.html`) style themselves
by loading `https://cdn.tailwindcss.com` — Tailwind's "Play CDN", a script that
compiles CSS in the browser, is meant for prototypes, can change at any time
and cannot be integrity-pinned. The deploy workflow copies `site/` to
`/welcome/` on the **same origin** as the app, and the app keeps users'
autosaved plans (SQL text, object names, bind values) in that origin's
`localStorage` (`oraplanviz.session.v1`, `oraplanviz.recent.v1`). A
compromised or altered CDN response would therefore run with access to every
visitor's stored plans after a single visit to the docs. Replacing the script
with a static stylesheet built ahead of time removes third-party script
execution from the origin entirely (and the pages render without a flash of
unstyled content).

## Current state

- `site/index.html` (476 lines) and `site/docs.html` (1,172 lines) are
  hand-written static pages. `.github/workflows/deploy.yml` publishes them
  with `cp -R site dist/welcome`. Both have the same block in `<head>`:
  ```html
  13	<link rel="preconnect" href="https://fonts.googleapis.com">
  14	<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  15	<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500;600&display=swap" rel="stylesheet">
  16	<script src="https://cdn.tailwindcss.com"></script>
  17	<script>
  18	  tailwind.config = {
  19	    theme: {
  20	      extend: {
  21	        fontFamily: {
  22	          mono: ['JetBrains Mono', 'ui-monospace', 'SFMono-Regular', 'Menlo', 'Consolas', 'monospace'],
  23	          sans: ['Inter', 'system-ui', '-apple-system', 'Segoe UI', 'Roboto', 'Helvetica', 'Arial', 'sans-serif'],
  24	        },
  25	      },
  26	    },
  27	  };
  28	</script>
  29	
  30	<style>
  31	  body { background: #0b0f17; }
  ```
  After that comes one hand-written `<style>` block per page (classes such as
  `.shot`, `.aspect-16-10`, `.code-k` in `index.html`; `.doc …`, `.toc …` in
  `docs.html`). It stays untouched.
- What the pages use from Tailwind: ordinary utility classes only (181
  distinct class tokens across both pages), including arbitrary values such as
  `bg-[#0b0f17]/90`, `tracking-[-0.02em]`, `max-h-[calc(100vh-7rem)]`,
  `lg:grid-cols-[15rem_minmax(0,1fr)]`, and `text-balance`. No `@apply`, no
  `<style type="text/tailwindcss">`, no Tailwind plugins. The only config is
  the `fontFamily` extension shown above.
- The remaining `<script>` blocks at the bottom of each page are inline,
  same-origin code (app links, copy buttons, table of contents). They only add
  hand-written classes (`copy`, `active`) and stay untouched.
- Tailwind versions: `cdn.tailwindcss.com` serves Tailwind **v3** (3.4.x).
  The app itself uses Tailwind **v4** (`tailwindcss` / `@tailwindcss/vite` in
  `package.json`), whose defaults and class set differ. To keep the pages
  looking the same, this plan compiles with the Tailwind **v3** command-line
  tool, pinned to `3.4.19` (the current `v3-lts` release) and run through
  `npx`, so no dependency is added to `package.json` and the app's v4 setup
  is not touched.
- Why a committed stylesheet (and not a build step in the deploy workflow):
  the pages keep working when opened from disk or served by any static host,
  the deploy does not start downloading and running an extra package, and the
  CSS diff is reviewable. The cost is that the CSS can go stale when someone
  edits classes in the HTML; a test added here catches that without needing
  Tailwind or the network.
- Cascade order: the new `<link>` goes where the CDN `<script>` was, before
  the page's own `<style>` block. For today's markup the order of the two
  cannot change the result: every element that carries one of the
  single-class hand-written rules (`shot`, `aspect-16-10`, `code-k`, `code-n`,
  `code-c`) carries no Tailwind utility, and all other hand-written rules are
  descendant selectors (`.doc …`, `.toc …`) that outrank a single utility
  class either way.
- CI note: `.github/workflows/ci.yml` skips lint/typecheck/tests for pull
  requests that touch only `site/**`, root `*.md`, `docs/**` or `LICENSE`.
  This plan also touches `package.json`, `scripts/` and `src/`, so CI runs in
  full for it. Later site-only PRs skip the new test on the PR, but every
  push to `main` runs it.
- Conventions: tests are vitest with explicit imports, no Testing Library;
  tests that read repository files use `node:fs` + `__dirname` (exemplar
  `src/lib/__tests__/planToJsonScript.test.ts`:
  `const scripts = join(__dirname, '../../../scripts');` then
  `readFileSync(join(scripts, 'plan_to_json.sql'), 'utf-8')`). `eslint .`
  lints only `*.ts`/`*.tsx`, so a `.cjs` config file is not linted.
  `CLAUDE.md` has a "Keep in sync (same change)" list for "edit X → run Y"
  rules.

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Install | `npm ci` | exit 0 |
| Build the site CSS (added in Step 2; needs access to the npm registry) | `npm run build:site-css` | prints `Done in …ms.`, writes `site/assets/site.css` |
| Site test (added in Step 1) | `npx vitest run --environment jsdom src/lib/__tests__/siteCss.test.ts` | `Tests 3 passed (3)` |
| Lint | `npm run lint` | exit 0 |
| Typecheck | `npm run typecheck` | exit 0 |
| All tests | `npm test` | all files pass (baseline at `b5635d8`: `Test Files 155 passed (155)`, `Tests 1787 passed (1787)`) |

A harmless `Browserslist: caniuse-lite is outdated` notice from the Tailwind
CLI can be ignored.

## Scope

**In scope** (the only files you should modify or create):

- `site/index.html` (lines 16–28 of `<head>` only)
- `site/docs.html` (lines 16–28 of `<head>` only)
- `site/assets/site.css` (create — generated, committed)
- `scripts/site/tailwind.config.cjs` (create)
- `scripts/site/tailwind.css` (create)
- `package.json` (one new script line)
- `src/lib/__tests__/siteCss.test.ts` (create)
- `CLAUDE.md` (one new bullet under "Keep in sync (same change)")

**Out of scope** (do NOT touch, even though they look related):

- The Google Fonts `<link>` tags of the site pages — stylesheets, not
  scripts; unchanged here.
- The pages' own `<style>` blocks, their inline `<script>` blocks, and every
  `class="…"` attribute — no markup or class changes.
- The app's Tailwind v4 setup (`src/index.css`, `vite.config.ts`, the
  `tailwindcss` / `@tailwindcss/vite` dependencies).
- `.github/workflows/*.yml`.
- `docs/diagrams/*.html` (standalone diagram sources, not deployed).

## Git workflow

- Branch: `fix/site-css-without-cdn`
- Conventional-commit message, e.g.
  `fix(site): ship a precompiled stylesheet instead of the Tailwind Play CDN script`
- Do NOT push or open a PR unless the operator instructed it.

## Steps

### Step 1: Add the failing test

Create `src/lib/__tests__/siteCss.test.ts` with exactly:

```ts
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const site = join(__dirname, '../../../site');
const PAGES = ['index.html', 'docs.html'];
const read = (file: string) => readFileSync(join(site, file), 'utf-8');

/**
 * Regex source matching a class name as Tailwind writes it in a selector:
 * `sm:py-1.5` -> `sm\:py-1\.5`; a comma -> `\2c ` and a leading digit -> `\3N `
 * (hex escapes; the minifier drops the trailing space when it is not needed).
 */
function selectorPattern(name: string): string {
  return [...name]
    .map((ch, i) => {
      if (i === 0 && /\d/.test(ch)) return `\\\\3${ch} ?`;
      if (/[A-Za-z0-9_-]/.test(ch)) return ch;
      if (ch === ',') return '\\\\2c ?';
      return `\\\\${ch.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')}`;
    })
    .join('');
}

/** True when `css` has a selector for the class (not just a longer class starting with it). */
const hasClassRule = (css: string, name: string) =>
  new RegExp(`\\.${selectorPattern(name)}(?![A-Za-z0-9_\\\\-])`).test(css);

describe('site/ pages', () => {
  it('load no script from another host', () => {
    for (const page of PAGES) {
      const external = [...read(page).matchAll(/<script\b[^>]*\bsrc\s*=\s*["']?((?:https?:)?\/\/[^"'\s>]+)/gi)].map(
        (m) => m[1],
      );
      expect(external, page).toEqual([]);
    }
  });

  it('link the compiled stylesheet', () => {
    for (const page of PAGES) expect(read(page), page).toContain('<link rel="stylesheet" href="assets/site.css">');
  });

  it('have a CSS rule for every class they use (run `npm run build:site-css` after editing classes)', () => {
    const compiled = read('assets/site.css');
    for (const page of PAGES) {
      const html = read(page);
      // The page's own <style> blocks define its hand-written classes (.doc, .shot, ...).
      const css = compiled + [...html.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/gi)].map((m) => m[1]).join('\n');
      const used = new Set([...html.matchAll(/\bclass="([^"]*)"/g)].flatMap((m) => m[1].split(/\s+/).filter(Boolean)));
      const missing = [...used].filter((name) => !hasClassRule(css, name)).sort();
      expect(missing, page).toEqual([]);
    }
  });
});
```

**Verify**: `npx vitest run --environment jsdom src/lib/__tests__/siteCss.test.ts`
→ `Tests 3 failed (3)` (CDN script found; no stylesheet link; `site.css` missing).

### Step 2: Add the Tailwind v3 build inputs and the npm script

1. Create `scripts/site/tailwind.config.cjs`:

   ```js
   // Tailwind v3 config for the static showcase pages (site/*.html).
   // Compiled into site/assets/site.css by `npm run build:site-css` (run from the repo root).
   module.exports = {
     content: ['./site/*.html'],
     theme: {
       extend: {
         fontFamily: {
           mono: ['JetBrains Mono', 'ui-monospace', 'SFMono-Regular', 'Menlo', 'Consolas', 'monospace'],
           sans: ['Inter', 'system-ui', '-apple-system', 'Segoe UI', 'Roboto', 'Helvetica', 'Arial', 'sans-serif'],
         },
       },
     },
   };
   ```

   (The `fontFamily` block is copied verbatim from the pages' inline
   `tailwind.config`; if the two pages' inline configs differ from each other
   or from this, STOP.)

2. Create `scripts/site/tailwind.css` with exactly these three lines:

   ```css
   @tailwind base;
   @tailwind components;
   @tailwind utilities;
   ```

3. In `package.json`, add after the `"build:single"` line:

   ```json
       "build:site-css": "npx -y tailwindcss@3.4.19 -c scripts/site/tailwind.config.cjs -i scripts/site/tailwind.css -o site/assets/site.css --minify",
   ```

**Verify**: `node -e "JSON.parse(require('fs').readFileSync('package.json','utf8'))"` → exit 0.

### Step 3: Generate the stylesheet

Run `npm run build:site-css` from the repository root.

**Verify**: `wc -c < site/assets/site.css` → between 10,000 and 30,000 (at
the planned commit: 14,026); `grep -c "text-wrap:balance" site/assets/site.css` → `1`;
`grep -c "JetBrains Mono" site/assets/site.css` → `1`.

### Step 4: Switch both pages to the stylesheet

In `site/index.html` and in `site/docs.html`, replace lines 16–28 — from
`<script src="https://cdn.tailwindcss.com"></script>` through the `</script>`
that closes the `tailwind.config = { … };` block — with the single line:

```html
<link rel="stylesheet" href="assets/site.css">
```

Leave the blank line and the `<style>` block that follow.

**Verify**:
- `grep -c "cdn.tailwindcss.com\|tailwind.config" site/index.html site/docs.html` → `0` for both files
- `npx vitest run --environment jsdom src/lib/__tests__/siteCss.test.ts` → `Tests 3 passed (3)`
- `git diff --stat -- site/index.html site/docs.html` → each file: 1 insertion, 13 deletions

### Step 5: Prove the stale-CSS check works

Temporarily change `<body class="text-slate-300 font-sans antialiased">` in
`site/index.html` to `<body class="text-slate-300 font-sans antialiased mt-[13px]">`
(do **not** rebuild the CSS) and run the site test → the third test fails and
lists `mt-[13px]`. Then undo that edit by hand (restore the original
`<body …>` line) and re-run → 3 pass.

**Verify**: `grep -c 'mt-\[13px\]' site/index.html` → `0` and the site test passes.

### Step 6: Record the rule for future edits

In `CLAUDE.md`, under the heading `## Keep in sync (same change)`, add the bullet:

```
- Edit classes in `site/*.html` → run `npm run build:site-css` and commit `site/assets/site.css` (a test fails otherwise; the pages load no CDN script).
```

**Verify**: `grep -c "build:site-css" CLAUDE.md` → `1`.

### Step 7: Full check

**Verify**: `npm run lint` → exit 0; `npm run typecheck` → exit 0; `npm test`
→ all pass, with one more test file and three more tests than before this plan.

### Step 8: Hand over for the visual check (operator)

You cannot verify appearance. In your report, ask the operator to compare, in
one browser at desktop width and once at phone width:

| Before (still CDN-styled until the next deploy) | After (this branch, opened from disk) |
|---|---|
| `https://davidbudac.github.io/ora-explain-plan-viz/welcome/` | `site/index.html` |
| `https://davidbudac.github.io/ora-explain-plan-viz/welcome/docs.html` | `site/docs.html` |

Things to look at: header and hero spacing, the feature cards and
screenshots, the input-format grid, the docs sidebar (sticky, active entry
highlighted while scrolling), code blocks with the Copy button, tables, and
the mobile table-of-contents `<select>`.

**Verify**: your report contains this request. Mark the plan DONE only with
the note "visual check pending" unless the operator has confirmed.

## Test plan

- New `src/lib/__tests__/siteCss.test.ts` (Step 1), 3 tests:
  - `load no script from another host` — the regression test for this plan.
  - `link the compiled stylesheet`.
  - `have a CSS rule for every class they use` — fails when a class used in
    the HTML has no rule in `site/assets/site.css` or the page's own
    `<style>` block (stale or missing CSS). Proven by Step 5.
- Pattern: `src/lib/__tests__/planToJsonScript.test.ts` (reads repository
  files with `node:fs`).
- Not machine-checkable: visual parity (Step 8).

## Done criteria

- [ ] `npm run lint`, `npm run typecheck`, `npm test` exit 0
- [ ] `grep -rn "cdn.tailwindcss.com" site` prints nothing
- [ ] `grep -c '<link rel="stylesheet" href="assets/site.css">' site/index.html site/docs.html` prints `1` for each file
- [ ] `test -s site/assets/site.css` succeeds and the file is tracked (`git status --porcelain site/assets/site.css` shows it as added)
- [ ] `git diff b5635d8 -- site/index.html site/docs.html | grep -c '^[-+].*class='` prints `0` (no class attribute changed by this plan; if other plans changed classes, compare against the commit you started from instead)
- [ ] `grep -c "tailwindcss@3" package.json` prints `1`, and `git diff -- package.json` shows no change under `dependencies` / `devDependencies`
- [ ] `git status --porcelain` lists only the eight in-scope paths
- [ ] The report asks the operator for the visual comparison of Step 8
- [ ] `plans/README.md` status row updated

## STOP conditions

Stop and report back (do not improvise) if:

- Either page's `<head>` does not match the excerpt, the two inline
  `tailwind.config` blocks differ, or a page contains
  `<style type="text/tailwindcss">`, `@apply`, `@tailwind`, `theme(` or a
  `?plugins=` parameter on the CDN URL — those are Play-CDN features this plan
  does not reproduce.
- `npm run build:site-css` fails (for example no access to the npm registry).
  Do not substitute Tailwind v4 or hand-write the CSS.
- After Step 4 the third test lists missing classes. That means the pages use
  a class Tailwind 3.4 does not generate from static text (for example a
  class name assembled by JavaScript). Report the list; do not add an
  allow-list to the test.
- An element combines `shot`, `aspect-16-10`, `code-k`, `code-n` or `code-c`
  with Tailwind utility classes
  (`grep -o 'class="[^"]*\b\(shot\|aspect-16-10\|code-[knc]\)\b[^"]*"' site/index.html | sort -u`
  shows anything other than those names plus `zoom-c` / `zoom-r`): then the
  position of the `<link>` relative to the page's `<style>` block matters and
  needs a human decision.

## Maintenance notes

- `site/assets/site.css` is generated: never edit it by hand. After changing
  classes in `site/*.html`, run `npm run build:site-css` and commit the
  result; the test's third case fails otherwise. Because site-only pull
  requests skip CI, that failure may first show on `main` — run the site test
  locally before merging site edits.
- The output can differ by a few vendor prefixes between machines or dates
  (the Tailwind CLI's autoprefixer data is resolved at run time), so the test
  checks class coverage, not bytes. A noisy CSS diff with unchanged HTML is
  harmless.
- The pinned `tailwindcss@3.4.19` is fetched by `npx` on demand; it is not in
  `package-lock.json`. If hermetic builds are wanted, add it as an aliased
  devDependency (`"tailwindcss-v3": "npm:tailwindcss@3.4.19"`) and call its
  CLI from `node_modules` instead.
- Migrating the site pages to Tailwind v4 (to share the app's toolchain) is a
  separate, visual-risk task; do it only together with a side-by-side check.
- The pages still load web fonts from Google Fonts (stylesheets, no script
  execution).
- Reviewers: check that the HTML diff is only the 13-line head block per
  page, and look at both pages once.
