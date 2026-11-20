-- Rollback for audit-2026-11-20-apply.sql: exact adapter, adapter_config, feed_url and note read from the database 2026-11-20.
-- verified:true re-stamps collect_verified_at to now for funders that were verified before.

-- 9e33443a
select grants.set_collection('9e33443a-c2a8-4b13-9716-5e189525069a'::uuid, $j${
 "adapter": "html",
 "adapter_config": {
  "self": {
   "title": "BIRD U.S.-Israel Energy Center Call for Proposals",
   "deadline_regex": "(?:Executive Summaries\\s+\\(using BIRD.s template\\)|Full Proposals\\s+\\(following BIRD.s detailed instructions\\))\\s+([A-Z][a-z]+\\.?\\s+\\d{1,2},\\s+\\d{4})\\s+Read More"
  }
 },
 "feed_url": null,
 "note": "2026-11-12 probe triage: regex tolerates long whitespace runs (replay 2026-06-01 -> 2026-06-30); 2026 dates past.",
 "verified": true
}$j$::jsonb);

-- 00c5697a
select grants.set_collection('00c5697a-eb43-4349-a81b-d0f8bb9ad2d2'::uuid, $j${
 "adapter": "html",
 "adapter_config": {
  "self": {
   "title": "WaterSMART Cooperative Watershed Management Program",
   "deadline_regex": "Round \\d: ([A-Z][a-z]+ \\d{1,2}, \\d{4})"
  },
  "auto_vet": true
 },
 "feed_url": null,
 "note": "Reads the next application deadline for the Bureau of Reclamation Cooperative Watershed Management Program from its own page twice a day. Right now that is Round 2, closing Feb 24, 2027. Only this one program is tracked; once the last listed round passes, nothing is shown until new dates are posted.",
 "verified": true
}$j$::jsonb);

-- 2aa89020
select grants.set_collection('2aa89020-1edc-4ddc-bec9-e9ef304305cb'::uuid, $j${
 "adapter": "html",
 "adapter_config": {},
 "feed_url": null,
 "note": "No call rows can be made: the two concept cycles (online application October 15 to December 22, and May 1 to June 15, each with its proposal and award dates) are published on the How to Apply page without a year, and the collector never invents a year, so no deadline can be dated from plain HTTP.",
 "verified": true
}$j$::jsonb);

-- c7adf093
select grants.set_collection('c7adf093-ce2d-4e2c-a2bc-297dac569e8e'::uuid, $j${
 "adapter": "html",
 "adapter_config": {
  "self": {
   "title": "Global EbA Fund Medium-Size Grants Call for Proposals",
   "deadline_regex": "Submission Window: \\d{1,2} [A-Za-z]+ to (\\d{1,2} [A-Za-z]+,? \\d{4})"
  },
  "auto_vet": true
 },
 "feed_url": null,
 "note": "Reads the closing date of the Global EbA Fund medium-size grants submission window from its own call page twice a day; today that is 16 November 2026. The page is reused for each new call, so a new window appears as a new dated call.",
 "verified": true
}$j$::jsonb);

-- 6cae3342
select grants.set_collection('6cae3342-97a8-4683-9f6f-ef2b2dfedd81'::uuid, $j${
 "adapter": "html",
 "adapter_config": {
  "self": {
   "title": "Regenerative Agriculture Targeted RFP (Greenacres Foundation)",
   "deadline_regex": "Application\\s+Deadline:\\s+([A-Z][a-z]+ \\d{1,2}, \\d{4})"
  },
  "auto_vet": true
 },
 "feed_url": null,
 "note": "Reads the dated 2027 Application Deadline of the Greenacres Foundation Regenerative Agriculture targeted RFP from its own page twice a day (plain HTML, no JavaScript).",
 "verified": true
}$j$::jsonb);

-- d91ff6b5
select grants.set_collection('d91ff6b5-9c51-4b6e-aeac-e794c4f8317a'::uuid, $j${
 "adapter": "html",
 "adapter_config": {
  "self": {
   "title": "LEAP-SE joint call for AU-EU sustainable energy research projects",
   "deadline_regex": "([A-Z][a-z]+ \\d{1,2}(?:st|nd|rd|th),? \\d{4})[^\\n]*\\s+Deadline for full-proposal"
  },
  "auto_vet": true
 },
 "feed_url": null,
 "note": "Reads the full-proposal deadline of the current LEAP-SE joint call from the funder's call page on its new domain leap-energy.eu. The 2026 call closed 24 Jun 2026, so nothing is shown until the next call is published at the same address.",
 "verified": true
}$j$::jsonb);

-- b818abe6
select grants.set_collection('b818abe6-897e-4c5c-b902-382c32a77c3a'::uuid, $j${
 "adapter": "html",
 "adapter_config": {
  "self": {
   "title": "NSF SBIR/STTR Phase I, Phase II and Fast-Track (NSF 26-510)",
   "deadline_regex": "(July 27, 2026|November 0?4, 2026|March 0?4, 2027|July 0?7, 2027)"
  },
  "auto_vet": true
 },
 "feed_url": null,
 "note": "Reads the full-proposal deadlines of the current NSF SBIR/STTR solicitation (NSF 26-510) from the NSF solicitation page twice a day and shows the nearest one still ahead; right now that is Mar 4, 2027. A replacement solicitation with a new number would not be seen until this page changes.",
 "verified": true
}$j$::jsonb);

-- 773f2175
select grants.set_collection('773f2175-0bb0-45f9-97e8-8f4a5e53957e'::uuid, $j${
 "adapter": "html",
 "adapter_config": {},
 "feed_url": "https://prod-grants-gov-chatbot.s3.amazonaws.com/extracts/GrantsDBExtract20261111v2.zip",
 "note": null
}$j$::jsonb);

-- 6df99f2d
select grants.set_collection('6df99f2d-1d7e-4359-98d7-d29ec2920575'::uuid, $j${
 "adapter": "grants_gov",
 "adapter_config": {
  "rows": 25,
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
 },
 "feed_url": null,
 "note": "New NOAA Climate Program Office regional-team competitions (RISA, now Climate Adaptation Partnerships) are read from Grants.gov twice a day by title and wait for review before showing. Nothing is open now: the FY2026 round (NOAA-OAR-CPO-2026-33094) closed June 2026.",
 "verified": true
}$j$::jsonb);

