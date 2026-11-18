CREATE OR REPLACE FUNCTION grants.collection_state(p_id uuid)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
  select jsonb_build_object(
    'mode', m.mode,
    'health', case
      when m.mode = 'none' then 'off'
      when f.consecutive_failures >= 2 or f.robots_blocked then 'failing'
      when f.last_ok_at is null or f.last_ok_at < now() - interval '3 days' then 'stale'
      when m.mode = 'calls' and f.idle_streak >= 4
       and (f.collect_verified_at is null or f.collect_verified_at < now() - interval '30 days')
       and not exists (select 1 from grants.opportunities o where o.funder_id = f.id and o.last_seen_at > now() - interval '14 days') then 'empty'
      when f.adapter = 'html' and (f.fetchability in ('js_required', 'login_required')
                                   or (m.mode <> 'calls' and length(coalesce(f.last_text, '')) < 300)) then 'thin'
      else 'ok' end,
    'source', case f.adapter
      when 'grants_gov' then 'Grants.gov API' when 'eu_ft' then 'EU Funding and Tenders API' when 'sam_gov' then 'SAM.gov API'
      when 'json_api' then 'Site JSON endpoint' when 'rss' then 'Funding feed'
      when 'html' then case m.mode when 'calls' then 'Calls list' when 'cycle' then 'Program page' else 'Page watch' end
      else 'Not monitored' end,
    'checked_at', f.last_checked_at,
    'ok_at', f.last_ok_at,
    'open_calls', (select count(*) from grants.opportunities o
                    where o.funder_id = f.id and o.vet_status = 'vetted' and o.status in ('open', 'forecasted')
                      and (o.deadline is null or o.deadline >= t.today)),
    'total_calls', (select count(*) from grants.opportunities o where o.funder_id = f.id and o.vet_status <> 'rejected'),
    'last_call_at', (select max(o.first_seen_at) from grants.opportunities o where o.funder_id = f.id and o.vet_status = 'vetted'),
    'note', f.collect_note,
    'verified_at', f.collect_verified_at)
  from grants.funders f
  cross join lateral (select grants.collect_mode(f.adapter, f.adapter_config) as mode) m
  cross join (select (now() at time zone 'America/Phoenix')::date as today) t
  where f.id = p_id
$function$
