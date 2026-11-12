-- For the Supabase dashboard SQL editor (the MCP server declined this DROP).
-- Removes the temporary radar v2 import helper. Since 015_revoke_admin_import no API role can call it, so this is cleanup only.
drop function if exists public.grants_admin_import(text, text, jsonb);

-- Verify (read-only): expect 0 rows.
select p.oid::regprocedure from pg_proc p join pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'public' and p.proname = 'grants_admin_import';
