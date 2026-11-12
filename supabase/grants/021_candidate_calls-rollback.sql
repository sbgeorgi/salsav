-- rollback for 021_candidate_calls: exact grants_feed definition live before 021 (2026-11-12), and drop reject_opportunity.
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
                       || jsonb_build_object('team', jsonb_build_object('state', coalesce(t.state, 'new'), 'owner', t.owner, 'ask_usd', t.ask_usd, 'updated_at', t.updated_at), 'collection', grants.collection_state(v.id))
                       order by v.deadline nulls last, v.fit_score desc nulls last, v.name)
        from grants.v_funders v left join grants.team_state t on t.funder_id = v.id
       where v.status = 'vetted' and v.category <> 'aggregator'), '[]'::jsonb),
    'opportunities', coalesce((
      select jsonb_agg(jsonb_build_object('id', o.id, 'funder_id', o.funder_id, 'title', o.title, 'url', o.url, 'apply_url', o.apply_url,
               'description', o.description, 'open_date', o.open_date, 'deadline', o.deadline, 'deadline_text', o.deadline_text,
               'award_min_usd', o.award_min_usd, 'award_max_usd', o.award_max_usd, 'status', o.status, 'doc_links', o.doc_links,
               'first_seen_at', o.first_seen_at, 'last_seen_at', o.last_seen_at, 'source_adapter', o.source_adapter) order by o.deadline nulls last)
        from grants.opportunities o join grants.funders f on f.id = o.funder_id
       where f.status = 'vetted' and o.vet_status = 'vetted' and o.status in ('forecasted', 'open')
         and (o.deadline is null or o.deadline >= (now() at time zone 'America/Phoenix')::date)), '[]'::jsonb),
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
    'collection', grants.collection_metrics(),
    'last_run', (select to_jsonb(r) - 'stats' from (select started_at, finished_at, status, planned, fetched, not_modified, changed, errors, elapsed_ms
                   from grants.refresh_runs where finished_at is not null order by started_at desc limit 1) r),
    'runs_24h', (select jsonb_build_object('runs', count(*), 'fetched', coalesce(sum(fetched), 0), 'changed', coalesce(sum(changed), 0), 'errors', coalesce(sum(errors), 0))
                   from grants.refresh_runs where started_at > now() - interval '24 hours')
  )
$function$;

drop function if exists grants.reject_opportunity(uuid, text, text);
