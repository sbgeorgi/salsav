// Polite HTTP: SSRF guard, robots.txt, per-host limiter, retry/backoff, manual redirects, capped body reads.
import { fullJitter, parseRetryAfter } from "./backoff.ts";
import { checkUrl, GuardError } from "./guard.ts";
import { type HostState, type Politeness } from "./politeness.ts";
import { isAllowed, parseRobots } from "./robots.ts";
import { pageHeaders, pickProfile } from "./ua.ts";
import type { Env } from "./types.ts";

export const MAX_READ_BYTES = 1_500_000;
export const MAX_REDIRECTS = 4;
export const MAX_TRIES = 3;
export const ROBOTS_TTL_MS = 24 * 3600 * 1000;
const MAX_ROBOTS_BYTES = 500_000;

export interface HttpDeps {
  pol: Politeness;
  fetchImpl: typeof fetch;
  fetchH1?: typeof fetch; // HTTP/1.1-only fetch, used once after an HTTP/2 stream/connection error
  env: Env;
  deadline: number; // epoch ms: never wait or request past this
  requestTimeoutMs: number;
  maxTries?: number;
}

export interface Req {
  url: string;
  method?: "GET" | "POST";
  headers?: Record<string, string>; // extra headers; page headers are used when omitted
  body?: string | FormData;
  cond?: { etag?: string | null; lastModified?: string | null };
  robots?: boolean; // default true; API adapters pass false
  sameHostOnly?: boolean; // detail pages: a redirect to another hostname (or https to http) is an error, not followed
}

export type HttpOutcome =
  | { t: "response"; status: number; headers: Headers; bytes: Uint8Array; truncated: boolean; finalUrl: string }
  | { t: "robots_blocked"; url: string }
  | { t: "throttled"; status: number | null; retryAfterMs: number | null; cooldownMs: number; host: string }
  | { t: "budget" }
  | { t: "error"; message: string; fatal?: boolean }; // fatal: guard violation, never worth a fallback

async function readBody(res: Response, max: number): Promise<{ bytes: Uint8Array; truncated: boolean }> {
  if (!res.body) return { bytes: new Uint8Array(0), truncated: false };
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  let truncated = false;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    total += value.length;
    if (total >= max) {
      truncated = total > max || !(await reader.read()).done;
      await reader.cancel().catch(() => {});
      break;
    }
  }
  const bytes = new Uint8Array(Math.min(total, max));
  let off = 0;
  for (const c of chunks) {
    const take = Math.min(c.length, bytes.length - off);
    bytes.set(c.subarray(0, take), off);
    off += take;
  }
  return { bytes, truncated };
}

/** Error text with its cause chain (Deno puts the real reason, e.g. a decode or reset error, in the cause). */
function errText(e: Error): string {
  const parts: string[] = [];
  for (let x: unknown = e, i = 0; x && i < 4; x = (x as Error).cause, i++) {
    const m = x instanceof Error ? x.message : String(x);
    if (m && !parts.includes(m)) parts.push(m);
  }
  return parts.join(": ").slice(0, 300) || "fetch failed";
}

const H2_ERROR = /stream error|connection error|http2|h2 protocol|error reading a body/i;

type Attempt = Extract<HttpOutcome, { t: "response" | "throttled" | "budget" | "error" }>;

async function attempt(d: HttpDeps, u: URL, req: Req, maxRead: number): Promise<Attempt> {
  const { pol } = d;
  const clock = pol.clock;
  const tries = d.maxTries ?? MAX_TRIES;
  let lastRa: number | null = null;
  let lastStatus: number | null = null;
  for (let i = 0; i < tries; i++) {
    const release = await pol.acquire(u.host, d.deadline);
    if (!release) return { t: "budget" };
    let res: { status: number; headers: Headers; bytes: Uint8Array; truncated: boolean } | null = null;
    let failure: "timeout" | string | null = null;
    try {
      const headers = { ...(req.headers ?? pageHeaders(pol.profileFor(u.host, () => pickProfile(clock.random)), req.cond)) };
      const signal = AbortSignal.timeout(Math.min(d.requestTimeoutMs, Math.max(1000, d.deadline - clock.now())));
      const go = async (f: typeof fetch) => {
        const r = await f(u.href, { method: req.method ?? "GET", headers, body: req.body, redirect: "manual", signal });
        const isRedirect = r.status >= 300 && r.status < 400;
        if (isRedirect) await r.body?.cancel().catch(() => {});
        const body = isRedirect ? { bytes: new Uint8Array(0), truncated: false } : await readBody(r, maxRead);
        return { status: r.status, headers: r.headers, ...body };
      };
      try {
        res = await go(d.fetchImpl);
      } catch (e) {
        // some hosts reset HTTP/2 streams for our client only: one retry over HTTP/1.1 (same guards, same limiter slot)
        if (!d.fetchH1 || !H2_ERROR.test(errText(e as Error))) throw e;
        res = await go(d.fetchH1);
      }
    } catch (e) {
      failure = (e as Error).name === "TimeoutError" || (e as Error).name === "AbortError" ? "timeout" : errText(e as Error);
    } finally {
      release();
    }
    if (failure && failure !== "timeout") return { t: "error", message: failure };
    if (res && res.status !== 429 && res.status !== 503) {
      pol.ok(u.host);
      return { t: "response", ...res, finalUrl: u.href };
    }
    lastStatus = res?.status ?? null;
    lastRa = res ? parseRetryAfter(res.headers.get("retry-after"), clock.now()) : null;
    pol.throttle(u.host, lastRa ?? fullJitter(i, clock.random));
  }
  return { t: "throttled", status: lastStatus, retryAfterMs: lastRa, cooldownMs: pol.exhaust(u.host, lastRa), host: u.host };
}

async function loadRobots(d: HttpDeps, u: URL, h: HostState): Promise<Extract<HttpOutcome, { t: "throttled" | "budget" | "error" }> | null> {
  const now = d.pol.clock.now();
  if (h.robotsText === null || h.robotsFetchedAt === null || now - h.robotsFetchedAt > ROBOTS_TTL_MS) {
    const out = await politeGet(d, { url: `${u.origin}/robots.txt`, robots: false });
    let text = "";
    if (out.t === "response") {
      if (out.status >= 500) return { t: "error", message: `robots.txt unavailable (HTTP ${out.status})` };
      if (out.status < 300) text = new TextDecoder().decode(out.bytes.subarray(0, MAX_ROBOTS_BYTES)).replace(/\0/g, "");
    } else if (out.t === "robots_blocked") {
      return { t: "error", message: "robots.txt redirect blocked" };
    } else return out;
    h.robotsText = text;
    h.robotsFetchedAt = d.pol.clock.now();
    h.robotsDirty = true;
  }
  h.robots = parseRobots(h.robotsText);
  h.crawlDelayMs = (h.robots.crawlDelayS ?? 0) * 1000;
  return null;
}

const CROSS_ORIGIN_HEADERS = new Set(["accept", "accept-language", "accept-encoding", "user-agent"]);
/** Credentials and custom headers (X-Api-Key, Authorization, ...) must not follow a redirect to another origin. */
function stripCustom(h?: Record<string, string>): Record<string, string> | undefined {
  return h && Object.fromEntries(Object.entries(h).filter(([k]) => CROSS_ORIGIN_HEADERS.has(k.toLowerCase())));
}

/** Fetch with all politeness rules. Redirects are followed manually; every hop is guarded and limited per host. */
export async function politeGet(d: HttpDeps, req: Req, maxRead = MAX_READ_BYTES): Promise<HttpOutcome> {
  let url = req.url;
  const origin0 = new URL(req.url).origin;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    let u: URL;
    try {
      u = checkUrl(url, d.env.allowLocal);
    } catch (e) {
      if (e instanceof GuardError) return { t: "error", message: e.message, fatal: true };
      throw e;
    }
    if (req.robots !== false) {
      const h = await d.pol.ensure(u.host);
      const bad = await loadRobots(d, u, h);
      if (bad) return bad;
      if (!isAllowed(h.robots!, u.pathname + u.search)) return { t: "robots_blocked", url: u.href };
    }
    const r = await attempt(d, u, hop === 0 ? req : { ...req, cond: undefined, headers: u.origin === origin0 ? req.headers : stripCustom(req.headers) }, maxRead);
    if (r.t !== "response") return r;
    const loc = r.headers.get("location");
    if (r.status >= 300 && r.status < 400 && r.status !== 304 && loc) {
      if (req.method === "POST" && r.status !== 307 && r.status !== 308) return { t: "error", message: `unexpected redirect on POST (${r.status})` };
      const next = new URL(loc, u);
      if (req.method === "POST" && next.origin !== origin0) return { t: "error", message: "cross-origin redirect on POST refused" };
      if (req.sameHostOnly && !(next.hostname === u.hostname && (next.protocol === u.protocol || (u.protocol === "http:" && next.protocol === "https:")))) return { t: "error", message: "redirect to another host refused" };
      url = next.href;
      continue;
    }
    return r;
  }
  return { t: "error", message: `too many redirects (>${MAX_REDIRECTS})` };
}
