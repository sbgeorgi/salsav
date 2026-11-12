import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, test } from "node:test";
import { fetchSource } from "../adapters/index.ts";
import { callsSection, extractList, finalize, matchesFilter, plainText, selfCycle } from "../adapters/collect.ts";
import { allDates } from "../extract.ts";
import { DEFAULT_POLITENESS, Politeness } from "../politeness.ts";
import type { Opportunity, Source } from "../types.ts";
import { realClock } from "../types.ts";

const TODAY = "2027-01-10";
const BASE = "https://funder.example.org/calls/";

test("item mode reads title, link, deadline and description with selectors", () => {
  const html = `<ul>
    <li class="call"><h3>Climate Adaptation Grants</h3><a href="/calls/climate">Read more</a><span class="due">Deadline: March 15, 2027</span></li>
    <li class="call"><h3>Seed Fund</h3><a href="/calls/seed">More</a><span class="due">Deadline: February 1, 2026</span></li>
  </ul>`;
  const out = extractList(html, BASE, { item: "li.call", title: "h3", link: "a", date: ".due" }, TODAY);
  assert.equal(out.length, 2);
  assert.equal(out[0].title, "Climate Adaptation Grants");
  assert.equal(out[0].url, "https://funder.example.org/calls/climate");
  assert.equal(out[0].external_id, "https://funder.example.org/calls/climate");
  assert.equal(out[0].deadline, "2027-03-15");
  assert.equal(out[1].deadline, "2026-02-01");
  assert.ok(out[0].description?.includes("Climate Adaptation Grants"));
});

test("anchor mode needs match and honours skip", () => {
  const html = `<div>
    <p>Home page text here</p>
    <ul>
      <li><a href="/calls/soil-carbon-2027">Soil carbon call for proposals</a></li>
      <li><a href="/calls/soil-carbon-archive">Soil carbon call archive</a></li>
      <li><a href="/about/team">Our team and staff</a></li>
    </ul>
  </div>`;
  assert.deepEqual(extractList(html, BASE, {}, TODAY), []);
  const out = extractList(html, BASE, { match: "call", skip: "archive" }, TODAY);
  assert.equal(out.length, 1);
  assert.equal(out[0].title, "Soil carbon call for proposals");
  assert.equal(out[0].url, "https://funder.example.org/calls/soil-carbon-2027");
});

test("relative URLs resolve, utm_* and hash are dropped, trailing slash left out of external_id", () => {
  const html = `<ul><li><a href="../rfp/water-2027/?utm_source=x&amp;id=7&amp;utm_medium=y#top">Water innovation RFP</a></li></ul>`;
  const out = extractList(html, "https://funder.example.org/calls/index.html", { match: "rfp" }, TODAY);
  assert.equal(out.length, 1);
  assert.equal(out[0].url, "https://funder.example.org/rfp/water-2027/?id=7");
  assert.equal(out[0].external_id, "https://funder.example.org/rfp/water-2027?id=7");
});

test("non-http links are treated as no link", () => {
  const html = `<ul><li class="c"><h3>Mail only call</h3><a href="mailto:grants@example.org">mail us</a></li></ul>`;
  const out = extractList(html, BASE, { item: "li.c" }, TODAY);
  assert.equal(out[0].url, null);
  assert.equal(out[0].external_id, "t:mail only call");
});

test("nearest future date wins, else the latest past date", () => {
  const future = `<ul><li><a href="/a">Round alpha call</a><p>Opened Jan 5, 2026. Next cutoff Feb 1, 2027 and Mar 15, 2027.</p></li></ul>`;
  assert.equal(extractList(future, BASE, { match: "call" }, TODAY)[0].deadline, "2027-02-01");
  const past = `<ul><li><a href="/b">Round beta call</a><p>Closed rounds on 2026-03-01 and 2026-06-01.</p></li></ul>`;
  assert.equal(extractList(past, BASE, { match: "call" }, TODAY)[0].deadline, "2026-06-01");
});

test("date_label counts only labeled dates", () => {
  const html = `<ul><li class="c"><h3>Gamma grants</h3><p>Opening date: 2027-02-01. Deadline: 2027-05-01</p></li></ul>`;
  assert.equal(extractList(html, BASE, { item: "li.c" }, TODAY)[0].deadline, "2027-02-01");
  assert.equal(extractList(html, BASE, { item: "li.c", date_label: true }, TODAY)[0].deadline, "2027-05-01");
});

test("closed regex marks status closed; otherwise status stays undefined", () => {
  const html = `<ul>
    <li class="c"><h3>Delta call one</h3><p>Status: Closed. Deadline 2026-12-01</p></li>
    <li class="c"><h3>Delta call two</h3><p>Deadline 2027-04-01</p></li>
  </ul>`;
  const out = extractList(html, BASE, { item: "li.c", closed: "status:\\s*closed" }, TODAY);
  assert.equal(out[0].status, "closed");
  assert.equal(out[1].status, undefined);
});

test("USD amount of at least 1000 becomes award_max_usd; smaller or non-USD does not", () => {
  const html = `<ul>
    <li class="c"><h3>Big award call</h3><p>Awards up to $250,000 per project. Deadline March 1, 2027.</p></li>
    <li class="c"><h3>Small award call</h3><p>Stipends of $500 each. Deadline March 1, 2027.</p></li>
    <li class="c"><h3>Euro award call</h3><p>Up to €400,000 per project. Deadline March 1, 2027.</p></li>
  </ul>`;
  const out = extractList(html, BASE, { item: "li.c" }, TODAY);
  assert.equal(out[0].award_max_usd, 250000);
  assert.equal(out[1].award_max_usd, undefined);
  assert.equal(out[2].award_max_usd, undefined);
  assert.equal(extractList(html, BASE, { item: "li.c", amount: false }, TODAY)[0].award_max_usd, undefined);
});

test("item without a link gets a t: external_id", () => {
  const html = `<ul><li class="c"><h3>Walk-in Program Call</h3><p>Deadline 2027-03-01</p></li></ul>`;
  const out = extractList(html, BASE, { item: "li.c" }, TODAY);
  assert.equal(out[0].external_id, "t:walk-in program call");
  assert.equal(out[0].url, null);
});

test("duplicate external_id keeps the first occurrence and short titles are skipped", () => {
  const html = `<ul>
    <li class="c"><h3>First wording call</h3><a href="/same">one</a></li>
    <li class="c"><h3>Second wording call</h3><a href="/same/">two</a></li>
    <li class="c"><h3>Abc</h3><a href="/short">short</a></li>
  </ul>`;
  const out = extractList(html, BASE, { item: "li.c" }, TODAY);
  assert.equal(out.length, 1);
  assert.equal(out[0].title, "First wording call");
});

test("selfCycle: labeled future deadline gives one cycle item, otherwise none", () => {
  const src = { name: "Funder X", url: "https://funder.example.org/program" };
  const yes = selfCycle("Applications due March 15, 2027. Webinar on Feb 2, 2027.", src, {}, TODAY);
  assert.deepEqual(yes, [
    { external_id: "cycle:2027", title: "Funder X", url: src.url, deadline: "2027-03-15", status: "open" },
  ]);
  assert.equal(selfCycle("Webinar on March 15, 2027", src, {}, TODAY).length, 0);
  assert.equal(selfCycle("Deadline: March 15, 2026", src, { title: "Cycle B" }, TODAY).length, 0);
  assert.equal(selfCycle("Deadline: March 15, 2027", src, { title: "Cycle B" }, TODAY)[0].title, "Cycle B");
});

const OPP = (over: Partial<Opportunity>): Opportunity => ({ external_id: "x", title: "Soil carbon call", description: "", ...over });

test("matchesFilter: any, all, none, fields and re:", () => {
  const o = OPP({ title: "Soil carbon call", description: "for farms in Iowa" });
  assert.equal(matchesFilter(o, undefined), true);
  assert.equal(matchesFilter(o, { any: ["SOIL", "water"] }), true);
  assert.equal(matchesFilter(o, { any: ["water"] }), false);
  assert.equal(matchesFilter(o, { all: ["soil", "iowa"] }), true);
  assert.equal(matchesFilter(o, { all: ["soil", "texas"] }), false);
  assert.equal(matchesFilter(o, { none: ["iowa"] }), false);
  assert.equal(matchesFilter(o, { any: ["iowa"], fields: "title" }), false);
  assert.equal(matchesFilter(o, { any: ["re:^soil\\s+carbon"] }), true);
  assert.equal(matchesFilter(o, { any: ["re:^carbon"] }), false);
});

test("finalize: nativeStatus false closes past deadlines, nativeStatus true leaves status untouched", () => {
  const input = [
    OPP({ external_id: "a", title: "Past call", deadline: "2026-12-01" }),
    OPP({ external_id: "b", title: "Future call", deadline: "2027-06-01" }),
    OPP({ external_id: "c", title: "Native past", deadline: "2026-12-01" }),
  ];
  const off = finalize(input, {}, TODAY, false);
  assert.equal(off.find((o) => o.external_id === "a")?.status, "closed");
  assert.equal(off.find((o) => o.external_id === "b")?.status, "open");
  const on = finalize(input, {}, TODAY, true);
  assert.equal(on.find((o) => o.external_id === "a")?.status, undefined);
  const forecast = finalize([OPP({ external_id: "f", status: "forecasted", deadline: "2027-08-01" })], {}, TODAY, false);
  assert.equal(forecast[0].status, "forecasted");
});

test("finalize dedupes, orders open by deadline then closed descending, caps", () => {
  const input = [
    OPP({ external_id: "c1", title: "Closed early", deadline: "2026-01-01", status: "closed" }),
    OPP({ external_id: "o2", title: "Open late", deadline: "2027-09-01", status: "open" }),
    OPP({ external_id: "o1", title: "Open soon", deadline: "2027-02-01", status: "open" }),
    OPP({ external_id: "u", title: "No date", deadline: null, status: "open" }),
    OPP({ external_id: "c2", title: "Closed later", deadline: "2026-06-01", status: "closed" }),
    OPP({ external_id: "o1", title: "Duplicate of soon", deadline: "2027-02-01", status: "open" }),
  ];
  const out = finalize(input, {}, TODAY, true);
  assert.deepEqual(out.map((o) => o.external_id), ["o1", "o2", "u", "c2", "c1"]);
  const many = Array.from({ length: 150 }, (_, i) => OPP({ external_id: `k${i}`, title: `Call ${i}`, deadline: "2027-02-01" }));
  assert.equal(finalize(many, {}, TODAY, true).length, 40);
  assert.equal(finalize(many, { max_items: 500 }, TODAY, true).length, 100);
  assert.equal(finalize(many, { max_items: 3 }, TODAY, true).length, 3);
});

test("finalize applies cfg.filter and cleans HTML and entities from title and description", () => {
  const input = [
    OPP({ external_id: "e", title: "Ben &amp; Jerry&#39;s <b>Grant</b>   Call", description: "<p>Soil&nbsp;&amp; water</p>\n\nfor  farms", deadline: "2027-02-01" }),
    OPP({ external_id: "f", title: "Unrelated call", description: "", deadline: "2027-02-01" }),
  ];
  const out = finalize(input, { filter: { any: ["grant"] } }, TODAY, true);
  assert.equal(out.length, 1);
  assert.equal(out[0].title, "Ben & Jerry's Grant Call");
  assert.equal(out[0].description, "Soil & water for farms");
  assert.equal(plainText("<script>x()</script>A &lt;b&gt; c"), "A <b> c");
});

test("callsSection formats lines and is empty without items", () => {
  assert.equal(callsSection([]), "");
  const text = callsSection([
    OPP({ title: "Alpha | call", deadline: "2027-02-01", status: "open" }),
    OPP({ title: "Beta call", deadline: null }),
  ]);
  assert.equal(text, "Calls found:\n- Alpha / call | 2027-02-01 | open\n- Beta call | no date | open");
});

test("invalid regexes and selectors never throw", () => {
  const html = `<ul><li class="c"><h3>Broken config call</h3><a href="/x">link</a></li></ul>`;
  assert.deepEqual(extractList(html, BASE, { match: "([" }, TODAY), []);
  assert.deepEqual(extractList(html, BASE, { item: "<<bad" }, TODAY), []);
  assert.equal(extractList(html, BASE, { item: "li.c", skip: "([", closed: "([" }, TODAY).length, 1);
  assert.equal(extractList(html, BASE, { item: "li.c", title: "[[", date: "::", link: "@@" }, TODAY).length, 1);
  assert.equal(matchesFilter(OPP({ title: "x call" }), { any: ["re:(["] }), false);
  assert.equal(extractList(html, BASE, null as never, TODAY).length, 0);
  assert.deepEqual(finalize(null as never, null as never, TODAY, true), []);
  assert.equal(selfCycle("due 2027-02-01", { name: "n", url: "u" }, {}, "not-a-date").length, 0);
});

test("allDates returns every recognizable date in order, without overlaps", () => {
  assert.deepEqual(
    allDates("Opens 2026-12-01, closes 15 March 2027, or Feb 3, 2027; review 3/4/2027 and Feb 31, 2027."),
    ["2026-12-01", "2027-03-15", "2027-02-03", "2027-03-04"],
  );
  assert.deepEqual(allDates("no dates here"), []);
});

test("real sample: SARE grants listing (western.sare.org/grants/, fetched 2026-11-12)", () => {
  const html = readFileSync(new URL("./fixtures/sare-grants.html", import.meta.url), "utf8");
  const cfg = { item: "li.listing", title: "h3", date: ".grant-deadline", closed: "closed:" };
  const raw = extractList(html, "https://western.sare.org/grants/", cfg, "2026-11-12");
  assert.equal(raw.length, 7);
  for (const o of raw) {
    assert.ok(o.url?.startsWith("https://western.sare.org/"), `url ${o.url}`);
    assert.equal(o.status, "closed");
  }
  const byTitle = Object.fromEntries(raw.map((o) => [o.title, o]));
  assert.equal(byTitle["Graduate Student"].deadline, "2026-10-28");
  assert.equal(byTitle["Research and Education Pre-Proposal"].deadline, "2026-06-15");
  const done = finalize(raw, {}, "2026-11-12", false);
  assert.equal(done.length, 7);
  assert.equal(done[0].deadline, "2026-10-28");
  assert.match(callsSection(done), /^Calls found:\n- Graduate Student \| 2026-10-28 \| closed/);
});

// ---- wiring: fetchSource with a stubbed fetch (no network, no database) ----

type Stub = { status?: number; body?: string; type?: string; location?: string };

function harness(routes: Record<string, Stub>) {
  const calls: string[] = [];
  const fetchImpl = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    calls.push(`${init?.method ?? "GET"} ${url}`);
    const r = routes[url] ?? { status: 404, body: "" };
    const status = r.status ?? 200;
    return new Response(status === 304 ? null : (r.body ?? ""), { status, headers: { "content-type": r.type ?? "text/html; charset=utf-8", ...(r.location ? { location: r.location } : {}) } });
  }) as unknown as typeof fetch;
  const pol = new Politeness(realClock, { ...DEFAULT_POLITENESS, minIntervalMs: 0, jitterMs: 0 });
  const c = {
    d: { pol, fetchImpl, env: { allowLocal: false }, deadline: Date.now() + 60_000, requestTimeoutMs: 5000 },
    today: "2027-01-10",
    now: new Date("2027-01-10T12:00:00Z"),
  };
  return { c, calls };
}

const PROGRAM = "https://funder.example.org/program";
const LIST = "https://funder.example.org/calls/";
const LIST_HTML = `<html><body><h1>Calls</h1><ul>
<li class="call"><h3>Climate Adaptation Grants</h3><a href="/calls/climate">Read more</a><span class="due">Deadline: March 15, 2027</span></li>
</ul></body></html>`;
const PROGRAM_HTML = "<html><body><h1>Program</h1><p>Our program funds climate work across the region.</p></body></html>";

function src(over: Partial<Source> = {}): Source {
  return {
    id: "s1", name: "Funder Program", url: PROGRAM, feed_url: null, adapter: "html", adapter_config: {}, etag: null, last_modified: null,
    content_hash: null, fetchability: "easy", consecutive_failures: 0, cycle: "rolling", next_deadline: null, page_type: "", shard: 0, ...over,
  };
}

describe("wiring: fetchSource", () => {
  test("html list on the funder page: items, Calls found section, content hash", async () => {
    const cfg = { list: { item: "li.call", title: "h3", link: "a", date: ".due" } };
    const { c } = harness({ [PROGRAM]: { body: LIST_HTML } });
    const r = await fetchSource(c, src({ adapter_config: cfg }));
    assert.equal(r?.kind, "ok");
    assert.equal(r.opportunities?.length, 1);
    assert.equal(r.opportunities?.[0].deadline, "2027-03-15");
    assert.equal(r.opportunities?.[0].status, "open");
    assert.match(r.text ?? "", /Calls found:\n- Climate Adaptation Grants \| 2027-03-15 \| open/);
    assert.equal(r.isHtml, true);
    assert.match(r.content_hash ?? "", /^[0-9a-f]{64}$/);
  });

  test("html self: one open cycle item from the labeled deadline", async () => {
    const { c } = harness({ [PROGRAM]: { body: "<html><body><h1>Climate Program</h1><p>Deadline: March 15, 2027</p></body></html>" } });
    const r = await fetchSource(c, src({ adapter_config: { self: { title: "Climate Program" } } }));
    assert.equal(r?.kind, "ok");
    assert.deepEqual(r.opportunities?.map((o) => [o.external_id, o.title, o.deadline, o.status]), [["cycle:2027", "Climate Program", "2027-03-15", "open"]]);
    assert.match(r.text ?? "", /Calls found:/);
  });

  test("list.url: listing is the primary fetch; a failing funder page keeps the listing text", async () => {
    const { c, calls } = harness({ [LIST]: { body: LIST_HTML }, [PROGRAM]: { status: 500 } });
    const r = await fetchSource(c, src({ adapter_config: { list: { url: LIST, item: "li.call", title: "h3", link: "a", date: ".due" } } }));
    assert.equal(r?.kind, "ok");
    assert.equal(r.opportunities?.length, 1);
    assert.match(r.text ?? "", /Climate Adaptation Grants/);
    assert.ok(calls.indexOf(`GET ${LIST}`) >= 0 && calls.indexOf(`GET ${LIST}`) < calls.indexOf(`GET ${PROGRAM}`));
  });

  test("list.url answers 304: not_modified and the funder page is not fetched", async () => {
    const { c, calls } = harness({ [LIST]: { status: 304 }, [PROGRAM]: { body: PROGRAM_HTML } });
    const r = await fetchSource(c, src({ etag: '"abc"', adapter_config: { list: { url: LIST, item: "li.call" } } }));
    assert.equal(r?.kind, "not_modified");
    assert.ok(!calls.includes(`GET ${PROGRAM}`));
  });

  test("list.url failing is the source's failure", async () => {
    const { c, calls } = harness({ [LIST]: { status: 404 }, [PROGRAM]: { body: PROGRAM_HTML } });
    const r = await fetchSource(c, src({ adapter_config: { list: { url: LIST, item: "li.call" } } }));
    assert.equal(r?.kind, "error");
    assert.equal(r.http_status, 404);
    assert.ok(!calls.includes(`GET ${PROGRAM}`));
  });

  const FEED = "https://funder.example.org/feed.xml";
  const RSS = `<?xml version="1.0"?><rss version="2.0"><channel><title>Funder</title>
<item><title>Soil Carbon Call for Proposals</title><link>https://funder.example.org/rfp/soil</link><guid>rfp-soil</guid><description>Soil projects.</description></item>
<item><title>Annual newsletter</title><link>https://funder.example.org/news/1</link><guid>news-1</guid><description>Read our news.</description></item>
</channel></rss>`;

  test("rss: filter keeps matching items only", async () => {
    const { c } = harness({ [FEED]: { body: RSS, type: "application/rss+xml" } });
    const r = await fetchSource(c, src({ adapter: "rss", feed_url: FEED, adapter_config: { filter: { any: ["call for proposals"], fields: "title" } } }));
    assert.equal(r?.kind, "ok");
    assert.deepEqual(r.opportunities?.map((o) => o.external_id), ["rfp-soil"]);
    assert.equal(r.opportunities?.[0].status, "open");
  });

  const API = "https://api.funder.example.org/calls.json";
  const API_JSON = JSON.stringify([{ id: "c1", title: "Water Call", deadline: "2027-06-01", url: "https://funder.example.org/c1" }]);

  test("also_page: API items plus funder page text and a Calls found section", async () => {
    const { c, calls } = harness({ [API]: { body: API_JSON, type: "application/json" }, [PROGRAM]: { body: PROGRAM_HTML } });
    const r = await fetchSource(c, src({ adapter: "json_api", adapter_config: { url: API, items_path: "$", map: { external_id: "id", title: "title", url: "url", deadline: "deadline" }, also_page: true } }));
    assert.equal(r?.kind, "ok");
    assert.equal(r.opportunities?.length, 1);
    assert.ok((r.text ?? "").startsWith("Program"));
    assert.match(r.text ?? "", /Calls found:\n- Water Call \| 2027-06-01 \| open/);
    assert.ok(calls.includes(`GET ${PROGRAM}`));
  });

  const SEARCH = "https://api.grants.gov/v1/api/search2";
  const DETAIL = "https://api.grants.gov/v1/api/fetchOpportunity";
  const SEARCH_JSON = JSON.stringify({ data: { oppHits: [{ id: 111, number: "USDA-X-1", title: "HSI Education Grants", openDate: "01/01/2027", closeDate: "06/01/2027", oppStatus: "posted", agency: "NIFA" }] } });
  const DETAIL_JSON = JSON.stringify({ data: { synopsis: { awardCeiling: "500000", awardFloor: "10000", synopsisDesc: "<p>Funds <b>soil</b> work.</p>" } } });
  const gg = (detail: boolean | number) => src({ adapter: "grants_gov", url: "https://www.nifa.usda.gov/x", adapter_config: { rows: 10, oppNum: "USDA-X-1", detail } });

  test("grants_gov detail: fills award range and description", async () => {
    const { c, calls } = harness({ [SEARCH]: { body: SEARCH_JSON, type: "application/json" }, [DETAIL]: { body: DETAIL_JSON, type: "application/json" } });
    const r = await fetchSource(c, gg(true));
    assert.equal(r?.kind, "ok");
    assert.equal(r.opportunities?.[0].award_max_usd, 500000);
    assert.equal(r.opportunities?.[0].award_min_usd, 10000);
    assert.equal(r.opportunities?.[0].description, "Funds soil work.");
    assert.ok(calls.includes(`POST ${DETAIL}`));
  });

  test("grants_gov detail failing: the search result still stands", async () => {
    const { c } = harness({ [SEARCH]: { body: SEARCH_JSON, type: "application/json" }, [DETAIL]: { status: 500 } });
    const r = await fetchSource(c, gg(true));
    assert.equal(r?.kind, "ok");
    assert.equal(r.opportunities?.length, 1);
    assert.equal(r.opportunities?.[0].award_max_usd ?? null, null);
  });

  test("a bad config returns kind error with a config: text and makes no request", async () => {
    const bad: Record<string, unknown>[] = [{ list: { item: "li[" } }, { list: { match: "(" } }, { list: "li.call" }, { list: { item: "li.call", closed: "[" } }, { filter: { any: ["re:("] } }, { self: { title: 5 } }];
    for (const cfg of bad) {
      const { c, calls } = harness({ [PROGRAM]: { body: PROGRAM_HTML } });
      const r = await fetchSource(c, src({ adapter_config: cfg }));
      assert.equal(r?.kind, "error", JSON.stringify(cfg));
      assert.ok(r.error?.startsWith("config: "), r.error);
      assert.equal(calls.length, 0);
    }
  });

  test("thin page: js_required when text is under 300 chars and HTML is 5000+ chars", async () => {
    const big = `<html><body><div data-app="${"a".repeat(6000)}"></div><p>Loading</p></body></html>`;
    const thin = await fetchSource(harness({ [PROGRAM]: { body: big } }).c, src());
    assert.equal(thin?.fetchability, "js_required");
    const small = await fetchSource(harness({ [PROGRAM]: { body: "<html><body><p>Loading</p></body></html>" } }).c, src());
    assert.equal(small?.fetchability, "easy");
    const full = await fetchSource(harness({ [PROGRAM]: { body: big.replace("Loading", "x ".repeat(200)) } }).c, src());
    assert.equal(full?.fetchability, "easy");
  });
});

// ---- radar v2 gap fixes: grants_gov sentinel, es/fr dates, deadline_regex, list.detail ----
import { grantsGov } from "../adapters/api.ts";
import { parseDate } from "../extract.ts";

test("grants_gov: a 2070+ closeDate is a rolling placeholder, not a deadline", () => {
  const sentinel = grantsGov.parse({ data: { oppHits: [{ number: "26-518", id: 363616, title: "CBET", oppStatus: "posted", closeDate: "10/05/2076" }] } });
  assert.equal(sentinel[0].deadline, null);
  assert.equal(sentinel[0].status, "open");
  const real = grantsGov.parse({ data: { oppHits: [{ number: "X-1", id: 1, title: "Real call", oppStatus: "posted", closeDate: "12/31/2026" }] } });
  assert.equal(real[0].deadline, "2026-12-31");
});

test("parseDate reads Spanish and French month names, rejects impossible days", () => {
  assert.equal(parseDate("8 mayo 2026"), "2026-05-08");
  assert.equal(parseDate("15 fevr. 2027"), "2027-02-15");
  assert.equal(parseDate("31 febrero 2027"), null);
  assert.equal(parseDate("12 marcha 2027"), null); // not a month word
  assert.equal(parseDate("March 15, 2027"), "2027-03-15");
});

test("self.deadline_regex captures a labelled phrase without due or deadline", async () => {
  const body = "<html><body><p>Next full proposals January 21, 2027.</p></body></html>";
  const cfg = { self: { deadline_regex: "full proposals\\s+((?:January|February|March|April|May|June|July|August|September|October|November|December) \\d{1,2}, \\d{4})" } };
  const hit = await fetchSource(harness({ [PROGRAM]: { body } }).c, src({ adapter: "html", url: PROGRAM, adapter_config: cfg }));
  assert.equal(hit?.kind, "ok");
  assert.equal(hit.opportunities?.length, 1);
  assert.equal(hit.opportunities[0].external_id, "cycle:2027");
  assert.equal(hit.opportunities[0].status, "open");
  const miss = await fetchSource(harness({ [PROGRAM]: { body: "<html><body><p>Nothing dated here.</p></body></html>" } }).c, src({ adapter: "html", url: PROGRAM, adapter_config: cfg }));
  assert.equal(miss?.opportunities?.length ?? 0, 0);
});

test("json_api.deadline_regex reads a deadline from the description and closes a past one", async () => {
  const json = JSON.stringify([{ id: "r1", title: "Round one call", desc: "Round 1 due: November 29, 2026" }]);
  const cfg = {
    url: "https://funder.example.org/api/calls", items_path: "$",
    map: { external_id: "id", title: "title", description: "desc" },
    deadline_regex: "(?:Round 1 due:)\\s*([A-Za-z]+ \\d{1,2}, \\d{4})",
  };
  const h = harness({ "https://funder.example.org/api/calls": { body: json, type: "application/json" } });
  h.c.today = "2026-12-01";
  const out = await fetchSource(h.c, src({ adapter: "json_api", url: "https://funder.example.org/api/calls", adapter_config: cfg }));
  assert.equal(out?.kind, "ok");
  assert.equal(out.opportunities[0].deadline, "2026-11-29");
  assert.equal(out.opportunities[0].status, "closed");
});

test("list.detail: follows same-host links (bounded), keeps items when a detail fails", async () => {
  const rows = (n: number) =>
    Array.from({ length: n }, (_, i) => `<li class="call"><h3>Call number ${i + 1}</h3><a href="/detail/${i + 1}">More</a></li>`).join("");
  const listing = `<html><body><ul>${rows(2)}<li class="call"><h3>Off host call</h3><a href="https://other.example.net/x">More</a></li></ul></body></html>`;
  const routes = {
    [LIST]: { body: listing },
    "https://funder.example.org/detail/1": { body: "<html><body><p>Proposals are due March 11, 2027</p></body></html>" },
    "https://funder.example.org/detail/2": { status: 404, body: "" },
  };
  const cfg = { list: { item: "li.call", title: "h3", link: "a", detail: { max: 5 } } };
  const h = harness(routes);
  const out = await fetchSource(h.c, src({ adapter: "html", url: LIST, adapter_config: cfg }));
  assert.equal(out?.kind, "ok");
  const byTitle = Object.fromEntries(out.opportunities.map((o: Opportunity) => [o.title, o]));
  assert.equal(byTitle["Call number 1"].deadline, "2027-03-11");
  assert.equal(byTitle["Call number 2"].deadline, null);
  assert.equal(byTitle["Off host call"].deadline, null);
  assert.equal(h.calls.filter((c) => c.includes("other.example.net")).length, 0);

  const many = Object.fromEntries(Array.from({ length: 7 }, (_, i) => [`https://funder.example.org/detail/${i + 1}`, { status: 404, body: "" }]));
  const h2 = harness({ [LIST]: { body: `<html><body><ul>${rows(7)}</ul></body></html>` }, ...many });
  await fetchSource(h2.c, src({ adapter: "html", url: LIST, adapter_config: cfg }));
  assert.equal(h2.calls.filter((c) => c.startsWith("GET https://funder.example.org/detail/")).length, 5);
});

// ---- review fixes: detail hop order, day/month order, nested quantifiers, same-host redirects, detail date rule ----
import { configError } from "../adapters/index.ts";
import { regexDeadline } from "../extract.ts";

test("list.detail: undated calls are visited before past-dated ones, so the hop cap is not spent on closed rounds", async () => {
  const old = (i: number) => `<li class="call"><h3>Old round ${i}</h3><a href="/detail/old${i}">More</a><span class="due">Deadline: June 1, 2026</span></li>`;
  const open = (i: number) => `<li class="call"><h3>Open call ${i}</h3><a href="/detail/open${i}">More</a></li>`;
  const listing = `<html><body><ul>${old(1)}${old(2)}${old(3)}${open(1)}${open(2)}</ul></body></html>`;
  const h = harness({
    [LIST]: { body: listing },
    "https://funder.example.org/detail/open1": { body: "<html><body><p>Full proposals due March 11, 2027</p></body></html>" },
    "https://funder.example.org/detail/open2": { body: "<html><body><p>Full proposals due April 2, 2027</p></body></html>" },
  });
  const out = await fetchSource(h.c, src({ adapter: "html", url: LIST, adapter_config: { list: { item: "li.call", title: "h3", link: "a", detail: 3 } } }));
  assert.equal(out?.kind, "ok");
  const byTitle = Object.fromEntries(out.opportunities.map((o: Opportunity) => [o.title, o]));
  assert.equal(byTitle["Open call 1"].deadline, "2027-03-11");
  assert.equal(byTitle["Open call 2"].deadline, "2027-04-02");
  assert.equal(h.calls.filter((c) => c.includes("/detail/old")).length, 0);
});

test("day/month order: a slash date is refused when ambiguous, read by date_order when given", () => {
  const rx = "Fecha límite: (\\d{2}/\\d{2}/\\d{4})";
  const text = "Fecha límite: 05/03/2027";
  assert.equal(regexDeadline(text, rx, "2027-01-10"), null);
  assert.equal(regexDeadline(text, rx, "2027-01-10", "dmy"), "2027-03-05");
  assert.equal(regexDeadline(text, rx, "2027-01-10", "mdy"), "2027-05-03");
  assert.equal(regexDeadline("Due: 12/31/2027", "Due: (\\d{2}/\\d{2}/\\d{4})", "2027-01-10"), "2027-12-31");
  assert.equal(regexDeadline("Due: March 3, 2027", "Due: ([A-Za-z]+ \\d{1,2}, \\d{4})", "2027-01-10"), "2027-03-03");
});

test("self.deadline_regex honours top-level date_order and refuses an ambiguous slash date", async () => {
  const body = "<html><body><p>Fecha límite: 05/03/2027</p></body></html>";
  const self = { deadline_regex: "Fecha límite: (\\d{2}/\\d{2}/\\d{4})" };
  const none = await fetchSource(harness({ [PROGRAM]: { body } }).c, src({ adapter: "html", url: PROGRAM, adapter_config: { self } }));
  assert.equal(none?.opportunities?.length ?? 0, 0);
  const dmy = await fetchSource(harness({ [PROGRAM]: { body } }).c, src({ adapter: "html", url: PROGRAM, adapter_config: { self, date_order: "dmy" } }));
  assert.equal(dmy?.opportunities?.[0]?.external_id, "cycle:2027");
  assert.match(String(configError({ date_order: "ymd" }, src())), /date_order/);
  // JSON.parse turns a hand-written "\b" into a backspace (U+0008): refuse it instead of never matching.
  const bad = JSON.parse('{"filter":{"any":["re:\\bRFP\\b"]}}');
  assert.match(String(configError(bad, src())), /^adapter_config\.filter\.any\[0\] contains a control character/);
  assert.equal(configError(JSON.parse('{"filter":{"any":["re:\\\\bRFP\\\\b"]}}'), src()), null);
});

test("common patterns pass config validation; nested quantifiers are accepted (the step budget bounds them at run time)", () => {
  const s = src({ adapter: "html", url: PROGRAM });
  assert.equal(configError({ self: { deadline_regex: "((?:a|aa)+z)" } }, s), null);
  assert.equal(configError({ self: { deadline_regex: "Fecha límite: (\\d{2}/\\d{2}/\\d{4})" } }, s), null);
  assert.equal(configError({ self: { deadline_regex: "full proposals\\s+((?:January|February) \\d{1,2}, \\d{4})" } }, s), null);
  assert.equal(configError({ list: { item: "li", closed: "\\bclosed\\b", match: "Request for proposals (active|ended)" } }, s), null);
});

test("list.detail: a same-host detail link that redirects off-host is not followed and yields no date", async () => {
  const listing = `<html><body><ul><li class="call"><h3>Redirected call</h3><a href="/detail/1">More</a></li></ul></body></html>`;
  const h = harness({
    [LIST]: { body: listing },
    "https://funder.example.org/detail/1": { status: 302, location: "https://other.example.net/deadline" },
    "https://other.example.net/deadline": { body: "<html><body><p>Due March 11, 2027</p></body></html>" },
  });
  const out = await fetchSource(h.c, src({ adapter: "html", url: LIST, adapter_config: { list: { item: "li.call", title: "h3", link: "a", detail: 1 } } }));
  assert.equal(out?.kind, "ok");
  assert.equal(out.opportunities[0].deadline, null);
  assert.equal(h.calls.filter((c) => c.includes("other.example.net")).length, 0);
});

test("list.detail: a labelled future date wins over a past regex match, and a past-only detail closes an undated call", async () => {
  const listing = `<html><body><ul>
    <li class="call"><h3>Mixed page call</h3><a href="/detail/mixed">More</a><span class="due">Deadline: March 1, 2027</span></li>
    <li class="call"><h3>Past page call</h3><a href="/detail/past">More</a></li>
  </ul></body></html>`;
  const h = harness({
    [LIST]: { body: listing },
    "https://funder.example.org/detail/mixed": { body: "<html><body><p>Deadline: June 30, 2026</p><p>Full proposals due March 11, 2027</p></body></html>" },
    "https://funder.example.org/detail/past": { body: "<html><body><p>Deadline: June 30, 2026</p></body></html>" },
  });
  const cfg = { list: { item: "li.call", title: "h3", link: "a", detail: { max: 5, deadline_regex: "Deadline: ([A-Za-z]+ \\d{1,2}, \\d{4})" } } };
  const out = await fetchSource(h.c, src({ adapter: "html", url: LIST, adapter_config: cfg }));
  assert.equal(out?.kind, "ok");
  const byTitle = Object.fromEntries(out.opportunities.map((o: Opportunity) => [o.title, o]));
  assert.equal(byTitle["Mixed page call"].deadline, "2027-03-11");
  assert.equal(byTitle["Mixed page call"].status, "open");
  assert.equal(byTitle["Past page call"].deadline, "2026-06-30");
  assert.equal(byTitle["Past page call"].status, "closed");
});

// ---- deploy-review hardening: regex safety, detail date rule, horizon, redirects, capture group, month words ----
import { readdirSync } from "node:fs";
import { pickHops } from "../adapters/index.ts";
import { newBudget, RegexBudgetError, regexSyntaxProblem } from "../safe_regex.ts";

const CFG_DIR = new URL("../../../grants/collect/cfg/", import.meta.url);

/** Every regex in the funder configs (deadline_regex, list.match/skip/closed, list.detail, "re:" filter terms). */
function cfgRegexes(): string[] {
  const out: string[] = [];
  const add = (v: unknown) => typeof v === "string" && v && out.push(v);
  for (const f of readdirSync(CFG_DIR).filter((n) => n.endsWith(".json"))) {
    const c = JSON.parse(readFileSync(new URL(f, CFG_DIR), "utf8")).adapter_config ?? {};
    add(c.deadline_regex);
    add(c.self?.deadline_regex);
    for (const k of ["match", "skip", "closed"]) add(c.list?.[k]);
    add(c.list?.detail?.deadline_regex);
    add(c.list?.detail?.closed);
    for (const k of ["any", "all", "none"]) for (const t of c.filter?.[k] ?? []) if (String(t).startsWith("re:")) add(String(t).slice(3));
  }
  return out;
}

test("config regexes: every funder config pattern is accepted; refusals carry a reason and become config errors", () => {
  assert.ok(cfgRegexes().length >= 15, "cfg regexes were found");
  for (const r of cfgRegexes()) assert.equal(regexSyntaxProblem(r), null, `should accept ${r}`);
  for (const r of ["a(?=b)", "(?<d>\\d+)", "(\\d+)\\1", "(unclosed", "a".repeat(301)]) assert.ok(regexSyntaxProblem(r), `should refuse ${r}`);
  const cfg = { list: { item: "li", match: "a(?=b)" } };
  assert.match(String(configError(cfg, src())), /^list\.match is not a valid regex: .+/);
  assert.match(String(configError({ self: { deadline_regex: "Due \\d+" } }, src())), /capturing group/);
  assert.equal(configError({ self: { deadline_regex: "Due (\\d+)" } }, src()), null);
  assert.match(String(configError({ filter: { any: ["re:(x"] } }, src())), /filter\.any term/);
});

// A pattern the matcher accepts but that backtracks exponentially on the right text: every call must run on the whole text and spend the budget.
const SLOW = "(?:a|aa)+b";
const SLOW_TEXT = "a".repeat(60);

test("budget: a pathological pattern throws RegexBudgetError from every helper that runs a config pattern", () => {
  const li = `<ul><li><h3>Call title</h3><a href="/x">${SLOW_TEXT}</a></li></ul>`;
  assert.throws(() => extractList(li, BASE, { item: "li", match: SLOW }, TODAY), RegexBudgetError);
  assert.throws(() => extractList(li, BASE, { item: "li", skip: SLOW }, TODAY), RegexBudgetError);
  assert.throws(() => extractList(li, BASE, { item: "li", closed: SLOW }, TODAY), RegexBudgetError);
  assert.throws(() => regexDeadline(SLOW_TEXT, `(${SLOW})`, TODAY), RegexBudgetError);
  assert.throws(() => selfCycle(SLOW_TEXT, { name: "n", url: "u" }, { deadline_regex: `(${SLOW})` }, TODAY), RegexBudgetError);
  assert.throws(() => matchesFilter({ external_id: "1", title: SLOW_TEXT } as Opportunity, { any: [`re:${SLOW}`] }), RegexBudgetError);
  assert.throws(() => finalize([{ external_id: "1", title: SLOW_TEXT } as Opportunity], { filter: { any: [`re:${SLOW}`] } }, TODAY, false), RegexBudgetError);
});

test("budget: one budget is shared by the calls of one source, and a spent one fails the next call at once", () => {
  const b = newBudget(1000);
  const li = `<ul><li><h3>Call title</h3><a href="/x">${"x ".repeat(100)}</a></li></ul>`;
  extractList(li, BASE, { item: "li", match: "x" }, TODAY, b);
  const used = 1000 - b.left;
  assert.ok(used > 0 && used < 1000, `used ${used}`);
  let calls = 0;
  assert.throws(() => { for (;;) { calls++; extractList(li, BASE, { item: "li", match: "zzz" }, TODAY, b); } }, RegexBudgetError);
  assert.ok(calls > 1, "the second call already found the budget partly spent");
  assert.equal(b.left, 0);
  assert.throws(() => regexDeadline("Due: March 3, 2027", "Due: (\\w+ \\d+, \\d{4})", TODAY, undefined, b), RegexBudgetError);
});

test("budget: a spent budget ends the source with a visible 'config pattern too slow' error, never a silent empty success", async () => {
  const listing = `<html><body><ul><li class="call"><h3>Call title</h3><a href="/calls/x">${SLOW_TEXT}</a><span class="due">Deadline: March 15, 2027</span></li></ul></body></html>`;
  for (const list of [{ item: "li.call", match: SLOW }, { item: "li.call", skip: SLOW }]) {
    const h = harness({ [LIST]: { body: listing } });
    const out = await fetchSource(h.c, src({ adapter: "html", url: LIST, adapter_config: { list } }));
    assert.equal(out?.kind, "error");
    assert.ok(out.error.startsWith("config pattern too slow on this page: "), out.error);
    assert.ok(out.error.includes(SLOW), "the message names the pattern start");
    assert.equal(out.opportunities, undefined);
  }
  // self deadline_regex and a filter term go through the same path
  const h = harness({ [PROGRAM]: { body: `<html><body><p>Our program funds climate work across the region and invites applications every year. ${"abcdefghijklmnopqrstuvwxyzabcd ".repeat(8)}</p></body></html>` } });
  const self = await fetchSource(h.c, src({ adapter_config: { self: { deadline_regex: "((?:[a-z]|[a-z][a-z])+3)" } } }));
  assert.match(String(self?.error), /^config pattern too slow on this page: /);
  // a ctx that carries its own budget is the one that is spent (no module-level state): a second source starts fresh
  const h2 = harness({ [PROGRAM]: { body: LIST_HTML } });
  const ok = await fetchSource({ ...h2.c, budget: newBudget() }, src({ adapter_config: { list: { item: "li.call", title: "h3", link: "a", match: "Climate" } } }));
  assert.equal(ok?.kind, "ok");
  assert.equal(ok.opportunities?.length, 1);
});

test("regexDeadline runs on the whole unmodified text: a date after a very long line and many spaces is still found", () => {
  const text = `${"word ".repeat(60_000)}${" ".repeat(5000)}Deadline: March 15, 2027 `;
  assert.equal(regexDeadline(text, "Deadline:\\s*([A-Za-z]+ \\d{1,2}, \\d{4})", TODAY), "2027-03-15");
  const nb = `Deadline:${String.fromCharCode(160)}${String.fromCharCode(160)}March${String.fromCharCode(160)}15, 2027`;
  assert.equal(regexDeadline(nb, "Deadline:\\s*([A-Za-z]+\\s\\d{1,2}, \\d{4})", TODAY), "2027-03-15");
});

test("regexDeadline ignores a captured date past the 30-month horizon", () => {
  const rx = "Deadline: ([A-Za-z]+ \\d{1,2}, \\d{4})";
  assert.equal(regexDeadline("Deadline: December 31, 2099", rx, TODAY), null);
  assert.equal(regexDeadline("Deadline: March 1, 2045", rx, TODAY), null);
  assert.equal(regexDeadline("Deadline: December 31, 2099 and Deadline: June 1, 2027", rx, TODAY), "2027-06-01");
  assert.equal(regexDeadline("Deadline: June 30, 2029", rx, TODAY), "2029-06-30"); // inside 30 months of 2027-01-10
  assert.equal(selfCycle("Deadline: December 31, 2099", { name: "n", url: "u" }, { deadline_regex: rx }, TODAY).length, 0);
});

test("list.detail: a past-only detail date does not replace the date the listing gave", async () => {
  const listing = `<html><body><ul><li class="call"><h3>Open call</h3><a href="/detail/open">More</a><span class="due">Deadline: March 1, 2027</span></li></ul></body></html>`;
  const h = harness({
    [LIST]: { body: listing },
    "https://funder.example.org/detail/open": { body: "<html><body><p>2026 round deadline: June 30, 2026</p></body></html>" },
  });
  const out = await fetchSource(h.c, src({ adapter: "html", url: LIST, adapter_config: { list: { item: "li.call", title: "h3", link: "a", detail: 1 } } }));
  assert.equal(out?.kind, "ok");
  assert.equal(out.opportunities[0].deadline, "2027-03-01");
  assert.equal(out.opportunities[0].status, "open");
  assert.ok(h.calls.some((c) => c.endsWith("/detail/open")), "the detail page was read");
});

test("list.detail: true means 3 detail pages; list.detail.closed marks an item closed", async () => {
  const rows = Array.from({ length: 5 }, (_, i) => `<li class="call"><h3>Call ${i + 1}</h3><a href="/detail/${i + 1}">More</a></li>`).join("");
  const routes: Record<string, { body: string }> = {
    [LIST]: { body: `<html><body><ul>${rows}</ul></body></html>` },
    "https://funder.example.org/detail/1": { body: "<html><body><p>Full proposals due March 11, 2027. This call is closed to new applicants.</p></body></html>" },
    "https://funder.example.org/detail/2": { body: "<html><body><p>Full proposals due April 2, 2027.</p></body></html>" },
  };
  const h = harness(routes);
  const out = await fetchSource(h.c, src({ adapter: "html", url: LIST, adapter_config: { list: { item: "li.call", title: "h3", link: "a", detail: true } } }));
  assert.equal(out?.kind, "ok");
  assert.equal(h.calls.filter((c) => c.startsWith("GET https://funder.example.org/detail/")).length, 3);

  const h2 = harness(routes);
  const out2 = await fetchSource(h2.c, src({ adapter: "html", url: LIST, adapter_config: { list: { item: "li.call", title: "h3", link: "a", detail: { max: 2, closed: "\\bclosed\\b" } } } }));
  const byTitle = Object.fromEntries(out2.opportunities.map((o: Opportunity) => [o.title, o]));
  assert.equal(byTitle["Call 1"].status, "closed");
  assert.equal(byTitle["Call 2"].status, "open");
  assert.equal(byTitle["Call 2"].deadline, "2027-04-02");
});

test("selfCycle: a deadline_regex whose only date is in the past gives no call", () => {
  const rx = "Deadline: ([A-Za-z]+ \\d{1,2}, \\d{4})";
  assert.deepEqual(selfCycle("Deadline: March 15, 2026", { name: "n", url: "u" }, { deadline_regex: rx }, TODAY), []);
  assert.equal(selfCycle("Deadline: March 15, 2027", { name: "n", url: "u" }, { deadline_regex: rx }, TODAY)[0].deadline, "2027-03-15");
});

test("list.detail redirects: http to https on the same hostname is followed; another hostname or https to http is refused", async () => {
  const body = "<html><body><p>Full proposals due March 11, 2027</p></body></html>";
  const listing = `<html><body><ul>
    <li class="call"><h3>Upgrade call</h3><a href="http://funder.example.org/detail/up">More</a></li>
    <li class="call"><h3>Subdomain call</h3><a href="/detail/sub">More</a></li>
    <li class="call"><h3>Downgrade call</h3><a href="/detail/down">More</a></li>
  </ul></body></html>`;
  const h = harness({
    [LIST]: { body: listing },
    "http://funder.example.org/detail/up": { status: 301, location: "https://funder.example.org/detail/up" },
    "https://funder.example.org/detail/up": { body },
    "https://funder.example.org/detail/sub": { status: 301, location: "https://www.funder.example.org/detail/sub" },
    "https://www.funder.example.org/detail/sub": { body },
    "https://funder.example.org/detail/down": { status: 301, location: "http://funder.example.org/detail/down" },
    "http://funder.example.org/detail/down": { body },
  });
  const out = await fetchSource(h.c, src({ adapter: "html", url: LIST, adapter_config: { list: { item: "li.call", title: "h3", link: "a", detail: 5 } } }));
  assert.equal(out?.kind, "ok");
  const byTitle = Object.fromEntries(out.opportunities.map((o: Opportunity) => [o.title, o]));
  assert.equal(byTitle["Upgrade call"].deadline, "2027-03-11");
  assert.equal(byTitle["Subdomain call"].deadline, null);
  assert.equal(byTitle["Downgrade call"].deadline, null);
  assert.equal(h.calls.filter((c) => c.includes("www.funder.example.org") || c.startsWith("GET http://funder.example.org/detail/down")).length, 0);
});

test("configError: a deadline_regex without a capturing group is refused in all three places", () => {
  const s = src({ adapter: "html", url: PROGRAM });
  const bare = "\\d{1,2}\\s+de\\s+[a-z]+\\s+de\\s+\\d{4}";
  const msg = /needs one capturing group/;
  assert.match(String(configError({ deadline_regex: bare }, s)), msg);
  assert.match(String(configError({ self: { deadline_regex: bare } }, s)), msg);
  assert.match(String(configError({ list: { item: "li", detail: { deadline_regex: bare } } }, s)), msg);
  assert.equal(configError({ self: { deadline_regex: "(" + bare + ")" } }, s), null);
  assert.equal(configError({ list: { item: "li", detail: { closed: "\\bclosed\\b" } } }, s), null); // closed has no capture rule
  assert.match(String(configError({ self: { deadline_regex: "(a)(?=b)" } }, s)), /valid regex: .+/);
  assert.match(String(configError({ filter: { any: ["re:(x"] } }, s)), /valid regex: not a valid/);
});

test("Spanish and French short months set and ago need a period or a leading de", () => {
  assert.equal(parseDate("12 set. 2027"), "2027-09-12");
  assert.equal(parseDate("12 de ago de 2027"), "2027-08-12");
  assert.equal(parseDate("12 ago. 2027"), "2027-08-12");
  assert.equal(parseDate("12 sept 2027"), "2027-09-12");
  assert.equal(parseDate("phase 2 set 2027"), null);
  assert.equal(parseDate("2 ago 2027"), null);
  assert.equal(parseDate("12 de septiembre de 2027"), "2027-09-12");
});

test("list.detail rotation: first call always, the rest rotate by day; every call is covered within a few days and the cap holds", () => {
  const calls = Array.from({ length: 11 }, (_, i) => `c${i}`);
  const seen = new Set<string>();
  const days = ["2027-01-10", "2027-01-11", "2027-01-12", "2027-01-13", "2027-01-14"];
  for (const day of days) {
    const picks = pickHops(calls, 3, day);
    assert.equal(picks.length, 3);
    assert.equal(picks[0], "c0");
    assert.equal(new Set(picks).size, 3);
    assert.deepEqual(pickHops(calls, 3, day), picks, "same day, same picks");
    picks.forEach((p) => seen.add(p));
  }
  assert.deepEqual([...seen].sort(), [...calls].sort(), "all calls covered over 5 consecutive days (10 others, 2 per day)");
  assert.deepEqual(pickHops(calls.slice(0, 3), 3, "2027-01-10"), calls.slice(0, 3), "within the cap: all of them, in order");
  assert.deepEqual(pickHops(calls, 1, "2027-01-11"), ["c0"], "cap 1: the first only");
});

test("list.detail rotation through fetchSource: the cap holds and later days visit the calls the first day left out", async () => {
  const rows = Array.from({ length: 7 }, (_, i) => `<li class="call"><h3>Call ${i + 1}</h3><a href="/detail/${i + 1}">More</a></li>`).join("");
  const visited = new Set<string>();
  for (const today of ["2027-01-10", "2027-01-11", "2027-01-12"]) {
    const h = harness({ [LIST]: { body: `<html><body><ul>${rows}</ul></body></html>` } });
    await fetchSource({ ...h.c, today }, src({ adapter: "html", url: LIST, adapter_config: { list: { item: "li.call", title: "h3", link: "a", detail: 3 } } }));
    const got = h.calls.filter((c) => c.includes("/detail/")).map((c) => c.split("/detail/")[1]);
    assert.equal(got.length, 3);
    assert.ok(got.includes("1"), "the first call is visited every day");
    got.forEach((g) => visited.add(g));
  }
  assert.equal(visited.size, 7);
});

// ---------- round 1 regressions: linear time on funder-controlled text, and patterns see the page text unaltered ----------
import { findAmount, findDeadlines } from "../extract.ts";
import { money, plainText as apiPlainText } from "../adapters/api.ts";
import { stripTrailingSlashes } from "../adapters/collect.ts";
import { safeRegex as safeRe } from "../safe_regex.ts";

const took = (f: () => unknown): number => {
  const t = performance.now();
  f();
  return performance.now() - t;
};
const DATE_RX = "deadline:\\s*([A-Za-z]+ \\d{1,2}, \\d{4})";

test("findDeadlines and findAmount: one pass over a page of many short lines or one very long line (was quadratic)", () => {
  assert.ok(took(() => assert.equal(findDeadlines("2027-01-01\n".repeat(30_000), TODAY).future, null)) < 1500, "date lines, no label");
  assert.ok(took(() => findDeadlines("2027-01-01 ".repeat(50_000), TODAY)) < 1500, "dates on one line");
  assert.ok(took(() => findAmount("$1,111 ".repeat(40_000))) < 1500, "amounts on one line");
  // behaviour kept: the label on the line above the date
  assert.equal(findDeadlines("Deadline\nMarch 15, 2027\nJune 1, 2027", TODAY).future, "2027-03-15");
  assert.equal(findDeadlines("x\n\nDeadline\n\nMarch 15, 2027", TODAY).future, null); // a blank line between label and date is not "right above"
  assert.equal(findDeadlines("Deadline: March 15, 2027", TODAY).future, "2027-03-15");
  assert.deepEqual(findAmount("up to $50,000 per award\nand $9 grants\n$20,000 total funding"), { value: 50000, currency: "USD" });
});

test("money and api plainText: linear on long whitespace and unclosed tags (were quadratic)", () => {
  assert.ok(took(() => assert.equal(money(" ".repeat(60_000) + "x"), null)) < 1500);
  assert.ok(took(() => apiPlainText("<p".repeat(50_000))) < 1500);
  assert.equal(money("  $ 1,250.5  "), 1250.5);
  assert.equal(money("\n\t500 "), 500);
  assert.equal(apiPlainText("<p>One</p><p>Two</p><ul><li>a</li><li>b</li></ul>"), "One Two a b");
  assert.equal(apiPlainText("a<br/>b <div class='x'>c</div>"), "a b c");
});

test("stripTrailingSlashes equals the regex it replaced, in linear time", () => {
  assert.ok(took(() => stripTrailingSlashes("https://example.com/a" + "/".repeat(200_000) + "x")) < 500);
  const alphabet = ["/", "/", "?", "a", "b"];
  let seed = 7;
  const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
  for (let i = 0; i < 3000; i++) {
    const u = Array.from({ length: Math.floor(rnd() * 12) }, () => alphabet[Math.floor(rnd() * alphabet.length)]).join("");
    assert.equal(stripTrailingSlashes(u), u.replace(/\/+(?=\?|$)/, ""), JSON.stringify(u));
  }
  const ms = took(() => assert.equal(extractList(`<a href="https://example.com/a${"/".repeat(50_000)}x">Climate program</a>`, BASE, { match: "program" }, TODAY).length, 1));
  assert.ok(ms < 1500, `extractList on a href of slashes took ${ms} ms`);
});

test("config patterns see the page text unaltered: a 'last updated' line, a countdown or a copyright line never hides a date", async () => {
  const body = `<html><body><main><h1>Grant</h1><p>Full proposal deadline: March 15, 2027 | Last updated Jan 5, 2027</p><p>Next round deadline: September 1, 2027</p></main></body></html>`;
  const h = harness({ [PROGRAM]: { body } });
  const out = await fetchSource(h.c, src({ adapter_config: { self: { deadline_regex: DATE_RX } } }));
  assert.equal(out?.kind, "ok");
  assert.equal(out.opportunities[0].deadline, "2027-03-15"); // was 2027-09-01: the whole "Last updated" line was dropped first
  assert.ok(!out.text.includes("Last updated"), "the stored text (hash, diff) still drops the volatile line");
  // the same for list.detail: deadline_regex and closed
  const listing = `<html><body><ul><li class="call"><h3>Open call</h3><a href="/detail/open">More</a></li></ul></body></html>`;
  const detail = `<html><body><p>Proposal deadline: April 2, 2027 (only 40 days left)</p><p>Next round deadline: October 1, 2027</p><p>(c) 2027 Funder. Applications closed for the 2026 round.</p></body></html>`;
  const rx = "Proposal deadline:\\s*([A-Za-z]+ \\d{1,2}, \\d{4})\\s*\\(only 40 days left\\)";
  const h2 = harness({ [LIST]: { body: listing }, "https://funder.example.org/detail/open": { body: detail } });
  const out2 = await fetchSource(h2.c, src({ adapter: "html", url: LIST, adapter_config: { list: { item: "li.call", title: "h3", link: "a", detail: { max: 1, deadline_regex: rx, closed: "closed for the 2026" } } } }));
  assert.equal(out2.opportunities[0].deadline, "2027-04-02"); // the countdown phrase is part of the text the pattern sees
  assert.equal(out2.opportunities[0].status, "closed"); // the copyright line holding "closed" was dropped before
});

test("whitespace-exact patterns match the page text: \\s{2}, a non-breaking space, a tab", async () => {
  const body = `<html><body><p>Deadline:  March 15, 2027</p><pre>Round\tdue: June 1, 2027</pre></body></html>`;
  const h = harness({ [PROGRAM]: { body } });
  const date = "([A-Za-z]+ \\d{1,2}, \\d{4})";
  for (const [rx, want] of [["Deadline:\\s{2}" + date, "2027-03-15"], ["Deadline:\\xa0\\xa0" + date, "2027-03-15"], ["Round\\tdue: " + date, "2027-06-01"]] as const) {
    const out = await fetchSource(h.c, src({ adapter_config: { self: { deadline_regex: rx } } }));
    assert.equal(out.opportunities?.[0]?.deadline, want, rx);
  }
});

test("matchAll through regexDeadline sees every match: the nearest date wins even after 1000 other dates", () => {
  const text = "Deadline: September 1, 2027\n".repeat(1200) + "Deadline: March 3, 2027\n";
  assert.equal(regexDeadline(text, DATE_RX, TODAY), "2027-03-03"); // was 2027-09-01: only the first 1000 matches were read
  assert.throws(() => regexDeadline("x ".repeat(60_000), "(x)", TODAY), RegexBudgetError); // a huge match count is an error, not a cut
  assert.equal(safeRe("a").matchAll("a ".repeat(2000)).length, 2000);
});

// ---- round 2: a page's work is bounded ----
import { PageWorkError } from "../extract.ts";

test("anchor mode: 400 anchors under wrappers that also hold 400,000 characters cost milliseconds, not seconds", () => {
  const links = Array.from({ length: 400 }, (_, i) => `<a href="/p${i}">Climate program ${i}</a>`).join("");
  const html = `<html><body>${"<div>".repeat(5)}${links}<p>${"lorem ipsum ".repeat(33_000)}</p>${"</div>".repeat(5)}</body></html>`;
  const t = performance.now();
  const out = extractList(html, BASE, { match: "program" }, TODAY);
  assert.equal(out.length, 400);
  assert.ok(performance.now() - t < 1500, `took ${Math.round(performance.now() - t)} ms`);
  // the nearest ancestor with at most 600 characters is still chosen, and a whitespace-heavy ancestor is read, not guessed
  const small = `<div><p>one</p><div class="x"><a href="/a">Climate program A</a><span>Deadline: March 3, 2027</span></div>${" ".repeat(5000)}</div>`;
  assert.equal(extractList(small, BASE, { match: "program" }, TODAY)[0].deadline, "2027-03-03");
});

test("item mode: candidates that contain each other and a large page end the source with an error, not a long scan", async () => {
  const nested = Array.from({ length: 400 }, (_, i) => `<div class="i"><a href="/p${i}">Climate program ${i}</a><p>${"lorem ipsum ".repeat(120)}</p>`).join("") + "</div>".repeat(400);
  const html = `<html><body>${nested}</body></html>`;
  const t = performance.now();
  assert.throws(() => extractList(html, BASE, { item: "div.i" }, TODAY), PageWorkError);
  assert.ok(performance.now() - t < 1500, `took ${Math.round(performance.now() - t)} ms`);
  const h = harness({ [LIST]: { body: html } });
  const out = await fetchSource(h.c, src({ adapter: "html", url: LIST, adapter_config: { list: { item: "div.i" } } }));
  assert.equal(out?.kind, "error");
  assert.match(String(out.error), /^page too heavy to scan: /);
  // ordinary flat items are untouched
  const flat = Array.from({ length: 400 }, (_, i) => `<li><a href="/p${i}">Climate program ${i}</a><p>${"lorem ipsum ".repeat(100)}</p></li>`).join("");
  assert.equal(extractList(`<ul>${flat}</ul>`, BASE, { item: "li" }, TODAY).length, 400);
});

test("a deeply nested page ends the source with a visible error through fetchSource", async () => {
  const h = harness({ [LIST]: { body: `<html><body>${"<div>".repeat(100_000)}x</body></html>` } });
  const out = await fetchSource(h.c, src({ adapter: "html", url: LIST }));
  assert.equal(out?.kind, "error");
  assert.match(String(out.error), /^page too heavy to scan: markup nests elements deeper than/);
});

// ---- deploy review: hash churn from the hop rotation, conditional request vs detail hops, heavy selectors ----
const CALL_ROWS = Array.from({ length: 5 }, (_, i) => `<li class="call"><h3>Call number ${i + 1}</h3><a href="/detail/${i + 1}">More</a></li>`).join("");
const detailRoutes = (): Record<string, Stub> => ({
  [LIST]: { body: `<html><body><ul>${CALL_ROWS}</ul></body></html>` },
  ...Object.fromEntries(Array.from({ length: 5 }, (_, i) => [`https://funder.example.org/detail/${i + 1}`, { body: `<html><body><p>Deadline: March ${i + 10}, 2027</p></body></html>` }])),
});

test("list.detail: the stored text and hash do not move with the day's hop rotation, the opportunities keep the detail dates", async () => {
  const cfg = { list: { item: "li.call", title: "h3", link: "a", detail: 3 } };
  const runs = [];
  for (const today of ["2027-01-10", "2027-01-11", "2027-01-12"]) {
    const h = harness(detailRoutes());
    h.c.today = today;
    h.c.now = new Date(`${today}T12:00:00Z`);
    const out = await fetchSource(h.c, src({ adapter: "html", url: LIST, adapter_config: cfg }));
    assert.equal(out?.kind, "ok");
    runs.push(out);
  }
  assert.equal(new Set(runs.map((r) => r.content_hash)).size, 1);
  assert.equal(new Set(runs.map((r) => r.text)).size, 1);
  assert.match(runs[0].text, /Call number 1 \| no date \| open/);
  const dated = runs.map((r) => r.opportunities.filter((o: Opportunity) => o.deadline).length);
  assert.deepEqual(dated, [3, 3, 3]);
  assert.notDeepEqual(runs[0].opportunities.map((o: Opportunity) => o.deadline), runs[1].opportunities.map((o: Opportunity) => o.deadline));
  for (const o of runs[0].opportunities) assert.deepEqual(Object.keys(o).filter((k) => !["external_id", "title", "url", "deadline", "description", "status", "award_max_usd"].includes(k)), []);
});

test("list.detail: a listing that would answer 304 still gets its detail hops; without detail the conditional headers stay", async () => {
  const seen: { url: string; inm: string | null }[] = [];
  const mk = (routes: Record<string, Stub>) => {
    const h = harness(routes);
    const inner = h.c.d.fetchImpl;
    h.c.d.fetchImpl = (async (input: string | URL | Request, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      const inm = new Headers(init?.headers).get("if-none-match");
      seen.push({ url, inm });
      return url === LIST && inm ? new Response(null, { status: 304 }) : inner(input, init); // a real server answers 304 only to a conditional request
    }) as unknown as typeof fetch;
    return h;
  };
  const withDetail = await fetchSource(mk(detailRoutes()).c, src({ adapter: "html", url: LIST, etag: '"v1"', adapter_config: { list: { item: "li.call", title: "h3", link: "a", detail: 3 } } }));
  assert.equal(seen.filter((s) => s.url === LIST)[0].inm, null);
  assert.equal(withDetail?.kind === "not_modified", false);
  assert.ok(seen.some((s) => s.url.includes("/detail/")));
  seen.length = 0;
  const plain = await fetchSource(mk(detailRoutes()).c, src({ adapter: "html", url: LIST, etag: '"v1"', adapter_config: { list: { item: "li.call", title: "h3", link: "a" } } }));
  assert.equal(seen.find((s) => s.url === LIST)?.inm, '"v1"');
  assert.equal(plain?.kind, "not_modified");
});

test("configError: list selectors with :has( or the ~ combinator are refused; [attr~=x] is fine", () => {
  const s = src({ adapter: "html" });
  for (const bad of ["li:has(a.x)", "h3 ~ p", "li:HAS(a)"]) assert.match(configError({ list: { item: bad } }, s) ?? "", /too slow/);
  assert.match(configError({ list: { item: "li.call", link: "a:has(b)" } }, s) ?? "", /list\.link .*too slow/);
  assert.equal(configError({ list: { item: 'li[class~="call"]', title: "h3" } }, s), null);
  assert.equal(configError({ list: { item: 'li[title="a~b"]' } }, s), null);
});
