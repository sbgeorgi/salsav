-- applied as migration candidate_calls, live version 20261112163023
-- 021: collected calls show on the radar at once, marked unverified, until the next discovery pass confirms or rejects them (2026-11-12).
-- grants_feed now returns candidate calls too, each with vet_status, so the dashboard can badge them "Unverified".
-- grants.reject_opportunity lets the discovery pass take an out-of-scope candidate off the radar for good (a later fetch keeps it rejected:
-- apply_fetch_result only ever moves candidate -> vetted).
do $mig$
declare d text; n int;
begin
  d := pg_get_functiondef('public.grants_feed()'::regprocedure);
  n := (length(d) - length(replace(d, $a$o.vet_status = 'vetted'$a$, ''))) / length($a$o.vet_status = 'vetted'$a$);
  if n <> 1 then raise exception '021: feed filter anchor found % times', n; end if;
  d := replace(d, $a$o.vet_status = 'vetted'$a$, $r$o.vet_status in ('vetted', 'candidate')$r$);
  n := (length(d) - length(replace(d, $a$'source_adapter', o.source_adapter)$a$, ''))) / length($a$'source_adapter', o.source_adapter)$a$);
  if n <> 1 then raise exception '021: feed field anchor found % times', n; end if;
  d := replace(d, $a$'source_adapter', o.source_adapter)$a$, $r$'source_adapter', o.source_adapter, 'vet_status', o.vet_status)$r$);
  execute d;
end $mig$;

create or replace function grants.reject_opportunity(p_id uuid, p_reason text, p_run_label text default null)
returns jsonb language plpgsql set search_path = grants, extensions, pg_temp as $fn$
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
end $fn$;

revoke all on function grants.reject_opportunity(uuid, text, text) from public, anon, authenticated;
