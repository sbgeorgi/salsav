# Funding radar: agent SQL API (schema `grants`)

Source: live `pg_get_functiondef`, `pg_get_constraintdef`, `pg_get_viewdef` and `grants.settings` on project `supabase-avs`, 2026-11-12. Live checked: all definitions, constraints, triggers, settings, rubric. UNCONFIRMED: output of live calls to discovery_brief(), metrics_now(), collection_state(), check_known(): the session's boundary-guard hook denied every `select grants.<fn>(...)` statement, so output keys below come from the live function bodies (jsonb_build_object keys), not from a call result.
Access: every function is EXECUTE for `postgres` only (proacl `{postgres=X/postgres}`; anon/authenticated/public revoked). Call them through `execute_sql`. All are plpgsql/sql with `search_path = grants, extensions, pg_temp`; none is SECURITY DEFINER except check_pass/check_refresh_token/kick_refresh (not agent API).
Conventions: today = `now() at time zone 'America/Phoenix'`. Invalid enum values and bad casts are NOT validated by the function: Postgres raises, e.g. `new row for relation "funders" violates check constraint "funders_cycle_check"` or `invalid input syntax for type date: "..."`; the whole call rolls back. Exceptions listed below are the function's own.
Result values are in `result`. Always read `status`, `notes`, `reject_reason` of the return, never assume the row is vetted.

## 1. grants.discovery_brief() returns jsonb
`select grants.discovery_brief();` (STABLE, no args, writes nothing). Keys (from live body; limits are row caps):
- `today` date (Phoenix). `gates` {min_fit 40, min_award_usd 200000, min_days_left 14} (settings).
- `rubric` the live fit_rubric JSON (same as section A). `theme_vocab` array of 16 allowed themes.
- `coverage` [{bucket, min, listed, pending_targets, gap}] sorted by gap desc. min per bucket (settings coverage_min): us_federal 12, intl_dev 12, foundation_ngo 12, private_sector 8, state_regional 8. `listed` counts vetted non-aggregators.
- `targets` up to 30 pending rows {id, org, program_hint, url_hint, bucket, lens, priority, why, attempts}, ordered priority asc, bucket gap desc, attempts asc, created_at.
- `reverify` up to 20 listed funders {id, name, program, url, bucket, fit_score, facts_verified, verified_at, evidence_ok, ua_eligibility, amount_confidence, cycle, deadline, deadline_state}; order: no fit_breakdown first, expired deadline, any evidence_ok=false, oldest verified_at, fewest facts_verified.
- `failing` listed funders with consecutive_failures >= 3 {id, name, url, fetchability, consecutive_failures, last_ok_at}.
- `collection_gaps` up to 15 {id, name, program, url, bucket, cycle, mode, health, note, verified_at, fetchability, consecutive_failures}: listed funders whose collection health is not ok, or mode page/none with verified_at null or older than 120 days. Fix with set_collection.
- `metrics` = metrics_now() (section 10). `last_runs` last 3 discovery_runs {run_label, started_at, finished_at, summary, stats}. `last_refresh` {finished_at, status, planned, fetched, changed, errors} of the last finished crawler run.
Live counts seen via table reads (2026-11-12): funders vetted 35, rejected 87, candidate 1; targets pending: us_federal 15, foundation_ngo 14, private_sector 14, intl_dev 8, state_regional 3; opportunities: 4 open/candidate, none vetted.

## 2. grants.check_known(p jsonb) returns jsonb  (read-only, STABLE)
Signature: `check_known(p jsonb)`. `p` MUST be a JSON array (an object raises `cannot extract elements from an object`).
```sql
select grants.check_known($j$[{"name":"USDA NIFA","program":"AFRI","url":"https://www.nifa.usda.gov/grants"}]$j$::jsonb);
```
Reads per element: `name` (text, needed for the name match), `program` (text, optional), `url` (text, optional). Match if name_key(name+' '+program) equals the stored name_key, or url_norm(url) equals stored url_norm, or (name_key(name) has length >= 6 and the stored name_key starts with it). Max 5 matches per element. Missing keys give no match, no error.
Returns array, one entry per input: `{name, program, matches:[{name, program, status, reason, exact}]}`; `status` candidate|vetted|rejected, `reason` = reject_reason, `exact` true on name or url equality. `matches` is `[]` when new. Writes nothing.

## 3. grants.register_source(p jsonb, p_lens text default null, p_run_label text default null) returns jsonb
```sql
select grants.register_source($j${
 "name":"Example Foundation","program":"Dryland Farming Grants","category":"foundation","url":"https://example.org/grants",
 "status":"vetted","cycle":"annual_recurring","next_deadline":"2027-03-01","ua_eligibility":"eligible",
 "award_max_usd":500000,"amount_confidence":"published","themes":["agriculture","water"],"geography":["US","Arizona"],
 "fit":{"mission":{"level":"strong","why":"Funds dryland farming resilience","quote":"verbatim sentence from the page"},
        "activity":{"level":"research_demo","why":"Field trials","quote":""},
        "geography":{"level":"region","why":"US-wide","quote":""},
        "precedent":{"level":"none","why":"","quote":""}},
 "evidence":{"eligibility":{"quote":"Universities are eligible to apply","url":"https://example.org/eligibility"},
             "award":{"quote":"awards up to $500,000","url":"https://example.org/grants"}},
 "vet_note":"One sentence why it fits SALSAV","adapter":"html","target_id":null}$j$::jsonb, 'lens-name', 'run-2026-11-12');
```
Flow: (1) duplicate check, (2) claim downgrades, (3) itemized-fit validation and gates, (4) insert, (5) logs. Keys read:
- Required (NOT NULL columns, Postgres error `null value in column "name" ... violates not-null constraint` if missing): `name`, `category`, `url`. `category` in section E.
- Duplicate: if `url_norm(url)` or `name_key(name+' '+program)` already exists in funders (any status): NO insert; returns `{result:'duplicate', funder_id, existing_name, existing_status}`; writes discovery_log outcome duplicate; if `target_id` given and the existing is vetted -> target covered, rejected -> target rejected, else unchanged; attempts+1.
- `status` text default `candidate`; allowed candidate|vetted|rejected (else constraint error). `vetted` triggers gates; the stored status can be downgraded (below). `rejected` stays rejected only with `reject_kind` `not_a_funder` or `ended`; any other `rejected` is re-scored as `vetted` (note 'Judgment reject re-scored by the gates: <reason>', also saved in `notes`), so only the coded gates turn a funder away (018).
- `fit` object {mission, activity, geography, precedent}, each {level, why<=300, quote<=400, url optional http(s)}. Levels in section A. Invalid or missing level for any dim: fit is dropped; with status vetted the row is stored as `candidate` and `notes` gets `stored as candidate: fit.<dim>.level must be one of: <levels>` (or `no itemized fit (fit.mission, fit.activity, fit.geography, fit.precedent)`). With status candidate or rejected an invalid fit is dropped silently (no note).
- `evidence` object {award|deadline|eligibility: {quote<=400, url}}; entries with an empty quote are dropped. Other evidence keys are ignored.
- `ua_eligibility` default `unknown`: `eligible` or `eligible_with_partner` WITHOUT `evidence.eligibility.quote` is stored as `unknown` and note `ua_eligibility stored as unknown: evidence.eligibility.quote is missing`.
- `award_max_usd`, `award_min_usd` numbers (rounded to bigint). `amount_confidence` default `unknown`; null award forces `unknown`; `published` without `evidence.award.quote` becomes `estimated` with note `amount_confidence stored as estimated: evidence.award.quote is missing`. award_min > award_max drops award_min silently.
- `next_deadline` YYYY-MM-DD; a past date is dropped (stored null) with note `next_deadline dropped: it is in the past`.
- Gates when status = vetted and fit valid (first match wins, rows become status `rejected`, `reject_reason` set, note `stored as rejected: <reason>`): `Universities or US applicants cannot apply.` (ua unlikely); `Largest single award ($N) is below the $200,000 minimum.`; `Does not fund this kind of work.` (mission level none); `Fit score N is below the minimum of 40.`. Then, only if not rejected: empty `fit.mission.quote` -> `candidate` + note `stored as candidate: fit.mission.quote (the funder's own words about what it funds) is required`; empty `vet_note` -> `candidate` + note `stored as candidate: vet_note is required`.
- `reject_reason` text used only when status ends `rejected`; blank -> `Screened out without a stated reason.`; cleared otherwise.
- Other keys stored as-is: `program, apply_url, feed_url, geography[], themes[] (NOT vocab-filtered here), deadline_note, open_now (boolean), requirements (object), requirements_text, eligibility_note, notes, partner_needed[], fit_reasons[] (overwritten by trigger when fit stored), page_type (default html_static), fetchability (default unknown), adapter (default html), adapter_config (object, default {}), confidence (0..1 real), vetted_by (default 'discovery'), discovered_via (default p_lens), cycle (default closed_unknown), fit_score (overwritten when fit stored), award_note`.
- `target_id` uuid: when present the target is updated: vetted->covered, rejected->rejected, candidate->status unchanged; funder_id set; note = reason or vet_note (300); attempts+1.
Returns `{result:'inserted', funder_id, status, fit_score, reject_reason, notes:[text]}`; `status` candidate|vetted|rejected; `fit_score` null when no itemized fit. A `candidate` is hidden from the dashboard.
Side effects: INSERT grants.funders (trigger funders_fit_derive computes fit_breakdown, fit_score, fit_reasons, evidence_ok), discovery_log, vet_events kind `registered`; UPDATE grants.targets. Duplicates only write discovery_log (+ target).

## 4. grants.reverify_source(p_id uuid, p jsonb, p_run_label text default null) returns jsonb
```sql
select grants.reverify_source('00000000-0000-0000-0000-000000000000'::uuid, $j${
 "verdict":"keep","by":"discovery",
 "fit":{"mission":{"level":"core","why":"Names agrivoltaics","quote":"verbatim"},"activity":{"level":"research_demo","why":"","quote":""},
        "geography":{"level":"home","why":"","quote":""},"precedent":{"level":"similar","why":"","quote":"","url":"https://example.org/past"}},
 "facts":{"ua_eligibility":"eligible","award_max_usd":750000,"amount_confidence":"published","cycle":"fixed_deadline","next_deadline":"2027-02-15","open_now":true,"themes":["agrivoltaics"]},
 "evidence":{"award":{"quote":"up to $750,000","url":"https://example.org/x"}},
 "vet_note":"One sentence","note":"optional event note"}$j$::jsonb, 'run-2026-11-12');
```
Reads: `verdict` default `keep`; anything else than keep|demote|promote raises `verdict must be keep, demote or promote`. `reason` (demote; blank falls back to the gate reason, then `Screened out on re-check.`), `by` (default `rescore`, 60 chars; stored in verified_by and vetted_by on promote), `note` (event note), `vet_note` (replaces stored when non-blank, 600 chars).
- `facts` keys, applied only when the key is PRESENT (JSON null clears): ua_eligibility, award_min_usd, award_max_usd, amount_confidence, award_note, cycle, next_deadline, deadline_note, open_now, eligibility_note, requirements (object, MERGED into stored), themes (array, filtered to theme_vocab; kept only if at least one survives), fetchability, confidence. Enum violations raise the check-constraint error. Unlike register_source, eligible without a quote is NOT downgraded here.
- `fit`: when the key `fit` exists it is cleaned and replaces fit_inputs; invalid level raises `fit.<dim>.level must be one of: <levels>` (the exact text of the first bad dim). No `fit` in payload and no stored fit_inputs (category not aggregator) raises `this source has no itemized fit yet: send fit.mission, fit.activity, fit.geography and fit.precedent`.
- `evidence`: when an object, each key present REPLACES the stored one (empty quote removes it); keys not present are kept. `published` without a stored award quote becomes `estimated`; null award -> `unknown`; award_min > award_max drops min; past next_deadline is dropped silently.
- Outcome: `demote` -> status rejected, reject_reason as above. Any other verdict: if a gate fails (section A gates on the recomputed fit) -> rejected with the gate reason (an existing reject_reason is kept). `promote` on a candidate or rejected row that passes the gates -> vetted; needs a non-empty vet_note else raises `promote needs a vet_note`; promote does NOT require fit.mission.quote (register_source does). `keep` never promotes a rejected or candidate row. Always sets verified_at, verified_by.
Returns `{result, id, name, status, fit_score, reject_reason, changes}`: `result` in `demoted|promoted|rescored|verified|updated` (also the vet_events kind; rescored = row had no fit_inputs before; verified = nothing in changes) or `{result:'not_found', id}`. `changes` = {field:[from,to]} over status, fit_score, ua_eligibility, award_min_usd, award_max_usd, amount_confidence, cycle, next_deadline, open_now.
Side effects: UPDATE grants.funders (row-locked, derive trigger recomputes evidence_ok and score), INSERT vet_events.

## 5. grants.upsert_opportunity(p jsonb, p_run_label text default null) returns jsonb
```sql
select grants.upsert_opportunity($j${"funder_id":"<uuid>","title":"FY27 Call","url":"https://example.org/call","deadline":"2027-03-01",
 "status":"open","description":"...","award_max_usd":500000,"deadline_text":"March 1, 2027","external_id":"fy27-call","source":"discovery"}$j$::jsonb,'run-2026-11-12');
```
Reads: `funder_id` uuid required, must be a funder with status `vetted` else raises `funder <uuid> is not a listed source`. `title` (<=300) and `url` (http/https) required else `title and an http(s) url are required`. `deadline` YYYY-MM-DD optional; past raises `deadline <date> is in the past` (closed calls cannot be inserted). `external_id` default `disc:<md5 of url_norm(url)>`; conflict key (funder_id, external_id) updates in place. `status` forecasted else stored `open` (closed/archived not accepted). Optional: `apply_url` (http(s) only), `description` (1200), `open_date`, `deadline_text` (300), `award_min_usd`, `award_max_usd`, `doc_links` (array, else []), `source` (default discovery -> source_adapter). vet_status is always set `vetted` (visible at once). Bad uuid/date/number -> Postgres cast error.
Returns `{result:'inserted'|'updated', id, funder_id, run}`. Side effects: INSERT or UPDATE grants.opportunities only; v_funders.deadline becomes the earliest future deadline among open/forecasted vetted opportunities.

## 5b. grants.reject_opportunity(p_id uuid, p_reason text, p_run_label text default null) returns jsonb
```sql
select grants.reject_opportunity('<opportunity uuid>'::uuid, 'maternal health grant, outside SALSAV scope', 'run-2026-11-12');
```
Only a `candidate` call changes: it becomes `rejected`, leaves the radar, and later crawler fetches keep it rejected. Returns `{result:'rejected', id, title, run}`, or `{result:'unchanged', id, vet_status}` for a vetted or already rejected call. Empty reason raises `reject_opportunity needs a reason`; unknown id raises `opportunity <uuid> not found`. Side effects: UPDATE grants.opportunities.vet_status, INSERT vet_events (kind updated, note `Call rejected: ...`). Candidates show on the radar marked "Unverified" until confirmed (upsert_opportunity) or rejected here.

## 6. grants.set_target(p_id uuid, p_status text, p_note text default null) returns jsonb
```sql
select grants.set_target('<target uuid>'::uuid, 'deferred', 'page is login-gated');
```
`p_status` required, one of pending|covered|rejected|deferred else raises `status must be pending, covered, rejected or deferred`. `p_note` stored left 300 (null clears the note). Unknown id returns `{result:'not_found'}`. Success: `{result:'ok', org, status, attempts}` (attempts+1 every call). Side effects: UPDATE grants.targets only. Note register_source with `target_id` already closes covered/rejected itself.

## 7. grants.log_discovery_run(p_label text, p_summary text default null, p_stats jsonb default null) returns jsonb
```sql
select grants.log_discovery_run('run-2026-11-12','Examined 12, vetted 3, rejected 6, duplicates 3','{"examined":12,"vetted":3,"rejected":6,"duplicate":3}'::jsonb);
```
`p_label` required, blank raises `run label is required`; it must equal the `p_run_label` used in other calls (unique key run_label; upsert). Call once with p_summary null at start (creates the run, finished_at stays null), once at the end with a summary (sets finished_at, runs snapshot_metrics inside an exception handler so a snapshot failure only warns). `p_summary` cut to 1200. `p_stats` jsonb stored whole (replaced when non-null; dashboard reads keys examined, vetted, rejected, duplicate: UNCONFIRMED, from PLAN contract C). Returns `{result:'ok', run_label, finished: boolean}`. Side effects: UPSERT discovery_runs; on finish INSERT/UPDATE metrics_daily via snapshot_metrics.

## 8. grants.set_collection(p_id uuid, p jsonb, p_run_label text default null) returns jsonb
Configures how the edge function collects calls for one listed funder (see COLLECT.md for adapter_config keys).
```sql
select grants.set_collection('<funder uuid>'::uuid, $j${"adapter":"html","url":"https://example.org/calls",
 "adapter_config":{"list":{"item":"li.call","title":"a","link":"a"},"auto_vet":false},"note":"Calls list at /calls","verified":true}$j$::jsonb,'run-2026-11-12');
```
Reads (all optional; absent keys keep the stored value): `adapter` (blank = keep) in html|rss|grants_gov|eu_ft|json_api|sam_gov|none else raises `unknown adapter <x>`; `adapter_config` object (JSON null -> {}); `url` http(s); `feed_url` (key present with blank clears); `note` (<=400; present+blank clears); `verified` boolean true stamps collect_verified_at=now().
Raises: `funder <id> not found`; `adapter_config must be an object`; `adapter_config is too large` (over 8000 bytes of text); `url must be http(s)`; `rss needs feed_url`; `json_api needs adapter_config.url (https)`; `list must be an object`; `list needs item or match`; `list.url must be http(s)`; `filter must be an object`; `auto_vet must be true or false`.
Changed config (adapter, adapter_config, url or feed_url differs) resets etag, last_modified, content_hash, fetchability to unknown, cooldown, next_check_at = now (re-fetch soon) and clears collect_verified_at unless `verified` true; unchanged config keeps them.
Returns `{result:'ok', id, name, mode, previous, changed}`; mode calls|cycle|page|none (collect_mode: grants_gov, eu_ft, sam_gov, json_api, rss, or html with `list` -> calls; html with `self` -> cycle; html otherwise -> page; none -> none). Side effects: UPDATE grants.funders; INSERT vet_events kind `updated` (only when changed). It does not test the config: run `tools/adapter_check.mjs` first.

## 9. grants.collection_state(p_id uuid) returns jsonb (read-only, STABLE)
```sql
select grants.collection_state('<funder uuid>'::uuid);
```
Returns `{mode, health, source, checked_at, ok_at, open_calls, total_calls, last_call_at, note, verified_at}`. Unknown id returns no row (NULL). `health`: `off` mode none; `failing` consecutive_failures >= 2 or robots_blocked; `stale` never ok or last_ok_at older than 3 days; `thin` html with fetchability js_required/login_required, or mode not calls with stored text under 300 chars; else `ok`. `source` label: Grants.gov API, EU Funding and Tenders API, SAM.gov API, Site JSON endpoint, Funding feed, Calls list, Program page, Page watch, Not monitored. `open_calls` counts vetted open/forecasted opportunities with null or future deadline; `total_calls` all not rejected.

## 10. grants.metrics_now() returns jsonb (read-only, STABLE)
Keys: `vetted, by_bucket{}, by_lane{}, by_tier{} (key unscored when no breakdown), avg_fit, itemized, addressable_usd, actionable_usd, pipeline{state:{n,usd}}, quality{award_published, deadline_known, eligibility_confirmed, evidence3}, health{checked_24h, failing}, targets_pending, screened, collection{listed, calls, cycle, page, none, auto, auto_healthy, healthy, verified, with_open_calls, open_calls, new_calls_30d, calls_closing_60d}`. Scope: vetted non-aggregators. Writes nothing (snapshot_metrics stores it daily).

# A. Fit rubric as the database applies it
Live `grants.settings.fit_rubric` equals `supabase/grants/rubric_v2.json` (version 2, verified level keys and points). Fit score = sum of six dimension points, max 100.
- mission (max 35, judged, needs quote): core 35, strong 27, adjacent 18, weak 8, none 0.
- activity (15, judged): research_demo 15, capacity 10, other 5, mismatch 0.
- geography (15, judged): home 15, region 12, global 8, outside 3, excluded 0.
- precedent (5, judged): direct 5, similar 3, none 0.
- eligibility (20, from field `ua_eligibility`, never judged): eligible 20, eligible_with_partner 13, unknown 7, invitation_only 3, unlikely 0.
- award (10, from field `award_max_usd`, largest SINGLE award): null -> unknown 4; < 200000 -> low 0; < 500000 -> 200k 6; < 1000000 -> 500k 8; >= 1000000 -> 1m 10.
- A missing or unknown level scores as the lowest level of that dimension (0 points). Judged dims are taken from `fit_inputs` (the `fit` payload); fit_score, fit_breakdown {v,total,tier,dims[{key,label,level,level_label,points,max,why,quote,url}]} and fit_reasons are derived by trigger on INSERT or UPDATE of fit_inputs, evidence, ua_eligibility, award_max_usd, eligibility_note, award_note, last_text. Never send fit_score as a source of truth.
- Tiers: prime >= 75, strong >= 60, possible >= 45, long_shot below. min_fit = 40. Labels: Prime, Strong, Possible, Long shot.
Hard gates (a vetted row must satisfy all):
- gate_reason (register_source and reverify_source, first match): ua_eligibility = unlikely; award_max_usd not null and < settings.min_award_usd (200000); no breakdown; mission level `none`; total < min_fit (40). reverify applies them to every verdict except demote (which rejects regardless); aggregator category is exempt in reverify.
- Table constraint `funders_vetted_fit`: `status <> 'vetted' OR category = 'aggregator' OR (fit_inputs IS NOT NULL AND fit_score >= 40)`.
- Table constraint `funders_vetted_scope`: `status <> 'vetted' OR (vetted_at IS NOT NULL AND vet_note IS NOT NULL AND btrim(vet_note) <> '' AND fit_score IS NOT NULL AND COALESCE(array_length(fit_reasons,1),0) > 0 AND ua_eligibility <> 'unlikely' AND (award_max_usd IS NULL OR award_max_usd >= 200000))`.
- Table constraint `funders_rejected_reason`: rejected rows need a non-blank reject_reason.
- register_source only: vetted needs a non-empty `fit.mission.quote` and a vet_note, else it is stored as candidate.
Evidence: judged dims carry `quote` (<=400 chars kept; plan says verbatim, <=240 recommended) and `why` (<=300); `evidence.award|deadline|eligibility` carry {quote, url}. Quotes must be copied from the official page (crawler copy `last_text` or `python supabase/grants/tools/fetch_text.py URL --grep "regex"`).
evidence_ok (trigger funders_fit_derive): for each of mission, activity, geography, precedent (from fit_inputs) and award, deadline, eligibility (from evidence) with a non-empty quote: normalize quote and `last_text` (lowercase, delete everything except a-z0-9); true only if `last_text` is not null, the normalized quote has >= 20 characters, and its FIRST 80 normalized characters occur inside the normalized last_text. Empty-quote keys are absent. A new funder has no `last_text` until the crawler fetches it, so evidence_ok is false/absent until then and rechecked when last_text updates.
facts_verified (v_funders, 0..4) = count of non-empty quotes for mission, eligibility, award, deadline (it does not require evidence_ok). metrics `evidence3` = facts_verified >= 3.

# B. Target queue: grants.targets
Columns: `id uuid, org text (not blank), program_hint, url_hint, bucket text, lens (<=40), priority smallint 1..3 (1 first), why (<=400), source (<=80), status text default 'pending', funder_id uuid, note (<=300), attempts smallint default 0, org_key (unique), created_at, updated_at`. Status: pending, covered, rejected, deferred.
Run procedure: take rows from `discovery_brief()->'targets'` (already ordered priority, biggest bucket gap, fewest attempts). For each: `check_known` with org/program_hint/url_hint; research; `register_source(..., target_id => the row id)` which closes it (vetted->covered, rejected->rejected, duplicate->covered/rejected by the existing status, candidate -> stays pending with note). If not registered (page unreachable, no program, login wall): `set_target(id, 'deferred', reason)` or `'rejected', reason`; `covered` only when a funder row exists. Every call raises attempts. `grants.add_targets(p jsonb array, p_source)` adds targets (bucket in the five below, skips orgs already in funders or targets by org_key; returns {received, added}); it is not in this API list but is how new targets are queued.

# C. Lanes and deadline (grants.v_funders)
deadline = earliest `deadline` of vetted open/forecasted opportunities that are not in the past, else funders.next_deadline. days_left = deadline - today. deadline_state: null deadline -> rolling (cycle rolling or open_ended), invite (invite_only), else unknown; past -> expired; days_left < min_days_left (14) -> too_soon; else ok.
lane (first match): `cultivate` if cycle = invite_only or ua_eligibility = invitation_only; `apply_now` if deadline not null and days_left >= 14; `rolling` if cycle in (rolling, open_ended); `prepare` if cycle = annual_recurring; else `watch`.
bucket (generated from category): us_federal -> us_federal; intl_dev_multilateral, bilateral_dev -> intl_dev; state_regional -> state_regional; corporate -> private_sector; aggregator -> tracker; all others (foundation, research_collab, prize_challenge) -> foundation_ngo.
amount_flag: null award unverified; >= min_award ok; else low.

# D. Reading the keys
discovery_brief keys: today, gates, rubric, theme_vocab, coverage, targets, reverify, failing, collection_gaps, metrics, last_runs, last_refresh (section 1). Run order that follows from it: log start, close `reverify` items via reverify_source, work `targets` and coverage gaps via register_source, fix `collection_gaps` via set_collection, add calls via upsert_opportunity, log finish.

# E. Allowed values (live check constraints)
- category: foundation, us_federal, intl_dev_multilateral, bilateral_dev, state_regional, corporate, research_collab, prize_challenge, aggregator.
- cycle: fixed_deadline, annual_recurring, rolling, open_ended, invite_only, closed_unknown.
- ua_eligibility: eligible, eligible_with_partner, invitation_only, unknown, unlikely.
- fetchability: easy, bot_protected, login_required, js_required, blocked, unknown.
- adapter: html, rss, grants_gov, sam_gov, eu_ft, json_api, none.
- page_type: html_static, html_js, api, rss, pdf, other.
- amount_confidence: published, estimated, unknown.
- funder status (vet status): candidate, vetted, rejected. Funder confidence 0..1; fit_score 0..100; award_min/max >= 0.
- opportunity status: forecasted, open, closed, archived. Opportunity vet_status: candidate, vetted, rejected.
- target status: pending, covered, rejected, deferred. Target bucket: us_federal, intl_dev, state_regional, private_sector, foundation_ngo. priority 1..3.
- team states (dashboard, not agent API): new, reviewing, applying, submitted, awarded, declined, skip.
- theme_vocab (16): agrivoltaics, solar & clean energy, water, agriculture, food security, climate adaptation, drought & heat, energy access, rural livelihoods, smallholder farmers, research, education & workforce, technology & innovation, land & conservation, international partnerships, equity & inclusion.

# F. Repo vs live
No substantive difference found for the 10 functions. Repo `010_radar_v2.sql` defines register_source with untyped string literals and then patches the live function in block `008c2` (types them `text '...'`), so the live body is the patched one; `011_collection.sql` replaces discovery_brief (adds collection_gaps) and metrics_now (adds collection) via text patching, so no single repo file shows the final body. Source of truth is the live definition.
