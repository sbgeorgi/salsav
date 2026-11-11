alter table grants.opportunities alter column external_id drop not null;
update grants.settings set value = to_jsonb(8) where key = 'lockout_failures';
update grants.settings set value = to_jsonb(15) where key = 'lockout_minutes';
