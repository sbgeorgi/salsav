-- 022: stop the twice-daily crawl from killing its own edge worker.
-- Evidence (2026-11-16): kick_refresh fired all 8 shards at once with up to 12 funders each; they share one edge
-- worker, which died with "CPU Time exceeded" (HTTP 546) ~10 s in. Shard 4 (all Grants.gov funders: NIFA, DOE,
-- Reclamation) had not completed since 2026-11-12, and dead shards record no error, so consecutive_failures stayed 0.
-- Fix: one shard per request, staggered 3 minutes apart by cron, at most 4 funders per request, every shard kicked
-- twice per window (minutes 0..45). No self-chaining (chain_depth starts at the engine's cap of 6): a worker lives
-- 150 s wall clock and a chained hop lands on the same aged worker, which was killed mid-hop in the 2026-11-16 test.

create or replace function grants.kick_refresh_shard(p_trigger text, p_shard int, p_shards int default 8,
  p_max_sources int default 4, p_budget_ms int default 100000)
returns int language plpgsql security definer set search_path = '' as $$
declare tok text; ceil_mb numeric;
begin
  select (value #>> '{}')::numeric into ceil_mb from grants.settings where key = 'db_ceiling_mb';
  if pg_database_size(current_database()) / 1048576.0 > coalesce(ceil_mb, 350) then
    raise warning 'grants.kick_refresh_shard skipped: database over % MB', coalesce(ceil_mb, 350);
    return 0;
  end if;
  if p_shard < 0 or p_shard >= p_shards then return 0; end if;
  select decrypted_secret into tok from vault.decrypted_secrets where name = 'grants_refresh_token';
  if tok is null then raise exception 'grants_refresh_token missing in vault'; end if;
  perform net.http_post(
    url := 'https://iuzgfldgvueuehybgntm.supabase.co/functions/v1/grants-refresh',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-grants-token', tok),
    body := jsonb_build_object('shard', p_shard, 'shards', p_shards, 'trigger', p_trigger,
      'budget_ms', p_budget_ms, 'max_sources', p_max_sources, 'chain_depth', 6),
    timeout_milliseconds := 5000);
  return 1;
end $$;
revoke execute on function grants.kick_refresh_shard(text, int, int, int, int) from public, anon, authenticated;

-- kick_refresh keeps its signature (discovery ENGINE FIXES step 4 calls it) but now sends max_sources 4.
-- Its fan-out is still parallel: use it for manual kicks only; the cron uses the staggered jobs below.
create or replace function grants.kick_refresh(p_trigger text default 'cron', p_shards int default 8, p_budget_ms int default 100000)
returns int language plpgsql security definer set search_path = '' as $$
declare i int; n int := 0;
begin
  for i in 0 .. p_shards - 1 loop
    n := n + grants.kick_refresh_shard(p_trigger, i, p_shards, 4, p_budget_ms);
  end loop;
  return n;
end $$;
revoke execute on function grants.kick_refresh(text, int, int) from public, anon, authenticated;

-- minutes 0,3,...,45 -> shards 0..7, then 0..7 again (up to 8 funders per shard per window)
select cron.schedule('grants-refresh-am', '0-45/3 13 * * *',
  $$select grants.kick_refresh_shard('cron-am', (extract(minute from now())::int / 3) % 8)$$);
select cron.schedule('grants-refresh-pm', '0-45/3 1 * * *',
  $$select grants.kick_refresh_shard('cron-pm', (extract(minute from now())::int / 3) % 8)$$);
