# Changelog

Notable changes per release. Each [GitHub release](https://github.com/davidbudac/ora-explain-plan-viz/releases) also attaches the whole app as one self-contained `oraplanviz-vX.Y.Z.html`.

## 1.4.0 — 2026-11-08

- **Client report is a facts-only handover** ([#121](https://github.com/davidbudac/ora-explain-plan-viz/pull/121)): no client / prepared-by fields (and they are no longer remembered), no executive summary or stat cards, advisor findings without recommendation text; optimizer-note tags moved into Execution Details.
- Dependencies: React 19.3, @xyflow/react 12.12, Tailwind 4.3, marked 18.1, highlight.js 11.12, Anthropic SDK 0.137 and more ([#119](https://github.com/davidbudac/ora-explain-plan-viz/pull/119), [#120](https://github.com/davidbudac/ora-explain-plan-viz/pull/120)); GitHub Actions to current majors ([#113](https://github.com/davidbudac/ora-explain-plan-viz/pull/113)).
- Lint clean under eslint-plugin-react-hooks 7.1 (refs no longer written during render) ([#119](https://github.com/davidbudac/ora-explain-plan-viz/pull/119)).
- Dev-only security fix: `minimatch` ≥ 11.0.1 under typescript-eslint ([#122](https://github.com/davidbudac/ora-explain-plan-viz/pull/122)). Dependabot no longer proposes major-version upgrades.
- README leads with the single self-contained HTML file ([#123](https://github.com/davidbudac/ora-explain-plan-viz/pull/123)).

## 1.3.1 — 2026-11-08

- MIT `LICENSE` file; `CONTRIBUTING.md`, `SECURITY.md`, issue and PR templates, Dependabot.
- Security: `dompurify` 3.4.17 (DOM XSS advisories) and `zod` 4.6.7.
- Docker: one `docker-compose.yml` (the extra `compose.yaml` hid the `agent` profile); `PORT` and `APP_BASE_PATH` are configurable.
- Promo-video tooling moved out of the repository.

## 1.3.0 — 2026-11-08

- Hints lens on the SQL tab is a stay-put toggle ([#104](https://github.com/davidbudac/ora-explain-plan-viz/pull/104)).
- Removed the hosted AI provider; the Anthropic, OpenAI-compatible and local-connector providers remain ([#105](https://github.com/davidbudac/ora-explain-plan-viz/pull/105)).
- Repository slimmed for public release: history rewritten without large media and internal docs; `packages/ora-plan-core/dist` is built, not committed.

## 1.2.0 — 2026-11-06

- Open a schema object in the Metadata view straight from the node details panel ([#103](https://github.com/davidbudac/ora-explain-plan-viz/pull/103)).

## 1.1.1 — 2026-10-27

- Metadata gather script prints valid JSON; import keeps only the JSON ([#102](https://github.com/davidbudac/ora-explain-plan-viz/pull/102)).

## 1.1.0 — 2026-10-26

First GitHub release, and the first with the single-file `oraplanviz-v1.1.0.html` build. It collects everything merged up to then; see the [release notes](https://github.com/davidbudac/ora-explain-plan-viz/releases/tag/v1.1.0) for the full PR list.
