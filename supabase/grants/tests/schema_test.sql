-- Behavior tests for 001/002. Run against a scratch DB: psql -v ON_ERROR_STOP=1 -f schema_test.sql. Rolls back at the end.
begin;
insert into grants.settings(key,value) values ('passcode_hash', to_jsonb(extensions.crypt('s3cret-pass', extensions.gen_salt('bf')))) on conflict (key) do update set value=excluded.value;
insert into grants.settings(key,value) values ('refresh_token_sha256', to_jsonb(encode(extensions.digest('tok','sha256'),'hex'))) on conflict (key) do update set value=excluded.value;

do $$
declare r jsonb; v_id uuid; n int; err text; s int; run1 uuid := gen_random_uuid(); run2 uuid := gen_random_uuid(); c1 jsonb; c2 jsonb;
begin
  -- 1. unscoped source cannot be vetted
  begin
    insert into grants.funders(name,category,url,status,vetted_at,vet_note) values ('X','foundation','https://x.org/a','vetted',now(),'n');
    raise exception 'should have failed';
  exception when check_violation then null; end;
  begin
    insert into grants.funders(name,category,url,status,vetted_at,vet_note,fit_score,fit_reasons,ua_eligibility) values ('X','foundation','https://x.org/b','vetted',now(),'n',50,'{a}','unlikely');
    raise exception 'should have failed';
  exception when check_violation then null; end;
  begin
    insert into grants.funders(name,category,url,status,vetted_at,vet_note,fit_score,fit_reasons,award_max_usd) values ('X','foundation','https://x.org/c','vetted',now(),'n',50,'{a}',100000);
    raise exception 'should have failed';
  exception when check_violation then null; end;

  -- 2. register_source inserts, then dedupes by url and by name
  r := grants.register_source('{"name":"Foo Fund","program":"Agri","category":"foundation","url":"https://www.foo.org/grants/?utm_source=x","status":"vetted","vet_note":"ok","fit_score":70,"fit_reasons":["agrivoltaics"],"geography":["US"],"themes":["solar"],"ua_eligibility":"eligible","next_deadline":"2099-01-01"}', 'lens1', 'run1');
  assert r->>'result' = 'inserted', 'insert '||r::text;
  r := grants.register_source('{"name":"Other","category":"foundation","url":"http://foo.org/grants"}', 'lens1', 'run1');
  assert r->>'result' = 'duplicate', 'url dedupe '||r::text;
  r := grants.register_source('{"name":"FOO fund","program":"agri!","category":"foundation","url":"https://different.org/x"}', 'lens1', 'run1');
  assert r->>'result' = 'duplicate', 'name dedupe '||r::text;
  select id into v_id from grants.funders where name='Foo Fund';

  -- 3. candidate hidden from feed; vetted shown; deadline states
  r := grants.register_source('{"name":"Cand","category":"foundation","url":"https://cand.org"}');
  assert jsonb_array_length(public.grants_feed()->'funders') = 1, 'feed only vetted';
  assert (public.grants_feed()->'funders'->0->>'deadline_state') = 'ok';
  update grants.funders set next_deadline = (now() at time zone 'America/Phoenix')::date + 5 where id=v_id;
  assert (public.grants_feed()->'funders'->0->>'deadline_state') = 'too_soon', 'too_soon';
  update grants.funders set next_deadline = (now() at time zone 'America/Phoenix')::date - 1 where id=v_id;
  assert (public.grants_feed()->'funders'->0->>'deadline_state') = 'expired', 'expired';
  update grants.funders set next_deadline = (now() at time zone 'America/Phoenix')::date + 14 where id=v_id;
  assert (public.grants_feed()->'funders'->0->>'deadline_state') = 'ok', '14d boundary ok';
  assert (public.grants_feed()->'funders'->0->>'amount_flag') = 'unverified';

  -- 4. claim: one lease, no double claim
  update grants.funders set next_check_at = now() - interval '1 min' where id = v_id;
  select shard into s from grants.funders where id=v_id;
  c1 := grants.claim_sources(run1, s % 8, 8, 10);
  c2 := grants.claim_sources(run2, s % 8, 8, 10);
  assert jsonb_array_length(c1) = 1 and jsonb_array_length(c2) = 0, 'no duplicate claims';
  assert grants.remaining_due(s % 8, 8) = 0;

  -- 5. apply_fetch_result
  perform grants.apply_fetch_result(jsonb_build_object('id', v_id, 'kind','ok','http_status',200,'content_hash','h1','text','hello','etag','e1','links','[{"url":"https://foo.org/a.pdf","label":"RFP","type":"pdf"}]'::jsonb,'change',jsonb_build_object('kind','initial','summary','first'),'next_check_s',3600));
  select count(*) into n from grants.snapshots where funder_id=v_id; assert n=1, 'snap1 '||n;
  perform grants.apply_fetch_result(jsonb_build_object('id', v_id, 'kind','ok','http_status',200,'content_hash','h1','text','hello'));
  select count(*) into n from grants.snapshots where funder_id=v_id; assert n=1, 'no snap on same hash';
  perform grants.apply_fetch_result(jsonb_build_object('id', v_id, 'kind','ok','http_status',200,'content_hash','h2','text','hello2','change',jsonb_build_object('kind','docs','summary','new pdf','diff','{"docs_added":[{"url":"u"}]}'::jsonb),'next_deadline','2099-03-01'));
  select count(*) into n from grants.snapshots where funder_id=v_id; assert n=2;
  assert (select next_deadline from grants.funders where id=v_id) = date '2099-03-01', 'deadline applied';
  perform grants.apply_fetch_result(jsonb_build_object('id', v_id, 'kind','error','http_status',429,'error','throttled','cooldown_s',900,'fetchability','bot_protected'));
  assert (select consecutive_failures from grants.funders where id=v_id)=1;
  assert (select cooldown_until from grants.funders where id=v_id) > now();
  assert (select lease_until from grants.funders where id=v_id) is null;
  perform grants.apply_fetch_result(jsonb_build_object('id', v_id, 'kind','not_modified','http_status',304));
  assert (select consecutive_failures from grants.funders where id=v_id)=0;
  perform grants.apply_fetch_result(jsonb_build_object('id', v_id, 'kind','not_modified','opportunities','[{"external_id":"X1","title":"Call 1","deadline":"2099-05-01"}]'::jsonb));
  assert (select vet_status from grants.opportunities where external_id='X1') = 'candidate';
  assert jsonb_array_length(public.grants_feed()->'opportunities') = 0, 'candidate opp hidden';
  update grants.funders set adapter_config='{"auto_vet":true}' where id=v_id;
  perform grants.apply_fetch_result(jsonb_build_object('id', v_id, 'kind','not_modified','opportunities','[{"external_id":"X2","title":"Call 2","deadline":"2099-05-01"}]'::jsonb));
  assert jsonb_array_length(public.grants_feed()->'opportunities') = 1, 'auto_vet opp shown';

  -- 6. passcode + team state
  assert public.grants_check_pass('s3cret-pass');
  r := public.grants_set_state('s3cret-pass', v_id, '{"state":"reviewing","owner":"Ana","notes":"call PO"}');
  assert r->>'state'='reviewing';
  assert (public.grants_feed()->'funders'->0->'team'->>'state')='reviewing';
  assert not (public.grants_feed()->'funders'->0->'team' ? 'notes'), 'notes not in public feed';
  assert public.grants_team_notes('s3cret-pass')->'team'->0->>'notes' = 'call PO';
  begin perform public.grants_set_state('wrong', v_id, '{"state":"skip"}'); raise exception 'no'; exception when sqlstate '28000' then null; end;
  begin perform public.grants_set_state('s3cret-pass', v_id, '{"state":"bogus"}'); raise exception 'no'; exception when raise_exception then
    get stacked diagnostics err = message_text; assert err='bad state', err; end;
  for i in 1..8 loop perform grants.check_pass('nope'); end loop;
  begin perform grants.check_pass('s3cret-pass'); raise exception 'no lock'; exception when others then
    get stacked diagnostics err = message_text; assert err='locked', 'lockout: '||err; end;
  assert grants.check_refresh_token('tok'); assert not grants.check_refresh_token('bad');
  raise notice 'ALL SCHEMA TESTS PASSED';
end $$;
rollback;
