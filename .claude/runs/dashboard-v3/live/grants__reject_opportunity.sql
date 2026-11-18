CREATE OR REPLACE FUNCTION grants.reject_opportunity(p_id uuid, p_reason text, p_run_label text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'grants', 'extensions', 'pg_temp'
AS $function$
declare o grants.opportunities%rowtype;
begin
  if coalesce(btrim(p_reason), '') = '' then raise exception 'reject_opportunity needs a reason'; end if;
  select * into o from grants.opportunities where id = p_id for update;
  if not found then raise exception 'opportunity % not found', p_id; end if;
  if o.vet_status <> 'candidate' then
    return jsonb_build_object('result', 'unchanged', 'id', p_id, 'vet_status', o.vet_status);
  end if;
  update grants.opportunities set vet_status = 'rejected' where id = p_id;
  insert into grants.vet_events(funder_id, kind, note, run_label)
  values (o.funder_id, 'updated', left('Call rejected: ' || o.title || ' (' || o.external_id || '): ' || btrim(p_reason), 600), p_run_label);
  return jsonb_build_object('result', 'rejected', 'id', p_id, 'title', o.title, 'run', p_run_label);
end $function$
