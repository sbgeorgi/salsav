-- Rollback for 001/002/003. Removes ONLY objects created by this feature. Does not touch any other AVS schema.
-- Run in reverse order: 003 (cron + vault secret), then 002, then 001.
drop function if exists public.grants_feed();
drop function if exists public.grants_check_pass(text);
drop function if exists public.grants_set_state(text, uuid, jsonb);
drop function if exists public.grants_team_notes(text);
drop schema if exists grants cascade;
