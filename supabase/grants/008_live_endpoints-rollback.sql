-- Restores the pre-008 state (adapter html, no adapter_config) for the two rows.
update grants.funders set adapter = 'html', adapter_config = '{}'::jsonb
where status = 'vetted' and name = 'David and Lucile Packard Foundation' and program = 'Funding opportunities (RFP page)';
update grants.funders set adapter = 'html', adapter_config = '{}'::jsonb
where status = 'vetted' and name like 'European Commission (Horizon Europe, Cluster 6%' and url like '%HORIZON-CL6-2027-02-FARM2FORK-02-two-stage';
