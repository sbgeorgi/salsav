// Adapter dispatch: html pages (with optional list/self call extraction), RSS/Atom feeds, JSON APIs,
// with one html<->feed fallback per source per run. Extraction helpers live in collect.ts and api.ts.
import * as cheerio from "cheerio";
import { configRegex, type DateOrder, decodeBody, extractPage, findDeadlines, MAX_PARSE_CHARS, normalizeText, PageWorkError, regexDeadline, sha256Hex } from "../extract.ts";
import { type HttpDeps, type HttpOutcome, politeGet } from "../http.ts";
import { newBudget, type RegexBudget, RegexBudgetError, regexSyntaxProblem } from "../safe_regex.ts";
import { apiHeaders, pickProfile, type Profile } from "../ua.ts";
import type { Fetched, Link, Opportunity, Source } from "../types.ts";
import { type ApiAdapter, API_ADAPTERS } from "./api.ts";
import { callsSection, extractList, type FilterCfg, finalize, type ListCfg, matchesFilter, selfCycle } from "./collect.ts";
import { looksLikeFeed, parseFeed } from "./feed.ts";

export interface FetchCtx {
  d: HttpDeps;
  today: string; // YYYY-MM-DD (UTC)
  now: Date;
  /** Regex step budget of this source (one per source fetch, shared by every pattern call); fetchSource makes one when absent. */
  budget?: RegexBudget;
}
type Ctx = FetchCtx & { budget: RegexBudget };

/** null = the run's time budget ran out before the request could start. */
type Result = Fetched | null;
type Cfg = Record<string, unknown>;

/** Adapters whose feed carries a real status (open, forecasted, closed); the rest get status from the deadline. */
const NATIVE_STATUS = new Set(["grants_gov", "eu_ft"]);

const isObj = (v: unknown): v is Cfg => typeof v === "object" && v !== null && !Array.isArray(v);
const hdr = (h: Headers) => ({ etag: h.get("etag"), last_modified: h.get("last-modified") });

/** A page of 5000+ HTML chars with under 300 chars of text is probably built by JavaScript. */
const thinPage = (textLen: number, htmlLen: number): boolean => textLen < 300 && htmlLen >= 5000;

/** Stored page text plus the calls section, only when there are calls (so the hash moves with the list). */
const withCalls = (text: string, opps: Opportunity[]): string => (opps.length ? `${text}\n\n${callsSection(opps)}` : text);

/** Why a config regex is refused (safe_regex.ts dialect), as a config error, or null when it is accepted. */
const badRegex = (what: string, s: string): string | null => {
  const why = regexSyntaxProblem(s);
  return why === null ? null : `${what} is not a valid regex: ${why}`;
};

/** deadline_regex reads group 1: the source needs a capturing group. */
const CAPTURE_MSG = "deadline_regex needs one capturing group around the date";
const hasCapture = (s: string): boolean => configRegex(s).captures >= 1; // only after badRegex accepted s

const validSelector = (s: string): boolean => {
  try {
    cheerio.load("")(s);
    return true;
  } catch {
    return false;
  }
};

/** Selector constructs that cost quadratic CPU on a large page (cheerio has no budget): ":has(" and the "~" sibling combinator ([a~=b] stays allowed). */
const heavySelector = (s: string): boolean => {
  const bare = s.replace(/"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'/g, '""').replace(/\[[^\]]*\]/g, "[]");
  return /:has\(/i.test(bare) || bare.includes("~");
};

/** Path of the first string holding a control character other than tab, newline or carriage return, or null. */
function controlCharPath(v: unknown, path: string): string | null {
  // char codes, not escapes: deploys retype source and escapes drift (2026-11-12); tab, LF and CR are allowed
  if (typeof v === "string") return [...v].some((c) => { const n = c.charCodeAt(0); return n < 32 && n !== 9 && n !== 10 && n !== 13; }) ? path : null;
  if (Array.isArray(v)) {
    for (let i = 0; i < v.length; i++) {
      const p = controlCharPath(v[i], `${path}[${i}]`);
      if (p) return p;
    }
  } else if (isObj(v)) {
    for (const [k, x] of Object.entries(v)) {
      const p = controlCharPath(x, `${path}.${k}`);
      if (p) return p;
    }
  }
  return null;
}

/** First problem with the funder's adapter_config, or null. Checked before any request, so a bad config never throws. */
export function configError(cfg: Cfg, src: Source): string | null {
  // A JSON "\b" decodes to a backspace, so a regex word boundary written that way silently never matches.
  const ctl = controlCharPath(cfg, "adapter_config");
  if (ctl) return `${ctl} contains a control character; a regex word boundary must be written "\\\\b" in JSON`;
  for (const k of ["list", "self", "filter"]) {
    const v = cfg[k];
    if (v !== undefined && v !== null && !isObj(v)) return `${k} must be an object`;
  }
  if (cfg.max_items !== undefined && cfg.max_items !== null && typeof cfg.max_items !== "number") return "max_items must be a number";
  if (cfg.date_order !== undefined && cfg.date_order !== null && cfg.date_order !== "dmy" && cfg.date_order !== "mdy") return 'date_order must be "dmy" or "mdy"';

  const list = cfg.list;
  if (isObj(list)) {
    for (const k of ["url", "item", "match", "skip", "title", "link", "date", "closed"]) {
      const v = list[k];
      if (v !== undefined && v !== null && typeof v !== "string") return `list.${k} must be a string`;
    }
    if (list.date_label !== undefined && list.date_label !== null && typeof list.date_label !== "boolean") return "list.date_label must be true or false";
    if (list.amount !== undefined && list.amount !== null && typeof list.amount !== "boolean") return "list.amount must be true or false";
    const det = list.detail;
    if (det !== undefined && det !== null && typeof det !== "boolean" && typeof det !== "number" && !isObj(det)) return "list.detail must be true, a number or an object";
    if (isObj(det)) {
      for (const k of ["deadline_regex", "closed"]) {
        const v = det[k];
        if (v === undefined || v === null) continue;
        if (typeof v !== "string") return `list.detail.${k} must be a string`;
        const bad = badRegex(`list.detail.${k}`, v) ?? (k === "deadline_regex" && !hasCapture(v) ? CAPTURE_MSG : null);
        if (bad) return bad;
      }
    }
    const item = typeof list.item === "string" ? list.item.trim() : "";
    const match = typeof list.match === "string" ? list.match.trim() : "";
    if (!item && !match) return "list needs item (a CSS selector) or match (a regex)";
    for (const k of ["item", "title", "link", "date"]) {
      const v = list[k];
      if (typeof v === "string" && v.trim() && !validSelector(v)) return `list.${k} is not a valid CSS selector`;
      if (typeof v === "string" && heavySelector(v)) return `list.${k} uses :has( or the ~ sibling combinator, which is too slow on a large page; use a simpler selector`;
    }
    for (const k of ["match", "skip", "closed"]) {
      const v = list[k];
      const bad = typeof v === "string" && v ? badRegex(`list.${k}`, v) : null;
      if (bad) return bad;
    }
    if (typeof list.url === "string" && list.url) {
      try {
        new URL(list.url, src.url);
      } catch {
        return "list.url is not a valid URL";
      }
    }
  }

  const self = cfg.self;
  if (isObj(self) && self.title !== undefined && self.title !== null && typeof self.title !== "string") return "self.title must be a string";
  if (isObj(self) && self.assume_next_year !== undefined && typeof self.assume_next_year !== "boolean") return "self.assume_next_year must be true or false";
  for (const v of [isObj(self) ? self.deadline_regex : undefined, cfg.deadline_regex]) {
    if (v === undefined || v === null) continue;
    if (typeof v !== "string") return "deadline_regex must be a string";
    const bad = badRegex("deadline_regex", v) ?? (hasCapture(v) ? null : CAPTURE_MSG);
    if (bad) return bad;
  }

  const filter = cfg.filter;
  if (isObj(filter)) {
    for (const k of ["any", "all", "none"]) {
      const v = filter[k];
      if (v === undefined || v === null) continue;
      if (!Array.isArray(v) || !v.every((t) => typeof t === "string")) return `filter.${k} must be a list of strings`;
      for (const t of v as string[]) {
        const bad = t.startsWith("re:") ? badRegex(`filter.${k} term "${t.slice(0, 40)}"`, t.slice(3)) : null;
        if (bad) return bad;
      }
    }
    if (filter.fields !== undefined && filter.fields !== "title" && filter.fields !== "title+description") return "filter.fields must be title or title+description";
  }
  return null;
}

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

/** A fetched page: the outcome, plus the decoded HTML and final URL for html pages (used for list extraction). */
interface PageGet {
  r: Result;
  body?: string;
  finalUrl?: string;
  /** the page's visible text with nothing removed or collapsed: the input of every config pattern (r.text is the volatile-free text for hashing) */
  raw?: string;
}

async function fetchPageFull(c: Ctx, src: Source, url: string, feed: boolean, cond: boolean, sameHostOnly = false): Promise<PageGet> {
  const o = await politeGet(c.d, { url, cond: cond ? { etag: src.etag, lastModified: src.last_modified } : undefined, sameHostOnly });
  if (o.t === "budget") return { r: null };
  if (o.t !== "response") return { r: failure(o) };
  const { status, headers, bytes } = o;
  if (status === 304) return { r: { kind: "not_modified", http_status: 304, bytes: 0 } };
  if (status < 200 || status >= 300) return { r: statusFailure(status) };
  const ct = headers.get("content-type");
  const base = { kind: "ok" as const, http_status: status, ...hdr(headers), bytes: bytes.length, truncated: o.truncated };
  if (/pdf|octet-stream|zip|officedocument|msword|excel/i.test(ct ?? "") || /\.(pdf|docx?|xlsx?|zip)(\?|$)/i.test(o.finalUrl)) {
    // documents: hash of bytes only, no parsing
    return { r: { ...base, content_hash: await sha256Hex(bytes), text: "", links: [], isHtml: false } };
  }
  const body = decodeBody(bytes, ct);
  if (feed && looksLikeFeed(ct, body)) {
    const listed = parseFeed(body, c.today);
    const items = finalize(listed, src.adapter_config, c.today, false, c.budget);
    return { r: await finish({ ...oppsResult(items, status, headers, bytes.length), raw_count: listed.length }) };
  }
  if (/^text\/plain/i.test(ct ?? "")) return { r: await finish({ ...base, text: normalizeText(body), links: [], isHtml: false }), raw: body };
  const { text, links, raw } = extractPage(body, o.finalUrl);
  return {
    raw,
    r: await finish({ ...base, text, links, isHtml: true, fetchability: thinPage(text.length, body.length) ? "js_required" : "easy" }),
    body,
    finalUrl: o.finalUrl,
  };
}

async function fetchPage(c: Ctx, src: Source, url: string, feed: boolean): Promise<Result> {
  return (await fetchPageFull(c, src, url, feed, true)).r;
}

/** adapter_config.also_page: the funder page adds text and links next to the feed or API items. Failure is ignored. */
async function withPage(c: Ctx, src: Source, base: Fetched): Promise<Fetched> {
  if (src.adapter_config?.also_page !== true) return finish(base);
  const page = await fetchPageFull(c, src, src.url, false, false).catch((): PageGet => ({ r: null }));
  if (page.r?.kind !== "ok" || !page.r.isHtml) return finish(base);
  return finish({ ...base, text: withCalls(page.r.text ?? "", base.opportunities ?? []), links: page.r.links ?? [], content_hash: "" });
}

/** grants_gov detail: best effort. Any stop (budget, HTTP error, bad JSON) ends enrichment quietly. */
async function enrichDetail(c: Ctx, detail: NonNullable<ApiAdapter["detail"]>, src: Source, opps: Opportunity[], profile: Profile): Promise<void> {
  const limit = detail.limit(src);
  let eligible = 0;
  for (const o of opps) {
    if (o.status !== "open" && o.status !== "forecasted") continue;
    if (eligible++ >= limit) return;
    const dr = detail.request(o, src, c.d.env);
    if (!dr) continue;
    let out: HttpOutcome;
    try {
      out = await politeGet(c.d, { url: dr.url, method: dr.method, headers: { ...apiHeaders(profile), ...dr.headers }, body: dr.body, robots: false });
    } catch {
      return;
    }
    if (out.t !== "response" || out.status < 200 || out.status >= 300) return;
    try {
      detail.apply(o, JSON.parse(decodeBody(out.bytes, out.headers.get("content-type"))));
    } catch {
      return;
    }
  }
}

async function fetchApi(c: Ctx, src: Source, api: ApiAdapter, cfg: Cfg): Promise<Result> {
  const r = api.request(src, c.d.env, c.now);
  const profile = c.d.pol.profileFor(new URL(r.url).host, () => pickProfile(c.d.pol.clock.random));
  const o = await politeGet(c.d, { url: r.url, method: r.method, headers: { ...apiHeaders(profile), ...r.headers }, body: r.body, robots: false });
  if (o.t === "budget") return null;
  if (o.t !== "response") return failure(o.t === "error" ? { ...o, message: o.message.replace(/api_key=[^&\s]+/g, "api_key=***") } : o);
  if (o.status < 200 || o.status >= 300) return statusFailure(o.status);
  let opps: Opportunity[];
  try {
    opps = api.parse(JSON.parse(decodeBody(o.bytes, o.headers.get("content-type"))), src, c.today, c.budget);
  } catch (e) {
    if (e instanceof RegexBudgetError) throw e;
    return { kind: "error", http_status: o.status, error: "unparseable API response", fallbackOk: true };
  }
  if (api.detail && src.adapter === "grants_gov") await enrichDetail(c, api.detail, src, opps, profile);
  const items = finalize(opps, cfg, c.today, NATIVE_STATUS.has(src.adapter), c.budget);
  return withPage(c, src, { ...oppsResult(items, o.status, o.headers, o.bytes.length), raw_count: opps.length });
}

async function fetchRss(c: Ctx, src: Source): Promise<Result> {
  const f = await fetchPage(c, src, src.feed_url ?? src.url, true);
  return f && f.kind === "ok" && Array.isArray(f.opportunities) ? withPage(c, src, f) : f;
}

/** Hard cap on list.detail page fetches per source per run (each is a polite request with spacing). */
const MAX_DETAIL = 5;

/** list.detail: true = 3 pages, a number or { max } = that many (cap 5); 0 or absent = no detail hops. */
function detailCfg(detail: unknown): { max: number; rx: string; closed: string } {
  const o = isObj(detail) ? detail : {};
  const raw = detail === true ? 3 : typeof detail === "number" ? detail : o.max === true ? 3 : typeof o.max === "number" ? o.max : 0;
  const max = Number.isFinite(raw) ? Math.max(0, Math.min(Math.floor(raw), MAX_DETAIL)) : 0;
  return { max, rx: typeof o.deadline_regex === "string" ? o.deadline_regex : "", closed: typeof o.closed === "string" ? o.closed : "" };
}

/**
 * The calls that get a detail hop today. Up to the cap all of them; beyond it the first always gets one and the remaining hops
 * rotate through the others by day number (days since 1970-01-01), so every call is visited within a few days. Same day, same picks.
 */
export function pickHops<T>(calls: T[], max: number, today: string): T[] {
  if (calls.length <= max) return calls;
  const rest = calls.slice(1), k = max - 1;
  const day = Math.floor(Date.parse(`${today}T00:00:00Z`) / 86_400_000);
  return [calls[0], ...Array.from({ length: k }, (_, i) => rest[(day * k + i) % rest.length])];
}

/**
 * list.detail: GET each listed call's own page (same host as the listing, bounded) and read its deadline and status.
 * Mutates the items in place. A failed detail keeps the item as listed; a time budget or throttle ends the phase.
 * Returns the listed deadline and status of each visited item: the hash and diff text is built from those, so the day-based hop
 * rotation never changes the stored text (the opportunities sent to the database keep the detail values).
 */
async function enrichListDetail(c: Ctx, src: Source, detail: unknown, opps: Opportunity[], listPage: string, order?: DateOrder): Promise<Map<Opportunity, { deadline: Opportunity["deadline"]; status: Opportunity["status"] }>> {
  const asListed = new Map<Opportunity, { deadline: Opportunity["deadline"]; status: Opportunity["status"] }>();
  const { max, rx, closed } = detailCfg(detail);
  if (!max) return asListed;
  const closedRe = closed ? configRegex(closed) : null;
  const host = new URL(listPage).host;
  // calls whose listed deadline has already passed need no page; undated calls are visited first so the hops go where a date is missing
  const todo = opps.filter((o) => !(o.deadline && o.deadline < c.today)).sort((a, b) => Number(!!a.deadline) - Number(!!b.deadline));
  const n = { ok: 0, failed: 0, offhost: 0 };
  const onHost = todo.filter((o) => o.url && new URL(o.url).host === host);
  n.offhost = todo.filter((o) => o.url).length - onHost.length;
  for (const o of pickHops(onHost, max, c.today)) {
    const page = await fetchPageFull(c, src, o.url, false, false, true).catch((): PageGet => ({ r: null }));
    if (!page.r) break; // time budget
    if (page.r.kind !== "ok") {
      n.failed++;
      if (page.r.cooldownMs) break; // throttled: no more detail requests this run
      continue;
    }
    n.ok++;
    asListed.set(o, { deadline: o.deadline, status: o.status });
    const text = (page.r.text ?? "").slice(0, MAX_PARSE_CHARS);
    const raw = page.raw ?? text; // config patterns see the page text unaltered
    // a future date from either the regex or the labelled dates wins; else a past date is kept only for a call the listing left undated, so it reads as closed
    const rxDate = rx ? regexDeadline(raw, rx, c.today, order, c.budget) : null;
    const labelled = findDeadlines(text, c.today);
    const future = [rxDate, labelled.future].filter((d): d is string => !!d && d >= c.today).sort()[0];
    const past = [rxDate, labelled.primary].filter((d): d is string => !!d && d < c.today).sort().pop();
    const d = future ?? (o.deadline ? null : past); // a past-only detail date never replaces a date the listing gave
    if (d) o.deadline = d;
    if (closedRe?.test(raw.slice(0, MAX_PARSE_CHARS), c.budget)) o.status = "closed";
  }
  console.error(JSON.stringify({ source: src.id, detail_ok: n.ok, detail_failed: n.failed, detail_offhost: n.offhost }));
  return asListed;
}

/** html with list and/or self: the list page is the primary fetch when list.url differs from the funder url. */
async function fetchHtmlCalls(c: Ctx, src: Source, cfg: Cfg): Promise<Result> {
  const list = isObj(cfg.list) ? (cfg.list as ListCfg) : null;
  const self = isObj(cfg.self) ? (cfg.self as { title?: string }) : null;
  const listUrl = list?.url ? new URL(list.url, src.url).href : null;
  const sep = listUrl && listUrl !== src.url ? listUrl : null;

  // with detail hops a 304 would end the run before any hop, so the rotation and call-page changes would never be seen: no conditional request
  const first = await fetchPageFull(c, src, sep ?? src.url, false, !(list && detailCfg(list.detail).max > 0));
  if (!first.r) return null;
  if (first.r.kind !== "ok") return first.r;
  let text = first.r.text ?? "";
  let raw = first.raw ?? text;
  let links: Link[] = first.r.links ?? [];
  let htmlLen = first.body?.length ?? 0;
  if (sep) {
    // the funder page supplies text and links; if it fails, the listing page's own text stands
    const second = await fetchPageFull(c, src, src.url, false, false).catch((): PageGet => ({ r: null }));
    if (second.r?.kind === "ok" && second.r.isHtml) {
      text = second.r.text ?? "";
      raw = second.raw ?? text;
      links = second.r.links ?? [];
      htmlLen = second.body?.length ?? 0;
    }
  }
  const found: Opportunity[] = [];
  const listPage = first.finalUrl ?? sep ?? src.url;
  if (list) found.push(...extractList(first.body ?? "", listPage, list, c.today, c.budget));
  const order = cfg.date_order === "dmy" || cfg.date_order === "mdy" ? cfg.date_order : undefined;
  let asListed = new Map<Opportunity, { deadline: Opportunity["deadline"]; status: Opportunity["status"] }>();
  if (list && list.detail !== undefined) {
    // detail hops run after the filter, so only calls that pass it cost a request
    const kept = found.filter((o) => matchesFilter(o, cfg.filter as FilterCfg | undefined, c.budget));
    asListed = await enrichListDetail(c, src, list.detail, kept, listPage, order);
  }
  if (self) found.push(...selfCycle(text, src, self, c.today, order, c.budget, raw));
  const opps = finalize(found, cfg, c.today, false, c.budget);
  // text and hash: the same finalize over the items as the listing gave them (detail-only deadlines and closed status left out)
  const textOpps = asListed.size ? finalize(found.map((o) => (asListed.has(o) ? { ...o, ...asListed.get(o) } : o)), cfg, c.today, false, c.budget) : opps;
  return finish({
    kind: "ok",
    http_status: first.r.http_status,
    etag: first.r.etag,
    last_modified: first.r.last_modified,
    bytes: first.r.bytes,
    truncated: first.r.truncated,
    text: withCalls(text, textOpps),
    links,
    opportunities: opps,
    raw_count: found.length,
    isHtml: true,
    fetchability: thinPage(text.length, htmlLen) ? "js_required" : "easy",
  });
}

async function fetchHtml(c: Ctx, src: Source, cfg: Cfg): Promise<Result> {
  if (!isObj(cfg.list) && !isObj(cfg.self)) return fetchPage(c, src, src.url, false);
  return fetchHtmlCalls(c, src, cfg);
}

/**
 * One source. A spent regex budget (RegexBudgetError, thrown by safe_regex.ts through the extraction helpers) ends the source with a
 * visible error result that goes through the same path as any other failure; it is never a silent zero-item success.
 */
export async function fetchSource(c: FetchCtx, src: Source): Promise<Result> {
  try {
    return await fetchSourceInner({ ...c, budget: c.budget ?? newBudget() }, src);
  } catch (e) {
    if (!(e instanceof RegexBudgetError)) throw e;
    if (e instanceof PageWorkError) return { kind: "error", error: `page too heavy to scan: ${e.message}`.slice(0, 200) };
    return { kind: "error", error: `config pattern too slow on this page: ${e.message.replace(/^[^:]*: /, "")}`.slice(0, 200) };
  }
}

async function fetchSourceInner(c: Ctx, src: Source): Promise<Result> {
  const cfg: Cfg = isObj(src.adapter_config) ? src.adapter_config : {};
  const bad = configError(cfg, src);
  if (bad) return { kind: "error", error: `config: ${bad}`.slice(0, 200) };

  const adapter = src.adapter === "sam_gov" && !c.d.env.samKey ? "html" : src.adapter;
  const feedUrl = src.feed_url && src.feed_url !== src.url ? src.feed_url : null;
  const api = API_ADAPTERS[adapter];
  const primary = api ? await fetchApi(c, src, api, cfg)
    : adapter === "rss" ? await fetchRss(c, src)
    : adapter === "html" ? await fetchHtml(c, src, cfg)
    : await fetchPage(c, src, src.url, false);
  if (!primary || primary.kind !== "error" || !primary.fallbackOk) return primary;
  // one fallback: feed/API -> html page, html -> feed_url; never onto a host that is cooling down
  const alt = adapter === "html" ? (feedUrl && { url: feedUrl, feed: true }) : (api || feedUrl ? { url: src.url, feed: false } : null);
  if (!alt || c.d.pol.cooldownRemaining(new URL(alt.url).host) > 0) return primary;
  console.error(JSON.stringify({ source: src.id, adapter, primary_error: primary.error, http_status: primary.http_status ?? null, fallback: alt.url }));
  const second = await fetchPage(c, src, alt.url, alt.feed);
  // a page built by JavaScript has no readable text: accepting it would hide the primary failure behind an empty "ok"
  return second && second.kind === "ok" && second.fetchability !== "js_required" ? second : primary;
}
