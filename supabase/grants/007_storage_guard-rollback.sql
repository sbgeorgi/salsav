create or replace function grants.kick_refresh(p_trigger text default 'cron', p_shards integer default 8, p_budget_ms integer default 100000)
returns integer language plpgsql security definer set search_path to '' as $$
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
revoke execute on function grants.kick_refresh(text, integer, integer) from public, anon, authenticated;
delete from grants.settings where key = 'db_ceiling_mb';
