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
