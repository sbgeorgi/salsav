-- Rollback for audit-2026-11-20-archive.sql: each row back to the status it had on 2026-11-20.
update grants.opportunities set status='open' where funder_id='00c5697a-eb43-4349-a81b-d0f8bb9ad2d2'::uuid and external_id='cycle:2027' and status='archived';
update grants.opportunities set status='open' where funder_id='b818abe6-897e-4c5c-b902-382c32a77c3a'::uuid and external_id='cycle:2027' and status='archived';
update grants.opportunities set status='closed' where funder_id='c7adf093-ce2d-4e2c-a2bc-297dac569e8e'::uuid and external_id='cycle:2026' and status='archived';
update grants.opportunities set status='open' where funder_id='2aa89020-1edc-4ddc-bec9-e9ef304305cb'::uuid and external_id='concept-2026-12' and status='archived';
