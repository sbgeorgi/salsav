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

## Pass 2 2026-11-20 (label discovery-2026-11-20, new RUN TARGET 5 listed)
Health ok (0 overdue shards, 0 stuck runs, last_refresh ok). Brief: promoted 0, targets 0, bucket gaps all 0, failing/gaps = Gulbenkian (datacenter 403) + UAE (datacenter_timeout), both channels exhausted, left unverified. Candidate call: DOE SBIR FY26 Phase II (folded into DOE SBIR reverify).
Workflow wf_91ae4a18-77a: reverify 6 (FtF Labs, Minciencias, NIFA SBIR, DOE SBIR, ABOR, CDA agrivoltaics), backfill Kresge + AZ Community Fdn (CORAF/EAC/CFL already judged non-funders this morning; Climate Funds Update, SAM.gov API, UKRI GtR are non-funders: left unscored), 6 lead finders -> vet agents, up to 3 rounds.
Result: 7 new listed + verified in production (probes 344, 345, all kind ok, numbers equal adapter_check): CARB bfcb6aec, Belmont 06bb79fe, AGRA bebc284e, CDFA FREP 077388b0, KKL-JNF f4a81d21, NM EMNRD 4a1ec054, Wellcome 8a97aa07 (cycle). Demoted as dupes check_known missed: NYSERDA e3a4dea5 (->eb906c5c), IDRC 4af6c750 (->0fe468ef), NOAA CPO 54f1d698 (->6df99f2d); their cfg files deleted. Colorado Dept Ag demoted (final year, max 150k). NIFA SBIR cfg min_items 0 + zero_reason. DOE SBIR FY26 Phase II placeholder rejected. 13 targets queued (priority 2/3). Run logged finished.
## Next step
check_known misses reordered names ("NYSERDA (New York ...)" vs "New York ... (NYSERDA)"; "IDRC (...)" vs "International ... (IDRC)"): vet agents should also grep grants.funders by acronym before registering. Work the 13 queued targets next run.

## Pass 6 (2026-11-24, discovery-2026-11-24) - scheduled run
Start: crawler healthy (0 overdue shards, 0 stuck runs; last_refresh ok). Brief: promoted 0, marks follow/ignore empty, all bucket gaps 0, 13 targets (8 p2, 5 p3), reverify 20 (doing first 6, no human locks), backfill 8, gaps 5 (Gulbenkian failing x7, BARD x2/AGRA/BSF thin), 16 candidate calls (saved candidates-2026-11-24.json).
Workflow wf_8b534455-d15 running (script inlines the work list). After it: probes (<=5 html/batch), apply REAPPLY_VERIFIED triage, reject_opportunity recommendations, verify, finish log, commit cfg + push, notify.
Wave 1 done (33 agents): new rows listed WE4F 15594c63, AFD AdaptAction 57c68b7d, WIFA WSDF c1b5ef29, BARD Aquaculture & Desert Farming aae3bb51, AECF e9d7b91c (all probe 496/497 ok, verified); Japan Climate Fund 8d873831 listed but collection unapplied (js_only); LCCMR f11c56d0 registered by main (fit 47). BARD 175558a2 filter now excludes Aquaculture (owned by aae3bb51), reprobed ok. 8 candidate calls rejected. Gates Family award restored (subagent cleared it). Reapplied verified: cad6a9e4, 27cd8a3f. Wave 2 wf_ff35be7d-20e running (LCCMR + Japan CF collection, discovery rounds 2-4 for new orgs).
Wave 2 done (17 agents): new orgs listed Sida 5445aed5 (42), CA DWR SGM 49c38811 (46), NRF Kenya 830351ce (46, rss), NWO NL-CGIAR b237784b (71), FoodShot Global 7e19d300 (68), Future Drought Fund fe8ca080 (56); rejected GCA (not_a_funder), Danida (fit 36); AZ Water Protection Fund unscored (azwpf.gov 403). Probe 501 (Sida, DWR, NWO, FoodShot, LCCMR) all ok -> verified. Probe 502 (FDF, NRF, Japan CF) pending at 14:02 UTC. deploy_gate ok (all cfg valid), no engine change. metrics vetted 112 -> 124.
Finish: probe 502 Japan CF + NRF ok -> verified; Future Drought Fund timed out in production (unverified, note set). Targets AWF + NASA deferred by main. Run logged finished. Next run: Gulbenkian still blocked; SEFA stored reason stale (fund at full capacity); NYSERDA amount_confidence went unknown on reverify; AFD award EUR 160k may be under the 200k USD gate (not sendable as USD); FDF needs another channel; engine_gaps: Wix parse window >600k chars (public.or.jp), sitemap routes.

## Pass 7 (2026-11-27, discovery-2026-11-27) - scheduled run
Start: crawler healthy (0 overdue shards, 0 stuck runs; last_refresh 13:09 UTC ok, 0 errors). Brief: promoted 0, marks follow/ignore empty, all bucket gaps 0 (mins raised: private 15, foundation 30), 1 target (SOR4D, p2), reverify 20 (doing first 6), backfill 8 (5 are known non-funders left unscored: EAC, CPI Lab, Climate Funds Update, SAM.gov API, UKRI GtR; scoring Kendeda, CIF, IDB Lab), failing 3 (Gulbenkian x9, Future Drought Fund x7, Global EbA Fund x3 new), 10 candidate calls (7 Grants.gov XML, 3 AECF).
Workflow wf_3e6eb066-691 running (script scratchpad discovery.js). After it: probes (<=5 html/batch), mark verified, reject_opportunity recommendations, verify, finish log, commit cfg + push, notify.
Result: 14 new listed + verified in production (probes 598 api/feed, 600 + 601 html; all kind ok, numbers equal adapter_check): R2I2 6c007abb, NIFA AFRI SAS 67a19714, Reclamation CRB Tribal 7a87316b, Drought Response 9085e699, BIA TCR d753310c (cycle), DOE workforce e802117b, NM ECAM Solar 24f15adc, Energy Catalyst dfa0dd9c (rss), Agri-Tech Catalyst 40f3ffa8, SFA Fdn 8aaa137a (rss), DAFM US-Ireland 665cd5eb (cycle), MBZ Al Miyah 132edf10, XPRIZE Water Scarcity 36399836, QRDI 9ae6aabb (page, js_only). All configs min_items 0 + zero_reason. Rejected 5 (SOR4D ended, 4 fit gate), 1 dup (Thomas R. Brown), hidden candidates IFAD 4caf67fd (403), Innovate UK CSA 961b6647 (timeout), ARPA-E OPEN 377d1a6f (js). Targets added: CA DOC MLRP (p2), SECIHTI (p3). Global EbA c7adf093 re-pointed to /news/ (old call pages 404), verified. 5 candidate calls rejected, 4 confirmed (under Grants.gov aggregator row 773f2175), AECF LESSAP II left. Run logged finished.
## Next step
Gulbenkian + FDF still unverified (no plain-HTTP route). CIF / IDB Lab reject_reasons stale after rescoring (42 each, pass gates). NSF DISES concluded after FY2024: consider demote. Workflow note: harness wrapper strips a `status` field from agent schemas, so count listings from the DB, not the agent return.
