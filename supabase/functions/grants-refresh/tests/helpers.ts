// Test lab: per-file Postgres database, mock multi-host HTTP server, scaled clock.
import { readFileSync } from "node:fs";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import postgres from "postgres";
import { type Clock, realClock } from "../types.ts";
import type { Env } from "../types.ts";

const ADMIN_URL = process.env.DATABASE_URL ?? "postgres://postgres:pw@localhost:54329/postgres";
const SQL_DIR = new URL("../../../grants/", import.meta.url);
export const TOKEN = "test-token-123";
export const ENV: Env = { allowLocal: true };

let dbCounter = 0;

export async function createDb(label: string) {
  const name = `grants_test_${label}_${process.pid}_${++dbCounter}`.replace(/[^a-z0-9_]/gi, "_");
  const admin = postgres(ADMIN_URL, { max: 1, onnotice: () => {} });
  await admin.unsafe(`create database ${name}`);
  await admin.end();
  const url = ADMIN_URL.replace(/\/[^/]*$/, `/${name}`);
  const sql = postgres(url, { max: 8, onnotice: () => {} });
  await sql.unsafe("create schema extensions; create extension pgcrypto schema extensions;");
  for (const f of ["001_schema.sql", "002_api.sql"]) await sql.unsafe(readFileSync(new URL(f, SQL_DIR), "utf8"));
  await sql`insert into grants.settings(key, value) values ('refresh_token_sha256', to_jsonb(encode(extensions.digest(${TOKEN}, 'sha256'), 'hex')))`;
  return {
    sql, url, name,
    async drop() {
      await sql.end({ timeout: 2 });
      const a = postgres(ADMIN_URL, { max: 1, onnotice: () => {} });
      await a.unsafe(`drop database if exists ${name} with (force)`);
      await a.end();
    },
  };
}

type Sql = ReturnType<typeof postgres>;

export interface FunderSeed {
  url: string;
  name?: string;
  cycle?: string;
  adapter?: string;
  adapter_config?: object;
  feed_url?: string | null;
  etag?: string | null;
  content_hash?: string | null;
  next_deadline?: string | null;
}

let funderCounter = 0;
export async function addFunder(sql: Sql, f: FunderSeed): Promise<string> {
  const n = ++funderCounter;
  const [r] = await sql`insert into grants.funders(name, category, url, feed_url, cycle, adapter, adapter_config, status, vetted_at, vet_note, fit_score, fit_reasons, next_deadline)
    values (${f.name ?? `Funder ${n}`}, 'foundation', ${f.url}, ${f.feed_url ?? null}, ${f.cycle ?? "fixed_deadline"}, ${f.adapter ?? "html"},
            ${sql.json((f.adapter_config ?? {}) as never)}, 'vetted', now(), 'test', 60, ${sql.array(["test"])}, ${f.next_deadline ?? null}) returning id`;
  return r.id;
}

/** Virtual time runs `k` times faster than the wall clock; sleeps are shortened accordingly. */
export function scaledClock(k: number): Clock {
  const t0 = Date.now();
  return {
    now: () => t0 + (Date.now() - t0) * k,
    sleep: (ms) => new Promise((r) => setTimeout(r, Math.max(0, ms / k))),
    random: Math.random,
  };
}
export { realClock };

export interface Hit {
  host: string; // e.g. 127.0.0.2:PORT
  path: string;
  method: string;
  t: number; // wall ms at request start
  headers: IncomingMessage["headers"];
  inflight: number;
}
export interface Reply {
  status?: number;
  headers?: Record<string, string>;
  body?: string | Buffer;
  delayMs?: number;
  destroy?: boolean;
}
export type Route = Reply | ((hit: Hit, req: IncomingMessage) => Reply);

/** Many loopback hosts (127.0.0.2..) on one port, with per-request logging and routes per host+path. */
export class Mock {
  hits: Hit[] = [];
  routes = new Map<string, Route>();
  maxInflight = new Map<string, number>();
  maxGlobal = 0;
  private globalIn = 0;
  private inflight = new Map<string, number>();
  private servers: Server[] = [];
  port = 0;
  private hostCount: number;
  constructor(hostCount: number) {
    this.hostCount = hostCount;
  }

  host(i: number): string {
    return `127.0.0.${i + 2}:${this.port}`;
  }
  url(i: number, path = "/"): string {
    return `http://${this.host(i)}${path}`;
  }
  route(i: number, path: string, r: Route) {
    this.routes.set(`${this.host(i)}${path}`, r);
  }
  hitsFor(i: number, filter?: (h: Hit) => boolean) {
    return this.hits.filter((h) => h.host === this.host(i) && (!filter || filter(h)));
  }
  contentHits(i: number) {
    return this.hitsFor(i, (h) => h.path !== "/robots.txt");
  }
  /** Gaps in ms between consecutive request starts to host i. */
  gaps(i: number): number[] {
    const h = this.hitsFor(i);
    return h.slice(1).map((x, j) => x.t - h[j].t);
  }

  async start() {
    for (let i = 0; i < this.hostCount; i++) {
      const s = createServer((req, res) => void this.serve(req, res));
      await new Promise<void>((ok, bad) => {
        s.once("error", bad);
        s.listen(this.port, `127.0.0.${i + 2}`, () => ok());
      });
      if (i === 0) this.port = (s.address() as { port: number }).port;
      this.servers.push(s);
    }
    return this;
  }

  private async serve(req: IncomingMessage, res: ServerResponse) {
    const host = req.headers.host!;
    const path = req.url!;
    const n = (this.inflight.get(host) ?? 0) + 1;
    this.inflight.set(host, n);
    this.maxGlobal = Math.max(this.maxGlobal, ++this.globalIn);
    this.maxInflight.set(host, Math.max(this.maxInflight.get(host) ?? 0, n));
    const hit: Hit = { host, path, method: req.method!, t: Date.now(), headers: req.headers, inflight: n };
    this.hits.push(hit);
    try {
      const route = this.routes.get(`${host}${path}`) ?? this.routes.get(`${host}${path.split("?")[0]}`);
      let r: Reply = route ? (typeof route === "function" ? route(hit, req) : route) : path === "/robots.txt" ? { status: 404 } : { body: `<html><body><main><p>${host}${path}</p></main></body></html>`, headers: { "content-type": "text/html" } };
      if (r.delayMs) await new Promise((ok) => setTimeout(ok, r.delayMs));
      if (r.destroy) return void req.socket.destroy();
      res.writeHead(r.status ?? 200, { "content-type": "text/html; charset=utf-8", ...r.headers });
      res.end(r.body ?? "");
    } finally {
      this.inflight.set(host, (this.inflight.get(host) ?? 1) - 1);
      this.globalIn--;
    }
  }

  async stop() {
    await Promise.all(this.servers.map((s) => new Promise<void>((ok) => { s.closeAllConnections?.(); s.close(() => ok()); })));
  }
}

export const page = (body: string, title = "Funding") =>
  `<html><head><title>${title}</title></head><body><nav>Home About</nav><main>${body}</main><footer>(c) 2026 Foo</footer></body></html>`;

/** Dates relative to now (the deadline horizon is 30 months, so fixed far-future dates do not work). */
function inDays(n: number) {
  const d = new Date(Date.now() + n * 864e5);
  return { iso: d.toISOString().slice(0, 10), long: d.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric", timeZone: "UTC" }) };
}
export const SOON = inDays(120);
export const SOON2 = inDays(150);
