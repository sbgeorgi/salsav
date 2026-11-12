update grants.funders set adapter = 'html', adapter_config = '{}'::jsonb
where status = 'vetted' and name = 'USDA NIFA' and (program like 'Agriculture and Food Research Initiative (AFRI), Foundational%' or program like 'Hispanic-Serving Institutions Education Grants Program%');
