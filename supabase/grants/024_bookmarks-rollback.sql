-- 024_bookmarks-rollback.sql
-- Undoes 024_bookmarks.sql. Run in the Supabase dashboard SQL editor: step 2 drops objects and data,
-- which the SQL connector declines.
--
-- Step 1 puts grants.discovery_brief() back to the exact definition that was live before 024
-- (md5 of pg_get_functiondef = 730db8d4439ec1642f49b2be8613e0b9, 5217 characters, read 2026-11-20).
-- It removes the one key 024 added and refuses to run unless the result has that md5.

do $unpatch$
declare
  v_now  text := pg_get_functiondef('grants.discovery_brief()'::regprocedure);
  v_from text := $a$x.rn <= 8), '[]'::jsonb), 'marks', grants.marks_brief())$a$;
  v_to   text := $a$x.rn <= 8), '[]'::jsonb))$a$;
  v_old  text;
begin
  v_old := replace(v_now, v_from, v_to);
  if md5(v_old) <> '730db8d4439ec1642f49b2be8613e0b9' then
    raise exception '024 rollback: result is not the pre-024 grants.discovery_brief() (md5 %)', md5(v_old);
  end if;
  execute v_old;
end $unpatch$;

-- Step 2: remove the bookmark objects. This deletes every bookmark and definition.
drop function if exists public.grants_mark(text, jsonb);
drop function if exists public.grants_marks(text);
drop function if exists grants.human_mark(jsonb);
drop function if exists grants.marks_brief();
drop function if exists grants.marks_payload(boolean);
drop table if exists grants.item_marks;
drop table if exists grants.marks;

notify pgrst, 'reload schema';

-- Read-only check afterwards (expect: 730db8d4439ec1642f49b2be8613e0b9, null, null):
-- select md5(pg_get_functiondef('grants.discovery_brief()'::regprocedure)), to_regclass('grants.marks'), to_regclass('grants.item_marks');
