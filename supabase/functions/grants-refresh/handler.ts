// HTTP layer: method + token auth, body validation, engine run, self-chaining. Portable (no Deno globals).
import { type EngineDeps, runShard } from "./engine.ts";
import { makeStore, type Sql } from "./store.ts";
import type { Clock, Env, RunRequest } from "./types.ts";

export interface HandlerDeps {
  makeSql: () => Sql;
  env: Env;
  clock: Clock;
  fetchImpl: typeof fetch;
  fetchH1?: typeof fetch;
  supabaseUrl?: string; // enables self-chaining
  waitUntil?: (p: Promise<unknown>) => void;
  engine?: Partial<EngineDeps>; // test overrides (politeness, timeouts, lease)
}

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const int = (v: unknown, def: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, Number.isFinite(Number(v)) && v !== null && v !== undefined ? Math.trunc(Number(v)) : def));
const TOKEN_FORMAT = /^[A-Za-z0-9._~-]{8,128}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function parseRequest(b: Record<string, unknown>): RunRequest | string {
  const shards = int(b.shards, 1, 1, 64);
  const shard = int(b.shard, 0, 0, 63);
  if (shard >= shards) return `bad shard ${shard}/${shards}`;
  const only = Array.isArray(b.only_ids) ? b.only_ids.map(String) : undefined;
  if (only?.some((x) => !UUID.test(x))) return "only_ids must be uuids";
  return {
    shard, shards, trigger: typeof b.trigger === "string" ? b.trigger.slice(0, 40) : "manual",
    budget_ms: int(b.budget_ms, 100_000, 1000, 140_000), max_sources: int(b.max_sources, 12, 1, 50),
    chain_depth: int(b.chain_depth, 0, 0, 100), dry_run: b.dry_run === true, only_ids: only,
    parent_run: typeof b.parent_run === "string" && UUID.test(b.parent_run) ? b.parent_run : null,
  };
}

export async function handle(req: Request, deps: HandlerDeps): Promise<Response> {
  if (req.method !== "POST") return new Response("method not allowed", { status: 405, headers: { allow: "POST" } });
  const token = req.headers.get("x-grants-token");
  if (!token || !TOKEN_FORMAT.test(token)) return json(401, { error: "unauthorized" }); // malformed tokens never reach the DB
  let sql: Sql | undefined;
  try {
    sql = deps.makeSql();
    const store = makeStore(sql);
    if (!(await store.checkToken(token))) return json(401, { error: "unauthorized" });
    let body: Record<string, unknown> = {};
    try {
      const t = await req.text();
      body = t ? JSON.parse(t) : {};
    } catch {
      return json(400, { error: "invalid JSON body" });
    }
    const rr = parseRequest(body);
    if (typeof rr === "string") return json(400, { error: rr });
    const canChain = !!deps.supabaseUrl && !rr.dry_run;
    const result = await runShard({ store, clock: deps.clock, fetchImpl: deps.fetchImpl, fetchH1: deps.fetchH1, env: deps.env, canChain, ...deps.engine }, rr);
    if (result.stats.chained) {
      const next = { ...rr, chain_depth: rr.chain_depth + 1, trigger: "chain", parent_run: result.run_id };
      const p = deps.fetchImpl(`${deps.supabaseUrl}/functions/v1/grants-refresh`, {
        method: "POST", headers: { "content-type": "application/json", "x-grants-token": token }, body: JSON.stringify(next),
        signal: AbortSignal.timeout(5000), // we only need the request to land; the next run is its own invocation
      }).then((r) => r.body?.cancel()).catch(() => {});
      if (deps.waitUntil) deps.waitUntil(p);
      else await p;
    }
    return json(200, { ok: true, ...result });
  } catch (e) {
    console.error("grants-refresh: unhandled", (e as Error)?.stack ?? e); // detail stays in the function logs; callers get nothing
    return json(500, { ok: false, error: "internal" });
  } finally {
    await sql?.end({ timeout: 5 }).catch(() => {});
  }
}
