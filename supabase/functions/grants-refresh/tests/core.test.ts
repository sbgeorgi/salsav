import assert from "node:assert/strict";
import { test } from "node:test";
import { euFt, getPath, grantsGov, jsonApi, samGov } from "../adapters/api.ts";
import { looksLikeFeed, parseFeed } from "../adapters/feed.ts";
import { BACKOFF_BASE_MS, BACKOFF_CAP_MS, fullJitter, parseRetryAfter } from "../backoff.ts";
import { checkUrl, GuardError } from "../guard.ts";
import { parseRequest } from "../handler.ts";
import { isAllowed, parseRobots } from "../robots.ts";
import { ACCEPT_LANGUAGES, apiHeaders, pageHeaders, PRODUCT_TOKEN, UA_POOL, pickProfile } from "../ua.ts";
import type { Source } from "../types.ts";

const src = (o: Partial<Source> = {}): Source => ({ id: "x", name: "n", url: "https://f.org/", feed_url: null, adapter: "html", adapter_config: {}, etag: null, last_modified: null, content_hash: null, fetchability: "unknown", consecutive_failures: 0, cycle: "fixed_deadline", next_deadline: null, page_type: "html_static", shard: 0, ...o });

// ---------- robots ----------
test("robots: longest match wins, Allow beats Disallow on ties, wildcards and $", () => {
  const r = parseRobots("User-agent: *\nDisallow: /private/\nAllow: /private/open/\nDisallow: /*.json$\nDisallow: /tie\nAllow: /tie\n");
  assert.equal(isAllowed(r, "/grants"), true);
  assert.equal(isAllowed(r, "/private/x"), false);
  assert.equal(isAllowed(r, "/private/open/x"), true);
  assert.equal(isAllowed(r, "/a/b.json"), false);
  assert.equal(isAllowed(r, "/a/b.json?x=1"), true);
  assert.equal(isAllowed(r, "/tie"), true);
});

test("robots: our own group beats '*', crawl-delay is parsed, empty Disallow allows all", () => {
  const r = parseRobots("User-agent: *\nDisallow: /\nCrawl-delay: 20\n\nUser-agent: SALSAV-GrantWatch\nUser-agent: other\nDisallow: /secret\nCrawl-delay: 7\n");
  assert.equal(isAllowed(r, "/grants"), true);
  assert.equal(isAllowed(r, "/secret/a"), false);
  assert.equal(r.crawlDelayS, 7);
  const star = parseRobots("User-agent: *\nDisallow: /\nCrawl-delay: 20");
  assert.equal(isAllowed(star, "/"), false);
  assert.equal(star.crawlDelayS, 20);
  assert.equal(isAllowed(parseRobots("User-agent: *\nDisallow:"), "/x"), true);
  assert.equal(isAllowed(parseRobots(""), "/x"), true);
  assert.equal(isAllowed(parseRobots("User-agent: googlebot\nDisallow: /"), "/x"), true);
});

// ---------- guard ----------
test("guard refuses non-http, credentials, private/link-local/local names", () => {
  const bad = [
    "ftp://example.org/x", "file:///etc/passwd", "javascript:alert(1)", "https://user:pw@example.org/", "http://localhost/", "http://foo.localhost/",
    "http://127.0.0.1/", "http://127.1/", "http://2130706433/", "http://0x7f000001/", "http://10.1.2.3/", "http://172.16.0.1/", "http://172.31.255.255/",
    "http://192.168.1.1/", "http://169.254.169.254/latest/meta-data", "http://100.64.0.1/", "http://0.0.0.0/", "http://[::1]/", "http://[fe80::1]/",
    "http://[fd00::1]/", "http://[::ffff:127.0.0.1]/", "http://[::ffff:10.0.0.1]/", "http://printer.local/", "http://db.internal/", "http://intranet/", "not a url",
    "https://example.org:8443/x", "http://example.org:22/", "http://10.0.0.1.nip.io/", "http://169.254.169.254.sslip.io/", "http://10-0-0-1.example.com/", "http://foo.192.168.1.5.example.org/", "http://www.localtest.me/",
  ];
  for (const u of bad) assert.throws(() => checkUrl(u, false), GuardError, u);
  for (const u of ["https://www.nsf.gov/funding", "http://8.8.8.8/", "https://172.32.0.1/", "https://[2606:4700::1111]/", "https://example.org:443/x", "http://example.org:80/", "https://203-0-113-9.example.com/"]) {
    assert.doesNotThrow(() => checkUrl(u, false), u);
  }
  assert.doesNotThrow(() => checkUrl("http://127.0.0.2:8080/", true));
  assert.throws(() => checkUrl("https://user:pw@example.org/", true), GuardError); // credentials are never allowed
});

// ---------- backoff ----------
test("full jitter stays within [0, min(cap, base*2^n)] and actually spreads", () => {
  for (let n = 0; n < 12; n++) {
    const hi = Math.min(BACKOFF_CAP_MS, BACKOFF_BASE_MS * 2 ** n);
    const xs = Array.from({ length: 2000 }, () => fullJitter(n, Math.random));
    assert.ok(xs.every((x) => x >= 0 && x <= hi), `n=${n}`);
    const mean = xs.reduce((a, b) => a + b, 0) / xs.length;
    assert.ok(Math.abs(mean - hi / 2) < hi * 0.06, `mean ${mean} vs ${hi / 2} (n=${n})`);
    assert.ok(Math.max(...xs) > hi * 0.9 && Math.min(...xs) < hi * 0.1);
  }
  assert.equal(fullJitter(0, () => 0.999999), BACKOFF_BASE_MS - 1);
  assert.equal(fullJitter(30, () => 0.5), BACKOFF_CAP_MS / 2);
});

test("Retry-After: seconds, HTTP date, capped at 300s, garbage ignored", () => {
  const now = Date.parse("2027-01-01T00:00:00Z");
  assert.equal(parseRetryAfter("7", now), 7000);
  assert.equal(parseRetryAfter("0", now), 0);
  assert.equal(parseRetryAfter("9999", now), 300_000);
  assert.equal(parseRetryAfter("Fri, 01 Jan 2027 00:00:30 GMT", now), 30_000);
  assert.equal(parseRetryAfter("Thu, 31 Dec 2026 00:00:00 GMT", now), 0);
  assert.equal(parseRetryAfter("soon", now), null);
  assert.equal(parseRetryAfter(null, now), null);
});

// ---------- headers ----------
test("UA pool: >=6 desktop browser UAs, each ends with the product token; headers are coherent", () => {
  assert.ok(UA_POOL.length >= 6);
  assert.equal(new Set(UA_POOL.map((u) => u.ua)).size, UA_POOL.length);
  for (const u of UA_POOL) {
    assert.ok(u.ua.startsWith("Mozilla/5.0 (") && u.ua.endsWith(PRODUCT_TOKEN), u.ua);
    assert.ok(!/Mobile|Android|iPhone/.test(u.ua));
  }
  assert.ok(ACCEPT_LANGUAGES.every((l) => /^en-(US|GB)/.test(l)));
  const seen = new Set<string>();
  for (let i = 0; i < 400; i++) seen.add(pickProfile(Math.random).ua);
  assert.equal(seen.size, UA_POOL.length);
  const h = pageHeaders(pickProfile(Math.random), { etag: '"abc"', lastModified: "Wed, 01 Jan 2025 00:00:00 GMT" });
  assert.equal(h["Accept-Encoding"], "gzip, br");
  assert.equal(h["If-None-Match"], '"abc"');
  assert.equal(h["If-Modified-Since"], "Wed, 01 Jan 2025 00:00:00 GMT");
  assert.ok(!("Cookie" in h));
  assert.ok(!("If-None-Match" in pageHeaders(pickProfile(Math.random))));
  assert.match(apiHeaders(pickProfile(Math.random)).Accept, /json/);
});

// ---------- request parsing ----------
test("parseRequest applies defaults and clamps", () => {
  const d = parseRequest({}) as ReturnType<typeof parseRequest> & object;
  assert.deepEqual([d.shard, d.shards, d.budget_ms, d.max_sources, d.chain_depth, d.dry_run], [0, 1, 100_000, 12, 0, false]);
  const c = parseRequest({ shard: 2, shards: 4, budget_ms: 9e9, max_sources: 999, dry_run: true, chain_depth: 3 }) as any;
  assert.deepEqual([c.shard, c.shards, c.budget_ms, c.max_sources, c.dry_run, c.chain_depth], [2, 4, 140_000, 50, true, 3]);
  assert.equal(typeof parseRequest({ shard: 4, shards: 4 }), "string");
  assert.equal(typeof parseRequest({ only_ids: ["nope"] }), "string");
});

// ---------- feeds ----------
const RSS = `<?xml version="1.0"?><rss version="2.0"><channel><title>F</title>
<item><title>Climate <b>Call</b> 2027</title><link>https://f.org/call-1</link><guid isPermaLink="false">call-1</guid>
 <description>&lt;p&gt;Submit proposals. Deadline: March 15, 2027.&lt;/p&gt;</description><pubDate>Mon, 01 Jan 2024 00:00:00 GMT</pubDate></item>
<item><title>No guid</title><link>https://f.org/call-2</link><description>Rolling.</description></item>
<item><description>missing title</description></item></channel></rss>`;
const ATOM = `<?xml version="1.0" encoding="utf-8"?><feed xmlns="http://www.w3.org/2005/Atom"><title>A</title>
<entry><title>Atom call</title><id>tag:f.org,2027:1</id><link rel="self" href="https://f.org/self"/><link rel="alternate" href="https://f.org/atom-1"/>
 <summary>Due 2027-04-01 for all applicants</summary><updated>2027-01-01T00:00:00Z</updated></entry>
<entry><title>Second</title><id>tag:f.org,2027:2</id><link href="https://f.org/atom-2"/><content type="html">&lt;b&gt;Hi&lt;/b&gt;</content></entry></feed>`;

test("RSS 2.0 fixture: guid/link ids, html stripped, labeled deadline only", () => {
  const o = parseFeed(RSS, "2027-01-01");
  assert.equal(o.length, 2);
  assert.deepEqual([o[0].external_id, o[0].title, o[0].url, o[0].deadline], ["call-1", "Climate Call 2027", "https://f.org/call-1", "2027-03-15"]);
  assert.equal(o[0].description, "Submit proposals. Deadline: March 15, 2027.");
  assert.deepEqual([o[1].external_id, o[1].deadline], ["https://f.org/call-2", null]); // falls back to link; pubDate is not a deadline
});

test("Atom fixture: alternate link, id, summary deadline", () => {
  const o = parseFeed(ATOM, "2027-01-01");
  assert.deepEqual(o.map((x) => [x.external_id, x.url, x.deadline]), [["tag:f.org,2027:1", "https://f.org/atom-1", "2027-04-01"], ["tag:f.org,2027:2", "https://f.org/atom-2", null]]);
  assert.equal(o[1].description, "Hi");
});

test("looksLikeFeed", () => {
  assert.ok(looksLikeFeed("application/rss+xml", RSS));
  assert.ok(looksLikeFeed("text/html", ATOM)); // mislabeled feeds are still feeds
  assert.ok(!looksLikeFeed("text/html", "<html><body>hi</body></html>"));
});

// ---------- API adapters (recorded-shape fixtures, not live) ----------
test("grants.gov search2: request from adapter_config, response mapping", () => {
  const r = grantsGov.request(src({ adapter: "grants_gov", adapter_config: { keyword: "agrivoltaics", agencies: "USDA|DOE", rows: 10 } }), { allowLocal: false }, new Date());
  assert.equal(r.url, "https://api.grants.gov/v1/api/search2");
  assert.deepEqual(JSON.parse(r.body as string), { rows: 10, oppStatuses: "forecasted|posted", keyword: "agrivoltaics", agencies: "USDA|DOE" });
  const fixture = { errorcode: 0, msg: "Webservice Succeeds", data: { hitCount: 2, oppHits: [
    { id: "351000", number: "USDA-NIFA-AFRI-009", title: "AFRI Foundational", agencyCode: "USDA-NIFA", agency: "National Institute of Food and Agriculture", openDate: "01/05/2027", closeDate: "03/15/2027", oppStatus: "posted", docType: "synopsis", cfdaList: ["10.310"] },
    { id: "351001", number: "DOE-FOA-1", title: "Solar forecast", openDate: "", closeDate: "", oppStatus: "forecasted" }] } };
  const o = grantsGov.parse(fixture, src());
  assert.deepEqual(o.map((x) => [x.external_id, x.deadline, x.status]), [["USDA-NIFA-AFRI-009", "2027-03-15", "open"], ["DOE-FOA-1", null, "forecasted"]]);
  assert.equal(o[0].url, "https://www.grants.gov/search-results-detail/351000");
});

test("grants.gov: Simpler API only when GRANTS_GOV_API_KEY is set", () => {
  const s = src({ adapter: "grants_gov", adapter_config: { keyword: "solar" } });
  const r = grantsGov.request(s, { allowLocal: false, grantsGovKey: "k" }, new Date());
  assert.match(r.url, /api\.simpler\.grants\.gov/);
  assert.equal(r.headers?.["X-Auth"], "k");
  const o = grantsGov.parse({ data: [{ opportunity_id: "u1", opportunity_number: "N-1", opportunity_title: "T", opportunity_status: "posted", summary: { close_date: "2027-05-01", post_date: "2027-01-01" } }] }, s);
  assert.deepEqual([o[0].external_id, o[0].deadline, o[0].status], ["N-1", "2027-05-01", "open"]);
});

test("EU F&T: multipart query with default open/forthcoming filter; response mapping", async () => {
  const r = euFt.request(src({ adapter: "eu_ft" }), { allowLocal: false }, new Date());
  assert.match(r.url, /apiKey=SEDIA&text=\*&pageSize=50/);
  const q = JSON.parse(await ((r.body as FormData).get("query") as Blob).text());
  assert.deepEqual(q.bool.must[1].terms.status, ["31094501", "31094502"]);
  const o = euFt.parse({ totalResults: 2, results: [
    { reference: "HORIZON-X", summary: "Soil health", metadata: { identifier: ["HORIZON-CL6-2027-01"], title: ["Soil topic"], deadlineDate: ["2027-04-15T00:00:00.000+0000"], status: ["31094501"] } },
    { reference: "R2", title: "Forthcoming", metadata: { status: ["31094502"] } }] }, src());
  assert.deepEqual(o.map((x) => [x.external_id, x.title, x.deadline, x.status]), [["HORIZON-CL6-2027-01", "Soil topic", "2027-04-15", "open"], ["R2", "Forthcoming", null, "forecasted"]]);
});

test("SAM.gov: key in query string, MM/dd/yyyy dates, response mapping", () => {
  const r = samGov.request(src({ adapter: "sam_gov", adapter_config: { title: "solar", limit: 5 } }), { allowLocal: false, samKey: "K" }, new Date("2027-02-10T00:00:00Z"));
  const u = new URL(r.url);
  assert.deepEqual([u.searchParams.get("api_key"), u.searchParams.get("postedTo"), u.searchParams.get("postedFrom"), u.searchParams.get("limit"), u.searchParams.get("title")], ["K", "02/10/2027", "01/11/2027", "5", "solar"]);
  const o = samGov.parse({ totalRecords: 1, opportunitiesData: [{ noticeId: "abc", title: "Solar R&D", responseDeadLine: "2027-03-30T17:00:00-05:00", uiLink: "https://sam.gov/opp/abc", postedDate: "2027-02-01" }] }, src());
  assert.deepEqual([o[0].external_id, o[0].deadline, o[0].open_date], ["abc", "2027-03-30", "2027-02-01"]);
});

test("json_api: configurable paths and POST body", () => {
  const s = src({ adapter: "json_api", adapter_config: { url: "https://x.org/api", method: "POST", body: { q: 1 }, items_path: "result.items", map: { external_id: "ref.id", title: "name", url: "link", deadline: "dl", description: "desc" } } });
  const r = jsonApi.request(s, { allowLocal: false }, new Date());
  assert.deepEqual([r.url, r.method, r.body], ["https://x.org/api", "POST", '{"q":1}']);
  const o = jsonApi.parse({ result: { items: [{ ref: { id: 7 }, name: "N", link: "https://x.org/7", dl: "April 1, 2027", desc: "D" }, { name: "no id" }] } }, s);
  assert.equal(o.length, 1);
  assert.deepEqual([o[0].external_id, o[0].deadline, o[0].description], ["7", "2027-04-01", "D"]);
  assert.equal(getPath({ a: [{ b: 1 }] }, "a.0.b"), 1);
  assert.deepEqual(jsonApi.parse({ nothing: true }, s), []);
});

test("robots: hostile wildcard pattern cannot cause catastrophic backtracking (linear matcher)", () => {
  const r = parseRobots(`User-agent: *\nDisallow: /*a*a*a*a*a*a*a*a*a*a*b\nDisallow: /x*y*z$\n`);
  const path = "/" + "a".repeat(60);
  const t0 = performance.now();
  assert.equal(isAllowed(r, path), true); // no "b": no match
  assert.equal(isAllowed(r, path + "b"), false);
  assert.equal(isAllowed(r, "/x-y-z"), false);
  assert.equal(isAllowed(r, "/x-y-z/more"), true); // $ anchors the end
  assert.equal(isAllowed(r, "/xyz"), false);
  assert.ok(performance.now() - t0 < 20, `took ${performance.now() - t0} ms`);
});
