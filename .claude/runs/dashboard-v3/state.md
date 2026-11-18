## Goal
Dashboard v3 on branch funding-radar-v2 (user list 2026-11-17: search, colours, drawer, owners, Database tab, agent queue, notes, Galaxy; discovery task updated). No push, no deploy.

## Files touched
dashboard.{html,js,css,test.mjs}; dash/*; supabase/grants/023_human_overrides* and tests/; API.md, COLLECT.md, discovery-task.md; .claude/skills/*; .claude/sql-api-funcs.txt; scheduled task description.

## Done
- 023 live as version 20261118013547: dry run all_ok, 26 function md5s match, HTTP checks pass (detail: state-history.md).
- Advisors after 023: no new ERROR (state-history.md).
- Review wf_3ba6e168-d54 (57 findings fixed) and tail wf_eb736c23-e81 (38 findings, repair partial). 9 suites exit 0 in my own run after the first.

## Decisions
- Public endpoints keep state, owner and ask for listed funders (same as the live feed; a change would alter the live site).
- Lanes rolling and cultivate move to teal and rose; bucket colours unchanged.
- Grants.gov stays in the Database with a one-line note.
- pages.json and runs/crawler-health-2026-11-16 stay out of the commit.

## Pending
- wf_a5322bb1-6e2 (task wxbxr1k6t): G1 Pipeline phone overflow, G2 six columns from 1200px, G3 palette, G4 Galaxy Other at most 15% live, G5 small a11y items; then confirm.
- Rerun 9 suites, check preview (live and mock), secret-scan, verify, local commit, harness close, stop preview server 2ae3b01d (port 8765).

## Errors & fixes
- MCP declines drop trigger: use create or replace trigger; rollback runs only in the dashboard SQL editor.
- Headless cache served stale modules: fetch with cache reload and the full URL.
- Repair agent lost its failure list after a usage-limit pause: final round carries a pinned item list.

## Current state
Nothing committed, pushed or deployed. Preview on 8765 (tab seed).

## Next step
On the wxbxr1k6t notification: parse its output file (fix, confirm) under the session tasks dir, fix remaining highs, rerun suites, commit locally (no push).
