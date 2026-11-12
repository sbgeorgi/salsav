-- Live-endpoint adapters found by tools/endpoint_recon.py (verified by plain replay, 2026-11-11).
-- Packard: WordPress custom post type 'funding-opportunity' (real RFP/LOI items). EU topic: SEDIA search API by identifier.
update grants.funders set adapter = 'json_api',
  adapter_config = '{"url":"https://www.packard.org/wp-json/wp/v2/funding-opportunity?per_page=20&_fields=id,link,title,excerpt,date","method":"GET","items_path":"","map":{"title":"title.rendered","url":"link","description":"excerpt.rendered","external_id":"id"}}'::jsonb,
  next_check_at = now()
where status = 'vetted' and name = 'David and Lucile Packard Foundation' and program = 'Funding opportunities (RFP page)';

update grants.funders set adapter = 'eu_ft',
  adapter_config = '{"query":{"terms":{"identifier":["HORIZON-CL6-2027-02-FARM2FORK-02-two-stage"]}}}'::jsonb,
  next_check_at = now()
where status = 'vetted' and name like 'European Commission (Horizon Europe, Cluster 6%' and url like '%HORIZON-CL6-2027-02-FARM2FORK-02-two-stage';
