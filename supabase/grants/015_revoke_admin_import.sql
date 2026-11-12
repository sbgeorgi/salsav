-- 015 (live as migration 20261112061124): close the temporary token-gated import helper used during the radar v2 build.
-- It is SECURITY DEFINER in the exposed public schema; nothing in the app calls it. The server declined DROP FUNCTION,
-- so API roles lose execute here and the drop is left for the dashboard SQL editor (015_drop_admin_import.sql).
revoke execute on function public.grants_admin_import(text, text, jsonb) from public, anon, authenticated;
