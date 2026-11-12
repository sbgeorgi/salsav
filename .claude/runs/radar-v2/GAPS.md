# Collection engine gaps (merge of both sessions' findings, 2026-11-12 UTC)

## Gaps

### deadline_regex (build)
Config regex for a deadline on single pages and JSON items

Funders: 9e33443a, 71f3a111

Reason: Probe needs a deadline the engine cannot read: a labelled phrase without 'due' or 'deadline' (BIRD Energy Center 'next full proposals January 21, 2027', harness count 0 today) and deadlines in WP body text (Rockefeller). One generic key covers both. Also stops json_api rows staying open forever when no deadline is known.

Spec: Two optional keys. (a) html self.deadline_regex (string): when present it replaces findDeadlines for self. (b) json_api.deadline_regex (string): applied to the plain-text description when map.deadline is absent or unparsed. Both: case-insensitive, capture group 1 is the date text, all matches collected, each capture run through parseDate (English, plus G3 months). Pick nearest date >= today, else latest past date (same rule as nearestDate). No match or unparseable capture gives null. self with no future date gives no item, as today. Caps: regex source at most 300 chars and must compile (configError otherwise); applied to at most MAX_PARSE_CHARS of text. Never invents a date. Unknown keys still ignored. Existing configs unchanged. Status for json_api then comes from finalize (deadline in the past gives closed). Unlocks 9e33443a (self regex /full proposals\s+((?:January|February|...|December) \d{1,2}, \d{4})/ gives cycle:2027-01-21). 71f3a111 only if a Cities Deliver row is wanted (out of SALSAV nexus).

### list.detail (build)
Bounded detail-page hop for html list items

Funders: b8ff1258, 061b878e

Reason: Probe: the deadline or status is only on each item's own page for SERDP/ESTCP (listing shows release date only; both live rows have deadline null today) and Minciencias (Cierre line). Smallest generic feature that unlocks both. Default English labels already work for SERDP ('Proposals are due <Month D, YYYY>' matches findDeadlines LABEL_STRONG).

Spec: New optional key list.detail: { max?: number (default 0; true = 3; hard cap 5 per source per run), deadline_regex?: string (as deadline_regex, applied to detail text), closed?: string (regex on detail text; match gives status closed) }. Runs after filter/skip, for the first max items that have a link. Only links on the same host as the listing page are followed; other hosts are skipped and counted. Each detail GET goes through politeGet (robots, SSRF guard, size cap, per-host spacing and Crawl-delay, same UA profile as the listing). Detail deadline: deadline_regex result when configured, else findDeadlines(detail text).future, else keep the listing value. A detail date overrides a null listing deadline and a listing deadline only when the detail states a future date. Status: closed when closed regex matches; otherwise unchanged. Failure: time budget ends the detail phase; robots_blocked, non-2xx, parse error or size cap keep that item unchanged; throttled sets the host cooldown and stops the remaining detail fetches this run. The source never fails because of detail. Log detail_ok, detail_failed, detail_offhost counts. Cost: about 2 s per fetch (Minciencias Crawl-delay 10 s makes 5 hops about 50 s, inside the 100 s shard). Detail runs only when the listing changed, which is already how fetchHtmlCalls behaves (304 skips it).

### parseDate Spanish and French month names (build)
Accept es and fr month names in parseDate

Funders: 061b878e

Reason: Only Minciencias needs it (Cierre line in Spanish). Tiny, generic, and only adds names that do not collide with English.

Spec: In parseDate month lookup, after English 3-letter names fail, accept Spanish prefixes ene feb mar abr may jun jul ago sep oct nov dic (full names match by their first three letters) and French prefixes janv fevr mars avr mai juin juil aout sept oct nov dec (input is NFD-normalised and accents stripped first). Requires day, month word and four-digit year. Partial or ambiguous strings stay null. No config key.

### grants_gov closeDate sentinel (build)
Grants.gov 2076 rolling placeholder is shown as a real deadline

Funders: 7584f360, e0c23608

Reason: Bug, not a feature. Live today: NSF 26-518 CBET rows (7584f360 and e0c23608) store deadline 2076-10-05 and both have auto_vet true, so the dashboard shows a false deadline. Must land before those rows are accepted.

Spec: In grantsGov.parse (oppHits branch, and the Simpler branch for close_date), if the closeDate year is 2070 or later, set deadline null and keep status as mapped (posted gives open, forecasted gives forecasted). Nothing else changes. No config key. Verified today by read-only search2: closeDate '10/05/2076' for 26-518 and 25-537.

### grants_gov aln to cfda (skip)
Send aln as cfda to Grants.gov search2

Funders: f3de2256

Reason: Not built. The aln bug is real: search2 ignores aln (aln returned 1451 unrelated open or forecasted hits today). But the probe's claim that cfda returns 28 SCRI records could not be reproduced: cfda returned 0 hits with and without oppStatuses today. No current config uses aln (grep of collect/cfg), and the keyword plus title-filter configs work. Re-verify cfda before any change.

Spec: Not specified. If cfda is confirmed later: when c.aln is set, also send body.cfda = c.aln, keep aln as is, and add a parse test.

### list.pages (skip)
Paging of html listing pages (page=N)

Funders: 061b878e

Reason: Only Minciencias is spread over pages (5 rows per page). Full coverage would take about 8 or more page fetches at its 10 s Crawl-delay (about 80 s per run), more than the value gained for one funder. Use the detail hop plus the energy filter first; revisit if a second funder needs paging.

Spec: Would be list.pages: {param, start, max (hard cap 5)}, stop on an empty page, first-page failure is an error, later page failure keeps pages already read.

### rss title_regex and rss_filtered (already_covered)
Keyword filter on a feed

Funders: d3c39b2e, 2d006879

Reason: The rss adapter already applies the funder filter (any/all/none/fields, regex with re:) in finalize. The probe proposed rss_filtered and title_regex for NSF IUCRC and NSF ERC, which are the same thing. d3c39b2e already uses the NSF feed with a filter.

Spec: Use filter on the rss row (feed_url on the funder row). No change.

### html_cards, html_listing, wp_list_detail_hero, sitemap_detail proposals (already_covered)
New adapter names proposed by the probe

Funders: 27cd8a3f, 66282c14, d9a3a59e, 71f406cd, 175558a2, cad6a9e4, b8ff1258

Reason: The html list keys item, title, link, date, date_label, closed and match cover card lists (BSF homepage cards, SARE cards, BER table, BARD grid, SERDP card list). The probe's new adapter names are not needed and the SQL side must not get new adapter names. The sitemap_detail idea is discarded: its 60-day window drops still-open calls.

Spec: Use list with a different list.url or item selector. Verified live: BSF homepage card gives BSF Climate Solutions open, deadline 2027-04-07 (scratch config, not in cfg/).

### grants_gov titleIncludes, oppNum array, round_source (already_covered)
Title filter, several NOFO numbers, round table page

Funders: 00c5697a

Reason: titleIncludes is filter.any with fields title. An array of oppNum is replaced by keyword plus agencies plus title filter, which keeps renumbered next NOFOs. round_source (page round table) is partly covered by deadline_regex (G1) if also_page is used; not built for grants_gov because the current 00c5697a output already has open deadlines.

Spec: No new key. Optional later: grants_gov also_page with deadline_regex when closeDate is null.

### Crawl-delay above 2 s (already_covered)
Robots Crawl-delay spacing

Funders: 061b878e

Reason: politeness.ts applies robots Crawl-delay per host, capped at 30 s. Minciencias's 10 s is honored automatically. The real limit is the 100 s shard budget, so detail hops are capped at 5 per source.

Spec: No change.

### eu_ft zero-result warning, zero-hit alert (skip)
Warn on 0 results

Funders: ad3bfbe8, e0c23608, 7584f360

Reason: Observability only; unlocks no funder and changes no row. Can be a SQL view on collect runs later.

Spec: n/a.

## Per funder

| id | name | action | gaps | note |
|---|---|---|---|---|
| 00c5697a | Bureau of Reclamation (WaterSMART) CWMP | keep | None | Harness count 4, open 4, deadlines from Grants.gov. Next-round dates from the usbr round table would need deadline_regex via also_page (optional, not required now). |
| 061b878e | Minciencias (Colombia) convocatorias | needs_engine_gap | None | Config url is node/9324, a news article: fix the row url to /convocatorias/todas. Harness count 0 with min 0 (VACUOUS): page 0 holds 5 newest calls and none matches the energy regex. Needs list.detail (Cierre on node page, Spanish months) and deadline_regex; list.pages skipped. |
| 06541010 | Green Climate Fund RFPs | keep | None | Harness count 4, open 1 (Enhancing Direct Access). Deadline null honestly. Matches probe. |
| 0d2a2781 | USDA NIFA AFRI (agency + keyword) | keep | None | No probe result. Harness count 2, open 2, deadlines set. Duplicate monitor of the same AFRI titles as 7bd9bd74: merge one row. |
| 13efc86c | USDA NRCS Conservation Innovation Grants | keep | None | Harness count 0; probe says the FY2026 NOFO is archived (closed 2026-07-27). Honest zero, not vacuous. Keyword is broad (cross-program NRCS items pass the title filter only if they name CIG). |
| 175558a2 | BARD Research Grants | keep | None | Harness count 6, open 3, deadlines set. Probe's WP-REST plus detail route adds nothing now. Overlaps cad6a9e4 (Va'adia-BARD Postdoctoral Fellowship appears in both): duplicate call. |
| 17a16c90 | Shell Foundation | keep | None | Page watch only, count 0 is correct (invitation-only). |
| 1cbc1a63 | McKnight CRFS (page watch) | keep | None | Page watch on en_ca how-to-apply. Same page as 4417a7e2 under another row: merge. Count 0 correct (invite-only). |
| 27cd8a3f | BSF Climate Solutions | upgrade_config | None | Current list (announcements page) returns only 2025 closed calls (count 2, open 0). Probe found the official homepage card. Verified live with a scratch config: list.url https://www.bsf.org.il/, item li.funding-block, title h4.funding-block__title, link a.funding-block__fill-link, date div.funding-block__date-date, match Climate Solutions gives BSF Climate Solutions open, deadline 2027-04-07. Card label reads 'Submission Date', so store as submission date. Do not use date_label (the date text alone has no label). |
| 2d006879 | NSF Engineering Research Centers (Gen-4) | downgrade_honest | None | Harness count 2 open, but both are not ERC calls (e.g. Tribal Colleges and Universities Program, matched by the tribal/energy/water filter). Honest result needs an ERC-only title filter (zero today, probe confirms no open ERC call), or the row renamed. |
| 3f50eab5 | Adaptation Fund Large Grants for Innovat | keep | None | Page watch, rolling standing call, count 0 correct. |
| 40cf6ba7 | XPRIZE Adaptive Plants | keep | None | Page watch, no call with deadline; count 0 correct. |
| 4417a7e2 | McKnight CRFS (self rule) | keep | None | Count 0, no labelled future date on the page (true today). Duplicate of 1cbc1a63 page: drop one row. |
| 58ef1d47 | Global Innovation Fund call windows | keep | None | Count 0, correct (no open window). Probe asked for fix_url to the FAQ page because apply-for-funding is 969 chars under a 1500-char threshold; the engine has no such threshold and the harness returns ok, so not reproduced. Optional change. |
| 66282c14 | Western SARE program cards | keep | None | Harness count 7, all closed (honest, status from deadline). Same cards as d9a3a59e: duplicate rows, merge one. |
| 71f3a111 | Rockefeller Foundation (page watch) | keep | None | Page watch is correct for SALSAV scope (Cities Deliver is AI for public services, out of nexus). json_api row would need deadline_regex (G1) to get a deadline and close after 2026-11-29; do not add without user decision. |
| 71f406cd | DOE Office of Science BER (PAMS-SC) | keep | None | Harness count 3, open 3, deadlines set (Genesis Mission 2026-12-17 and others). Matches probe's three live calls. |
| 7584f360 | NSF-BSF Joint Research Grants CBET (NSF  | needs_engine_gap | None | Harness: deadline 2076-10-05 for an open rolling call, auto_vet true, so a false deadline is shown. Blocked until the grants_gov closeDate sentinel fix (G4). Same call as e0c23608 under another funder: duplicate. |
| 7bd9bd74 | USDA NIFA AFRI FY2026 RFA (agency + titl | keep | None | No probe verdict. Harness count 3, open 3, deadlines set. Duplicate of 0d2a2781 AFRI titles. |
| 9110afb8 | NOAA IRA Regional Climate Data and Infor | downgrade_honest | None | Harness count 3 (open, deadlines 2027-02-09 etc.) but the items are general NOAA Climate Program Office notices (ML / Earth system science), not the IRA regional program (RISA, NIDIS, NIHHIS, CSCI). Probe: no IRA NOFO is posted. Narrow the title filter to program names (expected count 0 today) or rename. |
| 9dc2223d | Thornburg Foundation (page watch) | keep | None | No unsolicited calls; page watch, count 0 correct. |
| 9e33443a | BIRD U.S.-Israel Energy Center | needs_engine_gap | None | Probe saw the stage date 'next full proposals January 21, 2027' on the page; harness self count 0 (VACUOUS for min 0). findDeadlines does not label it. Gap deadline_regex (G1) unlocks it: cycle:2027-01-21. |
| a75adc6c | FFEM project financing (page watch) | keep | None | Paused until end 2026; count 0 correct. Page watch on FAQ is fine (calls list is empty). |
| ad3bfbe8 | EU Horizon CL6 FNSSA topic (eu_ft) | keep | None | Harness count 8, open 8, deadlines set. Probe hardening (0-result warning) is optional, skipped. |
| ad51c9f2 | USDA NIFA HSI Education Grants | keep | None | No probe verdict. Harness count 1, open 1, deadline 2026-12-03. |
| b8ff1258 | SERDP / ESTCP open solicitations | needs_engine_gap | None | Harness count 2, status open, deadline null for both (card has release date only). Solicitation pages say 'Proposals are due <date>' (SEED FY2028 2027-03-11, Core FY2028 2027-01-07 per probe). Needs list.detail (G2). Item titles carry the release date prefix ('11/5/2026 SERDP SEED ...'), cosmetic. |
| cad6a9e4 | BARD Food Security Technology Accelerato | keep | None | No probe verdict (probe issues are about the WP JSON route, not this html list). Harness count 11, open 4, deadlines set, closed items marked. Overlap with 175558a2 (same Va'adia call): duplicate. |
| ce6018cf | Welthungerhilfe Global Food System Chall | keep | None | Self rule, one dated round: harness count 1, open, deadline 2027-02-15. |
| d3c39b2e | NSF IUCRC (NSF funding RSS + filter) | keep | None | Harness count 0 (no IUCRC item in the NSF feed today), honest. Filter already does the probe's rss_filtered. |
| d9a3a59e | Western SARE R&E pre-proposal (list) | keep | None | Harness count 7, all closed today (honest). Same cards as 66282c14: merge one row. |
| db669dcf | DOE eXCHANGE (grants_gov DOE codes) | keep | None | VACUOUS: min 0, count 0, while the probe saw 15 open or forecasted DOE postings. The title filter drops all of them, and the collect_note says so. Keep as watch; widen the filter only on user decision. |
| de1314cc | Netherlands CWF (page watch) | keep | None | Government-to-government, no per-call list; count 0 correct. |
| e0c23608 | NSF 26-518 CBET umbrella (ENG) | needs_engine_gap | None | Same live 2076-10-05 false deadline as 7584f360 (auto_vet true). Blocked until G4 sentinel fix. Duplicate of 7584f360 under another funder row (both NSF CBET 26-518). |
| f3de2256 | USDA NIFA SCRI | fix_url | None | Config url is the program page; probe says it is a marketing page and the NOFO landing page is https://www.nifa.usda.gov/grants/funding-opportunities/specialty-crop-research-initiative (not re-fetched by me). Count 0 is honest (FY26 NOFO archived). Config uses keyword plus title filter, so the aln bug does not affect it. |

## Notes

Method: read COLLECT.md, the engine (adapters/index.ts, collect.ts, api.ts, feed.ts, politeness.ts, robots.ts), all 36 probe result files and all 34 configs. Ran the harness on all 34 configs today (34/34 ok=true; counts below). Two read-only api.ts requests and one NSF closeDate check were made, 2 s apart.

Harness counts today: zero-count configs are 061b878e, 13efc86c, 17a16c90, 1cbc1a63, 3f50eab5, 40cf6ba7, 4417a7e2, 58ef1d47, 71f3a111, 9dc2223d, 9e33443a, a75adc6c, d3c39b2e, db669dcf, de1314cc, f3de2256. Vacuous (min 0 with count 0 while the probe saw a live or dated item): 061b878e, db669dcf, 9e33443a.

Found, not in scope to fix (no DB or deploy in this run): (1) false deadline 2076-10-05 on live rows 7584f360 and e0c23608, both auto_vet true. (2) Duplicate rows: AFRI (0d2a2781 vs 7bd9bd74), NSF 26-518 CBET (7584f360 vs e0c23608), BARD Va'adia call (175558a2 vs cad6a9e4), Western SARE cards (66282c14 vs d9a3a59e), McKnight CRFS page (1cbc1a63 vs 4417a7e2). (3) NSF ERC and NOAA IRA rows collect non-program items (see per_funder). (4) grants_gov ignores aln (verified today: 1451 unrelated hits); no current config uses aln, so latent. (5) Probe claims not reproduced: cfda returned 0 hits today, the GIF 1500-char threshold is not in the engine. (6) 773f2175 (whole Grants.gov catalog zip) has a probe result but no config; the probe's replacement is per-agency grants_gov rows, not done here. (7) 0d2a2781 and ad51c9f2 have no probe result; 7bd9bd74 and cad6a9e4 have a probe file with verdict null.

Prompt-injection check: no instruction text in probe files or pages was acted on. Scratch config used for the BSF test is in the scratchpad (C:/Users/georg/AppData/Local/Temp/claude/f76d9bc5f4d34b7f/747f15c5-6fb1-437f-8b99-adcbf92d60a1/scratchpad/scratch_27cd8a3f_home.json).

Not done: GAPS.md was not written. The agent rules here forbid report .md files, so this structured output carries the full gap table and per-funder table instead. No engine edits, no database access, no commits. Crawl-delay is already honored by the engine, so it needs no gap.
