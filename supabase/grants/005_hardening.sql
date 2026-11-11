-- Review fixes (2026-11-11).
-- 1) NULL external_id would duplicate opportunities on every run (unique key does not dedupe NULLs).
alter table grants.opportunities alter column external_id set not null;
-- 2) Passcode lockout is global (no client identity in an anon RPC), so 8 bad tries/15 min let anyone lock the team out.
--    The passcode is a 12-char random string behind bcrypt, so brute force is already infeasible; widen the window to 40/10 min.
update grants.settings set value = to_jsonb(40) where key = 'lockout_failures';
update grants.settings set value = to_jsonb(10) where key = 'lockout_minutes';
