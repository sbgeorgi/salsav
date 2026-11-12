# Experience (append-only; harness.py skill log)

## 2026-11-11 created
situation: reflect create
lesson: The hook rejected an 8338-character Bash command and the fix (Write a script file, then run it) worked; the limit is not documented in the harness rules and will recur on large migrations and tests.
evidence: reflect R20261111T221745-9671fccb

## 2026-11-11 revise
situation: reflect patch
lesson: A Bash rm with a relative glob after cd was blocked by the safety check, and the skill does not warn about removals.
evidence: reflect R20261111T222801-9671fccb

## 2026-11-12 revise
situation: reflect patch
lesson: Two attempts to write regex-bearing Python through Bash heredocs corrupted the backslashes, once halving them and once writing real control characters into the source files, so the fix is to write those files with Write or Edit.
evidence: reflect R20261112T134818-747f15c5
