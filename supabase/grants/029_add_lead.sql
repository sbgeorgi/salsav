-- 029: the team adds a new candidate (lead) for the discovery agent straight from the dashboard.
-- public.grants_add_lead(p_pass, p_patch {org, program, url, bucket, why, actor}) -> grants.add_lead.
-- A name or URL that is already a funder is not added (returns the funder). An existing lead with the same
-- name+program key is re-queued (rejected/deferred) or reported (pending/covered). A new lead goes in at priority 1,
-- source 'team', and writes a lead_queue team event. `near` carries check_known's likely/related rows so the
-- dashboard can say "this may be the same as ...". Additive: two new functions, nothing else changes.

create or replace function grants.add_lead(p_org text, p_program text, p_url text, p_bucket text, p_why text, p_actor text)
returns jsonb
language plpgsql set search_path to '' as $body$
declare
  v_actor text := left(btrim(coalesce(p_actor, '')), 60);
  v_org text := btrim(coalesce(p_org, ''));
  v_prog text := nullif(btrim(coalesce(p_program, '')), '');
  v_url text := nullif(btrim(coalesce(p_url, '')), '');
  v_why text := nullif(left(btrim(coalesce(p_why, '')), 400), '');
  v_key text; f grants.funders%rowtype; t grants.targets%rowtype; v_near jsonb;
begin
  if v_actor = '' then raise exception 'actor is required' using errcode = '22023'; end if;
  if char_length(v_org) < 2 or char_length(v_org) > 200 then
    raise exception 'give the organisation name (2 to 200 characters)' using errcode = '22023';
  end if;
  if v_prog is not null and char_length(v_prog) > 200 then raise exception 'program is too long (200 characters at most)' using errcode = '22023'; end if;
  if v_url is not null and (v_url !~* '^https?://[^\s/]+\.[^\s]+$' or char_length(v_url) > 500) then
    raise exception 'the link must be a web address starting with http:// or https://' using errcode = '22023';
  end if;
  if coalesce(p_bucket, '') not in ('us_federal', 'intl_dev', 'state_regional', 'private_sector', 'foundation_ngo') then
    raise exception 'pick a funder type' using errcode = '22023';
  end if;
  v_key := grants.name_key(v_org || ' ' || coalesce(v_prog, ''));

  -- already a funder: same rule as grants.add_targets
  select * into f from grants.funders x
   where x.name_key = v_key or (v_url is not null and x.url_norm = grants.url_norm(v_url))
   order by (x.name_key = v_key) desc limit 1;
  if found then
    return jsonb_build_object('added', false, 'reason', 'funder',
      'funder', jsonb_build_object('id', f.id, 'name', f.name, 'status', f.status));
  end if;

  select * into t from grants.targets x where x.org_key = v_key for update;
  if found then
    if t.status in ('rejected', 'deferred') then
      perform grants.human_set_lead(t.id, 'queue', coalesce(v_why, 'added again from the dashboard'), v_actor);
      select * into t from grants.targets x where x.id = t.id;
      return jsonb_build_object('added', true, 'requeued', true, 'id', t.id, 'org', t.org, 'status', t.status);
    end if;
    return jsonb_build_object('added', false, 'reason', case t.status when 'pending' then 'queued' else 'covered' end,
      'lead', jsonb_build_object('id', t.id, 'org', t.org, 'status', t.status, 'funder_id', t.funder_id));
  end if;

  insert into grants.targets(org, program_hint, url_hint, bucket, priority, why, source, note)
  values (v_org, v_prog, v_url, p_bucket, 1, v_why, 'team', left(v_actor || ': added from the dashboard', 300))
  returning * into t;
  insert into grants.team_events(funder_id, actor, kind, payload)
  values (null, v_actor, 'lead_queue', jsonb_build_object('target_id', t.id, 'org', t.org, 'reason', v_why, 'from_status', null));

  select coalesce(jsonb_agg(m) filter (where m->>'match' in ('likely', 'related')), '[]'::jsonb) into v_near
    from jsonb_array_elements(grants.check_known(jsonb_build_array(jsonb_build_object('name', v_org, 'program', v_prog, 'url', v_url)))->0->'matches') m;
  return jsonb_build_object('added', true, 'requeued', false, 'id', t.id, 'org', t.org, 'status', t.status,
    'near', (select coalesce(jsonb_agg(jsonb_build_object('id', m->'id', 'name', m->'name', 'status', m->'status', 'match', m->'match')), '[]'::jsonb)
               from (select m from jsonb_array_elements(v_near) m limit 3) s));
end
$body$;

create or replace function public.grants_add_lead(p_pass text, p_patch jsonb) returns jsonb
language plpgsql security definer set search_path to '' as $body$
begin
  if not grants.check_pass(p_pass) then return grants.pass_denied(); end if;
  return grants.add_lead(p_patch->>'org', p_patch->>'program', p_patch->>'url', p_patch->>'bucket', p_patch->>'why', p_patch->>'actor');
end
$body$;

revoke all on function grants.add_lead(text, text, text, text, text, text) from public, anon, authenticated;
revoke all on function public.grants_add_lead(text, jsonb) from public;
grant execute on function public.grants_add_lead(text, jsonb) to anon, authenticated, service_role;
