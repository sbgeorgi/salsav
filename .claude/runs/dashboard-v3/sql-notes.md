# 023 human overrides: SQL track notes

Status: authored 2026-11-17. Not applied, not executed. The lead applies it.
Scratch DB: not started. The local PostgreSQL 17 install has client tools only: `initdb` stops at `share/postgres.bki` missing, so no server can run from it. Use a server install or the Supabase CLI local stack.

## Files
- `supabase/grants/023_human_overrides.sql`: migration. md5 guards on the four replaced functions (grants_set_state, grants_team_notes, discovery_brief, reverify_source).
- `supabase/grants/023_human_overrides-rollback.sql`: restores the four functions from `live/`, checks their md5 before any data or trigger change, then reverses the rest.
- `supabase/grants/tests/023_human_overrides_test.sql`: one DO block that always rolls back and prints `TEST RESULT`.
- `supabase/grants/API.md`: section appended.
- `.claude/runs/dashboard-v3/live/`: pre-023 definitions (`MD5.txt`, one file per function) and `constraints_triggers_acl.txt`.

## Object semantics
- Lock: `funders.human_lock` and `opportunities.human_lock` hold `promoted`, `demoted`, or NULL (automated).
- `promote`: status vetted, `vetted_at` and `vetted_by` set, `vet_note` filled from the reason when empty, `reject_reason` cleared, `agent_queue` pending, `next_check_at` now.
- `demote`: status rejected with the reason; `agent_queue` cleared.
- `release`: clears the lock. Blocked with 22023 when a listed funder has no scored fit that passes the gates.
- Triggers: a lock change must agree with the status it sets (22023 otherwise). Without a lock change, `funders_zz_human_lock` reverts an automated status that disagrees with the lock, restoring `reject_reason`, `vetted_at`, `vetted_by` and `vet_note` from OLD. `opportunities_zz_human_lock` does the same for `vet_status`. `opportunities_a_listed_guard` stores a vetted call under a non-listed funder as `candidate`; `funders_zz_unlist_cascade` moves a leaving funder's vetted non-promoted calls to `candidate`.
- Constraints: `funders_vetted_fit` and `funders_vetted_scope` accept vetted when the lock is promoted. The check is NULL-safe (`coalesce(human_lock, '') = 'promoted'`).
- Call `demote` and `restore`: `team_events.payload.from_status` records the prior status; `restore` returns to it.
- `vet_events.actor` is new. `vet_events_human_guard` turns an automated promoted or demoted event into `updated` when it disagrees with the funder status.
- `grants.notes`: soft delete (`deleted_at`), RLS on, no grants to anon, authenticated or service_role.
- Registry: `grants_registry` lists every funder row (any status), every target and every call.
- `grants_set_state`: reads the old row FOR UPDATE and writes only the changed keys. The event payload holds the changed keys, `from` and `notes_changed`. A no-op returns the row and writes no event.
- `grants_team_notes`: events limited to 500 (was 100); adds live notes.

## Agent semantics
- `discovery_brief().promoted`: funders with `agent_queue` pending, at most 20, oldest `human_at` first. Each has `gates` (scored, fit, ua, award, pass), `has_fit_inputs`, `fit_score` (null until scored). The agent scores the funder, then the queue item is closed with `resolve_promoted` (no agent-facing wrapper yet: see open questions).
- `discovery_brief().backfill`: rejected funders with no `fit_inputs` and no human lock, at most 8, oldest first. These are below-threshold or never-scored funders that still need a fit payload.
- An agent must not change a locked row's status. A reverify that fails the gates on a promoted row is reverted by the trigger; the result belongs in `vet_events`.

## Lead steps
0. If the md5 guard in 023 trips on a scratch DB built from repo 001-022, the repo text differs from live. Load `live/public__grants_set_state.sql`, `live/public__grants_team_notes.sql`, `live/grants__discovery_brief.sql` and `live/grants__reverify_source.sql` into the scratch DB first, then re-run 023. Do not loosen the guard.
1. In a scratch DB with 001-022 applied, run `023_human_overrides.sql`, then `tests/023_human_overrides_test.sql`. Expect `TEST RESULT` with `all_ok` true, and read each scenario.
2. Confirm `grants_feed` is unchanged: it reads `v_funders`, which is not changed. Its key list was not re-read here (the read was blocked by the boundary guard). Run a read-only key check: `select jsonb_object_keys(public.grants_feed()->'funders'->0)` and the same for `opportunities->0`, then compare with the migration's expectations.
3. `apply_migration` with the 023 name, then rename the repo files to the live version timestamp.
4. Privileges to check after apply: `has_function_privilege('anon', 'public.grants_registry(text)', 'EXECUTE')` and the same for `public.grants_funder(uuid,text)` true; `grants.human_set_funder(uuid,text,text,text)` not executable by anon or authenticated; `has_table_privilege('anon', 'grants.notes', 'SELECT')` false.
5. Rollback only if needed: run `023_human_overrides-rollback.sql`. It moves violating promoted funders to rejected and drops `grants.notes` and the `actor` history (data loss).

## Open questions
- `resolve_promoted` has no agent-facing wrapper. The API track must expose one if the agent is to close the queue itself.
- S17 inserts into `grants.targets` with the literal bucket `foundation_ngo`. The test has not run, so its other NOT NULL columns are unverified against the schema.
- Not in the test: the reverify gate event (review finding 13), the set_state first-touch event, and the apply_fetch_result conflict path. The test has not been run on a scratch DB.

## Risks
- `grants_registry` and `grants_funder` need no passcode. The owner decision bullet below says exactly what they return.
- Promoted funders have `fit_score` null until scored. The radar shows them with `gates.scored` false.
- Promoted funders with an adapter are picked up by `claim_sources` (status vetted, adapter not none), so the crawler will fetch them.
- The test is authored, not executed. No scratch Postgres was running on localhost:54329.
- Team-demoted calls stay rejected after rollback.
- `live/grants__claim_sources.sql` is a transcription. Its md5 (4e8dee77...) does not match live (8b6773d9...), so it is informational only; 023 does not change `claim_sources`. `grants.v_funders` is not saved as a file (dependency only; the migration does not alter it).
- Lockout: `005_hardening` sets 40 failures per 10 minutes. The 8 per 15 in `001` is superseded. Writes now RETURN the bad-passcode error so the failure row commits.
- Owner decision open (Review round rows 2 and 15): without a passcode, `grants_registry` and `grants_funder` still return reject reasons, vet notes, fit breakdown, vetting notes and changes, call titles and descriptions, and lead `why` and `source`. `grants_funder` returns the v_funders columns (notes, evidence, requirements, verified_by) for a listed funder. Team names, vetting actors, human notes and lead notes are withheld. Before apply, the lead should run an aggregate count of contact-shaped strings in `vet_events.note`, `targets.why` and `targets.source` (no values read), then decide.
- Registry is unpaged (225 funders, 67 leads today). Paging deferred.
- `grants_set_state` with a blank actor falls back to `team`; any passcode holder can remove any note (design limit).

## Review round (2026-11-17)

Two adversarial reviewers returned 18 findings. Each was checked against the files, the `live/` definitions and read-only SELECTs (columns, check constraints, functions, settings keys). Nothing was executed.

| # | Sev | Finding | Result |
|---|---|---|---|
| 1 | med | Failed passcode rows rolled back by the 28000 raise; lockout never trips | Fixed. Writes return `{error:'bad passcode', code:'28000'}`; `locked` still raises. Lockout 40 per 10 min (005_hardening). |
| 2 | med | Anonymous reads expose notes, evidence, verified_by, reasons, actors, lead notes | Partly. Gated for unlisted funders: the v_funders columns (notes, evidence, requirements, verified_by), team names, vetting actors, human and lead notes. Still public: reject reasons, vet notes, fit breakdown, gates, vetting notes and changes, call titles, descriptions and doc links, lead why and source, and for listed funders the v_funders columns. Owner decision open; aggregate scan needed before apply. |
| 3 | med | grants_funder returns team owner and ask for any id | Fixed. owner, ask_usd and collection only for team or listed funders. A demote keeps team_state (gated, not cleared). |
| 4 | med | Rollback changes state before its md5 verify | Fixed. Restores and verify run first, then trigger drops, data move, constraint swap. Run as one apply_migration. |
| 5 | low | Lock change skips the status consistency check | Fixed. Every lock change must agree: promoted needs vetted, demoted needs rejected (22023). |
| 6 | low | grants_note raw casts raise 22P02 | Fixed. Regex checks raise 22023. |
| 7 | low | Lead queue and dismiss leave no history | Fixed. team_events kinds lead_queue and lead_dismiss; funder_id nullable. |
| 8 | low | Actor self-asserted; blank actor accepted; any holder removes any note | Partly. A blank actor falls back to `team` (not rejected, to keep the grants_set_state owner fallback). Any-holder removal is a documented design limit. |
| 9 | low | Registry unpaged | Deferred: 225 funders and 67 leads today. Needs owner. |
| 10 | low | human_gates raises when dims is not an array | Fixed. jsonb_typeof guard. Test S9b. |
| 11 | low | resolve_promoted run_label uncapped | Fixed. left(btrim, 60). |
| 12 | med | Demote does not cascade calls; apply_fetch_result can insert vetted under a rejected funder; restore has no funder check | Fixed by triggers; apply_fetch_result unchanged. The listed guard (BEFORE INSERT OR UPDATE) makes a vetted call under a non-listed funder `candidate`. The unlist cascade moves vetted non-promoted calls to `candidate` (not `rejected`). Restore needs a listed funder; calls_open counts only for vetted funders. Deviation from the reviewer's first option. |
| 13 | med | Reverify gate failure on a promoted funder reverted silently, no event | Fixed. reverify_source patch: kind updated, changes.gate [null, v_fail], note `Gate failed on re-check: ...`. Not covered by the test. |
| 14 | med | Test covers lock logic only | Mostly fixed. Rewritten with 21 scenario blocks covering registry and funder shapes, brief keys, set_state, team_notes, note checks, lead audit, listing guard, cascade. Gaps: reverify gate event, set_state first-touch event, apply_fetch_result conflict path. Not executed. |
| 15 | med | Anonymous exposure of team names, reasons, lead notes | Partly. human.by, human.note, vetting actor and lead note need a passcode. Reject reasons, vet notes, call titles and descriptions, lead why and source stay public (the contract pins anonymous reads). Owner decision open. Same residual as row 2. |
| 16 | low | grants_set_state differs from live (a)-(e) | (b), (c), (d) rejected: contract lines 52 and 78 ask for an event only on change, changed keys plus `from`, and `notes_changed`. (e) fixed: a first touch writes an event. (a) kept as a deviation: a no-op writes nothing, so updated_at does not move. |
| 17 | low | Demoted branch does not restore vet_note | Fixed. Restored from OLD. |
| 18 | low | S11 fails on a database with 20+ older pending promotions | Fixed. The test sets f_cand human_at to 2000-01-01 before discovery_brief. |

Own re-read fixes (not in the list):
- grants_registry and grants_funder call check_pass only when a passcode is given (explicit if, not a short-circuit AND).
- Test S12: a boolean was assigned into a bigint (42804). Fixed.
- Test S17: the targets bucket came from a coalesce that could violate targets_bucket_check. Now the literal `foundation_ngo`.
- Test S18b: `v_keys[1]` is not a valid INTO target. Now `v_lr`.

Checks after the advisor pass:
- The four guard md5s (`grants_set_state`, `grants_team_notes`, `discovery_brief`, `reverify_source`) equal `md5(pg_get_functiondef(...))` on the live database (one read-only SELECT, all true). The migration's md5 guards will not refuse on live.
- No CR bytes in `supabase/grants/023_*` (grep, zero matches). The reverify anchor is LF-only.
- `funders_fit_derive` (BEFORE UPDATE) recomputes fit only when `fit_inputs` is not null. S8b and S9b leave it null, so their written values stand.
- The test was re-read top to bottom for syntax and variable use; clean after the edits above.
- The rollback was re-read: verify runs before any change, the constraint texts match the live definitions, the drop order is valid, and the data move uses the same expression as the constraints. The restored bodies are verbatim live text.
