# Dash subsystem map (read-only, nothing written)

Evidence: `dash/{board,drawer,horizon,insights,method,viz}.js` and their `.css` were read in full, plus `dash/viz.test.mjs`, `collection.test.mjs` and `.claude/skills/salsav-dashboard-ui/SKILL.md`. `dashboard.html` and `dashboard.js` were read by grep-slice only, and their line refs are marked `~` where approximate. Live reads were SELECT-only on supabase-avs (Salsav): `pg_proc` bodies of `public.grants_feed`, `grants_set_state`, `grants_team_notes`, `grants.reject_opportunity`, plus status counts. `(inferred)` marks anything not read.

## 1. Shared contracts

**app object** (dashboard.html:332): `{S, D, el, ico, link, num, rubric(), openDrawer(id, keep, section), setFilters(patch), go(view), unlocked(), requireUnlock(), saveTeam(id, patch)->Promise<bool>, toast(msg, kind)}`. `D` is the dashboard.js export set.
- `S` fields used by modules: `feed, rows, list` (radar-filtered order), `base, now, since` (lastVisit), `sel, me, team, unlocked, uv, F, kpi, stateLabel` (STATE_LABEL, dashboard.html:143, `new:'New'`), `bucketLabel` (SHORT, :142).

**Module contract**: `renderModule()` (dashboard.html:310-321) imports `./dash/<name>.js` and `dash/<name>.css` through `load()` (:308), then calls `m.render(#viewroot, app)`. `MODS=['board','insights','method']` (:150). Radar views (table/cards/timeline) render in the shell. The drawer is `renderDrawer(#drawer, r, app)` via `openDrawer` (:322-329), and the shell only calls `showModal`.

**el()** (dashboard.html:122-132): aria booleans become `"true"/"false"` strings. This is verified. SKILL.md rule 1 is already implemented, and `board.js:55` plus `.bmove[aria-expanded="true"]` (board.css:45) work. It is not a live bug.

**Row** (dashboard.js normalize, ~L165-185): `feed.funders[]` plus `team{state, owner, ask_usd, notes}` (notes only when unlocked), `_days, _state, _dq` (= deadlineState expired|too_soon), `_skip` (= team.state==='skip'), `_lane` (client-side `lane()`), `_tier, _evid, _band, _geo` (Set), `_new, _changedAt, _changes[], _unverified, _manual`, `_hay` (search haystack; includes team notes and owner only when unlocked).

**Feed** via public RPC `grants_feed()` (rpc() dashboard.html:159-164, anon key, Salsav project). Verified top-level keys: `generated_at, min_days, min_award, rubric, vocab.themes, coverage_min, funders, opportunities, changes, vetting, metrics[{day,m}]` (last 90 days), `discovery{runs,by_lens,totals}`, `targets{by_bucket[{bucket,pending,covered,rejected,deferred}], next[{org,program_hint,bucket,priority,why}]}` (pending, top 15, no id), `screened[{name,program,bucket,reason,at}]` (status rejected, limit 250, **no id**), `collection` (grants.collection_metrics(); read keys listed/auto/open_calls/healthy; body inferred), `last_run, runs_24h`.
- `funders[]` = `grants.v_funders` where `status='vetted'` and `category<>'aggregator'`, plus `team{state (default new), owner, ask_usd, updated_at}` (no notes, no updated_by), plus `collection` = `grants.collection_state(id)` (body inferred; drawer reads mode, health, source, checked_at, open_calls, note, verified_at).
- `opportunities[]`: `status in (forecasted, open)`, `vet_status in (vetted, candidate)`, deadline null or >= today (Phoenix). Fields: id, funder_id, title, url, apply_url, description, open_date, deadline, deadline_text, award_min/max_usd, status, doc_links, first_seen_at, last_seen_at, source_adapter, vet_status.
- `changes[]` (120 days, non-error snapshots). `vetting[]` = vet_events (180 days): funder_id, at, kind, note, changes, run_label.

**Team write path**
- `saveTeam(id, patch)` (dashboard.html:195-211): optimistic `Object.assign(r.team, patch)`, `r._skip` recomputed, `render()` unless the patch is notes-only (:199). RPC `grants_set_state {p_pass, p_funder, p_patch: {...patch, actor: S.me || r.team.owner}}`. On success it updates `S.team[id]`. On error it reverts and renders, code 28000 calls `lock()`, and a drawer that is open is re-opened (:208).
- SQL `grants_set_state(p_pass text, p_funder uuid, p_patch jsonb) -> jsonb` (verified body): `grants.check_pass` (28000 on failure); the funder must have `status='vetted'` (else `unknown funder`); state must be one of the 7 values; ask_usd is an integer from 0 to 1e11; upsert `grants.team_state(funder_id, state, owner<=80, notes<=4000, ask_usd, updated_by=actor)`, where `actor = left(coalesce(patch.actor, patch.owner, 'team'), 60)`; insert `grants.team_events(funder_id, actor, kind='update', payload = patch − actor − notes + {notes_changed: bool})`. The previous values and the note text are NOT stored.
- `grants_team_notes(p_pass) -> {team: team_state rows (funder_id, state, owner, notes, updated_at, updated_by, ask_usd), events: last 100 team_events across all funders}`. `loadTeam` (dashboard.html:186-190) keeps state/owner/notes/updated_at/ask_usd and **drops updated_by and events**.
- `grants_check_pass(p_pass) -> bool`. One shared passcode. Identity is self-typed: `S.me` is stored in localStorage `salsav.dash.me` (dashboard.html:532).

**Schema facts (verified)**
- `grants.funders.status`: vetted 107, rejected 117 (all with `reject_reason`), candidate 1.
- `grants.discovery_log.outcome`: rejected 107, vetted 114, candidate 4 (all with reason).
- Public RPC surface is exactly 4 functions: `grants_feed, grants_team_notes, grants_set_state, grants_check_pass`.
- `grants.reject_opportunity(p_id, p_reason, p_run_label)` acts only when `vet_status='candidate'` (otherwise returns `unchanged`). It sets `rejected` and logs vet_events `updated`. It has no public wrapper.
- Other internal grants functions: `set_target, set_collection, reverify_source, register_source, upsert_opportunity, start_run, finish_run, claim_sources, kick_refresh, kick_refresh_shard, remaining_due, log_discovery_run, collection_metrics, collection_state, discovery_brief, sweep_opportunities`.
- Tables: `funders` (has shard, next_check_at, lease_until, lease_run), `opportunities`, `targets`, `team_state`, `team_events`, `vet_events`, `snapshots`, `discovery_log`, `discovery_runs`, `refresh_runs`, `host_state`, `metrics_daily`, `settings`.

## 2. Module map

### board.js (93) and board.css (57): pipeline
- Export `render(root, app)` (L12). Module state `ui={menu, all:Set, focus, at, drag}` (L9). Imports `fitBar` from viz.js.
- `COLS` (L5) = new, reviewing, applying, submitted, awarded, declined. No 'skip' column. `LABEL={new:'Not started'}` (L6), which disagrees with `S.stateLabel`'s "New". `HINT` (L7). `NEW_CAP=5, CAP=12` (L8).
- `rows = S.rows` minus `_skip` (L18). The new column is `D.recommend(fresh)` first, then the rest by fit (L21-24). Other columns sort by fit desc, then name (L25).
- `usd(r) = team.ask_usd ?? award_max_usd ?? 0` (L15).
- Card `li.bcard[data-id]` (L47-63): classes `.dq` (`_dq`) and `.open`. Draggable only when unlocked (L49). Contents: `button.rl` → `app.openDrawer` (L50); `div.bline` `when()` (L37-41, `.urgent` when live and under 30 days, `.closed` when dq and live); `div.bfit` with `span.bscore` fit, `fitBar` svg (`fit_breakdown.dims`, w=120) and `_tier.label` (L52-53); `div.bown` with the owner as **plain text** `team.owner || 'No owner'` and the ask text (L54); `button.bmove` "Move to" (aria-expanded, aria-controls) (L55); `ul.bmenu#mv-{id}` lists D.STATES, with 'skip' labelled "Skip it" (L43-46).
- `move(r,to)` (L30-35): same state redraws; otherwise `requireUnlock()` then `saveTeam(id,{state:to})` and a toast. Drag: dragstart/dragend (L58-61), drop on `section.bcol` (L75-77).
- Column: `section.bcol.bcol--{state}[data-state]` > header (`h2#bc-{state}`, `.bn` count, `.bsum` money) > `p.bhint` > `ul` or `p.bempty` (L65-80). `button.bmore` toggles `ui.all`.
- Summary `.bsummary` (L84-87): "bids in play" = reviewing+applying+submitted; awarded; not started.
- Viewer note `.bnote` (L88). Wrapper `div.board[role=group]` (L89). scrollLeft kept (L90). Focus restored for 1.5s (L92).
- Cards show no bucket chip, no lane, no notes, and only a `.dq` class for disqualified funders.
- board.css: 6-column grid (L10); column tints `.bcol--new` (L12), `--awarded` (L13), `--declined` dashed (L15); `.bcard` (L27); `.bown` (L40); `.bmenu` (L46-51); ≤760px 78vw columns (L55). `.dash .bnote` (L7): do not reuse the class name.

### drawer.js (274) and drawer.css (129): funder sidebar
- Exports: `renderDrawer(d, r, app)` (L11); `COLLECT_SAYS` (L161, hard-coded "twice a day" copy at L162-163); `collectionOf(f)` (L168); `callOrigin(o)` (L173); `coverageRows(rows)` (L175); `collectionTotals(feed, rows)` (L180); `totalsSentence(t)` (L188); `statusEl(app, health)` (L193).
- Section order (L20): `hero` → `fitSection#fit` → `factsSection#facts` → `collectSection#collect` → `callsSection#calls` → `teamSection#team` → `historySection#history`.
- Header eyebrow "Funder i of n" comes from `S.list` (L19-22). Footer Previous/Next call `step(±1)` over `S.list` (L26-27, keys j/k at L49).
- `hero(r,app)` (L80-100), `header.dhero`: `.row` with bucket chip `.chip--line` (`--c: var(--b-bucket)`, L82), lane chip `.chip--lane.lane-<_lane>` (L83), flags "Changed" (`_changedAt > S.since`) and "Check by hand" (`_manual`) (L84); `h2#dTitle`; `p.dprog`; `.alert--bad` if `_dq` (L92); `dl.dkey` with Deadline, Award (+confidence mark), Fit as `button.dfit` that scrolls to #fit (L93-97); `.dact` Apply + Call page (L98); `p.dlede` vet_note (L99). **No team status, no tags, no notes.**
- `factsSection` (L130-157): emeter of quoted facts; `dl.facts` (Deadline, Award, Can UA apply?, Cycle, To apply, Partners needed); **`div.dtags` at L154** holds geography and theme chips, mid-sidebar; docs list (L155); prose (L142); Feed link.
- `fitSection` (L103-127): `explainFit(r, rubric)` dims with `fd-bar`, `quote()` using `r.evidence_ok[key]`, and "What would raise this score". Not-itemized fallback at L105-109.
- `quote(app,q,st,url)` (L73-77): st true = "Matched on the funder's page", false = "Not on the monitored page", undefined = "Quoted by the reviewer".
- `callsSection` (L207-220): `S.feed.opportunities` filtered by funder_id and sorted by deadline. Each call shows title link, Forecast or status chip, an "Unverified" chip when `vet_status==='candidate'`, deadline, amount, description, origin and first-seen. No promote or demote control.
- `collectSection` (L196-204): mode label, via source, `statusEl(health)`, relTime, `COLLECT_SAYS[mode]`, note, verified_at.
- `teamSection` (L223-255):
  - Locked (L225-230): state, owner and ask chips from `r.team`, plus an unlock CTA.
  - Unlocked: `select#tState` (L237), `input#tOwner` (maxlength 80, L238), `input#tAsk` (number, step 1000, L239), `textarea#tNotes` (maxlength 4000, L240), `p.tstat` status (L231-236), and "I'm applying" → `mine()` sets state applying and owner=S.me (L248, hidden once state is applying/submitted/awarded, L254).
  - Notes: debounced 900ms, plus blur, plus flush on close and navigation (L241-247, L13, L52).
- `historySection` (L260-274): merges `r._changes` (Page: CHANGE labels), `S.feed.vetting` filtered by funder (Review: VET labels for registered, rescored, verified, updated, demoted, promoted, L259), and a Source health item. Sorted, first 8 shown, then "Show all". **Team actions are not in the timeline.**
- drawer.css: dialog 660px (L2). Lane chip colours L32-35: `.chip--lane` base, `.lane-apply_now` solid primary (L33), `.lane-cultivate` amber-soft (L34), `.lane-watch` outline (L35). **`lane-rolling` and `lane-prepare` have no rule.** `.dtags` (L79), `.team` (L90), `.tstat` (L100-101), `.ev` timeline (L105-110).

### horizon.js (46) and viz.css `.hz*`: deadline dots (Radar only)
- Exports: `EMPTY` (L7); `horizonLayout(rows,{w,minDays})` (L11-18) → `{items, pts[{r,x,n}], xs, ay, H, minDays}`; `unverifiedPoints(rows, opps, now)` (L22-26) → hollow points `{id,name,title,bucket,deadline,_days,_uv:true}`; `horizon(rows,{w,now,minDays,onOpen})` (L31-46) → `svg.viz.hz` or `p.hz-empty`.
- Geometry: D0=-21, D1=365 days (L8); STEP 11, MAX_ROWS 9 (L8, L15). Items outside -21..365 are dropped (L12).
- Dot: `circle.dot[data-id][tabindex=0][role=button]`, class `uv` or `dq` (L41), `style --c var(--b-bucket)`. Click, Enter and Space call `onOpen` (L42).
- Caller: dashboard.html:375 `horizon([...S.list, ...uv], {...})`. The legend count uses the same `horizonLayout(unverifiedPoints(S.list,...))` (~L405), so counts match (SKILL rule 4).
- Header comment (L1) says "shared by Radar and Insights". **Stale**: insights.js does not import horizon.js.
- Imports `dayNum, todayISO, countdown, fmtDate, daysLeft, BUCKETS` from `../dashboard.js`.

### insights.js (138) and insights.css (88): Insights, 7 sections
- Export `render(root, app)` (L14). Data is `D.insights(rows, feed, S.now)` (dashboard.js ~L274-300). Keys read: `scatter[{id,name,fit,award,bucket,lane,days}]`, `undated[]`, `fitHist[{tier,label,n}]`, `anatomy[{key,label,avg,max}]`, `coverage[{bucket,label,vetted,min,screened,pending}]`, `funnel[{state,n,usd}]` (new→awarded; declined appended at insights.js:85), `quality[{key,label,pct}]`, `health{total,checked24h,failing,manual}`, `trend{days,vetted,applyNow,evidence3}`, `discovery`, `collect{now,days}`.
- Helpers: `chart(host,fn)` with ResizeObserver redraw (L23, L135-137). `wire(svg, sel, act)` makes `[data-id]` marks keyboard buttons (L25-33). `pick(group,k)` toggles `S.F[group]`, then `setFilters` and `go('table')` (L21). Groups used: tier, bucket, team, band.
- Sections (ids `ins-map`, `ins-fit`, `ins-cov`, `ins-pipe`, `ins-time`, `ins-conf`, `ins-trend`; jump nav L129-130):
  1. Opportunity map: scatter of fit against days, plus lane aside. The shaded zone is fit ≥60 and ≤90 days, hard-coded (L40, L45-46).
  2. Fit tiers hbars and score anatomy.
  3. Coverage bars against `coverage_min`.
  4. Pipeline funnel, rows wired to `pick('team')`.
  5. Funder mix and award-band hbars.
  6. Data confidence: meters, source health, collection spark.
  7. Trends, discovery stackedBars, and a lens hbars (L127, no bucket, so colour is by index).
- Takeaway sentences are computed in-file. RH() gives 44px rows at ≤760px (L9).
- insights.css: section grid 3fr/8fr (L7); sticky head uses `--topbar-h` and `--fbar-h` (L8); tier colours by data-id (L56-59); zone amber (L26).

### method.js (132) and method.css (120): Method
- Export `render(root, app)` (L9). Imports `fitBar` and drawer.js helpers (L3-4).
- Inputs: `feed.min_award` (default 200000, L11), `feed.min_days` (14), `rb.min_fit` (40), `rb.dims[{key,label,max,question,source,levels[{points,label,rule}]}]`, `rb.tiers[{key,label,min}]`, `S.rows`, `feed.screened`, `feed.targets`, `feed.coverage_min`, `feed.discovery`, `feed.collection` (via `collectionTotals`).
- Sections `m-listed, m-fit, m-rank, m-screened, m-queue, m-runs, m-collection`. The `.mjump` nav uses buttons, not hashes (L121-124).
  1. Six hard-coded steps (L20-27).
  2. Tiers, dimension tables, and a worked example (top funder by `_evid.n` then fit, L45-54).
  3. Ranking: **hard-coded weights** (L61-62: +12 for 14–45 days, +15 for 46–90, +8 for 91–180, +4 rolling, +2 recurs, +5 UA direct, +3 for 3–4 facts). Not checked against `recScore`. Top 5 via `D.recommend(S.rows, S.now, 5)` (L63).
  4. Screened out, with search via module `ui.q` (L73-86).
  5. Coverage table and "Next ones up" from `feed.targets.next` (L88-99).
  6. Runs and totals, plus **hard-coded cadence copy** "re-read twice a day… every Tuesday and Friday" (L104).
  7. Collection modes, totals sentence, per-source table (L111-119).
- method.css: stacked `data-l` tables ≤760px (L95-102, used by mcov/mruns/mcol); `.mflow` collapses ≤900px (L87-94); tier border colours (L27-28).

### viz.js (198) and viz.css (85): SVG-string primitives (node-testable, `esc()` on all strings)
- `esc` (L6). `fitBar(dims,{w,h,values,total})` (L25): `g.viz-seg[data-id=dim key]`. `ring(score,{size,label,max,tier})` (L45): arc class `viz-t-{tier}`. `spark(values,{w,h,label})` (L57).
- `hbars(items,{w,rowH,labelW,valueW,fmt,max})` (L70): items `{id,label,value,bucket?,note?}`, rows `g.viz-row[data-id]`. Colour = `bucketCls(bucket, index)` (L82): bucket keys map to `viz-b-*`, anything else to `viz-s{i%6}`. **Colour depends on row position when no bucket is given.**
- `scatter(points,{w,h,x='days',y='fit',r='award',xLabel,yLabel,xMax,yMax,labelTop})` (L102): `g.viz-mark[data-id][data-lane]`, shape per bucket index (`mark()` L89-99), top-N halo labels.
- `funnel(stages,{w,rowH,labelW,valueW})` (L137): `g.viz-row[data-id=state]`, monochrome ramp `viz-f0..f5` by index.
- `meter(pct,{w,h,label})` (L155). `stackedBars(series,{w,rowH,labelW,totalW,legend,normalize})` (L164): segment `data-id = series:part`; non-bucket keys use `viz-s0..5` (L186-188).
- viz.css: `.viz-b-<bucket>` (L25-30); `.viz-s0..5` = primary, terra, warn-fg, **b-us_federal, b-foundation_ngo** (L31-36, these reuse bucket hues); funnel ramp (L38-42); ring tier arcs (L57-61); `.hz` horizon styles (L73-85).
- Tests: `dash/viz.test.mjs`, `dash/collection.test.mjs` (covers the drawer helpers, per the comment at drawer.js:160), and `dashboard.test.mjs` at repo root.

### Colour tokens outside dash/ (relevant to features 2, 6, 8)
- `--b-<bucket>` tokens at dashboard.css:12 (light) and :33 (dark).
- `.lane--apply_now { color: amber }` at dashboard.css:242 is the only lane styled in the table. Table lane cell is dashboard.html:446.
- `.laneseg` lane tabs at dashboard.css:138-143, no per-lane colour.
- Net effect: apply_now is amber text in the table and a solid primary chip in the drawer. rolling and prepare have no colour anywhere. cultivate and watch are coloured only in the drawer.

### SKILL.md (salsav-dashboard-ui), rules summarised
1. el() must receive aria booleans as strings (implemented, see above).
2. Reproduce live with getAttribute and getComputedStyle before editing CSS.
3. Native select: `appearance:none` plus a gradient chevron.
4. Legend and count chips use the same layout function as the chart.
5. A layer-toggle chip is `button[aria-pressed]`. Its flag `S.uv` persists as the inverted store key `hideUv='1'`.
6. Local check: serve, fetch changed files with `cache:'reload'`, then reload.
7. Run `dash/viz.test.mjs`, `dash/collection.test.mjs`, `dashboard.test.mjs` before commit.
8. A JS run that calls reload or navigate is cut off, so check the tab URL first.
9. After push, poll for a marker: CSS via `/dashboard.css`, HTML via `cache:'no-store'`. Netlify takes about 20s.
10. Test at 1620x900, then reset the viewport to desktop.
11. Commit to the work branch. AGENTS.md grants push for branches, not main.

## 3. Hooks for the planned features

**1. Search persistent in nav, across tabs, with autocomplete**
- Nav buttons `[data-nav]` at dashboard.html:21 (radar, board, insights, method). `chrome()` L292-298 toggles `#ruleWrap`, `#radar`, `#viewroot` by view.
- `#q` input at dashboard.html:53 (filter bar). Whether it sits inside the radar-only block is (inferred). `/` shortcut at :622 switches to radar. `#q` handler at :558 (180ms debounce → `S.F.q` → `render()`).
- Matching: `matches()` (dashboard.js:190-212) splits `F.q` on whitespace, and every word must be in `_hay`.
- Autocomplete source: `S.rows` (name, program, team.owner). It is rebuilt for all views (`rebuild`, dashboard.html:170), so a shell-level dropdown can use it on every tab.
- Trap: `_hay` has notes and owner only when unlocked. Rows that are `_dq` or `_skip` still match but stay hidden by `matches()`, so the dropdown needs its own visibility rule. `render()` (:342) re-renders the module on every keystroke, which board.js focus logic (L92) tolerates.

**2. Category filter colours identifiable across pages**
- "5 category filters" is ambiguous. It is either the 5 lanes (apply_now, rolling, prepare, cultivate, watch; labels from D.LANES, tab bar in `renderLanes`, dashboard.html:388-398, with `b()` at :393) or the bucket chips (6 buckets, `renderBuckets` ~L400-410, which shows only non-empty buckets). Name both in the design.
- Edit sites: drawer.css:32-35 (3 of 5 lanes styled), dashboard.css:242 (table apply_now amber), dashboard.css:138-143 (laneseg), dashboard.css:12/:33 (token pairs, light and dark), viz.css:25-36 (hue classes), insights legend (insights.js:51).
- Traps: apply_now differs by surface. Bucket hues are already reused for series colours (viz.css:34-35), so new lane tokens must not collide with `--b-*`. Bucketless bars take colour from row index (viz.js:82), so the same lens can change colour between runs. Give series explicit colours. Dark theme needs the dashboard.css:33 block duplicated.

**3. Pipeline status visible in the project sidebar; tags at the top**
- Status chip: add to the hero row at drawer.js:89, using `S.stateLabel`. Viewers have state from `feed.team`, so the chip works while locked.
- Tags: move `div.dtags` (drawer.js:154) from `factsSection` into `hero()`, after the h2 at L90. CSS is drawer.css:79.
- Trap: hero is static. A successful `saveTeam` does not re-render the drawer (dashboard.html:199 re-renders the shell, not `#drawer`). Only the error path re-opens it (:208). The chip goes stale after a state change. Update the chip by id inside `save()` (drawer.js:235-236). Do not call `renderDrawer`, because it replaces `#tNotes` and loses typing.

**4. Owners identifiable in pipeline; owner attribution; history overview**
- Owner display: board.js:54 (plain text). Drawer field drawer.js:238 (free text, maxlength 80). Identity is `S.me` (self-typed, localStorage, dashboard.html:532). Actor = `patch.actor ?? owner ?? 'team'` (SQL). One shared passcode.
- History data: `grants_team_notes().events` (last 100 across all funders). It is discarded at dashboard.html:186-190. Store it as `S.events`, filter by funder_id, and add a "Team" tag in `historySection` (drawer.js:260-274).
- Traps: payload is only the patch, with no previous value and no note text (only `notes_changed`). "From → to" needs a server change that reads the previous row before the upsert. Events are capped at 100 globally, so an overview needs a paged RPC. `updated_by` is returned but dropped at dashboard.html:188 (keep it for "last changed by"). Team events are visible only when unlocked.
- Identifiable owners: a normalised owner key (trim and case) and a per-owner colour token, shown in the board card `.bown` (board.js:54).

**5. Database tab: rejected funders and reasons; promote; demote funders and proposals; promoted funders feed the agentic queue**
- Tab wiring: nav button at dashboard.html:21, `MODS` at :150, plus `dash/database.js` and `database.css` exporting `render(root, app)`. `VIEWS` is a dashboard.js constant after `insights()`. `decodeHash` falls back to 'table' for unknown views. HEAD titles in dashboard.html ~L284-290 (inferred). Module views use `[data-nav]` buttons, and radar views use `.views` buttons (:411).
- Data: 117 rejected funders have `reject_reason` in `grants.funders`. `feed.screened` cannot drive actions because it has no id and is capped at 250. discovery_log rejected rows (107) carry reason and funder_id. Needs a new public RPC with a passcode check, for example `grants_rejected(p_pass)`.
- Promote rejected → tracked: `grants_set_state` refuses non-vetted funders (SQL). A new RPC must set `funders.status='vetted'` and create the team row. The feed only includes vetted funders, so the client needs a feed refetch to see them (inferred).
- Demote tracked funder: set `funders.status='rejected'` with `reject_reason`, plus a vet_events row. The drawer VET labels include demoted and promoted, but the DB kind strings are not queried (inferred). Team-only "skip" already exists via `saveTeam({state:'skip'})`.
- Demote proposal: `opportunities.vet_status` from 'vetted' to 'rejected'. `reject_opportunity` only handles 'candidate' and has no public wrapper, so a new RPC is needed. The per-call control fits `callsSection` (drawer.js:207-220), since `o.id` is in the feed.
- Agentic queue: promoted funders must enter the queue the crawler reads. Candidates are `grants.targets` (pending, shown in the Method queue, method.js:88-99) and the refresh queue (`claim_sources` and `kick_refresh`, bodies not read, so inferred to select vetted funders by shard and next_check_at).

**6. Radar keeps progressed projects, with a visual flag**
- What hides them is not team state. `matches()` line 191 has `if (r._dq && !F.dq) return false`, and `_dq` is set in normalize from expired or too_soon. So a progressed funder under 14 days out disappears from table, cards, horizon and KPIs. `S.dqN` counts them. Skip is separate: `_skip` hides unless `F.skip` or `F.team` includes 'skip' (dashboard.js:192).
- Horizon also drops anything beyond -21 or +365 days (horizon.js:8, :12).
- `D.recommend` excludes states other than new and reviewing (dashboard.js:142-160). That is intended for "Next best moves" and should not be the visibility rule.
- Flag sites: table row class `row-dq` (dashboard.html:442), cards (:454), horizon dot classes (horizon.js:41, add `pipe`; styles viz.css:80-83), board card class (board.js:49).
- Trap: a dot can be both dq and pipe. Define precedence in horizon.js:41.

**7. Quick notes saved to the database, visible on every surface and tab**
- Storage exists: `grants.team_state.notes` (one text per funder, 4000 chars), written via `grants_set_state({notes})`, read via `grants_team_notes` (unlocked only). UI is `#tNotes` (drawer.js:240-254).
- Visible only in the drawer, and searchable only when unlocked (`_hay`).
- Across tabs: `S.team` loads only at init and unlock (dashboard.html:178, :186-190). Another tab's edit is not seen until reload.
- Trap: content is not logged. Multiple timestamped notes need a new table and RPC. Do not reuse `bnote` (board.js:88, board.css:7).
- Preview sites: board card (board.js:47-63), table row (dashboard.html:442-446), horizon dot title (horizon.js:41).

**8. Galaxy tab: premium clustering of funders with quick filters**
- New `dash/galaxy.js` (`render(root, app)`) and `galaxy.css`, registered like Insights: MODS (dashboard.html:150), VIEWS (dashboard.js), nav button (:21).
- Per-row inputs: `bucket, themes[], geography[]` (`_geo` Set), `ua_eligibility`, `_band`, `award_max_usd`, `fit_score`, `_lane`, `team.state`. Vocabulary: `feed.vocab.themes`.
- Quick filters can reuse `pick`-style `setFilters` (insights.js:21) and the F keys bucket, band, geo, themes, ua, lane, tier.
- Keep the layout pure for node tests, as `horizonLayout` does (horizon.js:11). Parse SVG with DOMParser as insights.js:8 does.
- Traps: viz.js has no force or network layout, so clustering is new code. Tier colours come from viz.css:57-61 and should not be reused for clusters.

**9. Crawler queue, cron shards, local scheduled discovery task**
- Outside dash/. Couplings inside dash: hard-coded schedule copy at method.js:104 and drawer.js:162-163.
- Feed fields that depend on the crawler: `funders[].collection` (`collection_state`, body inferred), `feed.collection` (`collection_metrics`, body inferred), `feed.discovery` (discovery_runs and discovery_log), `last_run` and `runs_24h` (refresh_runs), `feed.targets` (targets).
- Read before changing shards: `kick_refresh(p_trigger,p_shards,p_budget_ms)`, `kick_refresh_shard(p_trigger,p_shard,p_shards,p_max_sources,p_budget_ms)`, `claim_sources(p_run,p_shard,p_shards,p_limit,p_lease_s)`, `start_run`, `finish_run`, `remaining_due(p_shard,p_shards)`. Tables `refresh_runs`, `host_state`, and `funders.shard`, `next_check_at`, `lease_until`, `lease_run`.
- A promoted funder (feature 5) probably needs a shard assignment and a next_check_at so the refresh picks it up (inferred). The local scheduled discovery task was not read.

## 4. Findings to carry into the design

Verified unless marked.
1. The Radar hides progressed funders within 14 days via `_dq`, not team state (dashboard.js:191).
2. Lane colours differ by surface. Two of five lanes have no colour anywhere (drawer.css:32-35, dashboard.css:242).
3. Drawer status goes stale after a save (drawer.js:235-236 against dashboard.html:199 and :208).
4. `grants_team_notes.events` and `updated_by` are discarded (dashboard.html:186-190).
5. `team_events` stores no previous value and no note text (SQL body).
6. Rejected funders are invisible to the client because the feed filters `status='vetted'`. 117 rejected rows exist.
7. `grants_set_state` refuses non-vetted funders (SQL body).
8. `reject_opportunity` acts only on candidate (SQL body).
9. `feed.screened` has no id and is capped at 250 (SQL body).
10. Hard-coded ranking weights and crawl cadence in method.js:61-62 and :104, plus drawer.js:162-163. Not checked against `recScore` (inferred).
11. horizon.js:1 says Insights shares the horizon, but insights.js does not import it.
12. board.js:6 labels `new` "Not started", while `S.stateLabel` says "New" (dashboard.html:143).
13. Bucketless series colours depend on row index (viz.js:82, :186-188).
14. Drawer Previous, Next and the count follow `S.list` (radar order). A funder opened from the pipeline but hidden by filters shows "Funder details" with both nav buttons disabled (drawer.js:19-27).
15. Board cards show no bucket or lane, so bucket colours never appear on the pipeline page (board.js:47-63).
16. Identity is self-typed and the passcode is shared. "Vetted user" can only mean unlocked. Owner is free text (drawer.js:238).