-- rollback for 029_add_lead.sql: both functions are new, so rollback drops them.
-- Leads the team added stay in grants.targets (source = 'team').
drop function if exists public.grants_add_lead(text, jsonb);
drop function if exists grants.add_lead(text, text, text, text, text, text);
