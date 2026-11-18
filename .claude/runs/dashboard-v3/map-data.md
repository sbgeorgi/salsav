# SALSAV grants data map (read-only, live profile 2026-11-17)

**Method:** read-only SELECTs via supabase-avs, every result aggregated or LIMITed. Definitions came from `pg_get_functiondef` and `pg_get_viewdef`, and privileges from `has_function_privilege`. No writes. Secret values were never read: `grants.settings` keys `passcode_hash` and `refresh_token_sha256` are named only. One query calling `public.grants_feed()` was blocked by the boundary guard; I did not retry it (see §13). Repo paths are relative to `supabase/grants/` unless noted.

## 0. Verified findings for the lead (read first)
- **F1 (high): `public.grants_feed()` is readable without a passcode.** It is SECURITY DEFINER with no `grants.check_pass` call, and anon, authenticated and public all have EXECUTE. Anyone with the anon key can read all 106 vetted non-aggregator funders with team owner and ask_usd, every vetted opportunity, vet and change history, and the 250 most recent rejected names and reasons (`screened`). `grants_set_state` and `grants_team_notes` do check `grants.check_pass` internally. `grants_check_pass` is also anon-executable, so the lockout settings (`lockout_failures`, `lockout_minutes`) are the only brake on passcode guessing. Verified from the catalog, not by calling the feed. Fix is a DB change for the lead: REVOKE EXECUTE on `grants_feed` from anon, authenticated and public, or add the passcode gate.
- **F2:** team actor is client-asserted. `dashboard.html:201` sends `actor: S.me || r.team.owner`. The server then uses `coalesce(p_patch->>'actor', p_patch->>'owner', 'team')`. The only person string in the data is `Christine`.
- **F3:** the client recomputes lanes (`dashboard.js:101-105`), duplicating `grants.v_funders.lane`. Drift risk.
- **F4:** `vet_events` has no actor column. `vetted_by` and `verified_by` hold only system labels (`discovery`, `audit`, `revet-2026-11-12`, `rescore-v2`, `collect-reconcile`). No record of a human decider exists.
- **F5:** `targets` has 67 rows, 0 pending. `discovery_brief` (empty queue) is the consumer.
- **F6:** one vetted aggregator row is invisible in the feed (category filter).
- **F7:** 22 `team_events` rows, all from one actor, between 17:41 and 17:45 UTC today, on 5 funders. Looks like test churn (inferred).
- **F8:** collection verification is nearly complete: 3 of 107 vetted funders have `collect_verified_at` null.

## 1. grants.funders (225 rows, 67 columns)
- **Columns:** id uuid; name, program, category, bucket, url, url_norm, name_key, apply_url, feed_url, page_type, fetchability, adapter, status, discovered_via, cycle, ua_eligibility, amount_confidence, award_note, eligibility_note, deadline_note, requirements_text, notes, vet_note, reject_reason, vetted_by, verified_by, collect_note, last_text text; geography text[], themes text[], partner_needed text[], fit_reasons text[]; award_min_usd, award_max_usd bigint; fit_score smallint; confidence real; next_deadline date; open_now bool; requirements, fit_inputs, fit_breakdown, evidence, evidence_ok, last_links, adapter_config jsonb; shard smallint; timestamps vetted_at, verified_at, collect_verified_at, last_checked_at, last_ok_at, last_changed_at, next_check_at, cooldown_until, lease_until; lease_run uuid; etag, last_modified, content_hash, last_status, consecutive_failures, idle_streak, robots_blocked, created_at, updated_at.
- **status:** rejected 117, vetted 107, candidate 1.
- **category (9):** foundation 56, corporate 41, us_federal 35, intl_dev_multilateral 28, research_collab 20, state_regional 17, bilateral_dev 13, prize_challenge 10, aggregator 5 (1 vetted).
- **bucket (6):** foundation_ngo 86, intl_dev 41, private_sector 41, us_federal 35, state_regional 17, tracker 5. The 5 non-tracker buckets are the five category filters (bucket color tokens, see §12).
- **discovered_via (8):** seed 115, corporate 40, foundation 16, federal 14, research_collab 12, state 12, intl_dev 9, prize 7.
- **cycle (6):** closed_unknown 113, annual_recurring 37, invite_only 32, fixed_deadline 23, rolling 12, open_ended 8.
- **ua_eligibility (5):** unknown 103, eligible 43, unlikely 30, invitation_only 27, eligible_with_partner 22.
- **amount_confidence:** unknown 144, published 66, estimated 15.
- **page_type:** html_static 182, html_js 36, api 4, other 2, pdf 1. **fetchability:** easy 185, unknown 25, js_required 7, bot_protected 6, login_required 2. **adapter:** html 176, grants_gov 18, rss 12, json_api 12, none 5, eu_ft 2.
- **Funding size:** award_min_usd 17 non-null (7.6%), range 1 to 1,000,000, median 100,000. Note the NOAA row has award_min_usd=1 (sentinel). award_max_usd 77 non-null (34.2%), range 15,000 to 46,000,000, p25 375,000, median 1,000,000, p75 5,000,000. Either amount present 78 (34.7%).
- **Gates:** `settings.min_award_usd` = 200000; `min_days_left` = 14; `fit_rubric.min_fit` = 40.
- **Keywords and scores:**
  - `themes` text[]: 16 canonical in `settings.theme_vocab`, plus free-form values. Top: agriculture 89, climate adaptation 84, water 73, research 62, technology & innovation 58, international partnerships 43, solar & clean energy 39, land & conservation 38, food security 28. Off-vocab examples: energy 6, climate 5, climate-smart agriculture 4, food systems 3, renewable energy 3.
  - `geography` text[]: unnormalized. Examples: US 73 vs "United States" 3; global 45 vs Global 19; AZ 8 vs Arizona 13.
  - `fit_reasons` text[]: mostly `"Label: value (x/max)"`, e.g. `Mission match: Direct nexus (27/35)`, `Track record: None found (0/5)`. Legacy bare tokens too (`climate`, `water`).
  - `fit_inputs` jsonb keys: mission, geography, activity, precedent (167 rows; each `{url, why, level, quote}`).
  - `fit_breakdown` jsonb: `{v:2, dims:[{key,max,label,level,quote,url,why}], total, tier}`. The six dims (inferred from fit_reasons labels): Mission /35, Type of work /15, Where the work can happen /15, Can UA apply /20, Award size /10, Track record /5.
  - `evidence` jsonb keys: eligibility 117, award 78, deadline 76 (non-empty counts).
  - `requirements` jsonb keys: registrations 31, loi 31, cost_share 25, indirect_cap 21.
  - `partner_needed` text[]: 30 non-empty, freeform.
- **Fit score distribution:** 0s 22, 10s 5, 20s 20, 30s 36, 40s 29, 50s 39, 60s 33, 70s 14, 80s 6, null 21 (all rejected).
- **Null or empty shares (n=225):** geography empty 26 (11.6%); themes empty 14 (6.2%); partner_needed empty 195 (86.7%); fit_reasons empty 21; evidence empty 87 (38.7%); notes null 102; eligibility_note null 39; requirements_text null 87; award_note null 52; next_deadline null 192 (85.3%); open_now null 67; last_text null 80; vet_note null 58; fit_inputs null 58.
- **Lane (v_funders, all statuses):** watch 115, cultivate 35, apply_now 31 (8 of them rejected), prepare 26, rolling 18.

## 2. Rejected funders (117)
- **Where reasoning lives:** `funders.reject_reason` (117/117 non-null, 115 distinct strings, median 144 chars) is the primary text. Secondary: `funders.vet_note` (59 non-null), `discovery_log.reason` (same text, one row per funder), `vet_events.note` (kind `registered` = first decision, kind `demoted` = demotion note). 76 rejected rows have no `vetted_by`. 35 rejected funders have no `vet_events` row. All 117 have a `discovery_log` row.
- **Reason codes:** none. No enum or code column. Machine-generated text exists (from `grants.gate_reason`, `010_radar_v2.sql:213`): `Fit score N is below the minimum of 40.`, `Largest single award ($X) is below the $200,000 minimum.`
- **Heuristic classes (regex, inferred), split by origin:**

| origin | fit_gate | amount_below | no_open_call | ua_ineligible | other | total |
|---|---|---|---|---|---|---|
| registered_rejected | 11 | 27 | 25 | 7 | 6 | 76 |
| demoted_from_vetted | 28 | 0 | 2 | 1 | 10 | 41 |

- **Example rows (6, newest first; all `last vet_event kind=registered`, all bucket private_sector, category corporate):**

| name (id8) | fit | when (UTC) | decided by (run_label) | reason (≤160 chars) |
|---|---|---|---|---|
| OCP Group (e86fd693) | null | 11-17 16:47 | discovery-2026-11-17 | This is a 2021 agreement under which OCP Group gives UM6P $300,000 and ICL gives Ben-Gurion University $300,000 for scholarships at those two named universities |
| MN8 Energy (ca2e639f) | null | 11-17 16:44 | discovery-2026-11-17 | MN8 Energy is a solar developer whose only found agrivoltaics research money is a one-time $300,000 gift to West Virginia University (June 2025); it publishes n |
| California Forever (80bd704a) | 64 | 11-17 16:44 | discovery-2026-11-17 | A one-off directed gift from a land developer to UC Davis for its own agrivoltaics research. The company states no application route, call or program open to ot |
| CHS Foundation (aa3992bf) | 29 | 11-16 15:41 | discovery-2026-11-16 | Fit score 29 is below the minimum of 40. (vet_note: funds university ag education in Midwest/Plains, poor match) |
| KFUPM Consortium (51ffea94) | 37 | 11-16 15:41 | discovery-2026-11-16 | Fit score 37 is below the minimum of 40. (vet_note: applicants must be KFUPM faculty; agriculture out of scope) |
| Syngenta Foundation (c2a5cc94) | null | 11-16 15:40 | discovery-2026-11-16 | The foundation's parent company decided to phase out its financial support in 2022 and the Swiss headquarters closed in 2024, so it no longer funds. Its work mo |

- **Decider:** every recorded decider is a run label or system name, never a person. Human identity exists only in `team_state` and `team_events` (§5).

## 3. Decision history: vet_events (410) and discovery_log (225)
- **vet_events** columns: id bigint, funder_id, at, kind, note, changes jsonb, run_label. No actor column. Kinds: updated 165 (103 funders), registered 102, demoted 45, rescored 38, promoted 38, verified 22.
- **changes shape:** `{field: [old, new]}`. Key counts: status 188, fit_score 223, collection 110, adapter 110, amount_confidence 45, ua_eligibility 43, open_now 21, cycle 30, award_max_usd 36, next_deadline 17, award_min_usd 6.
- **Precedent for demote and promote (already in use, via revet/collect runs):**
  - demoted 061b878e (Convocatoria 49, run discovery-2026-11-12): `{"status":["vetted","rejected"],"fit_score":[47,40],"ua_eligibility":["unknown","unlikely"]}`
  - demoted 7584f360 (duplicate, collect-2026-11-12): `{"status":["vetted","rejected"]}`
  - promoted 908c4f15 (USDA partnership, revet-2026-11-12): `{"status":["rejected","vetted"],"fit_score":[null,55],"award_max_usd":[null,25000000]}`
  - promoted dbd50a7e (CCARDESA, revet-2026-11-12): `{"status":["rejected","vetted"],"fit_score":[46,56]}`
- **discovery_log** columns: id bigint, url, url_norm, name, lens, outcome, reason, run_label, funder_id, found_at. Outcomes: vetted 114, rejected 107, candidate 4. `duplicate` and `unreachable` are referenced in `grants_feed` but have 0 rows. Lenses: seed 115, corporate 40, foundation 16, federal 14, research_collab 12, state 12, intl_dev 9, prize 7.
- **discovery_runs:** columns run_label, started_at, finished_at, summary, stats jsonb (not profiled).

## 4. grants.opportunities (120 rows)
- **Columns:** id uuid, funder_id uuid (50 funders have opportunities), external_id, title, url, apply_url, description, open_date, deadline, deadline_text, award_min_usd, award_max_usd bigint, status, vet_status, scope_score smallint, doc_links jsonb, source_adapter, first_seen_at, last_seen_at.
- **status:** open 60, closed 58, forecasted 2. **vet_status:** vetted 49, candidate 32, rejected 39. **source_adapter:** html 77, eu_ft 17, json_api 12, grants_gov 11, rss 2, discovery 1.
- **Amounts:** both null 107 (89%); award_max range 310,000 to 20,000,000. Deadline null 25. Description null 10, median 166 chars.
- **Tags and keywords:** none. Text sources are title and description only. `scope_score` is null 120/120 and `doc_links` empty 120/120, so both are unused.
- **Duplicates:** 0 on (funder_id, external_id); 4 extra rows on (funder_id, lower(url)).
- **Counts:** closed or rejected 95 (79%); live (vetted and open or forecasted) 25.
- **Links:** `opportunities.funder_id` → `funders.id`. No team or pipeline link at opportunity level.
- **Feed filter (live definition):** funder status vetted AND `o.vet_status in ('vetted','candidate')` AND `o.status in ('forecasted','open')` AND (`o.deadline is null` OR `o.deadline >= today Phoenix`).

## 5. team_state (5 rows) and team_events (22 rows)
- **team_state:** funder_id PK, state, owner (≤80, free text), notes (≤4000, overwritten), updated_at, updated_by (actor string), ask_usd bigint (0 to 1e11; `010_radar_v2.sql:27`).
- **State enum** (enforced in `grants_set_state`, not a DB constraint): new, reviewing, applying, submitted, awarded, declined, skip.
- **Rows (all state new, all vetted, notes empty, ask_usd null):** Welthungerhilfe (owner Christine, 11-17 17:45:09), Greenacres Foundation (owner null, 17:43:23), USDA NIFA (owner null, 17:43:21), FFAR (owner Christine, 17:43:18), USDA SARE Western (owner null, 17:41:33). `updated_by` is Christine on all five.
- **team_events:** id bigint, funder_id, at, actor, kind (only `update` in data), payload jsonb. Payload keys: state 22, notes_changed 22, owner 2. Actor is Christine 22/22. **Note text is never stored in events**, only the `notes_changed` boolean.
- **5 example rows (newest first):**
  - id 22, Welthungerhilfe, 17:45:09: `{"state":"new","notes_changed":false}`
  - id 21, Welthungerhilfe, 17:44:51: `{"owner":"Christine","state":"applying","notes_changed":false}`
  - id 20, Welthungerhilfe, 17:44:06: `{"state":"reviewing","notes_changed":false}`
  - id 19, Welthungerhilfe, 17:43:25: `{"state":"new","notes_changed":false}`
  - id 18, Greenacres Foundation, 17:43:23: `{"state":"new","notes_changed":false}`
- **Server contract (`public.grants_set_state(p_pass text, p_funder uuid, p_patch jsonb)`, `010_radar_v2.sql:745`):**
  - `if not grants.check_pass(p_pass) then raise exception 'bad passcode'`
  - `if not exists (select 1 from grants.funders where id=p_funder and status='vetted') then raise exception 'unknown funder'`
  - `v_actor := left(coalesce(p_patch->>'actor', p_patch->>'owner', 'team'), 60)`
  - event payload: `(p_patch - 'actor' - 'notes') || jsonb_build_object('notes_changed', p_patch ? 'notes')`
- **Feed team block:** `{state (coalesce 'new'), owner, ask_usd, updated_at}`. No notes, no updated_by.
- **Zero team rows exist on non-vetted funders.**

## 6. targets (67 rows) and the agentic queue
- **Columns:** id, org, program_hint, url_hint, bucket, lens, priority smallint, why, note, status, funder_id (56 linked, including all 38 rejected targets), source, attempts, org_key, created_at, updated_at.
- **status:** rejected 38, covered 19, deferred 10, **pending 0**. **bucket:** private_sector 22, foundation_ngo 19, us_federal 15, intl_dev 8, state_regional 3. **lens:** corporate 19, research_collab 15, foundation 12, federal 11, prize 4, intl_dev 3, state 3. **source:** radar-v2 research 54, discovery-2026-11-12 6, ngo-wave-2026-11-12 4, discovery-2026-11-16 3.
- **Example rows (newest):** MN8 Energy (rejected, priority 2, linked, discovery-2026-11-16); California Forever (rejected, linked); OCP Group (rejected, linked); Bayer Grants4Ag via Halo Science (rejected, discovery-2026-11-12); Amazon Science (rejected, priority 3).
- **Consumer:** `grants.discovery_brief()` (`010_radar_v2.sql:627`) reads pending targets ordered by priority, coverage gap, attempts and created_at (top 30). It also returns `reverify` (up to 20 vetted funders with null fit_breakdown, expired deadlines or failing evidence), `failing` (consecutive_failures ≥ 3), and `collection_gaps` (up to 15). Coverage gap is `coverage_min` minus listed vetted funders per bucket.

## 7. grants.settings (10 keys, names and feature config only)
- **Feature config:** `fit_rubric` (object: dims, min_fit=40, tiers, version); `theme_vocab` (array, 16 items); `min_award_usd` = 200000; `min_days_left` = 14; `coverage_min` (object over the five non-tracker buckets: foundation_ngo 30, private_sector 15, us_federal 12, intl_dev 12, state_regional 8); `db_ceiling_mb` (number).
- **Auth ops:** `lockout_failures`, `lockout_minutes`.
- **Secret-named (values not read):** `passcode_hash`, `refresh_token_sha256`.

## 8. RPC surface and payload shape
- **`public.grants_feed()`** returns jsonb. STABLE, SECURITY DEFINER, `search_path ''`, no passcode (F1). Definition read from `pg_get_functiondef`. Live key listing was blocked (§13), so the keys below come from source (high confidence).
  - **Top level:** generated_at, min_days, min_award, rubric, vocab{themes}, coverage_min, funders[], opportunities[], changes[], vetting[], metrics[], discovery{runs[], by_lens[], totals{examined, vetted, rejected, candidate}}, targets{by_bucket[], next[]}, screened[], collection, last_run, runs_24h{runs, fetched, changed, errors}.
  - **funders[] element:** `to_jsonb(grants.v_funders row) - 'status'` + `team{state, owner, ask_usd, updated_at}` + `collection` (= `grants.collection_state(id)`). Filter: `v.status='vetted' and v.category <> 'aggregator'`. Order: deadline nulls last, fit_score desc, name.
  - **opportunities[] element:** id, funder_id, title, url, apply_url, description, open_date, deadline, deadline_text, award_min_usd, award_max_usd, status, doc_links, first_seen_at, last_seen_at, source_adapter, vet_status. No external_id, no scope_score, no team link.
  - **changes[] element:** funder_id, at, kind, summary, docs_added, deadline (snapshots, last 120 days, non-error, vetted non-aggregator).
  - **vetting[] element:** funder_id, at, kind, note, changes, run_label (vet_events, last 180 days, vetted non-aggregator).
  - **screened[] element:** name, program, bucket, reason, at. **No id, no category.** Rejected non-aggregator rows, 250 max, ordered by updated_at desc. Currently 117 rows, so no truncation yet.
  - **discovery.by_lens[] element:** lens, examined, vetted, rejected. **discovery.runs[] element:** run_label, started_at, finished_at, summary, stats, examined, vetted, rejected, duplicate.
  - **targets.by_bucket[] element:** bucket, pending, covered, rejected, deferred. **targets.next[]:** 15 rows (org, program_hint, bucket, priority, why).
- **`grants.v_funders` (`010_radar_v2.sql:546`)** has 49 columns, includes all statuses, and adds computed fields:
  - `deadline` = min deadline of vetted open or forecasted opportunities ≥ today, else `next_deadline`
  - `days_left`
  - `deadline_state` ∈ rolling | invite | expired | too_soon | ok | unknown
  - `amount_flag` ∈ unverified | ok | low
  - `facts_verified` (0 to 4)
  - `lane`: cultivate if cycle=invite_only or ua=invitation_only; apply_now if deadline and days_left ≥ 14; rolling if cycle rolling or open_ended; prepare if annual_recurring; else watch
- **`grants.collection_state(id)`** (`011_collection.sql:27`) returns `{mode, health, source, checked_at, ok_at, open_calls, total_calls, last_call_at, note, verified_at}`. Health ∈ off | failing | stale | empty | thin | ok. `verified_at` = `collect_verified_at`.
- **`public.grants_team_notes(p_pass)`** returns `{team: all team_state rows, events: last 100 team_events}`. Passcode-checked internally.
- **`public.grants_set_state(p_pass, p_funder, p_patch)`**: passcode via `grants.check_pass`; funder must be vetted; state enum; `ask_usd` between 0 and 1e11; notes ≤4000. Writes `team_state` plus one `team_events` row.
- **`grants.check_known(p jsonb)`** (`010_radar_v2.sql:612`): dedupe. Matches on name_key plus program, url_norm, or name_key prefix ≥6 chars. Returns status and reject_reason for hits, so discovery sees rejected funders.
- **`grants.reject_opportunity(p_id uuid, p_reason text, p_run_label text)`** (`021_candidate_calls.sql:19`): demote path for one opportunity. Not executable by anon, authenticated or public, and no public wrapper exists.
- **`grants.set_target(p_id uuid, p_status text, p_note text)`**: not exposed to anon, authenticated or public.
- **Privileges (catalog-verified):** grants_feed, grants_set_state, grants_team_notes and grants_check_pass are SECURITY DEFINER with EXECUTE for anon, authenticated and public. `grants.check_pass`, `grants.reject_opportunity` and `grants.set_target` are not exposed.
- **Consumers in the repo:** `dashboard.html:168` (grants_feed), `:187` (grants_team_notes), `:201` (grants_set_state, actor from `S.me || r.team.owner`), `:531` (grants_check_pass).

## 9. Crawler, cron and scheduled discovery
- **cron.job:**
  - `grants-refresh-am`: `0-45/3 13 * * *` (UTC) → `grants.kick_refresh_shard` (`022_staggered_refresh.sql:9`)
  - `grants-refresh-pm`: `0-45/3 1 * * *` (UTC) → same
  - `grants-metrics`: `20 1,13 * * *` → `grants.snapshot_metrics`
  - Each window fires 16 kicks at 3-minute spacing (inferred from the cron expression and the commit history).
- **Shards and queue:** `funders.shard` non-null on 225/225. Partial index `funders_queue_idx (shard, next_check_at) WHERE status='vetted'` (`001_schema.sql:136`). Leases via `grants.claim_sources` (`002_api.sql:63`) using `lease_until` and `lease_run` (inferred as the claim path).
- **Edge function:** `supabase/functions/grants-refresh/` (not read).
- **Local scheduled task:** `salsav-funding-discovery`, cron `0 7 * * 2,5` (Tue and Fri 07:00 local). SKILL at `C:\Users\georg\.claude\scheduled-tasks\salsav-funding-discovery\SKILL.md` (not read). Last run 2026-11-17 15:12 UTC; next 2026-11-20 13:08 UTC.

## 10. Fields usable for Galaxy clustering (ranked, coverage of 225)
1. category, 9 levels: 100%
2. bucket, 6 levels (5 filter buckets + tracker): 100%
3. cycle, 6 levels (closed_unknown is 50%): 100%
4. themes text[], 16 canonical plus free-form: 93.8%
5. fit_score (0 to ~89, 21 nulls, all rejected): 90.7%
6. fit_reasons text[] (structured `label: value (x/max)`): 90.7%
7. geography text[] (needs normalization): 88.4%
8. ua_eligibility, 5 levels (unknown 45.8%): 100% populated, 54.2% informative
9. award_max_usd (log scale): 34.2%. award_min_usd: 7.6%
10. fit_breakdown dims and fit_inputs levels (mission, geography, activity, precedent): 74.2%
11. evidence jsonb (eligibility, award, deadline): 61.3%
12. partner_needed: 13.3%
- **Text for keyword extraction:** program 100%, eligibility_note 82.7%, award_note 76.9%, last_text 64.4%, requirements_text 61.3%, notes 54.7%.
- **Not present:** embeddings, x/y coordinates, cluster id, tags.

## 11. Data gaps (planned features need these, no column holds them)
1. **Reason codes** for rejections. Only free text (115 distinct).
2. **Person identity.** Actor and owner are client strings. There is one shared passcode. `vet_events` has no actor column. Owner attribution and "vetted user" permissions need a user model.
3. **Note history.** `team_state.notes` is one 4000-char overwrite per funder with no author. `team_events` stores only a boolean.
4. **Quick notes on projects** for opportunities and rejected funders: nothing exists.
5. **Opportunity-level pipeline or owner:** none. `team_state` is keyed by funder_id only.
6. **Progressed flag:** none. The feed filter drops rejected or demoted funders regardless of team state. `grants_set_state` refuses non-vetted funders, so a rejected funder cannot carry pipeline state.
7. **Public demote and promote RPCs:** none for funders or opportunities.
8. **Rejected funder detail with id:** `screened[]` has no id and no category. No RPC returns rejected detail.
9. **Queue for promoted funders:** `targets` is discovery-facing. Nothing records a promotion queue, and 0 targets are pending.
10. **Galaxy coordinates, embeddings, tags** (funders or opportunities).
11. **Normalized geography and currency.** USD only, with a sentinel award_min_usd=1.
12. **Duplicate outcomes:** `duplicate` and `unreachable` are referenced but never written.

## 12. Hooks for the planned features
1. **Persistent nav search with autocomplete.** Suggestions come from `grants_feed().funders[].name/program/themes/geography` and `opportunities[].title`. Rejected names only from `screened[].name` (no id). Payload is vetted-only, so searching rejected funders needs a new passcode-gated RPC. Nav UI is frontend (not my subsystem). Trap: F1, since search over the feed is currently public.
2. **Category colors.** Chips use bucket values. `dashboard.html:144` `bcolor = var(--b-${b in D.BUCKETS ? b : 'tracker'})`, with tokens in `dashboard.css:12` (light) and `:33` (dark): us_federal, intl_dev, state_regional, private_sector, foundation_ngo, tracker. The five category filters are the five non-tracker buckets. Lanes only have `.lane--apply_now` (`dashboard.css:242`). Key colors on bucket, not category (9 values). Labels: `dashboard.js:4-5`, `dashboard.html:142`.
3. **Pipeline status in sidebar; tags at top.** Pipeline is the funder element's `team.{state, owner, ask_usd, updated_at}`. Tags are `themes` and `geography`, both already in the payload. Trap: missing team row coalesces to `new`, so "no pipeline" and "new" look identical.
4. **Owner attribution and history.** Use `grants_team_notes(p_pass).events` (last 100, payload keys state, owner, notes_changed). Owners come from `team_state.owner` and `updated_by`. Server-side actor is in `grants_set_state` (`010_radar_v2.sql:745`). Trap: F2, plus notes text is absent from events and the passcode is shared.
5. **Database tab (rejected funders, promote and demote).**
   - Source: `funders where status='rejected'` (117) with `reject_reason`, `vet_note`, `vetted_by`, and history from `vet_events` (`registered`, `demoted`, `promoted`).
   - Promote a funder: set status `rejected` → `vetted` and insert `vet_events` kind `promoted` (precedent in §3).
   - Demote a funder: set `vetted` → `rejected` and insert kind `demoted`.
   - Demote an opportunity: `grants.reject_opportunity` (`021_candidate_calls.sql:19`) needs a passcode-gated public wrapper.
   - Trap: `grants_set_state` rejects non-vetted funders, and `screened[]` has no id. The new RPC must return `funders.id`.
6. **Agentic queue for promoted funders** (judgment; inferred). After promotion: set `funders.next_check_at = now()` so the collection queue picks it up via `funders_queue_idx` (`001_schema.sql:136`), and leave `verified_at` null so it appears in `discovery_brief.reverify`. If a linked `targets` row exists (38 rejected targets are linked), reopen it to `pending` instead of inserting a duplicate.
7. **Radar keeps progressed projects, with a visual flag.** The filter to change is `v.status='vetted' and v.category<>'aggregator'` (live definition; repo source `010_radar_v2.sql:664`, later patches in 011, 014, 018, 021). Change it to also include `or t.state not in ('new','skip')` and add a `progressed` boolean to the funder element. Opportunity filter also drops progressed rows once closed. Trap: rejected funders cannot hold team state today (`unknown funder` guard).
8. **Quick notes across surfaces.** Options: a new table `grants.notes(id, funder_id or opportunity_id, body, actor, created_at)` with a passcode-gated RPC; or reuse `team_state.notes` as a single overwrite field (fallback only). Expose through `grants_team_notes`, not the feed (F1). Trap: `team_events` has no note body.
9. **Galaxy.** Source is `funders[]` in the feed (106 vetted non-aggregator) or `v_funders` columns, which include rejected rows. Rejected rows need the new RPC. Use the §10 ranking. Normalize geography and themes. Add a precomputed x, y, cluster table (inferred). Trap: amount coverage is 34%, and `award_min_usd=1` is a sentinel.
10. **Crawler, shards and scheduled task.** Cron jobs call `grants.kick_refresh_shard` (`022_staggered_refresh.sql:9`) and `grants.snapshot_metrics`. Promoted funders join the queue via `shard` and `next_check_at`. The `salsav-funding-discovery` task reads `check_known` and `discovery_brief`, so demoted funders must stay in `check_known` to avoid re-adding them. Promoted funders must not be re-rejected by the `min_fit` gate (40). Trap: `duplicate` and `unreachable` outcomes are referenced but never written.

## 13. Boundary batch (for the lead to run; read-only, nothing to roll back)
- **Blocked query, to run from the lead's session:** `SELECT k, jsonb_typeof(public.grants_feed() -> k) AS typ FROM jsonb_object_keys(public.grants_feed()) AS k ORDER BY 1;`
- **Element keys (same session):** `SELECT k FROM jsonb_object_keys((public.grants_feed() -> 'funders') -> 0) AS k;` (repeat for `opportunities`, `screened` and `team`, if needed).
- **Blocking note:** the guard treats any call to `grants_feed()` as a write, so these may be blocked too. The source-based shape above is the fallback.