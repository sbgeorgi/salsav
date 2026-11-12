-- 016: steer scheduled discovery toward NGO, foundation and private-sector funders (user, 2026-11-12:
-- "this pool has very few ngo's Private foundations"). foundation_ngo 12 -> 30, private_sector 8 -> 15.
update grants.settings
   set value = jsonb_set(jsonb_set(value, '{foundation_ngo}', '30'), '{private_sector}', '15')
 where key = 'coverage_min';
