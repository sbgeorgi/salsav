-- applied as migration idle_backoff, live version 20261112154724
-- 020: stop repeating empty fetches (2026-11-12).
-- A source whose check brings nothing new (304, same content, or a calls list with no open call) gets an idle streak;
-- each idle check doubles the wait (11.5h -> 23h -> 46h, capped so health never reads 'stale' at 3 days).
-- A deadline within 10 days, new content, or a collection config re-verified since the last check resets to the base wait.
-- collection_state reports health 'empty' for a calls source that extracted no call in 14 days and was not re-verified
-- in 30 days, so the discovery brief's collection_gaps lists it once for triage instead of it being fetched blind forever.
alter table grants.funders add column if not exists idle_streak int not null default 0;

do $mig$
declare d text; n int;
begin
  -- the function declares a variable o: aliases here are e and op
  d := pg_get_functiondef('grants.apply_fetch_result(jsonb)'::regprocedure);
  n := (length(d) - length(replace(d, E'  v_today date :=', ''))) / length(E'  v_today date :=');
  if n <> 1 then raise exception '020: declare anchor found % times', n; end if;
  d := replace(d, E'  v_today date :=', E'  v_idle boolean;\n  v_streak int;\n  v_today date :=');
  n := (length(d) - length(replace(d, E'\nend $function$', ''))) / length(E'\nend $function$');
  if n <> 1 then raise exception '020: end anchor found % times', n; end if;
  d := replace(d, E'\nend $function$', $tail$

  -- 020 idle backoff: runs after the branch above set next_check_at to the base wait
  if v_kind not in ('error', 'robots_blocked') then
    v_idle := v_kind = 'not_modified'
      or p->>'content_hash' is not distinct from f.content_hash
      or (grants.collect_mode(f.adapter, f.adapter_config) = 'calls' and jsonb_typeof(p->'opportunities') = 'array'
          and not exists (select 1 from jsonb_array_elements(p->'opportunities') e
                           where coalesce(e->>'status', 'open') not in ('closed', 'archived')));
    v_streak := case when not v_idle then 0
                     when f.collect_verified_at > coalesce(f.last_ok_at, '-infinity'::timestamptz) then 1
                     else f.idle_streak + 1 end;
    update grants.funders set idle_streak = v_streak,
           next_check_at = case
             when v_streak = 0
               or f.next_deadline between v_today and v_today + 10
               or exists (select 1 from grants.opportunities op where op.funder_id = f.id and op.status in ('open', 'forecasted')
                            and op.deadline between v_today and v_today + 10)
             then next_check_at
             else now() + make_interval(secs => coalesce((p->>'next_check_s')::int, 43200) * (2 ^ least(v_streak, 2))::int) end
     where id = f.id;
  end if;
end $function$$tail$);
  execute d;

  d := pg_get_functiondef('grants.collection_state(uuid)'::regprocedure);
  n := (length(d) - length(replace(d, E'      when f.adapter = ''html'' and (f.fetchability', ''))) / length(E'      when f.adapter = ''html'' and (f.fetchability');
  if n <> 1 then raise exception '020: health anchor found % times', n; end if;
  d := replace(d, E'      when f.adapter = ''html'' and (f.fetchability', E'      when m.mode = ''calls'' and f.idle_streak >= 4
       and (f.collect_verified_at is null or f.collect_verified_at < now() - interval ''30 days'')
       and not exists (select 1 from grants.opportunities o where o.funder_id = f.id and o.last_seen_at > now() - interval ''14 days'') then ''empty''
      when f.adapter = ''html'' and (f.fetchability');
  execute d;
end $mig$;
