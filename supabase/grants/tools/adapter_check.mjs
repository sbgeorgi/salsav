// Acceptance harness for a funder config (COLLECT.md C5). Runs the REAL fetchSource (adapters/index.ts) with the real
// fetch and the real politeGet (robots.txt honored, per-host spacing), in-memory politeness, no database.
//   node --experimental-strip-types supabase/grants/tools/adapter_check.mjs <file.json | inline json>
//   node --experimental-strip-types supabase/grants/tools/adapter_check.mjs --all <dir>
// Input: a C3 config file (id, name, url, feed_url, adapter, adapter_config, expect) or a bare source object.
// Output per run: one JSON line {ok, mode, kind, http, count, open, text_len, sample, error, expect_min, fetchability}.
//   mode (C2): calls = grants_gov|eu_ft|sam_gov|json_api|rss, or html with list; cycle = html with self only; page = html alone.
//   ok: kind "ok" and count >= expect.min_items (default 1) for calls and cycle; text_len >= 300 for page.
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { basename, join } from "node:path";
import { fetchSource } from "../../functions/grants-refresh/adapters/index.ts";
import { DEFAULT_POLITENESS, Politeness } from "../../functions/grants-refresh/politeness.ts";
import { realClock } from "../../functions/grants-refresh/types.ts";

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36 SALSAV-GrantWatch/1.0 (+https://salsav.org)";
const ALL_ITEMS = process.argv.includes("--items");
const REQUEST_TIMEOUT_MS = 30_000;
const RUN_BUDGET_MS = 180_000;
const pol = new Politeness(realClock, { ...DEFAULT_POLITENESS }); // one instance: spacing holds across --all configs too

const isObj = (v) => typeof v === "object" && v !== null && !Array.isArray(v);

function modeOf(src) {
  if (src.adapter === "none") return "none";
  if (src.adapter !== "html") return "calls";
  if (isObj(src.adapter_config) && isObj(src.adapter_config.list)) return "calls";
  if (isObj(src.adapter_config) && isObj(src.adapter_config.self)) return "cycle";
  return "page";
}

function toSource(j) {
  return {
    id: j.id ?? "trial",
    name: j.name ?? j.url,
    url: j.url,
    feed_url: j.feed_url ?? null,
    adapter: j.adapter,
    adapter_config: isObj(j.adapter_config) ? j.adapter_config : {},
    etag: null,
    last_modified: null,
    content_hash: null,
    fetchability: "easy",
    consecutive_failures: 0,
    cycle: j.cycle ?? "trial",
    next_deadline: null,
    page_type: "",
    shard: 0,
  };
}

const brief = (o) => ({
  title: String(o.title ?? "").slice(0, 120),
  deadline: o.deadline ?? null,
  status: o.status ?? null,
  url: o.url ?? null,
  award_max_usd: o.award_max_usd ?? null,
});

/** One config through the real adapter dispatch. Returns the output object (never throws). */
async function check(arg) {
  let j;
  try {
    j = JSON.parse(existsSync(arg) ? readFileSync(arg, "utf8") : arg);
  } catch (e) {
    return { ok: false, mode: null, kind: null, error: `harness: bad input (${String(e.message).slice(0, 120)})` };
  }
  const src = toSource(j);
  const mode = modeOf(src);
  const min = Number.isFinite(Number(j.expect?.min_items)) ? Number(j.expect.min_items) : 1;
  if (mode === "none") return { ok: false, mode, kind: null, error: "adapter none: nothing to collect" };
  if (!src.url) return { ok: false, mode, kind: null, error: "harness: no url" };
  try {
    const deadline = Date.now() + RUN_BUDGET_MS;
    const d = {
      pol,
      fetchImpl: fetch,
      env: { allowLocal: false, grantsGovKey: undefined, samKey: undefined },
      deadline,
      requestTimeoutMs: REQUEST_TIMEOUT_MS,
    };
    const f = await fetchSource({ d, today: new Date().toISOString().slice(0, 10), now: new Date() }, src);
    if (!f) return { ok: false, mode, kind: null, error: "run budget exhausted" };
    const opps = f.opportunities ?? [];
    const textLen = (f.text ?? "").length;
    const ok = mode === "page" ? f.kind === "ok" && textLen >= 300 : f.kind === "ok" && opps.length >= min;
    return {
      ok,
      mode,
      kind: f.kind,
      http: f.http_status ?? null,
      count: opps.length,
      open: opps.filter((o) => o.status === "open" || o.status === "forecasted").length,
      text_len: textLen,
      sample: opps.slice(0, ALL_ITEMS ? opps.length : 8).map(brief),
      error: f.error ?? null,
      expect_min: min,
      fetchability: f.fetchability ?? null,
    };
  } catch (e) {
    return { ok: false, mode, kind: "error", error: `harness: ${String(e?.message ?? e).slice(0, 200)}` };
  }
}

// --items: print every collected item in `sample`, not only the first 8
const argv = process.argv.slice(2).filter((a) => a !== "--items");
const arg = argv[0] ?? "";
if (arg === "--all") {
  const dir = argv[1] ?? "";
  if (!dir || !statSync(dir).isDirectory()) {
    console.log(JSON.stringify({ error: "usage: --all <dir>" }));
    process.exit(2);
  }
  const files = readdirSync(dir).filter((f) => f.endsWith(".json")).sort();
  let okN = 0;
  for (const f of files) {
    const r = await check(join(dir, f));
    if (r.ok) okN++;
    console.log(`${basename(f)} ok=${r.ok} mode=${r.mode} count=${r.count ?? 0} open=${r.open ?? 0} error=${r.error ?? "-"}`);
  }
  console.log(`TALLY ok ${okN}/${files.length}`);
} else {
  console.log(JSON.stringify(await check(arg)));
}
