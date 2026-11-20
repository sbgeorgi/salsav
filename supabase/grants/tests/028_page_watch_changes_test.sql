-- tests/028_page_watch_changes_test.sql
-- Rolled-back check of migration 028 on the live function; always ends in 'PASS ...' or 'FAIL ...'.
-- Uses one healthy vetted page watch and test snapshots, all rolled back with the exception.
do $t$
declare
  pw uuid; g jsonb; hit jsonb; n0 int; r text := '';
begin

  -- fixture: a page watch, verified now, with only its first snapshot -> not listed
  select f.id into pw from grants.funders f where f.status = 'vetted' and grants.collect_mode(f.adapter, f.adapter_config) = 'page'
     and grants.collection_state(f.id)->>'health' = 'ok' order by f.name limit 1;
  if pw is null then raise exception 'FAIL no healthy page watch to test on'; end if;
  update grants.funders set collect_verified_at = now() - interval '1 day' where id = pw;
  insert into grants.snapshots(funder_id, http_status, change_kind, summary) values (pw, 200, 'initial', 'test initial');
  insert into grants.snapshots(funder_id, http_status, change_kind, summary) values (pw, 0, 'error', 'test error');
  g := grants.discovery_brief()->'collection_gaps';
  if g @> jsonb_build_array(jsonb_build_object('id', pw)) then raise exception 'FAIL listed on initial/error snapshot only'; end if;
  n0 := jsonb_array_length(g);
  -- a content change older than verification -> not listed
  insert into grants.snapshots(funder_id, fetched_at, http_status, change_kind, summary) values (pw, now() - interval '2 days', 200, 'content', 'test old change');
  g := grants.discovery_brief()->'collection_gaps';
  if g @> jsonb_build_array(jsonb_build_object('id', pw)) then raise exception 'FAIL listed on a change older than verification'; end if;
  -- a content change after verification -> listed, ranked right after failing rows, with page_changed_at
  insert into grants.snapshots(funder_id, http_status, change_kind, summary) values (pw, 200, 'content', 'test new change');
  g := grants.discovery_brief()->'collection_gaps';
  select e into hit from jsonb_array_elements(g) e where e->>'id' = pw::text;
  if hit is null or hit->>'page_changed_at' is null or hit->>'page_change_summary' <> 'test new change' then raise exception 'FAIL changed page watch not listed with page_changed_at and summary: %', hit; end if;
  if exists (select 1 from jsonb_array_elements(g) with ordinality e(v, i)
              where i < (select i2 from jsonb_array_elements(g) with ordinality e2(v2, i2) where v2->>'id' = pw::text)
                and v->>'health' <> 'failing' and v->>'page_changed_at' is null) then
    raise exception 'FAIL changed page watch ranked below a non-failing row';
  end if;
  if (select count(*) from jsonb_array_elements(g) e where e->>'page_changed_at' is not null and e->>'mode' <> 'page') > 0 then
    raise exception 'FAIL page_changed_at on a non-page row';
  end if;
  r := r || 'gaps ' || n0 || '->' || jsonb_array_length(g) || ' (page ' || left(pw::text, 8) || ' rank ' ||
       (select i from jsonb_array_elements(g) with ordinality e(v, i) where v->>'id' = pw::text) || ')';
  -- re-verify (C7) clears it
  perform grants.set_collection(pw, '{"verified":true}');
  g := grants.discovery_brief()->'collection_gaps';
  if g @> jsonb_build_array(jsonb_build_object('id', pw)) then raise exception 'FAIL still listed after re-verify'; end if;
  r := r || ' after_reverify=' || jsonb_array_length(g);
  -- unverified: listed by the null branch, without page_changed_at, even with a newer content snapshot
  update grants.funders set collect_verified_at = null where id = pw;
  insert into grants.snapshots(funder_id, fetched_at, http_status, change_kind, summary) values (pw, now() + interval '1 second', 200, 'content', 'test unverified change');
  g := grants.discovery_brief()->'collection_gaps';
  select e into hit from jsonb_array_elements(g) e where e->>'id' = pw::text;
  if hit is null or hit->>'page_changed_at' is not null then raise exception 'FAIL unverified page watch: %', hit; end if;
  -- no real row carries page_changed_at
  if exists (select 1 from jsonb_array_elements(g) e where e->>'page_changed_at' is not null) then raise exception 'FAIL a real row has page_changed_at'; end if;
  r := r || ' unverified-ok';
  r := r || ' | md5 ' || md5(pg_get_functiondef('grants.discovery_brief()'::regprocedure));
  raise exception 'PASS %', r;
end $t$;
