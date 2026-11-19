# Contributing

Thanks for helping improve the Oracle Execution Plan Visualizer. Bug reports, plan samples that don't parse, and pull requests are all welcome.

## Reporting a problem

- **A plan doesn't parse or looks wrong?** Open a [bug report](https://github.com/davidbudac/ora-explain-plan-viz/issues/new?template=bug.yml) with the plan text. Remove anything sensitive first: table names, literals in predicates, bind values and the SQL text can all be replaced with placeholders as long as the plan's shape stays the same.
- **Security issue?** Don't open a public issue. See [SECURITY.md](SECURITY.md).
- **Question or idea?** Use [Discussions](https://github.com/davidbudac/ora-explain-plan-viz/discussions).

## Development setup

Node 22 (what CI uses) and npm:

```bash
git clone https://github.com/davidbudac/ora-explain-plan-viz.git
cd ora-explain-plan-viz
npm install
npm run dev          # http://localhost:5173
```

Before opening a PR, run the same three checks CI runs:

```bash
npm run lint
npm run typecheck
npm test             # builds packages/ora-plan-core first, then runs vitest
```

[`CLAUDE.md`](CLAUDE.md) is the project guide: where code lives, the Oracle semantics the code relies on, invariants and gotchas. It's written for coding agents but is just as useful for people.

## Ground rules

- **Parser fixtures are real Oracle output.** Files in `src/lib/parser/__tests__/fixtures/` are captures from a real database (mostly 19c), not hand-written. If you add one, say in the PR which Oracle version and which call (`DISPLAY_CURSOR` format, `REPORT_SQL_MONITOR` type, …) produced it. Synthetic plans for unit tests belong in `src/lib/__tests__/fixtures/buildPlan.ts`.
- **Examples parse cleanly.** Bundled examples (`src/examples/NN-category-Name.txt`) must parse with no warnings; a test checks this.
- **Keep Oracle's numbers honest.** E-Rows is per start, A-Rows is cumulative, cost is cumulative; see "Oracle semantics" in `CLAUDE.md` before touching any ratio or total.
- **Nothing leaves the browser.** The app has no backend. Don't add network calls, analytics or third-party scripts. Network code is limited to the optional local DB connector client (`src/lib/agent/client.ts`) and the AI providers (`src/lib/ai/providers/`), which send only when the user clicks Run; `src/lib/__tests__/networkBoundary.test.ts` fails if a network API appears anywhere else.
- **User-facing changes update the docs.** If a feature ships or changes, update `site/docs.html` (and the landing page if relevant) in the same PR.
- **Style:** TypeScript strict, React function components and hooks, Tailwind for styling, `import type` for type-only imports.

## Pull requests

- One topic per PR; small is better.
- Add or update tests for behaviour changes.
- Describe what changed and how you verified it. Screenshots help for UI changes.
- By contributing you agree your work is released under the [MIT License](LICENSE).
