# Experience (append-only; harness.py skill log)

## 2026-11-12 created
situation: reflect create
lesson: The 018 register_source change was done safely: live definition saved as rollback, patch tested in a DO block with exception-carried output, and applied under an md5 guard that matched the repo file. That procedure is reusable for every grants.* rewrite and was not written down anywhere.
evidence: reflect R20261112T135553-747f15c5

## 2026-11-12 revise
situation: reflect patch
lesson: A string-replace patch of apply_fetch_result added a loop alias o that clashed with a declared variable; the DO test rejected it and the alias had to be renamed before apply_migration succeeded.
evidence: reflect R20261112T154907-747f15c5
