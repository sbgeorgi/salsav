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

- 021 candidate_calls live (20261112163023), DO-block tested (feed 23 -> 62, 39 candidates; reject drops one, repeat is unchanged); anon/authenticated cannot run reject_opportunity. Drawer shows "Unverified" chip (checked in preview on Colorado Water Plan). discovery-task step 6(a): nearest deadline first, enrich from call page, reject_opportunity for out-of-scope.

## Current state
Probe + triage complete; collected calls now show on the radar at once as Unverified; committed.

## Next step
Check Friday 2026-11-13 07:00 discovery run (first with COLLECTION e production probes, 961d056): each new funder applied unverified, probed via probe_refresh in serial batches, verified only on a match with adapter_check; summary lists probe numbers; ~30 more candidates resolved (39 left); confirmed calls enriched (apply_url/award, Colorado was thin); PushNotification sent.

## Discovery pass 2 (2026-11-12, scheduled)
Reverified 6 kept; 3 collection gaps unchanged (UAE TLS chain -> engine per-host CA fix would be needed; EPRI js_only; Gulbenkian 403 datacenter). Candidates: 2 confirmed, 27 rejected, AFRI Education/Workforce (1da45bda) left as candidate (borderline, workforce in scope). Listed FEMSA 9f186bfc, Mosaic b280a1b5, NADBank f2dcd774, NextEnergy db43b41c (all verified auto); Grundfos rejected 31. private_sector gap 7 -> 4. 12 candidates remain.

## Discovery pass 3 (2026-11-13, scheduled)
Reverified 6 kept (NSF CBET 57->62). Listed AgMission 5dfae4ae (71), AXA 3d460ce6 (65), NMED/OSE 029fc6a2 (58), AZ Dept Agriculture 67030526 (49, page watch: site 403 + eCivis robots-blocked); rejected Cargill+GWC, Anglo American Fdn, Bayer Fdn by gates. EPRI 278cceed now calls via apim.epri.com GraphQL (University RFP page is item 12 of 147; engine caps raw at 100). Probes 141/142 all ok, verified. Candidates: 1 confirmed, 10 rejected, NAWI InfoReady (JS-only) left. Gaps left: UAE (proposed engine fix: Deno.createHttpClient caCerts with GlobalSign RSA OV SSL CA 2018 for uaerep.ae; untested on edge runtime), Gulbenkian (403 datacenter). private_sector gap 4 -> 2.
Pending: reverify_source quotes from subpages never flip evidence_ok (DB checks only the registered url's crawled copy) — consider letting evidence carry its own url check.
