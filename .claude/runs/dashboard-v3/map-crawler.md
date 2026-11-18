# grants-refresh, crawler, shards and scheduler: map for the planned features

Read-only pass on 2026-11-17. Nothing written, nothing deployed, nothing pushed. "live" = read from supabase-avs with SELECT only. "file" = local file. "(inferred)" = not read directly.

## 1. Live state (verified)
- **cron.job** (3 rows):
  - `grants-refresh-am`, `0-45/3 13 * * *`, `select grants.kick_refresh_shard('cron-am', (extract(minute from now())::int / 3) % 8)`
  - `grants-refresh-pm`, `0-45/3 1 * * *`, same with `'cron-pm'`
  - `grants-metrics`, `20 1,13 * * *`, `select grants.snapshot_metrics()`
  - No `grants-prune` row. 003e was never applied.
- **grants.refresh_runs, last 3 days**: cron-am ok 21 / error 11 (errors all at or before 11-16 13:00, before the 022 fix). cron-pm ok 19 / error 13. The only non-ok rows since 11-16 15:40 are: cron-pm 11-17 01:12 shard 4 (www.uaerep.ae, known TLS), a cron-test partial on 11-16 16:36, and today's 16:47 probe partial.
- **grants.funders, live counts**:
  - vetted 107 (grants_gov 18, html 64, json_api 11, rss 12, eu_ft 2). auto_vet true on 39. Due now 16. Leased 0, cooling 0.
  - Among vetted: adapter_config has `list` on 39, `self` on 19, empty config on 6. collect_verified_at set on 104.
  - rejected 117 (html 112, json_api 1, none 4). reject_reason set on all 117. All already due but excluded by status. Leased 0, cooling 0. Empty adapter_config on 116. fit_inputs set on 61. fit_score >= 40 on only 15. collect_verified_at set on 0.
  - candidate 1 (adapter none).
- **grants.opportunities** (funder status / vet_status / status):
  - vetted funder: vetted+open 24, vetted+forecasted 1 (25 rows the feed would show; state.md says 27, unreconciled). vetted+closed 24 (19 past deadline). candidate+closed 32. rejected+open 34, rejected+forecasted 1, rejected+closed 2.
  - rejected funder: rejected+open 2.
- **Edge function grants-refresh**: version 10, ACTIVE, verify_jwt false, import_map true. updated_at 1794498960000 ms decodes to 2026-11-12 15:56Z (computed). created 2026-11-11 22:48Z.
- **Live function definitions read**: kick_refresh_shard, kick_refresh, claim_sources, remaining_due, upsert_opportunity, reject_opportunity, sweep_opportunities, reverify_source, discovery_brief. apply_fetch_result was listed (def_len 7436) but its body was not diffed against 002_api.sql + 020.

## 2. Request path (file)
- `index.ts:15-25`: Deno.serve → `handle()`. `makeSql` = postgres, max 3 (`index.ts:17`).
- `handler.ts:36-72`: POST only. `x-grants-token` format check (`:19`, `:38-39`), then `grants.check_refresh_token` (`:44`). `parseRequest` (`:22-34`): shards 1..64, shard 0..63, max_sources default 12 cap 50, budget_ms default 100000 range 1000..140000, chain_depth 0..100, dry_run, only_ids (uuid list), parent_run. `canChain = supabaseUrl && !dry_run` (`:54`). Self-chain POST (`:56-64`).
- `engine.ts runShard` (`:91`):
  - startRun, then claim (`:108-110`). dry_run uses peek, which takes no lease.
  - Group by `groupOf` (`:62`): host, or `api:<adapter>` for grants_gov, sam_gov, eu_ft, json_api.
  - One worker per host (maxPerHost 1). Politeness defaults (`politeness.ts:13`): minInterval 2000 ms, jitter 1000, globalMax 4, crawlDelayCap 30000.
  - fetchSource → toPayload (`:64-89`) → store.apply → `grants.apply_fetch_result`.
  - softStop = deadline − min(15 s, 30% of budget) (`:95`).
  - finally (`:179-193`): release leases (`:181`), remainingDue (`:182`), `chained = canChain && pending>0 && chain_depth<6` (`:184`), hostSave (`:188`), finishRun (`:189`).
- `store.ts`:
  - `SOURCE_COLS` `:8-9`.
  - `claim` `:27-37` calls the `grants.claim_sources` RPC. Its `only_ids` branch (`:28-34`) leases by id and checks only status='vetted' and adapter<>'none', so it ignores next_check_at and shard.
  - `peek` `:39-48` uses its own SQL with the same DUE filter (`:11-12`).
  - `remainingDue` `:49-52`, `release` `:68-73`, `defer` `:75-80`.
- `adapters/index.ts`: `configError` `:82`. `fetchSource` `:411`, `fetchSourceInner` `:421-441`. One fallback at `:430-440`: html → feed_url, or api/feed → html page. Never onto a cooling host. A js_required second page is rejected.
- Payload contracts: `types.ts:96-118` (Fetched), `:120-137` (ResultPayload). Opportunity shape `types.ts:46-59`.

## 3. How a funder becomes collectable
- **Tracked and auto-updated** = `status='vetted' AND adapter<>'none'`. This filter appears in claim_sources, peek, remaining_due, and the store.claim only_ids branch.
- **status check** `001_schema.sql:96`: candidate | vetted | rejected.
- **vetted constraints**:
  - `funders_vetted_scope` (`001:124-132`): vetted_at set, vet_note non-empty, fit_score not null, fit_reasons non-empty, ua_eligibility<>'unlikely', award_max null or >= 200000.
  - `funders_vetted_fit` (end of `010_radar_v2.sql`, grants_008e block): fit_inputs not null AND fit_score >= 40, unless category='aggregator'.
  - `funders_rejected_reason` (`001:133`): rejected needs reject_reason.
- **Collection mode** (file `011_collection.sql:17-25`):
  - `calls`: adapter in grants_gov, eu_ft, sam_gov, json_api, rss, or html with `list`.
  - `cycle`: html with `self` and no list.
  - `page`: html with neither. Change watch only, writes no opportunities.
  - `none`: adapter none.
- **adapter_config keys** (`COLLECT.md` C1): auto_vet, filter, max_items (default 40, cap 100), date_order, list{...}, self{...}, detail, also_page, deadline_regex.
- **Config contract**: `supabase/grants/collect/cfg/<id8>.json` (COLLECT C3). Applied with `grants.set_collection(p_id, jsonb, label)` (`011:100`), which clears conditional-fetch state so the next run re-baselines.

## 4. Shards and stagger (live-verified)
- `funders.shard` is GENERATED (`001:94`): `(hashtext(split_part(grants.url_norm(url),'/',1)) & 63)`. It is per host, 0..63. The scheduler uses `shard % 8`. Index `funders_queue_idx (shard, next_check_at) where status='vetted'` (`001:136`). A promoted funder needs no shard assignment.
- Cron fires at minutes 0,3,…,45 of hours 13 and 01 UTC. shard = (minute/3) % 8, so each shard is hit twice per window, 24 minutes apart. refresh_runs confirms it: 13:24 → shard 0, 13:45 → shard 7.
- Per request body (`022_staggered_refresh.sql:25-26`): `{shard, shards:8, trigger, budget_ms:100000, max_sources:4, chain_depth:6}`. chain_depth 6 disables self-chaining (engine `:184`).
- Capacity: 8 shards × 2 × 4 = 64 source fetches per window. 16 are due now.
- state.md says shard 4 holds all Grants.gov funders (from state.md; the shard is not re-derived here). That shard therefore has 8 fetches per window.
- Next window: 2026-11-18 01:00 UTC (= 11-17 18:00 Phoenix). A promoted funder waits at most one window (about 12 h) unless an immediate path is added (section 9).
- Size guard: `grants.settings.db_ceiling_mb = 350` (`007`, `022:14-18`). Over the ceiling, the kick returns 0 with a warning only.

## 5. Opportunities: upsert, diff, tracked vs rejected
- **apply_fetch_result** (`002_api.sql:112-190`):
  - Locks the funder row (`:122`). No status check.
  - not_modified (`:125-129`), error (`:131-146`, backoff `:134`, snapshot on failure 1 and every 4th `:142`), ok (`:148-170`).
  - Snapshot and last_text written only when content_hash changes (`:158-165`). next_deadline only for html cycles (engine `:85`).
- **Idle backoff** (`020`): next = now + next_check_s × 2^min(idle_streak,2), so 11.5 h → 23 h → 46 h. Reset when a deadline is within 10 days or the collect config was re-verified.
- **Opportunity upsert** (`002:172-189`):
  - `vet_status = 'vetted'` if adapter_config.auto_vet, else `'candidate'` (`:174`, `:181`).
  - `ON CONFLICT (funder_id, external_id) DO UPDATE` (`:183-187`) sets title, url, apply_url, description, open_date, deadline, deadline_text, award, `status = excluded.status`, scope_score, doc_links, last_seen_at.
  - It does NOT touch vet_status. Unique key `opportunities_ext_key` (`001:166`).
  - Consequence: a rejected or candidate row stays rejected across crawls. The crawler only re-creates a row that does not exist (deleted, or a new external_id).
- **external_id** (COLLECT C1): link URL without utm, trailing slash, or plain-anchor hash. Otherwise `t:<lowercased title>`. A title edit creates a new id, so a demoted call can reappear as a new row.
- **Closing**: `sweep_opportunities` (`011:81-96`) sets closed when deadline < Phoenix today, and archived for undated calls a healthy source stopped listing for 21 days. It is called from `snapshot_metrics` (`011:238`), so it runs from the grants-metrics cron.
- **Visible to the dashboard** (file `010_radar_v2.sql`, grants_feed, about line 685): `f.status='vetted' AND o.vet_status='vetted' AND o.status in ('forecasted','open')`.
- **reject_opportunity** (`021:19`, live def verified): works only when vet_status='candidate'. A vetted row returns `{"result":"unchanged"}`. There is no vetted → rejected path for calls.
- **upsert_opportunity** (`010:444-468`, live def verified): raises unless the funder is status vetted. ON CONFLICT sets `vet_status = 'vetted'`. This re-vets a demoted call if discovery resubmits it.

## 6. Limits
- Edge worker wall clock 150 s (state.md, measured). CPU kill HTTP 546 when shards run in parallel (022 header).
- budget_ms default 100000, range 1000..140000 (`handler:30`). softStop as in section 2. Probe: budget 140000, timeout 150000 (`019:14-15`).
- requestTimeoutMs 20000 (`engine:116`). Lease 240 s (`engine:leaseS` default).
- Politeness: 2 s min gap per host, plus up to 1 s jitter, one request per host at a time.
- Storage caps: TEXT_MAX 60000 (`engine:10`, SQL `002:160`). Opportunity title 400 and description 2000 (`002:178`). upsert_opportunity title 300 and description 1200. Postgres pool max 3 (`index.ts:17`).
- Error backoff `002:134`: 21600 × 2^min(fail−1,3), capped at 259200. The formula tops out at 48 h, but the comment says 72 h.

## 7. Deployed vs local
- Live grants-refresh v10, updated 2026-11-12 15:56Z (computed from epoch).
- `.deploy-ok.json` stamped 2026-11-16T15:37:36Z, 19 files, hashes over LF-normalised content.
- Local hashes vs stamp: 18 match. The four CRLF files (collect.ts, extract.ts, http.ts, index.ts) match only after CRLF stripping, which the gate does.
- **handler.ts does NOT match.** Stamp `a75612701f16`. Local = HEAD 99a92e8 = `49c5211b1367`. No committed version has the stamped hash (committed versions: ad65481 `50f1502ea13f`, 99a92e8 `49c5211b1367`). Inferred: a reverted working-tree edit from the 11-16 discovery run.
- Consequence: deploy_gate will refuse a redeploy until re-stamped. Whether live matches local handler.ts is unverified. `mcp__supabase-avs__get_edge_function` would show the deployed files.
- state.md says the 11-16 fix was SQL-only with no edge deploy, so live v10 is the pre-022 edge code. That is fine, because 022 is SQL.

## 8. Local scheduled discovery task
- Task `salsav-funding-discovery`: cron `0 7 * * 2,5` (Tue and Fri, 07:00 local). Next run 2026-11-20 13:08Z. SKILL.md at `C:\Users\georg\.claude\scheduled-tasks\salsav-funding-discovery\SKILL.md`. It reads `supabase/grants/discovery-task.md`.
- Procedure:
  - Step 0: log_discovery_run, then discovery_brief.
  - Step 1: health (shard % 8 counts; running rows older than 15 min).
  - Step 2: reverify_source keep or demote.
  - Step 3: collection, with probe_refresh in batches of at most 5 html, one at a time (546 rule).
  - Step 4: targets via check_known and set_target.
  - Step 5: gap discovery.
  - Step 4 of the COLLECTION section deploys via deploy_gate.mjs, then `grants.kick_refresh('<label>-engine', 1, 100000)`.
- **Queues the brief exposes** (live discovery_brief, `010:627-663`):
  - `reverify` (≤20): vetted, non-aggregator, ordered by fit_breakdown null, expired deadline, failing evidence, then verified_at asc nulls first.
  - `collection_gaps` (≤15): vetted with collection_state health ≠ ok, or mode page/none with verified_at null or older than 120 days.
  - `targets` (≤30): grants.targets with status pending (`010:33-52`).

## 9. What must change (SQL vs edge)
No edge code change is needed for (a) or (b). Everything is SQL, plus optional RPCs.

**(a) A manually promoted funder is refreshed**
1. Promote through reverify_source (`010:360-443`) with verdict 'promote', or through a new RPC modelled on it. Blockers in the live def:
   - gate_reason (v_fail) runs BEFORE the promote branch. A failing gate silently leaves status 'rejected' and returns a result. It does not raise.
   - funders_vetted_fit needs fit_score >= 40. Only 15 of 117 rejected funders pass.
   - funders_vetted_scope needs vet_note, fit_reasons, ua<>'unlikely', award >= 200k or null.
   - An override needs `p->>'override'='manual'` to skip v_fail, plus a vet_event note. The fit >= 40 constraint either stays (forcing a rescore) or is relaxed by a migration with a rollback file.
   - For 46 rejected funders with no fit_inputs, reverify_source raises unless fit is sent.
2. In the promote branch, also set cooldown_until, lease_until and lease_run to null, and next_check_at = now(). Rejected rows currently have no leases or cooldowns, so this is defensive, not a current fix.
3. Collection: a promoted funder with empty adapter_config becomes mode `page`. It is refreshed for change but writes zero calls. For calls, run set_collection with a verified config. It then appears in `collection_gaps` (mode page, verified_at null). That is the agentic queue, with no new table (inferred from the discovery_brief def).
4. Timing: next window, 01:00 or 13:00 UTC. For an immediate path, add `grants.refresh_funders_now(p_ids uuid[])`, cloned from probe_refresh (`019`) with `dry_run=false`, shard 0 of 1 shards, max_sources = cardinality (≤ 4), trigger 'promote'. The handler already accepts only_ids (`handler:26-27`), and store `:28-34` bypasses due and shard. One call per funder, from the main session only, to respect the 546 rule.

**(b) A demoted funder or opportunity is not refreshed or re-created**
1. Funder demote: reverify_source with verdict 'demote' and a reason sets status 'rejected' and reject_reason. claim_sources, peek and remaining_due exclude it, so it is not refreshed. No edge change needed.
   - Gap: apply_fetch_result (`002:122`) has no status check. A run already in flight still writes last_text and opportunities. The feed hides them, because funder status is not vetted.
   - Optional hardening: return early when `f.status <> 'vetted'`, after clearing the lease.
2. Opportunity demote (vetted → rejected): no path exists today. Add `grants.demote_opportunity(p_id, p_reason, p_run)` that sets `vet_status='rejected'` and writes a vet_events row with kind 'demoted'. Keep the row. Never DELETE it. The crawler's ON CONFLICT (`002:183-187`) does not touch vet_status, so the row stays rejected across refreshes. Live evidence: 34 vetted-funder rows are already rejected+open.
3. Trap 1: upsert_opportunity sets `vet_status='vetted'` on conflict. Fix: `vet_status = case when opportunities.vet_status='rejected' then 'rejected' else 'vetted' end`.
4. Trap 2: a deleted row, or external_id churn on `t:<title>` ids, makes apply_fetch_result insert again. Auto_vet funders insert as 'vetted'. Fix options (inferred): a `grants.opportunity_rejects(funder_id, url_norm)` table checked in the insert branch, or inserting as 'rejected' when a matching rejected url_norm exists.
5. vet_events kinds (`010:63-71`) already include 'demoted' and 'promoted'. There is no actor column.

## Hooks for the planned features
1. **Search in nav, across pages, with autocomplete**: outside this subsystem. Only data hooks: `grants.v_funders` (`010:546`) and grants_feed (`010`, about line 664; live body not diffed). Searchable fields are on funders (`001:49-100`): name, program, url, themes, geography, category, bucket.
2. **Category colors consistent across pages**: outside this subsystem. Trap: two taxonomies. funders.category has a check list at `001:53` (first four values read: foundation, us_federal, intl_dev_multilateral, bilateral_dev; full list not read). funders.bucket is free text. grants.targets.bucket is a five-value check (`010:33-52`): us_federal, intl_dev, state_regional, private_sector, foundation_ngo. Pick one key for the five colors.
3. **Pipeline status in sidebar; tags at top**: team_state (`001:227`), states new, reviewing, applying, submitted, awarded, declined, skip (grants_set_state, `010:745-768`). Trap: grants_set_state accepts only status='vetted' funders ("unknown funder"), so a demoted but progressed project cannot be updated or shown.
4. **Author attribution and history**: team_events (`001:235`) has `actor`, written as `p.actor || p.owner || 'team'`. It is self-declared, and auth is passcode-only (check_pass, `002:6-23`). vet_events (`010:63`) has no actor, so add one for demote and promote. A history overview is a UNION of vet_events, team_events and snapshots (`001:172`) by funder_id.
5. **Database tab (rejected funders, promote and demote)**:
   - Rejected list: funders where status='rejected' (117 rows, reject_reason always set). vet_note, fit_score and fit_breakdown come from the funders_fit_derive trigger (`010:228`). grants_feed already has a rejected array (about `010:736`, limit 250, non-aggregator).
   - Promote: §9a.
   - Demote funder: reverify_source verdict 'demote', with a required reason.
   - Demote proposal: new function (§9b.2).
   - reject_kind (`018:50`) is checked only in the register_source payload and never stored. Add a column if the tab needs to show the kind.
   - Public RPCs: follow the check_pass pattern (`002:6-23`, `010:745`). The `revoke all on all functions in schema grants` at `010` does not cover public.* RPCs. Verify their EXECUTE grants (inferred).
6. **Radar keeps progressed projects, with a flag**: grants_feed filters on `f.status='vetted'` (about `010:685`). A progressed funder that is demoted drops out. Include funders where team_state.state <> 'new' and add a flag (inferred). Demotion does not delete team_state, which is keyed by funder_id.
7. **Quick notes, persisted across surfaces**: team_state.notes (4000 chars, `001:227`, `010:745`) already exists per funder, read by grants_team_notes (`002:323`). For opportunity-level or project-level notes, add a table. Writes must also accept non-vetted funders (see 3).
8. **Galaxy**: data fields only, no crawler hook. funders.geography and themes (text[]), award_min_usd and award_max_usd (bigint, many null), amount_confidence, ua_eligibility, cycle, fit_score, fit_reasons, fit_breakdown. The theme vocabulary is in grants.settings key theme_vocab.
9. **Crawler queue, cron shards, scheduled task**: see §9 and Found. Concrete edits:
   - optional refresh_funders_now
   - promote and demote resets in reverify_source
   - optional apply_fetch_result status guard
   - upsert_opportunity vet_status fix
   - demote_opportunity
   - grants-prune schedule (user action)
   - fix the backoff comment or formula
   - re-stamp the deploy gate or confirm live handler.ts

## Found
- **grants-prune cron is missing** (verified absent from cron.job). 003e says to run it in the dashboard SQL editor, so this is a user action.
- **kick_refresh(text,int,int) still fans out all shards in parallel** when called with the default p_shards=8 (`022:34-43`). That is the pattern that killed the edge worker. Manual use must pass p_shards=1. The discovery step 4 call does this correctly.
- **handler.ts deploy stamp mismatch** (section 7).
- **Backoff comment vs formula**: `002:134` caps at 48 h, while the comment says 72 h.
- **upsert_opportunity re-votes on conflict** (live def). A real bug for the demote feature.
- **reverify_source promote with a failing gate** returns status 'rejected' silently. Check how discovery handles the result.
- **Only 15 of 117 rejected funders pass funders_vetted_fit** as-is.
- **Count mismatch**: state.md says "27 live calls"; live counts give 25 (vetted funder, vetted opportunity, open or forecasted). Unreconciled.
- **apply_fetch_result has no funder status check** (see 9b.1).

## Boundary batch (for the lead)
One read-only SELECT was blocked by the boundary-guard hook, which reported it as a supabase write. I did not retry it or reroute it. It is a SELECT, so there is no rollback. The lead can run it if the live mode split is needed. Until then, mode counts in this map are inferred from config keys.

```
select status, adapter, grants.collect_mode(adapter, adapter_config) as mode, count(*) as n, count(*) filter (where next_check_at <= now()) as due_now, count(*) filter (where lease_until > now()) as leased, count(*) filter (where cooldown_until > now()) as cooling, count(*) filter (where adapter_config->>'auto_vet' = 'true') as auto_vet from grants.funders group by status, adapter, mode order by status, adapter, mode;
```

Not verified: the live apply_fetch_result body, the live grants_feed body, and whether the live edge source matches local handler.ts.