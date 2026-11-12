## Goal
Self-improving SALSAV funding radar. This phase: prove every auto (calls/cycle) funder extracts via the live edge function; fix broken configs; stop repeating empty fetches; explain missing completion notice.

## Files touched
grants-refresh engine.ts/types.ts/adapters/index.ts (v10: probe report opps/open/raw/text_len/sample; dry_run drops validators) + tests/engine.test.ts; 019_probe_refresh, 020_idle_backoff (+rollbacks); discovery-task.md (health 'empty' triage, final PushNotification); .claude/skills/grants-collection-probe/SKILL.md.

## Done
- 019 live (20261112153616); 020 live (20261112154724), DO-block tested (23h/46h/46h, reset 11.5h, health 'empty').
- v10 deployed; commit 6e3fabf pushed.
- Full v10 probe, 96 vetted funders, results in scratchpad/probe/v10.txt (requests 106-122): 43 proven (opps>0), 27 working watch (raw>0, filter matched nothing), 6 page mode, 2 error (UAE conn error, Gulbenkian 403), 18 raw=0.
- Production health 16:20: 89 auto (72 calls + 17 cycle), 88 ok in 24h, 0 overdue.

## Decisions
- Backoff in SQL apply_fetch_result (idle_streak), cap 46h.
- Probe batches of 5: 10-20 full fetches (no 304) in one invocation hit 546 CPU Time exceeded even alone.

- Triage of the 20 raw=0/error funders (5 sonnet workers, adapter_check evidence): 16 correct-empty, 2 regex fixed + applied verified (McKnight 4417a7e2, BIRD 9e33443a; re-probe 123 clean), 2 blocked (Gulbenkian 403 to datacenter IPs, UAE broken TLS chain) with collect_note set. Table: probe-2026-11-12.md.

## Pending
- Low-yield candidates for discovery to reconsider: CCARDESA (procurement only), Quadrature (invitation-only), Google water RFI (one-off).
- Gulbenkian / UAE need a non-edge path or manual tracking.

## Errors & fixes
- Concurrent or >=10-source full probes -> 546 CPU kill; 14:19 cron kick lost 4/8 shards (rows left 'running'); funders recovered next run via lease expiry.
- 020 alias `o` clashed with plpgsql var o -> aliases e/op.

## Current state
Probe + triage complete; committed.

## Next step
Next scheduled discovery run (Tue/Fri 07:00) should end with a PushNotification; check it did.
