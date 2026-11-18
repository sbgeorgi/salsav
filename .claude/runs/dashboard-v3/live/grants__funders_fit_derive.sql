CREATE OR REPLACE FUNCTION grants.funders_fit_derive()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'grants', 'extensions', 'pg_temp'
AS $function$
declare b jsonb; v_text text; v_ok jsonb := '{}'::jsonb; r record; v_q text;
begin
  new.evidence := coalesce(new.evidence, '{}'::jsonb);
  if new.fit_inputs is not null then
    b := grants.fit_compute(new.fit_inputs, new.ua_eligibility, new.award_max_usd, new.evidence, new.eligibility_note, new.award_note);
    if b is not null then
      new.fit_breakdown := b;
      new.fit_score := (b->>'total')::smallint;
      new.fit_reasons := array(select format('%s: %s (%s/%s)', x->>'label', x->>'level_label', x->>'points', x->>'max')
                                 from jsonb_array_elements(b->'dims') with ordinality as t(x, n) order by n);
    end if;
  end if;
  -- compare letters and digits only, so spacing, punctuation and quote marks do not matter
  if new.last_text is not null then v_text := regexp_replace(lower(new.last_text), '[^a-z0-9]+', '', 'g'); end if;
  for r in select key, value->>'quote' as quote from jsonb_each(coalesce(new.fit_inputs, '{}'::jsonb) || new.evidence)
            where key in ('mission', 'activity', 'geography', 'precedent', 'award', 'deadline', 'eligibility') loop
    v_q := left(regexp_replace(lower(coalesce(r.quote, '')), '[^a-z0-9]+', '', 'g'), 80);
    if v_q <> '' then
      v_ok := v_ok || jsonb_build_object(r.key, v_text is not null and length(v_q) >= 20 and position(v_q in v_text) > 0);
    end if;
  end loop;
  new.evidence_ok := v_ok;
  return new;
end $function$
