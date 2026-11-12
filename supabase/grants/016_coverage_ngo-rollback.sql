-- Rollback for 016: restores coverage_min exactly as it was on 2026-11-12.
update grants.settings
   set value = '{"intl_dev":12,"us_federal":12,"foundation_ngo":12,"private_sector":8,"state_regional":8}'::jsonb
 where key = 'coverage_min';
