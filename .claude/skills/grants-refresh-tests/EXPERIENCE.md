# Experience (append-only; harness.py skill log)

## 2026-11-12 created
situation: reflect create
lesson: The edge function has no skill; this run measured which suites pass locally, which fail for environmental reasons, and why the deploy path needs care.
evidence: reflect R20261112T134818-747f15c5

## 2026-11-12 revise
situation: reflect patch
lesson: A deploy retyped escaped regex source into the MCP call, the stamp check denied it, and the gate now refuses escapes. Future deploys need this rule and the re-run-gate step.
evidence: reflect R20261112T141501-747f15c5

## 2026-11-12 revise
situation: reflect patch
lesson: Two crawler behaviours the run had to fix (route-hash loss in html list items, yearless deadline capture) are config and engine rules a future adapter edit must respect.
evidence: reflect R20261112T145055-a16f0c96

## 2026-11-12 revise
situation: reflect patch
lesson: A deploy of version 8 failed because the MCP tool reused version 7's import-map path; the retry succeeded only after passing import_map_path. The skill's deploy line does not mention this parameter, so the next deploy would hit the same failure.
evidence: reflect R20261112T153101-a16f0c96

## 2026-11-12 revise
situation: reflect patch
lesson: Running tests/engine.test.ts in this session failed with ECONNREFUSED because no local Postgres was running; the skill listed only the handler suites as needing one.
evidence: reflect R20261112T153644-747f15c5

## 2026-11-12 revise
situation: reflect patch
lesson: A worker deploying v10 sent partial file sets twice and was denied by the boundary-guard stamp hook; the full 19-file single call then succeeded. This is a repeatable deploy pitfall for this edge function and the skill already covers the gate and deploy steps.
evidence: reflect R20261112T162038-747f15c5
