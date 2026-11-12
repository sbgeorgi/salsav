## Goal
Funding radar v2 (user: "elevate everything, full ownership"). TOP PRIORITY (user): the edge function must collect future calls from every listed funder with no agent in the loop. User 2026-11-12: merge the adjacent session's probe findings (supabase/grants/probe/results/) with mine and proceed. Also: deadline horizon stays on the main Radar page. Branch funding-radar-v2. No push, no merge to main.

## Files touched
- SQL: supabase/grants/010_radar_v2.sql (+rollback), 011_collection.sql (+rollback, live 011a 20261112012010 / 011b 20261112012043), rubric_v2.json.
- Edge function supabase/functions/grants-refresh/* (mine now). Pre-change copy: old scratchpad edge_v3_backup/.
- Collection: .claude/runs/radar-v2/COLLECT.md (contract), GAPS.md (gap table + per-funder actions), API.md (agent SQL reference); supabase/grants/collect/cfg/<id8>.json (34); supabase/grants/tools/adapter_check.mjs.
- Agent instructions: supabase/grants/discovery-task.md (v2 prompt, NOT yet applied to the scheduled task), .claude/skills/funding-source-vetting/SKILL.md (v2 written). Both point at supabase/grants/API.md and COLLECT.md: MOVE those two files there before wrap-up.
- UI: dashboard.html/.js/.css, dash/* (horizon.js, collection in drawer/method/insights), dashboard.fixture.json.
- Scratchpads: new C:/Users/georg/AppData/Local/Temp/claude/f76d9bc5f4d34b7f/747f15c5-6fb1-437f-8b99-adcbf92d60a1/scratchpad (cfg_table.py: table | detail ID8 | import [--dry]; gaps.json; gaps_dump.py); old .../9d7bc58d829be3ff/747f15c5-.../scratchpad (import_v2.py, import_token.txt, mk_repo_sql.py, edge_v3_backup/).

## Done (each with its check)
- Radar v2 DB live (008a..008e); migration 011 live. Check: self-checks, advisors clean for grants.
- UI: horizon on Radar, "Collected automatically" KPI, drawer collect block, Method section 7, Insights block. Check: node dashboard.test.mjs 38, dash/viz.test.mjs 20, dash/collection.test.mjs 8; browser on fixture at 1440/900/780 (KPI grid 4 cols under 1100px, Method table wraps by word).
- Engine gap round reviewed and fixed (ReDoS guard, same-host redirects, detail date rule, date_order, exact es/fr month words, cycle id per year, --items in harness). Check: 158 tests pass. API.md and COLLECT.md now live in supabase/grants/.
- Duplicates demoted live (012_duplicate_rows.sql + rollback): 7bd9bd74, 7584f360, d9a3a59e, 1cbc1a63. Listed 34 -> 30.
- Gap analysis (workflow wf_f2409742-b54): 25 keep, 5 needs_engine_gap, 2 downgrade_honest, 1 upgrade_config, 1 fix_url. Build stage implemented deadline_regex, list.detail, es/fr months, Grants.gov 2070+ sentinel (unit tests + live proofs).

- Workflow C (wf_a2d01a63-76b, cut off by app quit) recovered from its journal into <new scratchpad>/wfc_results.json: engine agent 168/168 tests but its text-cutting safeguard returned wrong dates (attack:long-input); 12 of 15 configs pass their skeptic; open: ad3bfbe8, db669dcf (fail), 0d2a2781 (skeptic not run).

- Workflow D (wf_87dcf8d4-f7e) done, results in <new scratchpad>/wfd_results.json: safe_regex.ts (explicit-stack VM, 10M-step budget per source, 36k-pair fuzz equal to native); integrated (boundText/REGEX_LINE removed, budget error -> 'config pattern too slow on this page', pickHops day rotation); 2 refix rounds also hardened extractPage/findAmount/VOLATILE_PHRASE/contextScope/deep nesting (PageWorkError -> 'page too heavy to scan'). Tests 195/195. Harness --all: 29/30 same as recorded, 061b878e open 4->3 = rotation (expected). Configs 0d2a2781, ad3bfbe8 (16 topics), db669dcf (NOI excluded) pass skeptics. 011_collection_data.sql + rollback written (dry run, 30 rows, all verified).

## Decisions
- Subagents never write to the DB or deploy; main writes through public.grants_admin_import (TEMPORARY; MUST be dropped before wrap-up).
- No new adapter names; engine gaps are optional config keys.
- Wave 2 vetting of the 54 queued targets goes to the rewritten scheduled task.
- Duplicate rows judged (read-only agent, 2026-11-12): DROP 7bd9bd74 (keep AFRI 0d2a2781), DROP 7584f360 (keep NSF 26-518 e0c23608), DROP d9a3a59e (keep W-SARE 66282c14), DROP 1cbc1a63 (keep McKnight 4417a7e2; fold "invitation-only, formerly CCRP" into its note). BARD 175558a2/cad6a9e4 are DISTINCT: cad6a9e4 gets filter any ["Accelerator"] on title, 175558a2 gets filter none ["Accelerator"]. Demote the 4 via grants.reverify_source (verdict demote, reversible) and move their cfg files to supabase/grants/collect/dropped/ so import skips them. Listed count 34 -> 30.
- 773f2175 Grants.gov XML extract is bucket tracker (fetch source, not a funder): no config needed.
- DOE eXCHANGE filter: widen to SALSAV scope with auto_vet false.
- Horizon 13 -> 5 explained to the user (4 delisted by fit gates, 1 AFRI duplicate date, 3 dates cleared; BSF 2027-04-07 restored via 013_restore_bsf_deadline.sql, live). Check: grants.vet_events + funders.
- Workflow B (wf_75f79a77-cdc) done: 15 pass, 15 fail; verdicts in <new scratchpad>/verdicts_b.json. Deploy review: fix_first (findings in <new scratchpad>/review2/findings.txt).
- Migration 014 live (version 20261112023503): html sources keep a stored deadline when a call arrives undated; past stored deadline stays closed. Check: DO dry run (h1-h4, g1, reverse_equal all true), anon/authenticated no execute.

## Pending
1. Worker (review fixes, running): (a) detail-hop dates must not enter hashed/diffed text (daily churn); (b) listing fetched without conditional headers when list.detail set (304 stalled rotation); (c) refuse ':has(' and '~' in config selectors. On return: rerun the 5-file test command (195+), check diff.
2. Deploy grants-refresh ONCE (deploy_edge_function, name grants-refresh, entrypoint index.ts, import_map_path deno.json, verify_jwt false, ALL deployed files read into main right before: 18 + safe_regex.ts). Then `python cfg_table.py import` (scratchpad), kick_refresh('collect-verify', 1, 100000), verify per funder; promote EU FARM2FORK-02 item to vetted once.
3. update_scheduled_task salsav-funding-discovery with supabase/grants/discovery-task.md; new description.
4. Live browser check (preview 8765 running, serverId 1f121a5f-ae21-49f6-a698-2d1e786dc8ee: stop at the end).
5. Drop public.grants_admin_import, secret scan, /verify, commit on the work branch.
Accepted residual risks (report under Found): crafted-markup parser slowness (assertShallow bypass, selector cost near nesting limit); detail.closed status not remembered between runs (no config uses it); 'mars'/'mai' month words; detail cap 1 visits only the first call.

## Errors & fixes
- execute_sql declines DO blocks with DDL/bulk updates: dry runs go through apply_migration ending in RAISE EXCEPTION.
- Gap agent did not write GAPS.md (agent rule against report files): generated from the workflow journal with gaps_dump.py.
- upsert_opportunity overwrites every field on conflict: the task prompt tells the agent to resend all values.

## Current state
grants-refresh live = version 6 (disk equal except extract.ts \u escapes written literally). EU eu_ft fixed (Deno failed reading the gzip body: Accept-Encoding identity + cause chain in errors): HTTP 200, 16 candidate calls; FARM2FORK-02 promoted to vetted, horizon 6 -> 7 vetted future calls, dashboard shows 8 open calls, 23 of 30 collected automatically (browser check on live feed 2026-11-12, no console errors). public.grants_admin_import: DROP declined by the server, execute revoked from public/anon/authenticated (live 20261112061124); 015_drop_admin_import.sql is for the dashboard SQL editor. Tests 198 + 38 + 20 + 8 pass. Secret scan: 4 classified false positives; grants.gov fixture token redacted.

## Next step
Commit on funding-radar-v2 (exclude pages.json, .claude/launch.json). User: run 015_drop_admin_import.sql in the SQL editor; push when ready.
