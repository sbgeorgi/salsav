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
    'collection_gaps', coalesce((select jsonb_agg(to_jsonb(x) - 'rn' order by x.rn) from (
        select l.id, l.name, l.program, l.url, l.bucket, l.cycle, c.c->>'mode' as mode, c.c->>'health' as health, c.c->>'note' as note,
               c.c->>'verified_at' as verified_at, l.fetchability, l.consecutive_failures,
               row_number() over (order by (c.c->>'health' = 'failing') desc, (c.c->>'mode' in ('page', 'none')) desc, l.fit_score desc nulls last, l.name) as rn
          from listed l cross join lateral (select grants.collection_state(l.id) as c) c
         where c.c->>'health' <> 'ok'
            or (c.c->>'mode' in ('page', 'none')
                and (c.c->>'verified_at' is null or (c.c->>'verified_at')::timestamptz < now() - interval '120 days'))) x where x.rn <= 15), '[]'::jsonb),
    'metrics', grants.metrics_now(),
    'last_runs', coalesce((select jsonb_agg(to_jsonb(r) order by r.started_at desc)
                             from (select run_label, started_at, finished_at, summary, stats from grants.discovery_runs order by started_at desc limit 3) r), '[]'::jsonb),
    'last_refresh', (select to_jsonb(r) from (select finished_at, status, planned, fetched, changed, errors
                                                from grants.refresh_runs where finished_at is not null order by started_at desc limit 1) r))
$function$
