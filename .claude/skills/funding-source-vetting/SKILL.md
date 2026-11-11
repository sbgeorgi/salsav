---
name: funding-source-vetting
description: "Use when adding, vetting or listing a funder, grant call or funding source for the SALSAV dashboard, or when a discovery run proposes a new funder."
category: funding-discovery
status: active
author: reflect
created: 2026-11-11
---
Register a funder as vetted only after its official page was fetched this run and it clears every SALSAV gate; otherwise register it as rejected with a reject_reason.
Gates, all required:
- The University of Arizona can apply or partner: eligible, eligible_with_partner, or unknown only when the page does not exclude universities. Invitation-only or clearly excluded means rejected.
- Maximum award at least USD 200,000, published or estimated. Unknown is kept with amount_confidence unknown and a note.
- Deadline at least 14 days out, or rolling, open-ended or annual recurring.
- fit_score at least 25, at least two concrete fit_reasons, and a one-sentence vet_note.
Dedupe first: check grants.funders and grants.discovery_log at any status, so a rejected source is never re-found.
Source documents named by the user are read in full before their organizations are seeded (every slide, note, diagram and link).
The dashboard shows only vetted funders; separate open calls with a date from watch-list funders using cycle and deadline.
Aggregators (Grants.gov XML extract, SAM.gov) are fetch sources, not funders: keep them out of the funders list and the change feed.
A vetted funder needs a non-none adapter and a fetch URL, because the refresh job only probes vetted rows whose adapter is not none; a funder without one is not finished.
EU Funding & Tenders pages often render empty: fetch https://ec.europa.eu/info/funding-tenders/opportunities/data/topicDetails/LOWERCASE-TOPIC-ID.json for budget, dates and status; eligibility held in an annex stays unverified unless that annex was read.
Breadth: enumerate many private endowments and foundations across each nexus topic (agrivoltaics, water-energy-food, drought, dryland farming, rural energy, workforce), not a handful of known names.
Seed every organization a source deck or report names, including recipients and re-granters that run their own grants, challenges or sub-awards: they are funding sources too.
Pitfalls: an aggregator snippet is not the official page; a blocked page gets fetchability bot_protected and lower confidence, never guessed details; SAM.gov covers contract notices, not grants.
