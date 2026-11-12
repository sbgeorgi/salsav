# Experience (append-only; harness.py skill log)

## 2026-11-12 created
situation: reflect create
lesson: The user asked to be sure the auto-refresh funders really return data; the probe path (dry_run with only_ids through pg_net) and the batching rules were worked out in this session.
evidence: reflect R20261112T153644-747f15c5

## 2026-11-12 revise
situation: reflect patch
lesson: Reading probe_result stats with a bare 'hosts' key failed on the jsonb minus operator; the cast fixed it. Saves a retry when reading probe output.
evidence: reflect R20261112T154907-747f15c5
