-- 027_collection_guards.sql
-- Two guards from the crawler audit of 2026-11-20 (agent_instructions_audit.txt E11, E12).
--
-- E11 grants.discovery_brief(): collection_gaps also lists a cycle-mode funder with 0 open calls once its
--   collection was last verified 120+ days ago (or never), like page and none funders. Before, a cycle
--   watch whose call had moved to another URL stayed "ok" (it reads the page, finds no date) and never came
--   back to a discovery run. The cap (15) and the ordering are unchanged, so these rows rank after failing and page/none rows (9 gaps on 2026-11-20).
-- E12 grants.set_collection(): refuses to leave a page-mode config verified unless the note (the new one,
--   or the stored one when the call sends no note key) names a blocker token: js_only, bot_protected,
--   login_required or no_listing_anywhere (COLLECT.md C4 route 6), matched case-insensitively anywhere in the
--   note. It checks a call with verified:true, and a call that keeps an already verified page config
--   unchanged (a note-only edit cannot drop the token). Unverified page watches, a changed page config without
--   verified (verification is cleared), and cycle, calls and none configs are not affected.
--   Before 027 the caller rewrote the two page-mode notes that had no token (Coca-Cola 002801a7, PepsiCo
--   fa09bcf7) to start with "no_listing_anywhere: " through set_collection's note key; configs and
--   collect_verified_at were unchanged. To undo, strip that prefix. collect/audit-2026-11-20-rollback.sql now
--   restores 2aa89020 unverified, since its old page-watch note names no blocker.
--
-- replace() patches on the live text under md5 guards (skill grants-sql-function-patch): each anchor must
-- occur exactly once, the file refuses any other pre-027 definition and stores only the tested text.
-- Tested 2026-11-20 in a rolled-back DO block on real rows (tests/027_collection_guards_test.sql, run on the
-- patched text): cycle funder 5e7b14bf (0 open calls) not in collection_gaps while fresh, listed once made
-- 200 days stale (9 -> 10 rows); Coca-Cola verified with its tokened note and with "JS_ONLY" ok; a plain note
-- refused with verified:true, with no verified key and with verified:false (config unchanged, still
-- verified); a changed page config without verified ok and unverified; candidate 5f7ed305 (unverified) takes
-- a plain note; a cycle funder verified with a plain note ok; page -> list switch with verified ok.
-- Patched md5s equal the ones below. A review (3 lenses) found no SQL defect; its doc fixes are in API.md,
-- COLLECT.md C7 and the vetting/probe skills.
-- Live since 2026-11-20 as migration 20261120215047 (live md5s checked; tests/027_collection_guards_test.sql
-- passed on the live functions; rollback dry-run gave the pre-027 md5s; anon/authenticated cannot execute).
-- Rollback: 027_collection_guards-rollback.sql.

do $m027a$
declare
  o constant text := pg_get_functiondef('grants.discovery_brief()'::regprocedure);
  a constant text := E'            or (c.c->>''mode'' in (''page'', ''none'')\n                and (c.c->>''verified_at'' is null';
  b constant text := E'            or ((c.c->>''mode'' in (''page'', ''none'') or (c.c->>''mode'' = ''cycle'' and (c.c->>''open_calls'')::int = 0))\n                and (c.c->>''verified_at'' is null';
  n text;
begin
  if md5(o) <> '41bad1377046702c5a69429c12ce5982' then
    raise exception 'grants.discovery_brief() is not the pre-027 definition (md5 %)', md5(o);
  end if;
  if (length(o) - length(replace(o, a, ''))) / length(a) <> 1 then
    raise exception 'grants.discovery_brief(): the 027 anchor must occur exactly once';
  end if;
  n := replace(o, a, b);
  if md5(n) <> '88210804c0d6625d5458f277f996f227' then
    raise exception 'patched grants.discovery_brief() differs from the tested text (md5 %)', md5(n);
  end if;
  execute n;
  if md5(pg_get_functiondef('grants.discovery_brief()'::regprocedure)) <> '88210804c0d6625d5458f277f996f227' then
    raise exception 'stored grants.discovery_brief() differs from the tested text';
  end if;
end $m027a$;

do $m027b$
declare
  o constant text := pg_get_functiondef('grants.set_collection(uuid,jsonb,text)'::regprocedure);
  a constant text := E'  if v_cfg ? ''auto_vet'' and jsonb_typeof(v_cfg->''auto_vet'') <> ''boolean'' then raise exception ''auto_vet must be true or false''; end if;\n';
  b constant text := E'  if v_cfg ? ''auto_vet'' and jsonb_typeof(v_cfg->''auto_vet'') <> ''boolean'' then raise exception ''auto_vet must be true or false''; end if;\n  -- 027: a verified page watch must name its blocker, also when a note-only edit keeps it verified\n  if (coalesce((p->>''verified'')::boolean, false)\n      or (f.collect_verified_at is not null and v_adapter = f.adapter and v_cfg = f.adapter_config and v_url = f.url and v_feed is not distinct from f.feed_url))\n     and grants.collect_mode(v_adapter, v_cfg) = ''page''\n     and coalesce(v_note, '''') !~* ''(js_only|bot_protected|login_required|no_listing_anywhere)'' then\n    raise exception ''page watch needs a blocker (js_only, bot_protected, login_required, no_listing_anywhere) in the note'';\n  end if;\n';
  n text;
begin
  if md5(o) <> '21059cc6b7bf9117e713de303ad3c5ea' then
    raise exception 'grants.set_collection(uuid,jsonb,text) is not the pre-027 definition (md5 %)', md5(o);
  end if;
  if (length(o) - length(replace(o, a, ''))) / length(a) <> 1 then
    raise exception 'grants.set_collection(uuid,jsonb,text): the 027 anchor must occur exactly once';
  end if;
  n := replace(o, a, b);
  if md5(n) <> 'ff9aadcfc817b196598bc4646ede13d6' then
    raise exception 'patched grants.set_collection(uuid,jsonb,text) differs from the tested text (md5 %)', md5(n);
  end if;
  execute n;
  if md5(pg_get_functiondef('grants.set_collection(uuid,jsonb,text)'::regprocedure)) <> 'ff9aadcfc817b196598bc4646ede13d6' then
    raise exception 'stored grants.set_collection(uuid,jsonb,text) differs from the tested text';
  end if;
end $m027b$;
