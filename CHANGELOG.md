# Changelog

Notable changes per release. Each [GitHub release](https://github.com/davidbudac/ora-explain-plan-viz/releases) also attaches the whole app as one self-contained `oraplanviz-vX.Y.Z.html`.

## Unreleased

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
