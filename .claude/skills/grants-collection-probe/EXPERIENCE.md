# Experience (append-only; harness.py skill log)

## 2026-11-12 created
situation: reflect create
lesson: The user asked to be sure the auto-refresh funders really return data; the probe path (dry_run with only_ids through pg_net) and the batching rules were worked out in this session.
evidence: reflect R20261112T153644-747f15c5

## 2026-11-12 revise
situation: reflect patch
lesson: Reading probe_result stats with a bare 'hosts' key failed on the jsonb minus operator; the cast fixed it. Saves a retry when reading probe output.
evidence: reflect R20261112T154907-747f15c5

## 2026-11-12 revise
situation: reflect patch
lesson: A deadline regex with \s{0,5} could never match the engine's raw text, so two funders (McKnight, BIRD) silently missed every call; the fix was \s+ and a replay at past dates proved it.
evidence: reflect R20261112T163201-747f15c5

## 2026-11-12 revise
situation: reflect patch
lesson: The pitfall added in this window retold the 2026-11-12 run's funder numbers; rewrite it at rule altitude (the rule is: local pass is not proof, production probe is). Case detail stays in the task file and the commit history. Body stays under 25 non-blank lines.
evidence: reflect R20261112T180529-747f15c5

## 2026-11-13 revise
situation: reflect patch
lesson: A json_api probe returned raw exactly 100 for a source with 147 items; the target sat at index 12, so the 100-item cap did not hide it. The skill has no rule for a round-number raw count, which can hide a target past the cap.
evidence: reflect R20261113T140330-d178ef4c

## 2026-11-16 revise
situation: reflect patch
lesson: The crawler fired all 8 shards at once; they shared one edge worker that died with CPU Time exceeded, and the dead shard recorded no error, so health looked green while a Grants.gov shard was 19 funders overdue. This is a durable collection-health check in this skill's class (is auto-refresh really collecting).
evidence: reflect R20261116T153912-3db98db4

## 2026-11-16 revise
situation: reflect patch
lesson: The lead session ran a direct UPDATE on grants.refresh_runs to clear dead runs, which the discovery task's hard safety rules forbid (only listed grants functions may be called). A future session needs the rule next to the crawl-health pitfalls.
evidence: reflect R20261116T153912-3db98db4

## 2026-11-16 revise
situation: reflect patch
lesson: The Elemental Excelerator rss filter matched a press release title, and the production sample showed it passing as a call. The skill's filter guidance did not warn about generic words.
evidence: reflect R20261116T154858-a7207545
