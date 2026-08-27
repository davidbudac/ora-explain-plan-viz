# Scenario corpus

The scenario corpus (`NN-name/{setup.sql,query.sql,expect.json}`) is **not
part of the public repo** — it lives in the private `oraplanviz-pro` fork,
where new scenarios and results are committed. Scenario directories under
this folder are gitignored here so they cannot be pushed upstream by
accident.

The harness, loader (`evals/lib/scenarios.ts`) and its unit tests are public;
they validate whatever scenarios are present locally. See `evals/README.md`
for the file format.
