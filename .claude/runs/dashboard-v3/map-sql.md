# SALSAV grants DB map (live, 2026-11-17)

Project `supabase-avs`, schema `grants`. Read-only: nothing written, nothing deployed. Live counts are from 2026-11-17, so they differ from the 2026-11-12 numbers in API.md.

**Evidence.** Repo read in full: API.md, 001, 002, 010, 011, 014, 018, 020, 021, 022, 003_cron, 003e; discovery-task.md:15-89 (grep); `.claude/sql-api-funcs.txt`; `supabase/functions/grants-refresh/store.ts`. Live: information_schema.columns, pg_constraint, pg_proc with proacl and has_function_privilege, pg_class RLS and ACL, pg_policies, pg_trigger, cron.job, aggregate counts, pg_get_functiondef for the four public wrappers and grants.check_pass.

**Boundary batch (not run, read-only, rollback none).** I tried one SELECT that listed `jsonb_object_keys` of `grants.discovery_brief()` and `public.grants_feed()`. boundary-guard denied it, as API.md line 3 predicts. I did not retry it. Top-level feed and brief keys below are derived from the live definitions (inferred).

## 1. Tables, views, triggers

**Security model.** All 15 `grants` tables have RLS on, zero policies, and ACL `{postgres=arwdDxtm}` only. `grants.v_funders` is a view with RLS off and postgres-only ACL, so it is reachable only through the definer functions.

- **settings** (`key` pk, `value` jsonb). Key names: `coverage_min`, `db_ceiling_mb`, `fit_rubric`, `lockout_failures`, `lockout_minutes`, `min_award_usd`, `min_days_left`, `passcode_hash`, `refresh_token_sha256`, `theme_vocab`. Vault secret name: `grants_refresh_token`. Values not read.
- **funders** (one row per source page or program, ~60 cols; 001:49-134).
  - Identity: `name`, `program`, `url`, `url_norm` (generated, unique), `name_key` (generated), `apply_url`, `feed_url`.
  - `category` (9 values): foundation, us_federal, intl_dev_multilateral, bilateral_dev, state_regional, corporate, research_collab, prize_challenge, aggregator.
  - `bucket` (generated): us_federal, intl_dev, state_regional, private_sector, foundation_ngo, tracker.
  - Eligibility and money: `ua_eligibility`, `cycle`, `award_min_usd`, `award_max_usd`, `amount_confidence`, `next_deadline`, `deadline_note`, `open_now`, `requirements` jsonb, `geography[]`, `themes[]`, `partner_needed[]`.
  - Fit: `fit_inputs` jsonb (judged dims), `fit_breakdown`, `fit_score` smallint 0..100, `fit_reasons[]`, `evidence` jsonb, `evidence_ok` jsonb, `verified_at`, `verified_by`.
  - Vetting: `status` (candidate|vetted|rejected), `vetted_at`, `vetted_by`, `vet_note`, `reject_reason`, `notes`.
  - Crawl: `fetchability`, `adapter` (html|rss|grants_gov|sam_gov|eu_ft|json_api|none), `adapter_config`, `shard` (generated `hashtext(split_part(url_norm,'/',1)) & 63`), `last_checked_at`, `last_ok_at`, `last_status`, `last_error`, `etag`, `last_modified`, `content_hash`, `last_changed_at`, `consecutive_failures`, `next_check_at`, `cooldown_until`, `lease_until`, `lease_run`, `robots_blocked`, `last_text`, `last_links`, `idle_streak`.
  - Collection: `collect_note`, `collect_verified_at`.
  - Constraints: `funders_vetted_scope` (vetted needs `vetted_at`, `vet_note`, `fit_score`, `fit_reasons`, `ua<>'unlikely'`, award null or >= 200000). `funders_vetted_fit` (vetted needs `category='aggregator'` or `fit_inputs` plus `fit_score>=40`). `funders_rejected_reason` (rejected needs non-blank `reject_reason`).
- **opportunities** (calls). `funder_id` fk cascade, `external_id`, `title`, `url`, `apply_url`, `description`, `open_date`, `deadline`, `deadline_text`, `award_min/max_usd`, `status` (forecasted|open|closed|archived), `vet_status` (candidate|vetted|rejected), `scope_score`, `doc_links`, `source_adapter`, `first_seen_at`, `last_seen_at`. Unique `(funder_id, external_id)`.
- **team_state** (`funder_id` pk). `state` (new|reviewing|applying|submitted|awarded|declined|skip), `owner` <=80, `notes` <=4000 (last write wins), `ask_usd` bigint 0..1e11, `updated_at`, `updated_by` <=60.
- **team_events** (`id`, `funder_id`, `at`, `actor`, `kind` text with no CHECK, `payload` jsonb). Only `kind='update'` is in use.
- **auth_attempts** (`id`, `at`, `ok`, `purpose` default `'passcode'`).
- **targets** (`org`, `program_hint`, `url_hint`, `bucket` limited to the 5 coverage buckets, `lens`, `priority` 1..3, `why`, `status` pending|covered|rejected|deferred, `note`, `funder_id`, `source`, `attempts`, `org_key` unique = `name_key(org||' '||program_hint)`).
- **discovery_runs** (`run_label` pk, `started_at`, `finished_at`, `summary`, `stats`).
- **discovery_log** (`url_norm` unique, `outcome` vetted|candidate|rejected|duplicate|unreachable, `reason`, `run_label`, `funder_id`, `found_at`). Live has 0 `duplicate` rows because of `ON CONFLICT (url_norm) DO NOTHING`.
- **vet_events** (`funder_id`, `at`, `kind` registered|rescored|verified|updated|demoted|promoted, `note`, `changes` `{field:[from,to]}`, `run_label`). No actor column.
- **metrics_daily** (`day` pk, `m` jsonb). **snapshots** (`change_kind` initial|content|deadline|amount|docs|status|error). **refresh_runs** (`status` running|ok|partial|error). **host_state**. **funders_v1_backup** (frozen 2026-11-12 copy).
- **v_funders** (view, 001:272 and 010:546-575). Columns: funders columns plus `deadline` (earliest vetted open or forecasted opportunity not in the past, else `next_deadline`), `days_left`, `deadline_state` (ok|too_soon|expired|rolling|invite|unknown), `amount_flag` (ok|low|unverified), `facts_verified` 0..4, `lane`. Lane order: `cultivate` (cycle invite_only or ua invitation_only), `apply_now` (deadline and days_left >= 14), `rolling`, `prepare` (annual_recurring), `watch`.
- **Triggers.** `funders_fit_derive` is BEFORE INSERT OR UPDATE OF fit_inputs, evidence, ua_eligibility, award_max_usd, eligibility_note, award_note, last_text. It sets fit_breakdown, fit_score, fit_reasons and evidence_ok. A quote counts as verified when its first 80 normalized characters appear in last_text. `funders_touch` sets `updated_at`.

## 2. State machines (live CHECK constraints plus function logic)

- **funders.status.** Entry: `register_source` (gates decide the status) or `reverify_source` with `promote`. `candidate` and `rejected` are hidden from the feed. Exit: `reverify_source` with `demote` (any status to rejected) or a gate failure on a vetted row (to rejected). No RPC moves a vetted funder back to candidate. Promote is allowed only from candidate or rejected, and needs a non-empty `vet_note`.
- **opportunities.vet_status.** `apply_fetch_result` sets candidate to vetted only when `adapter_config.auto_vet` is true (002:181, 011:198). `reject_opportunity` moves candidate to rejected only (021:26). `upsert_opportunity` always sets `vet_status='vetted'`, both on insert and on conflict (010:458-463). No RPC demotes a vetted call.
- **opportunities.status.** `upsert_opportunity` accepts forecasted or open only. `sweep_opportunities` (011:81-96) sets closed when the deadline has passed and archives undated calls after 21 days without being seen.
- **targets.status.** `set_target` accepts any of the four values. `register_source` with `target_id` sets covered, rejected or keeps pending. `add_targets` inserts pending only.
- **team_state.state.** Live CHECK accepts the seven values above. The `grants_set_state` body in 002:309 is stale. Live (010:751) is patched and accepts `awarded` and `declined`.
- **health** (`collection_state`, 011 plus 020): off, failing, stale, thin, empty, ok.

## 3. Where rejection reasons live

- **Reason:** `funders.reject_reason` is required for every rejected row (117 rows). `funders.vet_note` is set on 59 of them. `funders.notes` gets a judgment text appended only on insert (018:80). Live has 0 `Judgment reject` notes.
- **Event history:** `vet_events` rows with kind `demoted` or `registered`, where `note` holds the reason and `changes` holds `status:[from,to]`, `fit_score`, and so on.
- **Discovery log:** `discovery_log` has `outcome='rejected'`, `reason`, `run_label`.
- **Not stored:** `reject_kind` is accepted by `register_source` (018:50) but no column holds it. Hard rejects cannot be told apart from gate rejects except by reading the text.
- **Counts:** rejected 117 (corporate 25, foundation 35, us_federal 6, intl_dev 18, bilateral 8, state_regional 8, prize 4, research 10, aggregator 3). 61 rejected rows have `fit_inputs`. 14 of those score >= 40.
- **Feed exposure:** `grants_feed().screened` is `{name, program, bucket, reason, at}`, capped at 250 and excluding aggregators (010:733-736). It carries no id, no fit and no kind.

## 4. Team auth and team data

- **check_pass** (`grants.check_pass(p_pass text) returns boolean`, SECURITY DEFINER, `search_path ''`, live body in appendix A3).
  - Lockout is global, not per client. If the count of failed `purpose='passcode'` rows in the last `lockout_minutes` (15) reaches `lockout_failures` (8), it raises `locked` (P0001).
  - Otherwise it verifies `extensions.crypt(p_pass, passcode_hash)`.
  - It inserts one `auth_attempts` row per call, success or failure. On success it deletes all failed passcode rows.
  - Live: 26 successful rows, 0 failed.
- **Identity.** One shared passcode, no users, no roles. The `actor` string is client-supplied: `left(coalesce(p_patch->>'actor', p_patch->>'owner', 'team'), 60)`.
- **Team writes.** `public.grants_set_state(p_pass, p_funder uuid, p_patch jsonb)` (appendix A1). Patch keys: `state`, `owner`, `notes`, `ask_usd`, `actor`. Errors: `bad passcode` (28000), `unknown funder` (any funder not vetted), `bad state`, `bad ask_usd`.
- **team_events payload.** `(p_patch - 'actor' - 'notes') || {notes_changed}`. Notes text is not stored in events. Payload keys seen live: `state`, `owner`, `notes_changed`. No before values are recorded.
- **Live team data:** 5 team_state rows, all `new`, none with `ask_usd`. 22 team_events rows.

## 5. Dashboard RPCs (public schema, all anon-executable)

Live ACL for all four: `{=X, anon=X, authenticated=X, service_role=X}`. The `=X` entry is PUBLIC EXECUTE, which 002:334 tried to revoke.

| Function | Args | Returns | Notes |
|---|---|---|---|
| `public.grants_feed()` | none | jsonb | SECURITY DEFINER, STABLE, no passcode. Body in appendix A1. |
| `public.grants_check_pass(p_pass text)` | text | boolean | Wrapper around `grants.check_pass`. |
| `public.grants_set_state(p_pass text, p_funder uuid, p_patch jsonb)` | text, uuid, jsonb | team_state row | Passcode required. Body in appendix A2. |
| `public.grants_team_notes(p_pass text)` | text | `{team:[team_state rows incl. notes], events:[last 100 team_events]}` | Passcode required. Only path that returns notes. Appendix A3. |

**grants_feed() top-level keys:** `generated_at`, `min_days`, `min_award`, `rubric`, `vocab{themes}`, `coverage_min`, `funders[]`, `opportunities[]`, `changes[]`, `vetting[]`, `metrics[]`, `discovery{runs,by_lens,totals}`, `targets{by_bucket,next}`, `screened[]`, `collection`, `last_run`, `runs_24h`.

- **funders[].** Every `v_funders` column except `status`, plus `team{state,owner,ask_usd,updated_at}` and `collection{mode,health,source,checked_at,ok_at,open_calls,total_calls,last_call_at,note,verified_at}`. Filter: `status='vetted' and category<>'aggregator'`. Order: deadline nulls last, fit_score desc, name. Expired rows are included, so clients must filter on `deadline_state`. Notes, `last_text` and `fit_inputs` are absent. `evidence`, `vet_note`, `notes` and `fit_breakdown` are present.
- **opportunities[].** Vetted funder, `vet_status in ('vetted','candidate')`, `status in ('forecasted','open')`, deadline null or >= today (Phoenix). Includes `vet_status` and `source_adapter`.
- **changes[].** snapshots of the last 120 days, excluding `error`.
- **vetting[].** vet_events of the last 180 days for vetted, non-aggregator funders.
- **metrics[].** The last 90 `metrics_daily` rows.
- **discovery.** `runs` (joins discovery_runs with discovery_log counts), `by_lens`, `totals`.
- **targets.** `by_bucket`, and `next` (the 15 oldest pending).
- **screened[].** See section 3.

**Exposure.** Anyone holding the anon key can read `team.owner`, `team.ask_usd`, `vetting[].note`, the funder quotes and `screened` reasons. Team notes are not in the feed.

## 6. Agent-facing functions (schema grants, EXECUTE for postgres only)

Every function in `grants` has ACL `{postgres=X/postgres}`. Only the four public wrappers are exposed. Security-definer functions: `check_pass`, `check_refresh_token`, `kick_refresh`, `kick_refresh_shard`, `probe_refresh`, `probe_result`. Everything else is invoker with `search_path=grants, extensions, pg_temp`.

- `discovery_brief()` jsonb. Returns `today`, `gates`, `rubric`, `theme_vocab`, `coverage`, `targets` (30), `reverify` (20, order: no fit first, expired, evidence_ok false, `verified_at asc nulls first`), `failing`, `collection_gaps` (15), `metrics`, `last_runs`, `last_refresh`. Brief marker checks passed (010:650-652, 011:222).
- `check_known(p jsonb)`. `p` must be an array. Returns `[{name, program, matches[{name,program,status,reason,exact}]}]`. Read-only.
- `register_source(p jsonb, p_lens text, p_run_label text)`. Returns `{result:'inserted'|'duplicate', funder_id, status, fit_score, reject_reason, notes}`. Gates applied in order (018 live body): ua unlikely, award < 200k, mission none, total < 40. Judgment rejects are re-scored unless `reject_kind` is `not_a_funder` or `ended`.
- `reverify_source(p_id uuid, p jsonb, p_run_label text)`. `verdict` is keep, demote or promote. Returns `{result, id, name, status, fit_score, reject_reason, changes}`, where result is one of demoted, promoted, rescored, verified, updated.
  - `promote` needs `vet_note` (else raises) and `fit_inputs` (else raises). It does not raise when the gates fail: the row stays `rejected` and the returned `status` shows it.
  - Every verdict sets `verified_at = now()`.
- `upsert_opportunity(p jsonb, p_run_label text)`. Requires funder `status='vetted'`. `external_id` defaults to `disc:<md5 url_norm>`. Forces `vet_status='vetted'`, both on insert and on conflict (010:458-463). Returns `{result:'inserted'|'updated', id, funder_id, run}`.
- `reject_opportunity(p_id uuid, p_reason text, p_run_label text)`. Acts only on candidate calls (021:26). Writes a vet_event of kind `updated` with `note='Call rejected: ...'`. Returns `result` rejected or unchanged.
- `set_target(p_id uuid, p_status text, p_note text)`. Returns `{result:'ok', org, status, attempts}` or `not_found`.
- `add_targets(p jsonb, p_source text)`. Skips any org whose `name_key` or `url_norm` matches an existing funder, at any status. Returns `{received, added}`.
- `log_discovery_run(p_label text, p_summary text, p_stats jsonb)`. With a summary it sets `finished_at` and calls `snapshot_metrics()` inside an exception handler.
- `set_collection(p_id uuid, p jsonb, p_run_label text)`. Returns `{result, id, name, mode, previous, changed}`. A changed config clears etag, content_hash, fetchability and collect_verified_at (011:100-148).
- `collection_state(p_id uuid)` jsonb. `collection_metrics()` jsonb. `metrics_now()` jsonb.
- `sweep_opportunities()` jsonb `{closed, archived}`. `snapshot_metrics()` void, runs the sweep first.
- `kick_refresh_shard(p_trigger text, p_shard int, p_shards int, p_max_sources int, p_budget_ms int)`. Skips and warns when the database is over `db_ceiling_mb` (default 350). Sends an HTTP POST to grants-refresh with `chain_depth=6`, which disables self-chaining (022:9-30).
- `kick_refresh(p_trigger text, p_shards int, p_budget_ms int)`. Parallel fan-out. Manual use only.
- `probe_refresh(p_ids uuid[])` bigint and `probe_result(p_req bigint)` jsonb: defined in 019 (not read), SECURITY DEFINER, not in the allowlist.
- Crawler internals used by grants-refresh (store.ts:17-65): `check_refresh_token`, `start_run`, `finish_run`, `claim_sources(p_run uuid, p_shard, p_shards, p_limit, p_lease_s default 240)`, `remaining_due`, `get_last_text`, `apply_fetch_result(p jsonb)`, `host_load`, `host_save`.
- Pure helpers: `url_norm`, `name_key`, `fit_clean`, `fit_problem`, `fit_compute`, `gate_reason`, `evidence_clean`, `collect_mode`, `funders_fit_derive`.

## 7. Cron, shards, crawler queue, capacity

- **cron.job (live, 3 jobs).**
  - `grants-refresh-am`: `0-45/3 13 * * *`, runs `grants.kick_refresh_shard('cron-am', (minute/3)%8)`.
  - `grants-refresh-pm`: `0-45/3 1 * * *`, same with `'cron-pm'`.
  - `grants-metrics`: `20 1,13 * * *`, runs `snapshot_metrics()`.
  - `grants-prune` is NOT live. 003e says it was never applied (the MCP guard declines time-based deletes). Growth is unbounded for `auth_attempts`, `snapshots` and `refresh_runs`.
- **Queue predicate** (`claim_sources`, 002:70-79): `status='vetted' and adapter<>'none' and next_check_at<=now() and cooldown/lease clear and shard % p_shards = p_shard`, ordered by `next_check_at`. It does not exclude aggregators, so the one vetted aggregator is crawled but never shown.
- **Capacity (live, shard % 8):** vetted fetchable / due now / idle_streak >= 2:

| shard | fetchable | due now | idle >= 2 |
|---|---|---|---|
| 0 | 13 | 0 | 13 |
| 1 | 9 | 0 | 9 |
| 2 | 21 | 1 | 19 |
| 3 | 8 | 0 | 6 |
| 4 | 26 | 10 | 15 |
| 5 | 11 | 3 | 8 |
| 6 | 9 | 2 | 7 |
| 7 | 10 | 0 | 10 |

  Total fetchable 107, due now 16, idle >= 2 is 87. Each shard gets 2 POSTs per window at max 4 sources each, so 8 per shard per window. Shard 4 has a backlog of 10 and needs two windows to clear.
- **Edge function touchpoints.** store.ts lines 17-65 (RPC list above). handler.ts:30-57 sets `chain_depth` and the chain trigger.
- **Local discovery task.** `supabase/grants/discovery-task.md` is the prompt file (inferred that the scheduled task reads it). Step 6 at line 56 calls `reject_opportunity`. Step 5 at line 55 calls `add_targets`. Line 15 lists the permitted functions.

## 8. Repo vs live, and mismatches

- **Allowlist is stale.** `.claude/sql-api-funcs.txt` lists 12 functions. It omits `grants.reject_opportunity` (added by 021), `probe_refresh` and `probe_result`. The file header says `~/.claude/hooks/boundary-guard.py` reads it. discovery-task.md:15 and step 6 expect all three. Inferred: step 6 rejects will be denied until the file is updated.
- **002 grants_set_state is stale.** Its state list (002:309) lacks `awarded` and `declined`. The live body (010:751) is patched.
- **API.md corrections.** Live security-definer set is larger than API.md says (see section 6). Live counts are far higher. `collection_state` now returns `empty`. `kick_refresh` is now a wrapper over `kick_refresh_shard`.
- **Shared project.** `public` holds unrelated event and user objects (`export_user_data`, `handle_new_user`, `delete_event_and_dependencies`, `get_user_role`). Do not touch them.
- **grants-refresh REPORT.md** (lines 40-42) describes the pre-022 fan-out, not the staggered cron.

## 9. Findings with real risk (not fixed; read-only task)

1. **Anon exposure.** `grants_feed` (anon-executable) returns team owner and `ask_usd`, vetting notes, and the rejected-reason list. The shared passcode guards only writes and notes.
2. **Global lockout DoS.** The lockout counts all failures. Anyone can call `grants_check_pass` or `grants_set_state` with 8 wrong guesses and block the whole team for 15 minutes.
3. **Spoofable attribution.** `actor` is client text behind one shared passcode.
4. **Unbounded growth.** `grants-prune` is not scheduled, and every passcode call writes an `auth_attempts` row.
5. **PUBLIC EXECUTE** on the four wrappers, against the 002 intent.
6. **Empty target queue.** Live `targets` has 0 pending rows (19 covered, 10 deferred, 38 rejected), so discovery step 5 has nothing queued.

## Hooks for the planned features

**1. Persistent search with autocomplete.** No server-side search exists. The corpus is `grants_feed().funders[]` (name, program, url, themes, vet_note, notes) and `opportunities[]` (title, deadline, vet_status). Build the index client-side from one feed read per session. Traps: filter expired funders (`deadline_state='expired'`), and decide whether `vet_status='candidate'` calls appear in suggestions (they are marked Unverified). `targets.next` has only 15 rows.

**2. Consistent colours for the 5 category filters.** Nothing stored. Candidate keys: `bucket` (5 coverage buckets plus `tracker`, which the feed never returns), `lane` (5 values), `category` (9 values), `deadline_state` (6 values). Inferred: "5 category filters" means `bucket`. Key the palette on bucket and ignore tracker. Source of truth for the list: `settings.coverage_min` keys.

**3. Pipeline status in the project sidebar, tags on top.** Status is already in the feed as `funders[].team.state` (plus `owner`, `ask_usd`, `updated_at`). Tags are `themes[]` (16-term vocab) and `geography[]`, plus `fit_reasons[]`. Traps: a demoted funder drops out of the feed entirely, so its pipeline status disappears. `grants_set_state` refuses non-vetted funders with `unknown funder`.

**4. Owner attribution, identifiable authors, history overview.** Current storage: `team_state.owner`, `team_state.updated_by` (last writer only), `team_events.actor` per event. History reads are passcode-gated: `grants_team_notes` returns the last 100 events. Gaps: no before-values in payload, no actor on `vet_events`, and no per-user identity (inferred: needs a team-member table or per-user passcode). New history needs a `from` field in the payload, written inside `grants_set_state` before the update.

**5. Database tab (rejected funders, promote, demote).** The feed cannot supply it: `screened[]` has no id, fit, or kind, and is capped at 250. Need a new passcode-gated RPC returning rejected funders with id, reason, vet_note, fit_score, and whether `fit_inputs` is present.
- *Promote.* Do not simply wrap `reverify_source`. Traps: silent rejection (the returned `status` says `rejected` with no error), `fit_inputs` required, `vet_note` required, and the 14-of-61 figure above. A new wrapper must also reset `verified_at`, `next_check_at`, `idle_streak` and `cooldown_until`.
- *Agentic queue.* `reverify` orders by `verified_at asc nulls first` (010:652). Promote stamps `verified_at`, which sends the row to the back. Leave it NULL, or add a queue column (inferred design).
- *Demote funder.* `reverify_source` with `verdict='demote'` works but is postgres-only. It needs a `reason` and writes a `demoted` vet_event with no actor.
- *Demote proposal.* `reject_opportunity` only acts on candidates (021:26). `upsert_opportunity` forces `vetted` on conflict (010:458-463), so a demoted call would be resurrected by discovery step 6(b). Needs a new function plus a guard, for example a `WHERE vet_status <> 'rejected'` on the conflict update.
- *Reasons.* `reject_reason` is the reason, with `vet_events` as history. `reject_kind` is not stored.

**6. Radar keeps progressed projects, with a flag.** Feed filters: `status='vetted'`, `category<>'aggregator'`, opportunities in forecasted or open with deadline >= today. Pipeline state is per funder (`team_state` pk is `funder_id`), not per call. A progressed call disappears once its deadline passes or `sweep_opportunities` closes it. Add a `team.progressed` flag, and include funders that have a non-`new` state even when they are not vetted, after the demote path exists.

**7. Quick notes persisted across surfaces.** Existing: `team_state.notes`, one 4000-char last-write-wins blob per funder, written by `grants_set_state` and read only by `grants_team_notes` (passcode). Not in the feed. Traps: each save writes one `team_events` row and one `auth_attempts` row, so autosave floods both. Recommendation (inferred): debounce, or an append-only `grants.project_notes` (id, funder_id, author, body, created_at) with its own passcode-gated RPC.

**8. Galaxy tab (clustering with quick filters).** All needed fields are already in `funders[]`: `award_max_usd`, `award_min_usd`, `amount_confidence`, `amount_flag`, `category`, `bucket`, `themes[]`, `geography[]`, `fit_breakdown.dims[]` (key, level, points), `fit_reasons`, `cycle`, `ua_eligibility`, `lane`, `vet_note`, `partner_needed`. Keywords come from `themes` and `vet_note`. Size is about 107 nodes, so clustering can run client-side (inferred). Traps: aggregators are excluded, and `themes` may be empty.

**9. Crawler queue, cron shards, local discovery task.**
- Queue: `claim_sources` (002:63-89) and its predicate in section 7. Shard mapping is `hashtext & 63`, then `% 8` in cron.
- Promote must reset the row's crawl state (see 5).
- Add `grants-prune` to cron (003e, a dashboard SQL-editor step).
- Update `.claude/sql-api-funcs.txt` to add `reject_opportunity`, `probe_refresh` and `probe_result`, and any new agent RPC.
- Fix the `kick_refresh` note in REPORT.md.
- Edge function: `store.ts` and `handler.ts` (section 7).
- Any new SQL: patch from `pg_get_functiondef` with anchored replace (skill `grants-sql-function-patch`). Copying repo SQL would drop `collection`, candidate calls and the deadline filter from `grants_feed`.

## Appendix (verbatim `pg_get_functiondef`, live 2026-11-17)

A1. `public.grants_feed()`

```sql
CREATE OR REPLACE FUNCTION public.grants_feed()
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select jsonb_build_object(
    'generated_at', now(),
    'min_days', (select (value #>> '{}')::int from grants.settings where key = 'min_days_left'),
    'min_award', (select (value #>> '{}')::bigint from grants.settings where key = 'min_award_usd'),
    'rubric', (select value from grants.settings where key = 'fit_rubric'),
    'vocab', jsonb_build_object('themes', (select value from grants.settings where key = 'theme_vocab')),
    'coverage_min', (select value from grants.settings where key = 'coverage_min'),
    'funders', coalesce((
      select jsonb_agg(to_jsonb(v) - 'status'
                       || jsonb_build_object('team', jsonb_build_object('state', coalesce(t.state, 'new'), 'owner', t.owner, 'ask_usd', t.ask_usd, 'updated_at', t.updated_at), 'collection', grants.collection_state(v.id))
                       order by v.deadline nulls last, v.fit_score desc nulls last, v.name)
        from grants.v_funders v left join grants.team_state t on t.funder_id = v.id
       where v.status = 'vetted' and v.category <> 'aggregator'), '[]'::jsonb),
    'opportunities', coalesce((
      select jsonb_agg(jsonb_build_object('id', o.id, 'funder_id', o.funder_id, 'title', o.title, 'url', o.url, 'apply_url', o.apply_url,
               'description', o.description, 'open_date', o.open_date, 'deadline', o.deadline, 'deadline_text', o.deadline_text,
               'award_min_usd', o.award_min_usd, 'award_max_usd', o.award_max_usd, 'status', o.status, 'doc_links', o.doc_links,
               'first_seen_at', o.first_seen_at, 'last_seen_at', o.last_seen_at, 'source_adapter', o.source_adapter, 'vet_status', o.vet_status) order by o.deadline nulls last)
        from grants.opportunities o join grants.funders f on f.id = o.funder_id
       where f.status = 'vetted' and o.vet_status in ('vetted', 'candidate') and o.status in ('forecasted', 'open')
         and (o.deadline is null or o.deadline >= (now() at time zone 'America/Phoenix')::date)), '[]'::jsonb),
    'changes', coalesce((
      select jsonb_agg(jsonb_build_object('funder_id', s.funder_id, 'at', s.fetched_at, 'kind', s.change_kind, 'summary', s.summary,
               'docs_added', s.diff->'docs_added', 'deadline', s.diff->'deadline') order by s.fetched_at desc)
        from grants.snapshots s join grants.funders f on f.id = s.funder_id
       where f.status = 'vetted' and f.category <> 'aggregator' and s.change_kind <> 'error' and s.fetched_at > now() - interval '120 days'), '[]'::jsonb),
    'vetting', coalesce((
      select jsonb_agg(jsonb_build_object('funder_id', e.funder_id, 'at', e.at, 'kind', e.kind, 'note', e.note, 'changes', e.changes, 'run_label', e.run_label) order by e.at desc)
        from grants.vet_events e join grants.funders f on f.id = e.funder_id
       where f.status = 'vetted' and f.category <> 'aggregator' and e.at > now() - interval '180 days'), '[]'::jsonb),
    'metrics', coalesce((select jsonb_agg(jsonb_build_object('day', x.day, 'm', x.m) order by x.day)
                           from (select day, m from grants.metrics_daily order by day desc limit 90) x), '[]'::jsonb),
    'discovery', jsonb_build_object(
      'runs', coalesce((
        select jsonb_agg(to_jsonb(x) order by x.started_at desc) from (
          select run_label, coalesce(r.started_at, l.first_at) as started_at, coalesce(r.finished_at, l.last_at) as finished_at, r.summary,
                 coalesce(r.stats, '{}'::jsonb) as stats,
                 greatest(coalesce(l.n, 0), case when r.stats->>'examined' ~ '^[0-9]{1,6}$' then (r.stats->>'examined')::int else 0 end) as examined,
                 coalesce(l.vetted, 0) as vetted, coalesce(l.rejected, 0) as rejected, coalesce(l.duplicate, 0) as duplicate
            from grants.discovery_runs r
            full join (select run_label, min(found_at) as first_at, max(found_at) as last_at, count(*) as n,
                              count(*) filter (where outcome = 'vetted') as vetted, count(*) filter (where outcome = 'rejected') as rejected,
                              count(*) filter (where outcome = 'duplicate') as duplicate
                         from grants.discovery_log where run_label is not null group by run_label) l using (run_label)
           order by 2 desc limit 30) x), '[]'::jsonb),
      -- yield per lens uses each source's status today, so later screen-outs are counted honestly
      'by_lens', coalesce((
        select jsonb_agg(to_jsonb(x) order by x.examined desc, x.lens) from (
          select coalesce(l.lens, 'other') as lens, count(*) as examined,
                 count(*) filter (where l.outcome not in ('duplicate', 'unreachable') and coalesce(f.status, l.outcome) = 'vetted') as vetted,
                 count(*) filter (where l.outcome not in ('duplicate', 'unreachable') and coalesce(f.status, l.outcome) = 'rejected') as rejected
            from grants.discovery_log l left join grants.funders f on f.id = l.funder_id group by 1) x), '[]'::jsonb),
      'totals', (
        select jsonb_build_object('examined', count(*),
                 'vetted', count(*) filter (where l.outcome not in ('duplicate', 'unreachable') and coalesce(f.status, l.outcome) = 'vetted'),
                 'rejected', count(*) filter (where l.outcome not in ('duplicate', 'unreachable') and coalesce(f.status, l.outcome) = 'rejected'),
                 'candidate', count(*) filter (where l.outcome not in ('duplicate', 'unreachable') and coalesce(f.status, l.outcome) = 'candidate'))
          from grants.discovery_log l left join grants.funders f on f.id = l.funder_id)),
    'targets', jsonb_build_object(
      'by_bucket', coalesce((
        select jsonb_agg(to_jsonb(x) order by x.bucket) from (
          select b.bucket, count(t.id) filter (where t.status = 'pending') as pending, count(t.id) filter (where t.status = 'covered') as covered,
                 count(t.id) filter (where t.status = 'rejected') as rejected, count(t.id) filter (where t.status = 'deferred') as deferred
            from jsonb_object_keys((select value from grants.settings where key = 'coverage_min')) as b(bucket)
            left join grants.targets t on t.bucket = b.bucket group by b.bucket) x), '[]'::jsonb),
      'next', coalesce((
        select jsonb_agg(jsonb_build_object('org', t.org, 'program_hint', t.program_hint, 'bucket', t.bucket, 'priority', t.priority, 'why', t.why) order by t.priority, t.created_at, t.org)
          from (select * from grants.targets where status = 'pending' order by priority, created_at, org limit 15) t), '[]'::jsonb)),
    'screened', coalesce((
      select jsonb_agg(jsonb_build_object('name', f.name, 'program', f.program, 'bucket', f.bucket, 'reason', f.reject_reason, 'at', f.updated_at) order by f.updated_at desc)
        from (select name, program, bucket, reject_reason, updated_at from grants.funders
               where status = 'rejected' and category <> 'aggregator' order by updated_at desc limit 250) f), '[]'::jsonb),
    'collection', grants.collection_metrics(),
    'last_run', (select to_jsonb(r) - 'stats' from (select started_at, finished_at, status, planned, fetched, not_modified, changed, errors, elapsed_ms
                   from grants.refresh_runs where finished_at is not null order by started_at desc limit 1) r),
    'runs_24h', (select jsonb_build_object('runs', count(*), 'fetched', coalesce(sum(fetched), 0), 'changed', coalesce(sum(changed), 0), 'errors', coalesce(sum(errors), 0))
                   from grants.refresh_runs where started_at > now() - interval '24 hours')
  )
$function$
```

A2. `public.grants_set_state(text, uuid, jsonb)`

```sql
CREATE OR REPLACE FUNCTION public.grants_set_state(p_pass text, p_funder uuid, p_patch jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare r grants.team_state%rowtype; v_actor text := left(coalesce(p_patch->>'actor', p_patch->>'owner', 'team'), 60); v_ask bigint;
begin
  if not grants.check_pass(p_pass) then raise exception 'bad passcode' using errcode = '28000'; end if;
  if not exists (select 1 from grants.funders where id = p_funder and status = 'vetted') then raise exception 'unknown funder'; end if;
  if p_patch ? 'state' and coalesce(p_patch->>'state', '') not in ('new', 'reviewing', 'applying', 'submitted', 'awarded', 'declined', 'skip') then raise exception 'bad state'; end if;
  if p_patch ? 'ask_usd' and jsonb_typeof(p_patch->'ask_usd') <> 'null' then
    if jsonb_typeof(p_patch->'ask_usd') <> 'number' or (p_patch->>'ask_usd')::numeric not between 0 and 100000000000 then raise exception 'bad ask_usd'; end if;
    v_ask := round((p_patch->>'ask_usd')::numeric)::bigint;
  end if;
  insert into grants.team_state(funder_id, state, owner, notes, ask_usd, updated_by)
  values (p_funder, coalesce(p_patch->>'state', 'new'), left(p_patch->>'owner', 80), left(p_patch->>'notes', 4000), v_ask, v_actor)
  on conflict (funder_id) do update set
    state = case when p_patch ? 'state' then p_patch->>'state' else grants.team_state.state end,
    owner = case when p_patch ? 'owner' then left(p_patch->>'owner', 80) else grants.team_state.owner end,
    notes = case when p_patch ? 'notes' then left(p_patch->>'notes', 4000) else grants.team_state.notes end,
    ask_usd = case when p_patch ? 'ask_usd' then v_ask else grants.team_state.ask_usd end,
    updated_at = now(), updated_by = v_actor
  returning * into r;
  insert into grants.team_events(funder_id, actor, kind, payload)
  values (p_funder, v_actor, 'update', (p_patch - 'actor' - 'notes') || jsonb_build_object('notes_changed', p_patch ? 'notes'));
  return to_jsonb(r);
end $function$
```

A3. `grants.check_pass(text)`, `public.grants_team_notes(text)`, `public.grants_check_pass(text)`

```sql
CREATE OR REPLACE FUNCTION grants.check_pass(p_pass text)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_hash text; v_ok boolean; v_fail int; v_max int; v_min int;
begin
  select (value #>> '{}')::int into v_max from grants.settings where key = 'lockout_failures';
  select (value #>> '{}')::int into v_min from grants.settings where key = 'lockout_minutes';
  select count(*) into v_fail from grants.auth_attempts
    where purpose = 'passcode' and not ok and at > now() - make_interval(mins => coalesce(v_min, 15));
  if v_fail >= coalesce(v_max, 8) then
    raise exception 'locked' using errcode = 'P0001', hint = 'Too many wrong passcodes; wait and retry.';
  end if;
  select value #>> '{}' into v_hash from grants.settings where key = 'passcode_hash';
  v_ok := v_hash is not null and p_pass is not null and extensions.crypt(p_pass, v_hash) = v_hash;
  insert into grants.auth_attempts(ok) values (v_ok);
  if v_ok then delete from grants.auth_attempts where not ok and purpose = 'passcode'; end if;
  return v_ok;
end $function$

CREATE OR REPLACE FUNCTION public.grants_team_notes(p_pass text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  if not grants.check_pass(p_pass) then raise exception 'bad passcode' using errcode = '28000'; end if;
  return jsonb_build_object(
    'team', coalesce((select jsonb_agg(to_jsonb(t)) from grants.team_state t), '[]'::jsonb),
    'events', coalesce((select jsonb_agg(to_jsonb(e) order by e.at desc) from (select * from grants.team_events order by at desc limit 100) e), '[]'::jsonb));
end $function$

CREATE OR REPLACE FUNCTION public.grants_check_pass(p_pass text)
 RETURNS boolean
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$ select grants.check_pass(p_pass) $function$
```