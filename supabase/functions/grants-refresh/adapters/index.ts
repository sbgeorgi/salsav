// Adapter dispatch: html pages, RSS/Atom feeds, JSON APIs, with one html<->feed fallback per source per run.
import { decodeBody, extractPage, normalizeText, sha256Hex } from "../extract.ts";
import { type HttpDeps, type HttpOutcome, politeGet } from "../http.ts";
import { apiHeaders, pickProfile } from "../ua.ts";
import type { Fetched, Opportunity, Source } from "../types.ts";
import { type ApiAdapter, API_ADAPTERS } from "./api.ts";
import { looksLikeFeed, parseFeed } from "./feed.ts";

export interface FetchCtx {
  d: HttpDeps;
  today: string; // YYYY-MM-DD (UTC)
  now: Date;
}

/** null = the run's time budget ran out before the request could start. */
type Result = Fetched | null;

const hdr = (h: Headers) => ({ etag: h.get("etag"), last_modified: h.get("last-modified") });

function failure(o: Exclude<HttpOutcome, { t: "response" | "budget" }>): Fetched {
  if (o.t === "robots_blocked") return { kind: "robots_blocked", error: `robots.txt disallows ${o.url}` };
  if (o.t === "throttled") {
    return { kind: "error", http_status: o.status, error: o.status ? `HTTP ${o.status} throttled` : "request timed out", cooldownMs: o.cooldownMs, host: o.host, fallbackOk: true };
  }
  return { kind: "error", error: o.message, fallbackOk: !o.fatal };
}

function statusFailure(status: number): Fetched {
  if (status === 401) return { kind: "error", http_status: 401, error: "HTTP 401 login required", fetchability: "login_required" };
  if (status === 403) return { kind: "error", http_status: 403, error: "HTTP 403 bot protection or forbidden", fetchability: "bot_protected", fallbackOk: true };
  return { kind: "error", http_status: status, error: `HTTP ${status}`, fallbackOk: status >= 500 };
}

function oppsResult(opps: Opportunity[], status: number, h: Headers, bytes: number): Fetched {
  const unique = [...new Map(opps.map((o) => [o.external_id, o])).values()];
  const text = unique.map((o) => [o.external_id, o.title, o.deadline ?? "", o.status ?? "open"].join(" | ")).sort().join("\n");
  return { kind: "ok", http_status: status, ...hdr(h), text, links: [], opportunities: unique, isHtml: false, bytes, content_hash: "" };
}

async function finish(f: Fetched): Promise<Fetched> {
  f.content_hash ||= await sha256Hex(f.text ?? "");
  return f;
}

async function fetchPage(c: FetchCtx, src: Source, url: string, feed: boolean): Promise<Result> {
  const o = await politeGet(c.d, { url, cond: { etag: src.etag, lastModified: src.last_modified } });
  if (o.t === "budget") return null;
  if (o.t !== "response") return failure(o);
  const { status, headers, bytes } = o;
  if (status === 304) return { kind: "not_modified", http_status: 304, bytes: 0 };
  if (status < 200 || status >= 300) return statusFailure(status);
  const ct = headers.get("content-type");
  const base = { kind: "ok" as const, http_status: status, ...hdr(headers), bytes: bytes.length, truncated: o.truncated };
  if (/pdf|octet-stream|zip|officedocument|msword|excel/i.test(ct ?? "") || /\.(pdf|docx?|xlsx?|zip)(\?|$)/i.test(o.finalUrl)) {
    // documents: hash of bytes only, no parsing
    return { ...base, content_hash: await sha256Hex(bytes), text: "", links: [], isHtml: false };
  }
  const body = decodeBody(bytes, ct);
  if (feed && looksLikeFeed(ct, body)) return finish(oppsResult(parseFeed(body, c.today), status, headers, bytes.length));
  if (/^text\/plain/i.test(ct ?? "")) return finish({ ...base, text: normalizeText(body), links: [], isHtml: false });
  const { text, links } = extractPage(body, o.finalUrl);
  return finish({ ...base, text, links, isHtml: true });
}

async function fetchApi(c: FetchCtx, src: Source, api: ApiAdapter): Promise<Result> {
  const r = api.request(src, c.d.env, c.now);
  const profile = c.d.pol.profileFor(new URL(r.url).host, () => pickProfile(c.d.pol.clock.random));
  const o = await politeGet(c.d, { url: r.url, method: r.method, headers: { ...apiHeaders(profile), ...r.headers }, body: r.body, robots: false });
  if (o.t === "budget") return null;
  if (o.t !== "response") return failure(o.t === "error" ? { ...o, message: o.message.replace(/api_key=[^&\s]+/g, "api_key=***") } : o);
  if (o.status < 200 || o.status >= 300) return statusFailure(o.status);
  try {
    const opps = api.parse(JSON.parse(decodeBody(o.bytes, o.headers.get("content-type"))), src);
    return finish(oppsResult(opps, o.status, o.headers, o.bytes.length));
  } catch {
    return { kind: "error", http_status: o.status, error: "unparseable API response", fallbackOk: true };
  }
}

export async function fetchSource(c: FetchCtx, src: Source): Promise<Result> {
  const adapter = src.adapter === "sam_gov" && !c.d.env.samKey ? "html" : src.adapter;
  const feedUrl = src.feed_url && src.feed_url !== src.url ? src.feed_url : null;
  const api = API_ADAPTERS[adapter];
  const primary = api ? await fetchApi(c, src, api)
    : adapter === "rss" ? await fetchPage(c, src, src.feed_url ?? src.url, true)
    : await fetchPage(c, src, src.url, false);
  if (!primary || primary.kind !== "error" || !primary.fallbackOk) return primary;
  // one fallback: feed/API -> html page, html -> feed_url; never onto a host that is cooling down
  const alt = adapter === "html" ? (feedUrl && { url: feedUrl, feed: true }) : (api || feedUrl ? { url: src.url, feed: false } : null);
  if (!alt || c.d.pol.cooldownRemaining(new URL(alt.url).host) > 0) return primary;
  const second = await fetchPage(c, src, alt.url, alt.feed);
  return second && second.kind === "ok" ? second : primary;
}
