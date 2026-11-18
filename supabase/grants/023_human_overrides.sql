-- 023 human overrides (dashboard v3). Authored 2026-11-17 by the SQL track; review round 2026-11-17 (see .claude/runs/dashboard-v3/sql-notes.md).
-- Tested before apply: this file and tests/023_human_overrides_test.sql ran together in one rolled-back DO block on the live project.
-- Rollback: 023_human_overrides-rollback.sql (run it as ONE apply_migration).
--
-- What changes:
--   columns   funders(human_lock, human_by, human_at, human_note, agent_queue, agent_queue_at, agent_queue_note),
--             opportunities(human_lock, human_by, human_at, human_note), vet_events(actor),
--             team_events.funder_id dropped NOT NULL (lead audit rows may have no funder)
--   constraints  funders_vetted_fit and funders_vetted_scope accept a promoted lock (NULL-safe: coalesce)
--   table     grants.notes (RLS on, no policies, no anon/authenticated grants)
--   triggers  funders_zz_human_lock, opportunities_zz_human_lock (BEFORE UPDATE, fire last by name),
--             opportunities_a_listed_guard (BEFORE INSERT OR UPDATE: a vetted call needs a listed funder, fires first by name),
--             funders_zz_unlist_cascade (AFTER UPDATE OF status: a funder that leaves 'vetted' moves its vetted calls to candidate),
--             vet_events_human_guard (BEFORE INSERT, automated promoted/demoted events that disagree with the row become updated)
--   internal  grants.human_thresholds, human_gates, human_registry_funder(f, team), human_registry_call(o, team), human_set_funder,
--             human_set_call, human_set_lead, note_add, note_remove, resolve_promoted (postgres only)
--   public    grants_registry(p_pass), grants_funder(p_id, p_pass) (read; passcode optional, anonymous tier redacts team identity);
--             grants_set_funder, grants_set_call, grants_set_lead, grants_note (passcode writes; a bad passcode returns grants.pass_denied())
--   replaced  public.grants_set_state, public.grants_team_notes, grants.discovery_brief, grants.reverify_source
--             (guarded by md5 of the live text; reverify_source patch records a failed gate on a listed funder)
-- Not changed: grants_feed, upsert_opportunity, reject_opportunity, apply_fetch_result, register_source.
--   Those are held in line by the lock triggers and the listed-funder guard, so no edit is needed.
--
-- Passcode failures: a write wrapper that raised 28000 would roll back the failure row check_pass just wrote, so the
-- lockout would never trip. Writes therefore return grants.pass_denied(): HTTP 403 with the body a raised 28000 gives.
-- The lockout ('locked', P0001) still raises. Lockout numbers: 005_hardening sets 40 failures per 10 minutes (not 8 per 15).
--
-- Dollar tags used: $guard$, $body$, $patch$, $a$, $r$ (none of the forbidden tags).

-- 0. guards: refuse to apply if a function we replace is not the live text saved in live/
do $guard$
begin
  if md5(pg_get_functiondef('public.grants_set_state(text,uuid,jsonb)'::regprocedure)) <> '6a82c6fb1a707ce5fb12726d547c3e59' then
    raise exception '023 guard: public.grants_set_state differs from live/public__grants_set_state.sql; re-save live and re-author';
  end if;
  if md5(pg_get_functiondef('public.grants_team_notes(text)'::regprocedure)) <> '86c7b7a8a324b1b7373e71081f17fcc1' then
    raise exception '023 guard: public.grants_team_notes differs from live/public__grants_team_notes.sql; re-save live and re-author';
  end if;
  if md5(pg_get_functiondef('grants.discovery_brief()'::regprocedure)) <> '54839dc87eca4f98aebee216a9b907d4' then
    raise exception '023 guard: grants.discovery_brief differs from live/grants__discovery_brief.sql; re-save live and re-author';
  end if;
  if md5(pg_get_functiondef('grants.reverify_source(uuid,jsonb,text)'::regprocedure)) <> 'd5fd707c890b202453e10b55538bca4c' then
    raise exception '023 guard: grants.reverify_source differs from live/grants__reverify_source.sql; re-save live and re-author';
  end if;
  if exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
              where (n.nspname = 'grants' and p.proname in ('human_thresholds', 'human_gates', 'human_registry_funder', 'human_registry_call',
                     'human_set_funder', 'human_set_call', 'human_set_lead', 'note_add', 'note_remove', 'resolve_promoted', 'pass_denied',
                     'opportunities_listed_guard', 'funders_unlist_cascade'))
                 or (n.nspname = 'public' and p.proname in ('grants_registry', 'grants_funder', 'grants_set_funder', 'grants_set_call', 'grants_set_lead', 'grants_note'))) then
    raise exception '023 guard: a 023 object already exists; this migration is not idempotent over a partial apply';
  end if;
end
$guard$;

-- 1. columns
alter table grants.funders
  add column if not exists human_lock text constraint funders_human_lock_check check (human_lock in ('promoted', 'demoted')),
  add column if not exists human_by text,
  add column if not exists human_at timestamptz,
  add column if not exists human_note text,
  add column if not exists agent_queue text constraint funders_agent_queue_check check (agent_queue in ('pending', 'done')),
  add column if not exists agent_queue_at timestamptz,
  add column if not exists agent_queue_note text;

alter table grants.opportunities
  add column if not exists human_lock text constraint opportunities_human_lock_check check (human_lock in ('promoted', 'demoted')),
  add column if not exists human_by text,
  add column if not exists human_at timestamptz,
  add column if not exists human_note text;

alter table grants.vet_events
  add column if not exists actor text;

-- lead audit rows (kinds lead_queue, lead_dismiss) can belong to a lead with no funder yet
alter table grants.team_events alter column funder_id drop not null;

-- 2. relaxed scope constraints. coalesce() keeps the lock test non-NULL: a NULL disjunct would make a CHECK pass silently.
alter table grants.funders drop constraint if exists funders_vetted_fit;
alter table grants.funders add constraint funders_vetted_fit check (
  (status <> 'vetted'::text) or (coalesce(human_lock, ''::text) = 'promoted'::text) or (category = 'aggregator'::text)
  or ((fit_inputs is not null) and (fit_score >= 40)));

alter table grants.funders drop constraint if exists funders_vetted_scope;
alter table grants.funders add constraint funders_vetted_scope check (
  (status <> 'vetted'::text) or (coalesce(human_lock, ''::text) = 'promoted'::text)
  or ((vetted_at is not null) and (vet_note is not null) and (btrim(vet_note) <> ''::text) and (fit_score is not null)
      and (COALESCE(array_length(fit_reasons, 1), 0) > 0) and (ua_eligibility <> 'unlikely'::text)
      and ((award_max_usd is null) or (award_max_usd >= 200000))));

-- 3. notes
create table if not exists grants.notes (
  id bigint generated always as identity primary key,
  funder_id uuid not null references grants.funders(id) on delete cascade,
  opportunity_id uuid references grants.opportunities(id) on delete set null,
  body text not null constraint notes_body_len check (char_length(body) between 1 and 2000),
  actor text not null constraint notes_actor_len check (char_length(actor) between 1 and 60),
  at timestamptz not null default now(),
  deleted_at timestamptz,
  deleted_by text
);
create index if not exists notes_funder_at_idx on grants.notes (funder_id, at desc) where deleted_at is null;
alter table grants.notes enable row level security;
revoke all on grants.notes from public, anon, authenticated, service_role;

-- 4. lock triggers. A lock change must agree with the status it sets (a mismatch raises 22023).
-- Without a lock change, a status that disagrees with the lock is reverted and the side columns come back from OLD.
-- A release (lock null) is free: the status stays as it is.
create or replace function grants.funders_human_lock() returns trigger
language plpgsql set search_path to '' as $body$
begin
  if new.human_lock is null then return new; end if;
  if new.human_lock is distinct from old.human_lock then
    if (new.human_lock = 'promoted' and new.status <> 'vetted') or (new.human_lock = 'demoted' and new.status <> 'rejected') then
      raise exception 'the lock and the status must agree: a promoted funder is vetted, a demoted funder is rejected' using errcode = '22023';
    end if;
    return new;
  end if;
  if new.human_lock = 'promoted' and new.status <> 'vetted' then
    new.status := 'vetted';
    new.reject_reason := old.reject_reason; new.vetted_at := old.vetted_at; new.vetted_by := old.vetted_by; new.vet_note := old.vet_note;
  elsif new.human_lock = 'demoted' and new.status <> 'rejected' then
    new.status := 'rejected';
    new.reject_reason := coalesce(old.reject_reason, new.reject_reason, 'Screened out by the team.');
    new.vetted_at := old.vetted_at; new.vetted_by := old.vetted_by; new.vet_note := old.vet_note;
  end if;
  return new;
end
$body$;

create or replace trigger funders_zz_human_lock before update on grants.funders
  for each row execute function grants.funders_human_lock();

create or replace function grants.opportunities_human_lock() returns trigger
language plpgsql set search_path to '' as $body$
begin
  if new.human_lock is null then return new; end if;
  if new.human_lock is distinct from old.human_lock then
    if (new.human_lock = 'demoted' and new.vet_status <> 'rejected') or (new.human_lock = 'promoted' and new.vet_status <> 'vetted') then
      raise exception 'the call lock and the call status must agree' using errcode = '22023';
    end if;
    return new;
  end if;
  if new.human_lock = 'demoted' then new.vet_status := 'rejected';
  elsif new.human_lock = 'promoted' then new.vet_status := 'vetted';
  end if;
  return new;
end
$body$;

create or replace trigger opportunities_zz_human_lock before update on grants.opportunities
  for each row execute function grants.opportunities_human_lock();

-- 4b. a call is vetted only under a listed funder (a team-promoted call is exempt). Fires before the lock trigger (name a_ < zz_).
-- Closes the fetch race: apply_fetch_result locks the funder, but may have read it as listed before a demote.
create or replace function grants.opportunities_listed_guard() returns trigger
language plpgsql set search_path to '' as $body$
begin
  if new.vet_status = 'vetted' and coalesce(new.human_lock, '') <> 'promoted'
     and not exists (select 1 from grants.funders f where f.id = new.funder_id and f.status = 'vetted') then
    new.vet_status := 'candidate';
  end if;
  return new;
end
$body$;

create or replace trigger opportunities_a_listed_guard before insert or update on grants.opportunities
  for each row execute function grants.opportunities_listed_guard();

-- 4c. a funder that leaves 'vetted' (human demote or an automated reject) moves its vetted calls to candidate.
-- Candidate, not rejected: a later fetch of a listed funder can re-vet the call through the existing conflict path.
create or replace function grants.funders_unlist_cascade() returns trigger
language plpgsql set search_path to '' as $body$
begin
  if old.status = 'vetted' and new.status <> 'vetted' then
    update grants.opportunities set vet_status = 'candidate'
     where funder_id = new.id and vet_status = 'vetted' and coalesce(human_lock, '') <> 'promoted';
  end if;
  return null;
end
$body$;

create or replace trigger funders_zz_unlist_cascade after update of status on grants.funders
  for each row when (old.status is distinct from new.status) execute function grants.funders_unlist_cascade();

-- Defense in depth: an automated (actor null) promoted/demoted event must agree with the funder's status now.
-- Checked in live/ (this turn): reverify_source inserts after its UPDATE and derives the kind from the RETURNING row (post-trigger);
-- register_source writes 'registered'; reject_opportunity writes 'updated'; apply_fetch_result writes no vet_events.
-- So the guard only matters for a future caller that logs before the UPDATE.
create or replace function grants.vet_events_human_guard() returns trigger
language plpgsql set search_path to '' as $body$
declare v_status text;
begin
  if new.actor is null and new.kind in ('promoted', 'demoted') then
    select status into v_status from grants.funders where id = new.funder_id;
    if (new.kind = 'promoted' and v_status is distinct from 'vetted') or (new.kind = 'demoted' and v_status is distinct from 'rejected') then
      new.kind := 'updated';
    end if;
  end if;
  return new;
end
$body$;

create or replace trigger vet_events_human_guard before insert on grants.vet_events
  for each row execute function grants.vet_events_human_guard();

-- 5. read helpers
create or replace function grants.human_thresholds() returns jsonb
language sql stable set search_path to '' as $body$
  select jsonb_build_object(
    'fit_min', (select (value->>'min_fit')::int from grants.settings where key = 'fit_rubric'),
    'award_min_usd', (select (value #>> '{}')::bigint from grants.settings where key = 'min_award_usd'))
$body$;

create or replace function grants.human_gates(f grants.funders) returns jsonb
language plpgsql stable set search_path to '' as $body$
declare t jsonb := grants.human_thresholds(); v_scored boolean := f.fit_score is not null; v_fit boolean; v_ua boolean; v_award boolean;
begin
  -- dims is read only when it is an array: a non-array value would make jsonb_array_elements raise for every caller
  v_fit := v_scored and f.fit_score >= (t->>'fit_min')::int
           and coalesce((select x->>'level'
                           from jsonb_array_elements(case when jsonb_typeof(f.fit_breakdown->'dims') = 'array' then f.fit_breakdown->'dims' else '[]'::jsonb end) x
                          where x->>'key' = 'mission'), 'none') <> 'none';
  v_ua := f.ua_eligibility <> 'unlikely';
  v_award := f.award_max_usd is null or f.award_max_usd >= (t->>'award_min_usd')::bigint;
  -- aggregators are listings, not scored funders: they pass by definition
  return jsonb_build_object('scored', v_scored, 'fit', v_fit, 'ua', v_ua, 'award', v_award,
                            'pass', f.category = 'aggregator' or (v_scored and v_fit and v_ua and v_award));
end
$body$;

-- p_team false (anonymous): team identity (human.by) and the human reason (human.note) are withheld; the shape stays.
create or replace function grants.human_registry_funder(f grants.funders, p_team boolean) returns jsonb
language sql stable set search_path to '' as $body$
  select jsonb_build_object(
    'id', f.id, 'name', f.name, 'program', f.program, 'category', f.category, 'bucket', f.bucket, 'status', f.status,
    'url', f.url, 'geography', to_jsonb(f.geography), 'themes', to_jsonb(f.themes),
    'award_min_usd', f.award_min_usd, 'award_max_usd', f.award_max_usd, 'amount_confidence', f.amount_confidence,
    'ua_eligibility', f.ua_eligibility, 'cycle', f.cycle, 'next_deadline', f.next_deadline,
    'fit_score', f.fit_score, 'fit_breakdown', f.fit_breakdown, 'fit_reasons', to_jsonb(f.fit_reasons),
    'vet_note', f.vet_note, 'reject_reason', f.reject_reason,
    'gates', grants.human_gates(f),
    -- funders has no evaluated_at column: the evaluation is the verification, else the listing, else the row creation
    'evaluated_at', coalesce(f.verified_at, f.vetted_at, f.created_at),
    'vetted_at', f.vetted_at, 'verified_at', f.verified_at, 'created_at', f.created_at,
    'discovered_via', f.discovered_via, 'adapter', f.adapter, 'fetchability', f.fetchability, 'last_ok_at', f.last_ok_at,
    -- calls count as open only under a listed funder (a demoted funder keeps no open calls on the board)
    'calls_open', case when f.status = 'vetted'
                       then (select count(*) from grants.opportunities o where o.funder_id = f.id and o.vet_status = 'vetted' and o.status in ('open', 'forecasted'))
                       else 0 end,
    'calls_total', (select count(*) from grants.opportunities o where o.funder_id = f.id and o.vet_status <> 'rejected'),
    'team_state', (select ts.state from grants.team_state ts where ts.funder_id = f.id),
    'human', case when f.human_lock is null then null
                  else jsonb_build_object('lock', f.human_lock, 'by', case when p_team then f.human_by end,
                                          'at', f.human_at, 'note', case when p_team then f.human_note end) end,
    'queue', f.agent_queue)
$body$;

create or replace function grants.human_registry_call(o grants.opportunities, p_team boolean) returns jsonb
language sql stable set search_path to '' as $body$
  select jsonb_build_object(
    'id', o.id, 'funder_id', o.funder_id, 'title', o.title, 'url', o.url, 'deadline', o.deadline, 'status', o.status,
    'vet_status', o.vet_status, 'award_max_usd', o.award_max_usd, 'first_seen_at', o.first_seen_at, 'last_seen_at', o.last_seen_at,
    'human', case when o.human_lock is null then null
                  else jsonb_build_object('lock', o.human_lock, 'by', case when p_team then o.human_by end,
                                          'at', o.human_at, 'note', case when p_team then o.human_note end) end)
$body$;

-- 6. internal writers (postgres only; the public wrappers below are the only callers)
create or replace function grants.human_set_funder(p_funder uuid, p_action text, p_reason text, p_actor text) returns jsonb
language plpgsql set search_path to '' as $body$
declare
  f grants.funders%rowtype; v_from text; v_actor text := left(btrim(coalesce(p_actor, '')), 60);
  v_reason text := left(btrim(coalesce(p_reason, '')), 600); v_kind text; v_event text;
begin
  if v_actor = '' then raise exception 'actor is required' using errcode = '22023'; end if;
  if p_action in ('promote', 'demote') and char_length(v_reason) < 3 then
    raise exception 'a reason of at least 3 characters is required' using errcode = '22023';
  end if;
  select * into f from grants.funders where id = p_funder for update;
  if not found then raise exception 'unknown funder' using errcode = '22023'; end if;
  v_from := f.status;

  if p_action = 'promote' then
    if f.status = 'vetted' then raise exception 'this funder is already listed: release or demote it' using errcode = '22023'; end if;
    update grants.funders set status = 'vetted', vetted_at = now(), vetted_by = v_actor,
           vet_note = coalesce(nullif(btrim(vet_note), ''), v_reason), reject_reason = null,
           human_lock = 'promoted', human_by = v_actor, human_at = now(), human_note = v_reason,
           agent_queue = 'pending', agent_queue_at = now(), agent_queue_note = null, next_check_at = now()
     where id = p_funder returning * into f;
    v_kind := 'promoted'; v_event := 'promote';
  elsif p_action = 'demote' then
    if f.status <> 'vetted' then raise exception 'only a listed funder can be demoted' using errcode = '22023'; end if;
    -- the unlist cascade (funders_zz_unlist_cascade) moves the funder's vetted calls to candidate
    update grants.funders set status = 'rejected', reject_reason = v_reason,
           human_lock = 'demoted', human_by = v_actor, human_at = now(), human_note = v_reason, agent_queue = null
     where id = p_funder returning * into f;
    v_kind := 'demoted'; v_event := 'demote';
  elsif p_action = 'release' then
    if f.human_lock is null then raise exception 'this funder has no lock to release' using errcode = '22023'; end if;
    begin
      update grants.funders set human_lock = null, human_by = null, human_at = null, human_note = null
       where id = p_funder returning * into f;
    exception when check_violation then
      raise exception 'cannot release: this funder has no scored fit that passes the gates yet; score it in the agent queue or demote it'
        using errcode = '22023';
    end;
    v_kind := 'updated'; v_event := 'release';
  else
    raise exception 'unknown action %', p_action using errcode = '22023';
  end if;

  insert into grants.vet_events(funder_id, kind, note, changes, run_label, actor)
  values (p_funder, v_kind, left(coalesce(nullif(v_reason, ''), 'Lock released'), 600),
          jsonb_build_object('status', jsonb_build_array(v_from, f.status)), 'human', v_actor);
  insert into grants.team_events(funder_id, actor, kind, payload)
  values (p_funder, v_actor, v_event, jsonb_build_object('reason', nullif(v_reason, ''), 'from_status', v_from));
  return jsonb_build_object('id', f.id, 'status', f.status,
    'human', case when f.human_lock is null then null
                  else jsonb_build_object('lock', f.human_lock, 'by', f.human_by, 'at', f.human_at, 'note', f.human_note) end,
    'queue', f.agent_queue);
end
$body$;

create or replace function grants.human_set_call(p_opp uuid, p_action text, p_reason text, p_actor text) returns jsonb
language plpgsql set search_path to '' as $body$
declare
  o grants.opportunities%rowtype; v_from text; v_actor text := left(btrim(coalesce(p_actor, '')), 60);
  v_reason text := left(btrim(coalesce(p_reason, '')), 600); v_prev text; v_event text;
begin
  if v_actor = '' then raise exception 'actor is required' using errcode = '22023'; end if;
  select * into o from grants.opportunities where id = p_opp for update;
  if not found then raise exception 'unknown call' using errcode = '22023'; end if;
  v_from := o.vet_status;

  if p_action = 'demote' then
    if char_length(v_reason) < 3 then raise exception 'a reason of at least 3 characters is required' using errcode = '22023'; end if;
    if o.vet_status = 'rejected' then raise exception 'this call is already screened out' using errcode = '22023'; end if;
    update grants.opportunities set vet_status = 'rejected', human_lock = 'demoted', human_by = v_actor, human_at = now(), human_note = v_reason
     where id = p_opp returning * into o;
    v_event := 'call_demote';
  elsif p_action = 'restore' then
    if o.human_lock is distinct from 'demoted' then raise exception 'the team has not demoted this call' using errcode = '22023'; end if;
    if not exists (select 1 from grants.funders f where f.id = o.funder_id and f.status = 'vetted') then
      raise exception 'this call belongs to a funder that is not listed: promote the funder first' using errcode = '22023';
    end if;
    -- restore to the status the call had before the demote (team_events payload.from_status), default vetted
    select coalesce(payload->>'from_status', 'vetted') into v_prev from grants.team_events
     where kind = 'call_demote' and payload->>'opportunity_id' = p_opp::text order by at desc, id desc limit 1;
    update grants.opportunities set vet_status = coalesce(v_prev, 'vetted'), human_lock = null, human_by = null, human_at = null, human_note = null
     where id = p_opp returning * into o;
    v_event := 'call_restore';
  else
    raise exception 'unknown action %', p_action using errcode = '22023';
  end if;

  insert into grants.vet_events(funder_id, kind, note, changes, run_label, actor)
  values (o.funder_id, 'updated',
          left((case when p_action = 'demote' then 'Call demoted: ' else 'Call restored: ' end) || coalesce(o.title, '') || ' (' || coalesce(o.external_id, o.id::text) || ')'
               || coalesce(': ' || nullif(v_reason, ''), ''), 600),
          jsonb_build_object('vet_status', jsonb_build_array(v_from, o.vet_status)), 'human', v_actor);
  insert into grants.team_events(funder_id, actor, kind, payload)
  values (o.funder_id, v_actor, v_event,
          jsonb_build_object('opportunity_id', o.id, 'title', o.title, 'reason', nullif(v_reason, ''), 'from_status', v_from));
  return jsonb_build_object('id', o.id, 'funder_id', o.funder_id, 'vet_status', o.vet_status,
    'human', case when o.human_lock is null then null
                  else jsonb_build_object('lock', o.human_lock, 'by', o.human_by, 'at', o.human_at, 'note', o.human_note) end);
end
$body$;

create or replace function grants.human_set_lead(p_target uuid, p_action text, p_reason text, p_actor text) returns jsonb
language plpgsql set search_path to '' as $body$
declare
  t grants.targets%rowtype; v_actor text := left(btrim(coalesce(p_actor, '')), 60);
  v_reason text := left(btrim(coalesce(p_reason, '')), 300); v_from text; v_kind text;
begin
  if v_actor = '' then raise exception 'actor is required' using errcode = '22023'; end if;
  select * into t from grants.targets where id = p_target for update;
  if not found then raise exception 'unknown lead' using errcode = '22023'; end if;
  if t.status = 'covered' then raise exception 'this lead is already covered by a listed funder' using errcode = '22023'; end if;
  v_from := t.status;

  if p_action = 'queue' then
    update grants.targets set status = 'pending', priority = 1, updated_at = now(),
           note = left(v_actor || ': queued' || case when v_reason <> '' then ' - ' || v_reason else '' end, 300)
     where id = p_target returning * into t;
    v_kind := 'lead_queue';
  elsif p_action = 'dismiss' then
    if char_length(v_reason) < 3 then raise exception 'a reason of at least 3 characters is required' using errcode = '22023'; end if;
    update grants.targets set status = 'rejected', updated_at = now(), note = left(v_actor || ': dismissed - ' || v_reason, 300)
     where id = p_target returning * into t;
    v_kind := 'lead_dismiss';
  else
    raise exception 'unknown action %', p_action using errcode = '22023';
  end if;
  -- targets.note is overwritten on every action; this row keeps the history
  insert into grants.team_events(funder_id, actor, kind, payload)
  values (t.funder_id, v_actor, v_kind,
          jsonb_build_object('target_id', t.id, 'org', t.org, 'reason', nullif(v_reason, ''), 'from_status', v_from));
  return jsonb_build_object('id', t.id, 'status', t.status, 'note', t.note);
end
$body$;

create or replace function grants.note_add(p_funder uuid, p_body text, p_actor text, p_opp uuid default null) returns jsonb
language plpgsql set search_path to '' as $body$
declare v_body text := btrim(coalesce(p_body, '')); v_actor text := left(btrim(coalesce(p_actor, '')), 60); r grants.notes%rowtype;
begin
  if v_actor = '' then raise exception 'actor is required' using errcode = '22023'; end if;
  if char_length(v_body) < 1 or char_length(v_body) > 2000 then raise exception 'a note needs 1 to 2000 characters' using errcode = '22023'; end if;
  if not exists (select 1 from grants.funders where id = p_funder) then raise exception 'unknown funder' using errcode = '22023'; end if;
  if p_opp is not null and not exists (select 1 from grants.opportunities where id = p_opp and funder_id = p_funder) then
    raise exception 'that call does not belong to this funder' using errcode = '22023';
  end if;
  insert into grants.notes(funder_id, opportunity_id, body, actor) values (p_funder, p_opp, v_body, v_actor) returning * into r;
  return jsonb_build_object('id', r.id, 'funder_id', r.funder_id, 'opportunity_id', r.opportunity_id, 'body', r.body, 'actor', r.actor, 'at', r.at);
end
$body$;

create or replace function grants.note_remove(p_note bigint, p_actor text) returns jsonb
language plpgsql set search_path to '' as $body$
declare v_actor text := left(btrim(coalesce(p_actor, '')), 60);
begin
  if v_actor = '' then raise exception 'actor is required' using errcode = '22023'; end if;
  -- soft delete: the row stays for audit, the readers filter deleted_at.
  -- Design limit: any passcode holder may remove any note. Actor names are self-asserted, so an author check adds no protection.
  update grants.notes set deleted_at = now(), deleted_by = v_actor where id = p_note and deleted_at is null;
  if not found then raise exception 'note % not found or already removed', p_note using errcode = '22023'; end if;
  return jsonb_build_object('removed', p_note);
end
$body$;

create or replace function grants.resolve_promoted(p_id uuid, p_note text, p_run_label text) returns jsonb
language plpgsql set search_path to '' as $body$
declare f grants.funders%rowtype;
begin
  select * into f from grants.funders where id = p_id for update;
  if not found then return jsonb_build_object('result', 'not_found', 'id', p_id); end if;
  if f.agent_queue is distinct from 'pending' then
    return jsonb_build_object('result', 'unchanged', 'id', p_id, 'queue', f.agent_queue);
  end if;
  update grants.funders set agent_queue = 'done', agent_queue_at = now(), agent_queue_note = left(btrim(coalesce(p_note, '')), 600)
   where id = p_id returning * into f;
  insert into grants.vet_events(funder_id, kind, note, changes, run_label)
  values (p_id, 'updated', left('Agent queue done: ' || coalesce(nullif(btrim(coalesce(p_note, '')), ''), 'no note'), 600), '{}'::jsonb,
          left(btrim(p_run_label), 60));
  return jsonb_build_object('result', 'done', 'id', p_id, 'queue', f.agent_queue);
end
$body$;

-- A wrong passcode must not raise: a raise rolls back the failure row check_pass just wrote, so the lockout never trips.
-- PostgREST sends this body with HTTP 403 (response.status), the status and keys a raised 28000 produces, so clients see no difference.
create or replace function grants.pass_denied() returns jsonb
language plpgsql set search_path to '' as $body$
begin
  perform set_config('response.status', '403', true);
  return jsonb_build_object('code', '28000', 'message', 'bad passcode', 'details', null, 'hint', null);
end
$body$;

-- 7. replaced functions (guarded above). Live text: live/public__grants_set_state.sql
-- A wrong passcode returns grants.pass_denied() (no raise), so the failure row check_pass wrote commits.
create or replace function public.grants_set_state(p_pass text, p_funder uuid, p_patch jsonb) returns jsonb
language plpgsql security definer set search_path to '' as $body$
declare
  r grants.team_state%rowtype; prev grants.team_state%rowtype;
  v_actor text := left(coalesce(nullif(btrim(p_patch->>'actor'), ''), nullif(btrim(p_patch->>'owner'), ''), 'team'), 60); v_ask bigint;
  v_from jsonb := '{}'::jsonb; v_notes boolean := false; v_keys jsonb;
begin
  if not grants.check_pass(p_pass) then return grants.pass_denied(); end if;
  if not exists (select 1 from grants.funders where id = p_funder and status = 'vetted') then raise exception 'unknown funder'; end if;
  if p_patch ? 'state' and coalesce(p_patch->>'state', '') not in ('new', 'reviewing', 'applying', 'submitted', 'awarded', 'declined', 'skip') then
    raise exception 'bad state';
  end if;
  if p_patch ? 'ask_usd' and jsonb_typeof(p_patch->'ask_usd') <> 'null' then
    if jsonb_typeof(p_patch->'ask_usd') <> 'number' or (p_patch->>'ask_usd')::numeric not between 0 and 100000000000 then
      raise exception 'bad ask_usd';
    end if;
    v_ask := round((p_patch->>'ask_usd')::numeric)::bigint;
  end if;

  -- compare after the same normalisation the upsert applies; a missing row reads as state new
  select * into prev from grants.team_state where funder_id = p_funder for update;
  if p_patch ? 'state' and coalesce(prev.state, 'new') is distinct from (p_patch->>'state') then
    v_from := v_from || jsonb_build_object('state', coalesce(prev.state, 'new'));
  end if;
  if p_patch ? 'owner' and prev.owner is distinct from left(p_patch->>'owner', 80) then
    v_from := v_from || jsonb_build_object('owner', prev.owner);
  end if;
  if p_patch ? 'ask_usd' and prev.ask_usd is distinct from v_ask then
    v_from := v_from || jsonb_build_object('ask_usd', prev.ask_usd);
  end if;
  if p_patch ? 'notes' and prev.notes is distinct from left(p_patch->>'notes', 4000) then v_notes := true; end if;

  -- nothing changed: no write and no event; the current row comes back
  if prev.funder_id is not null and v_from = '{}'::jsonb and not v_notes then
    return to_jsonb(prev);
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

  -- a first touch with no change still writes an event, so the creation is visible
  if v_from <> '{}'::jsonb or v_notes or prev.funder_id is null then
    select coalesce(jsonb_object_agg(ck, p_patch -> ck), '{}'::jsonb) into v_keys from jsonb_object_keys(v_from) as ck;
    insert into grants.team_events(funder_id, actor, kind, payload)
    values (p_funder, v_actor, 'update', v_keys || jsonb_build_object('from', v_from, 'notes_changed', v_notes));
  end if;
  return to_jsonb(r);
end
$body$;

create or replace function public.grants_team_notes(p_pass text) returns jsonb
language plpgsql security definer set search_path to '' as $body$
begin
  if not grants.check_pass(p_pass) then return grants.pass_denied(); end if;
  return jsonb_build_object(
    'team', coalesce((select jsonb_agg(to_jsonb(t)) from grants.team_state t), '[]'::jsonb),
    'events', coalesce((select jsonb_agg(to_jsonb(e) order by e.at desc)
                          from (select * from grants.team_events order by at desc, id desc limit 500) e), '[]'::jsonb),
    'notes', coalesce((select jsonb_agg(jsonb_build_object('id', n.id, 'funder_id', n.funder_id, 'opportunity_id', n.opportunity_id,
                                                           'body', n.body, 'actor', n.actor, 'at', n.at) order by n.at desc, n.id desc)
                         from (select * from grants.notes where deleted_at is null order by at desc, id desc limit 2000) n), '[]'::jsonb));
end
$body$;

-- discovery_brief: anchored patch on the live text. The anchor must occur exactly once, or the apply stops.
do $patch$
declare d text; n int; v_anchor constant text := 'limit 1) r))';
begin
  d := pg_get_functiondef('grants.discovery_brief()'::regprocedure);
  n := (length(d) - length(replace(d, v_anchor, ''))) / length(v_anchor);
  if n <> 1 then raise exception '023 patch: discovery_brief anchor found % times, expected 1', n; end if;
  d := replace(d, v_anchor, $r$limit 1) r),
    'promoted', coalesce((select jsonb_agg(to_jsonb(x) - 'rn' order by x.rn) from (
        select f.id, f.name, f.program, f.url, f.category, f.human_by, f.human_at, f.human_note,
               (f.fit_inputs is not null) as has_fit_inputs, f.fit_score, f.adapter, f.fetchability,
               grants.human_gates(f) as gates,
               row_number() over (order by f.human_at nulls last, f.name) as rn
          from grants.funders f where f.agent_queue = 'pending') x where x.rn <= 20), '[]'::jsonb),
    'backfill', coalesce((select jsonb_agg(to_jsonb(x) - 'rn' order by x.rn) from (
        select f.id, f.name, f.program, f.url, f.reject_reason,
               row_number() over (order by f.created_at, f.name) as rn
          from grants.funders f
         where f.status = 'rejected' and f.fit_inputs is null and f.human_lock is null) x where x.rn <= 8), '[]'::jsonb))$r$);
  execute d;
end
$patch$;

-- reverify_source: anchored patch on the live text. When a listed funder fails a gate on re-check, the lock keeps it listed;
-- the event then says why (changes.gate and the note), so the team can see that the automated check disagreed.
do $patch$
declare d text; n int;
  v_anchor constant text := $a$  insert into grants.vet_events(funder_id, kind, note, changes, run_label)
  values (p_id, v_kind, left(coalesce(case when n.status = 'rejected' then n.reject_reason end, nullif(btrim(p->>'note'), ''), n.vet_note), 600), v_changes, p_run_label);$a$;
begin
  d := pg_get_functiondef('grants.reverify_source(uuid,jsonb,text)'::regprocedure);
  n := (length(d) - length(replace(d, v_anchor, ''))) / length(v_anchor);
  if n <> 1 then raise exception '023 patch: reverify_source anchor found % times, expected 1', n; end if;
  d := replace(d, v_anchor, $r$  if f.status = 'vetted' and n.status = 'vetted' and v_fail is not null then
    -- 023: the lock kept the listing; record the failed gate on the event
    v_kind := 'updated';
    v_changes := v_changes || jsonb_build_object('gate', jsonb_build_array(null, v_fail));
  end if;
  insert into grants.vet_events(funder_id, kind, note, changes, run_label)
  values (p_id, v_kind, left(coalesce(case when n.status = 'rejected' then n.reject_reason end,
                                      case when f.status = 'vetted' and n.status = 'vetted' and v_fail is not null then 'Gate failed on re-check: ' || v_fail end,
                                      nullif(btrim(p->>'note'), ''), n.vet_note), 600), v_changes, p_run_label);$r$);
  execute d;
end
$patch$;

-- 8. public wrappers. Reads: passcode optional (check_pass runs only when one is given). Writes: passcode required.
-- Volatile: check_pass writes grants.auth_attempts.
-- Anonymous reads (no valid passcode): team identity withheld (human.by, human.note, vetting actor, lead note, call human.by/note);
-- a funder that is not listed returns only the registry keys plus team state; its grants_feed-style keys are absent.
create or replace function public.grants_registry(p_pass text default null) returns jsonb
language plpgsql volatile security definer set search_path to '' as $body$
declare v_team boolean := false;
begin
  if p_pass is not null then v_team := grants.check_pass(p_pass); end if;
  return jsonb_build_object(
    'generated_at', now(),
    'access', case when v_team then 'team' else 'public' end,
    'thresholds', grants.human_thresholds(),
    'counts', jsonb_build_object(
      'funders', (select count(*) from grants.funders),
      'tracked', (select count(*) from grants.funders where status = 'vetted'),
      'screened', (select count(*) from grants.funders where status = 'rejected'),
      'candidate', (select count(*) from grants.funders where status = 'candidate'),
      'leads', (select count(*) from grants.targets where status = 'pending'),
      'queue', (select count(*) from grants.funders where agent_queue = 'pending')),
    'funders', coalesce((select jsonb_agg(grants.human_registry_funder(f, v_team) order by f.name) from grants.funders f), '[]'::jsonb),
    'leads', coalesce((select jsonb_agg(jsonb_build_object('id', t.id, 'org', t.org, 'program_hint', t.program_hint, 'url_hint', t.url_hint,
                 'bucket', t.bucket, 'lens', t.lens, 'priority', t.priority, 'why', t.why, 'status', t.status,
                 'note', case when v_team then t.note end,
                 'funder_id', t.funder_id, 'source', t.source, 'updated_at', t.updated_at)
               order by t.priority, t.org) from grants.targets t), '[]'::jsonb),
    'calls', coalesce((select jsonb_agg(grants.human_registry_call(o, v_team) order by o.title) from grants.opportunities o), '[]'::jsonb));
end
$body$;

create or replace function public.grants_funder(p_id uuid, p_pass text default null) returns jsonb
language plpgsql volatile security definer set search_path to '' as $body$
declare f grants.funders%rowtype; v_team boolean := false; v_listed boolean;
begin
  select * into f from grants.funders where id = p_id;
  if not found then return null; end if;
  if p_pass is not null then v_team := grants.check_pass(p_pass); end if;
  v_listed := f.status = 'vetted';
  -- funder: the grants_feed row keys (v_funders columns, team, collection) plus the registry keys.
  -- The v_funders columns (notes, evidence, requirements, verified_by) and the team owner and ask go only to the team or for a listed funder.
  return jsonb_build_object(
    'access', case when v_team then 'team' else 'public' end,
    'funder', grants.human_registry_funder(f, v_team)
      || case when v_team or v_listed then coalesce((select to_jsonb(v) - 'status' from grants.v_funders v where v.id = p_id), '{}'::jsonb)
              else '{}'::jsonb end
      || (select jsonb_build_object(
            'team', case when v_team or v_listed
                         then jsonb_build_object('state', coalesce(ts.state, 'new'), 'owner', ts.owner, 'ask_usd', ts.ask_usd, 'updated_at', ts.updated_at)
                         else jsonb_build_object('state', coalesce(ts.state, 'new')) end,
            'collection', case when v_team or v_listed then grants.collection_state(p_id) end)
            from (select 1) s left join grants.team_state ts on ts.funder_id = p_id),
    'opportunities', coalesce((select jsonb_agg(jsonb_build_object(
            'id', o.id, 'funder_id', o.funder_id, 'title', o.title, 'url', o.url, 'apply_url', o.apply_url,
            'description', o.description, 'open_date', o.open_date, 'deadline', o.deadline, 'deadline_text', o.deadline_text,
            'award_min_usd', o.award_min_usd, 'award_max_usd', o.award_max_usd, 'status', o.status, 'doc_links', o.doc_links,
            'first_seen_at', o.first_seen_at, 'last_seen_at', o.last_seen_at,
            'vet_status', o.vet_status, 'human', grants.human_registry_call(o, v_team)->'human')
          order by o.deadline nulls last, o.title)
        from grants.opportunities o where o.funder_id = p_id), '[]'::jsonb),
    'vetting', coalesce((select jsonb_agg(jsonb_build_object('at', e.at, 'kind', e.kind, 'note', e.note, 'changes', e.changes,
                                                             'run_label', e.run_label, 'actor', case when v_team then e.actor end)
                                          order by e.at desc, e.id desc)
        from (select * from grants.vet_events where funder_id = p_id order by at desc, id desc limit 100) e), '[]'::jsonb));
end
$body$;

-- Writes: a wrong passcode returns grants.pass_denied() (not a raise), so the failure row commits. Lockout ('locked', P0001) still raises.
create or replace function public.grants_set_funder(p_pass text, p_funder uuid, p_patch jsonb) returns jsonb
language plpgsql security definer set search_path to '' as $body$
begin
  if not grants.check_pass(p_pass) then return grants.pass_denied(); end if;
  return grants.human_set_funder(p_funder, coalesce(p_patch->>'action', ''), p_patch->>'reason', p_patch->>'actor');
end
$body$;

create or replace function public.grants_set_call(p_pass text, p_opp uuid, p_patch jsonb) returns jsonb
language plpgsql security definer set search_path to '' as $body$
begin
  if not grants.check_pass(p_pass) then return grants.pass_denied(); end if;
  return grants.human_set_call(p_opp, coalesce(p_patch->>'action', ''), p_patch->>'reason', p_patch->>'actor');
end
$body$;

create or replace function public.grants_set_lead(p_pass text, p_target uuid, p_patch jsonb) returns jsonb
language plpgsql security definer set search_path to '' as $body$
begin
  if not grants.check_pass(p_pass) then return grants.pass_denied(); end if;
  return grants.human_set_lead(p_target, coalesce(p_patch->>'action', ''), p_patch->>'reason', p_patch->>'actor');
end
$body$;

create or replace function public.grants_note(p_pass text, p_funder uuid, p_patch jsonb) returns jsonb
language plpgsql security definer set search_path to '' as $body$
declare v_remove bigint; v_opp text := nullif(btrim(p_patch->>'opportunity_id'), '');
begin
  if not grants.check_pass(p_pass) then return grants.pass_denied(); end if;
  if p_patch ? 'remove' then
    if coalesce(p_patch->>'remove', '') !~ '^[0-9]{1,18}$' then
      raise exception 'remove needs the id of a note' using errcode = '22023';
    end if;
    v_remove := (p_patch->>'remove')::bigint;
    if not exists (select 1 from grants.notes n where n.id = v_remove and n.funder_id = p_funder) then
      raise exception 'note not found on this funder' using errcode = '22023';
    end if;
    return grants.note_remove(v_remove, p_patch->>'actor');
  end if;
  if v_opp is not null and v_opp !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    raise exception 'opportunity_id must be a call id' using errcode = '22023';
  end if;
  return grants.note_add(p_funder, p_patch->>'body', p_patch->>'actor', v_opp::uuid);
end
$body$;

-- 9. privileges. Public wrappers: EXECUTE for anon, authenticated, service_role (PUBLIC revoked; the existing wrappers also list PUBLIC).
revoke all on function public.grants_registry(text) from public;
revoke all on function public.grants_funder(uuid, text) from public;
revoke all on function public.grants_set_funder(text, uuid, jsonb) from public;
revoke all on function public.grants_set_call(text, uuid, jsonb) from public;
revoke all on function public.grants_set_lead(text, uuid, jsonb) from public;
revoke all on function public.grants_note(text, uuid, jsonb) from public;
grant execute on function public.grants_registry(text) to anon, authenticated, service_role;
grant execute on function public.grants_funder(uuid, text) to anon, authenticated, service_role;
grant execute on function public.grants_set_funder(text, uuid, jsonb) to anon, authenticated, service_role;
grant execute on function public.grants_set_call(text, uuid, jsonb) to anon, authenticated, service_role;
grant execute on function public.grants_set_lead(text, uuid, jsonb) to anon, authenticated, service_role;
grant execute on function public.grants_note(text, uuid, jsonb) to anon, authenticated, service_role;

-- internal: postgres only
revoke all on function grants.human_thresholds() from public, anon, authenticated;
revoke all on function grants.human_gates(grants.funders) from public, anon, authenticated;
revoke all on function grants.human_registry_funder(grants.funders, boolean) from public, anon, authenticated;
revoke all on function grants.human_registry_call(grants.opportunities, boolean) from public, anon, authenticated;
revoke all on function grants.human_set_funder(uuid, text, text, text) from public, anon, authenticated;
revoke all on function grants.human_set_call(uuid, text, text, text) from public, anon, authenticated;
revoke all on function grants.human_set_lead(uuid, text, text, text) from public, anon, authenticated;
revoke all on function grants.note_add(uuid, text, text, uuid) from public, anon, authenticated;
revoke all on function grants.note_remove(bigint, text) from public, anon, authenticated;
revoke all on function grants.resolve_promoted(uuid, text, text) from public, anon, authenticated;
revoke all on function grants.pass_denied() from public, anon, authenticated;
revoke all on function grants.funders_human_lock() from public, anon, authenticated;
revoke all on function grants.opportunities_human_lock() from public, anon, authenticated;
revoke all on function grants.opportunities_listed_guard() from public, anon, authenticated;
revoke all on function grants.funders_unlist_cascade() from public, anon, authenticated;
revoke all on function grants.vet_events_human_guard() from public, anon, authenticated;
