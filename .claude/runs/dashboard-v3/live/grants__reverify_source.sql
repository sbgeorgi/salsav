CREATE OR REPLACE FUNCTION grants.reverify_source(p_id uuid, p jsonb, p_run_label text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'grants', 'extensions', 'pg_temp'
AS $function$
declare
  f grants.funders%rowtype; n grants.funders%rowtype; v_facts jsonb := coalesce(p->'facts', '{}'::jsonb);
  v_fit jsonb; v_b jsonb; v_fail text; v_verdict text := coalesce(p->>'verdict', 'keep'); v_themes text[];
  v_today date := (now() at time zone 'America/Phoenix')::date; v_kind text; v_changes jsonb; v_problem text;
begin
  if v_verdict not in ('keep', 'demote', 'promote') then raise exception 'verdict must be keep, demote or promote'; end if;
  select * into f from grants.funders where id = p_id for update;
  if not found then return jsonb_build_object('result', 'not_found', 'id', p_id); end if;
  n := f;
  if v_facts ? 'ua_eligibility' then n.ua_eligibility := coalesce(v_facts->>'ua_eligibility', 'unknown'); end if;
  if v_facts ? 'award_min_usd' then n.award_min_usd := round(nullif(v_facts->>'award_min_usd', '')::numeric)::bigint; end if;
  if v_facts ? 'award_max_usd' then n.award_max_usd := round(nullif(v_facts->>'award_max_usd', '')::numeric)::bigint; end if;
  if v_facts ? 'amount_confidence' then n.amount_confidence := coalesce(v_facts->>'amount_confidence', 'unknown'); end if;
  if v_facts ? 'award_note' then n.award_note := v_facts->>'award_note'; end if;
  if v_facts ? 'cycle' then n.cycle := coalesce(v_facts->>'cycle', 'closed_unknown'); end if;
  if v_facts ? 'next_deadline' then n.next_deadline := nullif(v_facts->>'next_deadline', '')::date; end if;
  if v_facts ? 'deadline_note' then n.deadline_note := v_facts->>'deadline_note'; end if;
  if v_facts ? 'open_now' then n.open_now := (v_facts->>'open_now')::boolean; end if;
  if v_facts ? 'eligibility_note' then n.eligibility_note := v_facts->>'eligibility_note'; end if;
  if jsonb_typeof(v_facts->'requirements') = 'object' then n.requirements := coalesce(f.requirements, '{}'::jsonb) || (v_facts->'requirements'); end if;
  if jsonb_typeof(v_facts->'themes') = 'array' then
    v_themes := array(select t from jsonb_array_elements_text(v_facts->'themes') t
                       where t in (select jsonb_array_elements_text(value) from grants.settings where key = 'theme_vocab'));
    if cardinality(v_themes) > 0 then n.themes := v_themes; end if;
  end if;
  if v_facts ? 'fetchability' then n.fetchability := coalesce(v_facts->>'fetchability', 'unknown'); end if;
  if v_facts ? 'confidence' then n.confidence := nullif(v_facts->>'confidence', '')::real; end if;

  if p ? 'fit' then
    v_fit := grants.fit_clean(p->'fit'); v_problem := grants.fit_problem(v_fit);
    if v_problem is not null then raise exception '%', v_problem; end if;
    n.fit_inputs := v_fit;
  end if;
  if n.fit_inputs is null and n.category <> 'aggregator' then
    raise exception 'this source has no itemized fit yet: send fit.mission, fit.activity, fit.geography and fit.precedent';
  end if;
  -- evidence keys present in the payload replace the stored ones (an empty quote removes the entry)
  if jsonb_typeof(p->'evidence') = 'object' then
    n.evidence := (coalesce(f.evidence, '{}'::jsonb) - array(select jsonb_object_keys(p->'evidence'))) || grants.evidence_clean(p->'evidence');
  end if;
  if n.award_max_usd is null then n.amount_confidence := 'unknown';
  elsif n.amount_confidence = 'published' and not (n.evidence ? 'award') then n.amount_confidence := 'estimated'; end if;
  if n.award_min_usd is not null and n.award_max_usd is not null and n.award_min_usd > n.award_max_usd then n.award_min_usd := null; end if;
  if n.next_deadline is not null and n.next_deadline < v_today then n.next_deadline := null; end if;
  if btrim(coalesce(p->>'vet_note', '')) <> '' then n.vet_note := left(btrim(p->>'vet_note'), 600); end if;

  v_b := grants.fit_compute(n.fit_inputs, n.ua_eligibility, n.award_max_usd, n.evidence, n.eligibility_note, n.award_note);
  v_fail := case when n.category = 'aggregator' then null else grants.gate_reason(v_b, n.ua_eligibility, n.award_max_usd) end;
  if v_verdict = 'demote' then
    n.status := 'rejected';
    n.reject_reason := left(coalesce(nullif(btrim(p->>'reason'), ''), v_fail, 'Screened out on re-check.'), 600);
  elsif v_fail is not null then
    n.status := 'rejected';
    n.reject_reason := case when f.status = 'rejected' and f.reject_reason is not null then f.reject_reason else v_fail end;
  elsif v_verdict = 'promote' and f.status in ('candidate', 'rejected') then
    if btrim(coalesce(n.vet_note, '')) = '' then raise exception 'promote needs a vet_note'; end if;
    n.status := 'vetted'; n.vetted_at := now(); n.vetted_by := left(coalesce(p->>'by', 'rescore'), 60); n.reject_reason := null;
  end if;
  n.verified_at := now(); n.verified_by := left(coalesce(p->>'by', 'rescore'), 60);

  update grants.funders set
    ua_eligibility = n.ua_eligibility, award_min_usd = n.award_min_usd, award_max_usd = n.award_max_usd, amount_confidence = n.amount_confidence,
    award_note = n.award_note, cycle = n.cycle, next_deadline = n.next_deadline, deadline_note = n.deadline_note, open_now = n.open_now,
    eligibility_note = n.eligibility_note, requirements = n.requirements, themes = n.themes, fetchability = n.fetchability, confidence = n.confidence,
    fit_inputs = n.fit_inputs, evidence = n.evidence, vet_note = n.vet_note, status = n.status, reject_reason = n.reject_reason,
    vetted_at = n.vetted_at, vetted_by = n.vetted_by, verified_at = n.verified_at, verified_by = n.verified_by
  where id = p_id returning * into n;

  select coalesce(jsonb_object_agg(o.key, jsonb_build_array(o.value, w.value)), '{}'::jsonb) into v_changes
    from jsonb_each(to_jsonb(f)) o join jsonb_each(to_jsonb(n)) w using (key)
   where o.key in ('status', 'fit_score', 'ua_eligibility', 'award_min_usd', 'award_max_usd', 'amount_confidence', 'cycle', 'next_deadline', 'open_now')
     and o.value is distinct from w.value;
  v_kind := case when f.status = 'vetted' and n.status = 'rejected' then 'demoted'
                 when f.status <> 'vetted' and n.status = 'vetted' then 'promoted'
                 when f.fit_inputs is null then 'rescored'
                 when v_changes = '{}'::jsonb then 'verified' else 'updated' end;
  insert into grants.vet_events(funder_id, kind, note, changes, run_label)
  values (p_id, v_kind, left(coalesce(case when n.status = 'rejected' then n.reject_reason end, nullif(btrim(p->>'note'), ''), n.vet_note), 600), v_changes, p_run_label);
  return jsonb_build_object('result', v_kind, 'id', p_id, 'name', n.name, 'status', n.status, 'fit_score', n.fit_score, 'reject_reason', n.reject_reason, 'changes', v_changes);
end $function$
