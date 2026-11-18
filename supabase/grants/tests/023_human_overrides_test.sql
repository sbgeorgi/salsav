-- 023 human overrides: behaviour tests. Authored 2026-11-17, review round 2026-11-17.
-- Run in a scratch DB where 001-022 and 023_human_overrides.sql are applied, as the postgres role.
-- Every fixture rolls back: the block always ends in RAISE EXCEPTION. Read the "TEST RESULT: {...}" message and check all_ok.
-- Covered: promote, demote, release (lock); lock/status agreement (22023); T1 automated reject on a promoted funder; T2 automated listing
--   on a demoted funder; T3 automated vetted on a demoted call; T4 call restore (and refusal under an unlisted funder); listed-funder guard
--   on new calls; unlist cascade; notes add and remove; note input checks; vet_events guard; gate shape (non-array dims); registry shape and
--   anonymous redaction; grants_funder tiers; discovery_brief keys (old and new); resolve_promoted; lead audit rows; grants_set_state
--   (bad passcode returns an error, a change writes one event, a no-op writes none, a blank actor falls back); grants_team_notes shape.
-- Not covered: reverify_source with a failing gate (needs a full fit payload; check by reading the 023 patch); apply_fetch_result
--   (its conflict path is covered only by the guard test); the real upsert_opportunity on-conflict path.
do $test$
declare
  res jsonb := '{}'::jsonb;
  f_cand uuid; f_dem uuid; f_op uuid; f_new uuid; f_agg uuid; f_auto uuid; f_lead uuid; o_vet uuid;
  r jsonb; r2 jsonb; v_note bigint; v_n bigint; v_total bigint; v_cnt bigint; v_keys text[]; v_ok boolean;
  v_status text; v_lock text; v_rr text; v_queue text; v_kind text; v_vs text; v_actor text; v_lr text;
  v_passcode text := '023-test-pass';
begin
  -- fixtures
  insert into grants.settings(key, value) values ('passcode_hash', to_jsonb(extensions.crypt(v_passcode, extensions.gen_salt('bf'))))
    on conflict (key) do update set value = excluded.value;
  insert into grants.funders (name, category, url) values ('023 test candidate', 'foundation', 'https://t023-cand.example.org/') returning id into f_cand;
  insert into grants.funders (name, category, url) values ('023 test demote', 'foundation', 'https://t023-dem.example.org/') returning id into f_dem;
  insert into grants.funders (name, category, url) values ('023 test call host', 'foundation', 'https://t023-op.example.org/') returning id into f_op;
  insert into grants.funders (name, category, url) values ('023 test new', 'foundation', 'https://t023-new.example.org/') returning id into f_new;
  insert into grants.funders (name, category, url) values ('023 test aggregator', 'aggregator', 'https://t023-agg.example.org/') returning id into f_agg;
  -- the call host must be listed before a vetted call can exist under it (the listed-funder guard)
  perform grants.human_set_funder(f_op, 'promote', 'test setup listing', 'tester');
  insert into grants.opportunities (funder_id, external_id, title, status, vet_status)
    values (f_op, 't023-call-1', '023 test call', 'open', 'vetted') returning id into o_vet;

  -- S1 promote a candidate with no fit: listed, locked, queued for the agent
  begin
    perform grants.human_set_funder(f_cand, 'promote', 'team test promote', 'tester');
    select status, human_lock, agent_queue into v_status, v_lock, v_queue from grants.funders where id = f_cand;
    res := res || jsonb_build_object('S1_promote', jsonb_build_object('ok', v_status = 'vetted' and v_lock = 'promoted' and v_queue = 'pending',
                                     'status', v_status, 'lock', v_lock, 'queue', v_queue));
  exception when others then
    res := res || jsonb_build_object('S1_promote', jsonb_build_object('ok', false, 'sqlstate', SQLSTATE, 'msg', SQLERRM));
  end;

  -- S2 (T1) an automated reject on a promoted funder is reverted; the reason and the vet note stay as the team left them
  begin
    update grants.funders set status = 'rejected', reject_reason = 'automated test reject', vet_note = 'automated test note' where id = f_cand;
    select status, reject_reason, vet_note into v_status, v_rr, v_lr from grants.funders where id = f_cand;
    res := res || jsonb_build_object('S2_T1_keep_promoted', jsonb_build_object('ok', v_status = 'vetted' and v_rr is null and v_lr is distinct from 'automated test note',
                                     'status', v_status, 'reject_reason', v_rr, 'vet_note', v_lr));
  exception when others then
    res := res || jsonb_build_object('S2_T1_keep_promoted', jsonb_build_object('ok', false, 'sqlstate', SQLSTATE, 'msg', SQLERRM));
  end;

  -- S3 (T2) an automated listing of a demoted funder is reverted; the demote reason stays
  begin
    perform grants.human_set_funder(f_dem, 'promote', 'team test promote', 'tester');
    perform grants.human_set_funder(f_dem, 'demote', 'team test demote reason', 'tester');
    update grants.funders set status = 'vetted', vet_note = 'agent says promote' where id = f_dem;
    select status, human_lock, reject_reason, vet_note into v_status, v_lock, v_rr, v_lr from grants.funders where id = f_dem;
    res := res || jsonb_build_object('S3_T2_keep_demoted', jsonb_build_object('ok', v_status = 'rejected' and v_lock = 'demoted'
                                     and v_rr = 'team test demote reason' and v_lr is distinct from 'agent says promote',
                                     'status', v_status, 'lock', v_lock, 'reject_reason', v_rr));
  exception when others then
    res := res || jsonb_build_object('S3_T2_keep_demoted', jsonb_build_object('ok', false, 'sqlstate', SQLSTATE, 'msg', SQLERRM));
  end;

  -- S4 release of a promoted funder with no scored fit is blocked with 22023 (plain-English message)
  begin
    perform grants.human_set_funder(f_cand, 'release', null, 'tester');
    res := res || jsonb_build_object('S4_release_blocked_without_fit', jsonb_build_object('ok', false, 'detail', 'release succeeded; a 22023 block was expected'));
  exception when others then
    res := res || jsonb_build_object('S4_release_blocked_without_fit', jsonb_build_object('ok', SQLSTATE = '22023', 'sqlstate', SQLSTATE, 'msg', SQLERRM));
  end;

  -- S5 release of a demoted funder clears the lock and keeps it rejected
  begin
    perform grants.human_set_funder(f_dem, 'release', null, 'tester');
    select status, human_lock into v_status, v_lock from grants.funders where id = f_dem;
    res := res || jsonb_build_object('S5_release_demoted', jsonb_build_object('ok', v_status = 'rejected' and v_lock is null,
                                     'status', v_status, 'lock', v_lock));
  exception when others then
    res := res || jsonb_build_object('S5_release_demoted', jsonb_build_object('ok', false, 'sqlstate', SQLSTATE, 'msg', SQLERRM));
  end;

  -- S6 (T3, T4) a demoted call stays rejected under an automated vetted write; the team can restore it under a listed funder
  begin
    perform grants.human_set_call(o_vet, 'demote', 'team test call demote', 'tester');
    update grants.opportunities set vet_status = 'vetted' where id = o_vet;
    select vet_status into v_vs from grants.opportunities where id = o_vet;
    res := res || jsonb_build_object('S6_T3_keep_demoted_call', jsonb_build_object('ok', v_vs = 'rejected', 'vet_status', v_vs));
    perform grants.human_set_call(o_vet, 'restore', null, 'tester');
    select vet_status into v_vs from grants.opportunities where id = o_vet;
    res := res || jsonb_build_object('S6_T4_restore_call', jsonb_build_object('ok', v_vs = 'vetted', 'vet_status', v_vs));
  exception when others then
    res := res || jsonb_build_object('S6_calls', jsonb_build_object('ok', false, 'sqlstate', SQLSTATE, 'msg', SQLERRM));
  end;

  -- S7 notes: add, then soft remove; no live note remains and the row stays
  begin
    r := grants.note_add(f_new, 'test note body', 'tester', null);
    v_note := (r->>'id')::bigint;
    perform grants.note_remove(v_note, 'tester');
    select count(*) into v_n from grants.notes where funder_id = f_new and deleted_at is null;
    res := res || jsonb_build_object('S7_notes', jsonb_build_object('ok', v_n = 0
                                     and exists (select 1 from grants.notes where id = v_note and deleted_at is not null), 'live_notes', v_n));
  exception when others then
    res := res || jsonb_build_object('S7_notes', jsonb_build_object('ok', false, 'sqlstate', SQLSTATE, 'msg', SQLERRM));
  end;

  -- S8 vet_events guard: an automated 'promoted' event on a candidate is stored as 'updated'
  begin
    insert into grants.vet_events (funder_id, kind, note, changes, run_label)
      values (f_new, 'promoted', 'auto test', '{}'::jsonb, 'test-023') returning kind into v_kind;
    res := res || jsonb_build_object('S8_vet_event_guard', jsonb_build_object('ok', v_kind = 'updated', 'kind', v_kind));
  exception when others then
    res := res || jsonb_build_object('S8_vet_event_guard', jsonb_build_object('ok', false, 'sqlstate', SQLSTATE, 'msg', SQLERRM));
  end;

  -- S8b an automated promote on an unlocked funder keeps 'promoted' (a log-after-update regression would relabel it)
  begin
    insert into grants.funders (name, category, url) values ('023 test auto promote', 'aggregator', 'https://t023-auto.example.org/') returning id into f_auto;
    update grants.funders set status = 'vetted', vetted_at = now(), vet_note = 'automated test promote', fit_score = 50,
           fit_reasons = array['automated test'] where id = f_auto;
    insert into grants.vet_events (funder_id, kind, note, changes, run_label)
      values (f_auto, 'promoted', 'automated test promote', '{}'::jsonb, 'test-023') returning kind into v_kind;
    res := res || jsonb_build_object('S8b_auto_promote_kept', jsonb_build_object('ok', v_kind = 'promoted', 'kind', v_kind));
  exception when others then
    res := res || jsonb_build_object('S8b_auto_promote_kept', jsonb_build_object('ok', false, 'sqlstate', SQLSTATE, 'msg', SQLERRM));
  end;

  -- S9 gates: an aggregator passes by definition; an unscored funder fails the gate; a non-array dims does not raise
  begin
    select grants.human_gates(g) into r from grants.funders g where g.id = f_agg;
    select grants.human_gates(g) into r2 from grants.funders g where g.id = f_new;
    res := res || jsonb_build_object('S9_gates', jsonb_build_object('ok', (r->>'pass') = 'true' and (r2->>'pass') = 'false' and (r2->>'scored') = 'false',
                                     'aggregator', r, 'unscored', r2));
    update grants.funders set fit_breakdown = '{"dims":"not an array"}'::jsonb where id = f_new;
    select grants.human_gates(g) into r2 from grants.funders g where g.id = f_new;
    res := res || jsonb_build_object('S9b_gates_non_array_dims', jsonb_build_object('ok', (r2->>'pass') = 'false', 'gates', r2));
  exception when others then
    res := res || jsonb_build_object('S9_gates', jsonb_build_object('ok', false, 'sqlstate', SQLSTATE, 'msg', SQLERRM));
  end;

  -- S10 registry: every funder row is present, whatever its status; a funder object has the contract keys
  begin
    r := public.grants_registry();
    select count(*) into v_total from grants.funders;
    select count(*) into v_n from jsonb_array_elements(r->'funders') x;
    res := res || jsonb_build_object('S10_registry_count', jsonb_build_object('ok', v_n = v_total, 'registry', v_n, 'table', v_total));
    res := res || jsonb_build_object('S10b_registry_every_id', jsonb_build_object('ok', not exists (
      select 1 from grants.funders g
       where not exists (select 1 from jsonb_array_elements(r->'funders') x where x->>'id' = g.id::text))));
    select array_agg(k) into v_keys from unnest(array['generated_at', 'access', 'thresholds', 'counts', 'funders', 'leads', 'calls']) k
     where not (r ? k);
    res := res || jsonb_build_object('S10c_registry_top_keys', jsonb_build_object('ok', v_keys is null, 'missing', v_keys));
    select array_agg(k) into v_keys from unnest(array['id', 'name', 'program', 'category', 'bucket', 'status', 'url', 'geography', 'themes',
        'award_min_usd', 'award_max_usd', 'amount_confidence', 'ua_eligibility', 'cycle', 'next_deadline', 'fit_score', 'fit_breakdown',
        'fit_reasons', 'vet_note', 'reject_reason', 'gates', 'evaluated_at', 'vetted_at', 'verified_at', 'created_at', 'discovered_via',
        'adapter', 'fetchability', 'last_ok_at', 'calls_open', 'calls_total', 'team_state', 'human', 'queue']) k
     where not exists (select 1 from jsonb_array_elements(r->'funders') x where x->>'id' = f_cand::text and x ? k);
    res := res || jsonb_build_object('S10d_registry_funder_keys', jsonb_build_object('ok', v_keys is null, 'missing', v_keys));
  exception when others then
    res := res || jsonb_build_object('S10_registry', jsonb_build_object('ok', false, 'sqlstate', SQLSTATE, 'msg', SQLERRM));
  end;

  -- S11 brief: the twelve old keys, plus promoted and backfill; the promoted list carries f_cand (pushed to the oldest slot so the 20-row cap cannot hide it)
  begin
    update grants.funders set human_at = '2000-01-01 00:00:00+00' where id = f_cand;
    r := grants.discovery_brief();
    select array_agg(k) into v_keys from unnest(array['today', 'gates', 'rubric', 'theme_vocab', 'coverage', 'targets', 'reverify',
        'failing', 'collection_gaps', 'metrics', 'last_runs', 'last_refresh', 'promoted', 'backfill']) k
     where not (r ? k);
    res := res || jsonb_build_object('S11_brief_keys', jsonb_build_object('ok', v_keys is null
                                     and exists (select 1 from jsonb_array_elements(r->'promoted') x where x->>'id' = f_cand::text),
                                     'missing', v_keys, 'promoted_len', jsonb_array_length(r->'promoted')));
  exception when others then
    res := res || jsonb_build_object('S11_brief_keys', jsonb_build_object('ok', false, 'sqlstate', SQLSTATE, 'msg', SQLERRM));
  end;

  -- S12 agent queue: the first resolve closes the item, the second call is a no-op; a long run label is capped at 60
  begin
    r := grants.resolve_promoted(f_cand, 'checked in test', repeat('x', 100));
    r2 := grants.resolve_promoted(f_cand, 'checked again', 'test-023');
    select exists (select 1 from grants.vet_events where funder_id = f_cand and run_label = repeat('x', 60))
       and not exists (select 1 from grants.vet_events where funder_id = f_cand and length(run_label) > 60) into v_ok;
    res := res || jsonb_build_object('S12_resolve_promoted', jsonb_build_object('ok', r->>'result' = 'done' and r2->>'result' = 'unchanged'
                                     and v_ok, 'first', r->>'result', 'second', r2->>'result'));
  exception when others then
    res := res || jsonb_build_object('S12_resolve_promoted', jsonb_build_object('ok', false, 'sqlstate', SQLSTATE, 'msg', SQLERRM));
  end;

  -- S13 a lock that disagrees with the status it sets raises 22023 (f_new is a candidate: a demoted lock needs rejected)
  begin
    update grants.funders set human_lock = 'demoted' where id = f_new;
    res := res || jsonb_build_object('S13_lock_status_agree', jsonb_build_object('ok', false, 'detail', 'update was stored; a 22023 was expected'));
  exception when others then
    res := res || jsonb_build_object('S13_lock_status_agree', jsonb_build_object('ok', SQLSTATE = '22023', 'sqlstate', SQLSTATE, 'msg', SQLERRM));
  end;

  -- S14 listed-funder guard: a vetted call under a candidate funder is stored as candidate
  begin
    insert into grants.opportunities (funder_id, external_id, title, status, vet_status)
      values (f_new, 't023-guard', '023 guard call', 'open', 'vetted') returning vet_status into v_vs;
    res := res || jsonb_build_object('S14_listed_guard', jsonb_build_object('ok', v_vs = 'candidate', 'vet_status', v_vs));
  exception when others then
    res := res || jsonb_build_object('S14_listed_guard', jsonb_build_object('ok', false, 'sqlstate', SQLSTATE, 'msg', SQLERRM));
  end;

  -- S15 unlist cascade: demoting the call host moves its vetted calls to candidate
  begin
    perform grants.human_set_funder(f_op, 'demote', 'test cascade demote', 'tester');
    select vet_status into v_vs from grants.opportunities where id = o_vet;
    res := res || jsonb_build_object('S15_unlist_cascade', jsonb_build_object('ok', v_vs = 'candidate', 'vet_status', v_vs));
  exception when others then
    res := res || jsonb_build_object('S15_unlist_cascade', jsonb_build_object('ok', false, 'sqlstate', SQLSTATE, 'msg', SQLERRM));
  end;

  -- S16 restore of a call under an unlisted funder raises 22023 (the funder was demoted in S15)
  begin
    perform grants.human_set_call(o_vet, 'demote', 'test call demote under demoted host', 'tester');
    perform grants.human_set_call(o_vet, 'restore', null, 'tester');
    res := res || jsonb_build_object('S16_restore_needs_listed_funder', jsonb_build_object('ok', false, 'detail', 'restore succeeded; a 22023 was expected'));
  exception when others then
    res := res || jsonb_build_object('S16_restore_needs_listed_funder', jsonb_build_object('ok', SQLSTATE = '22023', 'sqlstate', SQLSTATE, 'msg', SQLERRM));
  end;

  -- S17 lead audit: queue and dismiss each write a team event, including for a lead with no funder
  begin
    insert into grants.targets (org, bucket) values ('023 test lead', 'foundation_ngo') returning id into f_lead;
    perform grants.human_set_lead(f_lead, 'queue', 'test queue reason', 'tester');
    perform grants.human_set_lead(f_lead, 'dismiss', 'test dismiss reason', 'tester');
    select count(*) into v_cnt from grants.team_events where payload->>'target_id' = f_lead::text and kind in ('lead_queue', 'lead_dismiss');
    res := res || jsonb_build_object('S17_lead_audit', jsonb_build_object('ok', v_cnt = 2, 'events', v_cnt));
  exception when others then
    res := res || jsonb_build_object('S17_lead_audit', jsonb_build_object('ok', false, 'sqlstate', SQLSTATE, 'msg', SQLERRM));
  end;

  -- S18 passcode writes: a wrong passcode RETURNS an error and leaves its failure row in the transaction; a change writes one event;
  -- a no-op writes none; a blank actor falls back to 'team'
  begin
    r := public.grants_set_state('wrong-pass', f_cand, '{"state":"reviewing","actor":"tester"}'::jsonb);
    select count(*) into v_cnt from grants.auth_attempts where not ok;
    res := res || jsonb_build_object('S18a_bad_passcode_returns', jsonb_build_object('ok', r->>'code' = '28000' and r->>'message' = 'bad passcode'
                                     and current_setting('response.status', true) = '403' and v_cnt >= 1,
                                     'result', r, 'failed_rows', v_cnt));
    select count(*) into v_cnt from grants.team_events where funder_id = f_cand;
    r := public.grants_set_state(v_passcode, f_cand, '{"state":"reviewing","actor":"tester"}'::jsonb);
    select count(*) into v_n from grants.team_events where funder_id = f_cand;
    select payload->'from'->>'state' into v_lr from grants.team_events where funder_id = f_cand order by id desc limit 1;
    res := res || jsonb_build_object('S18b_change_writes_one_event', jsonb_build_object('ok', r->>'state' = 'reviewing' and v_n = v_cnt + 1
                                     and v_lr = 'new', 'events_added', v_n - v_cnt, 'from_state', v_lr));
    select count(*) into v_cnt from grants.team_events where funder_id = f_cand;
    r := public.grants_set_state(v_passcode, f_cand, '{"state":"reviewing","actor":"tester"}'::jsonb);
    select count(*) into v_n from grants.team_events where funder_id = f_cand;
    res := res || jsonb_build_object('S18c_noop_writes_nothing', jsonb_build_object('ok', v_n = v_cnt, 'events_added', v_n - v_cnt));
    r := public.grants_set_state(v_passcode, f_cand, '{"state":"applying","actor":"   "}'::jsonb);
    select actor into v_actor from grants.team_events where funder_id = f_cand order by id desc limit 1;
    res := res || jsonb_build_object('S18d_blank_actor_falls_back', jsonb_build_object('ok', v_actor = 'team', 'actor', v_actor));
  exception when others then
    res := res || jsonb_build_object('S18_passcode_writes', jsonb_build_object('ok', false, 'sqlstate', SQLSTATE, 'msg', SQLERRM));
  end;

  -- S19 grants_team_notes: team, events and notes keys with the right passcode; a wrong one returns an error object
  begin
    r := public.grants_team_notes(v_passcode);
    r2 := public.grants_team_notes('wrong-pass');
    res := res || jsonb_build_object('S19_team_notes', jsonb_build_object('ok', r ? 'team' and r ? 'events' and r ? 'notes'
                                     and r2->>'code' = '28000', 'keys', (select array_agg(k) from jsonb_object_keys(r) k)));
  exception when others then
    res := res || jsonb_build_object('S19_team_notes', jsonb_build_object('ok', false, 'sqlstate', SQLSTATE, 'msg', SQLERRM));
  end;

  -- S20 grants_funder tiers: the team sees team identity; the anonymous tier does not, and a non-listed funder shows no notes or owner
  begin
    r := public.grants_funder(f_cand, v_passcode);
    r2 := public.grants_funder(f_cand, null);
    select count(*) into v_cnt from jsonb_array_elements(r2->'vetting') v where v->>'actor' is not null;
    res := res || jsonb_build_object('S20a_funder_tiers', jsonb_build_object('ok', r->>'access' = 'team' and r2->>'access' = 'public'
                                     and r->'funder'->'human'->>'by' = 'tester' and (r2->'funder'->'human'->>'by') is null and v_cnt = 0
                                     and r ? 'opportunities' and r ? 'vetting' and r->'funder' ? 'collection' and r->'funder' ? 'team',
                                     'team_access', r->>'access', 'anon_access', r2->>'access'));
    r := public.grants_funder(f_new, null);
    res := res || jsonb_build_object('S20b_unlisted_anon_has_no_notes', jsonb_build_object('ok', not (r->'funder' ? 'notes')
                                     and not (r->'funder'->'team' ? 'owner') and r->'funder'->'team' ? 'state',
                                     'funder_keys', (select array_agg(k) from jsonb_object_keys(r->'funder') k)));
  exception when others then
    res := res || jsonb_build_object('S20_funder', jsonb_build_object('ok', false, 'sqlstate', SQLSTATE, 'msg', SQLERRM));
  end;

  -- S21 note input checks: a non-numeric remove and a malformed call id raise 22023 (plain message, not a cast error)
  begin
    perform public.grants_note(v_passcode, f_new, '{"remove":"abc","actor":"tester"}'::jsonb);
    res := res || jsonb_build_object('S21a_note_remove_checked', jsonb_build_object('ok', false, 'detail', 'no error; a 22023 was expected'));
  exception when others then
    res := res || jsonb_build_object('S21a_note_remove_checked', jsonb_build_object('ok', SQLSTATE = '22023', 'sqlstate', SQLSTATE, 'msg', SQLERRM));
  end;
  begin
    perform public.grants_note(v_passcode, f_new, '{"body":"ok note","actor":"tester","opportunity_id":"not-a-uuid"}'::jsonb);
    res := res || jsonb_build_object('S21b_note_call_id_checked', jsonb_build_object('ok', false, 'detail', 'no error; a 22023 was expected'));
  exception when others then
    res := res || jsonb_build_object('S21b_note_call_id_checked', jsonb_build_object('ok', SQLSTATE = '22023', 'sqlstate', SQLSTATE, 'msg', SQLERRM));
  end;

  res := res || jsonb_build_object('all_ok', not exists (
    select 1 from jsonb_each(res) e where coalesce((e.value->>'ok')::boolean, false) is not true));
  raise exception 'TEST RESULT: %', res::text;
end
$test$;
