# Funder discovery subsystem map (read-only, 2026-11-17)

Nothing in the repo or database was changed. DB reads were SELECTs on the `grants` schema, plus `pg_get_functiondef` on grants functions. Not read: API.md, COLLECT.md, references/history.md, EXPERIENCE.md, the grants-refresh engine (status filter), the funders branch of `public.grants_feed()` in full, `grants.collection_state`, `grants.set_collection`. Where a live check was not done, the claim is marked (inferred from file).

## 1. Live state (confirmed this turn)
- `grants.targets`: 67 rows. status covered 19, rejected 38, deferred 10, pending 0. Columns: id uuid, org, program_hint, url_hint, bucket, lens, priority smallint (1-3), why, status (pending|covered|rejected|deferred), note, funder_id (FK funders, on delete set null), source, attempts smallint, org_key (generated, unique), created_at, updated_at.
- `grants.funders`: 225 rows. status vetted 107, rejected 117, candidate 1. Relevant columns: reject_reason, notes, vet_note, vetted_by, vetted_at, fit_inputs, fit_breakdown, fit_score, evidence, evidence_ok, verified_at, verified_by, collect_note, collect_verified_at, idle_streak, cooldown_until, lease_until, lease_run, shard smallint, last_text, last_links, consecutive_failures, adapter, adapter_config, discovered_via, category, bucket, themes[], geography[], partner_needed[], requirements jsonb. There is no `reject_kind` column and no manual-lock column.
- `grants.opportunities`: 120 rows. vet_status vetted 49, rejected 39, candidate 32. Columns include status, deadline, scope_score, source_adapter, first_seen_at, last_seen_at. There is no reason column; a rejection reason lives in `vet_events.note`.
- `grants.discovery_brief()` (live def): keys today, gates, rubric, theme_vocab, coverage, targets, reverify, failing, collection_gaps, metrics, last_runs, last_refresh. There is no candidate-calls key. `collection_gaps` came from 011; the 010 file did not have it.
- Live `grants.apply_fetch_result(p jsonb)`: the crawler never writes `funders.status`. For opportunities it upserts on (funder_id, external_id) and changes vet_status only from candidate to vetted, so a rejected call stays rejected.
- Live `grants.add_targets(p jsonb, p_source text)`, `grants.set_target(p_id uuid, p_status text, p_note text)`, `grants.gate_reason(p_breakdown jsonb, p_ua text, p_award bigint)`: as described in sections 2 and 4.

## 2. The agentic queue
### 2.1 Brief orders (live)
- **targets**: status = 'pending' only, joined to coverage on bucket. Order: priority asc, coverage gap desc, attempts asc, created_at asc. LIMIT 30.
- **reverify**: vetted, non-aggregator funders. Order: fit_breakdown null first, deadline_state 'expired' first, any evidence_ok value false first, verified_at asc nulls first, facts_verified asc, name. LIMIT 20.
- **failing**: vetted with consecutive_failures >= 3, desc.
- **collection_gaps**: vetted where collection_state health <> 'ok', or mode in (page, none) with verified_at null or older than 120 days. Order: health 'failing' first, page/none first, fit_score desc nulls last. LIMIT 15.
- **candidate calls are not in the brief.** Discovery step 6a (discovery-task.md:56) runs its own SELECT: opportunities with vet_status 'candidate' and status open/forecasted, order by deadline nulls last, LIMIT 30.

### 2.2 Targets lifecycle
- **Add**: `grants.add_targets(p jsonb, p_source text)` returns {received, added}. Keeps the five buckets only. Priority is clamped to 1-3 with default 2. url_hint must be http(s). Drops entries whose org+program_hint key matches a funder's name_key or url_norm. Insert is `ON CONFLICT (org_key) DO NOTHING`.
  - Trap: a target with the same org_key in any status (including rejected, covered or deferred) blocks a re-queue silently.
- **Close**: `grants.set_target(p_id uuid, p_status text, p_note text)`. Accepts pending|covered|rejected|deferred. Note is truncated to 300 characters. attempts increments. It does not set funder_id. `register_source` with `target_id` sets covered or rejected and funder_id instead.
- **Trap, deferred never returns**: the brief reads pending only, so the 10 deferred rows are dead unless someone calls `set_target(id,'pending',...)`. Several deferred rows name orgs that state.md lists as already listed (Salt River Project, Mosaic Company Foundation). They look stale; that is a name match only (inferred), not checked against funders.
- The queue is empty now (pending 0; state.md:38, 41).

## 3. Scheduled discovery task, step by step
- **Local task** `salsav-funding-discovery`: cron `0 7 * * 2,5` (Tue and Fri, jitter 533 s), enabled, next run 2026-11-20 13:08 UTC. Its SKILL.md is a pointer only: `git checkout funding-radar-v2`, pull, then follow supabase/grants/discovery-task.md.
- **discovery-task.md steps**:
  - L50 step 0: `log_discovery_run(label)`, then `discovery_brief()`.
  - L51 step 1: health from `failing`, `last_refresh`, the overdue-shard query and stuck `running` refresh_runs.
  - L52 step 2: `reverify_source` with verdict keep or demote, up to 6.
  - L53 step 3 and L63-82: COLLECTION a-g. Channel recon, config in `collect/cfg/<id8>.json`, adapter_check, `set_collection` unverified, `probe_refresh` batches of at most 5 html, verify.
  - L54 step 4: targets. `check_known`; exact match closes the target; otherwise `register_source` with target_id; no verdict means `set_target` deferred.
  - L55 step 5: gap discovery only with budget left. Leads go to `check_known`, then register or `add_targets`.
  - L56 step 6: 6a confirms or rejects candidate calls (`upsert_opportunity`, `reject_opportunity`). 6b upserts a dated call the crawler missed.
  - L57 step 7 verify. L58 step 8 finish log. L100 NOTIFY via PushNotification.
  - Budgets (L47): reverify 6, fix collection 6, targets 14, examine ~40, list at most 12.
- **Crawler cron** (022, inferred live from state.md): `grants-refresh-am` `0-45/3 13 * * *` and `grants-refresh-pm` `0-45/3 1 * * *`. Each calls `grants.kick_refresh_shard(trigger, (minute/3)%8)`. Each request sends max_sources 4 and budget 100000 ms, with a pg_net timeout of 5 s and chain_depth 6. A DB size guard reads settings `db_ceiling_mb` (default 350). Other cron jobs: `grants-metrics` `20 1,13 * * *` (snapshot_metrics), `grants-prune` weekly `30 11 * * 0`.
- **Boundary guard**: subagents may call only the 12 names in `.claude/sql-api-funcs.txt` (discovery_brief, check_known, register_source, reverify_source, upsert_opportunity, set_target, add_targets, set_collection, collection_state, metrics_now, log_discovery_run, kick_refresh). `reject_opportunity` is not in that file, yet discovery-task.md:15 lists it. `probe_refresh` and `probe_result` are main-session only (L77). The hook (`~/.claude/hooks/boundary-guard.py`) was not read (inferred: it reads that file and a SELECT allow-list of tables from L15).

## 4. How rejections are decided and recorded
- **Coded gates**, `grants.gate_reason` (live), first match wins:
  1. ua_eligibility 'unlikely' gives 'Universities or US applicants cannot apply.'
  2. award_max_usd below `settings.min_award_usd` (200000) gives 'Largest single award ($X) is below the $Y minimum.' A null award passes.
  3. No fit_breakdown gives 'No itemized fit score.'
  4. Mission dimension level 'none' gives 'Does not fund this kind of work.'
  5. Total below `fit_rubric.min_fit` (40) gives 'Fit score N is below the minimum of 40.'
- **register_source** (018 file, which supersedes 010; live not checked, inferred):
  - reject_kind 'not_a_funder' or 'ended' stays rejected. Any other reject is re-scored by the gates, and a note 'Judgment reject re-scored by the gates: ...' goes into funders.notes.
  - Vetted but failing a gate gives status rejected with reject_reason = the gate text.
  - Vetted but missing fit.mission.quote or vet_note gives candidate.
  - A duplicate by url_norm or name_key returns duplicate, which is final.
  - reject_kind is not persisted.
- **reverify_source** (010:360-441, inferred live):
  - verdict demote sets status rejected with reject_reason = p.reason.
  - verdict keep with a failing gate also sets status rejected automatically (010:413-415).
  - verdict promote applies only to candidate or rejected rows, needs vet_note, and needs no gate failure (010:416-419).
  - Each change writes vet_events (kinds registered, rescored, verified, updated, demoted, promoted).
- **Where the reasoning text lives**:
  - funders.reject_reason (117 rows, plain prose)
  - funders.notes (judgment note)
  - vet_events.note and changes (has run_label, no actor)
  - discovery_log.reason (keyed by url_norm, no created_at)
  - feed field `screened` (latest 250 rejected)
- **Reason text is free prose, not codes.** Live top prefixes: 'Largest single award ($100,000) is below the' x2, '($150,000)' x2, then one-offs such as 'No open solicitation for universities...' and 'Does not accept unsolicited proposals...'. Separating 'ended' from 'not_a_funder' needs a new column.

## 5. Human overrides: interaction design
Today the DB cannot protect a row from the agent:
- **T1** reverify_source keep with a gate failure silently demotes a human-promoted funder (010:413-415).
- **T2** reverify_source promote re-lists a human-demoted funder (010:416-419) if the agent sends promote.
- **T3** upsert_opportunity sets `vet_status = 'vetted'` unconditionally on conflict (010:463). It can re-list a human-demoted call through 6b or a re-confirm. apply_fetch_result does not do this (live), so the crawler respects a demote.
- **T4** reject_opportunity (021:26-28) acts only on candidates. There is no function that demotes a vetted (tracked) call.
- **T5** check_known returns rejected funders as duplicates, so a demoted funder is skipped at any status (good). A promoted rejected funder must not go through register_source, which would return duplicate.
- **T6** demoting a funder stops crawling only if the grants-refresh engine selects status 'vetted'. Not verified; read the engine before relying on it.
- **T7** v_funders deadline uses only opportunities with vet_status 'vetted' (010:552-553, inferred live), so a demoted call drops out of deadline and lane automatically.

Queue options for a promoted funder:
- **A. Reuse grants.targets**: insert a row with a `kind` column ('promote'), funder_id set, status pending, priority 1. Brief order would put it first.
  - Pros: the pending query and set_target already exist.
  - Cons: org_key collides with old covered or rejected rows, and `ON CONFLICT DO NOTHING` drops the promotion silently. add_targets' funder filter would skip it. Step 4 needs a branch. It mixes human intent into discovery intake.
- **B. Flag on grants.funders**: add `queue_state` (null, promoted, collected), `promoted_at`, `promoted_by`, `human_lock` (null, promoted, demoted), and `reject_kind`. The brief gets a new key `promoted`.
  - Pros: one row per funder with no key collision. The gates and reverify read the same row. The dashboard can read it from the feed.
  - Cons: four or five new columns on a hot table, and one new brief key.
- **C. Separate grants.overrides ledger** (funder_id or opportunity_id, action, reason, actor, at, consumed_at).
  - Pros: full audit trail, which also serves feature 4.
  - Cons: every writer must join it, and there is one more table to allowlist.
- **Recommendation (my judgment)**: B for state and lock, with vet_events as history plus a new `actor text` column (kinds promoted and demoted already exist at 010:67). Use C only if vet_events is not enough for the audit.

Agent behaviour to design against:
- Read a new brief key `promoted` (order promoted_at asc, LIMIT 5) in step 1, before reverify.
- For each promoted funder: run COLLECTION a-e first, with a separate budget (a cap of 3 per run is a judgment call). Then reverify_source keep with fit and evidence.
- Under human_lock 'promoted', reverify must not demote on a gate failure. It keeps status vetted and writes the gate text into notes as a flag for the owner.
- When set_collection is verified, set queue_state to 'collected'. After two failed channels, the funder stays promoted with the blocker in collect_note, and it shows in collection_gaps.
- Under human_lock 'demoted', reverify_source returns result 'locked' and changes nothing.
- For calls: a new demote function (or reject_opportunity widened to vetted rows) sets vet_status 'rejected' with human_lock. upsert_opportunity changes to `vet_status = case when opportunities.vet_status = 'rejected' then 'rejected' else 'vetted' end` and returns skipped_rejected.
- Latency: a promotion waits for the next Tue or Fri run (up to 4 days). An on-demand run via run_scheduled_task is an option (inferred from the tool description).

## 6. Exact change list (minimal)
- **supabase/grants/discovery-task.md**:
  - L12 and L15: add the new function names; reconcile reject_opportunity, which is in L15 but absent from sql-api-funcs.txt.
  - L49-51 (steps 0 and 1): read brief.promoted and log its count.
  - L52 (step 2): skip human_lock 'demoted' funders.
  - L53 and L63-82: promoted funders go first in COLLECTION, with their own budget.
  - L54 (step 4): add a rule for deferred rows (re-queue after N days, or leave them).
  - L56 (step 6a/6b): 6b must respect rejected rows. Demotes of vetted calls go only through the new function.
  - L57: verify counts promoted and locked funders.
  - L77: probe_refresh batches include promoted funders (main session).
  - L100: add the promoted count to NOTIFY.
- **.claude/sql-api-funcs.txt** (lines 3-14): add new names. Do not add reject_opportunity for subagents; the lead rejects per funding skill L13.
- **C:/Users/georg/.claude/scheduled-tasks/salsav-funding-discovery/SKILL.md**: line 3 description (mention promoted funders first). Line 6 pointer is unchanged.
- **.claude/skills/funding-source-vetting/SKILL.md**: L13 (subagents can neither reject nor demote), L14 (lock rules).
- **SQL**: one new migration plus rollback, written with the grants-sql-function-patch skill. It patches upsert_opportunity (010:463), the reverify_source branches (010:410-419) and reject_opportunity (021:19-33).
- **Engine**: none, unless the grants-refresh status filter does not select only vetted funders.

## 7. Crawler and schedules (facts)
- discovery-task.md:85-91 ENGINE FIXES step 4 calls `grants.kick_refresh('<label>-engine', 1, 100000)`. With one shard that sends a single request with max 4 sources (inferred from 022:9-42). It is a smoke test, not a full run.
- 022 lists the 546 CPU-kill rule: one shard per request, at most 4 sources per request.
- For immediate collection of a promoted funder, a single `grants.kick_refresh_shard(trigger, shard_of(funder), 8, 1, budget)` call is feasible (inferred). The funder's shard column is at funders.shard.
- Pass 5 (state.md:37-41): crawler healthy, 0 overdue shards, 0 stuck runs.

## 8. Hooks for the planned features
1. **Search in the nav, with autocomplete**: nothing in my subsystem. Suggestions can come from feed `name`, `program`, `url`, `bucket`. Trap: the SQL name_key normaliser (grants.name_key) is not mirrored client-side (inferred).
2. **Category colours**: bucket values are us_federal, intl_dev, state_regional, private_sector, foundation_ngo (targets check constraint, 010:38). Nothing else in my subsystem.
3. **Pipeline status in the sidebar, tags first**: team {state, owner, ask_usd} comes from feed funders (Contract C in PLAN.md). No SQL change.
4. **Owners and history**: vet_events (010:63-71) has no actor column, so add one. team_state.owner and team_events (001:227, 001:235) exist (inferred columns). Trap: the dashboard uses a shared passcode (Contract E; grants.auth_attempts at 001:40), so there is no real identity. Owner attribution is a typed name, not authentication.
5. **Database tab (rejected funders, reasons, promote and demote)**: source is funders where status 'rejected' (117 rows), with reasons from reject_reason, notes and vet_events. Promote and demote run through the new functions in section 5. Trap: no reject_kind column, and the `screened` feed field covers only the latest 250.
6. **Radar keeps progressed projects, flagged**: the grants_feed funders filter (010:673 onwards, not fully read) probably requires status 'vetted'. A progressed funder later demoted to rejected would vanish. Include team.state in (reviewing, applying, submitted, awarded) in that filter (inferred). The flag comes from team.state.
7. **Quick notes, persistent across tabs**: new table grants.notes (funder_id or opportunity_id, body up to 2000 characters, author, created_at, updated_at), RLS on, all revoked from anon and authenticated, and written through a SECURITY DEFINER public RPC like grants_set_state (inferred pattern). Read it inside grants_feed or in a separate RPC. Trap: the author is again a typed name.
8. **Galaxy**: inputs are funders.themes[] (16-term vocabulary, 010:98), geography[], bucket, category, award_max_usd, ua_eligibility, fit_breakdown dimensions, partner_needed[]. Cluster client-side, or add a view grants.v_galaxy (inferred). Trap: about half of funders are rejected, so default the map to vetted and make rejected a toggle. award_max_usd can be null.
9. **Crawler queue, cron, local task**: section 7 applies. Add a promoted trigger: a run_scheduled_task now call, or the single-shard kick above. Keep max_sources at 4 per request. The local task cadence is Tue and Fri only.