## Goal
Self-improving SALSAV funding radar. Scheduled discovery passes (supabase/grants/discovery-task.md) keep the funder list true, collectable by the grants-refresh crawler, and growing where coverage is thin. Current pass: discovery-2026-11-16.

## Files touched
- Earlier: grants-refresh engine.ts/types.ts/adapters/index.ts (v10 probe report) + tests/engine.test.ts; SQL 019_probe_refresh, 020_idle_backoff, 021_candidate_calls (+rollbacks); discovery-task.md; .claude/skills/grants-collection-probe/SKILL.md.
- 2026-11-16 (uncommitted): supabase/functions/grants-refresh/handler.ts (background runs), tests/collect.test.ts (new handler test), tests/adapters-handler.test.ts (wait:true on 3 posts); .deploy-ok.json stamp; cfg files written by discovery subagents (supabase/grants/collect/cfg/*.json).

## Done
- 019/020/021 live and DO-block tested; v10 deployed (6e3fabf). Full v10 probe 2026-11-12: 43 proven, 27 working watch, 6 page, 2 blocked (UAE TLS chain, Gulbenkian 403), 16 correct-empty, McKnight/BIRD regex fixed.
- Pass 2 (11-12): 6 reverified kept; listed FEMSA 9f186bfc, Mosaic b280a1b5, NADBank f2dcd774, NextEnergy db43b41c; Grundfos rejected 31; private_sector gap 7 -> 4.
- Pass 3 (11-13): 6 reverified kept; listed AgMission 5dfae4ae (71), AXA 3d460ce6 (65), NMED/OSE 029fc6a2 (58), AZ Dept Agriculture 67030526 (49, page watch); rejected Cargill+GWC, Anglo American Fdn, Bayer Fdn; EPRI 278cceed via GraphQL; probes 141/142 ok; private_sector gap 4 -> 2.
- Pass 4 (11-16) so far: run logged; brief read (reverify 20, collection_gaps 14, failing 2, targets 0, candidate calls 1 = NAWI). Engine bug found and fixed locally: new test fails before / passes after; deploy gate ok (19 files). Probe 191 (8 stale grants_gov funders, dry run) all kind ok, 94 s.

## Decisions
- Backoff in SQL apply_fetch_result (idle_streak), cap 46h. Probe batches of 5 html funders (546 CPU kill above that).
- 2026-11-16 engine fix: non-dry runs answer 202 and finish in EdgeRuntime.waitUntil (the background task owns and closes the sql connection); dry_run and body {wait:true} stay synchronous. Reason: kick_refresh's pg_net timeout is 5 s and SQL changes are out of scope for discovery runs; every cron run that finished took <=13 s while runs called with long timeouts finished at up to 92 s.
- Gulbenkian/UAE got one more channel attempt this pass (different host); else they stay unverified with the blocker named.

## Pending
- Workflow wf_f7a3741d-e7b (6 reverify, private_sector leads -> up to 8 vet agents, Gulbenkian, UAE, NAWI candidate) running.
- Deploy worker (grants-refresh v11 from stamp) running. After deploy: kick_refresh('discovery-2026-11-16-engine', 1, 100000) -> refresh_runs newest row finishes; at next cron (2026-11-17 01:00 UTC) check that all 8 shards finish and the 12 stale funders (last_ok 11-12) get last_ok_at. On error: redeploy HEAD files (git show HEAD:<path>).
- Then: production probes (<=5 html per batch) for each set_collection applied this pass; verify passes; reject_opportunity for NAWI if recommended; verify counts; log_discovery_run finish; commit + push funding-radar-v2; PushNotification.
- Older: reverify_source quotes from subpages never flip evidence_ok; UAE per-host CA fix idea (Deno.createHttpClient caCerts) untested; low-yield candidates CCARDESA, Quadrature, Google water RFI.
- Postgres-backed tests (tests/adapters-handler.test.ts) not run: no scratch Postgres on localhost:54329.

## Errors & fixes
- Concurrent or >=10-source full probes -> 546 CPU kill. 020 alias clash -> e/op.
- 2026-11-13..16: 5-7 of 8 cron shards per run stuck 'running' (planned 0, never finished); 28 vetted funders overdue, 12 stale since 2026-11-12 with no failure recorded. Cause: request-bound work dropped after the 5 s pg_net caller hangs up. Fix: handler.ts background runs (above).
- Brief parsing: the untrusted-data tag also appears in the envelope preamble; match the tag followed by newline + '[' (scratchpad env.py).

## Pass 4 result (2026-11-16)
Listed SRP 6d1957f0 (58), Elemental Excelerator 269f191f (52), Swiss Re Foundation 5c3bddc1 (42), all probe 195 ok and verified; 5 rejected; NAWI call rejected; 6 reverified kept. My handler.ts background-run fix was reverted unused: the crawler-health-2026-11-16 session proved with edge logs that 8 concurrent shards hit 546 CPU, and fixed it with SQL 022 (fc51fb3). The deploy never landed (production still v10).

## Next step
After 2026-11-17 01:00 UTC: check refresh_runs (all staggered kicks ok) and that the 12 funders stale since 11-12 have a fresh last_ok_at. Elemental filter matches press releases (word 'initiative'); tighten it if they pile up as candidates.

## Pass 5 result (2026-11-17, discovery-2026-11-17)
Crawler healthy (0 overdue shards, 0 stuck runs; staggered-kick fix holds). Reverified 6 kept (Frontiers 71, Gulbenkian 59, Bergfors 66, Keck 55 due 12-07, Greenacres 71 due 2027-04-26, Eni 54). Targets: California Forever, MN8, OCP all rejected not_a_funder (one-off gifts / 2021 MoU); queue empty. All bucket gaps 0, so no gap discovery. Elemental filter tightened (press release rejected), probe 244 ok -> verified. BARD re-verified (listing ok, round closed). Unverified: Gulbenkian (Cloudflare 403 in prod on every gulbenkian.pt path; no other official host), UAE (TLS chain; now cycle mode unverified).

## Next step
Gulbenkian/UAE need an engine-side fix to become collectable (UAE: Deno.createHttpClient caCerts with the missing intermediate; Gulbenkian: none known). Targets queue empty and gaps 0: next pass should re-verify the next 6 in the brief and consider raising bucket minimums or seeding targets.

## Pass 6 (2026-11-20, discovery-2026-11-20) - in progress
Brief: promoted 0, targets 0, all bucket gaps 0 (no gap discovery), crawler healthy (0 overdue shards, 0 stuck runs; last_refresh ok). Failing/gaps: Gulbenkian (Cloudflare 403 prod), UAE (TLS chain) unchanged.
Workflow wf_aedd5d51-23b: reverify 6 (CFHF, Shell Fdn, NSF IUCRC, NRCS CIG, OPEC Fund, Allen), backfill 8, 4 candidate calls, UAE TLS engine-fix investigation (no deploy).
Result: 6 reverified kept; 5 backfilled (stay rejected; Minciencias 53 48, SEFA 46, AFD 42, GIZ 42 pass gates but keep stale reject_reasons), 3 left unscored (non-funders: Climate Finance Lab, CORAF, EAC). Rejected 3 out-of-scope candidate calls; DOE SBIR FY26 Phase II placeholder left as candidate.
Engine v11 deployed (extra_ca.ts: GlobalSign RSA OV SSL CA 2018 for uaerep.ae/rain.ae hosts). UAE probe 341: TLS error gone, now "request timed out" (0 bytes) -> unverified, note datacenter_timeout. Regression probe 343 ok (NRCS, Allen, OPEC). Run logged finished.
## Next step
UAE: check whether the cron's next run still times out; if so the host likely drops datacenter traffic (no fix known). Decide whether to re-list gate-passing rejected rows (Minciencias 53, SEFA, AFD, GIZ) or correct the 3 non-funder reject reasons.
