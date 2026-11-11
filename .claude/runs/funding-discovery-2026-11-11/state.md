# State: salsav-funding-discovery 2026-11-11

## Goal
Find new verified funding sources and register them in `grants` schema (Supabase iuzgfldgvueuehybgntm via supabase-avs). Only vetted rows if all gates pass.

## Done
- Read state: 115 known funders (75 vetted, 36 rejected, 4 candidate), discovery_log only has seed rows.
- 3 search rounds (federal, state, intl dev, foundation, corporate, prize, research collab); 5 web-fetch agents + 1 EU topic JSON fetch.
- Registered 8 rejected rows (run label discovery-2026-11-11): Reclamation Applied Science, Horizon CL5-2026-11-D3-14 agriPV, GAFSP 9th call, NSF DISES, NSF PIRE, IDRC CLARE, FFAR Submit a Research Idea, Arizona Water Protection Fund. Verify query matched.

## Decisions
- 0 vetted: every candidate failed a gate (univ eligibility, deadline, award cap, or official page unreadable).
- ARPA-E, Colorado AIA, FY2027 Drought Response, FFAR ROAR left unregistered (official pages not retrievable).

## Open
- Retry ARPA-E via browser; AWPF manual (403); EU portal FARM2FORK-02 page.

## Blocked on me
- None.

## Lessons
- web-fetch cannot read JS-rendered sites (ARPA-E, EU portal); EU `topicDetails/<id>.json` works.

## Resume
Run complete; next scheduled firing starts from step 1 (re-read funders and discovery_log).
