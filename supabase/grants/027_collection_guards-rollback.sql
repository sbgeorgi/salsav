-- 027_collection_guards-rollback.sql
-- Puts grants.discovery_brief() and grants.set_collection(uuid,jsonb,text) back to the exact pre-027
-- definitions (md5 of pg_get_functiondef 41bad1377046702c5a69429c12ce5982 and 21059cc6b7bf9117e713de303ad3c5ea,
-- read live 2026-11-20) by the inverse replace(). Each block runs only while the 027 or the pre-027 definition
-- is live, so a later change is never overwritten, and checks the result md5. Function rewrites only.
-- After a rollback the page-watch blocker is a written rule again (COLLECT.md C4 route 6), not enforced;
-- the "no_listing_anywhere: " note prefixes on 002801a7 and fa09bcf7 can stay (they are true).

do $u027a$
declare
  live constant text := pg_get_functiondef('grants.discovery_brief()'::regprocedure);
  a constant text := E'            or (c.c->>''mode'' in (''page'', ''none'')\n                and (c.c->>''verified_at'' is null';
  b constant text := E'            or ((c.c->>''mode'' in (''page'', ''none'') or (c.c->>''mode'' = ''cycle'' and (c.c->>''open_calls'')::int = 0))\n                and (c.c->>''verified_at'' is null';
begin
  if md5(live) = '41bad1377046702c5a69429c12ce5982' then
    raise notice 'grants.discovery_brief() is already the pre-027 definition';
    return;
  end if;
  if md5(live) <> '88210804c0d6625d5458f277f996f227' then
    raise exception 'grants.discovery_brief() is neither the 027 nor the pre-027 definition (md5 %): a later change is live', md5(live);
  end if;
  execute replace(live, b, a);
  if md5(pg_get_functiondef('grants.discovery_brief()'::regprocedure)) <> '41bad1377046702c5a69429c12ce5982' then
    raise exception 'grants.discovery_brief() after rollback is not the pre-027 definition';
  end if;
end $u027a$;

do $u027b$
declare
  live constant text := pg_get_functiondef('grants.set_collection(uuid,jsonb,text)'::regprocedure);
  a constant text := E'  if v_cfg ? ''auto_vet'' and jsonb_typeof(v_cfg->''auto_vet'') <> ''boolean'' then raise exception ''auto_vet must be true or false''; end if;\n';
  b constant text := E'  if v_cfg ? ''auto_vet'' and jsonb_typeof(v_cfg->''auto_vet'') <> ''boolean'' then raise exception ''auto_vet must be true or false''; end if;\n  -- 027: a verified page watch must name its blocker, also when a note-only edit keeps it verified\n  if (coalesce((p->>''verified'')::boolean, false)\n      or (f.collect_verified_at is not null and v_adapter = f.adapter and v_cfg = f.adapter_config and v_url = f.url and v_feed is not distinct from f.feed_url))\n     and grants.collect_mode(v_adapter, v_cfg) = ''page''\n     and coalesce(v_note, '''') !~* ''(js_only|bot_protected|login_required|no_listing_anywhere)'' then\n    raise exception ''page watch needs a blocker (js_only, bot_protected, login_required, no_listing_anywhere) in the note'';\n  end if;\n';
begin
  if md5(live) = '21059cc6b7bf9117e713de303ad3c5ea' then
    raise notice 'grants.set_collection(uuid,jsonb,text) is already the pre-027 definition';
    return;
  end if;
  if md5(live) <> 'ff9aadcfc817b196598bc4646ede13d6' then
    raise exception 'grants.set_collection(uuid,jsonb,text) is neither the 027 nor the pre-027 definition (md5 %): a later change is live', md5(live);
  end if;
  execute replace(live, b, a);
  if md5(pg_get_functiondef('grants.set_collection(uuid,jsonb,text)'::regprocedure)) <> '21059cc6b7bf9117e713de303ad3c5ea' then
    raise exception 'grants.set_collection(uuid,jsonb,text) after rollback is not the pre-027 definition';
  end if;
end $u027b$;
