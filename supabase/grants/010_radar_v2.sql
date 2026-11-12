-- Funding radar v2: itemized fit score with quoted evidence, vetting API, feed v3, pipeline stages, daily metrics, target queue.
-- Applied to the AVS project in parts (name, live version in supabase_migrations.schema_migrations):
--   20261112003631  grants_008a_radar_v2_schema
--   20261112003742  grants_008b_radar_v2_fit_functions
--   20261112003836  grants_008b2_radar_v2_fit_trigger
--   20261112004104  grants_008c_radar_v2_vetting_api
--   20261112004432  grants_008c2_register_source_notes_fix
--   20261112004819  grants_008d_radar_v2_feed_metrics
--   20261112005409  grants_008e_radar_v2_vetted_fit_constraint
-- Rollback: 010_radar_v2-rollback.sql (written from the live definitions before the first part was applied).


-- ===== grants_008a_radar_v2_schema (20261112003631) =====
-- 008a: additive columns, new tables, settings. No behaviour change for the crawler or the dashboard.
alter table grants.funders
  add column if not exists fit_inputs jsonb,
  add column if not exists fit_breakdown jsonb,
  add column if not exists evidence jsonb not null default '{}'::jsonb,
  add column if not exists evidence_ok jsonb not null default '{}'::jsonb,
  add column if not exists verified_at timestamptz,
  add column if not exists verified_by text;

comment on column grants.funders.fit_inputs is 'Judged rubric dimensions {mission,activity,geography,precedent}: {level,why,quote,url}. fit_score, fit_breakdown and fit_reasons are derived from this by trigger funders_fit_derive.';
comment on column grants.funders.evidence is 'Quoted proof for key facts {award,deadline,eligibility}: {quote,url}.';
comment on column grants.funders.evidence_ok is 'Per quote: true when it was found in the crawler''s latest copy of the funder page (last_text).';

alter table grants.team_state add column if not exists ask_usd bigint check (ask_usd is null or (ask_usd >= 0 and ask_usd <= 100000000000));
alter table grants.team_state drop constraint team_state_state_check;
alter table grants.team_state add constraint team_state_state_check
  check (state = any (array['new'::text, 'reviewing'::text, 'applying'::text, 'submitted'::text, 'awarded'::text, 'declined'::text, 'skip'::text]));

-- organizations and programs queued for vetting (the discovery task works this list first)
create table grants.targets (
  id uuid primary key default gen_random_uuid(),
  org text not null check (btrim(org) <> ''),
  program_hint text,
  url_hint text,
  bucket text not null check (bucket in ('us_federal', 'intl_dev', 'state_regional', 'private_sector', 'foundation_ngo')),
  lens text,
  priority smallint not null default 2 check (priority between 1 and 3),
  why text,
  status text not null default 'pending' check (status in ('pending', 'covered', 'rejected', 'deferred')),
  note text,
  funder_id uuid references grants.funders(id) on delete set null,
  source text,
  attempts smallint not null default 0,
  org_key text generated always as (grants.name_key(org || ' ' || coalesce(program_hint, ''))) stored,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint targets_org_key unique (org_key)
);
create index targets_pending_idx on grants.targets (bucket, priority, created_at) where status = 'pending';

create table grants.discovery_runs (
  run_label text primary key,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  summary text,
  stats jsonb not null default '{}'::jsonb
);

-- every vetting decision on a funder, with the fields it changed: {field: [from, to]}
create table grants.vet_events (
  id bigint generated always as identity primary key,
  funder_id uuid not null references grants.funders(id) on delete cascade,
  at timestamptz not null default now(),
  kind text not null check (kind in ('registered', 'rescored', 'verified', 'updated', 'demoted', 'promoted')),
  note text,
  changes jsonb not null default '{}'::jsonb,
  run_label text
);
create index vet_events_funder_idx on grants.vet_events (funder_id, at desc);

create table grants.metrics_daily (
  day date primary key,
  m jsonb not null,
  updated_at timestamptz not null default now()
);

-- recoverable copy of every funder row's vetting fields before the v2 re-scoring
create table grants.funders_v1_backup as
  select id, status, reject_reason, fit_score, fit_reasons, ua_eligibility, award_min_usd, award_max_usd, amount_confidence, award_note,
         cycle, next_deadline, deadline_note, open_now, eligibility_note, requirements, themes, fetchability, confidence, vet_note,
         vetted_at, vetted_by, now() as saved_at
    from grants.funders;
alter table grants.funders_v1_backup add primary key (id);

alter table grants.targets enable row level security;
alter table grants.discovery_runs enable row level security;
alter table grants.vet_events enable row level security;
alter table grants.metrics_daily enable row level security;
alter table grants.funders_v1_backup enable row level security;
revoke all on all tables in schema grants from public, anon, authenticated;
revoke all on all sequences in schema grants from public, anon, authenticated;

insert into grants.settings(key, value) values
('coverage_min', '{"us_federal":12,"intl_dev":12,"state_regional":8,"private_sector":8,"foundation_ngo":12}'::jsonb),
('theme_vocab', '["agrivoltaics","solar & clean energy","water","agriculture","food security","climate adaptation","drought & heat","energy access","rural livelihoods","smallholder farmers","research","education & workforce","technology & innovation","land & conservation","international partnerships","equity & inclusion"]'::jsonb),
('fit_rubric', $rub${
 "version": 2, "min_fit": 40,
 "tiers": [ {"key":"prime","min":75,"label":"Prime"}, {"key":"strong","min":60,"label":"Strong"}, {"key":"possible","min":45,"label":"Possible"}, {"key":"long_shot","min":0,"label":"Long shot"} ],
 "dims": [
  {"key":"mission","label":"Mission match","max":35,"source":"judged","question":"How directly does this program fund what SALSAV does?","levels":[
   {"key":"core","points":35,"label":"Agrivoltaics named","rule":"The call or the program priorities name agrivoltaics, dual-use solar or solar combined with farming."},
   {"key":"strong","points":27,"label":"Direct nexus","rule":"Funds the water-energy-food nexus, solar or renewable energy for agriculture, or dryland and semi-arid farming resilience."},
   {"key":"adjacent","points":18,"label":"Adjacent field","rule":"Funds a wider field (climate adaptation, sustainable agriculture, clean energy access, food security) where an agrivoltaics project is a natural proposal."},
   {"key":"weak","points":8,"label":"Tangential","rule":"Only a general link (environment, development, education); agrivoltaics would be a stretch."},
   {"key":"none","points":0,"label":"No match","rule":"Does not fund this kind of work."} ]},
  {"key":"activity","label":"Type of work funded","max":15,"source":"judged","question":"Does it pay for the kind of work a university lab does?","levels":[
   {"key":"research_demo","points":15,"label":"Research and demonstration","rule":"Funds applied research, field trials or demonstration sites led by research institutions."},
   {"key":"capacity","points":10,"label":"Deployment and training","rule":"Funds deployment, training, extension, education or capacity building where a university lab can lead a work package."},
   {"key":"other","points":5,"label":"Other work","rule":"Mostly policy, advocacy, finance or service delivery; SALSAV could only be a minor partner."},
   {"key":"mismatch","points":0,"label":"Mismatch","rule":"Funds work a university lab cannot take part in."} ]},
  {"key":"geography","label":"Where the work can happen","max":15,"source":"judged","question":"Does the funded geography overlap SALSAV sites and partners?","levels":[
   {"key":"home","points":15,"label":"SALSAV home ground","rule":"Targets Arizona, the US Southwest, or a place where SALSAV already has a site or partner (Mexico, Kenya, Israel)."},
   {"key":"region","points":12,"label":"Same region","rule":"US-wide, or Latin America or Sub-Saharan Africa as a whole."},
   {"key":"global","points":8,"label":"Global","rule":"Global or multi-region; SALSAV geographies are allowed but not prioritized."},
   {"key":"outside","points":3,"label":"Outside the footprint","rule":"Focused on places where SALSAV has no site; would need a new local partner."},
   {"key":"excluded","points":0,"label":"Excluded","rule":"SALSAV geographies cannot be funded."} ]},
  {"key":"eligibility","label":"Can the University of Arizona apply","max":20,"source":"field","field":"ua_eligibility","question":"Can UA be the applicant or a funded partner?","levels":[
   {"key":"eligible","points":20,"label":"UA applies directly","rule":"A US public university can be the lead applicant."},
   {"key":"eligible_with_partner","points":13,"label":"With a partner","rule":"UA can take part, but a required partner or a different lead organization is needed."},
   {"key":"unknown","points":7,"label":"Not confirmed","rule":"The official page does not say whether universities can apply."},
   {"key":"invitation_only","points":3,"label":"By invitation","rule":"No open application; a relationship with the funder comes first."},
   {"key":"unlikely","points":0,"label":"Not eligible","rule":"Universities or US applicants are excluded."} ]},
  {"key":"award","label":"Award size","max":10,"source":"field","field":"award_max_usd","question":"How large is the largest single award?","levels":[
   {"key":"1m","points":10,"label":"$1M or more","rule":"Largest single award is at least $1,000,000."},
   {"key":"500k","points":8,"label":"$500k to $1M","rule":"Largest single award is between $500,000 and $1,000,000."},
   {"key":"200k","points":6,"label":"$200k to $500k","rule":"Largest single award is between $200,000 and $500,000."},
   {"key":"unknown","points":4,"label":"Not published","rule":"The funder does not publish award sizes."},
   {"key":"low","points":0,"label":"Below $200k","rule":"Largest single award is under $200,000."} ]},
  {"key":"precedent","label":"Track record","max":5,"source":"judged","question":"Has this funder backed similar work before?","levels":[
   {"key":"direct","points":5,"label":"Funded this before","rule":"Has funded agrivoltaics, or the University of Arizona or a SALSAV partner on related work."},
   {"key":"similar","points":3,"label":"Funded similar work","rule":"Has funded comparable university-led dryland agriculture, solar or water projects."},
   {"key":"none","points":0,"label":"None found","rule":"No relevant precedent found."} ]}
 ]}$rub$::jsonb)
on conflict (key) do update set value = excluded.value, updated_at = now();


-- ===== grants_008b_radar_v2_fit_functions (20261112003742) =====
-- 008b: itemized fit. The rubric lives in grants.settings('fit_rubric'); the score is always derived, never typed in.

-- keep only the four judged dimensions, known keys, bounded lengths, http(s) links
create or replace function grants.fit_clean(p jsonb) returns jsonb
language sql immutable set search_path = grants, extensions, pg_temp as $$
  select case when p is null or jsonb_typeof(p) <> 'object' then null else (
    select jsonb_object_agg(k, jsonb_strip_nulls(jsonb_build_object(
             'level', p->k->>'level',
             'why', left(btrim(coalesce(p->k->>'why', '')), 300),
             'quote', left(btrim(coalesce(p->k->>'quote', '')), 400),
             'url', case when (p->k->>'url') ~* '^https?://' then left(p->k->>'url', 500) end)))
      from unnest(array['mission', 'activity', 'geography', 'precedent']) k
     where jsonb_typeof(p->k) = 'object') end
$$;

-- keep only award / deadline / eligibility entries that carry a quote
create or replace function grants.evidence_clean(p jsonb) returns jsonb
language sql immutable set search_path = grants, extensions, pg_temp as $$
  select coalesce((
    select jsonb_object_agg(k, jsonb_strip_nulls(jsonb_build_object(
             'quote', left(btrim(p->k->>'quote'), 400),
             'url', case when (p->k->>'url') ~* '^https?://' then left(p->k->>'url', 500) end)))
      from unnest(array['award', 'deadline', 'eligibility']) k
     where jsonb_typeof(p->k) = 'object' and btrim(coalesce(p->k->>'quote', '')) <> ''), '{}'::jsonb)
$$;

-- null when every judged dimension has a level the rubric knows, else a message naming the first problem
create or replace function grants.fit_problem(p jsonb) returns text
language sql stable set search_path = grants, extensions, pg_temp as $$
  select case when p is null or jsonb_typeof(p) <> 'object' then 'no itemized fit (fit.mission, fit.activity, fit.geography, fit.precedent)' else (
    select format('fit.%s.level must be one of: %s', d->>'key', string_agg(l->>'key', ', '))
      from grants.settings s, jsonb_array_elements(s.value->'dims') d, jsonb_array_elements(d->'levels') l
     where s.key = 'fit_rubric' and d->>'source' = 'judged'
     group by d->>'key'
    having not coalesce(bool_or((l->>'key') = (p->(d->>'key')->>'level')), false)
     order by d->>'key' limit 1) end
$$;

-- the itemized score: six dimensions in rubric order. Eligibility and award come from the funder's own fields.
create or replace function grants.fit_compute(p_inputs jsonb, p_ua text, p_award bigint, p_evidence jsonb default '{}'::jsonb,
                                              p_elig_note text default null, p_award_note text default null)
returns jsonb language plpgsql stable set search_path = grants, extensions, pg_temp as $$
declare v_rub jsonb; d jsonb; lv jsonb; v_key text; v_in jsonb; v_dims jsonb := '[]'::jsonb; v_total int := 0; v_tier text;
begin
  select value into v_rub from grants.settings where key = 'fit_rubric';
  if v_rub is null or p_inputs is null then return null; end if;
  for d in select value from jsonb_array_elements(v_rub->'dims') loop
    v_key := d->>'key';
    v_in := case v_key
      when 'eligibility' then jsonb_build_object('level', coalesce(p_ua, 'unknown'), 'why', p_elig_note,
             'quote', p_evidence #>> '{eligibility,quote}', 'url', p_evidence #>> '{eligibility,url}')
      -- award bands match the rubric labels ($200k, $500k, $1M)
      when 'award' then jsonb_build_object('level', case when p_award is null then 'unknown' when p_award < 200000 then 'low'
               when p_award < 500000 then '200k' when p_award < 1000000 then '500k' else '1m' end, 'why', p_award_note,
             'quote', p_evidence #>> '{award,quote}', 'url', p_evidence #>> '{award,url}')
      else coalesce(p_inputs->v_key, '{}'::jsonb) end;
    lv := null;
    select l into lv from jsonb_array_elements(d->'levels') l where l->>'key' = v_in->>'level';
    if lv is null then  -- a missing or unknown level scores as the lowest one
      select l into lv from jsonb_array_elements(d->'levels') l order by (l->>'points')::int limit 1;
    end if;
    v_total := v_total + (lv->>'points')::int;
    v_dims := v_dims || jsonb_strip_nulls(jsonb_build_object('key', v_key, 'label', d->>'label', 'level', lv->>'key', 'level_label', lv->>'label',
                'points', (lv->>'points')::int, 'max', (d->>'max')::int,
                'why', left(btrim(coalesce(v_in->>'why', '')), 300), 'quote', left(btrim(coalesce(v_in->>'quote', '')), 400),
                'url', case when (v_in->>'url') ~* '^https?://' then v_in->>'url' end));
  end loop;
  select t->>'key' into v_tier from jsonb_array_elements(v_rub->'tiers') t where v_total >= (t->>'min')::int order by (t->>'min')::int desc limit 1;
  return jsonb_build_object('v', (v_rub->>'version')::int, 'total', v_total, 'tier', v_tier, 'dims', v_dims);
end $$;

-- the hard checks every listed source must pass; null = passes
create or replace function grants.gate_reason(p_breakdown jsonb, p_ua text, p_award bigint) returns text
language sql stable set search_path = grants, extensions, pg_temp as $$
  with s as (select (select (value #>> '{}')::bigint from grants.settings where key = 'min_award_usd') as min_award,
                    (select (value->>'min_fit')::int from grants.settings where key = 'fit_rubric') as min_fit)
  select case
    when p_ua = 'unlikely' then 'Universities or US applicants cannot apply.'
    when p_award is not null and p_award < s.min_award
      then format('Largest single award ($%s) is below the $%s minimum.', to_char(p_award, 'FM999,999,999,999'), to_char(s.min_award, 'FM999,999,999,999'))
    when p_breakdown is null then 'No itemized fit score.'
    when (select x->>'level' from jsonb_array_elements(p_breakdown->'dims') x where x->>'key' = 'mission') = 'none' then 'Does not fund this kind of work.'
    when (p_breakdown->>'total')::int < s.min_fit then format('Fit score %s is below the minimum of %s.', p_breakdown->>'total', s.min_fit)
  end from s
$$;

-- derive fit_score / fit_breakdown / fit_reasons and check which quotes appear in the crawler's copy of the page
create or replace function grants.funders_fit_derive() returns trigger
language plpgsql set search_path = grants, extensions, pg_temp as $$
declare b jsonb; v_text text; v_ok jsonb := '{}'::jsonb; r record; v_q text;
begin
  new.evidence := coalesce(new.evidence, '{}'::jsonb);
  if new.fit_inputs is not null then
    b := grants.fit_compute(new.fit_inputs, new.ua_eligibility, new.award_max_usd, new.evidence, new.eligibility_note, new.award_note);
    if b is not null then
      new.fit_breakdown := b;
      new.fit_score := (b->>'total')::smallint;
      new.fit_reasons := array(select format('%s: %s (%s/%s)', x->>'label', x->>'level_label', x->>'points', x->>'max')
                                 from jsonb_array_elements(b->'dims') with ordinality as t(x, n) order by n);
    end if;
  end if;
  -- compare letters and digits only, so spacing, punctuation and quote marks do not matter
  if new.last_text is not null then v_text := regexp_replace(lower(new.last_text), '[^a-z0-9]+', '', 'g'); end if;
  for r in select key, value->>'quote' as quote from jsonb_each(coalesce(new.fit_inputs, '{}'::jsonb) || new.evidence)
            where key in ('mission', 'activity', 'geography', 'precedent', 'award', 'deadline', 'eligibility') loop
    v_q := left(regexp_replace(lower(coalesce(r.quote, '')), '[^a-z0-9]+', '', 'g'), 80);
    if v_q <> '' then
      v_ok := v_ok || jsonb_build_object(r.key, v_text is not null and length(v_q) >= 20 and position(v_q in v_text) > 0);
    end if;
  end loop;
  new.evidence_ok := v_ok;
  return new;
end $$;

revoke all on all functions in schema grants from public, anon, authenticated;


-- ===== grants_008b2_radar_v2_fit_trigger (20261112003836) =====
create trigger funders_fit_derive before insert or update of fit_inputs, evidence, ua_eligibility, award_max_usd, eligibility_note, award_note, last_text
  on grants.funders for each row execute function grants.funders_fit_derive();


-- ===== grants_008c_radar_v2_vetting_api (20261112004104) =====
-- 008c: vetting API. Every write to a funder's vetting state goes through these functions, which apply the same coded checks.

-- Register a newly found source. Same signature as v1; a payload without an itemized fit can no longer be listed (it is stored as a candidate).
create or replace function grants.register_source(p jsonb, p_lens text default null, p_run_label text default null) returns jsonb
language plpgsql set search_path = grants, extensions, pg_temp as $$
declare
  v_id uuid; v_exist record; v_status text := coalesce(p->>'status', 'candidate');
  v_key text := grants.name_key((p->>'name') || ' ' || coalesce(p->>'program', ''));
  v_fit jsonb := grants.fit_clean(p->'fit'); v_ev jsonb := grants.evidence_clean(p->'evidence');
  v_ua text := coalesce(p->>'ua_eligibility', 'unknown');
  v_award bigint := round(nullif(p->>'award_max_usd', '')::numeric)::bigint;
  v_award_min bigint := round(nullif(p->>'award_min_usd', '')::numeric)::bigint;
  v_conf text := coalesce(p->>'amount_confidence', 'unknown');
  v_deadline date := nullif(p->>'next_deadline', '')::date;
  v_today date := (now() at time zone 'America/Phoenix')::date;
  v_reason text := nullif(btrim(p->>'reject_reason'), ''); v_b jsonb; v_problem text; v_notes text[] := '{}'; v_target uuid := nullif(p->>'target_id', '')::uuid;
  v_score int;
begin
  select id, name, status into v_exist from grants.funders
   where url_norm = grants.url_norm(p->>'url') or name_key = v_key limit 1;
  if found then
    insert into grants.discovery_log(url, name, lens, outcome, reason, run_label, funder_id)
    values (p->>'url', p->>'name', p_lens, 'duplicate', 'already in funders as ' || v_exist.name || ' (' || v_exist.status || ')', p_run_label, v_exist.id)
    on conflict (url_norm) do nothing;
    if v_target is not null then
      update grants.targets set status = case v_exist.status when 'vetted' then 'covered' when 'rejected' then 'rejected' else status end,
             funder_id = v_exist.id, note = 'already known as ' || v_exist.name, attempts = attempts + 1, updated_at = now() where id = v_target;
    end if;
    return jsonb_build_object('result', 'duplicate', 'funder_id', v_exist.id, 'existing_name', v_exist.name, 'existing_status', v_exist.status);
  end if;

  -- claims need evidence: an eligibility or award claim without a quoted sentence is stored as not confirmed
  if v_ua in ('eligible', 'eligible_with_partner') and not (v_ev ? 'eligibility') then
    v_ua := 'unknown'; v_notes := v_notes || 'ua_eligibility stored as unknown: evidence.eligibility.quote is missing';
  end if;
  if v_award is null then v_conf := 'unknown';
  elsif v_conf = 'published' and not (v_ev ? 'award') then
    v_conf := 'estimated'; v_notes := v_notes || 'amount_confidence stored as estimated: evidence.award.quote is missing';
  end if;
  if v_award_min is not null and v_award is not null and v_award_min > v_award then v_award_min := null; end if;
  if v_deadline is not null and v_deadline < v_today then
    v_deadline := null; v_notes := v_notes || 'next_deadline dropped: it is in the past';
  end if;

  v_problem := grants.fit_problem(v_fit);
  if v_problem is not null then v_fit := null; end if;
  if v_status = 'vetted' then
    if v_problem is not null then
      v_status := 'candidate'; v_notes := v_notes || ('stored as candidate: ' || v_problem);
    else
      v_b := grants.fit_compute(v_fit, v_ua, v_award, v_ev, null, null);
      v_reason := grants.gate_reason(v_b, v_ua, v_award);
      if v_reason is not null then
        v_status := 'rejected'; v_notes := v_notes || ('stored as rejected: ' || v_reason);
      elsif coalesce(v_fit #>> '{mission,quote}', '') = '' then
        v_status := 'candidate'; v_notes := v_notes || 'stored as candidate: fit.mission.quote (the funder''s own words about what it funds) is required';
      elsif coalesce(btrim(p->>'vet_note'), '') = '' then
        v_status := 'candidate'; v_notes := v_notes || 'stored as candidate: vet_note is required';
      end if;
    end if;
  end if;
  if v_status = 'rejected' and v_reason is null then v_reason := 'Screened out without a stated reason.'; end if;
  if v_status <> 'rejected' then v_reason := null; end if;

  insert into grants.funders(name, program, category, url, apply_url, feed_url, geography, themes, award_min_usd, award_max_usd,
        amount_confidence, award_note, ua_eligibility, cycle, next_deadline, deadline_note, open_now, requirements, requirements_text,
        eligibility_note, notes, partner_needed, fit_score, fit_reasons, page_type, fetchability, adapter, adapter_config,
        status, vetted_at, vetted_by, vet_note, reject_reason, confidence, discovered_via, fit_inputs, evidence, verified_at, verified_by)
  values (p->>'name', p->>'program', p->>'category', p->>'url', p->>'apply_url', p->>'feed_url',
        coalesce(array(select jsonb_array_elements_text(p->'geography')), '{}'), coalesce(array(select jsonb_array_elements_text(p->'themes')), '{}'),
        v_award_min, v_award, v_conf, p->>'award_note', v_ua, coalesce(p->>'cycle', 'closed_unknown'),
        v_deadline, p->>'deadline_note', (p->>'open_now')::boolean, coalesce(p->'requirements', '{}'::jsonb), p->>'requirements_text',
        p->>'eligibility_note', p->>'notes', coalesce(array(select jsonb_array_elements_text(p->'partner_needed')), '{}'),
        round(nullif(p->>'fit_score', '')::numeric)::smallint, coalesce(array(select jsonb_array_elements_text(p->'fit_reasons')), '{}'),
        coalesce(p->>'page_type', 'html_static'), coalesce(p->>'fetchability', 'unknown'), coalesce(p->>'adapter', 'html'), coalesce(p->'adapter_config', '{}'::jsonb),
        v_status, case when v_status = 'vetted' then now() end, case when v_status = 'vetted' then coalesce(p->>'vetted_by', 'discovery') end,
        p->>'vet_note', v_reason, nullif(p->>'confidence', '')::real, coalesce(p->>'discovered_via', p_lens),
        v_fit, v_ev, case when v_fit is not null then now() end, case when v_fit is not null then coalesce(p->>'vetted_by', 'discovery') end)
  returning id, fit_score into v_id, v_score;

  insert into grants.discovery_log(url, name, lens, outcome, reason, run_label, funder_id)
  values (p->>'url', p->>'name', p_lens, case v_status when 'vetted' then 'vetted' when 'rejected' then 'rejected' else 'candidate' end,
          coalesce(v_reason, p->>'vet_note'), p_run_label, v_id)
  on conflict (url_norm) do nothing;
  insert into grants.vet_events(funder_id, kind, note, changes, run_label)
  values (v_id, 'registered', left(coalesce(v_reason, p->>'vet_note'), 600),
          jsonb_build_object('status', jsonb_build_array(null, v_status), 'fit_score', jsonb_build_array(null, v_score)), p_run_label);
  if v_target is not null then
    update grants.targets set status = case v_status when 'vetted' then 'covered' when 'rejected' then 'rejected' else status end,
           funder_id = v_id, note = left(coalesce(v_reason, p->>'vet_note'), 300), attempts = attempts + 1, updated_at = now() where id = v_target;
  end if;
  return jsonb_build_object('result', 'inserted', 'funder_id', v_id, 'status', v_status, 'fit_score', v_score, 'reject_reason', v_reason, 'notes', to_jsonb(v_notes));
end $$;

-- Re-check a source that is already known: new facts, itemized fit, quoted evidence and a verdict (keep | demote | promote).
-- facts: a key that is present replaces the stored value (JSON null clears it); a missing key leaves it untouched.
create or replace function grants.reverify_source(p_id uuid, p jsonb, p_run_label text default null) returns jsonb
language plpgsql set search_path = grants, extensions, pg_temp as $$
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
end $$;

-- A specific open call under a listed source (shown in the drawer and used for the funder's next deadline).
create or replace function grants.upsert_opportunity(p jsonb, p_run_label text default null) returns jsonb
language plpgsql set search_path = grants, extensions, pg_temp as $$
declare v_funder uuid := (p->>'funder_id')::uuid; v_ext text; v_id uuid; v_new boolean;
        v_deadline date := nullif(p->>'deadline', '')::date; v_today date := (now() at time zone 'America/Phoenix')::date;
begin
  if not exists (select 1 from grants.funders where id = v_funder and status = 'vetted') then raise exception 'funder % is not a listed source', v_funder; end if;
  if btrim(coalesce(p->>'title', '')) = '' or coalesce(p->>'url', '') !~* '^https?://' then raise exception 'title and an http(s) url are required'; end if;
  if v_deadline is not null and v_deadline < v_today then raise exception 'deadline % is in the past', v_deadline; end if;
  v_ext := coalesce(nullif(btrim(p->>'external_id'), ''), 'disc:' || md5(grants.url_norm(p->>'url')));
  insert into grants.opportunities(funder_id, external_id, title, url, apply_url, description, open_date, deadline, deadline_text,
         award_min_usd, award_max_usd, status, vet_status, doc_links, source_adapter)
  values (v_funder, v_ext, left(btrim(p->>'title'), 300), p->>'url', case when (p->>'apply_url') ~* '^https?://' then p->>'apply_url' end,
          left(p->>'description', 1200), nullif(p->>'open_date', '')::date, v_deadline, left(p->>'deadline_text', 300),
          round(nullif(p->>'award_min_usd', '')::numeric)::bigint, round(nullif(p->>'award_max_usd', '')::numeric)::bigint,
          case when p->>'status' = 'forecasted' then 'forecasted' else 'open' end, 'vetted',
          case when jsonb_typeof(p->'doc_links') = 'array' then p->'doc_links' else '[]'::jsonb end, coalesce(p->>'source', 'discovery'))
  on conflict (funder_id, external_id) do update set
    title = excluded.title, url = excluded.url, apply_url = excluded.apply_url, description = excluded.description, open_date = excluded.open_date,
    deadline = excluded.deadline, deadline_text = excluded.deadline_text, award_min_usd = excluded.award_min_usd, award_max_usd = excluded.award_max_usd,
    status = excluded.status, vet_status = 'vetted', doc_links = excluded.doc_links, last_seen_at = now()
  returning id, (xmax = 0) into v_id, v_new;
  return jsonb_build_object('result', case when v_new then 'inserted' else 'updated' end, 'id', v_id, 'funder_id', v_funder, 'run', p_run_label);
end $$;

-- Queue organizations or programs for vetting; anything already known as a funder or a target is skipped.
create or replace function grants.add_targets(p jsonb, p_source text default null) returns jsonb
language plpgsql set search_path = grants, extensions, pg_temp as $$
declare v_n int;
begin
  if jsonb_typeof(p) <> 'array' then raise exception 'expected a JSON array of targets'; end if;
  with src as (
    select btrim(x->>'org') as org, nullif(btrim(coalesce(x->>'program_hint', '')), '') as program_hint,
           case when (x->>'url_hint') ~* '^https?://' then left(x->>'url_hint', 500) end as url_hint,
           x->>'bucket' as bucket, left(x->>'lens', 40) as lens,
           least(3, greatest(1, coalesce(round(nullif(x->>'priority', '')::numeric)::int, 2))) as priority, left(x->>'why', 400) as why
      from jsonb_array_elements(p) x
     where btrim(coalesce(x->>'org', '')) <> '' and x->>'bucket' in ('us_federal', 'intl_dev', 'state_regional', 'private_sector', 'foundation_ngo')),
  keyed as (select s.*, grants.name_key(s.org || ' ' || coalesce(s.program_hint, '')) as k from src s),
  fresh as (
    select distinct on (k) * from keyed s
     where not exists (select 1 from grants.funders f where f.name_key = s.k or (s.url_hint is not null and f.url_norm = grants.url_norm(s.url_hint)))
     order by k, priority),
  ins as (
    insert into grants.targets(org, program_hint, url_hint, bucket, lens, priority, why, source)
    select org, program_hint, url_hint, bucket, lens, priority, why, left(p_source, 80) from fresh
    on conflict (org_key) do nothing returning 1)
  select count(*) into v_n from ins;
  return jsonb_build_object('received', jsonb_array_length(p), 'added', v_n);
end $$;

-- Close or defer a queued target without registering a funder (deferred = try again later, for example the page was unreachable).
create or replace function grants.set_target(p_id uuid, p_status text, p_note text default null) returns jsonb
language plpgsql set search_path = grants, extensions, pg_temp as $$
declare r grants.targets%rowtype;
begin
  if p_status not in ('pending', 'covered', 'rejected', 'deferred') then raise exception 'status must be pending, covered, rejected or deferred'; end if;
  update grants.targets set status = p_status, note = left(p_note, 300), attempts = attempts + 1, updated_at = now() where id = p_id returning * into r;
  if not found then return jsonb_build_object('result', 'not_found'); end if;
  return jsonb_build_object('result', 'ok', 'org', r.org, 'status', r.status, 'attempts', r.attempts);
end $$;

-- Start (label only) or finish (with summary and stats) a discovery run. The summary is shown on the dashboard: plain words, no private notes.
create or replace function grants.log_discovery_run(p_label text, p_summary text default null, p_stats jsonb default null) returns jsonb
language plpgsql set search_path = grants, extensions, pg_temp as $$
begin
  if btrim(coalesce(p_label, '')) = '' then raise exception 'run label is required'; end if;
  insert into grants.discovery_runs(run_label, summary, stats, finished_at)
  values (p_label, left(p_summary, 1200), coalesce(p_stats, '{}'::jsonb), case when p_summary is not null then now() end)
  on conflict (run_label) do update set
    summary = coalesce(left(p_summary, 1200), grants.discovery_runs.summary),
    stats = case when p_stats is null then grants.discovery_runs.stats else p_stats end,
    finished_at = case when p_summary is not null then now() else grants.discovery_runs.finished_at end;
  if p_summary is not null then
    begin
      perform grants.snapshot_metrics();
    exception when others then
      raise warning 'snapshot_metrics failed after discovery run %: %', p_label, sqlerrm;
    end;
  end if;
  return jsonb_build_object('result', 'ok', 'run_label', p_label, 'finished', p_summary is not null);
end $$;

revoke all on all functions in schema grants from public, anon, authenticated;


-- ===== grants_008c2_register_source_notes_fix (20261112004432) =====
-- 008c2: register_source appended untyped string literals to a text[] (parsed as array literals). Type them as text.
do $fix$
declare d text; n int;
begin
  d := pg_get_functiondef('grants.register_source(jsonb,text,text)'::regprocedure);
  n := (length(d) - length(replace(d, $q$v_notes || '$q$, ''))) / length($q$v_notes || '$q$);
  if n <> 5 then raise exception 'expected 5 untyped note literals, found %', n; end if;
  execute replace(d, $q$v_notes || '$q$, $q$v_notes || text '$q$);
end $fix$;
revoke all on all functions in schema grants from public, anon, authenticated;


-- ===== grants_008d_radar_v2_feed_metrics (20261112004819) =====
-- 008d: view columns, feed v3, pipeline states, daily metrics, discovery brief. Self-checking: aborts if any v1 feed field changes.
create temp table _feed_before on commit drop as select public.grants_feed() as f;

create or replace view grants.v_funders as
 with s as (
   select (select (value #>> '{}')::int from grants.settings where key = 'min_days_left') as min_days,
          (select (value #>> '{}')::bigint from grants.settings where key = 'min_award_usd') as min_award,
          (now() at time zone 'America/Phoenix')::date as today),
 d as (
   select f_1.id, coalesce((select min(o.deadline) from grants.opportunities o
            where o.funder_id = f_1.id and o.status in ('open', 'forecasted') and o.vet_status = 'vetted' and o.deadline >= (select s_1.today from s s_1)), f_1.next_deadline) as deadline
     from grants.funders f_1)
 select f.id, f.name, f.program, f.category, f.bucket, f.url, f.apply_url, f.feed_url, f.geography, f.themes,
        f.award_min_usd, f.award_max_usd, f.amount_confidence, f.award_note, f.ua_eligibility, f.cycle,
        d.deadline, f.deadline_note, f.open_now, d.deadline - s.today as days_left,
        case when d.deadline is null then case f.cycle when 'rolling' then 'rolling' when 'open_ended' then 'rolling' when 'invite_only' then 'invite' else 'unknown' end
             when d.deadline < s.today then 'expired'
             when (d.deadline - s.today) < s.min_days then 'too_soon'
             else 'ok' end as deadline_state,
        case when f.award_max_usd is null then 'unverified' when f.award_max_usd >= s.min_award then 'ok' else 'low' end as amount_flag,
        f.requirements, f.requirements_text, f.eligibility_note, f.notes, f.partner_needed, f.fit_score, f.fit_reasons,
        f.page_type, f.fetchability, f.confidence, f.vetted_at, f.vet_note, f.last_checked_at, f.last_ok_at, f.last_changed_at,
        f.consecutive_failures, f.last_links as doc_links, f.status,
        f.fit_breakdown, f.evidence, f.evidence_ok,
        ((coalesce(f.fit_inputs #>> '{mission,quote}', '') <> '')::int + (coalesce(f.evidence #>> '{eligibility,quote}', '') <> '')::int
         + (coalesce(f.evidence #>> '{award,quote}', '') <> '')::int + (coalesce(f.evidence #>> '{deadline,quote}', '') <> '')::int) as facts_verified,
        f.verified_at, f.verified_by,
        case when f.cycle = 'invite_only' or f.ua_eligibility = 'invitation_only' then 'cultivate'
             when d.deadline is not null and (d.deadline - s.today) >= s.min_days then 'apply_now'
             when f.cycle in ('rolling', 'open_ended') then 'rolling'
             when f.cycle = 'annual_recurring' then 'prepare'
             else 'watch' end as lane
   from grants.funders f join d on d.id = f.id cross join s;

-- Today's numbers for the listed sources (one JSON object; snapshot_metrics stores one per Arizona day).
create or replace function grants.metrics_now() returns jsonb
language sql stable set search_path = grants, extensions, pg_temp as $$
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
$$;

create or replace function grants.snapshot_metrics() returns void
language sql set search_path = grants, extensions, pg_temp as $$
  insert into grants.metrics_daily(day, m) values ((now() at time zone 'America/Phoenix')::date, grants.metrics_now())
  on conflict (day) do update set m = excluded.m, updated_at = now()
$$;

-- Dedupe before research: for each {name, program?, url?} return what is already known at any status.
-- exact = register_source would call it a duplicate; other matches are sibling programs of the same organization.
create or replace function grants.check_known(p jsonb) returns jsonb
language sql stable set search_path = grants, extensions, pg_temp as $$
  select coalesce(jsonb_agg(jsonb_build_object('name', x->>'name', 'program', x->>'program', 'matches', coalesce(m.hits, '[]'::jsonb))), '[]'::jsonb)
    from jsonb_array_elements(p) x
    left join lateral (
      select jsonb_agg(jsonb_build_object('name', f.name, 'program', f.program, 'status', f.status, 'reason', f.reject_reason,
               'exact', coalesce(f.name_key = grants.name_key((x->>'name') || ' ' || coalesce(x->>'program', '')) or f.url_norm = grants.url_norm(x->>'url'), false))) as hits
        from (select * from grants.funders f0
               where f0.name_key = grants.name_key((x->>'name') || ' ' || coalesce(x->>'program', ''))
                  or f0.url_norm = grants.url_norm(x->>'url')
                  or (length(grants.name_key(x->>'name')) >= 6 and f0.name_key like grants.name_key(x->>'name') || '%')
               limit 5) f) m on true
$$;

-- Everything a discovery run needs in one read: gates, rubric, coverage gaps, the target queue, the re-check queue, health.
create or replace function grants.discovery_brief() returns jsonb
language sql stable set search_path = grants, extensions, pg_temp as $$
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
$$;

create or replace function public.grants_feed() returns jsonb
language sql stable security definer set search_path = '' as $$
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
$$;

-- Pipeline: two more stages (awarded, declined) and the amount the team plans to ask for.
create or replace function public.grants_set_state(p_pass text, p_funder uuid, p_patch jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
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
end $$;

revoke all on all functions in schema grants from public, anon, authenticated;

do $check$
declare o jsonb; n jsonb; v_bad int; v_tot int;
begin
  select f into o from _feed_before; n := public.grants_feed();
  if not (n ?& array['generated_at','min_days','min_award','rubric','vocab','coverage_min','funders','opportunities','changes','vetting','metrics','discovery','targets','screened','last_run','runs_24h']) then
    raise exception 'feed v3 is missing a key'; end if;
  select count(*) filter (where (b - array['fit_breakdown','evidence','evidence_ok','facts_verified','verified_at','verified_by','lane','team']) <> (a - 'team')
                             or ((b->'team') - 'ask_usd') <> (a->'team')), count(*)
    into v_bad, v_tot
    from jsonb_array_elements(o->'funders') a join jsonb_array_elements(n->'funders') b on a->>'id' = b->>'id';
  if v_tot <> jsonb_array_length(o->'funders') or v_tot <> jsonb_array_length(n->'funders') then raise exception 'funder list changed: % before, % matched', jsonb_array_length(o->'funders'), v_tot; end if;
  if v_bad > 0 then raise exception '% funders changed in a v1 field', v_bad; end if;
  if (o->'opportunities') <> (n->'opportunities') or (o->'changes') <> (n->'changes') or (o->'last_run') <> (n->'last_run') then raise exception 'opportunities, changes or last_run differ'; end if;
  if jsonb_typeof(grants.discovery_brief()->'coverage') <> 'array' or jsonb_typeof(grants.metrics_now()->'quality') <> 'object' then raise exception 'brief or metrics malformed'; end if;
end $check$;

select cron.schedule('grants-metrics', '20 1,13 * * *', $cron$select grants.snapshot_metrics()$cron$);
select grants.snapshot_metrics();


-- ===== grants_008e_radar_v2_vetted_fit_constraint (20261112005409) =====
-- 008e: after the v2 import every listed source has an itemized, evidence-backed score. Make that a rule of the table:
-- nothing can be listed without an itemized fit of at least 40 (aggregators are fetch sources, never listed).
alter table grants.funders add constraint funders_vetted_fit
  check (status <> 'vetted' or category = 'aggregator' or (fit_inputs is not null and fit_score >= 40));
select grants.snapshot_metrics();
