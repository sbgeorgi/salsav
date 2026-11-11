// Adapters end-to-end (via the engine), HTTP handler, self-chaining, parallelism.
import assert from "node:assert/strict";
import { createServer, type IncomingMessage } from "node:http";
import { after, before, beforeEach, describe, test } from "node:test";
import postgres from "postgres";
import { type EngineDeps, runShard } from "../engine.ts";
import { handle, type HandlerDeps } from "../handler.ts";
import { makeStore } from "../store.ts";
import type { RunRequest } from "../types.ts";
import { addFunder, createDb, ENV, Mock, page, realClock, scaledClock, SOON, TOKEN } from "./helpers.ts";

const K = 100;
let db: Awaited<ReturnType<typeof createDb>>;
let mock: Mock;
const BASE: RunRequest = { shard: 0, shards: 1, trigger: "test", budget_ms: 100_000, max_sources: 50, chain_depth: 0, dry_run: false };
const run = (o: Partial<RunRequest> = {}, d: Partial<EngineDeps> = {}) =>
  runShard({ store: makeStore(db.sql), clock: scaledClock(K), fetchImpl: fetch, env: ENV, ...d }, { ...BASE, ...o });
const funder = async (id: string) => (await db.sql`select * from grants.funders where id = ${id}`)[0];
const opps = async () => await db.sql`select external_id, title, deadline, status, vet_status, source_adapter from grants.opportunities order by external_id`;
const makeDue = () => db.sql`update grants.funders set next_check_at = now() - interval '1 minute', cooldown_until = null`;
const html = (s: string) => ({ headers: { "content-type": "text/html" }, body: page(s) });
const rss = (items: [string, string][]) => ({
  headers: { "content-type": "application/rss+xml" },
  body: `<?xml version="1.0"?><rss version="2.0"><channel>${items.map(([g, t]) => `<item><title>${t}</title><guid>${g}</guid><link>https://f.org/${g}</link><description>Due ${SOON.long}</description></item>`).join("")}</channel></rss>`,
});
/** Send the real API hosts to mock host `i`; any other host is a test failure (nothing may touch the internet). */
const reroute = (i: number): typeof fetch => ((u: string, init?: RequestInit) => {
  const url = new URL(u);
  if (!["api.grants.gov", "api.tech.ec.europa.eu", "api.sam.gov", "api.simpler.grants.gov"].includes(url.hostname) && !url.host.startsWith("127.0.0.")) throw new Error(`unexpected host ${url.host}`);
  return fetch(url.hostname.startsWith("127.") ? u : `http://${mock.host(i)}${url.pathname}${url.search}`, init);
}) as typeof fetch;

before(async () => {
  db = await createDb("adp");
  mock = await new Mock(16).start();
});
after(async () => {
  await mock.stop();
  await db.drop();
});
beforeEach(async () => {
  await db.sql`delete from grants.funders`;
  await db.sql`delete from grants.host_state`;
  await db.sql`delete from grants.refresh_runs`;
  mock.hits = [];
  mock.routes.clear();
});

describe("adapters", () => {
  test("rss: opportunities stored as hidden candidates; a re-run adds no duplicates and updates changed items", async () => {
    mock.route(0, "/feed", rss([["a", "Call A"], ["b", "Call B"]]));
    const id = await addFunder(db.sql, { url: mock.url(0, "/page"), feed_url: mock.url(0, "/feed"), adapter: "rss" });
    await run();
    assert.deepEqual((await opps()).map((o) => [o.external_id, o.vet_status, o.source_adapter]), [["a", "candidate", "rss"], ["b", "candidate", "rss"]]);
    assert.equal((await opps())[0].deadline.toISOString().slice(0, 10), SOON.iso);
    assert.equal((await db.sql`select count(*)::int n from grants.snapshots`)[0].n, 1);
    await makeDue();
    await run();
    assert.equal((await opps()).length, 2);
    assert.equal((await db.sql`select count(*)::int n from grants.snapshots`)[0].n, 1, "same items = same hash = no snapshot");
    mock.route(0, "/feed", rss([["a", "Call A renamed"], ["b", "Call B"], ["c", "Call C"]]));
    await makeDue();
    await run();
    assert.deepEqual((await opps()).map((o) => o.title), ["Call A renamed", "Call B", "Call C"]);
    const [s] = await db.sql`select change_kind, diff from grants.snapshots where funder_id = ${id} order by id desc limit 1`;
    assert.equal(s.change_kind, "content");
    assert.ok(s.diff.added.length >= 2);
  });

  test("grants_gov search2 (POST) maps oppHits; auto_vet makes them visible", async () => {
    const hits = { errorcode: 0, data: { hitCount: 2, oppHits: [
      { id: "1", number: "NSF-27-001", title: "Agri solar", openDate: "01/05/2027", closeDate: "03/15/2099", oppStatus: "posted" },
      { id: "2", number: "DOE-27-002", title: "Forecast", openDate: "", closeDate: "", oppStatus: "forecasted" }] } };
    mock.route(5, "/v1/api/search2", { headers: { "content-type": "application/json" }, body: JSON.stringify(hits) });
    await addFunder(db.sql, { url: "https://www.grants.gov/search", adapter: "grants_gov", adapter_config: { keyword: "agrivoltaics", auto_vet: true } });
    const r = await run({}, { fetchImpl: reroute(5) });
    assert.equal(r.stats.errors, 0);
    assert.deepEqual((await opps()).map((o) => [o.external_id, o.status, o.vet_status]), [["DOE-27-002", "forecasted", "vetted"], ["NSF-27-001", "open", "vetted"]]);
    const post = mock.hits.find((h) => h.path === "/v1/api/search2")!;
    assert.equal(post.method, "POST");
    assert.equal(mock.hits.filter((h) => h.path === "/robots.txt").length, 0, "APIs are called without robots.txt");
  });

  test("eu_ft and json_api through the same pipeline", async () => {
    mock.route(6, "/search-api/prod/rest/search", { headers: { "content-type": "application/json" }, body: JSON.stringify({ results: [{ reference: "R", summary: "S", metadata: { identifier: ["HE-1"], title: ["Topic"], deadlineDate: ["2099-04-15T00:00:00.000+0000"], status: ["31094501"] } }] }) });
    mock.route(7, "/api/items", { headers: { "content-type": "application/json" }, body: JSON.stringify({ data: { items: [{ id: 9, title: "Item nine", dl: "2099-05-01" }] } }) });
    await addFunder(db.sql, { url: "https://ec.europa.eu/x", adapter: "eu_ft", adapter_config: { auto_vet: true } });
    await addFunder(db.sql, { url: "https://x.org/y", adapter: "json_api", adapter_config: { url: mock.url(7, "/api/items"), items_path: "data.items", map: { external_id: "id", title: "title", deadline: "dl" } } });
    const f: typeof fetch = ((u: string, init?: RequestInit) => (String(u).includes("ec.europa.eu") ? reroute(6)(u, init) : fetch(u, init))) as typeof fetch;
    const r = await run({}, { fetchImpl: f });
    assert.equal(r.stats.errors, 0);
    assert.deepEqual((await opps()).map((o) => [o.external_id, o.source_adapter, o.deadline.toISOString().slice(0, 10)]), [["9", "json_api", "2099-05-01"], ["HE-1", "eu_ft", "2099-04-15"]]);
  });

  test("sam_gov without SAM_API_KEY falls back to the html page; the key never reaches error text", async () => {
    mock.route(8, "/sam", html(`SAM page. Deadline: ${SOON.long}.`));
    const id = await addFunder(db.sql, { url: mock.url(8, "/sam"), adapter: "sam_gov" });
    await run();
    assert.equal((await funder(id)).last_status, 200);
    assert.equal(mock.hits.some((h) => h.host === "api.sam.gov"), false);
    // with a key and a failing API: error message is scrubbed of the key
    mock.route(9, "/opportunities/v2/search", { status: 500 });
    mock.route(9, "/sam", { status: 500 });
    const id2 = await addFunder(db.sql, { url: mock.url(9, "/sam"), adapter: "sam_gov" });
    await run({ only_ids: [id2] }, { fetchImpl: reroute(9), env: { allowLocal: true, samKey: "SECRET-KEY-123" } });
    const f = await funder(id2);
    assert.ok(f.last_error && !JSON.stringify(f).includes("SECRET-KEY-123"));
    assert.ok(mock.hits.some((h) => h.path.includes("api_key=SECRET-KEY-123")), "key was sent to the API");
  });

  test("fallback feed -> html when the feed errors (5xx) on another host", async () => {
    mock.route(0, "/feed", { status: 500 });
    mock.route(1, "/page", html(`Fallback page. Deadline: ${SOON.long}.`));
    const id = await addFunder(db.sql, { url: mock.url(1, "/page"), feed_url: mock.url(0, "/feed"), adapter: "rss" });
    const r = await run();
    assert.equal(r.stats.fetched, 1);
    assert.equal((await funder(id)).last_status, 200);
    assert.equal(mock.contentHits(0).length, 1, "feed tried once");
    assert.equal(mock.contentHits(1).length, 1);
  });

  test("fallback html -> feed_url when the page is bot-protected (403); success resets fetchability", async () => {
    mock.route(2, "/p", { status: 403 });
    mock.route(3, "/feed", rss([["x", "Feed call"]]));
    const id = await addFunder(db.sql, { url: mock.url(2, "/p"), feed_url: mock.url(3, "/feed") });
    await db.sql`update grants.funders set fetchability = 'bot_protected' where id = ${id}`;
    const r = await run();
    assert.equal(r.stats.fetched, 1);
    assert.equal((await funder(id)).fetchability, "easy");
    assert.equal((await opps()).length, 1);
  });

  test("no fallback onto a host that is cooling down (429 on the same host)", async () => {
    mock.route(4, "/feed", { status: 429 });
    const id = await addFunder(db.sql, { url: mock.url(4, "/page"), feed_url: mock.url(4, "/feed"), adapter: "rss" });
    const r = await run();
    assert.equal(r.stats.errors, 1);
    assert.equal(mock.hitsFor(4, (h) => h.path === "/page").length, 0);
    assert.equal(mock.hitsFor(4, (h) => h.path === "/feed").length, 3);
    assert.ok((await funder(id)).cooldown_until > new Date());
  });

  test("no fallback after a guard violation or robots block", async () => {
    mock.route(5, "/feed", { status: 302, headers: { location: "http://169.254.169.254/x" } });
    mock.route(6, "/page", html("never fetched"));
    await addFunder(db.sql, { url: mock.url(6, "/page"), feed_url: mock.url(5, "/feed"), adapter: "rss" });
    const r = await run({}, { env: { allowLocal: false } });
    assert.equal(r.stats.errors, 1);
    assert.equal(mock.hits.length, 0);
  });
});

describe("handler", () => {
  const sqlFor = () => postgres(db.url, { prepare: false, max: 2, onnotice: () => {} });
  const deps = (over: Partial<HandlerDeps> = {}): HandlerDeps => ({ makeSql: sqlFor, env: ENV, clock: scaledClock(K), fetchImpl: fetch, ...over });
  const post = (body: unknown, token: string | null = TOKEN) =>
    new Request("http://f/functions/v1/grants-refresh", { method: "POST", headers: { ...(token ? { "x-grants-token": token } : {}) }, body: typeof body === "string" ? body : JSON.stringify(body) });

  test("405 for non-POST, 401 for missing/wrong token (no work done), 400 for bad body", async () => {
    await addFunder(db.sql, { url: mock.url(0, "/h") });
    for (const m of ["GET", "PUT", "DELETE"]) assert.equal((await handle(new Request("http://f/", { method: m }), deps())).status, 405);
    assert.equal((await handle(post({}, null), deps())).status, 401);
    assert.equal((await handle(post({}, "wrong"), deps())).status, 401);
    assert.equal((await handle(post("{not json"), deps())).status, 400);
    assert.equal((await handle(post({ shard: 9, shards: 4 }), deps())).status, 400);
    assert.equal(mock.hits.length, 0);
    assert.equal((await db.sql`select count(*)::int n from grants.refresh_runs`)[0].n, 0);
  });

  test("200 with token: runs the shard and returns stats", async () => {
    mock.route(0, "/h", html("handler page"));
    await addFunder(db.sql, { url: mock.url(0, "/h") });
    const res = await handle(post({ trigger: "cron", budget_ms: 20000 }), deps());
    const j = await res.json() as any;
    assert.equal(res.status, 200);
    assert.deepEqual([j.ok, j.stats.fetched, j.stats.changed, j.stats.planned, j.remaining_due], [true, 1, 1, 1, 0]);
    assert.equal((await db.sql`select trigger from grants.refresh_runs`)[0].trigger, "cron");
  });

  test("self-chaining: remaining work triggers a POST with the same token and chain_depth+1, until drained", async () => {
    for (let i = 0; i < 4; i++) await addFunder(db.sql, { url: mock.url(i, "/chain") });
    const received: { depth: number; token: string | undefined; parent: string | null }[] = [];
    const pending: Promise<unknown>[] = [];
    const server = createServer(async (req: IncomingMessage, res) => {
      const chunks: Buffer[] = [];
      for await (const c of req) chunks.push(c as Buffer);
      const body = Buffer.concat(chunks).toString();
      if (req.url!.endsWith("/functions/v1/grants-refresh") && body.includes('"chain"')) {
        const b = JSON.parse(body);
        received.push({ depth: b.chain_depth, token: req.headers["x-grants-token"] as string, parent: b.parent_run });
      }
      const r = await handle(new Request(`http://x${req.url}`, { method: req.method, headers: req.headers as Record<string, string>, body: body || undefined }), d);
      res.writeHead(r.status).end(await r.text());
    });
    await new Promise<void>((ok) => server.listen(0, "127.0.0.1", ok));
    const d = deps({ supabaseUrl: `http://127.0.0.1:${(server.address() as { port: number }).port}`, waitUntil: (p) => void pending.push(p) });
    try {
      const res = await handle(post({ max_sources: 1 }), d);
      assert.equal(res.status, 200);
      for (let i = 0; i < 40 && (await db.sql`select count(*)::int n from grants.snapshots`)[0].n < 4; i++) await new Promise((ok) => setTimeout(ok, 250));
      await Promise.all(pending);
      assert.equal((await db.sql`select count(*)::int n from grants.snapshots`)[0].n, 4);
      assert.deepEqual(received.map((r) => r.depth).sort(), [1, 2, 3]);
      assert.ok(received.every((r) => r.token === TOKEN && r.parent));
      const runs = await db.sql`select trigger, chained from grants.refresh_runs order by started_at`;
      assert.deepEqual(runs.map((r) => r.trigger), ["manual", "chain", "chain", "chain"]);
      assert.deepEqual(runs.map((r) => r.chained), [true, true, true, false]);
    } finally {
      server.closeAllConnections();
      await new Promise((ok) => server.close(ok));
    }
  });

  test("chain depth is capped at 6 and dry_run never chains", async () => {
    for (let i = 0; i < 3; i++) await addFunder(db.sql, { url: mock.url(i, "/cap") });
    const calls: string[] = [];
    const spy = ((u: string, init?: RequestInit) => (String(u).includes("/functions/v1/") ? (calls.push(String(u)), Promise.resolve(new Response("{}"))) : fetch(u, init))) as typeof fetch;
    const d = deps({ supabaseUrl: "http://chain.test", fetchImpl: spy, waitUntil: () => {} });
    await handle(post({ max_sources: 1, chain_depth: 6 }), d);
    await handle(post({ max_sources: 1, dry_run: true }), d);
    assert.equal(calls.length, 0);
    await handle(post({ max_sources: 1, chain_depth: 5 }), d);
    assert.equal(calls.length, 1);
  });

  test("malformed tokens are rejected before the DB is touched", async () => {
    let made = 0;
    const d = deps({ makeSql: () => (made++, sqlFor()) });
    for (const t of ["a".repeat(129), "short", "has space in it", "semi;colon-token", "x';--quote-token"]) assert.equal((await handle(post({}, t), d)).status, 401, t);
    assert.equal(made, 0);
    assert.equal((await handle(post({ max_sources: 1 }), d)).status, 200); // the real token still passes
    assert.equal(made, 1);
  });

  test("unexpected errors return a generic 500 with no internal detail (logged server-side only)", async () => {
    const boom = () => {
      throw new Error("connection to db.secret-host.supabase.co:5432 refused (password=hunter2)");
    };
    const fakeSql = Object.assign(boom, { end: async () => {}, unsafe: boom }) as unknown as ReturnType<typeof sqlFor>;
    const logged: unknown[][] = [];
    const orig = console.error;
    console.error = (...a: unknown[]) => void logged.push(a);
    try {
      const res = await handle(post({}), deps({ makeSql: () => fakeSql }));
      const text = await res.text();
      assert.equal(res.status, 500);
      assert.deepEqual(JSON.parse(text), { ok: false, error: "internal" });
      assert.ok(!/secret-host|hunter2|connection/.test(text));
      assert.ok(/secret-host/.test(String(logged[0]?.[1])), "detail is logged");
      const res2 = await handle(post({}), deps({ makeSql: boom as never })); // makeSql itself failing is covered too
      assert.deepEqual(await res2.json(), { ok: false, error: "internal" });
    } finally {
      console.error = orig;
    }
  });
});

test("parallelism: 40 sources over 10 hosts, real clock, global concurrency 4", async () => {
  await db.sql`delete from grants.funders`;
  for (let h = 0; h < 10; h++) for (let p = 0; p < 4; p++) await addFunder(db.sql, { url: mock.url(h, `/par${p}`) });
  mock.hits = [];
  mock.maxGlobal = 0;
  const t0 = Date.now();
  const r = await run({}, { clock: realClock });
  const wall = Date.now() - t0;
  const hosts = Object.values(r.stats.hosts);
  const minGap = Math.min(...hosts.map((h) => h.min_gap_ms!));
  const avgGap = Math.round(hosts.reduce((a, h) => a + h.avg_gap_ms!, 0) / hosts.length);
  const requests = hosts.reduce((a, h) => a + h.requests, 0);
  const serialLower = 40 * 2000; // one polite crawler, one request per 2s overall
  console.log(`# parallelism: ${r.stats.fetched}/40 sources, ${requests} requests (incl. robots) in ${wall}ms = ${(r.stats.fetched / (wall / 60000)).toFixed(1)} sources/min; serial lower bound ${serialLower}ms (${(serialLower / wall).toFixed(1)}x slower); per-host gap min ${minGap}ms avg ${avgGap}ms; max global in flight ${mock.maxGlobal}`);
  assert.equal(r.stats.fetched, 40);
  assert.ok(mock.maxGlobal <= 4);
  assert.ok(hosts.every((h) => h.max_concurrent === 1) && minGap >= 2000);
  assert.ok(wall < serialLower / 2, `wall ${wall}ms`);
});
