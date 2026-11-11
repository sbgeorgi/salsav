-- SALSAV grants dashboard: server-side functions. Additive. Depends on 001_schema.sql and pgcrypto (schema `extensions`).
-- Public API surface = exactly four public.grants_* functions (read feed, check passcode, set state, read team notes).
-- Everything else lives in schema `grants` and is reachable only by the edge function (direct DB connection).

-- ===== passcode / token =====
create or replace function grants.check_pass(p_pass text) returns boolean
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_hash text; v_ok boolean; v_fail int; v_max int; v_min int;
begin
  select (value #>> '{}')::int into v_max from grants.settings where key = 'lockout_failures';
  select (value #>> '{}')::int into v_min from grants.settings where key = 'lockout_minutes';
  select count(*) into v_fail from grants.auth_attempts
    where purpose = 'passcode' and not ok and at > now() - make_interval(mins => coalesce(v_min, 15));
  if v_fail >= coalesce(v_max, 8) then
    raise exception 'locked' using errcode = 'P0001', hint = 'Too many wrong passcodes; wait and retry.';
  end if;
  select value #>> '{}' into v_hash from grants.settings where key = 'passcode_hash';
  v_ok := v_hash is not null and p_pass is not null and extensions.crypt(p_pass, v_hash) = v_hash;
  insert into grants.auth_attempts(ok) values (v_ok);
  if v_ok then delete from grants.auth_attempts where not ok and purpose = 'passcode'; end if;
  return v_ok;
end $$;

create or replace function grants.check_refresh_token(p_token text) returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce(
    (select extensions.digest(p_token, 'sha256') = decode(value #>> '{}', 'hex')
       from grants.settings where key = 'refresh_token_sha256'), false)
$$;

-- ===== run bookkeeping =====
create or replace function grants.start_run(p_trigger text, p_shard int, p_shards int, p_parent uuid, p_budget_ms int)
returns uuid language sql volatile as $$
  insert into grants.refresh_runs(trigger, shard, shards, parent_run, budget_ms)
  values (coalesce(p_trigger, 'manual'), p_shard, p_shards, p_parent, p_budget_ms) returning id
$$;

-- p_stats: {planned,fetched,not_modified,changed,errors,throttled,robots_skipped,bytes,elapsed_ms,chained,hosts:{...}}
create or replace function grants.finish_run(p_run uuid, p_stats jsonb) returns void
language sql volatile as $$
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
$$;

-- ===== work claiming: each source is leased to exactly one run =====
-- Sources are sharded by HOST (funders.shard), so one invocation owns a host => per-host concurrency is enforced locally.
create or replace function grants.claim_sources(p_run uuid, p_shard int, p_shards int, p_limit int, p_lease_s int default 240)
returns jsonb language plpgsql volatile as $$
declare r jsonb;
begin
  if p_shards is null or p_shards < 1 or p_shard < 0 or p_shard >= p_shards then
    raise exception 'bad shard %/%', p_shard, p_shards;
  end if;
  with c as (
    select id from grants.funders
     where status = 'vetted' and adapter <> 'none'
       and next_check_at <= now()
       and (cooldown_until is null or cooldown_until <= now())
       and (lease_until is null or lease_until < now())
       and (shard % p_shards) = p_shard
     order by next_check_at, id
     limit greatest(p_limit, 0)
     for update skip locked
  ), u as (
    update grants.funders f
       set lease_until = now() + make_interval(secs => p_lease_s), lease_run = p_run
      from c where f.id = c.id
    returning f.id, f.name, f.url, f.feed_url, f.adapter, f.adapter_config, f.etag, f.last_modified, f.content_hash,
              f.fetchability, f.consecutive_failures, f.cycle, f.next_deadline, f.page_type, f.shard
  )
  select coalesce(jsonb_agg(to_jsonb(u)), '[]'::jsonb) into r from u;
  return r;
end $$;

-- remaining due work for this shard (drives self-chaining)
create or replace function grants.remaining_due(p_shard int, p_shards int) returns int
language sql stable as $$
  select count(*)::int from grants.funders
   where status = 'vetted' and adapter <> 'none' and next_check_at <= now()
     and (cooldown_until is null or cooldown_until <= now())
     and (lease_until is null or lease_until < now())
     and (shard % p_shards) = p_shard
$$;

create or replace function grants.get_last_text(p_id uuid) returns jsonb
language sql stable as $$
  select jsonb_build_object('text', last_text, 'links', last_links, 'content_hash', content_hash) from grants.funders where id = p_id
$$;

-- ===== record one source's fetch outcome (atomic) =====
-- p: {id, run, kind: 'ok'|'not_modified'|'error'|'robots_blocked',
--     http_status, error, etag, last_modified, content_hash, text (<=60000), links:[{url,label,type}],
--     change:{kind,summary,diff}, next_deadline (date text, only when confident), award_min_usd, award_max_usd,
--     fetchability, next_check_s, cooldown_s, opportunities:[{external_id,title,url,apply_url,description,open_date,deadline,
--     deadline_text,award_min_usd,award_max_usd,status,scope_score,doc_links}]}
create or replace function grants.apply_fetch_result(p jsonb) returns void
language plpgsql volatile as $$
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
    -- backoff on the source itself: 6h, 12h, 24h, 48h, cap 72h
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

  else -- ok
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

  -- opportunities from feed/api adapters (hidden unless funder is auto_vet)
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
end $$;

-- ===== host politeness state, shared across invocations =====
create or replace function grants.host_load(p_hosts text[]) returns jsonb
language sql stable as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'host', host, 'min_interval_ms', min_interval_ms,
    'cooldown_until_ms', (extract(epoch from cooldown_until) * 1000)::bigint,
    'last_request_at_ms', (extract(epoch from last_request_at) * 1000)::bigint,
    'consecutive_throttles', consecutive_throttles,
    'robots_txt', robots_txt, 'robots_fetched_at_ms', (extract(epoch from robots_fetched_at) * 1000)::bigint)), '[]'::jsonb)
  from grants.host_state where host = any(p_hosts)
$$;

-- p: [{host, min_interval_ms, cooldown_until_ms, last_request_at_ms, consecutive_throttles, requests_inc, throttles_inc, robots_txt, robots_fetched_at_ms}]
create or replace function grants.host_save(p jsonb) returns void
language plpgsql volatile as $$
declare h jsonb;
begin
  for h in select * from jsonb_array_elements(p) loop
    insert into grants.host_state(host, min_interval_ms, cooldown_until, last_request_at, consecutive_throttles,
                                  requests_total, throttles_total, robots_txt, robots_fetched_at)
    values (h->>'host', coalesce((h->>'min_interval_ms')::int, 2000),
            to_timestamp((h->>'cooldown_until_ms')::double precision / 1000), to_timestamp((h->>'last_request_at_ms')::double precision / 1000),
            coalesce((h->>'consecutive_throttles')::int, 0), coalesce((h->>'requests_inc')::int, 0), coalesce((h->>'throttles_inc')::int, 0),
            h->>'robots_txt', to_timestamp((h->>'robots_fetched_at_ms')::double precision / 1000))
    on conflict (host) do update set
      min_interval_ms = coalesce((h->>'min_interval_ms')::int, grants.host_state.min_interval_ms),
      cooldown_until = to_timestamp((h->>'cooldown_until_ms')::double precision / 1000),
      last_request_at = coalesce(to_timestamp((h->>'last_request_at_ms')::double precision / 1000), grants.host_state.last_request_at),
      consecutive_throttles = coalesce((h->>'consecutive_throttles')::int, 0),
      requests_total = grants.host_state.requests_total + coalesce((h->>'requests_inc')::int, 0),
      throttles_total = grants.host_state.throttles_total + coalesce((h->>'throttles_inc')::int, 0),
      robots_txt = coalesce(h->>'robots_txt', grants.host_state.robots_txt),
      robots_fetched_at = coalesce(to_timestamp((h->>'robots_fetched_at_ms')::double precision / 1000), grants.host_state.robots_fetched_at),
      updated_at = now();
  end loop;
end $$;

-- ===== discovery helper: register a vetted/candidate/rejected source in one call, deduping by url + name =====
-- Returns {result:'inserted'|'duplicate', funder_id, existing_name}. Vetted inserts must satisfy funders_vetted_scope.
create or replace function grants.register_source(p jsonb, p_lens text default null, p_run_label text default null) returns jsonb
language plpgsql volatile as $$
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
end $$;

-- ===== PUBLIC API (anon-callable). Read feed: vetted sources only. =====
create or replace function public.grants_feed() returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'generated_at', now(),
    'min_days', (select (value #>> '{}')::int from grants.settings where key = 'min_days_left'),
    'min_award', (select (value #>> '{}')::bigint from grants.settings where key = 'min_award_usd'),
    'funders', coalesce((
      select jsonb_agg(to_jsonb(v) - 'status'
                       || jsonb_build_object('team', jsonb_build_object('state', coalesce(t.state, 'new'), 'owner', t.owner, 'updated_at', t.updated_at))
                       order by v.deadline nulls last, v.fit_score desc nulls last, v.name)
        from grants.v_funders v left join grants.team_state t on t.funder_id = v.id
       where v.status = 'vetted'), '[]'::jsonb),
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
       where f.status = 'vetted' and s.change_kind <> 'error' and s.fetched_at > now() - interval '120 days'), '[]'::jsonb),
    'last_run', (select to_jsonb(r) - 'stats' from (select started_at, finished_at, status, planned, fetched, not_modified, changed, errors, elapsed_ms
                   from grants.refresh_runs where finished_at is not null order by started_at desc limit 1) r),
    'runs_24h', (select jsonb_build_object('runs', count(*), 'fetched', coalesce(sum(fetched), 0), 'changed', coalesce(sum(changed), 0), 'errors', coalesce(sum(errors), 0))
                   from grants.refresh_runs where started_at > now() - interval '24 hours')
  )
$$;

create or replace function public.grants_check_pass(p_pass text) returns boolean
language sql volatile security definer set search_path = '' as $$ select grants.check_pass(p_pass) $$;

-- p_patch keys: state, owner, notes (only present keys change). Returns the resulting team row.
create or replace function public.grants_set_state(p_pass text, p_funder uuid, p_patch jsonb) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
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
end $$;

create or replace function public.grants_team_notes(p_pass text) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
begin
  if not grants.check_pass(p_pass) then raise exception 'bad passcode' using errcode = '28000'; end if;
  return jsonb_build_object(
    'team', coalesce((select jsonb_agg(to_jsonb(t)) from grants.team_state t), '[]'::jsonb),
    'events', coalesce((select jsonb_agg(to_jsonb(e) order by e.at desc) from (select * from grants.team_events order by at desc limit 100) e), '[]'::jsonb));
end $$;

-- ===== grants: lock internals, open only the four public RPCs =====
revoke all on all functions in schema grants from public, anon, authenticated;
revoke all on function public.grants_feed(), public.grants_check_pass(text), public.grants_set_state(text, uuid, jsonb), public.grants_team_notes(text) from public;
grant execute on function public.grants_feed(), public.grants_check_pass(text), public.grants_set_state(text, uuid, jsonb), public.grants_team_notes(text) to anon, authenticated;
