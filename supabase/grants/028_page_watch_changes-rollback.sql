-- 028_page_watch_changes-rollback.sql
-- Puts grants.discovery_brief() back to the 027 definition (md5 88210804c0d6625d5458f277f996f227) by the inverse replace().
-- Runs only while the 028 (md5 48ffe526e8b81e977991cf3cb2eb6d62) or the 027 definition is live; checks the result md5.
-- After a rollback, restore the pre-028 wording of API.md (collection_gaps) and discovery-task.md step 5.

do $u028$
declare
  live constant text := pg_get_functiondef('grants.discovery_brief()'::regprocedure);
  a constant text := E'               c.c->>''verified_at'' as verified_at, l.fetchability, l.consecutive_failures,\n               row_number() over (order by (c.c->>''health'' = ''failing'') desc, (c.c->>''mode'' in (''page'', ''none'')) desc, l.fit_score desc nulls last, l.name) as rn\n          from listed l cross join lateral (select grants.collection_state(l.id) as c) c\n         where c.c->>''health'' <> ''ok''\n';
  b constant text := E'               c.c->>''verified_at'' as verified_at, l.fetchability, l.consecutive_failures, pc.at as page_changed_at, pc.summary as page_change_summary,\n               row_number() over (order by (c.c->>''health'' = ''failing'') desc, (pc.at is not null) desc, (c.c->>''mode'' in (''page'', ''none'')) desc, l.fit_score desc nulls last, l.name) as rn\n          from listed l cross join lateral (select grants.collection_state(l.id) as c) c\n          left join lateral (select s.fetched_at as at, left(s.summary, 300) as summary from grants.snapshots s\n                              where c.c->>''mode'' = ''page'' and c.c->>''verified_at'' is not null and s.funder_id = l.id\n                                and s.change_kind not in (''initial'', ''error'') and s.fetched_at > (c.c->>''verified_at'')::timestamptz\n                              order by s.fetched_at desc limit 1) pc on true\n         where c.c->>''health'' <> ''ok''\n            or pc.at is not null\n';
begin
  if md5(live) = '88210804c0d6625d5458f277f996f227' then
    raise notice 'grants.discovery_brief() is already the 027 definition';
    return;
  end if;
  if md5(live) <> '48ffe526e8b81e977991cf3cb2eb6d62' then
    raise exception 'grants.discovery_brief() is neither the 028 nor the 027 definition (md5 %): a later change is live', md5(live);
  end if;
  execute replace(live, b, a);
  if md5(pg_get_functiondef('grants.discovery_brief()'::regprocedure)) <> '88210804c0d6625d5458f277f996f227' then
    raise exception 'grants.discovery_brief() after rollback is not the 027 definition';
  end if;
end $u028$;
