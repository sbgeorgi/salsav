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
  v_idle boolean;
  v_streak int;
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

  -- 020 idle backoff: runs after the branch above set next_check_at to the base wait
  if v_kind not in ('error', 'robots_blocked') then
    v_idle := v_kind = 'not_modified'
      or p->>'content_hash' is not distinct from f.content_hash
      or (grants.collect_mode(f.adapter, f.adapter_config) = 'calls' and jsonb_typeof(p->'opportunities') = 'array'
          and not exists (select 1 from jsonb_array_elements(p->'opportunities') e
                           where coalesce(e->>'status', 'open') not in ('closed', 'archived')));
    v_streak := case when not v_idle then 0
                     when f.collect_verified_at > coalesce(f.last_ok_at, '-infinity'::timestamptz) then 1
                     else f.idle_streak + 1 end;
    update grants.funders set idle_streak = v_streak,
           next_check_at = case
             when v_streak = 0
               or f.next_deadline between v_today and v_today + 10
               or exists (select 1 from grants.opportunities op where op.funder_id = f.id and op.status in ('open', 'forecasted')
                            and op.deadline between v_today and v_today + 10)
             then next_check_at
             else now() + make_interval(secs => coalesce((p->>'next_check_s')::int, 43200) * (2 ^ least(v_streak, 2))::int) end
     where id = f.id;
  end if;
end $function$
