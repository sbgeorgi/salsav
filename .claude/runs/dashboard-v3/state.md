## Goal
Dashboard v3 (user list 2026-11-17). No push, no deploy.

## Files touched
dashboard.*; dash/*; supabase/grants/023_human_overrides*; API.md, COLLECT.md, discovery-task.md; .claude/skills/*; scheduled task description.

## Done
- 023 live as version 20261118013547 (detail: state-history.md). Advisors: no new ERROR.
- Review, tail and final fix workflows done (G1 to G5).
- Locked Database rows show "Team decision. Unlock to read the reason."
- 9 suites exit 0 (fresh run 2026-11-18 02:52). Secret scan clean (public anon key only).
- Commit 1e10c2b on local branch dashboard-v3 (85 files, no upstream, not pushed).
- Fix round wf_61cbf9c7-7d5 (H1 phone sort, H2 44px floors, H3 SVG tap areas, H4 Galaxy joins) plus lead byName rule: live Other 21/225. Second commit on dashboard-v3.

## Decisions
- Public endpoints keep state, owner and ask for listed funders (same as the live feed).
- Lanes rolling and cultivate move to teal and rose; bucket colours unchanged.
- Grants.gov stays in the Database with a one-line note.
- pages.json and runs/crawler-health-2026-11-16 stay out of the commit.
- Commit on dashboard-v3, not funding-radar-v2: the scheduled discovery run (Tue/Fri 07:00) pushes funding-radar-v2.

## Pending
- User: to go live, merge dashboard-v3 into funding-radar-v2 and push.
- Data gap: 15 funders have no themes recorded (they sit in Galaxy "Other concepts").

## Errors & fixes
- MCP declines drop trigger: rollback runs only in the dashboard SQL editor.
- Confirm of wf_a5322bb1 said not ready: 4 real issues (now H1 to H4); its F6 (palette not pinned) was false, ui.test.mjs:115-138 pins it.

## Current state
Branch dashboard-v3, two commits ahead of funding-radar-v2; pages.json and runs/crawler-health untracked on purpose. Nothing pushed or deployed. Preview on 8765 (server a46bb667, tab seed) left running for the user.

## Next step
None for the agent. The user tries the preview and decides when to go live.
