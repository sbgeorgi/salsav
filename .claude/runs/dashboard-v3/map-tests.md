# Dashboard subsystem map (read-only; nothing written, no DB calls)

## 0. Baseline (run from `C:/HELLOWORLD/salsav_codex`)
| Suite | Command (from file header) | Result |
|---|---|---|
| Radar logic | `node dashboard.test.mjs` | exit 0, `ok 38 tests` |
| Collection helpers | `node dash/collection.test.mjs` | exit 0, `8 tests passed` |
| Viz and horizon | `node dash/viz.test.mjs` | exit 0, `21 tests, all ok` |

No failures. No root `package.json`, no `npm test`, no `node --test` wiring. I did not run `node --test`.

Tools on this Windows machine:
- node: v22.14.0 (`C:\Program Files\nodejs\node.exe`)
- psql: 17.6 (`C:\Program Files\PostgreSQL\17\bin\psql.exe`, not on the bash PATH; `run_sql_test.sh` hard-codes it)
- deno: not found
- docker: not found
- supabase CLI: not found

## 1. Files
- Root: `dashboard.html` (642 lines; inline `<script type=module>` at :107-640), `dashboard.js` (362, pure logic), `dashboard.css` (329), `dashboard.test.mjs` (278), `dashboard.fixture.json` (108 KB).
- `dash/`: `drawer.js` (25 KB), `board.js`, `insights.js`, `method.js`, `horizon.js`, `viz.js`, plus `drawer.css`, `board.css`, `insights.css`, `method.css`, `viz.css`, and tests `collection.test.mjs`, `viz.test.mjs`.
- Scope note: `.claude/launch.json` serves `python -m http.server 8765` at `127.0.0.1`.

## 2. How the code is testable under node
- `dashboard.js` has no DOM at import. Every date function takes `now`; the timezone is `TZ='America/Phoenix'` (:2).
- `dash/viz.js` and `dash/horizon.js` return SVG/HTML strings. There is no DOM stub. Tests check strings: well-formed root `<svg role=img aria-label>`, balanced tags, no `NaN|undefined|null`, no raw `<script`, and escaping through `esc` (viz.js:6).
- `horizonLayout` and `unverifiedPoints` in `horizon.js` are pure, so they are tested. `horizon()` uses `document` and is not.
- `drawer.js` imports cleanly under node because its DOM access is inside functions. `collection.test.mjs` imports `callOrigin, collectionOf, coverageRows, collectionTotals, totalsSentence` from it.
- `board.js`, `insights.js`, `method.js` and the `dashboard.html` inline module use `document`/`localStorage` at top level or in `render(root, app)`. They are not testable under node; the only check is the browser.
- Test helper convention: a synchronous local `t(name, fn)` wrapper. The first throw aborts the file with exit 1.
  - `dashboard.test.mjs` prints `ok N tests` (`t` increments N; 38 `t(` calls).
  - `collection.test.mjs` logs `ok <name>` and ends with `N tests passed`.
  - `viz.test.mjs` logs `ok <name>` and ends with `N tests, all ok`.
- Fixed clock: `NOW = 2026-11-11T20:00:00Z` (dashboard.test.mjs:6). The tests are date-stable.
- Colour guard: viz.test.mjs:180 checks that chart output has no colour literals, and :208 that `horizon.js` has none (`/#[0-9a-f]{3,8}\b|rgb\(|hsl\(/i`). Colours come only from CSS (`var(--b-*)`).

**Traps**
- dashboard.test.mjs:175 has the final assertion (`D.sortRows(FR,'recommended').at(-1)._dq === true`) written after a `//` comment on the same line. It never runs.
- `collectionOf` is defined twice: `dashboard.js:14` (no `note` key) and `dash/drawer.js:168` (adds `note: c.note || null`). Each test asserts its own version. Any new code must pick one.
- dashboard.test.mjs:214 reads `supabase/grants/rubric_v2.json` and requires it to equal `FEED.rubric` verbatim. A rubric change breaks the test.

## 3. Fixture shape (`dashboard.fixture.json`)
Top-level keys:
- Scalars: `generated_at`, `min_days` (14), `min_award` (200000).
- `rubric`: `{version:2, min_fit:40, tiers[4], dims[6]}`. Tiers are prime 75, strong 60, possible 45, long_shot 0. Dims are mission, activity, geography, eligibility, award, precedent. Each dim has `key,label,max,source,question,levels[{key,points,label,rule}]`.
- `vocab.themes` (16 strings), `coverage_min` (us_federal 12, intl_dev 12, state_regional 8, private_sector 8, foundation_ngo 12).
- `funders[15]`, `opportunities[5]`, `changes[7]`, `vetting[6]`, `metrics[30]`, `discovery{runs[3], by_lens[4], totals{examined 80,...}}`, `targets{by_bucket[5], next[5]}`, `screened[8]`, `last_run`, `runs_24h`, `collection`.

Funder fields (45 keys union):
- Identity and classification: `id, name, program, category ("funder" for all), bucket, url, apply_url, feed_url, geography[], themes[]`.
- Money: `award_min_usd, award_max_usd, amount_confidence (published|estimated|...), award_note, amount_flag`.
- Eligibility and deadline: `ua_eligibility (eligible|eligible_with_partner|invitation_only|unknown), cycle, deadline, deadline_note, open_now, days_left, deadline_state, partner_needed[]`.
- Requirements: `requirements{loi, cost_share, indirect_cap, registrations[], page_limit?}`, `requirements_text`, `eligibility_note`, `notes`.
- Vetting and checks: `page_type, fetchability, confidence, vetted_at, vet_note, last_checked_at, last_ok_at, last_changed_at, consecutive_failures, doc_links[]`.
- Team (per funder): `team{state, owner, ask_usd, updated_at}`. `normalize` also reads `notes`, which the fixture does not contain.
- Fit: `fit_score, fit_reasons[2], fit_breakdown{v, total, tier, dims[{key,level,points,max,why,quote,url?}]}`, `evidence{key:{quote,url}}`, `evidence_ok{}`, `facts_verified`, `verified_at, verified_by`, `lane`.
- Collection: `collection{mode (calls|cycle|page|none), health (ok|failing|stale|thin|off), source, checked_at, ok_at, open_calls, total_calls, last_call_at, note, verified_at}`.
- Legacy: "Rio Grande Land Stewardship Fund" has none of `fit_breakdown`, `evidence`, `lane`.
- Team states in the fixture: new 9, reviewing 1, applying 1, submitted 1, declined 1, awarded 1, skip 1.
- Collection modes: calls 7, cycle 3, page 4, none 1 (matches `feed.collection`).

`opportunities[]`: `{id, funder_id, title, url, apply_url, description, open_date, deadline, deadline_text, award_min_usd, award_max_usd, status (open|forecasted), doc_links, first_seen_at, last_seen_at, source_adapter (null on fixture)}`. Unverified calls also carry `vet_status:'candidate'`.

`changes[]`: `{funder_id, at, kind (deadline|content|amount|docs|initial|status), summary, docs_added, deadline:[old,new]|null}`.

`vetting[]`: `{funder_id, at, kind (registered|rescored|verified|updated|demoted|promoted), note, changes:{key:[old,new]}, run_label}`.

`metrics[]`: `{day, m:{vetted, by_bucket, by_lane, by_tier, avg_fit, itemized, addressable_usd, actionable_usd, pipeline{state:{n,usd}}, quality{...}, health{...}, collection{listed, auto, open_calls}}}`.

`screened[]`: `{name, program, bucket, reason, at}`. This is the rejected-funder list, with no id and no url.

## 4. Dashboard runtime (dashboard.html inline module)
Shell and ids:
- Nav: `#nav` (:20-22) holds `button[data-nav]` for radar, board, insights, method. Labels: Radar, Pipeline (`board`), Insights, Method.
- `#radar` (:37) contains `.scopebar`, `#kpis`, `#picks`, `#lanes`, `#laneNote`, `#buckets`, `#horizon`, `.fbar` (:51-73), `.meta` (:75-82) and `#list` (:83).
- `.fbar`: `#q` search (:53), `#fWindow`, `#fFit`, `#fSort`, `#moreBtn`, `#presetBtn`/`#presetList`, `#resetBtn`. `.moref` holds `.chips[data-g]` for ua, tier, geo, band, partner, team, themes; `data-c` checkboxes for loi, cost, changed, calls; and `#evidChip`.
- `.meta`: `.views button[data-view]` for table, cards, timeline; `#count`, `#showDq`, `#showSkip`, `#csvBtn`.
- `#viewroot` (:86) hosts module views. `#drawer` `<dialog>` (:90), `#unlockDlg` (:91-100: `#uPass`, `#uName`, `#uErr`, `#uGo`), `#helpDlg` (:101-103), `#tip` (:104), `#toasts` (:105), `#pill` `#refreshed` (:24), `#unlockBtn` (:25).

State `S` (:152-153): `feed, rows, F (filters), view, radarView, sort ('recommended'), scope, sel, open:Set, team (map from grants_team_notes), pass (sessionStorage 'salsav.dash.pass'), me (localStorage 'salsav.dash.me'), uv, now, list, base, since (localStorage 'salsav.dash.lastVisit')`.
- `RADAR=['table','cards','timeline']`, `MODS=['board','insights','method']` (:150).
- `go(v)` (:299) allows only RADAR and MODS (`pipeline` aliases `board`). `chrome()` (:292-298) sets `HEAD` titles (:285-290) and hides `#radar` for non-radar views.
- Lazy modules: `load(name)` (:308) imports `./dash/${name}.js` and `dash/${name}.css` (CSS load errors tolerated). Used for `board`, `insights`, `method` and `drawer`.
- Module contract: `render(root, app)`. `app` (:332) = `{S, D, el, ico, link, num, rubric(), openDrawer, setFilters, go, unlocked, requireUnlock, saveTeam, toast}`.

RPCs (`API` = `https://iuzgfldgvueuehybgntm.supabase.co/rest/v1/rpc/` at :112; anon key at :113; `rpc()` at :159):
- `grants_feed` (no args), :168.
- `grants_check_pass({p_pass})`, :531.
- `grants_team_notes({p_pass})`, :187. Only `res.team` is read (:188). `res.events` is ignored.
- `grants_set_state({p_pass, p_funder, p_patch:{state|owner|notes|ask_usd, actor}})`, :201.
- Error code `28000` means a bad passcode, which triggers `lock()` (:191).

Other flows:
- `saveTeam` (:195-211): optimistic update, then RPC, then `compute(); renderKpis(); renderPicks()` for non-notes patches. On failure it rolls back and re-renders.
- `compute()` (:335): `S.list = sortRows(applyFilters(S.rows,F), S.sort)`, plus `S.base`, `S.dqN`, `S.skipN`.
- `render()` (:342): radar parts, then `syncUI()` and `writeHash()`.
- Hash (:588-593): `hashOf` writes `encodeHash(S.F, S.view, sort)`. `q` is included, so search text already lives in the URL hash.
- Keys (:614-628): `/` focuses `#q` and forces `go('radar')`; `j`/`k` move; `Enter` opens; `e` unlocks or focuses `#tNotes`; `1`/`2`/`3` switch radar views; `g` then `r`/`p`/`i`/`m`; `t` theme; `?` help; `Esc` closes.
- Presets (:573-584): built-ins are `D.PRESETS`; user presets live in localStorage key `salsav.dash.presets`.
- Filter chips (:541-548): `chips('partner', ['UA','YPV','AVS'])` is hard-coded (:543). Tier chips fall back to hard-coded tiers. Themes come from counts filtered by `vocab.themes`.
- Bucket chips (:398-406): `renderBuckets` shows only buckets present in `kpi.byBucket`. Each is `.bchip` with `style --c:bcolor(b)`, toggling `F.bucket`. There is also an unverified-calls toggle `bchip--uv` (localStorage `hideUv`).
- KPI tiles (:354-365), seven of them: Apply now (lane), Closing in 30 days (window=30), Prime and strong fit (tier), In play (opens board), New this week (changed), Collected automatically (opens method and scrolls to `#m-collection`), Evidence-backed (evid).
- `renderPicks` (:377): `D.recommend(S.rows, S.now, 5)`.
- Radar views: `tableView` (:436, COLS at :435: name, bucket, deadline, amount, ua, fit, team, chg), `cardsView` (:453), `timelineView` (:490, dots coloured by `bcolor`, plus agenda), `quick(r)` (:465, expanded row).
- `teamEl(r)` (:270-278): when unlocked, a `.state-sel` select per row and the "I'm applying" button (`applyingNow`, :279, sets owner to `S.me`). When locked, a read-only chip.
- `fitPop` (:231): hover and click popover per fit score.
- `openDrawer(id, keep, section)` (:322) calls `load('drawer').renderDrawer(d, r, app)`.
- Unlock (:527): `grants_check_pass`, then `S.pass` and `S.me` are stored, then `loadTeam`.
- CSV (:596): `D.toCsv(S.list)`.
- Timers: lastVisit stamp (:631-632); 60 s day-roll and refresh tick (:633).

## 5. Drawer, board, insights, method
`dash/drawer.js`:
- `renderDrawer(d, r, app)` (:11). Body order (:20): `hero` (:80), `fitSection` (:103), `factsSection` (:130), `collectSection` (:196), `callsSection` (:207), `teamSection` (:223), `historySection` (:260).
- `.dfoot` prev/next uses `step()` (:33). `wire(d)` (:37) handles Tab trapping, j/k, and focus restore on close.
- Module state: `failed` (:9) remembers the last unsaved team write.
- `hero` (:80-100): bucket chip `--c:var(--b-…)` (:82), lane chip `chip--lane lane-<lane>` (:83), flags Changed and Check by hand (:84), `dkey` dl (Deadline, Award, Fit button that jumps to `#fit`) (:93-97), `.dact` Apply and Call page (:98), `vet_note` lede (:99).
- `factsSection` (:130-160): `.dtags` geography and theme chips at :154. Tags are not at the top of the sidebar.
- `teamSection` (:223-255): locked branch shows a state chip, owner and ask, plus "Unlock editing" (:225-229). Unlocked branch has `#tState` select (:237), `#tOwner` (:238), `#tAsk` number (:239), `#tNotes` textarea (:240, saves 900 ms after input and on blur; `d._flush` at :243), `.tstat` status (:231-236), and "I'm applying" (:254).
- `historySection` (:260-274): merges `r._changes` (page changes, :264), `S.feed.vetting` filtered by funder (:265, labels `VET` at :259), and a health event (:268). `HIST_SHOWN=8`.
- `callsSection` (:207) lists `feed.opportunities` by funder, sorted by deadline.

`dash/board.js` (Pipeline):
- `render(root, app)` (:12). `COLS` (:5) = new, reviewing, applying, submitted, awarded, declined. There is no skip column; rows with `_skip` are excluded (:19).
- `new` column: `recommend(fresh)` first, then the rest by fit. `NEW_CAP` 5, `CAP` 12.
- Card (about :49-58): `.rl` name, `.bwhen` deadline and countdown, `.bfit` score and bar, `.bown` (owner text, or "No owner", plus ask or award), `.bmove` "Move to" menu (`ul.bmenu#mv-<id>`, lists all `D.STATES` including skip). Drag and drop only when unlocked. No bucket chip is shown.
- `move()` calls `app.saveTeam`.

`dash/insights.js`: `bcolor` redefined at :18; `.ins-legend` (:51); scatter marks coloured inline (:56).

`dash/method.js`: `sec(id, …)` gives section ids `'m-'+id` (:15, so `#m-collection` is produced here; inferred). `bucket()` chip (:12) redefines `bcolor`. Screened search (:78). `jump(id)` (:122). The collection status copy comes from `COLLECT_SAYS`, `statusEl`, and `collectionTotals`.

## 6. Colours (current state)
- Tokens: `--b-us_federal, --b-intl_dev, --b-state_regional, --b-private_sector, --b-foundation_ngo, --b-tracker` are defined in `dashboard.css:12` (light) and `:33` (dark).
- Redefinitions of `bcolor`: `dashboard.html:144`, `dash/insights.js:18`, `dash/method.js:12`, and inline in `dash/drawer.js:82` and `dash/horizon.js` (style string `--b-${…}`). Fallback to `tracker` in each.
- `dash/viz.js:16` `bucketCls` maps to `viz-b-<bucket>` classes, styled in `dash/viz.css:25-30`.
- Chip and dot CSS: `.bchip` (`dashboard.css:146-153`), `.dot` (:203), `.chip--line` (:201).
- Lane colours: `.lane--apply_now` (`dashboard.css:242`), `.chip--lane.lane-*` (`dash/drawer.css:32-35`).
- Gaps: the board has no bucket marker. Labels differ: `SHORT` (`dashboard.html:142`) gives "Intl. development", while `D.BUCKETS` (`dashboard.js:4-5`) gives "International development".

## 7. Supabase grants (server side the UI depends on)
Project `iuzgfldgvueuehybgntm` (Salsav, MCP `supabase-avs`). Migrations in `supabase/grants/NNN_name.sql` with `-rollback.sql` pairs.

Public RPCs, all SECURITY DEFINER, executable by anon and authenticated:
- `grants_feed()`: first defined in 002_api.sql:268, latest in 010_radar_v2.sql:664 (plus 011, 021 changes). Returns `generated_at, min_days, min_award, rubric, vocab.themes, coverage_min, funders[]` (where `v.status='vetted' and category<>'aggregator'`, with `team` joined from `team_state`, defaulting state to `'new'`), `opportunities[]` (vetted or candidate calls, status forecasted or open), `changes, vetting, metrics, discovery, targets`, `screened[]` (`status='rejected'`, limit 250: name, program, bucket, reason, at; no id, url or kind; 010_radar_v2.sql ~:733-738), `last_run, runs_24h, collection`.
- `grants_team_notes(p_pass)`: 002_api.sql:323-333. Returns `{team: team_state rows, events: last 100 team_events desc}`.
- `grants_set_state(p_pass uuid…)`: latest body 010_radar_v2.sql:745-774. Takes `p_funder uuid, p_patch jsonb`, validates state and `ask_usd` (0 to 1e11). Writes `team_state` and inserts `team_events(funder_id, actor, kind='update', payload = patch minus actor and notes, plus notes_changed)`. Actor is `patch.actor` or `patch.owner` or `'team'`.
- `grants_check_pass(p_pass)`: 002_api.sql:299, wraps `grants.check_pass`.
- Lockdown: `revoke all on all functions in schema grants` (010 end and 002:334).

Tables:
- `grants.team_state` (001_schema.sql:227): `funder_id pk, state, owner, notes(4000), updated_at, updated_by, ask_usd bigint`. State check widened in 010_radar_v2.sql:27-30 to new, reviewing, applying, submitted, awarded, declined, skip.
- `grants.team_events` (001:235): `id, funder_id, at, actor, kind, payload`.
- `grants.funders` (001:49): `status candidate|vetted|rejected` (:96); `reject_reason` required when rejected (:133); `funders_vetted_fit` check in 010 (grants_008e section, near the end): vetted non-aggregator needs `fit_inputs` and `fit_score>=40`.
- `grants.opportunities` (001:145): `status open|forecasted|closed|archived` (:158); `vet_status candidate|vetted|rejected` (:160).
- `grants.vet_events` (010:63-68): kinds registered, rescored, verified, updated, demoted, promoted. Written by the status-change logic at 010:434-435.
- `grants.discovery_log` (outcome vetted, candidate, rejected, duplicate, unreachable; :252). `grants.targets` (010:33). `grants.discovery_runs` (010:54). `grants.metrics_daily` (010:74).

Functions for review and promotion (API.md):
- `grants.register_source(p jsonb, p_lens, p_run_label)`: 018 version; `reject_kind` `not_a_funder|ended` (018:50).
- `grants.reverify_source(p_id, p jsonb, p_run_label)`: verdict `keep|demote|promote`. Gates still apply (`gate_reason`). `demote` sets status rejected with reason (API.md:58-73).
- `grants.reject_opportunity(p_id, p_reason, p_run_label)`: changes only a `candidate` call (API.md:84-88).
- `grants.set_target(p_id, p_status, p_note)` (API.md:90); `grants.add_targets(p jsonb, p_source)` (010:469); `grants.check_known`.
- Gates (`gate_reason`, first match rejects): ua unlikely; award_max under 200000; no breakdown; mission `none`; total under 40.

Cron and crawler:
- 003_cron.sql: `grants-refresh-am` `0 13 * * *` and `grants-refresh-pm` `0 1 * * *`, both calling `kick_refresh`. Superseded by 022_staggered_refresh.sql:46-49: `0-45/3 13 * * *` and `0-45/3 1 * * *`, each calling `grants.kick_refresh_shard(trigger, (minute/3)%8)`. Eight shards, at most 4 funders per request, no self-chaining.
- Other cron: `grants-prune` `30 11 * * 0` (003e_prune_job.sql); `grants-metrics` `20 1,13 * * *` calling `snapshot_metrics` (010:788).
- Queue helpers: `grants.claim_sources(p_run, p_shard, p_shards, p_limit, p_lease_s)` (002:63), `grants.remaining_due(p_shard, p_shards)` (002:92).
- `grants.discovery_brief()` keys (API.md:153): today, gates, rubric, theme_vocab, coverage, targets, reverify (010:647), failing, collection_gaps, metrics, last_runs, last_refresh.
- Per-funder collection configs: `supabase/grants/collect/cfg/<id>.json`, audit trail in `collect/audit/`, documented in `COLLECT.md`.

Edge function `supabase/functions/grants-refresh/`:
- Source: `adapters/{api,collect,feed,index}.ts`, `engine.ts`, `handler.ts`, `index.ts`, `store.ts`, `guard.ts`, `politeness.ts`, `robots.ts`, `safe_regex.ts`, `backoff.ts`, `diff.ts`, `extract.ts`, `http.ts`, `ua.ts`, `types.ts`.
- Tests: `tests/{adapters-handler,collect,core,engine,extract,http,safe_regex}.test.ts`, `helpers.ts`, `smoke-seed.ts`, `fixtures/`.
- How they run: `tests/run-all.sh` does `npm i` then `npm test`, which is `node --experimental-strip-types --test --test-concurrency=1 --test-timeout=240000 tests/*.test.ts`. It needs a scratch Postgres at `localhost:54329` or `DATABASE_URL`. Not run.
- `supabase/grants/tools/deploy_gate.mjs --fn grants-refresh`: runs only collect and extract tests, then config checks over `collect/cfg`, then writes `.deploy-ok.json` stamp (a write). Not run.
- `supabase/grants/tests/run_sql_test.sh` runs `schema_test.sql` against scratch Postgres on port 54329, inside a transaction that rolls back. Not run.

## 8. Local scheduled tasks
- `salsav-funding-discovery`: cron `0 7 * * 2,5` (Tue and Fri 07:00, jittered), enabled, next run 2026-11-20T13:08:53Z. Its SKILL.md (5 lines) says: `git checkout funding-radar-v2 && git pull --ff-only`, then follow `supabase/grants/discovery-task.md`. That file sets a budget: re-verify up to 6, fix collection up to 6, work up to 14 targets, examine about 40 candidates, list at most 12 new funders. It uses only `grants` schema SQL, closes with `log_discovery_run`, and ends with a push and a PushNotification.
- The other seven scheduled tasks are NomadSwipe marketing lanes. Not relevant here.

## 9. Hooks for the planned features
**F1. Search persistent in nav, cross-tab, with autocomplete**
- Move the input out of `#radar`. `#q` is at `dashboard.html:53` inside `#radar` (:37). `chrome()` (:295) hides `#radar` on other views, so the input must sit in the topbar (:18-22).
- Wiring to keep: input listener (:558, 180 ms debounce, sets `S.F.q`, then `render()`); `syncUI` (:552) writes `#q`; `resetFilters` (:540) clears it; `/` shortcut (:622) must focus the topbar input without `go('radar')`.
- Matching: `_hay` (`dashboard.js:179`) covers name, program, themes, notes, eligibility_note, team notes and owner. `matches()` (:193) requires all words.
- Autocomplete: add a pure `suggest(rows, q, n)` in `dashboard.js` so it can be tested. Build candidates from `S.rows` names, programs, themes and owners.
- Trap: the Escape handler (:617) blurs only `t.id === 'q'`. Keep the new input's id, or update the handler.
- Persistence: `encodeHash` already includes `q` (`dashboard.js:307`), and `go()` does not reset `S.F`, so the text survives tab changes.

**F2. Consistent colours for the category filters**
- One source of truth: `--b-*` (`dashboard.css:12,33`). Replace the five `bcolor` copies (`dashboard.html:144`, `insights.js:18`, `method.js:12`, `drawer.js:82`, `horizon.js`) with one exported helper in `dashboard.js`. Keep `viz.js:16` `bucketCls` aligned.
- Add a bucket marker to pipeline cards (`board.js` card, about :49-58), which has none today.
- Traps: the `tracker` fallback is repeated in five places. `SHORT` (`dashboard.html:142`) and `D.BUCKETS` labels differ. Chips show only buckets present (`renderBuckets`, :400), so an absent bucket has no colour on screen. Check the dark values at `dashboard.css:33` for contrast.

**F3. Pipeline status in project sidebar; tags at top**
- Move `.dtags` from `drawer.js:154` (inside `factsSection`) to `hero()` (`drawer.js:80-100`, row at :89).
- Show pipeline state, owner and ask in `hero()`. Data is already on `r.team` (`dashboard.js:167`). `teamSection` (`drawer.js:223`) currently shows state only in the locked branch (:227).
- Trap: `failed` (:9) and `d._flush` (:243) are tied to `teamSection`. Keep them intact when restructuring. `wire()` (:37) must still close and focus correctly.

**F4. Owners identifiable in pipeline; owner attribution and history**
- Identify owners on the card: `board.js` `.bown` (owner is plain text today).
- Attribution data exists in `grants.team_events.actor` (010:745-774). `grants_team_notes` returns `events` (last 100), but `loadTeam` (`dashboard.html:186-190`) reads only `res.team`. Store `res.events` in `S` and render it.
- Actor sent by `saveTeam` (:201) is `S.me || r.team.owner`. `S.me` is in localStorage (`salsav.dash.me`, :153).
- Traps: `team_events.payload` never contains note text (only `notes_changed`). `kind` is always `'update'`, so per-field history needs a new kind or a payload read. The events are not filtered by funder client-side. Any new RPC must keep the `revoke all` and check-pass pattern.
- History overview hooks: `drawer.js:260` `historySection` (add a "Team" source from `events` filtered by funder), and `board.js` summary (`.bsummary`).

**F5. Database tab: rejected funders with reasons; promote, demote funders and proposals**
- Data gap: `screened` (010_radar_v2.sql ~:733-738) has no `id`, `url`, `reject_kind` or fit. Extend it, or add a passcode-gated `grants_rejected(p_pass)` RPC. Note that today this list is public through the anon feed.
- New view: add `'database'` to `MODS` (`dashboard.html:150`), a nav button (:21), a `HEAD` entry (:285), and a module `dash/database.js` plus `.css` (loaded by `load()`, :308).
- Hash: `VIEWS` (`dashboard.js:306`) rejects unknown views (`decodeHash` :324). Add `'database'` and `'galaxy'`, and extend the view loop in `dashboard.test.mjs:228`.
- Demote a tracked funder: `grants.reverify_source` verdict `demote` (API.md:68-72). It needs a new public passcode-gated wrapper, because grants.* is locked.
- Demote a proposal: `grants.reject_opportunity` only handles `candidate` calls (API.md:88). Vetted or open calls need a new function and wrapper.
- Promote a rejected funder: `reverify_source` `promote` still runs `gate_reason`, so a manual override needs a new path. It must still satisfy `funders_vetted_fit` (`fit_score>=40` and `fit_inputs` not null), and `reject_reason` must be cleared.
- Audit: `vet_events` kinds `demoted` and `promoted` already exist (010:67, 434-435).
- Trap: a funder that leaves `status='vetted'` disappears from `grants_feed`, so it vanishes from Radar and Pipeline even if `team_state` still says applying. Decide what happens to the team row on demote.

**F6. Radar keeps progressed projects, with a visual flag**
- The cause of the disappearance is `matches()`, `dashboard.js:191`: `_dq` rows are hidden unless `F.dq`. A submitted or applying funder whose deadline passes becomes `_dq` and is hidden by default. Pipeline still shows it, because `board.js` filters only `_skip`. Fix: exempt progressed states (applying, submitted, awarded) at :191.
- Flag: add a class in `tableView` (`dashboard.html:442`), `cardsView` (:454) and `timelineView` (:510), and a chip in `badges()` (:267-269). `teamEl` already has chips for these states (:272).
- Keep `recommend()` (`dashboard.js:146`) excluding non-new, non-reviewing states.
- Keep `_skip` hidden (`dashboard.js:192`).

**F7. Quick notes, saved to DB, visible on every surface**
- Existing: `team_state.notes` (4000 chars), edited only in the drawer (`drawer.js:240-247`, debounced save plus flush on close). Searched through `_hay` (`dashboard.js:179`). Not shown in table, cards or pipeline.
- Trap: notes load only when unlocked (`loadTeam`, `dashboard.html:186`), and `S.team` is replaced wholesale (:188). Locked viewers never see them.
- Options: (a) reuse `team_state.notes` as a single note; (b) a new `grants.project_notes(id, funder_id, opportunity_id?, author, body, created_at)` table with RPCs. Opportunity-level notes have no column today (inferred: needs a new table).

**F8. Galaxy tab: funder clustering with quick filters**
- Add `'galaxy'` to `MODS`, nav, `HEAD`, and `VIEWS`, as in F5. Module `dash/galaxy.js`: a pure, seeded layout function exported for tests (like `horizonLayout`, `horizon.js:11`), plus `render(root, app)`.
- Quick filters: reuse `S.F` and `applyFilters` (`dashboard.js:212`), so Galaxy shares filter state with Radar.
- Dimensions available: `bucket`, `_band` (`amountBand`, :80), `_geo` (`geoGroups`, :84), `themes`, `fit_score`, `_tier`, `_lane`, `feed.vocab.themes`.
- Clustering on themes (similarity measure) is not in the code yet (inferred).
- Plotting helpers: `viz.js` `scatter` (:102) and `esc` (:6). Chart output must not contain colour literals (add a guard like `viz.test.mjs:208`).
- Tests: a new `dash/galaxy.test.mjs` in the `collection.test.mjs` style, with the same `t` helper and the `N tests passed` footer.

**F9. Crawler queue, cron shards, local scheduled discovery**
- Shards: 022_staggered_refresh.sql (`0-45/3`, eight shards via `kick_refresh_shard`). A promoted funder must reach the crawler, which needs a collection config (`collect/cfg/<id>.json`, see COLLECT.md) with mode `calls` or `cycle`. Otherwise it stays `none` or `page`.
- Queue options for an "agentic queue" (judgement): (a) `grants.add_targets` with the funder's URL as a hint, so discovery works it as a target (discovery-task.md step 4); (b) a new flag, say `grants.funders.queued_for_review`, read by `discovery_brief` `reverify` (010:647). Option (b) is more precise. Promotion should also set `verified_at`/`verified_by` so the reverify selection picks it up (inferred).
- Edge function changes require `run-all.sh` and `deploy_gate.mjs`. Subagents do not deploy.
- Local task: update `discovery-task.md` steps 2 to 4 to consume the new queue.
- Trap: `dashboard.test.mjs:214` pins `supabase/grants/rubric_v2.json`. Any rubric change must update both.
- Preview: `launch.json` serves `python -m http.server 8765`. The `?feed=` dev hook (`dashboard.html:166`) uses `sameOriginFeed` (`dashboard.js:359`), which accepts only same-origin paths, so `dashboard.fixture.json` can be served for preview.