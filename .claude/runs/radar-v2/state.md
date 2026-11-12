## Goal
Self-improving SALSAV funding radar. This phase: prove every auto (calls/cycle) funder extracts via the live edge function; fix broken configs; stop repeating empty fetches; explain missing completion notice.

## Files touched
grants-refresh engine.ts (probe report opps/open/text_len/sample; dry_run drops etag/last_modified) + tests/engine.test.ts; 019_probe_refresh{,-rollback}.sql; 020_idle_backoff{,-rollback}.sql; discovery-task.md (health 'empty' triage, final PushNotification step); .claude/skills/grants-collection-probe/SKILL.md; ~/.claude/hooks/scheduled-task-mode.py.

## Done
- 019 live (20261112153616); 020 live (20261112154724): rollback-only DO test showed streak 1/2/3 -> 23h/46h/46h, new content -> 11.5h, empty-calls health 'empty', re-verified -> 'ok'.
- v9 deployed (opps/open/text_len). Probes on v9: batch 1 (103) and grants.gov (104, 15/18 returned) saved in scratchpad/probe/r103-105.json.
- Notification: run local_1c3c9e64 never called PushNotification; task now ends with one.

## Decisions
- Backoff in SQL apply_fetch_result (idle_streak), cap 46h so health never reads 'stale' (3 days).
- Repo migration files keep NNN_ names; live version stamped in line 1.

## Pending
- v10 deploy worker (dry_run without validators) -> then add Fetched.raw_count (feed/API/html in adapters/index.ts) + SourceReport.raw in engine record(), gate, deploy v11.
- Re-probe all 9 batches ONE AT A TIME on v11 (concurrent probes -> 546 CPU Time exceeded kills all).
- Classify: opps>0 proven; opps 0 & raw>0 = watch waiting; raw 0 = check channel. Fix configs via set_collection.
- Commit + push funding-radar-v2.

## Errors & fixes
- 9 concurrent probes -> one worker, CPU Time exceeded, all 546; the 14:19 'cron' kick lost 4/8 shards the same way (cron-am/pm 16/16 ok).
- 020 alias `o` clashed with plpgsql var o -> aliases e/op.

## Current state
v10 deploy running in background; engine files must not change until it reports.

## Next step
On v10 notice: implement raw_count, run deploy_gate, launch v11 deploy worker, then probe batches sequentially from scratchpad/batches.out.
