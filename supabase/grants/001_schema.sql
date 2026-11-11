-- SALSAV grants dashboard: schema `grants` (tables, views, helpers). Additive only.
-- Target: AVS Supabase project. Touches NOTHING outside schema `grants` (the public.grants_* RPCs are in 002).
-- Vetting gate: only status='vetted' rows ever reach the dashboard; the CHECK below makes "vetted" mean
-- scoped for SALSAV (UA-eligible-ish, award max >= 200k or unpublished, fit score + reasons recorded).

create schema if not exists grants;
revoke all on schema grants from public;

-- ---------- helpers ----------
create or replace function grants.url_norm(u text) returns text
language sql immutable parallel safe as $$
  select nullif(
    regexp_replace(
      regexp_replace(
        regexp_replace(
          regexp_replace(lower(btrim(u)), '^https?://(www\.)?', ''),
        '#.*$', ''),
      '([?&])utm_[^&]*', '\1', 'g'),
    '[?&/]+$', ''), '')
$$;

create or replace function grants.name_key(n text) returns text
language sql immutable parallel safe as $$
  select regexp_replace(lower(coalesce(n, '')), '[^a-z0-9]+', '', 'g')
$$;

-- ---------- settings / auth ----------
create table if not exists grants.settings (
  key text primary key,
  value jsonb not null,
  updated_at timestamptz not null default now()
);
insert into grants.settings(key, value) values
  ('min_award_usd', '200000'),
  ('min_days_left', '14'),
  ('lockout_failures', '8'),
  ('lockout_minutes', '15')
on conflict (key) do nothing;

create table if not exists grants.auth_attempts (
  id bigint generated always as identity primary key,
  at timestamptz not null default now(),
  ok boolean not null,
  purpose text not null default 'passcode'
);
create index if not exists auth_attempts_at_idx on grants.auth_attempts (at desc);

-- ---------- funders = one row per source page / program ----------
create table if not exists grants.funders (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  program text,
  category text not null check (category in ('foundation','us_federal','intl_dev_multilateral','bilateral_dev',
                                             'state_regional','corporate','research_collab','prize_challenge','aggregator')),
  bucket text generated always as (
    case category when 'us_federal' then 'us_federal'
                  when 'intl_dev_multilateral' then 'intl_dev'
                  when 'bilateral_dev' then 'intl_dev'
                  when 'state_regional' then 'state_regional'
                  when 'corporate' then 'private_sector'
                  when 'aggregator' then 'tracker'
                  else 'foundation_ngo' end) stored,
  url text not null,
  url_norm text generated always as (grants.url_norm(url)) stored,
  name_key text generated always as (grants.name_key(name || ' ' || coalesce(program, ''))) stored,
  apply_url text,
  feed_url text,
  geography text[] not null default '{}',
  themes text[] not null default '{}',
  award_min_usd bigint check (award_min_usd is null or award_min_usd >= 0),
  award_max_usd bigint check (award_max_usd is null or award_max_usd >= 0),
  amount_confidence text not null default 'unknown' check (amount_confidence in ('published','estimated','unknown')),
  award_note text,
  ua_eligibility text not null default 'unknown'
    check (ua_eligibility in ('eligible','eligible_with_partner','invitation_only','unknown','unlikely')),
  cycle text not null default 'closed_unknown'
    check (cycle in ('fixed_deadline','annual_recurring','rolling','open_ended','invite_only','closed_unknown')),
  next_deadline date,
  deadline_note text,
  open_now boolean,
  -- requirements: {"loi":bool,"cost_share":text,"indirect_cap":text,"registrations":["SAM.gov","UEI"],"page_limit":text,"notes":text}
  requirements jsonb not null default '{}'::jsonb,
  requirements_text text,
  eligibility_note text,
  notes text,
  partner_needed text[] not null default '{}',     -- subset of {UA,YPV,AVS}: who must sit on the proposal
  fit_score smallint check (fit_score between 0 and 100),
  fit_reasons text[] not null default '{}',
  page_type text not null default 'html_static' check (page_type in ('html_static','html_js','api','rss','pdf','other')),
  fetchability text not null default 'unknown'
    check (fetchability in ('easy','bot_protected','login_required','js_required','blocked','unknown')),
  adapter text not null default 'html' check (adapter in ('html','rss','grants_gov','sam_gov','eu_ft','json_api','none')),
  adapter_config jsonb not null default '{}'::jsonb,
  shard smallint generated always as ((hashtext(split_part(grants.url_norm(url), '/', 1)) & 63)::smallint) stored, -- by HOST => one invocation owns a host
  -- vetting gate
  status text not null default 'candidate' check (status in ('candidate','vetted','rejected')),
  vetted_at timestamptz,
  vetted_by text,
  vet_note text,
  reject_reason text,
  confidence real check (confidence is null or confidence between 0 and 1),
  discovered_via text,
  -- crawl state (written only by grants-refresh)
  last_checked_at timestamptz,
  last_ok_at timestamptz,
  last_status int,
  last_error text,
  etag text,
  last_modified text,
  content_hash text,
  last_changed_at timestamptz,
  consecutive_failures int not null default 0,
  next_check_at timestamptz not null default now(),
  cooldown_until timestamptz,
  lease_until timestamptz,
  lease_run uuid,
  robots_blocked boolean not null default false,
  last_text text,
  last_links jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint funders_url_norm_key unique (url_norm),
  -- "vetted" = scoped for SALSAV. Unscoped sources can never be vetted.
  constraint funders_vetted_scope check (
    status <> 'vetted' or (
      vetted_at is not null
      and vet_note is not null and btrim(vet_note) <> ''
      and fit_score is not null
      and coalesce(array_length(fit_reasons, 1), 0) > 0
      and ua_eligibility <> 'unlikely'
      and (award_max_usd is null or award_max_usd >= 200000)
    )),
  constraint funders_rejected_reason check (status <> 'rejected' or (reject_reason is not null and btrim(reject_reason) <> ''))
);
create index if not exists funders_name_key_idx on grants.funders (name_key);
create index if not exists funders_queue_idx on grants.funders (shard, next_check_at) where status = 'vetted';
create index if not exists funders_status_idx on grants.funders (status);

create or replace function grants.touch_updated_at() returns trigger language plpgsql as $$
begin new.updated_at := now(); return new; end $$;
drop trigger if exists funders_touch on grants.funders;
create trigger funders_touch before update on grants.funders for each row execute function grants.touch_updated_at();

-- ---------- opportunities = specific calls / deadlines ----------
create table if not exists grants.opportunities (
  id uuid primary key default gen_random_uuid(),
  funder_id uuid not null references grants.funders(id) on delete cascade,
  external_id text,                          -- e.g. Grants.gov opportunity number
  title text not null,
  url text,
  apply_url text,
  description text,
  open_date date,
  deadline date,
  deadline_text text,
  award_min_usd bigint,
  award_max_usd bigint,
  status text not null default 'open' check (status in ('forecasted','open','closed','archived')),
  -- feed-found opportunities stay 'candidate' (hidden) unless the funder's adapter_config.auto_vet is true
  vet_status text not null default 'candidate' check (vet_status in ('candidate','vetted','rejected')),
  scope_score smallint,
  doc_links jsonb not null default '[]'::jsonb,
  source_adapter text,
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  constraint opportunities_ext_key unique (funder_id, external_id)
);
create index if not exists opportunities_funder_idx on grants.opportunities (funder_id);
create index if not exists opportunities_deadline_idx on grants.opportunities (deadline) where status in ('open','forecasted');

-- ---------- snapshots: one row per detected change (text lives only in funders.last_text) ----------
create table if not exists grants.snapshots (
  id bigint generated always as identity primary key,
  funder_id uuid not null references grants.funders(id) on delete cascade,
  run_id uuid,
  fetched_at timestamptz not null default now(),
  http_status int,
  content_hash text,
  text_len int,
  change_kind text not null check (change_kind in ('initial','content','deadline','amount','docs','status','error')),
  summary text,
  diff jsonb not null default '{}'::jsonb,   -- {"added":[...],"removed":[...],"deadline":{from,to},"docs_added":[{url,label}]}
  links jsonb not null default '[]'::jsonb   -- extracted PDF/doc links at that time
);
create index if not exists snapshots_funder_idx on grants.snapshots (funder_id, fetched_at desc);

-- ---------- host politeness state (shared across invocations) ----------
create table if not exists grants.host_state (
  host text primary key,
  min_interval_ms int not null default 2000,
  cooldown_until timestamptz,
  last_request_at timestamptz,
  consecutive_throttles int not null default 0,
  requests_total bigint not null default 0,
  throttles_total bigint not null default 0,
  robots_txt text,
  robots_fetched_at timestamptz,
  updated_at timestamptz not null default now()
);

-- ---------- refresh runs ----------
create table if not exists grants.refresh_runs (
  id uuid primary key default gen_random_uuid(),
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  trigger text not null default 'manual',
  shard int,
  shards int,
  parent_run uuid,
  status text not null default 'running' check (status in ('running','ok','partial','error')),
  budget_ms int,
  elapsed_ms int,
  planned int not null default 0,
  fetched int not null default 0,
  not_modified int not null default 0,
  changed int not null default 0,
  errors int not null default 0,
  throttled int not null default 0,
  robots_skipped int not null default 0,
  bytes bigint not null default 0,
  chained boolean not null default false,
  stats jsonb not null default '{}'::jsonb   -- per-host: requests, throttles, min/avg spacing ms
);
create index if not exists refresh_runs_started_idx on grants.refresh_runs (started_at desc);

-- ---------- team state (written only through public.grants_set_state + passcode) ----------
create table if not exists grants.team_state (
  funder_id uuid primary key references grants.funders(id) on delete cascade,
  state text not null default 'new' check (state in ('new','reviewing','applying','submitted','skip')),
  owner text,
  notes text,
  updated_at timestamptz not null default now(),
  updated_by text
);
create table if not exists grants.team_events (
  id bigint generated always as identity primary key,
  funder_id uuid not null references grants.funders(id) on delete cascade,
  at timestamptz not null default now(),
  actor text,
  kind text not null,
  payload jsonb not null default '{}'::jsonb
);
create index if not exists team_events_funder_idx on grants.team_events (funder_id, at desc);

-- ---------- discovery log: so the weekly search never re-finds a source ----------
create table if not exists grants.discovery_log (
  id bigint generated always as identity primary key,
  url text not null,
  url_norm text generated always as (grants.url_norm(url)) stored,
  name text,
  lens text,
  outcome text not null check (outcome in ('vetted','candidate','rejected','duplicate','unreachable')),
  reason text,
  run_label text,
  funder_id uuid references grants.funders(id) on delete set null,
  found_at timestamptz not null default now()
);
create unique index if not exists discovery_log_url_norm_uq on grants.discovery_log (url_norm);

-- ---------- lock everything: RLS on, no policies, no API grants ----------
do $$
declare t text;
begin
  for t in select tablename from pg_tables where schemaname = 'grants' loop
    execute format('alter table grants.%I enable row level security', t);
  end loop;
end $$;
revoke all on all tables in schema grants from public, anon, authenticated;
revoke all on all sequences in schema grants from public, anon, authenticated;

-- ---------- derived, dashboard-safe views (read-only; owner-privileged, explicit column list) ----------
create or replace view grants.v_funders as
with s as (
  select (select (value #>> '{}')::int from grants.settings where key = 'min_days_left') as min_days,
         (select (value #>> '{}')::bigint from grants.settings where key = 'min_award_usd') as min_award,
         (now() at time zone 'America/Phoenix')::date as today
), d as (
  select f.id,
         coalesce(
           (select min(o.deadline) from grants.opportunities o
             where o.funder_id = f.id and o.status in ('open','forecasted') and o.vet_status = 'vetted'
               and o.deadline >= (select today from s)),
           f.next_deadline) as deadline
  from grants.funders f
)
select f.id, f.name, f.program, f.category, f.bucket, f.url, f.apply_url, f.feed_url,
       f.geography, f.themes, f.award_min_usd, f.award_max_usd, f.amount_confidence, f.award_note,
       f.ua_eligibility, f.cycle, d.deadline, f.deadline_note, f.open_now,
       (d.deadline - s.today) as days_left,
       case when d.deadline is null then
              case f.cycle when 'rolling' then 'rolling' when 'open_ended' then 'rolling'
                           when 'invite_only' then 'invite' else 'unknown' end
            when d.deadline < s.today then 'expired'
            when d.deadline - s.today < s.min_days then 'too_soon'
            else 'ok' end as deadline_state,
       case when f.award_max_usd is null then 'unverified'
            when f.award_max_usd >= s.min_award then 'ok' else 'low' end as amount_flag,
       f.requirements, f.requirements_text, f.eligibility_note, f.notes, f.partner_needed,
       f.fit_score, f.fit_reasons, f.page_type, f.fetchability, f.confidence,
       f.vetted_at, f.vet_note, f.last_checked_at, f.last_ok_at, f.last_changed_at, f.consecutive_failures,
       f.last_links as doc_links, f.status
from grants.funders f
join d on d.id = f.id
cross join s;

comment on view grants.v_funders is 'Dashboard rows; filter status=''vetted''. disqualified = deadline_state in (expired,too_soon).';
