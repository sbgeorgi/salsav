// Politeness + HTTP layer against the mock multi-host server (no database).
import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import { type HttpDeps, MAX_READ_BYTES, politeGet } from "../http.ts";
import { DEFAULT_POLITENESS, Politeness, type PolitenessOpts } from "../politeness.ts";
import { ENV, Mock, realClock, scaledClock } from "./helpers.ts";

const K = 25; // virtual clock speed-up: a 2000ms interval costs 80ms of wall time
const mk = (mock: Mock, opts: Partial<PolitenessOpts> = {}, over: Partial<HttpDeps> = {}, clock = scaledClock(K)) => {
  const pol = new Politeness(clock, { ...DEFAULT_POLITENESS, ...opts });
  const d: HttpDeps = { pol, fetchImpl: fetch, env: ENV, deadline: clock.now() + 3_600_000, requestTimeoutMs: 5000, ...over };
  return { pol, d, clock };
};
const get = (d: HttpDeps, url: string, robots = false) => politeGet(d, { url, robots });

describe("politeness", () => {
  const mock = new Mock(12);
  before(() => mock.start());
  after(() => mock.stop());

  test("per-host concurrency is 1 and starts are spaced by >= 2000ms virtual (+jitter)", async () => {
    const { pol, d } = mk(mock);
    mock.route(0, "/slow", { delayMs: 60, body: "ok" });
    const rs = await Promise.all(Array.from({ length: 6 }, () => get(d, mock.url(0, "/slow"))));
    assert.ok(rs.every((r) => r.t === "response" && r.status === 200));
    assert.equal(mock.maxInflight.get(mock.host(0)), 1);
    const st = pol.stats()[mock.host(0)];
    assert.equal(st.requests, 6);
    assert.equal(st.max_concurrent, 1);
    assert.ok(st.min_gap_ms! >= 2000, `min gap ${st.min_gap_ms}`);
  });

  test("fast responses: server-observed spacing respects the configured interval", async () => {
    const { d } = mk(mock);
    for (let i = 0; i < 5; i++) await get(d, mock.url(1, `/f${i}`));
    const gaps = mock.gaps(1).map((g) => g * K);
    assert.equal(gaps.length, 4);
    assert.ok(Math.min(...gaps) >= 2000 * 0.85, `server gaps (virtual ms): ${gaps.map(Math.round)}`);
  });

  test("maxPerHost=2 allows two in flight, never more", async () => {
    const { d } = mk(mock, { maxPerHost: 2, minIntervalMs: 200, jitterMs: 0 });
    mock.route(2, "/s", { delayMs: 150, body: "x" });
    await Promise.all(Array.from({ length: 6 }, () => get(d, mock.url(2, "/s"))));
    assert.equal(mock.maxInflight.get(mock.host(2)), 2);
  });

  test("global concurrency across hosts is capped at 4", async () => {
    const before = mock.maxGlobal;
    mock.maxGlobal = 0;
    const { d, pol } = mk(mock);
    for (let i = 3; i < 11; i++) mock.route(i, "/g", { delayMs: 200, body: "x" });
    await Promise.all([3, 4, 5, 6, 7, 8, 9, 10].map((i) => get(d, mock.url(i, "/g"))));
    assert.equal(mock.maxGlobal, 4);
    assert.equal(Object.keys(pol.stats()).length, 8);
    void before;
  });

  test("429 + Retry-After is honored: the retry arrives no earlier than the stated delay", async () => {
    const { pol, d } = mk(mock, { jitterMs: 0 });
    let n = 0;
    mock.route(11, "/ra", () => (++n === 1 ? { status: 429, headers: { "retry-after": "20" } } : { body: "fine" }));
    const r = await get(d, mock.url(11, "/ra"));
    assert.ok(r.t === "response" && r.status === 200);
    const [a, b] = mock.hitsFor(11, (h) => h.path === "/ra");
    assert.ok((b.t - a.t) * K >= 20_000 * 0.97, `waited ${(b.t - a.t) * K} virtual ms`);
    assert.equal(pol.stats()[mock.host(11)].throttles, 1);
  });
});

describe("backoff and cooldown", () => {
  const mock = new Mock(6);
  before(() => mock.start());
  after(() => mock.stop());

  test("3 tries on 503 with jittered backoff, then a persistent host cooldown and no more requests", async () => {
    const { pol, d } = mk(mock);
    mock.route(0, "/x", { status: 503 });
    const r = await get(d, mock.url(0, "/x"));
    assert.equal(r.t, "throttled");
    assert.equal(mock.contentHits(0).length, 3);
    assert.ok(pol.cooldownRemaining(mock.host(0)) >= 299_000);
    const r2 = await politeGet({ ...d, deadline: d.pol.clock.now() + 60_000 }, { url: mock.url(0, "/y"), robots: false });
    assert.equal(r2.t, "budget"); // would have to wait out the cooldown
    assert.equal(mock.contentHits(0).length, 3);
    const row = pol.toSave().find((h) => h.host === mock.host(0))!;
    assert.ok((row.cooldown_until_ms as number) > pol.clock.now() && row.throttles_inc === 3 && row.consecutive_throttles === 3);
  });

  test("Retry-After longer than the budget: no request is made, outcome is budget", async () => {
    const { d, pol } = mk(mock, {}, { maxTries: 3 });
    mock.route(1, "/r", { status: 429, headers: { "retry-after": "250" } });
    const r = await politeGet({ ...d, deadline: pol.clock.now() + 100_000 }, { url: mock.url(1, "/r"), robots: false });
    assert.equal(r.t, "budget");
    assert.equal(mock.contentHits(1).length, 1);
  });

  test("request timeouts are retried with backoff then reported as throttled(null status)", async () => {
    const { d } = mk(mock, {}, { requestTimeoutMs: 150 });
    mock.route(2, "/t", { delayMs: 800, body: "late" });
    const r = await get(d, mock.url(2, "/t"));
    assert.ok(r.t === "throttled" && r.status === null);
    assert.equal(mock.contentHits(2).length, 3);
  });

  test("403 is returned immediately: exactly one request", async () => {
    const { d } = mk(mock);
    mock.route(3, "/f", { status: 403, body: "denied" });
    const r = await get(d, mock.url(3, "/f"));
    assert.ok(r.t === "response" && r.status === 403);
    assert.equal(mock.contentHits(3).length, 1);
  });

  test("persisted cooldown and last-request time from another invocation are respected", async () => {
    const clock = scaledClock(K);
    const pol = new Politeness(clock, { ...DEFAULT_POLITENESS, jitterMs: 0 });
    pol.seed({ host: "a:1", cooldown_until_ms: clock.now() + 600_000, consecutive_throttles: 2 });
    assert.equal(await pol.acquire("a:1", clock.now() + 60_000), null);
    assert.ok(pol.cooldownRemaining("a:1") > 590_000);
    pol.seed({ host: "b:1", last_request_at_ms: clock.now() });
    const t0 = clock.now();
    const rel = await pol.acquire("b:1", t0 + 60_000);
    assert.ok(rel && clock.now() - t0 >= 1900, "waited out the interval since the earlier invocation's last request");
    rel!();
  });
});

describe("robots, redirects, SSRF, size", () => {
  const mock = new Mock(8);
  before(() => mock.start());
  after(() => mock.stop());

  test("Disallow is obeyed: zero content requests; robots fetched once and cached", async () => {
    const { d } = mk(mock);
    mock.route(0, "/robots.txt", { headers: { "content-type": "text/plain" }, body: "User-agent: *\nDisallow: /private\n" });
    const blocked = await get(d, mock.url(0, "/private/page"), true);
    assert.equal(blocked.t, "robots_blocked");
    const ok = await get(d, mock.url(0, "/public"), true);
    assert.ok(ok.t === "response" && ok.status === 200);
    assert.equal(mock.hitsFor(0, (h) => h.path === "/private/page").length, 0);
    assert.equal(mock.hitsFor(0, (h) => h.path === "/robots.txt").length, 1);
  });

  test("Crawl-delay raises the spacing (capped at 30s); our own group beats '*'", async () => {
    const { d, pol } = mk(mock, { jitterMs: 0 });
    mock.route(1, "/robots.txt", { body: "User-agent: *\nDisallow: /\n\nUser-agent: SALSAV-GrantWatch\nCrawl-delay: 6\n" });
    await get(d, mock.url(1, "/a"), true);
    await get(d, mock.url(1, "/b"), true);
    assert.equal(pol.interval(pol.get(mock.host(1))), 6000);
    const gap = mock.hitsFor(1, (h) => h.path === "/b")[0].t - mock.hitsFor(1, (h) => h.path === "/a")[0].t;
    assert.ok(gap * K >= 6000 * 0.85, `gap ${gap * K}`);
    mock.route(2, "/robots.txt", { body: "User-agent: *\nCrawl-delay: 500\n" });
    await get(d, mock.url(2, "/a"), true);
    assert.equal(pol.interval(pol.get(mock.host(2))), 30_000);
  });

  test("robots.txt 404 means allowed; 5xx means unavailable (error, no content request)", async () => {
    const { d } = mk(mock);
    assert.ok((await get(d, mock.url(3, "/x"), true)).t === "response");
    mock.route(4, "/robots.txt", { status: 500 });
    const r = await get(d, mock.url(4, "/x"), true);
    assert.ok(r.t === "error" && /robots/.test(r.message));
    assert.equal(mock.hitsFor(4, (h) => h.path === "/x").length, 0);
  });

  test("redirects: same-host hop, cross-host hop through the other host's limiter and robots, loop limit", async () => {
    const { d, pol } = mk(mock);
    mock.route(5, "/a", { status: 302, headers: { location: "/b" } });
    mock.route(5, "/b", { status: 301, headers: { location: mock.url(6, "/c") } });
    mock.route(6, "/c", { body: "landed" });
    mock.route(6, "/robots.txt", { body: "User-agent: *\nDisallow: /nope\n" });
    const r = await get(d, mock.url(5, "/a"), true);
    assert.ok(r.t === "response" && r.status === 200 && r.finalUrl === mock.url(6, "/c"));
    assert.equal(pol.stats()[mock.host(6)].requests, 2); // robots.txt + page
    assert.equal(pol.stats()[mock.host(5)].requests, 3); // robots.txt + 2 hops
    mock.route(5, "/to-nope", { status: 302, headers: { location: mock.url(6, "/nope") } });
    assert.equal((await get(d, mock.url(5, "/to-nope"), true)).t, "robots_blocked"); // target host's robots applies
    mock.route(5, "/loop", { status: 302, headers: { location: "/loop" } });
    const loop = await get(d, mock.url(5, "/loop"), true);
    assert.ok(loop.t === "error" && /too many redirects/.test(loop.message));
    assert.equal(mock.hitsFor(5, (h) => h.path === "/loop").length, 5); // initial + 4 redirects
  });

  test("redirect to another origin drops custom headers (X-Api-Key) but keeps them on the same origin; cross-origin POST redirect refused", async () => {
    const { d } = mk(mock);
    mock.route(5, "/same1", { status: 302, headers: { location: "/same2" } });
    mock.route(5, "/same2", { body: "ok" });
    mock.route(5, "/x1", { status: 302, headers: { location: mock.url(6, "/x2") } });
    mock.route(6, "/x2", { body: "ok" });
    const headers = { accept: "application/json", "user-agent": "UA-Test", "x-api-key": "SECRET", authorization: "Bearer SECRET" };
    assert.equal((await politeGet(d, { url: mock.url(5, "/same1"), robots: false, headers })).t, "response");
    assert.equal(mock.hitsFor(5, (h) => h.path === "/same2")[0].headers["x-api-key"], "SECRET");
    assert.equal((await politeGet(d, { url: mock.url(5, "/x1"), robots: false, headers })).t, "response");
    assert.equal(mock.hitsFor(5, (h) => h.path === "/x1")[0].headers["x-api-key"], "SECRET"); // first hop is the origin we asked for
    const landed = mock.hitsFor(6, (h) => h.path === "/x2")[0].headers;
    assert.equal(landed["x-api-key"], undefined);
    assert.equal(landed.authorization, undefined);
    assert.equal(landed.accept, "application/json");
    mock.route(5, "/post307", { status: 307, headers: { location: mock.url(6, "/post-target") } });
    const p = await politeGet(d, { url: mock.url(5, "/post307"), robots: false, method: "POST", body: "{}", headers });
    assert.ok(p.t === "error" && /cross-origin redirect on POST/.test(p.message));
    assert.equal(mock.hitsFor(6, (h) => h.path === "/post-target").length, 0);
  });

  test("SSRF: private targets refused up front and as redirect hops (guard on, GRANTS_ALLOW_LOCAL unset)", async () => {
    const seen: string[] = [];
    const fake = (async (u: string) => {
      seen.push(u);
      if (u.endsWith("/robots.txt")) return new Response("", { status: 404 });
      return new Response("", { status: 302, headers: { location: "http://169.254.169.254/latest/meta-data/" } });
    }) as unknown as typeof fetch;
    const { d } = mk(mock, {}, { fetchImpl: fake, env: { allowLocal: false } });
    const r = await politeGet(d, { url: "http://example.org/start" });
    assert.ok(r.t === "error" && /blocked ip/.test(r.message), JSON.stringify(r));
    assert.ok(!seen.some((u) => u.includes("169.254")), "private hop was never requested");
    const direct = await politeGet(d, { url: mock.url(7, "/") });
    assert.ok(direct.t === "error" && /blocked ip/.test(direct.message));
    assert.equal(mock.hitsFor(7).length, 0);
    const scheme = await politeGet(d, { url: "file:///etc/passwd" });
    assert.ok(scheme.t === "error" && /scheme/.test(scheme.message));
  });

  test("large body is read only up to 1.5MB and flagged truncated", async () => {
    const { d } = mk(mock);
    mock.route(7, "/big", { body: Buffer.alloc(4_000_000, "a") });
    const r = await get(d, mock.url(7, "/big"));
    assert.ok(r.t === "response" && r.bytes.length === MAX_READ_BYTES && r.truncated);
    mock.route(7, "/exact", { body: Buffer.alloc(1000, "a") });
    const s = await get(d, mock.url(7, "/exact"));
    assert.ok(s.t === "response" && s.bytes.length === 1000 && !s.truncated);
  });

  test("conditional GET headers are sent and 304 is returned untouched", async () => {
    const { d } = mk(mock);
    mock.route(0, "/cond", (h) => (h.headers["if-none-match"] === '"v1"' ? { status: 304 } : { body: "x" }));
    const r = await politeGet(d, { url: mock.url(0, "/cond"), robots: false, cond: { etag: '"v1"', lastModified: "Wed, 01 Jan 2025 00:00:00 GMT" } });
    assert.ok(r.t === "response" && r.status === 304);
    const h = mock.hitsFor(0, (x) => x.path === "/cond")[0].headers;
    assert.equal(h["if-modified-since"], "Wed, 01 Jan 2025 00:00:00 GMT");
    assert.match(String(h["user-agent"]), /SALSAV-GrantWatch\/1\.0 \(\+https:\/\/salsav\.org\)$/);
    assert.match(String(h["accept-language"]), /^en-(US|GB)/);
    assert.equal(h["accept-encoding"], "gzip, br");
    assert.equal(h.cookie, undefined);
  });

  test("HTTP/2 stream error: retried once over the HTTP/1.1 fetch, SSRF guard still applies; other errors are not retried", async () => {
    mock.route(5, "/h2", { body: "ok-h1" });
    let h2Calls = 0;
    const h2Fail: typeof fetch = () => { h2Calls++; return Promise.reject(new TypeError("error sending request", { cause: new Error("stream error received: unexpected internal error encountered") })); };
    let h1Calls = 0;
    const h1: typeof fetch = (i, init) => { h1Calls++; return fetch(i, init); };
    const { d } = mk(mock, { jitterMs: 0, minIntervalMs: 10 }, { fetchImpl: h2Fail, fetchH1: h1 });
    const r = await get(d, mock.url(5, "/h2"));
    assert.ok(r.t === "response" && new TextDecoder().decode(r.bytes) === "ok-h1");
    assert.deepEqual([h2Calls, h1Calls], [1, 1]);
    // fallback fails too: reported as error after exactly one h1 attempt
    const bad = mk(mock, { jitterMs: 0, minIntervalMs: 10 }, { fetchImpl: h2Fail, fetchH1: h2Fail }).d;
    const e = await get(bad, mock.url(5, "/h2"));
    assert.ok(e.t === "error" && /stream error/.test(e.message));
    // unrelated errors skip the fallback
    h1Calls = 0;
    const dns = mk(mock, { jitterMs: 0, minIntervalMs: 10 }, { fetchImpl: () => Promise.reject(new TypeError("dns error")), fetchH1: h1 }).d;
    const n = await get(dns, mock.url(5, "/h2"));
    assert.ok(n.t === "error" && h1Calls === 0);
    // blocked targets never reach either fetch
    h2Calls = 0;
    const g = await politeGet({ ...mk(mock, {}, { fetchImpl: h2Fail, fetchH1: h1, env: { allowLocal: false } }).d }, { url: "http://127.0.0.1/x", robots: false });
    assert.ok(g.t === "error" && h2Calls === 0 && h1Calls === 0);
  });

  test("one UA profile per host-session, rotating across hosts", async () => {
    const { d } = mk(mock, { jitterMs: 0, minIntervalMs: 10 });
    for (let i = 0; i < 3; i++) await get(d, mock.url(3, `/ua${i}`));
    const uas = new Set(mock.hitsFor(3, (h) => h.path.startsWith("/ua")).map((h) => h.headers["user-agent"]));
    assert.equal(uas.size, 1);
  });
});

test("real clock: spacing between request starts to one host is >= 2s on the wall clock (default politeness)", async () => {
  const mock = await new Mock(1).start();
  try {
    const { d } = mk(mock, {}, {}, realClock);
    const t0 = Date.now();
    for (let i = 0; i < 4; i++) await get(d, mock.url(0, `/r${i}`));
    const gaps = mock.gaps(0);
    console.log(`# real-time spacing: gaps ms = ${gaps.join(", ")}; 4 requests took ${Date.now() - t0}ms`);
    assert.equal(gaps.length, 3);
    assert.ok(Math.min(...gaps) >= 1950 && Math.max(...gaps) <= 3500, `gaps ${gaps}`);
  } finally {
    await mock.stop();
  }
});
