-- Rollback of 022: restore the 003/007 parallel fan-out and the original cron entries.
create or replace function grants.kick_refresh(p_trigger text default 'cron'::text, p_shards integer default 8, p_budget_ms integer default 100000)
returns integer language plpgsql security definer set search_path to '' as $function$
declare tok text; i int; n int := 0; ceil_mb numeric;
begin
  select (value #>> '{}')::numeric into ceil_mb from grants.settings where key = 'db_ceiling_mb';
  if pg_database_size(current_database()) / 1048576.0 > coalesce(ceil_mb, 350) then
    raise warning 'grants.kick_refresh skipped: database over % MB', coalesce(ceil_mb, 350);
    return 0;
  end if;
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
end $function$;
revoke execute on function grants.kick_refresh(text, int, int) from public, anon, authenticated;

select cron.schedule('grants-refresh-am', '0 13 * * *', $$select grants.kick_refresh('cron-am')$$);
select cron.schedule('grants-refresh-pm', '0 1 * * *',  $$select grants.kick_refresh('cron-pm')$$);

drop function if exists grants.kick_refresh_shard(text, int, int, int, int);
