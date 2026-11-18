## Goal
Dashboard v3 (user request 2026-11-17): nav-bar global search with autocomplete; category colors consistent across tabs; pipeline status + tags-on-top in the drawer; clearer owners in Pipeline, owner attribution + history; new Database tab (rejected funders + reasoning, promote -> tracked + agentic queue, demote funders and single proposals); Radar keeps pipeline-progressed rows with a flag; quick notes saved to DB and shown everywhere; new Galaxy tab (concept clusters of funders, quick filters); crawler queue / cron shards / salsav-funding-discovery task updated to match. Constraint: do NOT push or deploy ("don't push them live").

## Done
- Read-only mapping only. Nothing changed in repo code, DB, edge function or scheduled tasks.
- maps.json (this folder): 7 subsystem maps (shell, modules, sql, crawler, agentic, tests, data) from workflow wf_2348e53c-57c. Read it in chunks before designing; do not re-run the mapping.

## Decisions
- Dashboard exists only on funding-radar-v2 (not main); a branch push may deploy, so local commits only.
- Team identity = shared passcode + self-declared name (localStorage salsav.dash.me). Browser can only call public.grants_* wrappers granted to anon; every new write needs a wrapper that calls grants.check_pass.
- The agent must not type the real passcode in the browser: verify writes with DO-block tests ending in RAISE EXCEPTION and a stubbed rpc / ?feed= fixture.
- Intended shape (not built): SQL 023 + rollback (additive): funder/opportunity manual-override fields, notes log, history read from team_events/vet_events; promote puts the funder at the top of grants.targets for the discovery task; demoted rows must not be re-created by the crawler; Galaxy as lazy dash/galaxy.js on canvas, no new dependency.

## Open
- "5 category filters": the Radar shows 5 colored funder-type chips (US federal, Intl. development, State & regional, Private sector, Foundations & NGOs); the shell map assumed the 5 lanes. Check D.BUCKETS vs D.LANES before coloring.

## Next step
Read maps.json, write the schema + UI contract, then SQL 023 (+rollback, DO-block test), then front-end tracks, then discovery-task.md + scheduled SKILL.md, verify in preview (launch.json salsav-static, port 8765), commit locally.

## 2026-11-17 (resume 2)
- User added: be critical, significantly upgrade UI/UX where warranted; Database must hold ALL evaluated funders (also below threshold); add missing DB criteria and use them; ready for interoperability.
- Contract pinned: `.claude/runs/dashboard-v3/contract.md` (schema 023, RPC shapes, app API, ui.js, mock mode, file ownership).
- Decisions: no change to `grants_feed()` (live site untouched; new data via new RPCs `grants_registry`, `grants_funder`); human decisions are locks enforced by triggers, not by patching reverify/register/upsert; promote sets status vetted at once + agent_queue pending; leads (targets) shown in Database and re-queued as pending; threshold criteria shown as computed `gates`; additive migration is applied to the live DB by main after a rolled-back dry run (assumption: "don't push live" = no git push / deploy; DB change is additive, behaviour-neutral for the live site, rollback file first).
- UI critique (screens seen 2026-11-17): top bar wraps at 1024px; radar work surface starts ~1180px down, page 16000px tall (101 tall rows, narrow funder column); drawer is one long scroll with team status at the bottom; pipeline column "Not started" lists 95 full cards, no owner identity, no category color, no drag and drop.
- Phases: 1 = SQL + FOUND + AGENT-DOCS (workflow), main applies SQL; 2 = RADAR, DRAWER, BOARD, DATABASE, GALAXY, MODS; 3 = adversarial review + fixes; 4 = browser verification in mock mode + live read; commit locally, no push.
- Build workflow launched 2026-11-17: run `wf_ccf93f83-a82` (script: ~/.claude/projects/C--HELLOWORLD-salsav-codex/346b0333-8b7a-45b1-be82-eb64c27ba570/workflows/scripts/salsav-dashboard-v3-build-wf_ccf93f83-a82.js). Tracks: sql author -> 2 reviews + agent-docs -> sql fix; shell foundation -> acceptance -> radar, drawer, board, database, galaxy, mods. Preview server `salsav-static` (port 8765) is left running for the agents' headless smoke tests; stop it at wrap-up.
- Next (main): read results + sql-notes.md + found-notes.md; dry-run 023 inside one DO block (EXECUTE migration, EXECUTE test, exception rolls back), apply with apply_migration, rerun the test, rename files to the live version; review workflow (integration, XSS, a11y, responsive, SQL); browser verification in mock mode + live read-only; scheduled task description; local commit, no push; harness.py close --latest.

## Resume point 2026-11-17 (stopped: usage limit)
State: migration 023 NOT applied, NOT dry-run. Nothing committed, nothing pushed. Preview server salsav-static (port 8765) left running for the user.
Done this pass: 023 files final (grants.pass_denied() = HTTP 403 + body code 28000 on a wrong passcode; test S18a/S19 and rollback updated).
Pre-checks on live (all fine): 0 failed auth rows, 0 vetted calls under unlisted funders, funders need name/category/url, opportunities need funder_id/external_id/title, no txn-control lines in either file, files are pure ASCII/LF.
Expected md5(prosrc) per function: md5-repo-023.txt (regenerate if the migration changes).
Worker verdict on the live (HEAD) front end with an unscored promoted funder: DEGRADED only, no crash; recommend() can pick it. Fix in new dashboard.js recommend(): skip rows with fit_score == null (add a test).
Next steps, in order:
1. Dry run with execute_sql (supabase-avs), one call:
   do $dry$ declare v_before jsonb; v_md5 jsonb; v_msg text; begin
     select jsonb_object_agg(p.oid::text, md5(p.prosrc)) into v_before from pg_proc p where p.pronamespace in ('grants'::regnamespace,'public'::regnamespace);
     execute $mig023$ <023_human_overrides.sql verbatim> $mig023$;
     select jsonb_object_agg(p.oid::regprocedure::text, md5(p.prosrc)) into v_md5 from pg_proc p where p.pronamespace in ('grants'::regnamespace,'public'::regnamespace) and (v_before ->> p.oid::text) is distinct from md5(p.prosrc);
     begin execute $tst023$ <tests/023_human_overrides_test.sql verbatim> $tst023$; v_msg := 'TEST DID NOT RAISE';
     exception when others then v_msg := sqlstate || ' ' || sqlerrm; end;
     raise exception 'DRY RUN 023 | % | MD5 %', v_msg, v_md5; end $dry$;
   Expect all_ok true and the MD5 map equal to md5-repo-023.txt (discovery_brief and reverify_source also appear: patched).
2. Before apply, fix stale comments in 023_human_overrides.sql (lines 2-4 "NOT APPLIED", line 19 and line 650 "returns an error object / {error, code}") and the test header (lines 1, 8, 236, 261). All are outside function bodies.
3. apply_migration name grants_023_human_overrides, then verify: md5(prosrc) vs md5-repo-023.txt, triggers/columns/constraints, has_function_privilege (6 public wrappers true for anon/authenticated, internals false), no anon grants on grants.notes, grants_feed keys unchanged, PostgREST sees grants_registry (notify pgrst, 'reload schema' if not), one wrong-passcode call returns HTTP 403 and leaves one failed row in grants.auth_attempts. Rename repo files to the live version (list_migrations).
4. Review/fix workflow wf_3ba6e168-d54 was stopped mid-run at the limit: the working tree may hold partial fixes. Run every suite first, then resume with Workflow({scriptPath: <session>/workflows/scripts/salsav-dashboard-v3-review-fix-wf_3ba6e168-d54.js, resumeFromRunId: 'wf_3ba6e168-d54'}).
5. Remove reject_opportunity, probe_refresh, probe_result from .claude/sql-api-funcs.txt; update scheduled task salsav-funding-discovery from scheduled-task-description.txt; secret-scan; verify; commit on funding-radar-v2 (no push); harness close; stop the preview server.

## 023 applied 2026-11-18 (version 20261118013547)
- The MCP server declines any payload with `drop trigger`; the five triggers now use `create or replace trigger` (pg 17.4). Dry run after that change: all_ok true (31 scenarios), 24 function md5s equal md5-repo-023.txt.
- Applied with apply_migration `grants_023_human_overrides`. Recorded text md5 0fb586e2085e92c576d25e918d3ad24a, length 46804 = the repo file byte for byte, so the repo file keeps its name and must not be edited.
- Verified after apply: 26 function md5s, 5 triggers, 12 columns, both constraints, team_events.funder_id nullable, six new wrappers executable by anon/authenticated, no internal function executable by them, grants.notes RLS on with no anon/authenticated rights, 0 test rows, funders 107 vetted / 117 rejected / 1 candidate, 0 vetted calls under unlisted funders.
- Over HTTP with the anon key: grants_registry 200 (access public, 225 funders, 67 leads, 120 calls, no human.by, no lead notes), grants_funder 200 for a tracked and a screened funder (screened: no notes key, team has state only), grants_feed 200 unchanged shape, wrong passcode on grants_set_state returns 403 {code 28000} and left 1 failed row in grants.auth_attempts (it clears on the next correct passcode).
- Contact-shaped strings (email, phone) in vet_events.note, targets.why, targets.source, funders.reject_reason, funders.vet_note: 0.
- Rollback file: dashboard SQL editor only (the MCP server declines its drops).
- sql-api-funcs.txt: reject_opportunity, probe_refresh, probe_result removed (main-session-only functions do not belong on the subagent allowlist).

## Advisors after 023 (2026-11-18)
- Security: no new ERROR. 023-related notices are by design: the 8 public.grants_* wrappers are anon/authenticated-callable SECURITY DEFINER (passcode-checked), grants.notes has RLS on with no policies (reachable only through the definer functions).
- Performance: INFO only, grants.notes.opportunity_id FK has no covering index (0 rows; left).
- Pre-existing, outside grants: ERROR security_definer_view (1, public schema), function_search_path_mutable (14, none in grants), Postgres 17.4.1.075 has security patches pending.
- Review/fix workflow wf_3ba6e168-d54 done (57 findings, one repair round, 9 suites green). Tail workflow wf_eb736c23-e81 running: shell tail -> module tail -> 4 verify lenses (live, request, code, a11y) -> repair -> confirm.
