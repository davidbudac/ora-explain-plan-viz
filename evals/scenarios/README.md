# Scenario corpus

Scenarios (`NN-name/{setup.sql,query.sql,expect.json}`) are not committed:
directories under this folder are gitignored, so each checkout brings its own.
The harness, loader (`evals/lib/scenarios.ts`) and its unit tests validate
whatever scenarios are present locally. See `evals/README.md` for the file
format.
