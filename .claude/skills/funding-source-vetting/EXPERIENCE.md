# Experience (append-only; harness.py skill log)

## 2026-11-11 created
situation: reflect create
lesson: The user required that every dashboard funder be vetted for SALSAV, and the vetting gates and aggregator exclusion were settled during the funding build.
evidence: reflect R20261111T222801-9671fccb

## 2026-11-11 revise
situation: reflect patch
lesson: The run's fetch of the EU portal page failed to render, but the topic's JSON endpoint returned the budget, deadline and status; this is a reusable source-verification path for EU topics that the skill lacks.
evidence: reflect R20261111T234848-0857d62d

## 2026-11-11 revise
situation: reflect patch
lesson: The user said discovery must be a thorough swarm across many private endowments, and that non-focus recipients who re-grant are funding sources; the skill had no breadth or seeding rule.
evidence: reflect R20261111T235530-9671fccb

## 2026-11-11 revise
situation: reflect patch
lesson: The edge function's claim query only probes vetted funders with adapter other than none, so a vetted funder without a probe path would never be monitored; the user wants vetted funders probed continuously.
evidence: reflect R20261111T235530-9671fccb

## 2026-11-11 revise
situation: reflect patch
lesson: The user found that a deck's non-focus organizations were skipped because only part of it was read; the seeding step must cover the whole source.
evidence: reflect R20261111T235530-9671fccb

## 2026-11-12 revise
situation: reflect patch
lesson: The window verified the SEDIA identifier query live (one exact result) and showed the old topicDetails advice was being replaced; the skill's EU line was stale.
evidence: reflect R20261112T003638-9671fccb

## 2026-11-12 revise
situation: reflect patch
lesson: The user said the agent gave up on JS-rendered or 403 pages instead of probing for endpoints; the recon run then showed junk endpoints (blog posts, Terms pages, session-token lists) that must be rejected.
evidence: reflect R20261112T003638-9671fccb

## 2026-11-12 revise
situation: reflect patch
lesson: A discovery run found NIFA's own site unreachable from the edge function, while the same RFAs were available via Grants.gov search2 with an exact oppNum filter; that mirror made the rows live. The existing probe step did not name this federal mirror, so future scouts would record the agency as dead.
evidence: reflect R20261112T005225-9671fccb

## 2026-11-12 revise
situation: reflect patch
lesson: The collection replay passed 34 of 34 configs, but several passed with zero items because expect.min_items was 0. Listing-only configs also left deadlines null. Both are repeatable traps when adding a funder.
evidence: reflect R20261112T013839-747f15c5

## 2026-11-12 revise
situation: reflect patch
lesson: Second pass: the rejection named placeholder angle-bracket tokens (<id8>, <file>) that remain in the live body. Fixed by writing ID8 and CONFIG_FILE in capitals within the same line, and kept the lesson: the honesty review found a regex-picked date from an unlabelled block stored a false open call with a passing count.
evidence: reflect R20261112T015841-747f15c5

## 2026-11-12 revise
situation: reflect patch
lesson: A rescore cleared BSF's 2027-04-07 deadline because the program page said to be announced; the funder's homepage card showed the date, so the rule must say to check the homepage card before clearing a date.
evidence: reflect R20261112T023603-747f15c5

## 2026-11-12 revise
situation: reflect patch
lesson: The AFRI package close date (2026-12-31) matched Grants.gov but the agency's own deadlines page gives a deadline per program area, so the stored date could be wrong.
evidence: reflect R20261112T023603-747f15c5

## 2026-11-12 revise
situation: reflect patch
lesson: Discovery prompt edit in this session added the date-ownership rule; the skill should state it so every vetting run applies it.
evidence: reflect R20261112T023603-747f15c5
