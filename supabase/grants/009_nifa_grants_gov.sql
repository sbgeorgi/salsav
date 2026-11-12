-- NIFA's own site resets/times out requests from the edge function's egress (HTTP/2 stream error, then HTTP/1.1 timeout).
-- The same RFAs are posted on Grants.gov (search2, no key, exact oppNum match verified 2026-11-12), so read them there.
-- SCRI has no open Grants.gov posting right now: left on html (still failing), tracked as no-live-coverage.
update grants.funders set adapter = 'grants_gov', adapter_config = '{"oppNum":"USDA-NIFA-AFRI-011134","oppStatuses":"forecasted|posted","rows":10}'::jsonb, next_check_at = now(), cooldown_until = null
where status = 'vetted' and name = 'USDA NIFA' and program like 'Agriculture and Food Research Initiative (AFRI), Foundational%';

update grants.funders set adapter = 'grants_gov', adapter_config = '{"oppNum":"USDA-NIFA-HSI-011903","oppStatuses":"forecasted|posted","rows":10}'::jsonb, next_check_at = now(), cooldown_until = null
where status = 'vetted' and name = 'USDA NIFA' and program like 'Hispanic-Serving Institutions Education Grants Program%';
