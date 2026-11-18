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
