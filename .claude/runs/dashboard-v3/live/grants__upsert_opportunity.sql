CREATE OR REPLACE FUNCTION grants.upsert_opportunity(p jsonb, p_run_label text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'grants', 'extensions', 'pg_temp'
AS $function$
declare v_funder uuid := (p->>'funder_id')::uuid; v_ext text; v_id uuid; v_new boolean;
        v_deadline date := nullif(p->>'deadline', '')::date; v_today date := (now() at time zone 'America/Phoenix')::date;
begin
  if not exists (select 1 from grants.funders where id = v_funder and status = 'vetted') then raise exception 'funder % is not a listed source', v_funder; end if;
  if btrim(coalesce(p->>'title', '')) = '' or coalesce(p->>'url', '') !~* '^https?://' then raise exception 'title and an http(s) url are required'; end if;
  if v_deadline is not null and v_deadline < v_today then raise exception 'deadline % is in the past', v_deadline; end if;
  v_ext := coalesce(nullif(btrim(p->>'external_id'), ''), 'disc:' || md5(grants.url_norm(p->>'url')));
  insert into grants.opportunities(funder_id, external_id, title, url, apply_url, description, open_date, deadline, deadline_text,
         award_min_usd, award_max_usd, status, vet_status, doc_links, source_adapter)
  values (v_funder, v_ext, left(btrim(p->>'title'), 300), p->>'url', case when (p->>'apply_url') ~* '^https?://' then p->>'apply_url' end,
          left(p->>'description', 1200), nullif(p->>'open_date', '')::date, v_deadline, left(p->>'deadline_text', 300),
          round(nullif(p->>'award_min_usd', '')::numeric)::bigint, round(nullif(p->>'award_max_usd', '')::numeric)::bigint,
          case when p->>'status' = 'forecasted' then 'forecasted' else 'open' end, 'vetted',
          case when jsonb_typeof(p->'doc_links') = 'array' then p->'doc_links' else '[]'::jsonb end, coalesce(p->>'source', 'discovery'))
  on conflict (funder_id, external_id) do update set
    title = excluded.title, url = excluded.url, apply_url = excluded.apply_url, description = excluded.description, open_date = excluded.open_date,
    deadline = excluded.deadline, deadline_text = excluded.deadline_text, award_min_usd = excluded.award_min_usd, award_max_usd = excluded.award_max_usd,
    status = excluded.status, vet_status = 'vetted', doc_links = excluded.doc_links, last_seen_at = now()
  returning id, (xmax = 0) into v_id, v_new;
  return jsonb_build_object('result', case when v_new then 'inserted' else 'updated' end, 'id', v_id, 'funder_id', v_funder, 'run', p_run_label);
end $function$
