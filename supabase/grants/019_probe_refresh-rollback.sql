-- rollback 019: the probe helpers did not exist before.
drop function if exists grants.probe_result(bigint);
drop function if exists grants.probe_refresh(uuid[]);
