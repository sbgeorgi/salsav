-- 023 ROLLBACK for supabase/grants/023_human_overrides.sql (applied 2026-11-18 as version 20261118013547). NOT EXECUTED.
-- Run the whole file in the Supabase dashboard SQL editor between BEGIN; and COMMIT; so a raise anywhere rolls back every step.
-- The MCP server declines this file (it drops triggers, columns and a table), so apply_migration is not an option.
-- DATA LOSS: drops grants.notes (every team note, soft-deleted rows included), the human_* columns on funders and
--   opportunities, agent_queue, vet_events.actor (the actor history), and the lead audit rows (team_events with a null funder_id).
--   Take a backup first.
-- Promoted funders that would fail the original scope/fit constraints move to rejected with a reason (not deleted).
-- Calls the team demoted keep vet_status rejected after rollback. Calls moved to candidate by the unlist cascade stay candidate.
-- Order: guard, RESTORE the four functions and their md5 check (before any change to data or triggers), drop triggers,
--   data move, constraint swap, drop new objects, drop table and columns.
-- The four restored definitions are the exact live text saved in .claude/runs/dashboard-v3/live/ (generated, not retyped).

do $guard$
begin
  if not exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                  where n.nspname = 'public' and p.proname = 'grants_registry') then
    raise exception '023 rollback: 023 is not applied (public.grants_registry is missing)';
  end if;
end
$guard$;

-- 1. restore the four replaced functions from live/ (pre-023 text). Checked before anything else changes.
-- restored from live/public__grants_set_state.sql (md5 6a82c6fb1a707ce5fb12726d547c3e59)
CREATE OR REPLACE FUNCTION public.grants_set_state(p_pass text, p_funder uuid, p_patch jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare r grants.team_state%rowtype; v_actor text := left(coalesce(p_patch->>'actor', p_patch->>'owner', 'team'), 60); v_ask bigint;
begin
  if not grants.check_pass(p_pass) then raise exception 'bad passcode' using errcode = '28000'; end if;
  if not exists (select 1 from grants.funders where id = p_funder and status = 'vetted') then raise exception 'unknown funder'; end if;
  if p_patch ? 'state' and coalesce(p_patch->>'state', '') not in ('new', 'reviewing', 'applying', 'submitted', 'awarded', 'declined', 'skip') then raise exception 'bad state'; end if;
  if p_patch ? 'ask_usd' and jsonb_typeof(p_patch->'ask_usd') <> 'null' then
    if jsonb_typeof(p_patch->'ask_usd') <> 'number' or (p_patch->>'ask_usd')::numeric not between 0 and 100000000000 then raise exception 'bad ask_usd'; end if;
    v_ask := round((p_patch->>'ask_usd')::numeric)::bigint;
  end if;
  insert into grants.team_state(funder_id, state, owner, notes, ask_usd, updated_by)
  values (p_funder, coalesce(p_patch->>'state', 'new'), left(p_patch->>'owner', 80), left(p_patch->>'notes', 4000), v_ask, v_actor)
  on conflict (funder_id) do update set
    state = case when p_patch ? 'state' then p_patch->>'state' else grants.team_state.state end,
    owner = case when p_patch ? 'owner' then left(p_patch->>'owner', 80) else grants.team_state.owner end,
    notes = case when p_patch ? 'notes' then left(p_patch->>'notes', 4000) else grants.team_state.notes end,
    ask_usd = case when p_patch ? 'ask_usd' then v_ask else grants.team_state.ask_usd end,
    updated_at = now(), updated_by = v_actor
  returning * into r;
  insert into grants.team_events(funder_id, actor, kind, payload)
  values (p_funder, v_actor, 'update', (p_patch - 'actor' - 'notes') || jsonb_build_object('notes_changed', p_patch ? 'notes'));
  return to_jsonb(r);
end $function$
;

-- restored from live/public__grants_team_notes.sql (md5 86c7b7a8a324b1b7373e71081f17fcc1)
CREATE OR REPLACE FUNCTION public.grants_team_notes(p_pass text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  if not grants.check_pass(p_pass) then raise exception 'bad passcode' using errcode = '28000'; end if;
  return jsonb_build_object(
    'team', coalesce((select jsonb_agg(to_jsonb(t)) from grants.team_state t), '[]'::jsonb),
    'events', coalesce((select jsonb_agg(to_jsonb(e) order by e.at desc) from (select * from grants.team_events order by at desc limit 100) e), '[]'::jsonb));
end $function$
;

-- restored from live/grants__discovery_brief.sql (md5 54839dc87eca4f98aebee216a9b907d4)
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
;

-- restored from live/grants__reverify_source.sql (md5 d5fd707c890b202453e10b55538bca4c)
CREATE OR REPLACE FUNCTION grants.reverify_source(p_id uuid, p jsonb, p_run_label text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'grants', 'extensions', 'pg_temp'
AS $function$
declare
  f grants.funders%rowtype; n grants.funders%rowtype; v_facts jsonb := coalesce(p->'facts', '{}'::jsonb);
  v_fit jsonb; v_b jsonb; v_fail text; v_verdict text := coalesce(p->>'verdict', 'keep'); v_themes text[];
  v_today date := (now() at time zone 'America/Phoenix')::date; v_kind text; v_changes jsonb; v_problem text;
begin
  if v_verdict not in ('keep', 'demote', 'promote') then raise exception 'verdict must be keep, demote or promote'; end if;
  select * into f from grants.funders where id = p_id for update;
  if not found then return jsonb_build_object('result', 'not_found', 'id', p_id); end if;
  n := f;
  if v_facts ? 'ua_eligibility' then n.ua_eligibility := coalesce(v_facts->>'ua_eligibility', 'unknown'); end if;
  if v_facts ? 'award_min_usd' then n.award_min_usd := round(nullif(v_facts->>'award_min_usd', '')::numeric)::bigint; end if;
  if v_facts ? 'award_max_usd' then n.award_max_usd := round(nullif(v_facts->>'award_max_usd', '')::numeric)::bigint; end if;
  if v_facts ? 'amount_confidence' then n.amount_confidence := coalesce(v_facts->>'amount_confidence', 'unknown'); end if;
  if v_facts ? 'award_note' then n.award_note := v_facts->>'award_note'; end if;
  if v_facts ? 'cycle' then n.cycle := coalesce(v_facts->>'cycle', 'closed_unknown'); end if;
  if v_facts ? 'next_deadline' then n.next_deadline := nullif(v_facts->>'next_deadline', '')::date; end if;
  if v_facts ? 'deadline_note' then n.deadline_note := v_facts->>'deadline_note'; end if;
  if v_facts ? 'open_now' then n.open_now := (v_facts->>'open_now')::boolean; end if;
  if v_facts ? 'eligibility_note' then n.eligibility_note := v_facts->>'eligibility_note'; end if;
  if jsonb_typeof(v_facts->'requirements') = 'object' then n.requirements := coalesce(f.requirements, '{}'::jsonb) || (v_facts->'requirements'); end if;
  if jsonb_typeof(v_facts->'themes') = 'array' then
    v_themes := array(select t from jsonb_array_elements_text(v_facts->'themes') t
                       where t in (select jsonb_array_elements_text(value) from grants.settings where key = 'theme_vocab'));
    if cardinality(v_themes) > 0 then n.themes := v_themes; end if;
  end if;
  if v_facts ? 'fetchability' then n.fetchability := coalesce(v_facts->>'fetchability', 'unknown'); end if;
  if v_facts ? 'confidence' then n.confidence := nullif(v_facts->>'confidence', '')::real; end if;

  if p ? 'fit' then
    v_fit := grants.fit_clean(p->'fit'); v_problem := grants.fit_problem(v_fit);
    if v_problem is not null then raise exception '%', v_problem; end if;
    n.fit_inputs := v_fit;
  end if;
  if n.fit_inputs is null and n.category <> 'aggregator' then
    raise exception 'this source has no itemized fit yet: send fit.mission, fit.activity, fit.geography and fit.precedent';
  end if;
  -- evidence keys present in the payload replace the stored ones (an empty quote removes the entry)
  if jsonb_typeof(p->'evidence') = 'object' then
    n.evidence := (coalesce(f.evidence, '{}'::jsonb) - array(select jsonb_object_keys(p->'evidence'))) || grants.evidence_clean(p->'evidence');
  end if;
  if n.award_max_usd is null then n.amount_confidence := 'unknown';
  elsif n.amount_confidence = 'published' and not (n.evidence ? 'award') then n.amount_confidence := 'estimated'; end if;
  if n.award_min_usd is not null and n.award_max_usd is not null and n.award_min_usd > n.award_max_usd then n.award_min_usd := null; end if;
  if n.next_deadline is not null and n.next_deadline < v_today then n.next_deadline := null; end if;
  if btrim(coalesce(p->>'vet_note', '')) <> '' then n.vet_note := left(btrim(p->>'vet_note'), 600); end if;

  v_b := grants.fit_compute(n.fit_inputs, n.ua_eligibility, n.award_max_usd, n.evidence, n.eligibility_note, n.award_note);
  v_fail := case when n.category = 'aggregator' then null else grants.gate_reason(v_b, n.ua_eligibility, n.award_max_usd) end;
  if v_verdict = 'demote' then
    n.status := 'rejected';
    n.reject_reason := left(coalesce(nullif(btrim(p->>'reason'), ''), v_fail, 'Screened out on re-check.'), 600);
  elsif v_fail is not null then
    n.status := 'rejected';
    n.reject_reason := case when f.status = 'rejected' and f.reject_reason is not null then f.reject_reason else v_fail end;
  elsif v_verdict = 'promote' and f.status in ('candidate', 'rejected') then
    if btrim(coalesce(n.vet_note, '')) = '' then raise exception 'promote needs a vet_note'; end if;
    n.status := 'vetted'; n.vetted_at := now(); n.vetted_by := left(coalesce(p->>'by', 'rescore'), 60); n.reject_reason := null;
  end if;
  n.verified_at := now(); n.verified_by := left(coalesce(p->>'by', 'rescore'), 60);

  update grants.funders set
    ua_eligibility = n.ua_eligibility, award_min_usd = n.award_min_usd, award_max_usd = n.award_max_usd, amount_confidence = n.amount_confidence,
    award_note = n.award_note, cycle = n.cycle, next_deadline = n.next_deadline, deadline_note = n.deadline_note, open_now = n.open_now,
    eligibility_note = n.eligibility_note, requirements = n.requirements, themes = n.themes, fetchability = n.fetchability, confidence = n.confidence,
    fit_inputs = n.fit_inputs, evidence = n.evidence, vet_note = n.vet_note, status = n.status, reject_reason = n.reject_reason,
    vetted_at = n.vetted_at, vetted_by = n.vetted_by, verified_at = n.verified_at, verified_by = n.verified_by
  where id = p_id returning * into n;

  select coalesce(jsonb_object_agg(o.key, jsonb_build_array(o.value, w.value)), '{}'::jsonb) into v_changes
    from jsonb_each(to_jsonb(f)) o join jsonb_each(to_jsonb(n)) w using (key)
   where o.key in ('status', 'fit_score', 'ua_eligibility', 'award_min_usd', 'award_max_usd', 'amount_confidence', 'cycle', 'next_deadline', 'open_now')
     and o.value is distinct from w.value;
  v_kind := case when f.status = 'vetted' and n.status = 'rejected' then 'demoted'
                 when f.status <> 'vetted' and n.status = 'vetted' then 'promoted'
                 when f.fit_inputs is null then 'rescored'
                 when v_changes = '{}'::jsonb then 'verified' else 'updated' end;
  insert into grants.vet_events(funder_id, kind, note, changes, run_label)
  values (p_id, v_kind, left(coalesce(case when n.status = 'rejected' then n.reject_reason end, nullif(btrim(p->>'note'), ''), n.vet_note), 600), v_changes, p_run_label);
  return jsonb_build_object('result', v_kind, 'id', p_id, 'name', n.name, 'status', n.status, 'fit_score', n.fit_score, 'reject_reason', n.reject_reason, 'changes', v_changes);
end $function$
;


-- 2. verify the restored texts (raises before any data or trigger changes)
do $verify$
begin
  if md5(pg_get_functiondef('public.grants_set_state(text,uuid,jsonb)'::regprocedure)) <> '6a82c6fb1a707ce5fb12726d547c3e59'
     or md5(pg_get_functiondef('public.grants_team_notes(text)'::regprocedure)) <> '86c7b7a8a324b1b7373e71081f17fcc1'
     or md5(pg_get_functiondef('grants.discovery_brief()'::regprocedure)) <> '54839dc87eca4f98aebee216a9b907d4'
     or md5(pg_get_functiondef('grants.reverify_source(uuid,jsonb,text)'::regprocedure)) <> 'd5fd707c890b202453e10b55538bca4c' then
    raise exception 'rollback verify: a restored function does not match its saved live md5';
  end if;
end
$verify$;

-- 3. triggers
drop trigger if exists funders_zz_human_lock on grants.funders;
drop trigger if exists funders_zz_unlist_cascade on grants.funders;
drop trigger if exists opportunities_zz_human_lock on grants.opportunities;
drop trigger if exists opportunities_a_listed_guard on grants.opportunities;
drop trigger if exists vet_events_human_guard on grants.vet_events;

-- 4. move promoted funders that the original constraints would reject (a CHECK fails only when the expression is FALSE)
update grants.funders
   set status = 'rejected',
       reject_reason = coalesce(nullif(btrim(reject_reason), ''), 'Moved out of listing by the 023 rollback: no scored fit or scope gate'),
       human_lock = null,
       agent_queue = null
 where status = 'vetted' and human_lock = 'promoted'
   and (
     (category = 'aggregator' or (fit_inputs is not null and fit_score >= 40))
     and (vetted_at is not null and vet_note is not null and btrim(vet_note) <> ''
          and fit_score is not null and coalesce(array_length(fit_reasons, 1), 0) > 0
          and ua_eligibility <> 'unlikely' and (award_max_usd is null or award_max_usd >= 200000))
   ) is false;

-- 5. constraints back to the pre-023 text (grants/.claude/runs/dashboard-v3/live/constraints_triggers_acl.txt)
alter table grants.funders drop constraint if exists funders_vetted_fit;
alter table grants.funders add constraint funders_vetted_fit check (
  ((status <> 'vetted'::text) or (category = 'aggregator'::text) or ((fit_inputs is not null) and (fit_score >= 40))));

alter table grants.funders drop constraint if exists funders_vetted_scope;
alter table grants.funders add constraint funders_vetted_scope check (
  ((status <> 'vetted'::text) or ((vetted_at is not null) and (vet_note is not null) and (btrim(vet_note) <> ''::text)
    and (fit_score is not null) and (COALESCE(array_length(fit_reasons, 1), 0) > 0) and (ua_eligibility <> 'unlikely'::text)
    and ((award_max_usd is null) or (award_max_usd >= 200000)))));

-- 6. drop the 023 objects (public wrappers first, then internal writers and readers, then trigger functions)
drop function if exists public.grants_note(text, uuid, jsonb);
drop function if exists public.grants_set_lead(text, uuid, jsonb);
drop function if exists public.grants_set_call(text, uuid, jsonb);
drop function if exists public.grants_set_funder(text, uuid, jsonb);
drop function if exists public.grants_funder(uuid, text);
drop function if exists public.grants_registry(text);
drop function if exists grants.resolve_promoted(uuid, text, text);
drop function if exists grants.pass_denied();
drop function if exists grants.note_remove(bigint, text);
drop function if exists grants.note_add(uuid, text, text, uuid);
drop function if exists grants.human_set_lead(uuid, text, text, text);
drop function if exists grants.human_set_call(uuid, text, text, text);
drop function if exists grants.human_set_funder(uuid, text, text, text);
drop function if exists grants.human_registry_call(grants.opportunities, boolean);
drop function if exists grants.human_registry_funder(grants.funders, boolean);
drop function if exists grants.human_gates(grants.funders);
drop function if exists grants.human_thresholds();
drop function if exists grants.vet_events_human_guard();
drop function if exists grants.opportunities_listed_guard();
drop function if exists grants.funders_unlist_cascade();
drop function if exists grants.opportunities_human_lock();
drop function if exists grants.funders_human_lock();

-- 7. data and table
drop table if exists grants.notes;
delete from grants.team_events where funder_id is null;
alter table grants.team_events alter column funder_id set not null;

alter table grants.funders
  drop column if exists human_lock, drop column if exists human_by, drop column if exists human_at, drop column if exists human_note,
  drop column if exists agent_queue, drop column if exists agent_queue_at, drop column if exists agent_queue_note;
alter table grants.opportunities
  drop column if exists human_lock, drop column if exists human_by, drop column if exists human_at, drop column if exists human_note;
alter table grants.vet_events drop column if exists actor;
