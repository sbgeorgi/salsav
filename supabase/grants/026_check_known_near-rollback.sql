-- 026_check_known_near-rollback.sql
-- Puts grants.check_known(jsonb) back to the exact pre-026 definition
-- (md5 of pg_get_functiondef = 65e4039feb9a7aab46ae84f996649e5e, read live 2026-11-20).
-- It refuses to store anything else: the result is checked against that md5 and the block raises otherwise.
-- It runs only while the 026 definition (md5 d7d5a849a2bf43fc646de1656f23b716) or the pre-026 one is live.
-- Function rewrite only (create or replace): no data changes, no drops, safe through the SQL connector.
--
-- After a rollback the discovery run loses the near matches again (no "id", "url", "match", "why" keys):
-- restore the 2026-11-20 wording of steps 6 and 7 in discovery-task.md and section 2 of API.md with it.

do $unpatch$
declare
  v_old constant text := $old$CREATE OR REPLACE FUNCTION grants.check_known(p jsonb)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO 'grants', 'extensions', 'pg_temp'
AS $function$
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
$function$
$old$;
begin
  if md5(v_old) <> '65e4039feb9a7aab46ae84f996649e5e' then
    raise exception 'rollback text is not the pre-026 definition (md5 %)', md5(v_old);
  end if;
  -- only the 026 text (or the pre-026 one, a no-op) is overwritten, never a later change
  if md5(pg_get_functiondef('grants.check_known(jsonb)'::regprocedure))
       not in ('d7d5a849a2bf43fc646de1656f23b716', '65e4039feb9a7aab46ae84f996649e5e') then
    raise exception 'grants.check_known is neither the 026 nor the pre-026 definition (md5 %): a later change is live',
      md5(pg_get_functiondef('grants.check_known(jsonb)'::regprocedure));
  end if;
  execute v_old;
  if md5(pg_get_functiondef('grants.check_known(jsonb)'::regprocedure)) <> '65e4039feb9a7aab46ae84f996649e5e' then
    raise exception 'grants.check_known after rollback is not the pre-026 definition (md5 %)',
      md5(pg_get_functiondef('grants.check_known(jsonb)'::regprocedure));
  end if;
end $unpatch$;

-- Verify (read-only):
-- select md5(pg_get_functiondef('grants.check_known(jsonb)'::regprocedure)) = '65e4039feb9a7aab46ae84f996649e5e' as live_is_pre_026;
