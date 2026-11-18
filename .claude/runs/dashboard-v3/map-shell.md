## SALSAV funding radar: dashboard subsystem map (read-only)

Assumption: "the 5 category filters" means the 5 lanes (`D.LANES`, dashboard.js:9). The 6 funder-type bucket chips are the alternative reading, noted where relevant.

### 1. Files and load order
- `dashboard.html` (642 lines): markup plus one inline `<script type="module">` at line 107 to 640. It is the whole shell and router.
- `dashboard.js` (363 lines): pure logic, no DOM at import. Exports `normalize`, `matches`, `applyFilters`, `sortRows`, `kpis`, `insights`, `recommend`, `explainFit`, `encodeHash`/`decodeHash`, `PRESETS`, `toCsv`, `safeUrl`, `sameOriginFeed`, plus constants `BUCKETS`, `UA`, `STATES`, `LANES`, `COLLECT_MODES`, `COLLECT_HEALTH`.
- `dashboard.css` (329 lines): tokens, shell, Radar, table, cards, timeline, filters, dialogs, breakpoints.
- Head, in order: inline theme script (html:8), Google Fonts (html:12, Inter and Source Serif 4), `dashboard.css` (html:13), `dash/viz.css` (html:14).
- Module graph, synchronous: `dashboard.js`, `dash/viz.js`, `dash/horizon.js` (html:108-110). `horizon.js` imports `../dashboard.js` (horizon.js:3), which is the one cross-directory import.
- Lazy, on first use: `dash/<name>.js` plus `dash/<name>.css` via `load()` (html:308). Names are `board`, `insights`, `method`, `drawer`. `loadCss` gives up after 3 s (html:307).
- Test files (not run): `dashboard.test.mjs`, `dash/collection.test.mjs`, `dash/viz.test.mjs`. Fixture: `dashboard.fixture.json`, used via the `?feed=` hook.

### 2. Page structure and views
- Header `header.topbar` (html:18-28): `a.brand`, `nav#nav` (html:20-22), `span#refreshed.pill`, `button#unlockBtn`, `button#themeBtn`, `button#helpBtn`.
- Nav buttons are `[data-nav]`: radar, board, insights, method. The label "Pipeline" maps to view `board` (html:21, go() at html:300).
- `main#main` (html:30). `section.pagehead` holds `#pgTitle`, `#pgLede`, `#ruleWrap`/`#ruleBtn`/`#rulePop` (the 14-day rule text is hard-coded, html:34).
- Radar container `div#radar` (html:37-84) shows only when view is radar. It contains:
  - `.scopebar` with `[data-scope=all|filtered]`
  - `#kpis`, `#picks`, `#lanes`, `#laneNote`, `#buckets`, `#horizon` (`#hzBody`)
  - `.fbar` (html:51-73): `#q`, `#fWindow`, `#fFit`, `#fSort`, `#moreBtn`, `#presetBtn`/`#presetList`, `#resetBtn`, `#moref` (chip groups `[data-g]` and checkboxes `[data-c]`)
  - `.meta`: `.views [data-view=table|cards|timeline]` (ids `tab-table`, `tab-cards`, `tab-timeline`), `#count`, `#showDq`, `#showSkip`, `#csvBtn`
  - `#list[role=tabpanel]`
- `div#viewroot[hidden]` (html:86) is the module mount point for board, insights and method.
- Dialogs: `dialog#drawer.drawer` (html:90), `dialog#unlockDlg` (`#unlockForm`, `#uPass`, `#uName`, `#uErr`, `#uGo`, `#uCancel`), `dialog#helpDlg` (`#hClose`). Plus `#tip` (html:104) and `#toasts` (html:105).
- View state: `S.view` in `table|cards|timeline|board|insights|method` (html:152). `RADAR` and `MODS` arrays at html:150. `HEAD[view]` (html:285-290) provides titles.
- Switching: `go(v)` (html:299-305) sets `S.view` and `S.radarView`, then calls `render()`. `chrome()` (html:292-298) toggles `#radar` and `#viewroot`, sets `aria-current`, and updates the document title.
- `render()` (html:342-346): `compute()`, `chrome()`, then either the Radar renders (`renderKpis`, `renderPicks`, `renderLanes`, `renderBuckets`, `renderHorizon`, `renderMeta`, `renderList`) or `renderModule()`. Then `syncUI()` and `writeHash()`.
- Module contract: `renderModule()` (html:310-321) calls `m.render(root, app)`. The drawer is `renderDrawer(d, r, app)`. The `app` object is built at html:332: `{ S, D, el, ico, link, num, rubric, openDrawer, setFilters, go, unlocked, requireUnlock, saveTeam, toast }`.
- Hash (`dashboard.js:306` VIEWS, `encodeHash`/`decodeHash` at dashboard.js:307-326): `hashOf()`/`applyHash()` at html:589-592, writes via `history.replaceState`. Filter `q` is written to the hash because `defaultFilters` includes it. The passcode is never in the hash.
- Keyboard (html:614-628): `/` focuses `#q` and forces Radar. `j`/`k` move. `Enter` opens. `e` unlocks or focuses `#tNotes`. `1`/`2`/`3` are radar views. `g` then `r`/`p`/`i`/`m` navigates (map at html:620). `t` toggles theme. `?` opens help. `Esc` closes.

### 3. Auth, identity, roles
- There is no user account system. The only credential is a shared team passcode. "Vetted" or team user means "holds the passcode", checked server-side by `grants.check_pass` (002_api.sql:6-22). Only the anon key is in the client.
- Passcode storage: `sessionStorage['salsav.dash.pass']` (per tab). Set and cleared via `store.sset` (html:532, 191, 207, 534).
- Name and owner: `localStorage['salsav.dash.me']`, set from the unlock form (html:532), sent as `p_patch.actor` (html:201). It is self-declared and not authenticated. The server truncates it to 60 characters (010_radar_v2.sql, `grants_set_state`).
- Other localStorage keys: `salsav.dash.theme` (html:600), `salsav.dash.lastVisit` (html:631), `salsav.dash.hideUv` (html:153), `salsav.dash.presets` (html:574). `store.get`/`set`/`sget`/`sset` are wrapped in try/catch (html:116-121).
- Error handling: code `28000` means bad passcode and clears the pass (html:178, 207). Message `locked` means lockout, shown as "Too many wrong tries" (html:534).
- Lockout: settings `lockout_failures` (default 8) and `lockout_minutes` (default 15), from `coalesce` in 002_api.sql:6-22 (inferred defaults, not read live).
- `unlocked()` = `!!S.pass && S.unlocked` (html:155). `requireUnlock()` opens the modal (html:194).

### 4. RPC contract (exactly four public functions, 002_api.sql:1-3, granted to anon at 002_api.sql:334-335)
- `POST {API}<fn>` with JSON body and `apikey` plus `Authorization: Bearer` headers (html:159-164). `API` is the Salsav project REST base (html:112). The anon key is at html:113. Its value is not reproduced here.
- `grants_feed()` → jsonb, no args (html:168). Latest definition: 010_radar_v2.sql:664, patched in 011_collection.sql:201-202 and 021_candidate_calls.sql:9-14 (string patches via `pg_get_functiondef`). The body has no INSERT, UPDATE or DELETE (checked with grep, 010_radar_v2.sql:664-744).
- `grants_check_pass(p_pass text)` → boolean (html:531).
- `grants_team_notes(p_pass text)` → `{team: [...], events: [...]}`, `events` = last 100 `team_events` (002_api.sql:323-331). Client reads only `res.team` (html:187-188). `events` is discarded.
- `grants_set_state(p_pass text, p_funder uuid, p_patch jsonb)` → team row (010_radar_v2.sql:745-775). Patch keys: `state` (validated against new|reviewing|applying|submitted|awarded|declined|skip), `owner` (≤80), `notes` (≤4000), `ask_usd` (0 to 1e11 or null), `actor`. Writes `grants.team_state` (upsert) and appends `grants.team_events(funder_id, actor, kind='update', payload = patch minus actor and notes, plus notes_changed)`.
- Team row shape from client use: `{funder_id, state, owner, notes, updated_at, ask_usd}`. The `team_state` columns are `funder_id, state, owner, notes, ask_usd, updated_by, updated_at` (inferred from the SQL).
- Errors: `28000` bad passcode, `P0001` locked, `unknown funder` if the funder is not vetted, `bad state`, `bad ask_usd`.
- Any new write, such as promote or demote, rejected-funder reads, or notes history, needs a new `public.grants_*` wrapper. It must check the passcode with `grants.check_pass` and be granted to anon. The `grants.*` internals (for example `grants.reject_opportunity`, 021_candidate_calls.sql:19; `grants.set_target`, 010_radar_v2.sql:495; `grants.register_source`, 018) are not callable from the browser.

### 5. Data loading and global state
- `init()` (html:172-180): show skeleton, then `S.feed = loadFeed()` (html:165-169). `loadFeed` uses `D.sameOriginFeed(qs.get('feed'))` (dashboard.js:358-362) for the dev hook, or `rpc('grants_feed')`. Then check `Array.isArray(feed.funders)`, then `rebuild()`, `buildFilterUI()`, `loadTeam()` if a pass exists (a 28000 error clears it), `applyHash()`, `render()`.
- `rebuild()` (html:170): `S.now = new Date(); S.rows = D.normalize(S.feed, S.now, S.team)`.
- `normalize()` (dashboard.js:160-182) merges `S.team` over `f.team` and adds derived fields:
  - `_days`, `_state` (`deadlineState`, 14-day rule via `min_days`), `_dq` (expired or too soon)
  - `_skip` (team state is `skip`), `_lane`, `_tier` (rubric tiers), `_evid`, `_band`, `_geo`
  - `_new`, `_changedAt`, `_changes`, `_unverified`, `_manual`
  - `_hay`: lowercased join of name, program, themes, notes, eligibility_note, team.notes, team.owner
- Global `S` (html:152-153): `feed`, `rows`, `F` (filters), `view`, `radarView`, `sort` (default `recommended`), `scope`, `sel`, `open` (Set), `team` (overlay map), `pass`, `me`, `uv`, `now`, `list` (filtered and sorted), `base`, `since`, `stateLabel`, `bucketLabel`. Also set later: `unlocked`, `kpi`, `dqN`, `skipN`.
- Feed top-level keys (names from `dashboard.fixture.json`, plus the feed's own check at 010_radar_v2.sql:~650): `generated_at, min_days, min_award, rubric, vocab, coverage_min, funders, opportunities, changes, vetting, metrics, discovery, targets, screened, last_run, runs_24h, collection`.
- Funder row (keys read by the client, shape inferred): `id, name, program, bucket, ua_eligibility, deadline, cycle, award_min_usd, award_max_usd, amount_confidence, amount_flag, fetchability, consecutive_failures, last_checked_at, last_ok_at, last_changed_at, vetted_at, fit_score, fit_breakdown{total,dims[{key,level,points,max,why,quote,url}]}, fit_reasons, evidence{}, evidence_ok{}, facts_verified, requirements{loi,cost_share,indirect_cap,page_limit,registrations,notes}, partner_needed, themes, geography, open_now, url, apply_url, feed_url, doc_links, collection{mode,health,open_calls,source,checked_at,verified_at,note}, team{state,owner,ask_usd}, vet_note, notes, eligibility_note, deadline_note, award_note, requirements_text`.
- Opportunities (`feed.opportunities`): `id, funder_id, title, url, apply_url, deadline, deadline_text, award_min_usd, award_max_usd, status (forecasted|open|closed|archived), vet_status, source_adapter, first_seen_at, description`. Patch 021 makes `vet_status` in (`vetted`, `candidate`), so candidates ship with a flag. `rejected` rows are hidden.
- `feed.vetting[]`: `{funder_id, at, kind (registered|rescored|verified|updated|demoted|promoted), note, changes}` (drawer.js:259, mapped from `grants.vet_events`, 010_radar_v2.sql:63 and 434).
- `feed.screened[]`: `{name, program, reason, bucket, at}`, no funder id (method.js:74-86). Backed by `grants.discovery_log` where outcome is `rejected` (001_schema.sql:246-262) (inferred).
- Rejected funders: `grants.funders.status='rejected'` requires `reject_reason` (001_schema.sql:96, 133). They are not in the `funders` array, which is vetted-only (html:432 copy). Not delivered to the client (inferred from the emptyFeed text, not verified).
- `feed.targets` (`by_bucket[{bucket,pending,covered,rejected,deferred}]`, `next[{org,program_hint,why,bucket,priority}]`) is the agentic queue view (method.js:89-99). Backing table `grants.targets` (010_radar_v2.sql:33, status CHECK at line 42).
- `feed.discovery` (`runs[]`, `totals{examined,vetted,rejected,candidate}`, `by_lens[]`) and `feed.metrics[]` (daily `{day,m{...}}`) feed Method and Insights.

### 6. Search: current implementation
- Input: `input#q[type=search]` inside `.fbar` (html:53), which is inside `#radar`. The shell hides `#radar` on other views (html:295), so search is invisible there.
- Listener (html:558): 180 ms debounce, then `S.F.q = value.trim(); render()`.
- Matching (dashboard.js:193): split on whitespace, every term must be a substring of `r._hay`. Matches are AND.
- Where it applies: `compute()` → `S.list` (html:335-341). This feeds the Radar list, timeline agenda, cards and table, and the KPIs under scope "Current filters" (`S.base = S.list`, html:338).
- Where it does NOT apply: Pipeline (`board.js:18` uses `S.rows` directly and ignores `S.F`), Insights (uses `D.insights(S.rows)`), Method (has its own `ui.q` search for screened-out sources, method.js:7, 76-84), drawer prev/next (uses `S.list`, so it does follow the filter).
- Sync: `syncUI()` writes `$('#q').value` (html:552). `resetFilters()` clears it (html:540). `/` focuses it (html:622).
- Autocomplete: none. Candidate data sources already in memory: `S.rows` names and programs, `S.feed.vocab.themes`, team owners.

### 7. Category filters and colors
- Lanes (5, `D.LANES`, dashboard.js:9): `apply_now, rolling, prepare, cultivate, watch`.
  - Render: `renderLanes()` (html:389-397), `.laneseg` buttons with `aria-pressed`, All plus 5 (html:395). Click toggles `S.F.lane` via `setFilters`.
  - Filter: `matches` line 199 (`r._lane !== F.lane`).
  - No lane color token exists. `.laneseg button` uses `--accent` underline only (dashboard.css:139-143).
  - Table text: `.lane--apply_now` is amber (dashboard.css:241-242). Other lanes are muted.
  - Drawer chip: `.chip--lane.lane-apply_now` is solid primary green, `.lane-cultivate` is amber-soft, `.lane-watch` is outlined. `rolling` and `prepare` have no rule (drawer.css:32-35). The same lane therefore differs between table (amber) and drawer (green).
  - Insights strip (insights.js:53-55) shows lane names as plain text headers.
  - Pipeline (board) shows no lanes.
- Buckets (6, `D.BUCKETS`, dashboard.js:3-6): `us_federal, intl_dev, state_regional, private_sector, foundation_ngo, tracker`. Alternate reading of "5": `renderBuckets()` (html:398-406) hides a bucket with zero count, so 5 can show.
  - Colors: tokens `--b-<bucket>` in `:root` (dashboard.css:12) and dark (dashboard.css:33). The tracker bucket maps unknown values.
  - Use: `.bchip` (html:401, css:146-150), `bucketChip` (html:215), timeline dots (html:481), drawer hero (drawer.js:82), method (method.js:12), Insights `GLYPH` plus color (insights.js:11, 18), viz classes `viz-b-*` (viz.css), plus shape per bucket index in `viz.js:89, 129`.
  - Not used on board cards (board.js:47-56).
  - Consistent across pages, so it is not the problem the user describes.
- Other filter groups: UA (`D.UA`, 4), fit tier (rubric tiers or the default 4, html:544), geo (`D.GEOS`, 4), award band (`D.BANDS`, 5), partner (hard-coded `['UA','YPV','AVS']`, html:543), team state (`D.STATES`, 7), themes (from data, filtered by `vocab.themes`, html:545-546).
- Preset chips: `PRESETS` (dashboard.js:327-331), user presets in localStorage.

### 8. Radar components
- KPI strip `#kpis`, 7 tiles built in `renderKpis()` (html:354-368). Each tile sets a filter, and each has a sparkline from `feed.metrics` via `series()` (html:348).
- Next best moves `#picks`: `renderPicks()` (html:377-388) calls `D.recommend(S.rows, S.now, 5)` (dashboard.js:142-157). Eligible lanes are apply_now, rolling, prepare, and the team state must be new or reviewing.
- Deadline horizon `#horizon`: `renderHorizon()` (html:371-376) calls `dash/horizon.js` `horizon()`. Unverified dots come from `unverifiedPoints()` (horizon.js:22-26), toggled by `S.uv`.
- Lists:
  - Table `tableView()` (html:436-452): `COLS` sortable headers (html:435), expand row (`S.open`, quick() html:465-469).
  - Cards `cardsView()` (html:453-458).
  - Timeline `timelineView()` (html:490-515) with `swarm()` and `dot()`.
  - Team column `teamEl()` (html:270-278): `select.state-sel`, `span.saved`, "I'm applying" button (`applyingNow`, html:279-282).
- Badges `badges()` (html:267-269): New, Changed, disqualified reason, Amount unverified, Check by hand.
- Fit popover `fitPop()` (html:231-254): hover or click, one at a time (`openPop`).
- Presets menu, saved in localStorage (html:575-584).
- CSV export `toCsv` (dashboard.js:339-352). Note `CSV_COLS` includes `Team state`, `Owner`, `Notes`.

### 9. Pipeline (board): `dash/board.js`
- `render(root, app)`: columns `COLS` = new, reviewing, applying, submitted, awarded, declined (board.js:5). `skip` is excluded (board.js:18).
- "new" column ordering: `D.recommend` first, then by fit (board.js:21-25). Caps `NEW_CAP=5`, `CAP=12`, with "Show all" (board.js:66-73).
- Card `li.bcard`: name button (`.rl`, opens drawer), `.bwhen` deadline, `.bfit` score plus fitBar, `.bown` owner text plus ask (board.js:54), "Move to" menu `ul.bmenu` (board.js:43-45), drag and drop when unlocked (board.js:47-61, 75-77).
- Moves: `app.saveTeam(id, {state})` (board.js:34), then toast.
- Summary strip `.bsummary` (board.js:84-87).
- Board ignores lanes, buckets, filters and search.

### 10. Drawer (project info sidebar): `dash/drawer.js`
- `renderDrawer(d, r, app)` (drawer.js:11-30). Body order: `hero`, `fitSection#fit`, `factsSection#facts`, `collectSection#collect`, `callsSection#calls`, `teamSection#team`, `historySection#history`. Footer prev and next (drawer.js:25-27).
- `hero` (drawer.js:80-100): `.dhero`. Contains bucket chip, lane chip `chip--lane lane-<key>`, flags, `h2#dTitle`, program, disqualified alert, `dl.dkey` (deadline, award, fit button `.dfit` that scrolls to `#fit`), Apply and Call page links (`app.link`), `vet_note`.
- `factsSection` (drawer.js:130-157): key facts with evidence marks and quotes. Themes and geography are rendered at the bottom as `.dtags` (drawer.js:154).
- `teamSection` (drawer.js:223-255), unlocked: `#tState`, `#tOwner`, `#tAsk`, `#tNotes` (autosave 900 ms, drawer.js:247), `.tstat`, "I'm applying". Locked: state chip, owner, ask, unlock button (drawer.js:225-230).
- `historySection` (drawer.js:260-274): merges `feed.changes` ("Page"), `feed.vetting` ("Review"), and source health ("Source") into one list. Shows 8 by default (`HIST_SHOWN`, drawer.js:8). Team actions are not in this history.
- Close handling: `d.addEventListener('close')` (drawer.js:51-59) flushes notes and restores focus. `d._flush`, `d._app`, `d._opener`, `d._openId`, `d._wired` are internal fields.
- Drawer CSS: `dash/drawer.css` (107 selectors). Classes include `.dhero`, `.dkey`, `.sec`, `.team`, `.team-g`, `.tstat`, `.ev`, `.calls`, `.cstat--ok|bad|warn|off`, `.chip--lane`, `.dtags`, `.mk--ok|warn|line`.
- Opening: `openDrawer(id, keep, section)` (html:322-329). Also `S.sel`.

### 11. Insights and Method
- `dash/insights.js`: seven sections, each with a one-line takeaway. Uses `D.insights()` (dashboard.js:274-302). Clicks call `pick()`, which does `setFilters` then `app.go('table')` (insights.js:21), so they jump back to Radar. Team funnel excludes declined from the main stages and adds it as a separate stage (insights.js:84-86).
- `dash/method.js`: seven sections (`#m-listed`, `#m-fit`, `#m-rank`, `#m-screened`, `#m-queue`, `#m-runs`, `#m-collection`). Imports collection helpers from `./drawer.js` (method.js:4). Reads `feed.rubric`, `feed.screened`, `feed.targets`, `feed.discovery`, `feed.coverage_min`.
- `#m-collection` is the target of the KPI "Collected automatically" (html:362).

### 12. Charts and shared libraries
- `dash/viz.js`: pure string SVG, every caller string escaped (`esc`, viz.js:6). Exports `fitBar`, `ring`, `spark`, `hbars`, `scatter`, `funnel`, `meter`, `stackedBars`. Colors come only from classes in `dash/viz.css`: `viz-b-*`, `viz-s0..5`, `viz-f0..5`, `viz-mark`, `viz-fill`, `viz-ring-arc`, `viz-t-<tier>`.
- Inserted into the DOM via `svgEl` (html:146, `template` element) or `DOMParser` (insights.js:8).
- `dash/horizon.js`: pure geometry (`horizonLayout`, `unverifiedPoints`), and the `horizon()` SVG. Constants `D0=-21`, `D1=365`, `STEP=11`, `MIN_ROWS=7`, `MAX_ROWS=9`. Its `.dot` class collides with the generic `.dot` in dashboard.css:203 (minor).

### 13. CSS tokens and design system
- `:root` (dashboard.css:5-26), dark theme via `html[data-theme="dark"]` (dashboard.css:27-35). Theme is set by `data-theme` on `<html>` (head script, html:8; `setTheme`, html:600).
- Palette: paper `--bg #f4f1e8` / `#101713` dark, surfaces `--surface`, `--surface-2`, ink `--ink`, `--ink-2`, `--muted`, lines `--line`, `--line-soft`, `--rule-strong`. Accent `--primary #24543a` (dark `#7fcf9f`). Also `--terra`, `--ochre`, `--amber`, `--red`, `--ok-*`, `--warn-*`, `--bad-*`, `--accent-soft`, `--amber-soft`, `--red-soft`.
- Bucket hues: `--b-us_federal`, `--b-intl_dev`, `--b-state_regional`, `--b-private_sector`, `--b-foundation_ngo`, `--b-tracker`.
- Type: `--font` Inter, `--serif` Source Serif 4 (display, h1, `.big`, `.kpi .n`). Sizes `--t-xs` through `--t-2xl`.
- Space `--sp-1..7`. Radius `--radius 10px`, `--radius-sm 6px`, `--r-xs 4px`, `--r-pill 99px`. Motion `--dur 160ms`, `--dur-slow 200ms`, `--ease`.
- Layout vars: `--topbar-h 56px`, `--fbar-h` (set by ResizeObserver, html:636-637), `--kpi-h 168px`, `--measure 68ch`.
- Breakpoints: 1240, 1100, 900, 760 (dashboard.css:294-329). Phone targets 44 px.
- Chips: `.chip`, `--ok`, `--warn`, `--bad`, `--line`, `--new` (dashboard.css:199-202).
- Hard-coded colors outside tokens: dashboard.css:192 (shadow), :277 (backdrop), :288 (`#1a0d08`).

### 14. Feature flags and config
- No flag object.
- Implicit flags: `?feed=<same-origin path>` dev hook (html:166); `hideUv` (html:153); `HOVER` media query (html:229); `prefers-reduced-motion` checks.
- Feed-driven settings: `min_days` (default 14, html:161), `min_award` (default 200000, method.js:11), rubric `min_fit` (default 40, method.js:12).
- Hard-coded copy that goes stale: "14-day rule" (html:34), "at least $200k" (html:432), partner chips (html:543), tier fallback (html:544).

### 15. Unverified or inferred
- Live payload shapes: the feed keys and funder fields above are from the client code and the migrations, not from a live read. The live read is blocked (see section 16).
- Lockout defaults (8 failures, 15 minutes) are the `coalesce` fallbacks in `grants.check_pass`.
- `feed.screened` carries no funder id (inferred from method.js:74-86 and the discovery_log schema).
- Whether `grants_feed` returns any rejected funders (inferred: vetted-only, per the copy at html:432).
- The `grants_team_notes.events` contents (inferred from 002_api.sql:323-331).

### 16. Boundary batch (for the lead to run)
My SELECT against supabase-avs was blocked by the boundary guard as a "supabase write", so I did not retry it or reroute it. Nothing was changed. The query is read-only. It calls `public.grants_feed()`, whose body has no INSERT, UPDATE or DELETE, and reads `information_schema` and `grants.funders` counts. No rollback is needed. Exact command:

```sql
select jsonb_build_object(
 'top', (select jsonb_agg(k order by k) from jsonb_object_keys(public.grants_feed()) k),
 'funder', (select jsonb_agg(k order by k) from jsonb_object_keys(public.grants_feed()->'funders'->0) k),
 'collection', (select jsonb_agg(k order by k) from jsonb_object_keys(public.grants_feed()->'funders'->0->'collection') k),
 'opp', (select jsonb_agg(k order by k) from jsonb_object_keys(public.grants_feed()->'opportunities'->0) k),
 'screened', (select jsonb_agg(k order by k) from jsonb_object_keys(public.grants_feed()->'screened'->0) k),
 'vetting', (select jsonb_agg(k order by k) from jsonb_object_keys(public.grants_feed()->'vetting'->0) k),
 'changes', (select jsonb_agg(k order by k) from jsonb_object_keys(public.grants_feed()->'changes'->0) k),
 'n_funders', jsonb_array_length(public.grants_feed()->'funders'),
 'n_opps', jsonb_array_length(public.grants_feed()->'opportunities'),
 'team_state_cols', (select jsonb_agg(column_name order by ordinal_position) from information_schema.columns where table_schema='grants' and table_name='team_state'),
 'team_events_cols', (select jsonb_agg(column_name order by ordinal_position) from information_schema.columns where table_schema='grants' and table_name='team_events'),
 'funders_by_status', (select jsonb_object_agg(status, n) from (select status, count(*) n from grants.funders group by status) s),
 'rejected_with_reason', (select count(*) from grants.funders where status='rejected' and reject_reason is not null)
) as shapes;
```

### Hooks for the planned features

1. **Persistent search in the nav bar, across tabs, with autocomplete.** Move `input#q` (html:53) out of `#radar` into `.topbar` (html:18-22). Keep `S.F.q` as the single source, and update every `#q` reference (html:552, 558, 540, 622, 617). The filter itself already works everywhere through `S.F.q`, but Pipeline ignores it (board.js:18). Add it there, or document it as Radar-only. Autocomplete sources are `S.rows` names and programs, `feed.vocab.themes`, and team owners. Trap: `#q` must be unique. The Method search (method.js:84) is separate and should stay separate.

2. **Lane colors identical across pages.** The 5 lanes are `D.LANES` (dashboard.js:9). Add tokens `--lane-apply_now`, `--lane-rolling`, `--lane-prepare`, `--lane-cultivate`, `--lane-watch` to `:root` and dark (dashboard.css:5-35). Apply them in `renderLanes` (html:393-395), `.lane` text (dashboard.css:241-242, which currently makes apply_now amber), the drawer chip (drawer.css:32-35, which currently makes apply_now green), and the Insights strip (insights.js:53-55). Trap: `rolling` and `prepare` have no drawer rule today. If the user means the 6 buckets, the tokens already exist (`--b-*`), so the fix there is visibility, not color.

3. **Pipeline status and owner in the sidebar; tags at the top.** Put the state chip, owner and ask in `hero()` (drawer.js:88-99), above the fold. Move `.dtags` from drawer.js:154 into `hero()`. The locked team view already shows state and owner (drawer.js:227). Board owner is plain text (board.js:54, board.css:40-42). Trap: `renderDrawer` rebuilds the whole drawer on every save, so the `.tstat` and note flush logic (drawer.js:13, 243, 52) must survive the move.

4. **Owner attribution and pipeline history.** Owner and actor come from the client (html:201, 532), so attribution is self-declared. `grants_team_notes` already returns `events` (last 100, 002_api.sql:323-331), but `loadTeam` drops them (html:187-188). That is the history data. Render it in the drawer, not only in `historySection` (drawer.js:260). Trap: events store only `update` kinds with payload minus notes (010_radar_v2.sql, `grants_set_state`), so note text is not in history. Make owners more identifiable on board cards (`.bown`, board.js:54) and in the drawer (`#tOwner`).

5. **Database tab: rejected funders, promote, demote funder, demote proposal.** New view means: add `'database'` to `MODS` (html:150), `HEAD` (html:285-290), nav (html:21), `VIEWS` (dashboard.js:306), keyboard map (html:620), and a new `dash/database.js` and `.css`. Data is not yet delivered: `feed.screened` lacks funder ids (method.js:74-86), and rejected funders are not in the feed (inferred). Demote and promote need new public RPCs with passcode checks (section 4). Opportunity demote uses vet_status `rejected` (021_candidate_calls.sql:19-30). Drawer timeline already maps `demoted`/`promoted` (drawer.js:259). Trap: the four-RPC public surface is a deliberate design (002_api.sql:1-3), so every new RPC needs the same grant and passcode pattern.

6. **Radar keeps progressed projects with a visual flag.** Radar hides `_dq` (dashboard.js:191) and `_skip` (dashboard.js:192) by default. Projects past their deadline become `_dq` and disappear unless `showDq` is on (html:78). Add a rule in `matches()` that keeps rows with `team.state` in applying, submitted or awarded, and render a flag chip via `badges()` (html:267-269) and `.row-dq` (dashboard.css:236). Trap: `recommend` already excludes them (dashboard.js:146), which is correct.

7. **Quick notes on projects, persisted and visible across surfaces.** Notes exist today as one 4000-character field per funder (`team.notes`, drawer.js:240, sent via `grants_set_state` `notes`). They appear only in the drawer. For multiple timestamped quick notes, add a table or events channel and a new RPC. Surface a count or latest note on board cards (board.js:47-56) and radar rows (`badges`). Trap: `saveNotes` autosaves on blur and after 900 ms (drawer.js:242-247), and `saveTeam` skips the re-render for notes (html:199), so concurrent edits from other tabs are not seen until reload.

8. **Galaxy tab: clustering of funders with quick filters.** No clustering code exists. Inputs per funder: `bucket`, `geography` via `_geo`, `themes`, `fit_score`, `_band`, `ua_eligibility`, `partner_needed`, `_lane`. Build as a new `dash/galaxy.js` that returns an SVG string via `viz.js` conventions (escaped, `data-id` marks wired by a handler, as in insights.js:25-33). Use the `MODS` and `VIEWS` wiring from feature 5. Quick filters should write `S.F` through `setFilters`, the same as Insights (insights.js:21). Trap: marks need the same keyboard and focus handling as `wire()` (insights.js:25-33).

9. **Crawler queue, cron shards, local discovery task.** Outside this subsystem. Dashboard consumes these feed fields: `last_run`, `runs_24h` (html:414-418), `collection` (drawer.js:168-171, method.js:112), `discovery` (method.js:102-109), `targets` (method.js:89-99), `metrics` (html:348). The queue view is `feed.targets.next`. Anything that changes these keys must also change `method.js` and `insights.js`. The 014-day rule is in `dashboard.js:38-42` and copy at html:34. The `grants_feed` body is in 010_radar_v2.sql:664 with 011 and 021 patches. Those files belong to the crawler and grants owners.