-- 011_collection.sql : agent-free call collection for the funding radar (schema grants only).
-- The refresh job (edge function grants-refresh) now writes calls for proposals itself. This file is the SQL side:
--   collection mode and health per source, auto-publish of ingested calls (adapter_config.auto_vet), expiry sweep,
--   a quiet re-baseline after a source is reconfigured, and grants.set_collection for configuring a source.
-- Contract: .claude/runs/radar-v2/COLLECT.md. Rollback: 011_collection-rollback.sql (written first).
-- Live on AVS as migrations grants_011a_collection_objects and grants_011b_collection_wiring (versions in the footer).

-- ===== part A: grants_011a_collection_objects (new objects only) =====

alter table grants.funders
  add column if not exists collect_note text,
  add column if not exists collect_verified_at timestamptz;
comment on column grants.funders.collect_note is 'What the refresh job collects from this source, and why this is the best source that exists';
comment on column grants.funders.collect_verified_at is 'When the collection config was last replayed through the adapter code and matched';

-- calls = the job writes call rows; cycle = one dated cycle from the program page; page = change watch only.
create or replace function grants.collect_mode(p_adapter text, p_cfg jsonb)
returns text language sql immutable set search_path = '' as $fn$
  select case
    when p_adapter in ('grants_gov', 'eu_ft', 'sam_gov', 'json_api', 'rss') then 'calls'
    when p_adapter = 'html' and coalesce(p_cfg->'list', 'null'::jsonb) not in ('null'::jsonb, 'false'::jsonb) then 'calls'
    when p_adapter = 'html' and coalesce(p_cfg->'self', 'null'::jsonb) not in ('null'::jsonb, 'false'::jsonb) then 'cycle'
    when p_adapter = 'html' then 'page'
    else 'none' end
$fn$;

create or replace function grants.collection_state(p_id uuid)
returns jsonb language sql stable set search_path = '' as $fn$
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
$fn$;

create or replace function grants.collection_metrics()
returns jsonb language sql stable set search_path = '' as $fn$
  with l as (select f.id, grants.collection_state(f.id) as c from grants.funders f where f.status = 'vetted' and f.category <> 'aggregator'),
       t as (select (now() at time zone 'America/Phoenix')::date as today)
  select jsonb_build_object(
    'listed', (select count(*) from l),
    'calls', (select count(*) from l where c->>'mode' = 'calls'),
    'cycle', (select count(*) from l where c->>'mode' = 'cycle'),
    'page', (select count(*) from l where c->>'mode' = 'page'),
    'none', (select count(*) from l where c->>'mode' = 'none'),
    'auto', (select count(*) from l where c->>'mode' in ('calls', 'cycle')),
    'auto_healthy', (select count(*) from l where c->>'mode' in ('calls', 'cycle') and c->>'health' = 'ok'),
    'healthy', (select count(*) from l where c->>'health' = 'ok'),
    'verified', (select count(*) from l where c->>'verified_at' is not null),
    'with_open_calls', (select count(*) from l where (c->>'open_calls')::int > 0),
    'open_calls', (select coalesce(sum((c->>'open_calls')::int), 0) from l),
    'new_calls_30d', (select count(*) from grants.opportunities o join l on l.id = o.funder_id
                       where o.vet_status = 'vetted' and o.first_seen_at > now() - interval '30 days'),
    'calls_closing_60d', (select count(*) from grants.opportunities o join l on l.id = o.funder_id cross join t
                           where o.vet_status = 'vetted' and o.status in ('open', 'forecasted') and o.deadline between t.today and t.today + 60))
$fn$;

-- Close calls whose deadline passed; archive undated calls a healthy source stopped listing three weeks ago.
create or replace function grants.sweep_opportunities()
returns jsonb language plpgsql set search_path = grants, extensions, pg_temp as $fn$
declare v_today date := (now() at time zone 'America/Phoenix')::date; v_closed int; v_archived int;
begin
  update grants.opportunities set status = 'closed'
   where status in ('open', 'forecasted') and deadline < v_today;
  get diagnostics v_closed = row_count;
  update grants.opportunities o set status = 'archived'
    from grants.funders f
   where f.id = o.funder_id and o.status in ('open', 'forecasted') and o.deadline is null
     and o.source_adapter is not null and o.source_adapter = f.adapter
     and f.consecutive_failures = 0 and f.last_ok_at > now() - interval '2 days'
     and o.last_seen_at < f.last_ok_at - interval '21 days';
  get diagnostics v_archived = row_count;
  return jsonb_build_object('closed', v_closed, 'archived', v_archived);
end $fn$;

-- Configure what the refresh job collects from one source. p: {adapter?, adapter_config?, url?, feed_url?, note?, verified?}.
-- A changed config clears the conditional-fetch state so the next run re-baselines the source (no false "page changed").
create or replace function grants.set_collection(p_id uuid, p jsonb, p_run_label text default null)
returns jsonb language plpgsql set search_path = grants, extensions, pg_temp as $fn$
declare f grants.funders%rowtype;
        v_adapter text; v_cfg jsonb; v_url text; v_feed text; v_old text; v_new text; v_same boolean; v_note text;
begin
  select * into f from grants.funders where id = p_id for update;
  if not found then raise exception 'funder % not found', p_id; end if;
  v_adapter := coalesce(nullif(p->>'adapter', ''), f.adapter);
  v_cfg := case when p ? 'adapter_config' then coalesce(nullif(p->'adapter_config', 'null'::jsonb), '{}'::jsonb) else f.adapter_config end;
  v_url := coalesce(nullif(btrim(p->>'url'), ''), f.url);
  v_feed := case when p ? 'feed_url' then nullif(btrim(p->>'feed_url'), '') else f.feed_url end;
  v_note := case when p ? 'note' then left(nullif(btrim(p->>'note'), ''), 400) else f.collect_note end;

  if v_adapter not in ('html', 'rss', 'grants_gov', 'eu_ft', 'json_api', 'sam_gov', 'none') then raise exception 'unknown adapter %', v_adapter; end if;
  if jsonb_typeof(v_cfg) <> 'object' then raise exception 'adapter_config must be an object'; end if;
  if octet_length(v_cfg::text) > 8000 then raise exception 'adapter_config is too large'; end if;
  if v_url !~* '^https?://' then raise exception 'url must be http(s)'; end if;
  if v_adapter = 'rss' and coalesce(v_feed, '') !~* '^https?://' then raise exception 'rss needs feed_url'; end if;
  if v_adapter = 'json_api' and coalesce(v_cfg->>'url', '') !~* '^https://' then raise exception 'json_api needs adapter_config.url (https)'; end if;
  if v_cfg ? 'list' then
    if jsonb_typeof(v_cfg->'list') <> 'object' then raise exception 'list must be an object'; end if;
    if not (v_cfg->'list' ? 'item') and not (v_cfg->'list' ? 'match') then raise exception 'list needs item or match'; end if;
    if coalesce(v_cfg #>> '{list,url}', 'https://') !~* '^https?://' then raise exception 'list.url must be http(s)'; end if;
  end if;
  if v_cfg ? 'filter' and jsonb_typeof(v_cfg->'filter') <> 'object' then raise exception 'filter must be an object'; end if;
  if v_cfg ? 'auto_vet' and jsonb_typeof(v_cfg->'auto_vet') <> 'boolean' then raise exception 'auto_vet must be true or false'; end if;

  v_old := grants.collect_mode(f.adapter, f.adapter_config);
  v_new := grants.collect_mode(v_adapter, v_cfg);
  v_same := v_adapter = f.adapter and v_cfg = f.adapter_config and v_url = f.url and v_feed is not distinct from f.feed_url;

  update grants.funders set
    adapter = v_adapter, adapter_config = v_cfg, url = v_url, feed_url = v_feed, collect_note = v_note,
    collect_verified_at = case when coalesce((p->>'verified')::boolean, false) then now() when v_same then collect_verified_at else null end,
    etag = case when v_same then etag else null end,
    last_modified = case when v_same then last_modified else null end,
    content_hash = case when v_same then content_hash else null end,
    fetchability = case when v_same then fetchability else 'unknown' end,
    cooldown_until = case when v_same then cooldown_until else null end,
    next_check_at = case when v_same then next_check_at else now() end
   where id = p_id;

  if not v_same then
    insert into grants.vet_events(funder_id, kind, note, changes, run_label)
    values (p_id, 'updated', 'Collection source set: ' || v_new || ' (' || v_adapter || ')',
            jsonb_build_object('collection', jsonb_build_array(v_old, v_new), 'adapter', jsonb_build_array(f.adapter, v_adapter)), p_run_label);
  end if;
  return jsonb_build_object('result', 'ok', 'id', p_id, 'name', f.name, 'mode', v_new, 'previous', v_old, 'changed', not v_same);
end $fn$;

revoke all on all functions in schema grants from public, anon, authenticated;

-- ===== part B: grants_011b_collection_wiring (patches to live functions, self-checked) =====

create function pg_temp.patch1(d text, a text, r text) returns text language plpgsql as $fn$
begin
  if a = '' or (length(d) - length(replace(d, a, ''))) / length(a) <> 1 then
    raise exception 'patch anchor not found exactly once: %', left(a, 90);
  end if;
  return replace(d, a, r);
end $fn$;

create temp table _before_011 on commit drop as
  select public.grants_feed() as feed, grants.metrics_now() as m, grants.discovery_brief() as b;

do $mig$
declare d text;
begin
  -- grants.apply_fetch_result: publish auto-vetted calls, keep award and description when a later fetch has none,
  -- close past deadlines at write time, keep listed calls fresh on 304, and re-baseline quietly after a reconfigure.
  d := pg_get_functiondef('grants.apply_fetch_result(jsonb)'::regprocedure);
  d := pg_temp.patch1(d, $a$  v_auto boolean;$a$, $r$  v_auto boolean;
  v_rebase boolean := false;
  v_today date := (now() at time zone 'America/Phoenix')::date;$r$);
  d := pg_temp.patch1(d, $a$  if not found then return; end if;$a$, $r$  if not found then return; end if;
  v_rebase := f.content_hash is null and f.last_changed_at is not null;$r$);
  d := pg_temp.patch1(d, $a$  elsif v_kind in ('error', 'robots_blocked') then$a$, $r$    update grants.opportunities set last_seen_at = now()
     where funder_id = f.id and source_adapter = f.adapter and status in ('open', 'forecasted')
       and last_seen_at >= f.last_ok_at - interval '1 minute';

  elsif v_kind in ('error', 'robots_blocked') then$r$);
  d := pg_temp.patch1(d, $a$update grants.funders set content_hash = p->>'content_hash', last_changed_at = now(),$a$,
                         $r$update grants.funders set content_hash = p->>'content_hash', last_changed_at = case when v_rebase then last_changed_at else now() end,$r$);
  d := pg_temp.patch1(d, $a$insert into grants.snapshots(funder_id, run_id, http_status, content_hash, text_len, change_kind, summary, diff, links)$a$,
                         $r$if not v_rebase then
      insert into grants.snapshots(funder_id, run_id, http_status, content_hash, text_len, change_kind, summary, diff, links)$r$);
  d := pg_temp.patch1(d, $a$coalesce(p#>'{change,diff}', '{}'::jsonb), coalesce(p->'links', '[]'::jsonb));$a$,
                         $r$coalesce(p#>'{change,diff}', '{}'::jsonb), coalesce(p->'links', '[]'::jsonb));
      end if;$r$);
  d := pg_temp.patch1(d, $a$coalesce(o->>'status', 'open'), case when v_auto then 'vetted' else 'candidate' end,$a$,
                         $r$case when nullif(o->>'deadline', '')::date < v_today then 'closed' else coalesce(o->>'status', 'open') end,
              case when v_auto then 'vetted' else 'candidate' end,$r$);
  d := pg_temp.patch1(d, $a$description = excluded.description,$a$, $r$description = coalesce(excluded.description, opportunities.description),$r$);
  d := pg_temp.patch1(d, $a$award_min_usd = excluded.award_min_usd, award_max_usd = excluded.award_max_usd, status = excluded.status,$a$,
                         $r$award_min_usd = coalesce(excluded.award_min_usd, opportunities.award_min_usd),
        award_max_usd = coalesce(excluded.award_max_usd, opportunities.award_max_usd), status = excluded.status,$r$);
  d := pg_temp.patch1(d, $a$scope_score = excluded.scope_score, doc_links = excluded.doc_links, last_seen_at = now();$a$,
                         $r$scope_score = excluded.scope_score, doc_links = excluded.doc_links, last_seen_at = now(),
        vet_status = case when opportunities.vet_status = 'candidate' and v_auto then 'vetted' else opportunities.vet_status end;$r$);
  execute d;

  -- public.grants_feed: collection status per source, live collection totals, call source, no past-deadline calls.
  d := pg_get_functiondef('public.grants_feed()'::regprocedure);
  d := pg_temp.patch1(d, $a$'updated_at', t.updated_at))$a$, $r$'updated_at', t.updated_at), 'collection', grants.collection_state(v.id))$r$);
  d := pg_temp.patch1(d, $a$'first_seen_at', o.first_seen_at, 'last_seen_at', o.last_seen_at)$a$,
                         $r$'first_seen_at', o.first_seen_at, 'last_seen_at', o.last_seen_at, 'source_adapter', o.source_adapter)$r$);
  d := pg_temp.patch1(d, $a$and o.status in ('forecasted', 'open')), '[]'::jsonb),$a$,
                         $r$and o.status in ('forecasted', 'open')
         and (o.deadline is null or o.deadline >= (now() at time zone 'America/Phoenix')::date)), '[]'::jsonb),$r$);
  d := pg_temp.patch1(d, $a$'last_run', (select to_jsonb(r) - 'stats'$a$, $r$'collection', grants.collection_metrics(),
    'last_run', (select to_jsonb(r) - 'stats'$r$);
  execute d;

  -- grants.metrics_now: collection block (stored twice a day in metrics_daily).
  d := pg_get_functiondef('grants.metrics_now()'::regprocedure);
  d := pg_temp.patch1(d, $a$'screened', (select count(*) from grants.funders where status = 'rejected' and category <> 'aggregator'))$a$,
                         $r$'screened', (select count(*) from grants.funders where status = 'rejected' and category <> 'aggregator'),
    'collection', grants.collection_metrics())$r$);
  execute d;

  -- grants.discovery_brief: listed sources whose calls are not collected automatically yet, or whose source is unhealthy.
  d := pg_get_functiondef('grants.discovery_brief()'::regprocedure);
  d := pg_temp.patch1(d, $a$'metrics', grants.metrics_now(),$a$, $r$'collection_gaps', coalesce((select jsonb_agg(to_jsonb(x) - 'rn' order by x.rn) from (
        select l.id, l.name, l.program, l.url, l.bucket, l.cycle, c.c->>'mode' as mode, c.c->>'health' as health, c.c->>'note' as note,
               c.c->>'verified_at' as verified_at, l.fetchability, l.consecutive_failures,
               row_number() over (order by (c.c->>'health' = 'failing') desc, (c.c->>'mode' in ('page', 'none')) desc, l.fit_score desc nulls last, l.name) as rn
          from listed l cross join lateral (select grants.collection_state(l.id) as c) c
         where c.c->>'health' <> 'ok'
            or (c.c->>'mode' in ('page', 'none')
                and (c.c->>'verified_at' is null or (c.c->>'verified_at')::timestamptz < now() - interval '120 days'))) x where x.rn <= 15), '[]'::jsonb),
    'metrics', grants.metrics_now(),$r$);
  execute d;
end $mig$;

-- the twice-daily metrics job also closes expired calls
create or replace function grants.snapshot_metrics()
returns void language plpgsql set search_path = grants, extensions, pg_temp as $fn$
begin
  perform grants.sweep_opportunities();
  insert into grants.metrics_daily(day, m) values ((now() at time zone 'America/Phoenix')::date, grants.metrics_now())
  on conflict (day) do update set m = excluded.m, updated_at = now();
end $fn$;

-- self-check: nothing that existed before changed (same transaction, so now() is identical)
do $chk$
declare o record; n jsonb; nm jsonb; nb jsonb; stripped jsonb;
begin
  select * into o from _before_011;
  n := public.grants_feed(); nm := grants.metrics_now(); nb := grants.discovery_brief();
  select coalesce(jsonb_agg(x.v - 'collection' order by x.ord), '[]'::jsonb) into stripped
    from jsonb_array_elements(n->'funders') with ordinality as x(v, ord);
  if jsonb_set(n - 'collection', '{funders}', stripped) is distinct from o.feed then raise exception '011 self-check: feed changed beyond the new keys'; end if;
  if (select count(*) from jsonb_array_elements(n->'funders') x where x->'collection'->>'mode' is null) > 0 then raise exception '011 self-check: a funder has no collection state'; end if;
  if (nm - 'collection') is distinct from o.m then raise exception '011 self-check: metrics changed beyond the new key'; end if;
  if (nb - 'collection_gaps' - 'metrics') is distinct from (o.b - 'metrics') then raise exception '011 self-check: brief changed beyond the new key'; end if;
  if nm->'collection'->>'listed' is null or jsonb_typeof(nb->'collection_gaps') <> 'array' then raise exception '011 self-check: new keys missing'; end if;
end $chk$;

revoke all on all functions in schema grants from public, anon, authenticated;

-- Live versions on AVS (2026-11-12 UTC): grants_011a_collection_objects = 20261112012010, grants_011b_collection_wiring = 20261112012043.
-- Per-funder source configs: 011_collection_data.sql (applied through grants.set_collection).
