// Agent-free call ingestion: pure extraction of calls from listing HTML, the self-cycle
// deadline, filters, and the finalize step shared by every adapter. No I/O; never throws.
import * as cheerio from "cheerio";
import { allDates, configRegex, type DateOrder, detach, findAmount, findDeadlines, loadHtml, MAX_PARSE_CHARS, nearestOf, PageWorkError, regexDeadline } from "../extract.ts";
import { type RegexBudget, RegexBudgetError, type SafeRegex } from "../safe_regex.ts";
import type { Opportunity } from "../types.ts";

export interface ListCfg {
  url?: string;
  item?: string;
  match?: string;
  skip?: string;
  title?: string;
  link?: string;
  date?: string;
  date_label?: boolean;
  closed?: string;
  amount?: boolean;
  detail?: unknown; // true | number | { max, deadline_regex, closed }: see index.ts enrichListDetail
}

export interface FilterCfg {
  any?: string[];
  all?: string[];
  none?: string[];
  fields?: "title" | "title+description";
}

type Item = Opportunity & { award_max_usd?: number | null };

const MAX_CANDIDATES = 400;
const MAX_CONTEXT = 600;
const MAX_DESCRIPTION = 500;
const DEFAULT_MAX_ITEMS = 40;
const CONTAINERS = new Set(["li", "tr", "article", "section", "p", "div"]);

const norm = (s: string): string => s.replace(/\s+/g, " ").trim();

/** Removes the first run of slashes that ends at a "?" or at the end of the url; one pass (the regex /\/+(?=\?|$)/ is quadratic on a long run of slashes). */
export function stripTrailingSlashes(url: string): string {
  let run = -1; // start of the current run of slashes
  for (let i = 0; i <= url.length; i++) {
    const c = i < url.length ? url[i] : "";
    if (c === "/") {
      if (run < 0) run = i;
    } else {
      if (run >= 0 && (c === "?" || c === "")) return url.slice(0, run) + url.slice(i);
      run = -1;
    }
  }
  return url;
}

/** A config pattern as a budgeted matcher, or null when it is refused. */
function compile(src: string): SafeRegex | null {
  try {
    return configRegex(src);
  } catch {
    return null;
  }
}

/** The "never throws" functions below swallow every error except a spent regex budget, which ends the source with an error. */
const rethrowBudget = (e: unknown): void => {
  if (e instanceof RegexBudgetError) throw e;
};

/** Plain text of an HTML fragment: tags and scripts removed, entities decoded, whitespace collapsed. */
export function plainText(s: unknown): string {
  const raw = String(s ?? "");
  try {
    const $ = loadHtml(raw, false);
    detach($("script,style").toArray());
    return norm($.root().text());
  } catch {
    return norm(raw.replace(/<[^<>]*>/g, " "));
  }
}

// a route fragment (#/x, #!x, #word/x) names a different page on a single-page app; a plain anchor (#top) does not
const ROUTE_HASH = /^#(?:!|\/|\w+\/)./;

/** Absolute http(s) URL with utm_* parameters and a plain-anchor fragment removed (a route fragment stays), or null. */
function resolveUrl(href: string, base: string): string | null {
  if (!href) return null;
  let u: URL;
  try {
    u = new URL(href, base);
  } catch {
    return null;
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") return null;
  if (!ROUTE_HASH.test(u.hash)) u.hash = "";
  for (const k of [...u.searchParams.keys()]) if (k.toLowerCase().startsWith("utm_")) u.searchParams.delete(k);
  return u.href;
}

const nearestDate = (text: string, today: string): string | null => nearestOf(allDates(text), today);

type Size = { chars: number; nonSpace: number; nodes: number };

/** Text characters, non-whitespace characters and node count under every node, in one iterative pass. */
function measure(root: any): Map<any, Size> {
  const order: any[] = [];
  const stack = [root];
  while (stack.length) {
    const n = stack.pop();
    order.push(n);
    if (n.children) for (const c of n.children) stack.push(c);
  }
  const size = new Map<any, Size>();
  for (let i = order.length - 1; i >= 0; i--) {
    const n = order[i];
    const own = n.type === "text" ? n.data : "";
    const sz = size.get(n) ?? { chars: 0, nonSpace: 0, nodes: 0 };
    sz.chars += own.length;
    sz.nonSpace += own.replace(/\s/g, "").length;
    sz.nodes += 1;
    size.set(n, sz);
    const up = n.parent && size.get(n.parent) ? size.get(n.parent)! : n.parent ? { chars: 0, nonSpace: 0, nodes: 0 } : null;
    if (up) {
      up.chars += sz.chars;
      up.nonSpace += sz.nonSpace;
      up.nodes += sz.nodes;
      size.set(n.parent, up);
    }
  }
  return size;
}

/**
 * The work one page may cost, in characters read (one node counts as NODE_COST characters). Every text read and subtree search of a
 * candidate is charged its subtree size, so nested candidates cannot multiply a large page: it ends the source with an error.
 */
const MAX_WORK = 20_000_000;
const NODE_COST = 16;

/** Anchor mode: nearest li/tr/article/section/p/div ancestor with at most 600 chars of text, else the anchor itself. */
function contextScope($: cheerio.CheerioAPI, el: cheerio.Cheerio<any>, size: Map<any, Size>, spend: (n: any, times?: number) => void): cheerio.Cheerio<any> {
  for (let p = (el[0] as any).parent; p && p.type === "tag"; p = p.parent) {
    // normalised text is never shorter than its non-whitespace characters: most ancestors are refused without reading them
    if (!CONTAINERS.has(p.name) || (size.get(p)?.nonSpace ?? 0) > MAX_CONTEXT) continue;
    spend(p);
    if (norm($(p).text()).length <= MAX_CONTEXT) return $(p);
  }
  return el;
}

function pick(scope: cheerio.Cheerio<any>, sel: string | undefined): cheerio.Cheerio<any> | null {
  if (!sel) return null;
  try {
    const found = scope.find(sel).first();
    return found.length ? found : null;
  } catch {
    return null;
  }
}

/** Calls from a listing page (item mode with cfg.item, else anchor mode with cfg.match). */
export function extractList(html: string, baseUrl: string, cfg: ListCfg, today: string, budget?: RegexBudget): Opportunity[] {
  try {
    if (typeof html !== "string" || !cfg || typeof cfg !== "object") return [];
    const hasItem = typeof cfg.item === "string" && cfg.item.trim() !== "";
    const matchSrc = typeof cfg.match === "string" && cfg.match.trim() !== "" ? cfg.match : null;
    if (!hasItem && !matchSrc) return [];
    const matchRe = matchSrc ? compile(matchSrc) : null;
    if (matchSrc && !matchRe) return [];
    const skipRe = typeof cfg.skip === "string" && cfg.skip ? compile(cfg.skip) : null;
    const closedRe = typeof cfg.closed === "string" && cfg.closed ? compile(cfg.closed) : null;

    const $ = loadHtml(html.slice(0, MAX_PARSE_CHARS));
    detach($("script,style,noscript,template").toArray());
    const nodes = (hasItem ? $(cfg.item as string).toArray() : $("a[href]").toArray()).slice(0, MAX_CANDIDATES);
    const size = measure($.root()[0]);
    let work = MAX_WORK;
    const spend = (n: any, times = 1) => {
      const z = size.get(n);
      work -= times * ((z?.chars ?? 0) + NODE_COST * (z?.nodes ?? 0));
      if (work < 0) throw new PageWorkError("candidate items overlap and share too much text");
    };

    const out = new Map<string, Item>();
    for (const node of nodes) {
      try {
        const el = $(node);
        const scope = hasItem ? el : contextScope($, el, size, spend);
        spend(scope[0], 4); // up to three subtree searches and the text reads
        const linkEl = hasItem
          ? (pick(scope, cfg.link) ?? (el.is("a[href]") ? el : scope.find("a[href]").first()))
          : el;
        const rawHref = (linkEl.attr("href") ?? "").trim();
        const linkText = norm(linkEl.text() || linkEl.attr("title") || "");
        const heading = pick(scope, cfg.title) ?? scope.find("h1,h2,h3,h4,h5").first();
        const title = (norm(heading.text()) || linkText).slice(0, 300);
        if (title.length < 4) continue;

        const url = resolveUrl(rawHref, baseUrl);
        const external_id = url
          ? stripTrailingSlashes(url).slice(0, 300)
          : `t:${title.toLowerCase()}`.slice(0, 120);
        const context = norm(scope.text());
        const hay = `${context} ${url ?? rawHref}`;
        if (matchRe && !matchRe.test(hay, budget)) continue;
        if (skipRe && skipRe.test(hay, budget)) continue;

        let dateText = context;
        const dated = norm(pick(scope, cfg.date)?.text() ?? "");
        if (dated) dateText = dated;
        const deadline =
          cfg.date_label === true
            ? (() => {
                const d = findDeadlines(dateText, today);
                return d.future ?? d.primary;
              })()
            : nearestDate(dateText, today);

        const item: Item = {
          external_id,
          title,
          url,
          deadline,
          description: context && context !== title ? context.slice(0, MAX_DESCRIPTION) : null,
        };
        if (closedRe && closedRe.test(context, budget)) item.status = "closed";
        // amount: false = the card's figure is a program budget, not an award size
        const amt = cfg.amount === false ? null : findAmount(context);
        if (amt && amt.currency === "USD" && amt.value >= 1000) item.award_max_usd = amt.value;
        if (!out.has(external_id)) out.set(external_id, item);
      } catch (e) {
        rethrowBudget(e); // any other error: one odd node must not drop the rest of the page
      }
    }
    return [...out.values()];
  } catch (e) {
    rethrowBudget(e);
    return [];
  }
}

/** Single-program page: one open item for the nearest labeled future deadline, else none. */
export function selfCycle(
  text: string,
  src: { name: string; url: string },
  cfg: { title?: string; deadline_regex?: string; assume_next_year?: boolean },
  today: string,
  order?: DateOrder,
  budget?: RegexBudget,
  raw: string = text, // the unaltered page text: deadline_regex runs on it, the labelled-date search on `text`
): Opportunity[] {
  try {
    // deadline_regex (optional) replaces the labelled-date search; a date before today gives no call
    const d = cfg?.deadline_regex ? regexDeadline(String(raw ?? ""), cfg.deadline_regex, today, order, budget, cfg.assume_next_year === true) : findDeadlines(String(text ?? ""), today).future;
    if (!d || d < today) return [];
    const title = cfg?.title?.trim() || src.name;
    // keyed on the deadline year, so a moved or extended deadline updates the same call instead of adding a second open one
    return [{ external_id: `cycle:${d.slice(0, 4)}`, title, url: src.url, deadline: d, status: "open" }];
  } catch (e) {
    rethrowBudget(e);
    return [];
  }
}

/** Case-insensitive substring tests; a term starting with "re:" is a case-insensitive regex. */
export function matchesFilter(o: Opportunity, f: FilterCfg | undefined, budget?: RegexBudget): boolean {
  try {
    if (!f || typeof f !== "object") return true;
    const titleOnly = f.fields === "title";
    const raw = titleOnly ? String(o.title ?? "") : `${o.title ?? ""} ${o.description ?? ""}`;
    const lower = raw.toLowerCase();
    const hit = (term: string): boolean => {
      if (term.startsWith("re:")) {
        return compile(term.slice(3))?.test(raw, budget) ?? false; // a refused pattern matches nothing
      }
      return lower.includes(term.toLowerCase());
    };
    const strs = (x: unknown): string[] => (Array.isArray(x) ? x.filter((s): s is string => typeof s === "string") : []);
    const any = strs(f.any);
    if (any.length && !any.some(hit)) return false;
    if (!strs(f.all).every(hit)) return false;
    if (strs(f.none).some(hit)) return false;
    return true;
  } catch (e) {
    rethrowBudget(e);
    return false;
  }
}

function clampCap(v: unknown): number {
  const n = Math.floor(Number(v));
  if (!Number.isFinite(n) || n < 1) return DEFAULT_MAX_ITEMS;
  return Math.min(n, 100);
}

const byDeadline = (a: string | null | undefined, b: string | null | undefined, dir: 1 | -1): number => {
  if (!a && !b) return 0;
  if (!a) return 1;
  if (!b) return -1;
  return dir * (a < b ? -1 : a > b ? 1 : 0);
};

/** Filter, clean, status by deadline (adapters without native status), dedupe, order, cap. */
export function finalize(
  opps: Opportunity[],
  cfg: Record<string, unknown>,
  today: string,
  nativeStatus: boolean,
  budget?: RegexBudget,
): Opportunity[] {
  try {
    const c = cfg && typeof cfg === "object" ? cfg : {};
    const filter = c.filter as FilterCfg | undefined;
    const cap = clampCap(c.max_items);
    const seen = new Set<string>();
    const rows: Item[] = [];
    for (const o of Array.isArray(opps) ? opps : []) {
      if (!o || typeof o !== "object") continue;
      if (!matchesFilter(o, filter, budget)) continue;
      const external_id = String(o.external_id ?? "").trim();
      const title = plainText(o.title).slice(0, 300);
      if (!external_id || !title || seen.has(external_id)) continue;
      seen.add(external_id);
      const deadline = o.deadline ?? null;
      let status = o.status;
      if (!nativeStatus) status = deadline && deadline < today ? "closed" : (o.status ?? "open");
      rows.push({
        ...o,
        external_id,
        title,
        description: o.description == null ? null : plainText(o.description) || null,
        deadline,
        status,
      });
    }
    const isOpen = (r: Item) => r.status !== "closed" && r.status !== "archived";
    const open = rows.filter(isOpen).sort((a, b) => byDeadline(a.deadline, b.deadline, 1));
    const done = rows.filter((r) => !isOpen(r)).sort((a, b) => byDeadline(a.deadline, b.deadline, -1));
    return [...open, ...done].slice(0, cap);
  } catch (e) {
    rethrowBudget(e);
    return [];
  }
}

/** Calls section appended to the stored page text: one "- title | deadline | status" line per call. */
export function callsSection(opps: Opportunity[]): string {
  try {
    const rows = Array.isArray(opps) ? opps : [];
    if (!rows.length) return "";
    const lines = rows.map(
      (o) => `- ${norm(String(o.title ?? "")).replace(/\|/g, "/")} | ${o.deadline ?? "no date"} | ${o.status ?? "open"}`,
    );
    return `Calls found:\n${lines.join("\n")}`;
  } catch {
    return "";
  }
}
