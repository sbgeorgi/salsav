# Funding radar v2 (2026-11-11)

Goal: turn the working v1 radar into a premium, transparent one: itemized fit score with quoted evidence, richer KPIs and collected metrics, systematic funder targeting, a sharper discovery/vetting task.
Approach: the database owns the truth (rubric, gates, evidence checks, metrics) so the dashboard only explains what the DB computed and the scheduled task cannot drift from it. Every vetted funder is re-scored once against the rubric with verbatim quotes. The dashboard is rebuilt around lanes, an itemized score and an insights/method view.
Not building: usage telemetry, logins/accounts, a backend other than the existing Supabase `grants` schema, changes to the public SALSAV pages or the CMS, the crawler's fetch engine.
Files: `supabase/grants/008_radar_v2*.sql` (main), `supabase/grants/rubric_v2.json`, `supabase/grants/rescore/batch_NN.json`, `supabase/grants/targets/<bucket>.json`, `dashboard.html`, `dashboard.css`, `dashboard.js`, `dashboard.test.mjs`, `dashboard.fixture.json`, `dash/*.js`, `dash/*.css`, scheduled task prompt, `.claude/skills/funding-source-vetting/SKILL.md`.

SALSAV = Semi-arid Lab for Scaling Agrivoltaics, University of Arizona (US public university). Sites and partners: Biosphere 2 / Arizona, Mexico (UNAM pilot, Sonora, Baja California), Kenya, Israel. Work: agrivoltaics research (crop ecophysiology under solar), scaling up/out, education and workforce. Proposal partners that may be required: UA, YPV, AVS.

## Contract A: fit rubric
`supabase/grants/rubric_v2.json` (read it; it is the only definition). Six dimensions, 100 points: mission 35, activity 15, geography 15 (judged, each needs level + why + quote), eligibility 20 and award 10 (derived from the fields `ua_eligibility`, `award_max_usd`), precedent 5 (judged). fit_score = sum of points. min_fit 40. Tiers: prime >=75, strong >=60, possible >=45, long_shot below.
Award level from `award_max_usd`: null -> unknown(4), <200000 -> low(0), <500000 -> 200k(6), <1000000 -> 500k(8), else 1m(10).

## Contract B: rescore / reverify payload (one object per funder)
```json
{ "id": "<funder uuid>",
  "verdict": "keep | demote | promote",
  "reason": "one sentence, required for demote",
  "fit": { "mission":   {"level": "...", "why": "<=160 chars, plain words", "quote": "verbatim <=240 chars or empty"},
           "activity":  {"level": "...", "why": "...", "quote": ""},
           "geography": {"level": "...", "why": "...", "quote": ""},
           "precedent": {"level": "...", "why": "...", "quote": "", "url": "where the precedent is shown, optional"} },
  "facts": { "ua_eligibility": "eligible|eligible_with_partner|invitation_only|unknown|unlikely",
             "award_min_usd": 0, "award_max_usd": 0, "amount_confidence": "published|estimated|unknown", "award_note": "",
             "cycle": "fixed_deadline|annual_recurring|rolling|open_ended|invite_only|closed_unknown",
             "next_deadline": "YYYY-MM-DD or null", "deadline_note": "", "open_now": true,
             "eligibility_note": "", "requirements": {"loi": true, "cost_share": "", "indirect_cap": "", "registrations": []},
             "themes": ["from the vocabulary below"], "fetchability": "easy|bot_protected|login_required|js_required|blocked|unknown", "confidence": 0.0 },
  "evidence": { "award": {"quote": "", "url": ""}, "deadline": {"quote": "", "url": ""}, "eligibility": {"quote": "", "url": ""} },
  "vet_note": "one sentence a grant writer understands: why this fits SALSAV",
  "source": "last_text | live_page | both | none" }
```
Rules: `facts` holds only keys the evidence supports (omit a key to leave the stored value untouched; JSON null clears it). A quote is copied character for character from the official page text (the crawler's stored copy `grants.funders.last_text`, or a page fetched with `python supabase/grants/tools/fetch_text.py URL --grep "regex"`); never from memory, a search snippet or WebFetch (it paraphrases). No quote found -> empty string, and pick the lower level when unsure. `award_max_usd` is the largest SINGLE award in USD, never the program's total budget; non-USD amounts go in `award_note` and the number stays out. `amount_confidence` is `published` only with an `evidence.award.quote`.
Theme vocabulary (use only these): agrivoltaics, solar & clean energy, water, agriculture, food security, climate adaptation, drought & heat, energy access, rural livelihoods, smallholder farmers, research, education & workforce, technology & innovation, land & conservation, international partnerships, equity & inclusion.
Gates that force `demote`: mission level `none`; `ua_eligibility` unlikely; `award_max_usd` known and < 200000; fit_score < 40; the program is closed for good.

## Contract C: feed v3 (`public.grants_feed()`), additions only
- `rubric` (the rubric JSON), `vocab.themes`, `coverage_min` `{us_federal:12,intl_dev:12,state_regional:8,private_sector:8,foundation_ngo:12}`.
- each funder gains: `fit_breakdown` null | `{v:2,total,tier,dims:[{key,level,points,max,why,quote,url?}]}` (six dims in rubric order); `evidence` `{award?,deadline?,eligibility?}` each `{quote,url}`; `evidence_ok` `{mission?,activity?,geography?,precedent?,award?,deadline?,eligibility?}` true = the quote was found in the crawler's latest copy of the funder page; `facts_verified` 0..4 (mission quote, eligibility, award, deadline backed by a quote); `verified_at`, `verified_by`; `lane` apply_now|rolling|prepare|cultivate|watch; `team` `{state,owner,ask_usd,updated_at}`.
- team states: new, reviewing, applying, submitted, awarded, declined, skip. `grants_set_state` patch accepts `ask_usd` (number or null).
- `vetting` `[{funder_id,at,kind,note,changes,run_label}]` kind in registered|rescored|verified|updated|demoted|promoted; `changes` is `{field:[from,to]}`.
- `metrics` `[{day,m}]` ascending, <=90 days; `m` keys: vetted, by_bucket{}, by_lane{}, by_tier{}, avg_fit, itemized, addressable_usd, actionable_usd, pipeline{state:{n,usd}}, quality{award_published,deadline_known,eligibility_confirmed,evidence3}, health{checked_24h,failing}, targets_pending, screened.
- `discovery` `{runs:[{run_label,started_at,finished_at,summary,stats,examined,vetted,rejected,duplicate}], by_lens:[{lens,examined,vetted,rejected}], totals:{examined,vetted,rejected,candidate}}`.
- `targets` `{by_bucket:[{bucket,pending,covered,rejected,deferred}], next:[{org,program_hint,bucket,priority,why}]}` (15 pending, priority first).
- `screened` `[{name,program,bucket,reason,at}]` latest 250 rejected sources.
- `opportunities` unchanged shape (specific open calls under a funder).
Lane rule (client recomputes with its own clock): cultivate if cycle=invite_only or ua_eligibility=invitation_only; else apply_now if a deadline exists and days_left >= min_days; else rolling if cycle in (rolling, open_ended); else prepare if cycle=annual_recurring; else watch.
Old rows may lack every new key: the UI must render them (score shown as "not itemized yet").

## Contract D: `dashboard.js` pure API (no DOM, every date function takes `now`)
Keep every existing export. Add:
- `STATES` = new, reviewing, applying, submitted, awarded, declined, skip. `LANES` `{apply_now:'Apply now',rolling:'Rolling',prepare:'Prepare',cultivate:'Cultivate',watch:'Watch'}`.
- `lane(f, now, minDays=14)` -> lane key. `fitTier(score, rubric)` -> `{key,label}` | null.
- `explainFit(f, rubric)` -> null when `f.fit_breakdown` is missing, else `{total, tier:{key,label}, dims:[{key,label,question,points,max,level,levelLabel,rule,why,quote,url,ok,next}], headroom:[{key,label,gain,toLabel,rule}]}`; `ok` = `f.evidence_ok[key] === true`; `next` = the next better level `{key,label,points,gain,rule}` or null; `headroom` = up to 3 largest gains, eligibility and award first when tied.
- `evidenceLevel(f)` -> `{n, of:4, items:[{key,label,ok}]}` for mission, eligibility, award, deadline (from `facts_verified` when present, else recomputed).
- `recommend(rows, now, n=5)` -> `[{row, score, reasons:[string]}]`: only lanes apply_now/rolling/prepare, team state new or reviewing, not disqualified; score = fit_score + urgency (deadline in 14..45 days +12, 46..90 +15, 91..180 +8, rolling +4, prepare +2) + 5 if ua_eligibility=eligible + 3 if `evidenceLevel.n` >= 3; ties by sooner deadline then name. `reasons` are short plain phrases ("Closes in 41 days", "Fit 78, Prime", "UA applies directly", "Nobody owns it yet").
- `normalize` adds `_lane`, `_tier`, `_evid` and `team.ask_usd`. Filters gain `lane` (''), `tier` ([]), `evid` (false: when true require `_evid.n >= 3`); `SORTS` gains `recommended`; hash codec covers them; `decodeHash` accepts views table|cards|timeline|board|insights|method.
- `kpis(rows, ctx)` keeps its keys and adds: applyNow, applyNowUsd, rollingOpen, primeStrong, avgFit, itemized, pipeline `{n, usd, byState:{state:{n,usd}}}` (states reviewing/applying/submitted/awarded; usd = team.ask_usd ?? award_max_usd ?? 0), evidencePct, byLane, byTier.
- `insights(rows, feed, now)` -> `{scatter:[{id,name,days,fit,award,bucket,lane}], undated:[...same without days], fitHist:[{tier,label,n}], anatomy:[{key,label,avg,max}], coverage:[{bucket,label,vetted,min,screened,pending}], funnel:[{state,n,usd}], quality:[{key,label,pct}], health:{total,checked24h,failing,manual}, trend:{days:[],vetted:[],applyNow:[],evidence3:[]}, discovery: feed.discovery || null}`.
- CSV gains: Lane, Fit tier, one column per rubric dimension (points), Evidence (n of 4), Ask USD.
Tests in `dashboard.test.mjs` (node, no deps) cover each new function, including a legacy row without `fit_breakdown`. Fixture `dashboard.fixture.json` is a full feed v3 with >=10 funders covering every lane, tier, state, a legacy row and screened/targets/discovery/metrics; the page loads it with `dashboard.html?feed=dashboard.fixture.json`.

## Contract E: UI modules and art direction
Files: `dashboard.html` (shell, Radar list views, filters, wiring), `dashboard.css` (tokens, base, Radar), `dash/viz.js` + tests in `dash/viz.test.mjs` (pure SVG-string chart primitives), `dash/drawer.js|css`, `dash/insights.js|css`, `dash/board.js|css`, `dash/method.js|css`.
Module interface: each view module exports `render(root, app)`; `dash/drawer.js` exports `renderDrawer(dialogEl, row, app)`. `app` = `{ S, D, el, ico, link, num, rubric(), openDrawer(id), setFilters(patch), go(view), unlocked(), requireUnlock(), saveTeam(id, patch) -> Promise, toast(msg, kind) }`; the shell builds `app` and imports view modules lazily.
`dash/viz.js` exports functions returning SVG markup strings sized by viewBox, colours only through CSS variables/classes: `fitBar(dims, {w,h})` (six segments, width proportional to max, filled to points), `ring(score, {size,label})`, `spark(values, {w,h})`, `hbars(items)`, `scatter(points, opts)`, `funnel(stages)`, `meter(pct)`, `stackedBars(series)`.
Views (hash `view=`): Radar (table | cards | timeline), Pipeline (`board`), Insights, Method.
Art direction: quiet, editorial, data-dense; warm paper background and SALSAV green stay; hairline rules instead of heavy boxes; one accent plus amber (urgent) and red (disqualified); bucket colours only as small marks; a serif display face for headings and large numerals, a clean sans for UI, tabular figures everywhere numbers align; the six-segment fit bar is the signature element and appears wherever a score does; light and dark themes at parity; 150-200 ms motion, none under prefers-reduced-motion; no overflow at 375 px; every control keyboard reachable with a visible focus ring; WCAG AA contrast. Copy: plain words a grant writer uses, sentence case, no jargon, no em dashes.
Security: text from the feed is rendered with textContent/`el()`, never innerHTML; links go through `D.safeUrl`; the passcode never reaches the URL or localStorage.

## Tasks
1. SQL 008 (main): columns, rubric in settings, derive trigger (fit + evidence_ok), register_source v2 with coded gates, reverify_source, upsert_opportunity, targets, discovery_runs, vet_events, metrics_daily + snapshot, team states + ask_usd, view + feed v3, token-gated bulk import. Test: DO block with rollback comparing old vs new feed keys and gate outcomes. Verify: `has_function_privilege` for anon on every new function; feed returns the Contract C keys.
2. Rescore (10 batches, worker) -> skeptic verify per batch (worker). Files: `supabase/grants/rescore/batch_NN.json`. Verify: JSON parses, every object has id + four judged dims with valid levels.
3. Targets (5 buckets, worker). Files: `supabase/grants/targets/<bucket>.json`. Verify: JSON parses, each row has org, url_hint (https), bucket, priority 1-3, why.
4. Logic + fixture (worker). Verify: `node dashboard.test.mjs` passes.
5. Viz primitives (worker). Verify: `node dash/viz.test.mjs` passes.
6. Shell + Radar (worker, deps 4, 5). 7. Drawer, 8. Insights, 9. Board + Method (workers in parallel, deps 6). 10. Polish pass (deps 7-9). Verify each: page loads the fixture with no console errors at 1440 and 375 wide, screenshots saved to the scratch folder named in the brief.
11. Import rescore + targets (main), demote what fails the gates, vet top targets (second wave), rewrite scheduled task + vetting skill, live browser check (main).

## Five checks
1. First principles: the ask is trust (why this score, why this funder), focus (what to do next) and a self-improving pipeline; itemized rubric + evidence + lanes + targets + metrics answer those directly.
2. Adversarial: a discovery run with the old prompt is live -> register_source v2 accepts the old payload and stores it as `candidate` (never an unitemized vetted row). Crawler writes must never fail -> the derive trigger does not raise and the metrics snapshot is wrapped in an exception handler. Invented quotes -> the DB checks each quote against the crawler's copy of the page and the UI shows which ones matched. Total-budget-as-award errors -> skeptic pass per batch.
3. Ablation: 53 of 75 awards unknown, 40 of 75 eligibility unknown, 13 of 75 dated, fit scores cluster 30-60 with no explanation; each mechanism targets one of these measured gaps. Before/after is measured with the same SQL counts.
4. Occam: no usage telemetry, no compare view, no drag and drop requirement, no geography vocabulary (the existing regex groups work), one import path removed after use.
5. Cohesion: DB functions are the only write path for agents; `dashboard.js` is the only place KPIs and scores are computed for the UI; view modules share state only through `app`.
