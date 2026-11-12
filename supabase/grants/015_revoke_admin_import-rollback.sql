-- Rollback for 015_revoke_admin_import: restores the previous grants exactly.
-- Do not run unless a token-gated bulk import is needed again; it re-exposes a SECURITY DEFINER function to the API.
grant execute on function public.grants_admin_import(text, text, jsonb) to public, anon, authenticated;
