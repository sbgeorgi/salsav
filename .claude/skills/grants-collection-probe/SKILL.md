---
name: grants-collection-probe
description: "Use when checking whether vetted funders' auto-refresh collection really returns opportunities, probing the live grants-refresh edge function per funder with a dry run."
category: funding-discovery
status: active
author: reflect
created: 2026-11-12
---
Directive: prove each auto-refresh funder returns calls with a live dry-run probe through pg_net; the stored last_ok_at alone does not prove collection.
Steps:
- Write the probe helpers (grants.probe_refresh and grants.probe_result) as a NAME.sql file plus a NAME-rollback.sql before applying them.
- After apply_migration, check has_function_privilege is false for anon and authenticated on both helpers.
- Deploy the engine version that reports per-funder opps, open and text_len before probing, so the probe shows counts.
- Group funders by host (grants.gov and EU F&T each as one group), batches of at most 5 html funders (API/feed-only batches up to 15), at most 50 ids per call: on v10+ a dry run fetches every page in full, and 10 html pages in one invocation hit "CPU Time exceeded" even alone (2026-11-12).
- Fire one batch at a time and wait for its result before the next: concurrent probe requests land in one edge worker and a single "CPU Time exceeded" kills all of them (HTTP 546 WORKER_RESOURCE_LIMIT, 2026-11-12).
- Call probe_refresh with the batch array, then read probe_result with the returned request id; it reports pending until pg_net finishes.
- Count a funder as returning: calls and cycle modes need at least 1 opportunity; page mode needs text_len of at least 300.
- A calls funder with opps 0 but raw > 0 is a working watch whose filter matched nothing yet (the call is not posted); raw 0 means the channel itself listed nothing: test it with the filter removed before calling it broken.
- A result missing from body.results was cut by the run budget: re-probe those ids alone.
Pitfalls:
- Saved execute_sql output is a JSON wrapper with a result string: parse the outer JSON, then the inner array; do not regex it.
- A dry run writes only the run record, so it cannot change snapshots, leases or deadlines.
- In execute_sql, remove a key from a jsonb value with a typed literal, as in (r#>'{body,stats}') - 'hosts'::text; a bare literal fails with an operator-not-unique error.
- Before engine v10 a dry run sent the stored ETag and got 304 not_modified, which hides extraction; v10+ drops validators on dry runs.
