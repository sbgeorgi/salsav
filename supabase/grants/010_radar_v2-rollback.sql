-- Rollback for 008_radar_v2 (parts a to d).
-- Restores the exact definitions that were live on 2026-11-12 00:30 UTC (captured with pg_get_functiondef / pg_get_viewdef
-- before any change). Funder rows changed by the v2 re-scoring are restored from grants.funders_v1_backup (step 3).
-- Run in the SQL editor, top to bottom. Steps 4 and 5 drop v2-only objects and their data: run them only for a full rollback.

begin;

-- 1) functions replaced by 008
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
    'funders', coalesce((
      select jsonb_agg(to_jsonb(v) - 'status'
                       || jsonb_build_object('team', jsonb_build_object('state', coalesce(t.state, 'new'), 'owner', t.owner, 'updated_at', t.updated_at))
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
    'last_run', (select to_jsonb(r) - 'stats' from (select started_at, finished_at, status, planned, fetched, not_modified, changed, errors, elapsed_ms
                   from grants.refresh_runs where finished_at is not null order by started_at desc limit 1) r),
    'runs_24h', (select jsonb_build_object('runs', count(*), 'fetched', coalesce(sum(fetched), 0), 'changed', coalesce(sum(changed), 0), 'errors', coalesce(sum(errors), 0))
                   from grants.refresh_runs where started_at > now() - interval '24 hours')
  )
$function$;

CREATE OR REPLACE FUNCTION public.grants_set_state(p_pass text, p_funder uuid, p_patch jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare r grants.team_state%rowtype; v_actor text := left(coalesce(p_patch->>'actor', p_patch->>'owner', 'team'), 60);
begin
  if not grants.check_pass(p_pass) then raise exception 'bad passcode' using errcode = '28000'; end if;
  if not exists (select 1 from grants.funders where id = p_funder and status = 'vetted') then raise exception 'unknown funder'; end if;
  if p_patch ? 'state' and (p_patch->>'state') not in ('new','reviewing','applying','submitted','skip') then raise exception 'bad state'; end if;
  insert into grants.team_state(funder_id, state, owner, notes, updated_by)
  values (p_funder, coalesce(p_patch->>'state', 'new'), left(p_patch->>'owner', 80), left(p_patch->>'notes', 4000), v_actor)
  on conflict (funder_id) do update set
    state = case when p_patch ? 'state' then p_patch->>'state' else grants.team_state.state end,
    owner = case when p_patch ? 'owner' then left(p_patch->>'owner', 80) else grants.team_state.owner end,
    notes = case when p_patch ? 'notes' then left(p_patch->>'notes', 4000) else grants.team_state.notes end,
    updated_at = now(), updated_by = v_actor
  returning * into r;
  insert into grants.team_events(funder_id, actor, kind, payload)
  values (p_funder, v_actor, 'update', (p_patch - 'actor' - 'notes') || jsonb_build_object('notes_changed', p_patch ? 'notes'));
  return to_jsonb(r);
end $function$;

CREATE OR REPLACE FUNCTION grants.register_source(p jsonb, p_lens text DEFAULT NULL::text, p_run_label text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'grants', 'extensions', 'pg_temp'
AS $function$
declare
  v_id uuid; v_exist record; v_status text := coalesce(p->>'status', 'candidate');
  v_key text := grants.name_key((p->>'name') || ' ' || coalesce(p->>'program', ''));
begin
  select id, name, status into v_exist from grants.funders
   where url_norm = grants.url_norm(p->>'url') or name_key = v_key limit 1;
  if found then
    insert into grants.discovery_log(url, name, lens, outcome, reason, run_label, funder_id)
    values (p->>'url', p->>'name', p_lens, 'duplicate', 'already in funders as ' || v_exist.name || ' (' || v_exist.status || ')', p_run_label, v_exist.id)
    on conflict (url_norm) do nothing;
    return jsonb_build_object('result', 'duplicate', 'funder_id', v_exist.id, 'existing_name', v_exist.name);
  end if;
  insert into grants.funders(name, program, category, url, apply_url, feed_url, geography, themes, award_min_usd, award_max_usd,
        amount_confidence, award_note, ua_eligibility, cycle, next_deadline, deadline_note, open_now, requirements, requirements_text,
        eligibility_note, notes, partner_needed, fit_score, fit_reasons, page_type, fetchability, adapter, adapter_config,
        status, vetted_at, vetted_by, vet_note, reject_reason, confidence, discovered_via)
  values (p->>'name', p->>'program', p->>'category', p->>'url', p->>'apply_url', p->>'feed_url',
        coalesce(array(select jsonb_array_elements_text(p->'geography')), '{}'), coalesce(array(select jsonb_array_elements_text(p->'themes')), '{}'),
        nullif(p->>'award_min_usd', '')::bigint, nullif(p->>'award_max_usd', '')::bigint,
        coalesce(p->>'amount_confidence', 'unknown'), p->>'award_note', coalesce(p->>'ua_eligibility', 'unknown'), coalesce(p->>'cycle', 'closed_unknown'),
        nullif(p->>'next_deadline', '')::date, p->>'deadline_note', (p->>'open_now')::boolean, coalesce(p->'requirements', '{}'::jsonb), p->>'requirements_text',
        p->>'eligibility_note', p->>'notes', coalesce(array(select jsonb_array_elements_text(p->'partner_needed')), '{}'),
        nullif(p->>'fit_score', '')::smallint, coalesce(array(select jsonb_array_elements_text(p->'fit_reasons')), '{}'),
        coalesce(p->>'page_type', 'html_static'), coalesce(p->>'fetchability', 'unknown'), coalesce(p->>'adapter', 'html'), coalesce(p->'adapter_config', '{}'::jsonb),
        v_status, case when v_status = 'vetted' then now() end, case when v_status = 'vetted' then coalesce(p->>'vetted_by', 'discovery') end,
        p->>'vet_note', p->>'reject_reason', nullif(p->>'confidence', '')::real, coalesce(p->>'discovered_via', p_lens))
  returning id into v_id;
  insert into grants.discovery_log(url, name, lens, outcome, reason, run_label, funder_id)
  values (p->>'url', p->>'name', p_lens, case v_status when 'vetted' then 'vetted' when 'rejected' then 'rejected' else 'candidate' end,
          coalesce(p->>'vet_note', p->>'reject_reason'), p_run_label, v_id)
  on conflict (url_norm) do nothing;
  return jsonb_build_object('result', 'inserted', 'funder_id', v_id, 'status', v_status);
end $function$;

CREATE OR REPLACE FUNCTION grants.finish_run(p_run uuid, p_stats jsonb)
 RETURNS void
 LANGUAGE sql
 SET search_path TO 'grants', 'extensions', 'pg_temp'
AS $function$
  update grants.refresh_runs set
    finished_at = now(),
    planned = coalesce((p_stats->>'planned')::int, planned),
    fetched = coalesce((p_stats->>'fetched')::int, 0),
    not_modified = coalesce((p_stats->>'not_modified')::int, 0),
    changed = coalesce((p_stats->>'changed')::int, 0),
    errors = coalesce((p_stats->>'errors')::int, 0),
    throttled = coalesce((p_stats->>'throttled')::int, 0),
    robots_skipped = coalesce((p_stats->>'robots_skipped')::int, 0),
    bytes = coalesce((p_stats->>'bytes')::bigint, 0),
    elapsed_ms = coalesce((p_stats->>'elapsed_ms')::int, (extract(epoch from now() - started_at) * 1000)::int),
    chained = coalesce((p_stats->>'chained')::boolean, false),
    stats = coalesce(p_stats->'hosts', '{}'::jsonb),
    status = case when coalesce((p_stats->>'errors')::int, 0) = 0 then 'ok'
                  when coalesce((p_stats->>'fetched')::int, 0) + coalesce((p_stats->>'not_modified')::int, 0) > 0 then 'partial'
                  else 'error' end
  where id = p_run
$function$;

revoke all on function grants.register_source(jsonb, text, text), grants.finish_run(uuid, jsonb) from public, anon, authenticated;
revoke all on function public.grants_feed(), public.grants_set_state(text, uuid, jsonb) from public;
grant execute on function public.grants_feed(), public.grants_set_state(text, uuid, jsonb) to anon, authenticated;

-- 2) view: columns were appended, so it has to be dropped and recreated
drop view if exists grants.v_funders;
create view grants.v_funders as
 WITH s AS (
         SELECT ( SELECT (settings.value #>> '{}'::text[])::integer AS int4
                   FROM grants.settings
                  WHERE settings.key = 'min_days_left'::text) AS min_days,
            ( SELECT (settings.value #>> '{}'::text[])::bigint AS int8
                   FROM grants.settings
                  WHERE settings.key = 'min_award_usd'::text) AS min_award,
            (now() AT TIME ZONE 'America/Phoenix'::text)::date AS today
        ), d AS (
         SELECT f_1.id,
            COALESCE(( SELECT min(o.deadline) AS min
                   FROM grants.opportunities o
                  WHERE o.funder_id = f_1.id AND (o.status = ANY (ARRAY['open'::text, 'forecasted'::text])) AND o.vet_status = 'vetted'::text AND o.deadline >= (( SELECT s_1.today
                           FROM s s_1))), f_1.next_deadline) AS deadline
           FROM grants.funders f_1
        )
 SELECT f.id,
    f.name,
    f.program,
    f.category,
    f.bucket,
    f.url,
    f.apply_url,
    f.feed_url,
    f.geography,
    f.themes,
    f.award_min_usd,
    f.award_max_usd,
    f.amount_confidence,
    f.award_note,
    f.ua_eligibility,
    f.cycle,
    d.deadline,
    f.deadline_note,
    f.open_now,
    d.deadline - s.today AS days_left,
        CASE
            WHEN d.deadline IS NULL THEN
            CASE f.cycle
                WHEN 'rolling'::text THEN 'rolling'::text
                WHEN 'open_ended'::text THEN 'rolling'::text
                WHEN 'invite_only'::text THEN 'invite'::text
                ELSE 'unknown'::text
            END
            WHEN d.deadline < s.today THEN 'expired'::text
            WHEN (d.deadline - s.today) < s.min_days THEN 'too_soon'::text
            ELSE 'ok'::text
        END AS deadline_state,
        CASE
            WHEN f.award_max_usd IS NULL THEN 'unverified'::text
            WHEN f.award_max_usd >= s.min_award THEN 'ok'::text
            ELSE 'low'::text
        END AS amount_flag,
    f.requirements,
    f.requirements_text,
    f.eligibility_note,
    f.notes,
    f.partner_needed,
    f.fit_score,
    f.fit_reasons,
    f.page_type,
    f.fetchability,
    f.confidence,
    f.vetted_at,
    f.vet_note,
    f.last_checked_at,
    f.last_ok_at,
    f.last_changed_at,
    f.consecutive_failures,
    f.last_links AS doc_links,
    f.status
   FROM grants.funders f
     JOIN d ON d.id = f.id
     CROSS JOIN s;
revoke all on grants.v_funders from public, anon, authenticated;

-- 3) funder rows back to their v1 values (status, score and facts as they were before the re-scoring)
alter table grants.funders drop constraint if exists funders_vetted_fit;
drop trigger if exists funders_fit_derive on grants.funders;
update grants.funders f set
  status = b.status, reject_reason = b.reject_reason, fit_score = b.fit_score, fit_reasons = b.fit_reasons,
  ua_eligibility = b.ua_eligibility, award_min_usd = b.award_min_usd, award_max_usd = b.award_max_usd,
  amount_confidence = b.amount_confidence, award_note = b.award_note, cycle = b.cycle, next_deadline = b.next_deadline,
  deadline_note = b.deadline_note, open_now = b.open_now, eligibility_note = b.eligibility_note, requirements = b.requirements,
  themes = b.themes, fetchability = b.fetchability, confidence = b.confidence, vet_note = b.vet_note,
  vetted_at = b.vetted_at, vetted_by = b.vetted_by
from grants.funders_v1_backup b where b.id = f.id;

-- 4) team states: awarded / declined did not exist in v1
update grants.team_state set state = 'submitted' where state in ('awarded', 'declined');
alter table grants.team_state drop constraint team_state_state_check;
alter table grants.team_state add constraint team_state_state_check check (state = any (array['new'::text, 'reviewing'::text, 'applying'::text, 'submitted'::text, 'skip'::text]));
alter table grants.team_state drop column if exists ask_usd;

-- 5) v2-only objects
select cron.unschedule('grants-metrics') where exists (select 1 from cron.job where jobname = 'grants-metrics');
drop function if exists public.grants_admin_import(text, text, jsonb);
drop function if exists grants.reverify_source(uuid, jsonb, text), grants.upsert_opportunity(jsonb, text), grants.add_targets(jsonb, text),
  grants.set_target(uuid, text, text), grants.log_discovery_run(text, text, jsonb), grants.snapshot_metrics(), grants.metrics_now(),
  grants.discovery_brief(), grants.check_known(jsonb), grants.funders_fit_derive(), grants.fit_compute(jsonb, text, bigint, jsonb, text, text),
  grants.fit_clean(jsonb), grants.evidence_clean(jsonb), grants.fit_problem(jsonb), grants.gate_reason(jsonb, text, bigint);
alter table grants.funders drop column if exists fit_inputs, drop column if exists fit_breakdown, drop column if exists evidence,
  drop column if exists evidence_ok, drop column if exists verified_at, drop column if exists verified_by;
drop table if exists grants.targets, grants.discovery_runs, grants.vet_events, grants.metrics_daily, grants.funders_v1_backup;
delete from grants.settings where key in ('fit_rubric', 'coverage_min', 'theme_vocab');

commit;
