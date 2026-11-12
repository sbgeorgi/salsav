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

## 2026-11-12 revise
situation: reflect patch
lesson: After the EU source collected 16 calls they all stayed candidates, so the horizon ignored them until one was promoted by hand. The promotion step belongs in the vetting procedure.
evidence: reflect R20261112T061353-747f15c5

## 2026-11-12 revise
situation: reflect patch
lesson: The user corrected a thin NGO and private-foundation pool and expects many more sources. The breadth rule needs a concrete check against the per-bucket floor.
evidence: reflect R20261112T113101-747f15c5

## 2026-11-12 revise
situation: reflect patch
lesson: The user asked that every listed funder be monitored by the edge function with no agent in the loop, using the existing collection path as the blueprint. The skill should require trying each channel and recording the result.
evidence: reflect R20261112T113101-747f15c5

## 2026-11-12 revise
situation: reflect patch
lesson: The user asked that agents triage any funder that stops allowing systematic collection. The skill had no triage procedure, so the next run would improvise.
evidence: reflect R20261112T113101-747f15c5

## 2026-11-12 revise
situation: reflect patch
lesson: Cloud edge fetches can get HTTP 403 where a desktop fetch works (Gulbenkian); the skill's pitfalls only cover desktop-side blocks, so a funder can sit stale unnoticed.
evidence: reflect R20261112T120732-747f15c5

## 2026-11-12 revise
situation: reflect patch
lesson: Full evidence payloads for 18 rejections bloated the MCP SQL batches; trimmed rejection rows were all accepted, so the skill should say so.
evidence: reflect R20261112T120732-747f15c5

## 2026-11-12 revise
situation: reflect patch
lesson: The scheduled prompt and the repo copy had drifted, and the fix had to be applied to both by hand; a standing diff step prevents silent divergence.
evidence: reflect R20261112T120732-747f15c5

## 2026-11-12 revise
situation: reflect patch
lesson: A correctly collected call (Eni, closing in 8 days) looked missing on the dashboard; the skill should tell the checker where it went.
evidence: reflect R20261112T120732-747f15c5

## 2026-11-12 revise
situation: reflect patch
lesson: Two Bash parses of a saved grants.* execute_sql output failed with JSONDecodeError at char 0 because the JSON sits inside an untrusted-data envelope; the third attempt, which regex-extracted the block first, succeeded. The pitfall saves the next discovery run that retry.
evidence: reflect R20261112T125253-dfcb7303

## 2026-11-12 revise
situation: reflect patch
lesson: The 2026-11-12 discovery run vetted 23 leads and rejected every one on the coded gates, so it listed no funder. The fix was to target searches at gate-passing programs.
evidence: reflect R20261112T130438-747f15c5

## 2026-11-12 revise
situation: reflect patch
lesson: During the 2026-11-12 run a hook blocked subagents from calling check_known, so the first search fell back to plain reads. The main agent must run the dedupe itself.
evidence: reflect R20261112T130438-747f15c5

## 2026-11-12 revise
situation: reflect patch
lesson: The live skill still allowed page watch with a note saying 'why there is no call list', which contradicts the corrected COLLECT.md and discovery-task.md rules. A page-watch funder never produces call rows, so its next call does not reach the dashboard by itself. The user objected that none of the funders were tested for automatic updates.
evidence: reflect R20261112T131016-747f15c5

## 2026-11-12 revise
situation: reflect patch
lesson: Discovery run hit a Python certificate-chain failure on a funder site; the rule keeps future runs from disabling TLS or storing paraphrased quotes. Most other lessons from this window (subagents blocked from check_known, edge 403, 14-day deadline floor, closed one-off calls) are already in this skill.
evidence: reflect R20261112T131303-dfcb7303

## 2026-11-12 revise
situation: reflect patch
lesson: Skeptic review of the re-vet batch found configs whose JSON \b filters could never match and whose cycle label contradicted open calls; both are now named as pitfalls so the next vetting run checks them before set_collection.
evidence: reflect R20261112T134818-747f15c5

## 2026-11-12 revise
situation: reflect patch
lesson: Line 9 still told agents to reject any funder not clearing the gates, but the database now re-scores judgment rejects as vetted. The 2026-11-12 run stored 23 judgment rejects, none scored, and listed 0 new funders, so the old instruction produced the empty dashboard.
evidence: reflect R20261112T135553-747f15c5

## 2026-11-12 revise
situation: reflect patch
lesson: Same contradiction as line 9: the line did not name the reject_kind values the database now requires to keep a rejection. Without them the row is re-scored and listed.
evidence: reflect R20261112T135553-747f15c5

## 2026-11-12 revise
situation: reflect patch
lesson: The scheduled task now only reads supabase/grants/discovery-task.md; the old rule to diff two copies is obsolete and would send editors to the wrong file.
evidence: reflect R20261112T141501-747f15c5

## 2026-11-12 revise
situation: reflect patch
lesson: Batch set_collection calls with 8-character ids aborted whole UNION ALL batches; the fix was full ids from cfg files plus a checksum of config strings after apply. Both belong in the pitfalls line.
evidence: reflect R20261112T141501-747f15c5

## 2026-11-12 revise
situation: reflect patch
lesson: A discovery run zero-padded six shortened funder ids instead of copying the full ones, which the existing full-id rule did not prevent; the rule needs to name the padding failure explicitly.
evidence: reflect R20261112T142636-747f15c5

## 2026-11-12 revise
situation: reflect patch
lesson: The run hit two schema-name errors (funders.collect_mode, funders.collection_verified_at, discovery_log.created_at) that the task file's own step 7 query used, costing retries.
evidence: reflect R20261112T145055-a16f0c96

## 2026-11-12 revise
situation: reflect patch
lesson: The discovery review query took the 30 most recently seen candidates, so older calls with near deadlines were never checked.
evidence: reflect R20261112T163201-747f15c5

## 2026-11-12 revise
situation: reflect patch
lesson: Candidates now appear on the radar at once (migration 021), so the old rule that they stay hidden is wrong and would mislead future runs.
evidence: reflect R20261112T163201-747f15c5
