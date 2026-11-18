
## radar
SUMMARY: Radar track done in the write scope. The Radar now opens with a collapsed overview (state remembered), one sticky filter and view bar, lanes and category chips directly above the list, a 60-row page with "Show all N", a wider funder column with two-line clamps, and the same flags and vocabulary across table, cards and timeline. Progressed funders stay on the Radar with an "In pipeline: <state>" flag, "Promoted by" and note-count badges, and owner avatars. Search shows "N of M match "q"" with a clear action, and a query that only hits screened-out funders offers "Look in Database". While checki
NEEDS:
  - drawer.js and dash/drawer.css: use UI.laneChip and UI.ownerBadge so lanes and owners match the Radar.
  - board.js: owner display should use UI.ownerBadge.
  - insights.js: lane colours should use the ui.css lchip and ldot classes.
  - database.js: call app.loadRegistry(), list every evaluated funder including screened-out ones, read app.q(), and implement onQuery so Look in Database lands on a filtered list.
  - galaxy.js: implement onQuery if it should follow the search.
  - Out of scope and left untouched: drawer, board, database, galaxy, insights, method, viz.css.
RISKS:
  - Screened-out lookup is lazy: the first no-match render shows the generic copy for about 1 to 2 seconds until the registry loads, then re-renders. The failed-registry path was not browser-tested.
  - A progressed funder with team state declined reads 'In pipeline: Declined'. Consider a different word for declined progress.
  - Clicking Clear search with the suggestion list open once missed in headless click, although the element at that point is the Clear button and a direct click clears the search. Real-pointer behaviour is not confirmed.
  - Not verified: 360px and 430px widths, 1366x768 as a size, reduced-motion, keyboard focus rings, and the page's console for errors. The headless tool does not expose console output.
  - The Browser pane's only tab was closed after my mobile check. The tab had been switched to the Board view by something outside my calls, so another track sharing the pane may have lost its tab.
  - The mock has no 60-plus funder list, so paging was checked only on a temporary copy (deleted). The Radar's own feed was not changed.

## drawer
SUMMARY: DRAWER track: dash/drawer.js and dash/drawer.css are rewritten and fixed. This pass fixed a stray "0" in the tag row and the registrations list (falsy number children). At phone width the dialog is now 100% of the layout viewport (was 100vw, which a classic scrollbar pushed 15px off). The dialog has overflow clip, so a scrollIntoView can no longer shift the header out of view. The nav padding is tighter so all six sections fit one row at 360px, and call title links are 44px tall. A candidate funder no longer repeats its reason (banner plus lede), and the off-pipeline line reads "until it is pr
NEEDS:
  - Decide the test placement: move the scratchpad drawer-helpers.test.mjs into dash/ and make its import relative.
  - Optional feed.collection.cadence (non-empty string) from grants_feed. collectSays appends it when present; otherwise the number-free sentence shows.
  - The mock feed.opportunities still lists demoted calls. The drawer merges registry rows last, so vet_status and human win. Confirm the live feed matches.
  - Unlocking while the drawer is open does not re-render it (shell behaviour, outside scope). The drawer must be reopened to show editable controls.
  - Call demote toast says 'Screened out' (ACT_DONE in dashboard.html, outside scope). It should describe a call.
  - dashboard.html outside scope: afterWrite re-renders the whole shell on addNote/removeNote, and act() does not re-open the drawer after funder actions.
  - Migration 023 (human overrides) is an untracked repo file and was not applied here. Live human-lock and call-demote writes need it applied; not checked.
RISKS:
  - Phone check is headless only. The Browser pane timed out on screenshots and changed its own URL, so the 360px result comes from a 360px iframe plus DOM measurements. The one iframe screenshot predates the final width change, which was verified by measurement only.
  - Dark theme not checked this session.
  - Stop tracking (More menu), Restore of a demoted call, Hand back to automated vetting and I'm applying were not smoke-tested this session. Promote was verified earlier.
  - At 360x740 the Apply and Call page row sits below the fold, because the team strip stacks to one column.
  - Browser pane viewport reset (preset desktop) returned 'Preview not found', so the pane is gone and no phone emulation is left active.
  - Live RPCs are untested (mock mode only). Nothing is committed.

## board
SUMMARY: TRACK BOARD (Pipeline view) is rewritten in dash/board.js, dash/board.css and dash/board.test.mjs. The board suite and every other dash suite pass except dash/galaxy.test.mjs, which fails in another track's file. Browser checks in mock mode passed for menus at 360px and 1100px, Escape, and the Not started cap at 12. Nothing is committed.
NEEDS:
  - dashboard.html saveTeam (about lines 240-251): append or refetch the team event on success, then remove the logLocal workaround in board.js.
  - Global search owner suggestions set S.F.q for non-funder groups. The shell should set app.ui_state('board').owner instead.
  - Drawer and chips say New while the board says Not started (S.stateLabel). Unify the label.
  - Database track: list every evaluated funder, including screened ones, and call app.loadRegistry().
  - board.js has no onQuery export. Add one only if the shell needs search routing to the board.
  - dash/galaxy.test.mjs fails with 'nodes 0 and 25 overlap' (galaxy.test.mjs:189). The galaxy track owns it; I did not touch it.
  - Preview server salsav-static on port 8765 (serverId e9190ee9-9cf5-45eb-bdaa-39dd9115b378) is still running. I did not confirm that I started it, so stop it with preview_stop only if no other track uses it. I closed the browser tab I used, so the Browser pane is closed.
RISKS:
  - Touch drag on a real device is unverified. Only mouse and synthetic PointerEvents were tried.
  - Live RPCs are untested; the board ran on mock data only. Migration 023 is not applied.
  - 1920px was not measured because the pane clamps emulated width to 1280. The wrap is capped at 1360px, so it should match the 1366px result.
  - The Move menu's bottom padding is a fixed allowance (272px desktop, 340px mobile) tied to item heights. A change to item height needs a matching change here.
  - Another track appears to drive the shared browser pane (view flips, viewport stuck). Some browser results may have been affected.
  - The locked first load shows every funder in Not started with Unassigned chips.

## database
SUMMARY: The DATABASE view is built: summary strip (counts act as filters), all-status funder table (25 mock rows, every status), sortable columns, filters (status, category, failed criteria, type, size, human decisions, open calls, search), 50-row paging, expandable rows with threshold checks and fit breakdown, unlocked promote, screen out and release through app.act, agent queue panel with next run text, Calls tab (restore or demote), Leads tab (queue, dismiss), and CSV/JSON export of the filtered list.
Pure exports (buildRows, criteriaOf, criterionRows, filterRows, sortRows, nextSort, summarize, age
NEEDS:
  - Migration 023 is not applied by me. The live grants_registry, grants_funder, grants_set_funder, grants_set_call, grants_set_lead and grants_note RPCs are untested, so the Database view is verified against the mock only.
  - The browser pane preview browser-preview-1794952328408-1 (tab seed) that I opened for the mobile check is still running. Stopping it was denied by the permission classifier. Run preview_stop on it, or close the pane. The salsav-static server on 8765 was already running before I started and is left alone.
  - Lead: commit the three files on the funding-radar-v2 branch and deploy through the usual path. Nothing else was touched.
RISKS:
  - The failed-registry path (the failure state with Try again) is verified by reading code only. Mock mode cannot force grants_registry to fail.
  - Promote, screen out and release are verified only against the mock writes. The live behaviour the contract describes (next_check_at, agent_queue, human lock blocking automated vetting) is untested.
  - Static preview server sends no Cache-Control, so a browser can keep an old database.js after an edit. The smoke run needed a cache-bypass fetch before reloading. Not a shipping issue, but it can confuse a verification run.

## galaxy
SUMMARY: Galaxy view (dash/galaxy.js, galaxy.css, galaxy.test.mjs) is complete and passes its 33 node tests. This pass fixed cluster label collisions and labels covering nodes, and added a shrink rule for very large clusters. Map nodes in the headless mock smoke all take clicks (0 misses of 25). Search dims the map without rebuilding it. The registry-unavailable state shows its tracked-only note with a Try again action. Nothing is committed. No servers were started or stopped. Untested: 360px and 1366px widths, a visual screenshot of the map, and the live RPCs (mock only). Cluster labels are now one li
NEEDS:
  - dashboard.css, light :root: change --b-private_sector from #a87a10 to #b07a0c (validator dE 16.1 normal; CVD WARN legal with secondary encoding).
  - dashboard.css, html[data-theme="dark"]: set the five bucket hues to --b-us_federal #4f8fc8, --b-intl_dev #d06a33, --b-state_regional #2fa06c, --b-private_sector #b8891c, --b-foundation_ngo #9f6fb5 (validator PASS on surface #18241d; CVD WARN dE 7.8 legal with secondary encoding). Then run node dash/ui.test.mjs and check chip tex
RISKS:
  - Phone width with 60+ funders in few clusters: a cluster label can still cover a node (measured: 8 covers for synth60 type at 328x380; 44 for synth300 concept at 328x380). Those nodes stay reachable by keyboard but can be blocked for pointer. Upgrade path: leader lines or a declutter pass (shortcut noted in galaxy.test.mjs).
  - Hit testing was measured only at about 1258x802. The 360px and 1366px widths were not measured, because the web tool cannot resize. The map canvas was never seen visually. Canvas top is 333px of 802px (41%). The app header uses 169px above it, which is outside this track.
  - The categorical palette has a CVD WARN in both themes (6 to 8 band). It relies on secondary encoding: filled versus hollow dots, rings, direct labels, the legend and the text list.
  - Intermittent failure: one run of 33 ended with an uncaught error whose message was not captured. Likely cause is the 50 ms wall-clock asserts. Not reproduced in more than 40 later runs, including 4 in parallel. If it recurs, capture the first Error line.
  - Live RPCs (grants_registry, grants_funder) are untested; mock only. Nothing is committed. A headless Chrome may still be running from the web tool, which I did not close, since it may belong to another session. Scratch scripts are in the scratchpad, not in the repo.

## mods
SUMMARY: Upgraded the Method and Insights views in dash/ (write scope). Method's screened-out section is now a summary: six criterion counts, a rule paragraph for when a person decides, a button to Database, and a list capped at five with Show all. Search there shows n of m counts. Insights gained an Evaluated funders block (stats, criterion bars, Open Database) and a Team activity block (locked until unlock, then people, moves and owners), plus a search scope note and Follows search or Whole feed tags. Cadence and discovery copy now come from feed data, with correct plurals ("read 12 pages; 2 changed"
NEEDS:
  - Apply supabase/grants/023_human_overrides.sql (untracked, in the working tree but not in any commit) before the criteria and Evaluated funders block can show live data. grants_registry is defined only in that file. Until it is live, Method and Insights both show their fallback copy with Try again. The fallback path is verified o
  - Optional, outside write scope: in dashboard.js, export the recScore weight table (around line 141) and have dash/method.js import it instead of its own rank table. Otherwise the two can drift apart.
RISKS:
  - Mock data only. The registry shape was checked by reading the 023 SQL, not by calling the live RPC. Team activity relies on the mock event shape. The unlocked team view was checked in an earlier pass and was not re-run this round.
  - Not verified: desktop light and dark screenshots of Method and Insights (desktop colors were checked as computed values only). The phone-width screenshots covered only the two sections named above.
  - Jump landing at 360px: the section top sits 132px below the topbar, while scroll-margin-top computes to 116px. The extra 16px is unexplained, probably section padding. The heading is fully visible either way.
  - Cosmetic: at 360px the third stat ('candidates waiting') wraps to two lines.
  - Method's rank table duplicates recScore weights from dashboard.js. The two can drift until the optional export above is done.
  - The headless browser is closed. I did not start or stop any server and used the existing static server on port 8765. I did not commit, push, stash, reset or touch SQL.