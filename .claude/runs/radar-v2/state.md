## Goal
Self-improving SALSAV funding radar: the scheduled task salsav-funding-discovery lists funders, gives each a tested collection config, fixes and deploys the grants-refresh engine, commits and pushes, with no human session.

## Files touched
supabase/grants/discovery-task.md (scheduled SKILL.md now points to it), 018_judgment_rejects{,-rollback}.sql, API.md, .claude/sql-api-funcs.txt, funding-source-vetting SKILL.md, grants-refresh adapters/index.ts + extract.ts + safe_regex.ts (no \u/\x escapes), tests/collect.test.ts, collect/cfg + audit json, supabase/grants/tools/deploy_gate.mjs (escape check), .gitignore; ~/.claude/hooks/boundary-guard.py + tests.

## Done
- 018 applied (20261112135341); live md5 = repo file.
- Guard: sql-api-funcs allowlist + stamped deploy; hook tests 36 OK.
- Revet workflow: judgment rejects re-scored; cfgs written per funder.
- Audit batches 6-7 re-applied with full uuids: 12 ok, 8 page->calls; leaf checksums match local payloads.
- Engine source escape-free; gate ok (19 files, 149484 bytes); gate regex self-check 7/7.

## Decisions
- Deploy only via MCP with deploy_gate stamp; gate rejects \u/\x escapes because retyped deploys turn them into literal characters (cause of the 2026-11-12 stamp mismatch).

## Pending
- Subagent deploy of grants-refresh (stamp path proof), get_edge_function version, kick_refresh.
- Commit + push funding-radar-v2.

## Errors & fixes
- apply_6/7 failed on 8-char ids cast to uuid (whole UNION aborted): rebuilt with full ids from cfg files.
- Deploy denied: \u escapes retyped as literals; source rewritten without escapes.

## Current state
Deploy worker running; nothing committed this phase.

## Next step
On deploy return: verify version, kick_refresh, commit all radar files (not pages.json, .claude/launch.json), push origin funding-radar-v2.

## Run discovery-2026-11-12 (scheduled)
- Reverified 6 (all kept): BARD 74, DOE eXCHANGE 41, GIF 61, GCF 57, Rockefeller 47, BIRD 60.
- Collection gaps: UAEREP page watch (site cert chain broken, TLS bypass not done); EPRI page watch (js); FONTAGRO, Gulbenkian, FPA2 unchanged ok.
- 14 targets closed (7 covered, 7 rejected); 9 leads vetted from state_regional/private_sector finders. 13 new listed (cap 12 exceeded by 1), 10 rejected.
- Engine v8: route hashes kept in list URLs (NAWI); self.assume_next_year (CWCB -> cycle). Commit 3ca2b6f. Deploy needs explicit import_map_path "deno.json".
