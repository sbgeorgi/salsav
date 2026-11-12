-- applied as migration probe_refresh, live version 20261112153616
-- 019: probe the live grants-refresh edge function for named funders (dry run: fetches and reports, writes only the run record).
-- probe_refresh posts {dry_run, only_ids} with the vault token and returns the pg_net request id; probe_result reads the reply.
create or replace function grants.probe_refresh(p_ids uuid[])
returns bigint language plpgsql security definer set search_path to '' as $$
declare tok text; rid bigint;
begin
  if p_ids is null or cardinality(p_ids) = 0 or cardinality(p_ids) > 50 then raise exception 'probe_refresh: 1 to 50 funder ids'; end if;
  select decrypted_secret into tok from vault.decrypted_secrets where name = 'grants_refresh_token';
  if tok is null then raise exception 'grants_refresh_token missing in vault'; end if;
  select net.http_post(
    url := 'https://iuzgfldgvueuehybgntm.supabase.co/functions/v1/grants-refresh',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-grants-token', tok),
    body := jsonb_build_object('dry_run', true, 'only_ids', to_jsonb(p_ids), 'trigger', 'probe', 'budget_ms', 140000, 'max_sources', 50),
    timeout_milliseconds := 150000) into rid;
  return rid;
end $$;

create or replace function grants.probe_result(p_req bigint)
returns jsonb language sql security definer set search_path to '' as $$
  select case when r.id is null then jsonb_build_object('pending', true)
              else jsonb_build_object('status', r.status_code, 'timed_out', r.timed_out, 'error', r.error_msg,
                                      'body', case when r.content ~ '^\s*\{' then r.content::jsonb else to_jsonb(left(r.content, 500)) end) end
  from (select 1) one left join net._http_response r on r.id = p_req
$$;

revoke all on function grants.probe_refresh(uuid[]) from public, anon, authenticated;
revoke all on function grants.probe_result(bigint) from public, anon, authenticated;
