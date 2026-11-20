-- tests/027_collection_guards_test.sql
-- Rolled-back check of migration 027 against the live functions. Run in the SQL editor or execute_sql;
-- it always ends in an exception: 'PASS ...' (all checks held, nothing kept) or 'FAIL ...'.
-- Uses real rows (Coca-Cola 002801a7 page watch, one fresh vetted cycle funder with 0 open calls, the
-- unverified candidate 5f7ed305 when still unverified); every change rolls back with the exception.
do $t$
declare
  cyc uuid; b uuid; g jsonb; n0 int; x text; r text := '';
begin

  -- E11: a cycle funder with 0 open calls enters collection_gaps only once 120+ days stale
  select f.id into cyc from grants.funders f where f.status = 'vetted' and grants.collect_mode(f.adapter, f.adapter_config) = 'cycle'
     and (grants.collection_state(f.id)->>'open_calls')::int = 0 and grants.collection_state(f.id)->>'health' = 'ok'
     and f.collect_verified_at > now() - interval '120 days' order by f.name limit 1;
  if cyc is null then raise exception 'FAIL no fresh cycle funder with 0 open calls to test on'; end if;
  g := grants.discovery_brief()->'collection_gaps';
  if g @> jsonb_build_array(jsonb_build_object('id', cyc)) then raise exception 'FAIL fresh cycle funder listed in gaps'; end if;
  n0 := jsonb_array_length(g);
  update grants.funders set collect_verified_at = now() - interval '200 days' where id = cyc;
  g := grants.discovery_brief()->'collection_gaps';
  if not g @> jsonb_build_array(jsonb_build_object('id', cyc)) then raise exception 'FAIL stale cycle funder missing from gaps'; end if;
  r := r || 'gaps ' || n0 || '->' || jsonb_array_length(g) || ' (cycle ' || left(cyc::text, 8) || ')';

  -- E12 allowed
  perform grants.set_collection('002801a7-0e64-4f21-b0ce-b6581f2b4d74', '{"verified":true}');
  perform grants.set_collection('002801a7-0e64-4f21-b0ce-b6581f2b4d74', '{"verified":true,"note":"Blocker: JS_ONLY site"}');
  perform grants.set_collection(cyc, '{"verified":true,"note":"cycle note, no token"}');
  if (select collect_verified_at from grants.funders where id = '002801a7-0e64-4f21-b0ce-b6581f2b4d74') is null then raise exception 'FAIL cola lost verified'; end if;
  -- E12 refused
  foreach x in array array[
      '{"verified":true,"note":"Page watch only, no calls."}',
      '{"note":"Page watch only, no calls."}',
      '{"verified":false,"note":"Page watch only, no calls."}'] loop
    begin
      perform grants.set_collection('002801a7-0e64-4f21-b0ce-b6581f2b4d74', x::jsonb);
      raise exception 'FAIL accepted %', x;
    exception when others then
      if sqlerrm not like 'page watch needs a blocker%' then raise; end if;
    end;
  end loop;
  -- E12 still allowed: a new page config, unverified, without a token (verification is cleared)
  perform grants.set_collection('002801a7-0e64-4f21-b0ce-b6581f2b4d74', '{"adapter_config":{"note_only":1},"note":"Page watch only, no calls."}');
  if (select collect_verified_at from grants.funders where id = '002801a7-0e64-4f21-b0ce-b6581f2b4d74') is not null then raise exception 'FAIL changed config kept verified'; end if;
  -- an unverified page candidate takes a plain note
  b := (select id from grants.funders where id::text like '5f7ed305%' and collect_verified_at is null);
  if b is not null then perform grants.set_collection(b, '{"note":"plain note"}'); r := r || ' buffett-ok'; end if;
  -- switching page -> list with verified and no token
  if grants.set_collection('002801a7-0e64-4f21-b0ce-b6581f2b4d74', '{"verified":true,"adapter_config":{"list":{"match":"grant"}},"note":"list"}')->>'mode' <> 'calls' then raise exception 'FAIL to_list'; end if;
  r := r || ' | md5 ' || md5(pg_get_functiondef('grants.discovery_brief()'::regprocedure)) || ' ' || md5(pg_get_functiondef('grants.set_collection(uuid,jsonb,text)'::regprocedure));
  raise exception 'PASS %', r;
end $t$;
