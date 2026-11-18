CREATE OR REPLACE FUNCTION grants.gate_reason(p_breakdown jsonb, p_ua text, p_award bigint)
 RETURNS text
 LANGUAGE sql
 STABLE
 SET search_path TO 'grants', 'extensions', 'pg_temp'
AS $function$
  with s as (select (select (value #>> '{}')::bigint from grants.settings where key = 'min_award_usd') as min_award,
                    (select (value->>'min_fit')::int from grants.settings where key = 'fit_rubric') as min_fit)
  select case
    when p_ua = 'unlikely' then 'Universities or US applicants cannot apply.'
    when p_award is not null and p_award < s.min_award
      then format('Largest single award ($%s) is below the $%s minimum.', to_char(p_award, 'FM999,999,999,999'), to_char(s.min_award, 'FM999,999,999,999'))
    when p_breakdown is null then 'No itemized fit score.'
    when (select x->>'level' from jsonb_array_elements(p_breakdown->'dims') x where x->>'key' = 'mission') = 'none' then 'Does not fund this kind of work.'
    when (p_breakdown->>'total')::int < s.min_fit then format('Fit score %s is below the minimum of %s.', p_breakdown->>'total', s.min_fit)
  end from s
$function$
