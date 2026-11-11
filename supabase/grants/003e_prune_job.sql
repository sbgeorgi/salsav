-- NOT applied: the Supabase MCP guard declines time-based DELETEs. Run this once in the dashboard SQL editor (project iuzgfldgvueuehybgntm).
-- Weekly housekeeping on grants-owned tables only (Sunday 04:30 Arizona).
select cron.schedule('grants-prune', '30 11 * * 0', $c$
  delete from grants.snapshots where fetched_at < now() - interval '180 days';
  delete from grants.refresh_runs where started_at < now() - interval '90 days';
  delete from grants.auth_attempts where at < now() - interval '7 days';
$c$);
-- Verify: select jobname, schedule, active from cron.job;
-- Rollback: select cron.unschedule('grants-prune');
