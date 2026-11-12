// Deploy gate for an edge function: pure tests + static check of every funder config, then a stamp
// (supabase/functions/<fn>/.deploy-ok.json) holding sha256 of each deployable file (CRLF normalized to LF).
// ~/.claude/hooks/boundary-guard.py lets a subagent deploy only files that match the stamp exactly.
//   node --experimental-strip-types supabase/grants/tools/deploy_gate.mjs [--fn grants-refresh]   (from repo root)
// Last stdout line: {ok, files:[names], bytes}. Exit 1, and no stamp, on any failure.
// Skips the tests that need a local Postgres (only collect + extract run here).
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const i = process.argv.indexOf("--fn");
const fn = i > 0 ? process.argv[i + 1] : "grants-refresh";
const fnDir = join(root, "supabase", "functions", fn);
const fail = (msg) => { console.log(JSON.stringify({ ok: false, error: msg })); process.exit(1); };

const t = spawnSync(process.execPath, ["--experimental-strip-types", "--no-warnings", "--test", "--test-concurrency=1",
  "--test-timeout=240000", "tests/collect.test.ts", "tests/extract.test.ts"],
{ cwd: fnDir, encoding: "utf8", timeout: 540_000, killSignal: "SIGKILL" });
if (t.status !== 0) {
  console.error((t.stdout ?? "").split("\n").slice(-40).join("\n"), t.stderr ?? "");
  fail(t.error ? `tests did not finish: ${t.error.message}` : `tests failed (exit ${t.status})`);
}

const { configError } = await import(pathToFileURL(join(fnDir, "adapters", "index.ts")).href);
const isObj = (v) => typeof v === "object" && v !== null && !Array.isArray(v);
const cfgDir = join(root, "supabase", "grants", "collect", "cfg");
const errors = [];
for (const f of readdirSync(cfgDir).filter((n) => n.endsWith(".json")).sort()) {
  const j = JSON.parse(readFileSync(join(cfgDir, f), "utf8"));
  const cfg = isObj(j.adapter_config) ? j.adapter_config : {};
  const src = { id: j.id ?? "trial", name: j.name ?? j.url, url: j.url, feed_url: j.feed_url ?? null, adapter: j.adapter,
    adapter_config: cfg, etag: null, last_modified: null, content_hash: null, fetchability: "easy",
    consecutive_failures: 0, cycle: "trial", next_deadline: null, page_type: "", shard: 0 };
  const e = configError(cfg, src);
  if (e) errors.push(`${f}: ${e}`);
}
if (errors.length) { console.error(errors.join("\n")); fail(`${errors.length} config error(s)`); }

const ts = (d) => readdirSync(join(fnDir, d), { withFileTypes: true }).filter((e) => e.isFile() && e.name.endsWith(".ts"))
  .map((e) => (d ? `${d}/${e.name}` : e.name));
const names = ["deno.json", ...ts(""), ...ts("adapters")].sort();
const files = {};
let bytes = 0;
for (const n of names) {
  const buf = readFileSync(join(fnDir, n));
  bytes += buf.length;
  // A deploy retypes each file into the tool call; unicode/hex escapes come back as literal characters and break the stamp.
  const esc = buf.toString("utf8").split("\n").findIndex((l) => /(?<!\\)\\(?:u[0-9a-fA-F{]|x[0-9a-fA-F]{2})/.test(l));
  if (esc >= 0) fail(`${n}:${esc + 1} has a \\u or \\x escape; use literal characters or char codes so a retyped deploy matches`);
  files[n] = createHash("sha256").update(buf.toString("utf8").replace(/\r\n/g, "\n")).digest("hex");
}
writeFileSync(join(fnDir, ".deploy-ok.json"), JSON.stringify({ at: new Date().toISOString(), files }, null, 2) + "\n");
console.log(JSON.stringify({ ok: true, files: names, bytes }));
