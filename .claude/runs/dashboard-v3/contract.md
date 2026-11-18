# Dashboard v3 contract (pinned by lead, 2026-11-17)

Repo `C:/HELLOWORLD/salsav_codex`, branch `funding-radar-v2`. Static dashboard, no build, no dependencies, vanilla ES modules.
Maps of the existing system (read the one for your area, do not re-derive): `.claude/runs/dashboard-v3/map-shell.md`, `map-modules.md`, `map-sql.md`, `map-data.md`, `map-crawler.md`, `map-agentic.md`, `map-tests.md`.

## Hard rules for every agent
- Write only inside your write scope. Something outside it must change -> put it in your return under `needs`, do not edit it.
- No git commit, push, stash, checkout or reset. No deploys. No edge-function deploy. Nothing leaves this machine.
- Database: single read-only SELECT/WITH statements only (MCP `supabase-avs`, project Salsav, schema `grants`). Never select values from `grants.settings`. Never print or copy the anon key value from `dashboard.html`. No writes, no DDL, no `DO` blocks: the lead applies SQL.
- No `innerHTML`/`insertAdjacentHTML` with data. Notes, reasons, names, titles are user or crawler text: render with the shell's `el()` (text nodes) and `D.safeUrl()` for links.
- Colors only through CSS tokens/classes (`dashboard.css :root`, `html[data-theme="dark"]`); both themes must work; `prefers-reduced-motion` respected; keyboard reachable; visible focus; hit targets >= 32px (44px on touch widths).
- Existing tests stay green: `node dashboard.test.mjs`, `node dash/collection.test.mjs`, `node dash/viz.test.mjs`. New pure logic gets a small `node`-runnable test in the same style (sync `t(name, fn)`, fixed clock).
- A preview server already runs at `http://127.0.0.1:8765` (do not start or stop servers). Smoke-test your surface in headless Chrome with `~/.claude/bin/web act goto "http://127.0.0.1:8765/dashboard.html?mock=dash/mock.json#view=<view>" js "<expr>" text` once the mock mode exists (phase 2). If the shell is broken by files outside your scope, retry once later, then report it.
- Plain English copy, sentence case, no em dashes, no marketing words. Match the existing editorial look (warm paper, Source Serif 4 numerals/headings, Inter body, `--primary` green).

## Product decisions
1. Views, nav order: Radar (`table|cards|timeline`), Pipeline (`board`), Database (`database`), Galaxy (`galaxy`), Insights (`insights`), Method (`method`). Hash stays `#view=<name>`.
2. Identity: one shared team passcode (unlock) + a display name (`S.me`). The name is required at unlock so every write has an actor. "Vetted user" = unlocked.
3. The five category colors are the bucket hues `--b-us_federal`, `--b-intl_dev`, `--b-state_regional`, `--b-private_sector`, `--b-foundation_ngo` (+ `--b-tracker`). Every surface that shows a funder shows its bucket dot or chip from `dash/ui.js`. One label map: `D.BUCKETS` (long), `S.bucketLabel` (short).
4. Global search lives in the top bar on every view, value `S.F.q`, one input `#q`. Each view filters or highlights by it. Autocomplete suggests tracked funders, screened-out funders, leads, calls, themes, owners, categories.
5. Radar keeps funders the team progressed in the pipeline (team state not `new`/`skip`) even when the 14-day rule would hide them, with a visible "In pipeline: <state>" flag.
6. Database is the full registry: every evaluated funder (tracked, screened out, candidate, aggregator) plus leads the discovery agent considered, with the reason and which threshold criteria failed. Unlocked users promote, demote, release; demote or restore single calls; queue or dismiss leads.
7. A human decision is a lock: automated vetting cannot undo it. Promoted funders become `status='vetted'` at once (crawler tracks them at the next window) and enter the agent queue (`agent_queue='pending'`) so the scheduled discovery run scores them and builds collection.
8. Quick notes: short attributed notes per funder (optionally per call), stored in `grants.notes`, shown in drawer, board, radar, database.
9. History: every pipeline action records actor and from-values; shown per funder (drawer) and as an activity overview (Pipeline).

## Database contract (migration 023, authored by the SQL track, applied by the lead)

New columns
- `grants.funders`: `human_lock text` (null|`promoted`|`demoted`), `human_by text`, `human_at timestamptz`, `human_note text`, `agent_queue text` (null|`pending`|`done`), `agent_queue_at timestamptz`, `agent_queue_note text`.
- `grants.opportunities`: `human_lock text` (null|`promoted`|`demoted`), `human_by text`, `human_at timestamptz`, `human_note text`.
- `grants.vet_events`: `actor text` (null = automated).
- `funders_vetted_scope` and `funders_vetted_fit` gain `OR human_lock = 'promoted'`.
- Table `grants.notes(id bigint identity pk, funder_id uuid not null fk funders on delete cascade, opportunity_id uuid null fk opportunities on delete set null, body text 1..2000 chars, actor text not null, at timestamptz default now(), deleted_at timestamptz, deleted_by text)`, RLS on, no policies, no anon/authenticated grants.

Lock triggers (fire last among BEFORE UPDATE triggers)
- funders: lock `promoted` and status leaving `vetted` without a lock change -> status stays `vetted`. Lock `demoted` and status becoming `vetted` without a lock change -> stays `rejected` with the old reason. All other column updates in the same statement go through.
- opportunities: lock `demoted` -> `vet_status` stays `rejected`; lock `promoted` -> stays `vetted`.
- No automated function may log a `demoted`/`promoted` vet event that the lock reverted.

Internal functions (schema `grants`, postgres only)
- `human_set_funder(p_funder uuid, p_action text, p_reason text, p_actor text) returns jsonb`; actions `promote` (from rejected/candidate), `demote` (from vetted), `release` (clear the lock, status unchanged). Reason required (>= 3 chars) for promote/demote. Writes `vet_events` (kind promoted/demoted/updated, actor set, run_label `human`) and `team_events` (kind `promote`/`demote`/`release`, payload `{reason, from_status}`). Promote also sets `next_check_at = now()`.
- `human_set_call(p_opp uuid, p_action text, p_reason text, p_actor text) returns jsonb`; actions `demote`, `restore`. `team_events` kind `call_demote`/`call_restore`, payload `{opportunity_id, title, reason}`.
- `human_set_lead(p_target uuid, p_action text, p_reason text, p_actor text) returns jsonb`; actions `queue` (status pending, priority 1), `dismiss` (status rejected). Note records actor and reason.
- `note_add(p_funder uuid, p_body text, p_actor text, p_opp uuid default null) returns jsonb`, `note_remove(p_note bigint, p_actor text) returns jsonb` (soft delete).
- `resolve_promoted(p_id uuid, p_note text, p_run_label text) returns jsonb` (agent marks a queued funder done).
- `discovery_brief()` adds `promoted` (agent_queue pending, oldest first, <= 20: id, name, program, url, category, human_by, human_at, human_note, has_fit_inputs, fit_score, adapter, fetchability, gates) and `backfill` (rejected, `fit_inputs is null`, no lock, oldest first, <= 8: id, name, program, url, reject_reason).

Public RPCs (schema `public`, SECURITY DEFINER, `search_path ''`, EXECUTE for anon + authenticated exactly like the existing wrappers)
- Read, no passcode: `grants_registry() returns jsonb`, `grants_funder(p_id uuid) returns jsonb`.
- Write, passcode via `grants.check_pass` (errcode 28000 on failure): `grants_set_funder(p_pass text, p_funder uuid, p_patch jsonb)`, `grants_set_call(p_pass text, p_opp uuid, p_patch jsonb)`, `grants_set_lead(p_pass text, p_target uuid, p_patch jsonb)`, `grants_note(p_pass text, p_funder uuid, p_patch jsonb)`. Patch keys: `action`, `reason`, `actor`; for notes `{body, actor, opportunity_id?}` adds and `{remove: <note id>, actor}` removes.
- Patched: `grants_set_state` (event payload gains `from: {state?, owner?, ask_usd?}` for changed keys; no event when nothing changed), `grants_team_notes` (adds `notes`, newest first, not deleted, <= 2000; `events` limit 500).
- `grants_feed()` is NOT changed.

Shapes (exact keys the front end may rely on)
```
grants_registry() -> {
  generated_at, thresholds: {fit_min, award_min_usd},
  counts: {funders, tracked, screened, candidate, leads, queue},
  funders: [{ id, name, program, category, bucket, status,            // status: vetted | rejected | candidate
              url, geography[], themes[], award_min_usd, award_max_usd, amount_confidence, ua_eligibility, cycle, next_deadline,
              fit_score, fit_breakdown, fit_reasons[], vet_note, reject_reason,
              gates: {scored, fit, ua, award, pass},                  // booleans, true = passes; scored=false when never scored
              evaluated_at, vetted_at, verified_at, created_at, discovered_via, adapter, fetchability, last_ok_at,
              calls_open, calls_total, team_state,                    // team_state: pipeline state or null
              human: {lock, by, at, note} | null, queue: 'pending' | 'done' | null }],
  leads:  [{ id, org, program_hint, url_hint, bucket, lens, priority, why, status, note, funder_id, source, updated_at }],  // status: pending | covered | rejected | deferred
  calls:  [{ id, funder_id, title, url, deadline, status, vet_status, award_max_usd, first_seen_at, last_seen_at, human: {lock, by, at, note} | null }]  // every opportunity
}
grants_funder(p_id) -> null | {
  funder: { ...same keys as a grants_feed() funder row (incl. team, collection), status, reject_reason, gates, human, queue },
  opportunities: [{ ...same keys as a grants_feed() opportunity, vet_status, human }],   // all calls of this funder
  vetting: [{ at, kind, note, changes, run_label, actor }]
}
grants_set_funder -> { id, status, human, queue }      grants_set_call -> { id, funder_id, vet_status, human }
grants_set_lead   -> { id, status, note }              grants_note     -> { id, funder_id, opportunity_id, body, actor, at } | { removed: id }
grants_team_notes -> { team: [...], events: [{ id, funder_id, at, actor, kind, payload }], notes: [{ id, funder_id, opportunity_id, body, actor, at }] }
team event kinds: update (payload: changed keys + from + notes_changed) | promote | demote | release | call_demote | call_restore
```

## Front-end contract

Module contract: `export function render(root, app)` (idempotent; the shell calls it on every app render). Optional `export function onQuery(root, app)`: called instead of `render` when only the global search changed. Drawer: `renderDrawer(d, r, app)`.

`app` (existing keys stay): `S, D, el, ico, link, num, rubric, openDrawer, setFilters, go, unlocked, requireUnlock, saveTeam, toast`. Added:
```
app.ui                         // exports of dash/ui.js (below)
app.rpc(fn, body)              // throws Error with .code
app.me()                       // display name or ''
app.q()                        // lower-cased search words, [] when empty
app.matchQ(text)               // true when every search word is in text (lower-cased inside)
app.loadRegistry(force?)       // Promise<registry>; cached; also fills S.reg / S.regById (Map id -> registry funder)
app.reg()                      // registry or null (not loaded yet)
app.funderName(id)             // from S.rows, registry or '' 
app.notesFor(funderId)         // notes newest first ([] when locked)
app.eventsFor(funderId)        // team events newest first ([] when locked)
app.addNote(funderId, body, opportunityId?)   // Promise<bool>; handles unlock, rpc, state, toast, re-render
app.removeNote(note)                           // Promise<bool>
app.act(kind, id, action, opts?)               // kind 'funder'|'call'|'lead'; asks for a reason (app.ask) unless opts.reason; rpc; refresh; toast. Promise<bool>
app.ask({title, body, label, placeholder, confirm, danger, required})   // Promise<string|null> (reason dialog)
app.refresh()                  // reload feed, team (if unlocked), registry (if loaded), then render
app.ui_state(name, defaults)   // per-view UI state object that survives re-renders and tab switches (S.ui[name])
app.openDrawer(id, keep?, section?)   // works for any funder id: non-tracked ids load grants_funder and render with row._status = 'rejected'|'candidate'
```
State: `S.events` (array), `S.notes` (array), `S.reg`, `S.regById`, `S.ui`. Normalized rows gain `_prog` (team state not new/skip), `_status` (`vetted` unless loaded through grants_funder), `_human` (registry `human` for that id or null).

`dash/ui.js` (pure DOM helpers, no shell imports; `dash/ui.css` is loaded in `<head>`)
```
initials(name) -> 'CS'            ownerHue(name) -> 0..7        (pure, tested)
avatar(name, {size: 'sm'|'md'|'lg', title}) -> element          // class av av-<hue>; empty name -> av--none ("Unassigned")
bucketDot(bucket) -> <i class="bdot b-<bucket>">                bucketChip(bucket, label) -> <span class="bchip b-<bucket>">
stateChip(state, label) -> <span class="schip s-<state>">       // pipeline states new|reviewing|applying|submitted|awarded|declined|skip
statusChip(status) -> <span class="rchip r-<status>">           // registry status vetted|rejected|candidate|lead|queue (labels Tracked, Screened out, Candidate, Lead, In agent queue)
gateChips(gates, thresholds) -> element                         // one chip per failed criterion: Fit below 40, UA unlikely, Award under $200k, Not scored
timeAgo(ts, now) -> 'just now' | '5 min ago' | '3 days ago' | date
describeEvent(ev, labels) -> {verb, detail}                     // pure, tested: "moved to Applying" + "from Reviewing"
activityItem(ev, {name, now, onOpen}) -> <li>                   // avatar + actor + verb + funder name + time
noteThread({notes, me, canWrite, onAdd, onRemove, now, placeholder}) -> element   // composer (Enter saves, Shift+Enter newline) + list
menu(button, items)                                             // small popover menu: [{label, onSelect, danger}]
```
CSS classes from `ui.css` any module may use: `.bdot .bchip .b-<bucket>` (sets `--bc`), `.schip .s-<state>`, `.rchip .r-<status>`, `.lchip .l-<lane>` (one lane color set for table and drawer), `.av .av-0..7 .av--none`, `.flag` (small inline flag), `.seg` (segmented control, existing), `.panel`, `.empty`.

Mock mode (for local verification, never used in production paths): `dashboard.html?mock=dash/mock.json` (same-origin only, validated like `?feed=`). `rpc()` is served by `dash/mock.js` from the JSON (`feed, registry, funders{id: grants_funder result}, team, events, notes`), writes mutate memory and return the live shapes, any passcode unlocks, the top bar shows a "Mock data" pill.

## File ownership
- Phase 1 FOUND: `dashboard.html`, `dashboard.js`, `dashboard.css`, `dashboard.test.mjs`, `dashboard.fixture.json`, `dash/ui.js`, `dash/ui.css`, `dash/ui.test.mjs`, `dash/mock.js`, `dash/mock.json`, stubs `dash/database.js|css`, `dash/galaxy.js|css`.
- Phase 1 SQL: `supabase/grants/023_*.sql`, `supabase/grants/tests/023_*`, `supabase/grants/API.md`, `.claude/runs/dashboard-v3/live/*`.
- Phase 1 AGENT-DOCS: `supabase/grants/discovery-task.md`, `.claude/sql-api-funcs.txt`, `.claude/skills/funding-source-vetting/SKILL.md`, `supabase/grants/COLLECT.md`.
- Phase 2 RADAR: `dashboard.html`, `dashboard.js`, `dashboard.css`, `dashboard.test.mjs`, `dash/ui.js`, `dash/ui.css`, `dash/ui.test.mjs`, `dash/mock.*`, `dash/horizon.js`.
- Phase 2 DRAWER: `dash/drawer.js`, `dash/drawer.css`. BOARD: `dash/board.js`, `dash/board.css`, `dash/board.test.mjs`. DATABASE: `dash/database.js`, `dash/database.css`, `dash/database.test.mjs`. GALAXY: `dash/galaxy.js`, `dash/galaxy.css`, `dash/galaxy.test.mjs`. MODS: `dash/insights.js|css`, `dash/method.js|css`.
