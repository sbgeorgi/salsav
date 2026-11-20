-- Collection-config changes from the 2026-11-20 crawler audit (9 funders). Applied 2026-11-20 via execute_sql; production probe 357/358.
-- A changed config clears the conditional-fetch state and collect_verified_at; verified is deliberately not set.
-- Rollback: audit-2026-11-20-rollback.sql. Superseded rows: audit-2026-11-20-archive.sql.

-- 9e33443a
select grants.set_collection('9e33443a-c2a8-4b13-9716-5e189525069a'::uuid, $j${
 "adapter": "json_api",
 "adapter_config": {
  "url": "https://www.birdf.com/wp-json/wp/v2/updates?per_page=50&_fields=id,date,link,title",
  "method": "GET",
  "items_path": "$",
  "map": {
   "external_id": "id",
   "title": "title.rendered",
   "url": "link",
   "description": "title.rendered",
   "open_date": "date"
  },
  "deadline_regex": "deadlines?\\s+([A-Z][a-z]+\\.?\\s+\\d{1,2},\\s+\\d{4})",
  "filter": {
   "any": [
    "re:(summar(y|ies)|full proposals?) deadline",
    "re:energy center.{0,40}call for proposals"
   ],
   "none": [
    "re:approves",
    "re:to invest",
    "re:set to receive"
   ],
   "fields": "title"
  },
  "also_page": true,
  "max_items": 20,
  "auto_vet": false
 },
 "feed_url": null,
 "note": "Reads BIRD's own announcements feed (WordPress REST) twice a day and keeps posts titled with an executive-summary or full-proposal deadline, so each new round is listed; today that is the General Program round, summaries due Nov 23, 2026. The PDF post for the same round is filtered out to avoid a duplicate. The Energy Center page is still watched for changes."
}$j$::jsonb);

-- 00c5697a
select grants.set_collection('00c5697a-eb43-4349-a81b-d0f8bb9ad2d2'::uuid, $j${
 "adapter": "grants_gov",
 "adapter_config": {
  "agencies": "DOI-BOR",
  "oppStatuses": "forecasted|posted",
  "rows": 25,
  "detail": true,
  "also_page": true,
  "filter": {
   "any": [
    "watersmart",
    "title xvi"
   ],
   "fields": "title+description",
   "none": [
    "desalination"
   ]
  },
  "max_items": 25,
  "auto_vet": true
 },
 "feed_url": null,
 "note": "Reads open Bureau of Reclamation WaterSMART and Title XVI funding opportunities from the Grants.gov API twice a day. Grants.gov shows the final closing date, so the Cooperative Watershed Management Program reads 2028-02-15 while the Reclamation page says Round 2 closes 2027-02-24; the old per-program cycle item (cycle:2027) duplicated it and is retired."
}$j$::jsonb);

-- 2aa89020
select grants.set_collection('2aa89020-1edc-4ddc-bec9-e9ef304305cb'::uuid, $j${
 "adapter": "html",
 "adapter_config": {
  "self": {
   "title": "Conservation, Food & Health Foundation concept application (LOI)",
   "deadline_regex": "Concept application deadline\\s*([A-Z][a-z]+ \\d{1,2})",
   "assume_next_year": true
  },
  "auto_vet": true
 },
 "feed_url": null,
 "note": "Reads the concept-application (LOI) deadline from the How to Apply page twice a day; the page gives it as 'December 22nd' and 'June 15th' with no year, so the collector reads the nearest upcoming one as its next occurrence (opt-in assume_next_year), one call per cycle."
}$j$::jsonb);

-- c7adf093
select grants.set_collection('c7adf093-ce2d-4e2c-a2bc-297dac569e8e'::uuid, $j${
 "adapter": "html",
 "adapter_config": {
  "list": {
   "item": "a.menu-link",
   "match": "^(?:small|medium)-size grants",
   "detail": {
    "max": 3,
    "deadline_regex": "Submission Window:\\s*\\d{1,2}(?: [A-Za-z]+)? to (\\d{1,2} [A-Za-z]+,? \\d{4})"
   },
   "amount": false
  },
  "auto_vet": true
 },
 "feed_url": null,
 "note": "Reads both Global EbA Fund call pages (medium-size and small-size grants) from the site menu and takes each page's own 'Submission Window ... to <date>' closing date twice a day; both 2026 windows have closed, and a new window on either page shows up as a new open call."
}$j$::jsonb);

-- 6cae3342
select grants.set_collection('6cae3342-97a8-4683-9f6f-ef2b2dfedd81'::uuid, $j${
 "adapter": "html",
 "adapter_config": {
  "self": {
   "title": "Regenerative Agriculture Targeted RFP (Greenacres Foundation)",
   "deadline_regex": "Application\\s+Deadline:\\s+([A-Z][a-z]+ \\d{1,2}, \\d{4})"
  },
  "list": {
   "url": "https://green-acres.org/research/research-grants/",
   "match": "research/(agriculture-research-grant|ecology-and-environment-research-grants)",
   "detail": {
    "max": 3,
    "deadline_regex": "Letter\\s+of\\s+Intent\\s+Deadline:\\s*([A-Z][a-z]+ \\d{1,2}, \\d{4})",
    "closed": "Deadline:\\s*anticipated"
   }
  },
  "auto_vet": true
 },
 "feed_url": null,
 "note": "Reads the dated Application Deadline of the invitation-only Regenerative Agriculture targeted RFP from its own page, and lists the two annual open research grants (Regenerative Agriculture, Ecology and Environment; letter of intent) from the research grants page; they show as closed until a dated Letter of Intent deadline is posted (now only 'anticipated February 2027'), then open by themselves."
}$j$::jsonb);

-- d91ff6b5
select grants.set_collection('d91ff6b5-9c51-4b6e-aeac-e794c4f8317a'::uuid, $j${
 "adapter": "html",
 "adapter_config": {
  "list": {
   "item": "a[href*='call-funding']",
   "match": "call for funding",
   "closed": "\\(closed\\)",
   "date_label": true,
   "detail": {
    "max": 5,
    "deadline_regex": "([A-Z][a-z]+ \\d{1,2}(?:st|nd|rd|th),? \\d{4})[^\\n]*\\s+Deadline for full-proposal"
   }
  },
  "auto_vet": true
 },
 "feed_url": null,
 "note": "Reads the site's menu of LEAP-SE funding calls (one page per call year) and each call page's full-proposal deadline, so a new call year shows up as soon as its page is added; the 2026 call closed 24 Jun 2026, so nothing is open today."
}$j$::jsonb);

-- b818abe6
select grants.set_collection('b818abe6-897e-4c5c-b902-382c32a77c3a'::uuid, $j${
 "adapter": "grants_gov",
 "adapter_config": {
  "keyword": "Small Business Innovation Research",
  "agencies": "NSF",
  "rows": 25,
  "oppStatuses": "forecasted|posted",
  "also_page": true,
  "detail": true,
  "auto_vet": true,
  "filter": {
   "any": [
    "Small Business Innovation Research",
    "SBIR",
    "STTR"
   ]
  }
 },
 "feed_url": null,
 "note": "Collected from the official Grants.gov API (agency NSF, SBIR/STTR calls): both live solicitations, NSF 26-510 and NSF 26-511, are listed with their 4 March 2027 deadline, and any future NSF SBIR/STTR solicitation posted to Grants.gov is picked up automatically."
}$j$::jsonb);

-- 773f2175
select grants.set_collection('773f2175-0bb0-45f9-97e8-8f4a5e53957e'::uuid, $j${
 "adapter": "grants_gov",
 "adapter_config": {
  "keyword": "solar agriculture",
  "rows": 100,
  "oppStatuses": "forecasted|posted",
  "auto_vet": false,
  "max_items": 40,
  "filter": {
   "any": [
    "agrivolt",
    "agri",
    "solar",
    "photovolt",
    "farm",
    "rural",
    "crop",
    "irrigat",
    "ranch",
    "dual-use",
    "water",
    "soil"
   ],
   "none": [
    "re:^ROSES",
    "Solar System",
    "Heliophysics",
    "Astrophysics",
    "Cryosphere"
   ],
   "fields": "title"
  }
 },
 "feed_url": null,
 "note": "Searches the official Grants.gov API twice a day for open or forecasted federal notices matching solar plus agriculture, kept only when the title shows farm, crop, water, soil, rural or solar wording; new ones wait for review before showing, because many also appear under the individual agency funders."
}$j$::jsonb);

-- 6df99f2d
select grants.set_collection('6df99f2d-1d7e-4359-98d7-d29ec2920575'::uuid, $j${
 "adapter_config": {
  "rows": 100,
  "filter": {
   "any": [
    "Regional Integrated Science",
    "Climate Adaptation Partnerships"
   ],
   "fields": "title"
  },
  "keyword": "Climate Adaptation Partnerships Regional Integrated Sciences and Assessments",
  "auto_vet": false,
  "max_items": 20,
  "oppStatuses": "forecasted|posted"
 }
}$j$::jsonb);

