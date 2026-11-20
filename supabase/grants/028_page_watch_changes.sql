-- 028_page_watch_changes.sql
-- grants.discovery_brief(): collection_gaps also lists a page watch whose page changed since its last route
-- check, so the discovery run re-checks it (COLLECT.md C7 "whenever its page watch flags a change").
-- Before, a page-watch change only set funders.last_changed_at and wrote a snapshot; the run saw the funder
-- again only 120 days after verification.
--
-- Rule: mode page and a snapshot newer than collect_verified_at whose change_kind is not 'initial' or 'error'
-- (the first fetch always lands after verification, so last_changed_at alone would flag every page watch).
-- Only verified page watches (unverified ones are already listed by the null/120-day rule, and an old source's
-- snapshots must not count). New keys page_changed_at and page_change_summary (the latest such snapshot, its
-- summary cut to 300 chars, so the run needs no read of grants.snapshots). These rows rank right after failing
-- ones, so a backlog of changed watches can push other rows past the 15-row cap.
-- Re-applying the config with verified:true after the re-check (C7) moves collect_verified_at past the
-- snapshot, so the row leaves the list by itself. Applies on top of 027 (md5 88210804c0d6625d5458f277f996f227).
--
-- replace() patch under md5 guards (skill grants-sql-function-patch). Tested 2026-11-20 in a rolled-back
-- DO block (tests/028_page_watch_changes_test.sql on the patched text): see that file for the cases.
-- Live since 2026-11-20 as migration 20261120215942 (live md5 48ffe526e8b81e977991cf3cb2eb6d62 checked; live test
-- passed, Arizona fixture ranked 3rd behind two failing rows; rollback dry-run gave the 027 md5; anon and
-- authenticated cannot execute). A 2-lens review found no SQL defect; its fixes (summary in the brief, verified
-- watches only, doc wording) are in this version.
-- Rollback: 028_page_watch_changes-rollback.sql (restores the 027 text). Docs to revert with it: API.md
-- section 1 collection_gaps line, discovery-task.md step 5.

do $m028$
declare
  o constant text := pg_get_functiondef('grants.discovery_brief()'::regprocedure);
  a constant text := E'               c.c->>''verified_at'' as verified_at, l.fetchability, l.consecutive_failures,\n               row_number() over (order by (c.c->>''health'' = ''failing'') desc, (c.c->>''mode'' in (''page'', ''none'')) desc, l.fit_score desc nulls last, l.name) as rn\n          from listed l cross join lateral (select grants.collection_state(l.id) as c) c\n         where c.c->>''health'' <> ''ok''\n';
  b constant text := E'               c.c->>''verified_at'' as verified_at, l.fetchability, l.consecutive_failures, pc.at as page_changed_at, pc.summary as page_change_summary,\n               row_number() over (order by (c.c->>''health'' = ''failing'') desc, (pc.at is not null) desc, (c.c->>''mode'' in (''page'', ''none'')) desc, l.fit_score desc nulls last, l.name) as rn\n          from listed l cross join lateral (select grants.collection_state(l.id) as c) c\n          left join lateral (select s.fetched_at as at, left(s.summary, 300) as summary from grants.snapshots s\n                              where c.c->>''mode'' = ''page'' and c.c->>''verified_at'' is not null and s.funder_id = l.id\n                                and s.change_kind not in (''initial'', ''error'') and s.fetched_at > (c.c->>''verified_at'')::timestamptz\n                              order by s.fetched_at desc limit 1) pc on true\n         where c.c->>''health'' <> ''ok''\n            or pc.at is not null\n';
  n text;
begin
  if md5(o) <> '88210804c0d6625d5458f277f996f227' then
    raise exception 'grants.discovery_brief() is not the 027 definition (md5 %)', md5(o);
  end if;
  if (length(o) - length(replace(o, a, ''))) / length(a) <> 1 then
    raise exception 'grants.discovery_brief(): the 028 anchor must occur exactly once';
  end if;
  n := replace(o, a, b);
  if md5(n) <> '48ffe526e8b81e977991cf3cb2eb6d62' then
    raise exception 'patched grants.discovery_brief() differs from the tested text (md5 %)', md5(n);
  end if;
  execute n;
  if md5(pg_get_functiondef('grants.discovery_brief()'::regprocedure)) <> '48ffe526e8b81e977991cf3cb2eb6d62' then
    raise exception 'stored grants.discovery_brief() differs from the tested text';
  end if;
end $m028$;
