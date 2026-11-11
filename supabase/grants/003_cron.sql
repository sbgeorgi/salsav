-- SALSAV grants: scheduling. Apply AFTER the `grants-refresh` edge function is deployed (verify_jwt=false).
-- Adds extensions pg_cron + pg_net to the project (additive; they are listed as available, not yet installed).
-- The refresh token is generated and stored INSIDE the database (Vault); only its sha256 sits in grants.settings,
-- so no secret lives in this repo and no edge-function secret has to be typed anywhere.

create extension if not exists pg_cron;
create extension if not exists pg_net with schema extensions;

do $$
declare tok text;
begin
  if not exists (select 1 from vault.secrets where name = 'grants_refresh_token') then
    tok := encode(extensions.gen_random_bytes(32), 'hex');
    perform vault.create_secret(tok, 'grants_refresh_token', 'x-grants-token for the grants-refresh edge function');
  end if;
  insert into grants.settings(key, value)
  select 'refresh_token_sha256', to_jsonb(encode(extensions.digest(decrypted_secret, 'sha256'), 'hex'))
    from vault.decrypted_secrets where name = 'grants_refresh_token'
  on conflict (key) do update set value = excluded.value, updated_at = now();
end $$;

-- Fan-out: one HTTP call per shard (sources are sharded by host, so a host is never hit by two shards at once).
create or replace function grants.kick_refresh(p_trigger text default 'cron', p_shards int default 8, p_budget_ms int default 100000)
returns int language plpgsql volatile security definer set search_path = '' as $$
declare tok text; i int; n int := 0;
begin
  select decrypted_secret into tok from vault.decrypted_secrets where name = 'grants_refresh_token';
  if tok is null then raise exception 'grants_refresh_token missing in vault'; end if;
  for i in 0 .. p_shards - 1 loop
    perform net.http_post(
      url := 'https://iuzgfldgvueuehybgntm.supabase.co/functions/v1/grants-refresh',
      headers := jsonb_build_object('Content-Type', 'application/json', 'x-grants-token', tok),
      body := jsonb_build_object('shard', i, 'shards', p_shards, 'trigger', p_trigger, 'budget_ms', p_budget_ms),
      timeout_milliseconds := 5000);
    n := n + 1;
  end loop;
  return n;
end $$;
revoke execute on function grants.kick_refresh(text, int, int) from public, anon, authenticated;

-- Twice a day: 06:00 and 18:00 America/Phoenix (UTC-7, no DST) = 13:00 and 01:00 UTC.
select cron.schedule('grants-refresh-am', '0 13 * * *', $$select grants.kick_refresh('cron-am')$$);
select cron.schedule('grants-refresh-pm', '0 1 * * *',  $$select grants.kick_refresh('cron-pm')$$);

-- Weekly housekeeping on grants-owned tables only.
select cron.schedule('grants-prune', '30 11 * * 0', $$
  delete from grants.snapshots where fetched_at < now() - interval '180 days';
  delete from grants.refresh_runs where started_at < now() - interval '90 days';
  delete from grants.auth_attempts where at < now() - interval '7 days';
$$);
