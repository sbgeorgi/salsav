-- rollback 020: restore apply_fetch_result as live before 020 (2026-11-12)
CREATE OR REPLACE FUNCTION grants.apply_fetch_result(p jsonb)
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO 'grants', 'extensions', 'pg_temp'
AS $function$
declare
  f grants.funders%rowtype;
  v_kind text := p->>'kind';
  v_next interval;
  v_fail int;
  o jsonb;
  v_auto boolean;
  v_rebase boolean := false;
  v_today date := (now() at time zone 'America/Phoenix')::date;
begin
  select * into f from grants.funders where id = (p->>'id')::uuid for update;
  if not found then return; end if;
  v_rebase := f.content_hash is null and f.last_changed_at is not null;

  if v_kind = 'not_modified' then
    update grants.funders set last_checked_at = now(), last_ok_at = now(), last_status = coalesce((p->>'http_status')::int, 304),
           last_error = null, consecutive_failures = 0, lease_until = null, lease_run = null,
           next_check_at = now() + make_interval(secs => coalesce((p->>'next_check_s')::int, 43200))
     where id = f.id;

    update grants.opportunities set last_seen_at = now()
     where funder_id = f.id and source_adapter = f.adapter and status in ('open', 'forecasted')
       and last_seen_at >= f.last_ok_at - interval '1 minute';

  elsif v_kind in ('error', 'robots_blocked') then
    v_fail := f.consecutive_failures + 1;
    v_next := make_interval(secs => least(coalesce((p->>'next_check_s')::int, 21600 * (2 ^ least(v_fail - 1, 3))::int), 259200));
    update grants.funders set last_checked_at = now(), last_status = (p->>'http_status')::int,
           last_error = left(coalesce(p->>'error', v_kind), 500), consecutive_failures = v_fail,
           robots_blocked = (v_kind = 'robots_blocked'),
           fetchability = coalesce(p->>'fetchability', fetchability),
           cooldown_until = case when (p->>'cooldown_s') is not null then now() + make_interval(secs => (p->>'cooldown_s')::int) else cooldown_until end,
           lease_until = null, lease_run = null, next_check_at = now() + v_next
     where id = f.id;
    if v_fail = 1 or v_fail % 4 = 0 then
      insert into grants.snapshots(funder_id, run_id, http_status, change_kind, summary, diff)
      values (f.id, (p->>'run')::uuid, (p->>'http_status')::int, 'error', left(coalesce(p->>'error', v_kind), 300),
              jsonb_build_object('failures', v_fail));
    end if;

  else
    update grants.funders set
      last_checked_at = now(), last_ok_at = now(), last_status = (p->>'http_status')::int, last_error = null,
      consecutive_failures = 0, robots_blocked = false,
      etag = p->>'etag', last_modified = p->>'last_modified',
      fetchability = coalesce(p->>'fetchability', case when fetchability in ('bot_protected','blocked','unknown') then 'easy' else fetchability end),
      lease_until = null, lease_run = null,
      next_check_at = now() + make_interval(secs => coalesce((p->>'next_check_s')::int, 43200))
     where id = f.id;

    if p->>'content_hash' is distinct from f.content_hash then
      update grants.funders set content_hash = p->>'content_hash', last_changed_at = case when v_rebase then last_changed_at else now() end,
             last_text = left(p->>'text', 60000), last_links = coalesce(p->'links', '[]'::jsonb)
       where id = f.id;
      if not v_rebase then
      insert into grants.snapshots(funder_id, run_id, http_status, content_hash, text_len, change_kind, summary, diff, links)
      values (f.id, (p->>'run')::uuid, (p->>'http_status')::int, p->>'content_hash', length(coalesce(p->>'text','')),
              coalesce(p#>>'{change,kind}', case when f.content_hash is null then 'initial' else 'content' end),
              left(p#>>'{change,summary}', 500), coalesce(p#>'{change,diff}', '{}'::jsonb), coalesce(p->'links', '[]'::jsonb));
      end if;
      if p->>'next_deadline' is not null then
        update grants.funders set next_deadline = (p->>'next_deadline')::date where id = f.id and next_deadline is distinct from (p->>'next_deadline')::date;
      end if;
    end if;
  end if;

  if jsonb_typeof(p->'opportunities') = 'array' then
    v_auto := coalesce((f.adapter_config->>'auto_vet')::boolean, false);
    for o in select * from jsonb_array_elements(p->'opportunities') loop
      insert into grants.opportunities(funder_id, external_id, title, url, apply_url, description, open_date, deadline,
                                       deadline_text, award_min_usd, award_max_usd, status, vet_status, scope_score, doc_links, source_adapter)
      values (f.id, nullif(o->>'external_id', ''), left(o->>'title', 400), o->>'url', o->>'apply_url', left(o->>'description', 2000),
              nullif(o->>'open_date', '')::date, nullif(o->>'deadline', '')::date, o->>'deadline_text',
              nullif(o->>'award_min_usd', '')::bigint, nullif(o->>'award_max_usd', '')::bigint,
              case when nullif(o->>'deadline', '')::date < v_today then 'closed' else coalesce(o->>'status', 'open') end,
              case when v_auto then 'vetted' else 'candidate' end,
              nullif(o->>'scope_score', '')::smallint, coalesce(o->'doc_links', '[]'::jsonb), f.adapter)
      on conflict (funder_id, external_id) do update set
        title = excluded.title, url = excluded.url, apply_url = excluded.apply_url, description = coalesce(excluded.description, opportunities.description),
        open_date = excluded.open_date,
        deadline = case when f.adapter = 'html' then coalesce(excluded.deadline, opportunities.deadline) else excluded.deadline end,
        deadline_text = excluded.deadline_text,
        award_min_usd = coalesce(excluded.award_min_usd, opportunities.award_min_usd),
        award_max_usd = coalesce(excluded.award_max_usd, opportunities.award_max_usd),
        status = case when f.adapter = 'html' and excluded.deadline is null and opportunities.deadline < v_today then 'closed' else excluded.status end,
        scope_score = excluded.scope_score, doc_links = excluded.doc_links, last_seen_at = now(),
        vet_status = case when opportunities.vet_status = 'candidate' and v_auto then 'vetted' else opportunities.vet_status end;
    end loop;
  end if;
end $function$;

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
$function$;

alter table grants.funders drop column if exists idle_streak;
