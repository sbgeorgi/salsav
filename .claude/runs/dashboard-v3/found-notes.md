# FOUND track notes (dashboard v3)

## Deviations (read first)
- `app.reg` is a function returning `S.reg` (null until `app.loadRegistry()` resolves). Every other member below is a plain value or function as listed.
- `D.suggest` applies its `limit` per group. The shell passes `limit: 3` and caps the list at 8 items in total.
- A demote removes the funder from the radar feed (`grants_feed` holds tracked funders only). The funder then appears in the Database registry as Screened out. The mock does the same.
- Between 901px and 1240px `.tablewrap` scrolls horizontally, so the sticky column header does not stick in that band. Without this the table pushed the page 49px wider than a 1024px viewport.
- Top bar: one 57px row from 901px to 1440px, 81px at 900px, 99px at 640px and 360px. From 1408px the `.wrap` is capped at 1360px, so the subtitle (`.brand span`) and owner name (`.me-wrap .hide-m`) are hidden at every width. The refreshed text and unlock label hide at 1400px and below, the help button at 1100px and below, and the search field is 150px wide at 1100px and below.
- Top bar nav clipping, production layout (pill hidden, measured in iframes): 0px from 960 to 1366px, 3px at 1440 and 1920px (trailing padding only, labels intact), 8px at 901px. At 360px the nav is a horizontal scroll strip with 123px off-screen, by design. The dev-only mock pill (82px) clips the nav by up to 71px at 901px and 15px at 1440 and 1920px.
- `_human` is copied from the registry on every feed rebuild and registry load (`syncHuman`), because `grants_feed` carries no human lock.
- Search loads the registry on the first query (`loadRegistry`), so the Screened out, Leads and Calls groups fill in on the first keystroke.
- `bchip--static` modifier added in `bucketChip` (`dash/ui.js`): a non-interactive chip.
- Mock: `dash/mock.json` registry funders carry `deadline` and `team` keys, and notes carry `deleted_at` and `deleted_by`. `dash/mock.js` projects them to the contract keys on output. The JSON is unchanged (its note says regenerate).
- `onQuery` is wired in `queryChanged` (dashboard.html) but no module exports it yet (both stubs). The full-render fallback is what runs, so the onQuery branch is untested.
- Help at 1100px and below: the help button is hidden, but the `?` key still opens the shortcuts dialog at every width.
- `refresh()` resets `regAsk`, so a search whose first registry load failed retries after the next Refresh. A failed load still shows no toast.
- The search field has `aria-label="Search funders"` (added; it had only a placeholder).

## App API as shipped (`dashboard.html` inline module)
`window.__dash = app` is set only in mock mode.
- `S`, `D`, `el`, `ico`, `link`, `num`, `rubric()`, `openDrawer`, `setFilters`, `go`, `unlocked()`, `requireUnlock()`, `saveTeam`, `toast`
- `ui`: the `dash/ui.js` module namespace
- `rpc(fn, body)`: passcode is injected for write functions. Errors carry `.code` (28000 = bad passcode).
- `me()`: signed-in name, or ''
- `q()`: lowercase search words from `S.F.q`. `matchQ(text)`: true when every word appears in `text`.
- `loadRegistry(force)`: cached `grants_registry`. A failed load is not cached.
- `reg()`: `S.reg`. `S.regById` is a Map of registry funders.
- `funderName(id)`
- `notesFor(id)`, `eventsFor(id)`: empty when locked.
- `addNote(funderId, body, opportunityId?)`, `removeNote(note)`: both require unlock and return true or false.
- `act(kind, id, action, opts?)`: `kind` is `funder` | `call` | `lead`. Actions: `promote`, `demote`, `release` (funder), `restore`, `demote` (call), `queue`, `dismiss` (lead). Asks for a reason in a dialog unless `opts.reason` is given. Promote, demote and dismiss need at least 3 characters.
- `ask({title, body, label, placeholder, confirm, danger, required, value, minLength, maxLength})`: resolves to trimmed text, '' when optional and empty, or null when cancelled.
- `refresh()`: reloads the feed, team (if unlocked) and registry (if loaded), clears the detail cache, then renders.
- `ui_state(name, defaults)`: per-view UI state in `S.ui`.

## Module contract
- `export render(root, app)`. Optional `export onQuery(root, app)`: called when only `S.F.q` changed and the root's `dataset.v` matches the view. Otherwise the view re-renders.
- Radar views (`table`, `cards`, `timeline`) render into `#radar`. Module views (`board`, `database`, `galaxy`, `insights`, `method`) render into `#viewroot`, which gets `data-v`.
- Registration: `VIEWS` in `dashboard.js`; `RADAR` and `MODS` in the inline module; `HEAD` for the view titles.
- Drawer: `renderDrawer(d, r, app)`. `detailRow(id)` fetches `grants_funder` once per id and caches it.

## Search
- `#q` is an ARIA combobox with `#qlist` (listbox). Groups: Funders, Screened out, Leads, Calls, Owners, Themes, Funder types.
- Keys: ArrowUp/Down move, Enter picks the active option (or runs the query), Escape closes the list or blurs. `/` focuses the field without navigating.
- Picking a funder or screened funder opens its drawer. Picking any other group fills the field and filters.

## `dash/ui.js` exports
`initials`, `ownerHue`, `avatar`, `bucketDot`, `bucketChip`, `stateChip`, `statusChip`, `gateChips`, `timeAgo`, `describeEvent`, `activityItem`, `noteThread`, `menu(button, items)`. `el` is a private helper and is not exported.
`menu` uses `button.parentElement` as its wrapper and appends `ul.umenu`. Items are `{label, onSelect, danger?}`.

## `dash/ui.css` classes
`bchip`, `bchip--static`, `schip`, `rchip`, `lchip`, `av`, `gates`, `flag`, `panel`, `empty`, `act`, `notes`, `umenu`, `btn--danger` (in `dashboard.css` as well).

## Mock
- Open `dashboard.html?mock=dash/mock.json` (same origin only, checked by `D.sameOriginFeed`). Any non-empty passcode unlocks.
- `dash/mock.js` serves the read RPCs and the writes in memory. Writes log events and reset on reload.
- The last block of `dashboard.test.mjs` asserts the mock projection (no `deadline`, `team`, `deleted_at` or `deleted_by` keys) and the write error codes (28000, P0001, 42501).

## Verified this run
- Node: `dashboard.test.mjs` (48 tests, including the mock projection block), `dash/collection.test.mjs` (8), `dash/viz.test.mjs` (21), `dash/ui.test.mjs` (10). All pass.
- Mock writes: every write RPC returns contract keys. Errors as expected: no passcode 28000, unknown state and short reason P0001, removing another author's note 42501.
- Headless, fresh load, mock mode: all eight views render content (radar table, cards and timeline; board, insights and method). Database and galaxy show their stub text. Console shows only the browser's automatic `/favicon.ico` 404; the page's icon link (`static/salsa-logo.png`) returns 200, and all 13 page resources return 200.
- Lazy search on a real load: `S.reg` is null before the first keystroke. The first query loads the registry, the Screened out group lists a screened funder, and picking it opens the drawer. `_human` matches the registry on every row (0 mismatches).
- Browser flow: unlock, promote a screened funder (status `vetted`, lock `promoted`, on the radar), demote it (status `rejected`, off the radar, still listed under Screened out in search).
- Accessible names: every visible top-bar control has one at 1920, 1366, 1280 and 1100px (`aria-label` or `title`). The search field has `aria-label="Search funders"`.
- Not browser-tested: the failed-registry path. Mock mode cannot force `grants_registry` to fail. By code reading, the catch swallows the error (no toast), feed-only suggestions keep working, and the next Refresh allows a retry.
- Page overflow: none at 360, 640, 900, 901, 960, 1024, 1100, 1240, 1280, 1366, 1440, 1600 and 1920px.

## Left for other tracks
- `dash/database.js` and `dash/galaxy.js` are stubs. The Database track should call `app.loadRegistry()` before reading `app.reg()`, and list every evaluated funder, including screened ones.
- No module implements `onQuery` yet, so the Database and Galaxy tracks should add it or rely on the full render.
- Live RPCs are untested: `grants_registry`, `grants_funder`, `grants_set_*`, `grants_note`. Migration 023 is not applied. The mock is the only verification path.
