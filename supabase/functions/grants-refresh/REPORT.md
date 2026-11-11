# grants-refresh: build report (2026-11-11)

Deno edge function (`index.ts`), verify_jwt=false, auth by `x-grants-token` (sha256 compared to `grants.settings.refresh_token_sha256`), direct DB via `SUPABASE_DB_URL`. Scheduled by pg_cron -> pg_net (`003_cron.sql`), 8 shards, 13:00 and 01:00 UTC (06:00 / 18:00 Arizona).

## Behavior
- Shard = `hashtext(host) & 63`; `claim_sources` leases rows with FOR UPDATE SKIP LOCKED; two overlapping runs cannot claim the same source.
- Per-host politeness (`host_state`): min spacing with full-jitter, shared cooldown on 429/403/503, `Retry-After` honored, exponential backoff, robots.txt checked and cached.
- Conditional GET (ETag / Last-Modified), content hash of normalised text, diffs: deadline, amount, new document links; snapshot per change.
- Time-budgeted (`budget_ms`), releases leases on exit, self-chains while work remains.
- Adapters: html, rss/atom, Grants.gov / Simpler API, EU Funding & Tenders, SAM, generic JSON. Feed-adapter opportunities stay hidden unless `adapter_config.auto_vet`.
- SSRF guard (http/https only, no private/loopback/link-local/metadata hosts, no userinfo, redirect re-check); bypass only with `GRANTS_ALLOW_LOCAL=1` (tests).

## Measured (not estimated)
Automated tests: `npm test` 132 pass / 0 fail (extract 57, core 15, http+politeness 19, engine on real Postgres 15, adapters/handler/chaining 13). `deno check index.ts` clean (Deno 2.9.6).

Mock server lab: 40 sources over 10 hosts in 10.9 s = about 221 sources/min (serial bound 80 s); real-clock per-host gaps 2.5-2.7 s; 5 s budget honored (exit at 4.1 s); parse CPU 63 ms for a 600 KB page.

Live smoke, real internet, 12 hosts, local lab DB, two passes:

| | pass 1 | pass 2 |
|---|---|---|
| elapsed (budget 100 s) | 6.7 s | 2.9 s |
| sources/min | 108 | 252 |
| 200 OK | 10 | 6 (same hash, 0 changes) |
| 304 Not Modified | 0 | 4 (40% of the 10 reachable) |
| changes | 10 initial | 0 |
| errors | 2 (17%) | same 2 |
| 403 / 429 / robots-skipped | 0 / 0 / 0 | 0 / 0 / 0 |

Minimum per-host gap: 2081 ms. Errors: USDA NIFA fails on an HTTP/2 stream reset in both passes; one funder failed only because the lab DB encoding (WIN1252) rejects the euro sign, which does not apply to production UTF8. Links captured on 9 of 10 readable pages (38 total). No future deadlines were extracted on the 10 readable pages.

## Known gaps
- Amount heuristic is noisy (flagged NSF at USD 100M and one site at USD 207B from page text); amounts from html pages are hints, not facts. The dashboard treats amounts as published only when the funder row says so.
- EU F&T and Simpler Grants request shapes were tested against fixtures only, not live.
- SSRF guard does not resolve DNS (hostname-level checks only); function runs with no secrets other than the DB URL.
- NULL `external_id` on `grants.opportunities` would duplicate rows (unique index does not dedupe NULLs); the function always sets one.
- Not yet measured on the deployed function (see the end-to-end run in the final report once deployed).

## Deployed (project iuzgfldgvueuehybgntm, 2026-11-11)
- `grants-refresh` v1, verify_jwt=false (auth is the `x-grants-token` header, sha256-compared in `grants.check_refresh_token`). pg_cron `grants-refresh-am` / `-pm` (13:00 / 01:00 UTC) -> `grants.kick_refresh` -> pg_net, 8 shards.
- Live dry run: 50 planned, 49 fetched, 0 errors, 0 throttles, 15.99 s.
- Live full run: 75 sources, 71 fetched (71 first snapshots), 4 errors (3 duplicate USDA NIFA rows with an HTTP/2 stream error, IFAD 403), 0 throttles, 0 robots-skipped, 10.03 MB, 10 chained invocations, ~25 s wall, 0 leases left, 0 still due.
- Re-verify run: 3 sources -> 3x HTTP 304, 5.17 s.
- Weekly prune job is NOT scheduled: run `supabase/grants/003e_prune_job.sql` once in the dashboard SQL editor (the MCP guard declines time-based DELETE).
