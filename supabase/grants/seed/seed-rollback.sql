-- Rollback for the 2026-11-11 seed import (115 funders via grants.register_source).
-- Funders cascade their snapshots/diffs; discovery_log rows are removed by run label if tagged, else by lens.
delete from grants.discovery_log where lens = 'seed';
delete from grants.funders where discovered_via = 'seed';
