// Engine against a real Postgres (001/002 SQL applied) and the mock multi-host server.
import assert from "node:assert/strict";
import { after, before, beforeEach, describe, test } from "node:test";
import { type EngineDeps, runShard } from "../engine.ts";
import { makeStore } from "../store.ts";
import type { RunRequest } from "../types.ts";
import { addFunder, createDb, ENV, Mock, page, realClock, scaledClock, SOON, SOON2 } from "./helpers.ts";

const K = 100;
let db: Awaited<ReturnType<typeof createDb>>;
let mock: Mock;
const BASE: RunRequest = { shard: 0, shards: 1, trigger: "test", budget_ms: 100_000, max_sources: 50, chain_depth: 0, dry_run: false };
const run = (o: Partial<RunRequest> = {}, d: Partial<EngineDeps> = {}) =>
  runShard({ store: makeStore(db.sql), clock: scaledClock(K), fetchImpl: fetch, env: ENV, ...d }, { ...BASE, ...o });
const count = async (table: string) => (await db.sql.unsafe(`select count(*)::int n from grants.${table}`))[0].n as number;
const funder = async (id: string) => (await db.sql`select * from grants.funders where id = ${id}`)[0];
const makeDue = () => db.sql`update grants.funders set next_check_at = now() - interval '1 minute', cooldown_until = null`;
const html = (s: string) => ({ headers: { "content-type": "text/html" }, body: page(s) });

before(async () => {
  db = await createDb("eng");
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

describe("change detection and idempotency", () => {
  test("second back-to-back run records nothing new: 304 when the server supports validators, same hash when not", async () => {
    mock.route(0, "/p", (h) => (h.headers["if-none-match"] === '"v1"' ? { status: 304 } : { ...html(`Funding page body. Deadline: ${SOON2.long}.`), headers: { etag: '"v1"', "content-type": "text/html" } }));
    mock.route(1, "/p", html("Plain page without validators. Awards up to $300,000."));
    const a = await addFunder(db.sql, { url: mock.url(0, "/p") });
    const b = await addFunder(db.sql, { url: mock.url(1, "/p") });
    const r1 = await run();
    assert.deepEqual([r1.stats.planned, r1.stats.fetched, r1.stats.changed, r1.stats.errors], [2, 2, 2, 0]);
    assert.equal(await count("snapshots"), 2);
    assert.equal((await funder(a)).etag, '"v1"');
    assert.equal((await funder(a)).next_deadline.toISOString().slice(0, 10), SOON2.iso);
    assert.equal(r1.remaining_due, 0);

    await makeDue();
    const before = mock.hits.length;
    const r2 = await run();
    assert.deepEqual([r2.stats.fetched, r2.stats.not_modified, r2.stats.changed, r2.stats.errors], [1, 1, 0, 0]);
    assert.equal(await count("snapshots"), 2, "no new snapshots");
    assert.equal(mock.hits.length - before, 2, "no robots refetch within 24h");
    assert.equal((await funder(a)).last_status, 304);
    const [hs] = await db.sql`select requests_total::int n, robots_txt from grants.host_state where host = ${mock.host(0)}`;
    assert.ok(hs.n >= 3 && hs.robots_txt !== null, "host_state persisted (robots cached, request counters)");
    const runs = await db.sql`select status, planned, fetched, not_modified, changed, errors, elapsed_ms, stats from grants.refresh_runs order by started_at`;
    assert.deepEqual(runs.map((r) => r.status), ["ok", "ok"]);
    assert.ok(runs[0].stats[mock.host(0)].requests >= 2);
  });

  test("deadline move: kind=deadline, spec-style summary, new documents, next_deadline set only for fixed-deadline cycles", async () => {
    let v = 1;
    const body = () => (v === 1 ? `Call text. Deadline: ${SOON.long}. Awards up to $100,000.` : `Call text. Deadline: ${SOON2.long}. Awards up to $100,000. <a href="/g1.pdf">Guidelines</a> <a href="/g2.pdf">Template</a>`);
    for (const i of [0, 1, 2]) mock.route(i, "/c", () => html(body()));
    const fixed = await addFunder(db.sql, { url: mock.url(0, "/c"), cycle: "fixed_deadline" });
    const rolling = await addFunder(db.sql, { url: mock.url(1, "/c"), cycle: "rolling" });
    const invite = await addFunder(db.sql, { url: mock.url(2, "/c"), cycle: "invite_only" });
    await run();
    assert.equal((await funder(rolling)).next_deadline, null);
    v = 2;
    await makeDue();
    const r = await run();
    assert.equal(r.stats.changed, 3);
    const [s] = await db.sql`select change_kind, summary, diff from grants.snapshots where funder_id = ${fixed} order by id desc limit 1`;
    assert.equal(s.change_kind, "deadline");
    assert.equal(s.summary, `New deadline ${SOON2.iso} (was ${SOON.iso}); 2 new documents`);
    assert.deepEqual(s.diff.deadline, { from: SOON.iso, to: SOON2.iso });
    assert.equal(s.diff.docs_added.length, 2);
    assert.equal((await funder(fixed)).next_deadline.toISOString().slice(0, 10), SOON2.iso);
    for (const id of [rolling, invite]) assert.equal((await funder(id)).next_deadline, null, "never for rolling/invite_only");
    assert.equal((await funder(fixed)).award_max_usd, null, "award_* is never written automatically");
  });

  test("amount change without deadline change is kind=amount; past deadlines never become next_deadline", async () => {
    let v = 1;
    mock.route(0, "/a", () => html(v === 1 ? "Deadline: March 15, 2020. Awards up to $100,000." : "Deadline: March 15, 2020. Awards up to $250,000."));
    const id = await addFunder(db.sql, { url: mock.url(0, "/a") });
    await run();
    v = 2;
    await makeDue();
    await run();
    const [s] = await db.sql`select change_kind, diff from grants.snapshots where funder_id = ${id} order by id desc limit 1`;
    assert.equal(s.change_kind, "amount");
    assert.deepEqual(s.diff.amount, { from: 100000, to: 250000, currency: "USD" });
    assert.equal((await funder(id)).next_deadline, null);
  });

  test("PDF: hash of the bytes only, no text, no links; change in bytes is detected", async () => {
    let bytes = Buffer.from("%PDF-1.4 first");
    mock.route(0, "/call.pdf", () => ({ headers: { "content-type": "application/pdf" }, body: bytes }));
    const id = await addFunder(db.sql, { url: mock.url(0, "/call.pdf") });
    await run();
    const f1 = await funder(id);
    assert.equal(f1.last_text, "");
    assert.equal(f1.last_links.length, 0);
    assert.equal(f1.content_hash.length, 64);
    bytes = Buffer.from("%PDF-1.4 second");
    await makeDue();
    await run();
    assert.notEqual((await funder(id)).content_hash, f1.content_hash);
    assert.equal(await count("snapshots"), 2);
  });
});

describe("failure handling", () => {
  test("robots Disallow: robots_blocked, zero content requests, flagged on the funder", async () => {
    mock.route(0, "/robots.txt", { body: "User-agent: *\nDisallow: /private\n" });
    const id = await addFunder(db.sql, { url: mock.url(0, "/private/grants") });
    const r = await run();
    assert.equal(r.stats.robots_skipped, 1);
    assert.equal(r.stats.errors, 0);
    assert.equal(mock.contentHits(0).length, 0);
    const f = await funder(id);
    assert.equal(f.robots_blocked, true);
    assert.equal(f.consecutive_failures, 1);
  });

  test("403 -> bot_protected and 401 -> login_required, one request each, backed off", async () => {
    mock.route(0, "/f", { status: 403 });
    mock.route(1, "/l", { status: 401 });
    const a = await addFunder(db.sql, { url: mock.url(0, "/f") });
    const b = await addFunder(db.sql, { url: mock.url(1, "/l") });
    const r = await run();
    assert.equal(r.stats.errors, 2);
    assert.equal(mock.contentHits(0).length, 1);
    assert.equal(mock.contentHits(1).length, 1);
    assert.equal((await funder(a)).fetchability, "bot_protected");
    assert.equal((await funder(b)).fetchability, "login_required");
    const [x] = await db.sql`select extract(epoch from next_check_at - now())::int s from grants.funders where id = ${a}`;
    assert.ok(x.s > 5 * 3600, "SQL default backoff (6h)");
    assert.equal(r.remaining_due, 0);
  });

  test("429 storm: 3 tries, host cooldown persisted, siblings finished as errors without requests, next invocation backs off", async () => {
    for (const p of ["/a", "/b", "/c"]) mock.route(0, p, { status: 429 });
    const ids = await Promise.all(["/a", "/b", "/c"].map((p) => addFunder(db.sql, { url: mock.url(0, p) })));
    const r = await run();
    assert.equal(mock.contentHits(0).length, 3, "only the first source was tried (3 tries)");
    assert.equal(r.stats.errors, 3);
    assert.ok(r.stats.throttled >= 3);
    const [hs] = await db.sql`select extract(epoch from cooldown_until - now())::int s, consecutive_throttles c, throttles_total::int t from grants.host_state where host = ${mock.host(0)}`;
    assert.ok(hs.c === 3 && hs.t === 3 && hs.s > 0);
    for (const id of ids) {
      const f = await funder(id);
      assert.ok(f.cooldown_until > new Date() && f.consecutive_failures === 1 && f.lease_run === null);
    }
    assert.equal(r.remaining_due, 0, "cooling sources are not 'due': self-chaining cannot spin");

    // an invocation that starts while the host is cooling does not touch it and does not count a failure
    await db.sql`update grants.funders set next_check_at = now(), cooldown_until = null`;
    const before = mock.hits.length;
    const r2 = await run();
    assert.equal(mock.hits.length, before);
    assert.deepEqual([r2.stats.errors, r2.stats.fetched], [0, 0]);
    for (const id of ids) {
      const f = await funder(id);
      assert.ok(f.cooldown_until > new Date() && f.consecutive_failures === 1 && f.lease_run === null);
    }
  });

  test("an unexpected failure while recording still releases leases and finishes the run record", async () => {
    mock.route(0, "/p", html("x"));
    const id = await addFunder(db.sql, { url: mock.url(0, "/p") });
    const store = { ...makeStore(db.sql), apply: () => Promise.reject(new Error("db down")) };
    await assert.rejects(runShard({ store, clock: scaledClock(K), fetchImpl: fetch, env: ENV }, BASE), /db down/);
    assert.equal((await funder(id)).lease_run, null);
    const [r] = await db.sql`select finished_at from grants.refresh_runs`;
    assert.ok(r.finished_at);
  });
});

describe("budget, sharding, leases", () => {
  test("budget exit (5s): returns before budget+slack, releases unprocessed leases, remaining_due > 0, chain flagged", async () => {
    const ids: string[] = [];
    for (let i = 0; i < 5; i++) {
      mock.route(0, `/s${i}`, { ...html(`slow ${i}`), delayMs: 1200 });
      ids.push(await addFunder(db.sql, { url: mock.url(0, `/s${i}`) }));
    }
    const t0 = Date.now();
    const r = await run({ budget_ms: 5000 }, { clock: realClock, canChain: true });
    const took = Date.now() - t0;
    console.log(`# budget exit: ${took}ms for budget 5000ms; fetched ${r.stats.fetched}/5, remaining_due ${r.remaining_due}`);
    assert.ok(took < 5000 + 1500, `took ${took}`);
    assert.ok(r.stats.fetched >= 1 && r.stats.fetched < 5);
    assert.ok(r.remaining_due > 0 && r.stats.chained);
    assert.equal(r.remaining_due, 5 - r.stats.fetched);
    const [leased] = await db.sql`select count(*)::int n from grants.funders where lease_run is not null or lease_until is not null`;
    assert.equal(leased.n, 0);
    assert.equal(await count("snapshots"), r.stats.fetched);
    assert.equal(r.stats.planned, 5);
    const [row] = await db.sql`select chained, finished_at from grants.refresh_runs`;
    assert.ok(row.chained && row.finished_at);
  });

  test("chain is not flagged at depth 6", async () => {
    for (let i = 0; i < 3; i++) await addFunder(db.sql, { url: mock.url(i, "/p") });
    const r = await run({ max_sources: 1, chain_depth: 6 }, { canChain: true });
    assert.equal(r.remaining_due, 2);
    assert.equal(r.stats.chained, false);
  });

  test("shards=4: union of the four runs covers every source exactly once, no source in two shards", async () => {
    const urls: string[] = [];
    for (let h = 0; h < 8; h++) for (let p = 0; p < 3; p++) urls.push(mock.url(h, `/s${p}`));
    for (const u of urls) await addFunder(db.sql, { url: u });
    const processed: string[][] = [];
    for (let s = 0; s < 4; s++) {
      const r = await run({ shard: s, shards: 4 });
      processed.push(r.results.map((x) => x.id));
      assert.equal(r.remaining_due, 0);
    }
    const all = processed.flat();
    assert.equal(all.length, 24);
    assert.equal(new Set(all).size, 24);
    for (const u of urls) assert.equal(mock.hits.filter((h) => `http://${h.host}${h.path}` === u).length, 1, u);
    const rows = await db.sql`select f.shard, r.shard as run_shard from grants.snapshots s join grants.funders f on f.id = s.funder_id join grants.refresh_runs r on r.id = s.run_id`;
    assert.equal(rows.length, 24);
    assert.ok(rows.every((x) => x.shard % 4 === x.run_shard));
    // hosts are never split across shards
    const byHost = await db.sql`select split_part(url_norm, '/', 1) h, count(distinct shard % 4)::int n from grants.funders group by 1`;
    assert.ok(byHost.every((x) => x.n === 1));
  });

  test("two concurrent invocations of the same shard never process the same source", async () => {
    for (let h = 0; h < 10; h++) for (let p = 0; p < 2; p++) await addFunder(db.sql, { url: mock.url(h, `/c${p}`) });
    const [r1, r2] = await Promise.all([run({ max_sources: 12 }), run({ max_sources: 12 })]);
    const a = r1.results.map((x) => x.id), b = r2.results.map((x) => x.id);
    assert.equal(a.length + b.length, 20);
    assert.equal(new Set([...a, ...b]).size, 20, "disjoint");
    assert.ok(a.length > 0 && b.length > 0);
    assert.equal(mock.hits.filter((h) => h.path.startsWith("/c")).length, 20, "every page fetched exactly once");
    for (const h of mock.maxInflight.values()) assert.ok(h <= 2); // robots+page of different runs may overlap only across the two runs
  });

  test("a run killed mid-way leaves leases that expire, then the next run resumes", async () => {
    for (let i = 0; i < 4; i++) await addFunder(db.sql, { url: mock.url(i, "/k") });
    const [dead] = await db.sql`select grants.start_run('dead', 0, 1, null, 1000) as id`;
    const claimed = (await db.sql`select grants.claim_sources(${dead.id}::uuid, 0, 1, 12, 2) as r`)[0].r;
    assert.equal(claimed.length, 4); // the dead run took everything and never reported back
    const r1 = await run();
    assert.equal(r1.stats.planned, 0, "leases still valid: nothing to take");
    await new Promise((ok) => setTimeout(ok, 2300));
    const r2 = await run();
    assert.equal(r2.stats.planned, 4);
    assert.equal(r2.stats.fetched, 4);
    assert.equal(await count("snapshots"), 4);
  });
});

describe("dry_run and only_ids", () => {
  test("dry_run fetches and reports but writes only the run record", async () => {
    mock.route(0, "/d", html(`Dry page. Deadline: ${SOON2.long}.`));
    mock.route(1, "/d", html("Other"));
    const a = await addFunder(db.sql, { url: mock.url(0, "/d") });
    await addFunder(db.sql, { url: mock.url(1, "/d") });
    const r = await run({ dry_run: true, only_ids: [a] });
    assert.equal(r.results.length, 1);
    assert.deepEqual([r.results[0].kind, r.results[0].change, r.results[0].next_deadline], ["ok", "initial", SOON2.iso]);
    assert.ok((r.results[0].text_len ?? 0) > 0, "probe reports the extracted text length");
    assert.equal(mock.contentHits(0).length, 1);
    assert.equal(mock.contentHits(1).length, 0);
    const f = await funder(a);
    assert.deepEqual([f.content_hash, f.lease_run, f.last_checked_at, f.next_deadline], [null, null, null, null]);
    assert.equal(await count("snapshots"), 0);
    assert.equal(await count("host_state"), 0);
    assert.equal((await db.sql`select count(*)::int n from grants.refresh_runs where finished_at is not null`)[0].n, 1);
    // dry_run without only_ids also leases nothing
    await run({ dry_run: true });
    assert.equal((await db.sql`select count(*)::int n from grants.funders where lease_run is not null`)[0].n, 0);
  });

  test("only_ids processes exactly the named sources, even when not yet due", async () => {
    const a = await addFunder(db.sql, { url: mock.url(0, "/o") });
    const b = await addFunder(db.sql, { url: mock.url(1, "/o") });
    await db.sql`update grants.funders set next_check_at = now() + interval '1 day' where id = ${a}`;
    const r = await run({ only_ids: [a] });
    assert.equal(r.stats.fetched, 1);
    assert.equal((await funder(a)).last_status, 200);
    assert.equal((await funder(b)).last_checked_at, null);
  });
});

describe("store id-list queries (claim/peek/release/defer with several uuids)", () => {
  test("claim + peek with only_ids of 2 ids, release by id list, defer sets cooldown and drops the lease", async () => {
    const [a, b, c] = [await addFunder(db.sql, { url: mock.url(0, "/s") }), await addFunder(db.sql, { url: mock.url(1, "/s") }), await addFunder(db.sql, { url: mock.url(2, "/s") })];
    const store = makeStore(db.sql);
    const req = { ...BASE, only_ids: [a, b] };
    assert.deepEqual((await store.peek(req)).map((s) => s.id).sort(), [a, b].sort());
    const runId = await store.startRun(req);
    const claimed = await store.claim(runId, req, 60);
    assert.deepEqual(claimed.map((s) => s.id).sort(), [a, b].sort());
    assert.equal((await funder(c)).lease_run, null);
    assert.equal((await funder(a)).lease_run, runId);
    await store.release(runId, [a, b]);
    assert.equal((await db.sql`select count(*)::int n from grants.funders where lease_run is not null`)[0].n, 0);
    // defer: lease released and cooldown_until pushed out for both ids; no failure counted
    const again = await store.claim(runId, req, 60);
    assert.equal(again.length, 2);
    const until = Date.now() + 600_000;
    await store.defer(runId, [a, b], until);
    for (const id of [a, b]) {
      const f = await funder(id);
      assert.equal(f.lease_run, null);
      assert.equal(f.consecutive_failures, 0);
      assert.ok(Math.abs(f.cooldown_until.getTime() - until) < 2000, "cooldown_until set");
    }
    assert.equal((await funder(c)).cooldown_until, null);
    // release with no list releases everything the run holds
    await store.claim(runId, { ...BASE, only_ids: [a, b, c] }, 60);
    await store.release(runId);
    assert.equal((await db.sql`select count(*)::int n from grants.funders where lease_run is not null`)[0].n, 0);
  });

  test("engine run with two only_ids processes both and a host already cooling is deferred (no request, no failure)", async () => {
    const a = await addFunder(db.sql, { url: mock.url(3, "/s") });
    const b = await addFunder(db.sql, { url: mock.url(4, "/s") });
    const r = await run({ only_ids: [a, b] });
    assert.equal(r.stats.fetched, 2);
    await db.sql`update grants.host_state set cooldown_until = now() + interval '10 minutes' where host = ${mock.host(3)}`;
    mock.hits = [];
    const r2 = await run({ only_ids: [a, b] });
    assert.equal(mock.hitsFor(3).length, 0);
    assert.equal((await funder(a)).consecutive_failures, 0);
    assert.equal((await funder(a)).lease_run, null);
    assert.ok((await funder(a)).cooldown_until > new Date());
    assert.equal(r2.stats.fetched, 1);
  });
});
