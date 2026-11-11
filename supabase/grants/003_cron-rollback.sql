-- Rollback for 003_cron.sql
select cron.unschedule(jobname) from cron.job where jobname like 'grants-%';
delete from vault.secrets where name = 'grants_refresh_token';
-- pg_cron / pg_net extensions are left installed (other features may use them); drop manually if you added them only for this:
-- drop extension if exists pg_cron; drop extension if exists pg_net;
