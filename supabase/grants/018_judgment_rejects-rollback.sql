-- rollback: live grants.register_source as of 2026-11-12
CREATE OR REPLACE FUNCTION grants.register_source(p jsonb, p_lens text DEFAULT NULL::text, p_run_label text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'grants', 'extensions', 'pg_temp'
AS $function$
declare
  v_id uuid; v_exist record; v_status text := coalesce(p->>'status', 'candidate');
  v_key text := grants.name_key((p->>'name') || ' ' || coalesce(p->>'program', ''));
  v_fit jsonb := grants.fit_clean(p->'fit'); v_ev jsonb := grants.evidence_clean(p->'evidence');
  v_ua text := coalesce(p->>'ua_eligibility', 'unknown');
  v_award bigint := round(nullif(p->>'award_max_usd', '')::numeric)::bigint;
  v_award_min bigint := round(nullif(p->>'award_min_usd', '')::numeric)::bigint;
  v_conf text := coalesce(p->>'amount_confidence', 'unknown');
  v_deadline date := nullif(p->>'next_deadline', '')::date;
  v_today date := (now() at time zone 'America/Phoenix')::date;
  v_reason text := nullif(btrim(p->>'reject_reason'), ''); v_b jsonb; v_problem text; v_notes text[] := '{}'; v_target uuid := nullif(p->>'target_id', '')::uuid;
  v_score int;
begin
  select id, name, status into v_exist from grants.funders
   where url_norm = grants.url_norm(p->>'url') or name_key = v_key limit 1;
  if found then
    insert into grants.discovery_log(url, name, lens, outcome, reason, run_label, funder_id)
    values (p->>'url', p->>'name', p_lens, 'duplicate', 'already in funders as ' || v_exist.name || ' (' || v_exist.status || ')', p_run_label, v_exist.id)
    on conflict (url_norm) do nothing;
    if v_target is not null then
      update grants.targets set status = case v_exist.status when 'vetted' then 'covered' when 'rejected' then 'rejected' else status end,
             funder_id = v_exist.id, note = 'already known as ' || v_exist.name, attempts = attempts + 1, updated_at = now() where id = v_target;
    end if;
    return jsonb_build_object('result', 'duplicate', 'funder_id', v_exist.id, 'existing_name', v_exist.name, 'existing_status', v_exist.status);
  end if;

  -- claims need evidence: an eligibility or award claim without a quoted sentence is stored as not confirmed
  if v_ua in ('eligible', 'eligible_with_partner') and not (v_ev ? 'eligibility') then
    v_ua := 'unknown'; v_notes := v_notes || text 'ua_eligibility stored as unknown: evidence.eligibility.quote is missing';
  end if;
  if v_award is null then v_conf := 'unknown';
  elsif v_conf = 'published' and not (v_ev ? 'award') then
    v_conf := 'estimated'; v_notes := v_notes || text 'amount_confidence stored as estimated: evidence.award.quote is missing';
  end if;
  if v_award_min is not null and v_award is not null and v_award_min > v_award then v_award_min := null; end if;
  if v_deadline is not null and v_deadline < v_today then
    v_deadline := null; v_notes := v_notes || text 'next_deadline dropped: it is in the past';
  end if;

  v_problem := grants.fit_problem(v_fit);
  if v_problem is not null then v_fit := null; end if;
  if v_status = 'vetted' then
    if v_problem is not null then
      v_status := 'candidate'; v_notes := v_notes || ('stored as candidate: ' || v_problem);
    else
      v_b := grants.fit_compute(v_fit, v_ua, v_award, v_ev, null, null);
      v_reason := grants.gate_reason(v_b, v_ua, v_award);
      if v_reason is not null then
        v_status := 'rejected'; v_notes := v_notes || ('stored as rejected: ' || v_reason);
      elsif coalesce(v_fit #>> '{mission,quote}', '') = '' then
        v_status := 'candidate'; v_notes := v_notes || text 'stored as candidate: fit.mission.quote (the funder''s own words about what it funds) is required';
      elsif coalesce(btrim(p->>'vet_note'), '') = '' then
        v_status := 'candidate'; v_notes := v_notes || text 'stored as candidate: vet_note is required';
      end if;
    end if;
  end if;
  if v_status = 'rejected' and v_reason is null then v_reason := 'Screened out without a stated reason.'; end if;
  if v_status <> 'rejected' then v_reason := null; end if;

  insert into grants.funders(name, program, category, url, apply_url, feed_url, geography, themes, award_min_usd, award_max_usd,
        amount_confidence, award_note, ua_eligibility, cycle, next_deadline, deadline_note, open_now, requirements, requirements_text,
        eligibility_note, notes, partner_needed, fit_score, fit_reasons, page_type, fetchability, adapter, adapter_config,
        status, vetted_at, vetted_by, vet_note, reject_reason, confidence, discovered_via, fit_inputs, evidence, verified_at, verified_by)
  values (p->>'name', p->>'program', p->>'category', p->>'url', p->>'apply_url', p->>'feed_url',
        coalesce(array(select jsonb_array_elements_text(p->'geography')), '{}'), coalesce(array(select jsonb_array_elements_text(p->'themes')), '{}'),
        v_award_min, v_award, v_conf, p->>'award_note', v_ua, coalesce(p->>'cycle', 'closed_unknown'),
        v_deadline, p->>'deadline_note', (p->>'open_now')::boolean, coalesce(p->'requirements', '{}'::jsonb), p->>'requirements_text',
        p->>'eligibility_note', p->>'notes', coalesce(array(select jsonb_array_elements_text(p->'partner_needed')), '{}'),
        round(nullif(p->>'fit_score', '')::numeric)::smallint, coalesce(array(select jsonb_array_elements_text(p->'fit_reasons')), '{}'),
        coalesce(p->>'page_type', 'html_static'), coalesce(p->>'fetchability', 'unknown'), coalesce(p->>'adapter', 'html'), coalesce(p->'adapter_config', '{}'::jsonb),
        v_status, case when v_status = 'vetted' then now() end, case when v_status = 'vetted' then coalesce(p->>'vetted_by', 'discovery') end,
        p->>'vet_note', v_reason, nullif(p->>'confidence', '')::real, coalesce(p->>'discovered_via', p_lens),
        v_fit, v_ev, case when v_fit is not null then now() end, case when v_fit is not null then coalesce(p->>'vetted_by', 'discovery') end)
  returning id, fit_score into v_id, v_score;

  insert into grants.discovery_log(url, name, lens, outcome, reason, run_label, funder_id)
  values (p->>'url', p->>'name', p_lens, case v_status when 'vetted' then 'vetted' when 'rejected' then 'rejected' else 'candidate' end,
          coalesce(v_reason, p->>'vet_note'), p_run_label, v_id)
  on conflict (url_norm) do nothing;
  insert into grants.vet_events(funder_id, kind, note, changes, run_label)
  values (v_id, 'registered', left(coalesce(v_reason, p->>'vet_note'), 600),
          jsonb_build_object('status', jsonb_build_array(null, v_status), 'fit_score', jsonb_build_array(null, v_score)), p_run_label);
  if v_target is not null then
    update grants.targets set status = case v_status when 'vetted' then 'covered' when 'rejected' then 'rejected' else status end,
           funder_id = v_id, note = left(coalesce(v_reason, p->>'vet_note'), 300), attempts = attempts + 1, updated_at = now() where id = v_target;
  end if;
  return jsonb_build_object('result', 'inserted', 'funder_id', v_id, 'status', v_status, 'fit_score', v_score, 'reject_reason', v_reason, 'notes', to_jsonb(v_notes));
end $function$;
