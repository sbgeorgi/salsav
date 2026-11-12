-- Rollback for 011_collection.sql (written before the migration was applied).
-- Restores the function definitions that were live on AVS on 2026-11-12 UTC, then removes the new objects.
-- Per-funder adapter values: 011_collection_data-rollback.sql.
begin;

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
begin
  select * into f from grants.funders where id = (p->>'id')::uuid for update;
  if not found then return; end if;

  if v_kind = 'not_modified' then
    update grants.funders set last_checked_at = now(), last_ok_at = now(), last_status = coalesce((p->>'http_status')::int, 304),
           last_error = null, consecutive_failures = 0, lease_until = null, lease_run = null,
           next_check_at = now() + make_interval(secs => coalesce((p->>'next_check_s')::int, 43200))
     where id = f.id;

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
      update grants.funders set content_hash = p->>'content_hash', last_changed_at = now(),
             last_text = left(p->>'text', 60000), last_links = coalesce(p->'links', '[]'::jsonb)
       where id = f.id;
      insert into grants.snapshots(funder_id, run_id, http_status, content_hash, text_len, change_kind, summary, diff, links)
      values (f.id, (p->>'run')::uuid, (p->>'http_status')::int, p->>'content_hash', length(coalesce(p->>'text','')),
              coalesce(p#>>'{change,kind}', case when f.content_hash is null then 'initial' else 'content' end),
              left(p#>>'{change,summary}', 500), coalesce(p#>'{change,diff}', '{}'::jsonb), coalesce(p->'links', '[]'::jsonb));
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
              coalesce(o->>'status', 'open'), case when v_auto then 'vetted' else 'candidate' end,
              nullif(o->>'scope_score', '')::smallint, coalesce(o->'doc_links', '[]'::jsonb), f.adapter)
      on conflict (funder_id, external_id) do update set
        title = excluded.title, url = excluded.url, apply_url = excluded.apply_url, description = excluded.description,
        open_date = excluded.open_date, deadline = excluded.deadline, deadline_text = excluded.deadline_text,
        award_min_usd = excluded.award_min_usd, award_max_usd = excluded.award_max_usd, status = excluded.status,
        scope_score = excluded.scope_score, doc_links = excluded.doc_links, last_seen_at = now();
    end loop;
  end if;
end $function$;

CREATE OR REPLACE FUNCTION grants.metrics_now()
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO 'grants', 'extensions', 'pg_temp'
AS $function$
  with v as (select v.*, coalesce(t.state, 'new') as team_state_now, t.ask_usd
               from grants.v_funders v left join grants.team_state t on t.funder_id = v.id
              where v.status = 'vetted' and v.category <> 'aggregator')
  select jsonb_build_object(
    'vetted', (select count(*) from v),
    'by_bucket', coalesce((select jsonb_object_agg(k, n) from (select bucket as k, count(*) as n from v group by 1) x), '{}'::jsonb),
    'by_lane', coalesce((select jsonb_object_agg(k, n) from (select lane as k, count(*) as n from v group by 1) x), '{}'::jsonb),
    'by_tier', coalesce((select jsonb_object_agg(k, n) from (select coalesce(fit_breakdown->>'tier', 'unscored') as k, count(*) as n from v group by 1) x), '{}'::jsonb),
    'avg_fit', (select round(avg(fit_score), 1) from v),
    'itemized', (select count(*) from v where fit_breakdown is not null),
    'addressable_usd', (select coalesce(sum(award_max_usd), 0) from v),
    'actionable_usd', (select coalesce(sum(award_max_usd), 0) from v where lane in ('apply_now', 'rolling')),
    'pipeline', coalesce((select jsonb_object_agg(k, jsonb_build_object('n', n, 'usd', usd))
                            from (select team_state_now as k, count(*) as n, coalesce(sum(coalesce(ask_usd, award_max_usd)), 0) as usd from v group by 1) x), '{}'::jsonb),
    'quality', (select jsonb_build_object('award_published', count(*) filter (where amount_confidence = 'published'),
                                          'deadline_known', count(*) filter (where deadline is not null),
                                          'eligibility_confirmed', count(*) filter (where ua_eligibility <> 'unknown'),
                                          'evidence3', count(*) filter (where facts_verified >= 3)) from v),
    'health', (select jsonb_build_object('checked_24h', count(*) filter (where last_checked_at > now() - interval '24 hours'),
                                         'failing', count(*) filter (where consecutive_failures >= 3)) from v),
    'targets_pending', (select count(*) from grants.targets where status = 'pending'),
    'screened', (select count(*) from grants.funders where status = 'rejected' and category <> 'aggregator'))
$function$;

CREATE OR REPLACE FUNCTION grants.snapshot_metrics()
 RETURNS void
 LANGUAGE sql
 SET search_path TO 'grants', 'extensions', 'pg_temp'
AS $function$
  insert into grants.metrics_daily(day, m) values ((now() at time zone 'America/Phoenix')::date, grants.metrics_now())
  on conflict (day) do update set m = excluded.m, updated_at = now()
$function$;

CREATE OR REPLACE FUNCTION grants.discovery_brief()
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO 'grants', 'extensions', 'pg_temp'
AS $function$
  with cov as (
    select c.key as bucket, (c.value #>> '{}')::int as min,
           (select count(*) from grants.funders f where f.status = 'vetted' and f.category <> 'aggregator' and f.bucket = c.key)::int as listed,
           (select count(*) from grants.targets t where t.status = 'pending' and t.bucket = c.key)::int as pending_targets
      from jsonb_each((select value from grants.settings where key = 'coverage_min')) c),
  listed as (select * from grants.v_funders where status = 'vetted' and category <> 'aggregator')
  select jsonb_build_object(
    'today', (now() at time zone 'America/Phoenix')::date,
    'gates', jsonb_build_object('min_fit', (select (value->>'min_fit')::int from grants.settings where key = 'fit_rubric'),
                                'min_award_usd', (select value from grants.settings where key = 'min_award_usd'),
                                'min_days_left', (select value from grants.settings where key = 'min_days_left')),
    'rubric', (select value from grants.settings where key = 'fit_rubric'),
    'theme_vocab', (select value from grants.settings where key = 'theme_vocab'),
    'coverage', (select jsonb_agg(to_jsonb(cov) || jsonb_build_object('gap', greatest(0, cov.min - cov.listed)) order by cov.min - cov.listed desc, cov.bucket) from cov),
    'targets', coalesce((select jsonb_agg(to_jsonb(x) - 'rn' order by x.rn) from (
        select t.id, t.org, t.program_hint, t.url_hint, t.bucket, t.lens, t.priority, t.why, t.attempts,
               row_number() over (order by t.priority, cov.min - cov.listed desc, t.attempts, t.created_at) as rn
          from grants.targets t join cov on cov.bucket = t.bucket where t.status = 'pending') x where x.rn <= 30), '[]'::jsonb),
    'reverify', coalesce((select jsonb_agg(to_jsonb(x) - 'rn' order by x.rn) from (
        select l.id, l.name, l.program, l.url, l.bucket, l.fit_score, l.facts_verified, l.verified_at, l.evidence_ok, l.ua_eligibility,
               l.amount_confidence, l.cycle, l.deadline, l.deadline_state,
               row_number() over (order by (l.fit_breakdown is null) desc, (l.deadline_state = 'expired') desc,
                                           exists (select 1 from jsonb_each(l.evidence_ok) e where e.value = 'false'::jsonb) desc,
                                           l.verified_at asc nulls first, l.facts_verified asc, l.name) as rn
          from listed l) x where x.rn <= 20), '[]'::jsonb),
    'failing', coalesce((select jsonb_agg(jsonb_build_object('id', l.id, 'name', l.name, 'url', l.url, 'fetchability', l.fetchability,
                                 'consecutive_failures', l.consecutive_failures, 'last_ok_at', l.last_ok_at) order by l.consecutive_failures desc)
                           from listed l where l.consecutive_failures >= 3), '[]'::jsonb),
    'metrics', grants.metrics_now(),
    'last_runs', coalesce((select jsonb_agg(to_jsonb(r) order by r.started_at desc)
                             from (select run_label, started_at, finished_at, summary, stats from grants.discovery_runs order by started_at desc limit 3) r), '[]'::jsonb),
    'last_refresh', (select to_jsonb(r) from (select finished_at, status, planned, fetched, changed, errors
                                                from grants.refresh_runs where finished_at is not null order by started_at desc limit 1) r))
$function$;

CREATE OR REPLACE FUNCTION public.grants_feed()
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select jsonb_build_object(
    'generated_at', now(),
    'min_days', (select (value #>> '{}')::int from grants.settings where key = 'min_days_left'),
    'min_award', (select (value #>> '{}')::bigint from grants.settings where key = 'min_award_usd'),
    'rubric', (select value from grants.settings where key = 'fit_rubric'),
    'vocab', jsonb_build_object('themes', (select value from grants.settings where key = 'theme_vocab')),
    'coverage_min', (select value from grants.settings where key = 'coverage_min'),
    'funders', coalesce((
      select jsonb_agg(to_jsonb(v) - 'status'
                       || jsonb_build_object('team', jsonb_build_object('state', coalesce(t.state, 'new'), 'owner', t.owner, 'ask_usd', t.ask_usd, 'updated_at', t.updated_at))
                       order by v.deadline nulls last, v.fit_score desc nulls last, v.name)
        from grants.v_funders v left join grants.team_state t on t.funder_id = v.id
       where v.status = 'vetted' and v.category <> 'aggregator'), '[]'::jsonb),
    'opportunities', coalesce((
      select jsonb_agg(jsonb_build_object('id', o.id, 'funder_id', o.funder_id, 'title', o.title, 'url', o.url, 'apply_url', o.apply_url,
               'description', o.description, 'open_date', o.open_date, 'deadline', o.deadline, 'deadline_text', o.deadline_text,
               'award_min_usd', o.award_min_usd, 'award_max_usd', o.award_max_usd, 'status', o.status, 'doc_links', o.doc_links,
               'first_seen_at', o.first_seen_at, 'last_seen_at', o.last_seen_at) order by o.deadline nulls last)
        from grants.opportunities o join grants.funders f on f.id = o.funder_id
       where f.status = 'vetted' and o.vet_status = 'vetted' and o.status in ('forecasted', 'open')), '[]'::jsonb),
    'changes', coalesce((
      select jsonb_agg(jsonb_build_object('funder_id', s.funder_id, 'at', s.fetched_at, 'kind', s.change_kind, 'summary', s.summary,
               'docs_added', s.diff->'docs_added', 'deadline', s.diff->'deadline') order by s.fetched_at desc)
        from grants.snapshots s join grants.funders f on f.id = s.funder_id
       where f.status = 'vetted' and f.category <> 'aggregator' and s.change_kind <> 'error' and s.fetched_at > now() - interval '120 days'), '[]'::jsonb),
    'vetting', coalesce((
      select jsonb_agg(jsonb_build_object('funder_id', e.funder_id, 'at', e.at, 'kind', e.kind, 'note', e.note, 'changes', e.changes, 'run_label', e.run_label) order by e.at desc)
        from grants.vet_events e join grants.funders f on f.id = e.funder_id
       where f.status = 'vetted' and f.category <> 'aggregator' and e.at > now() - interval '180 days'), '[]'::jsonb),
    'metrics', coalesce((select jsonb_agg(jsonb_build_object('day', x.day, 'm', x.m) order by x.day)
                           from (select day, m from grants.metrics_daily order by day desc limit 90) x), '[]'::jsonb),
    'discovery', jsonb_build_object(
      'runs', coalesce((
        select jsonb_agg(to_jsonb(x) order by x.started_at desc) from (
          select run_label, coalesce(r.started_at, l.first_at) as started_at, coalesce(r.finished_at, l.last_at) as finished_at, r.summary,
                 coalesce(r.stats, '{}'::jsonb) as stats,
                 greatest(coalesce(l.n, 0), case when r.stats->>'examined' ~ '^[0-9]{1,6}$' then (r.stats->>'examined')::int else 0 end) as examined,
                 coalesce(l.vetted, 0) as vetted, coalesce(l.rejected, 0) as rejected, coalesce(l.duplicate, 0) as duplicate
            from grants.discovery_runs r
            full join (select run_label, min(found_at) as first_at, max(found_at) as last_at, count(*) as n,
                              count(*) filter (where outcome = 'vetted') as vetted, count(*) filter (where outcome = 'rejected') as rejected,
                              count(*) filter (where outcome = 'duplicate') as duplicate
                         from grants.discovery_log where run_label is not null group by run_label) l using (run_label)
           order by 2 desc limit 30) x), '[]'::jsonb),
      -- yield per lens uses each source's status today, so later screen-outs are counted honestly
      'by_lens', coalesce((
        select jsonb_agg(to_jsonb(x) order by x.examined desc, x.lens) from (
          select coalesce(l.lens, 'other') as lens, count(*) as examined,
                 count(*) filter (where l.outcome not in ('duplicate', 'unreachable') and coalesce(f.status, l.outcome) = 'vetted') as vetted,
                 count(*) filter (where l.outcome not in ('duplicate', 'unreachable') and coalesce(f.status, l.outcome) = 'rejected') as rejected
            from grants.discovery_log l left join grants.funders f on f.id = l.funder_id group by 1) x), '[]'::jsonb),
      'totals', (
        select jsonb_build_object('examined', count(*),
                 'vetted', count(*) filter (where l.outcome not in ('duplicate', 'unreachable') and coalesce(f.status, l.outcome) = 'vetted'),
                 'rejected', count(*) filter (where l.outcome not in ('duplicate', 'unreachable') and coalesce(f.status, l.outcome) = 'rejected'),
                 'candidate', count(*) filter (where l.outcome not in ('duplicate', 'unreachable') and coalesce(f.status, l.outcome) = 'candidate'))
          from grants.discovery_log l left join grants.funders f on f.id = l.funder_id)),
    'targets', jsonb_build_object(
      'by_bucket', coalesce((
        select jsonb_agg(to_jsonb(x) order by x.bucket) from (
          select b.bucket, count(t.id) filter (where t.status = 'pending') as pending, count(t.id) filter (where t.status = 'covered') as covered,
                 count(t.id) filter (where t.status = 'rejected') as rejected, count(t.id) filter (where t.status = 'deferred') as deferred
            from jsonb_object_keys((select value from grants.settings where key = 'coverage_min')) as b(bucket)
            left join grants.targets t on t.bucket = b.bucket group by b.bucket) x), '[]'::jsonb),
      'next', coalesce((
        select jsonb_agg(jsonb_build_object('org', t.org, 'program_hint', t.program_hint, 'bucket', t.bucket, 'priority', t.priority, 'why', t.why) order by t.priority, t.created_at, t.org)
          from (select * from grants.targets where status = 'pending' order by priority, created_at, org limit 15) t), '[]'::jsonb)),
    'screened', coalesce((
      select jsonb_agg(jsonb_build_object('name', f.name, 'program', f.program, 'bucket', f.bucket, 'reason', f.reject_reason, 'at', f.updated_at) order by f.updated_at desc)
        from (select name, program, bucket, reject_reason, updated_at from grants.funders
               where status = 'rejected' and category <> 'aggregator' order by updated_at desc limit 250) f), '[]'::jsonb),
    'last_run', (select to_jsonb(r) - 'stats' from (select started_at, finished_at, status, planned, fetched, not_modified, changed, errors, elapsed_ms
                   from grants.refresh_runs where finished_at is not null order by started_at desc limit 1) r),
    'runs_24h', (select jsonb_build_object('runs', count(*), 'fetched', coalesce(sum(fetched), 0), 'changed', coalesce(sum(changed), 0), 'errors', coalesce(sum(errors), 0))
                   from grants.refresh_runs where started_at > now() - interval '24 hours')
  )
$function$;

drop function if exists grants.set_collection(uuid, jsonb, text);
drop function if exists grants.collection_metrics();
drop function if exists grants.sweep_opportunities();
drop function if exists grants.collection_state(uuid);
drop function if exists grants.collect_mode(text, jsonb);
alter table grants.funders drop column if exists collect_note, drop column if exists collect_verified_at;
revoke all on all functions in schema grants from public, anon, authenticated;

commit;
