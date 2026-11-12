// HTML -> normalized main-content text + document links; deadline and award-amount heuristics.
import * as cheerio from "cheerio";
import { RegexBudgetError, type RegexBudget, type SafeRegex, safeRegex } from "./safe_regex.ts";
import type { Link } from "./types.ts";

export const MAX_PARSE_CHARS = 600_000;
export const MAX_LINKS = 60;

export async function sha256Hex(data: string | Uint8Array): Promise<string> {
  const bytes = typeof data === "string" ? new TextEncoder().encode(data) : data;
  const d = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes as BufferSource));
  return Array.from(d, (b) => b.toString(16).padStart(2, "0")).join("");
}

/** A page that costs more than its work budget: ends the source with an error (a RegexBudgetError, so every "never throws" caller lets it through). */
export class PageWorkError extends RegexBudgetError {}

/** Deepest element nesting accepted. Browsers stop at 512; the HTML parser costs about (tags x depth), so 100,000 nested <div> took a minute. */
export const MAX_NESTING = 1000;
const VOID = "area base br col embed hr img input link meta param source track wbr";
// elements whose end tag the HTML parser infers: an unclosed <p> or <li> does not nest, so it is not counted as depth
const IMPLIED = "p li dt dd tr td th thead tbody tfoot option optgroup colgroup rt rp caption";
const RAW_TEXT = "script style textarea title xmp iframe noembed noframes plaintext";
const inSet = (set: string) => { const m = new Set(set.split(" ")); return (n: string) => m.has(n); };
const isVoid = inSet(VOID), isImplied = inSet(IMPLIED), isRawText = inSet(RAW_TEXT);

/**
 * Throws PageWorkError when the markup nests deeper than MAX_NESTING (estimated from the tags in one pass, before the real parser
 * runs). The work budget of a page: a slow page becomes a visible source error instead of a hang.
 */
export function assertShallow(html: string): void {
  const stack: string[] = [];
  const count = new Map<string, number>();
  let lower: string | null = null;
  let i = html.indexOf("<");
  while (i >= 0 && i < html.length) {
    if (html.startsWith("<!--", i)) {
      const e = html.indexOf("-->", i + 4);
      i = e < 0 ? -1 : html.indexOf("<", e + 3);
      continue;
    }
    let j = i + 1;
    const closing = html[j] === "/";
    if (closing) j++;
    const c = html.charCodeAt(j) | 32;
    if (!(c >= 97 && c <= 122)) { // "<3", "<!doctype", "<?xml": not a tag
      i = html.indexOf("<", j);
      continue;
    }
    let k = j;
    while (k < html.length && !/[\s/>]/.test(html[k])) k++;
    const name = html.slice(j, k).toLowerCase();
    let quote = "";
    for (; k < html.length; k++) { // end of the tag, skipping quoted attribute values
      const ch = html[k];
      if (quote) { if (ch === quote) quote = ""; } else if (ch === '"' || ch === "'") quote = ch; else if (ch === ">") break;
    }
    const selfClosed = html[k - 1] === "/";
    i = html.indexOf("<", k + 1);
    if (closing) {
      if ((count.get(name) ?? 0) > 0) {
        let t: string | undefined;
        while ((t = stack.pop()) !== undefined) {
          count.set(t, count.get(t)! - 1);
          if (t === name) break;
        }
      }
    } else if (isRawText(name) && !selfClosed) {
      lower ??= html.toLowerCase();
      const e = lower.indexOf("</" + name, k);
      i = e < 0 ? -1 : e;
    } else if (!isVoid(name) && !isImplied(name) && !selfClosed) {
      stack.push(name);
      count.set(name, (count.get(name) ?? 0) + 1);
      if (stack.length > MAX_NESTING) throw new PageWorkError(`markup nests elements deeper than ${MAX_NESTING}`);
    }
  }
}

/** cheerio.load for untrusted markup: refuses a page nested deeper than MAX_NESTING (see assertShallow). */
export function loadHtml(html: string, isDocument = true): cheerio.CheerioAPI {
  assertShallow(html);
  return cheerio.load(html, {}, isDocument);
}

export function decodeBody(bytes: Uint8Array, contentType: string | null): string {
  let label = contentType?.match(/charset\s*=\s*"?([\w.:-]+)/i)?.[1];
  if (!label) label = new TextDecoder("latin1").decode(bytes.subarray(0, 2048)).match(/<meta[^>]+charset\s*=\s*["']?([\w.:-]+)/i)?.[1];
  try {
    return new TextDecoder(label ?? "utf-8").decode(bytes);
  } catch {
    return new TextDecoder().decode(bytes);
  }
}

// ---------- text ----------
const DROP = "script,style,noscript,template,svg,iframe,nav,header,footer";
const COOKIE_BANNERS = [
  "#onetrust-consent-sdk", "#CybotCookiebotDialog", ".cc-window", ".cookie-banner", ".cookie-notice", ".cookie-consent",
  ".cookiebanner", "#cookie-banner", "#cookie-notice", "#cookie-consent", "#cookieConsent", "#gdpr-cookie-notice", "[aria-label*='cookie' i]", "[id^=cmplz]",
].join(",");
const BLOCK_TAGS = new Set("p,div,li,tr,h1,h2,h3,h4,h5,h6,section,article,ul,ol,table,dt,dd,pre,blockquote,figure,caption".split(","));
// lines that change on every visit without the page content changing
const VOLATILE_LINE = /^((page|content|site)\s+)?(last\s+)?(updated|modified|reviewed|revised)\b.{0,40}$|\blast\s+(updated|modified|reviewed|revised)\b.{0,40}$|(©|\(c\)|copyright)\s*\d{0,4}|all rights reserved/i;
// countdowns / relative times: removed as phrases (not whole lines) so "Deadline: <date> (45 days left)" keeps its date
const VOLATILE_PHRASE = new RegExp(
  [
    String.raw`\(?\b(?:only\s+)?\d+\s+(?:days?|hours?|weeks?|minutes?)\s+(?:left|remaining|to\s+go)\b\)?`,
    String.raw`\b(?:days?|hours?)\s+(?:left|remaining)\s*(?::\s*)?\d+\b`, // not \s*:?\s*: two adjacent runs make a long whitespace run quadratic
    String.raw`\b(?:posted|updated|published|added|modified)\s+(?:\d+\s+\w+\s+ago|today|yesterday)\b`,
    String.raw`\b\d+\s+(?:seconds?|minutes?|hours?|days?|weeks?|months?)\s+ago\b`,
    String.raw`\b(?:closes?|closing|due|ends?)\s+(?:today|tomorrow|in\s+\d+\s+days?)\b`,
  ].join("|"),
  "gi",
);
const VOLATILE_TOKEN = /\b[0-9a-f]{32,}\b|\b(?:jsessionid|sessionid|sid|csrf[_-]?token|token|nonce)[=:]\s*[\w.-]+/gi;

export function normalizeText(raw: string): string {
  const out: string[] = [];
  for (const l of raw.split("\n")) {
    const t = l.replace(VOLATILE_TOKEN, "").replace(VOLATILE_PHRASE, "").replace(/\(\s*\)/g, "").replace(/\s+/g, " ").trim();
    if (/[\p{L}\p{N}]/u.test(t) && !VOLATILE_LINE.test(t)) out.push(t);
  }
  return out.join("\n");
}

const DOC_EXT: [RegExp, Link["type"]][] = [[/\.pdf$/i, "pdf"], [/\.docx?$/i, "doc"], [/\.(xlsx?|csv)$/i, "xls"], [/\.zip$/i, "zip"]];
const LINK_WORDS = /(rfp|rfa|nofo|funding opportunit|call for|guidelines|application|how to apply|eligibility|faq|webinar)/i;

/**
 * Detaches nodes in one pass per parent. cheerio's remove() splices the parent's child array once per node, which is quadratic
 * on many siblings (50,000 <br> or <nav> next to each other took seconds).
 */
export function detach(nodes: any[]): void {
  const gone = new Set<any>(nodes);
  const parents = new Set<any>();
  for (const n of gone) if (n.parent) parents.add(n.parent);
  for (const p of parents) {
    const kept = p.children.filter((c: any) => !gone.has(c));
    kept.forEach((c: any, i: number) => {
      c.prev = kept[i - 1] ?? null;
      c.next = kept[i + 1] ?? null;
    });
    p.children = kept;
  }
  for (const n of gone) n.parent = n.prev = n.next = null;
}

/**
 * Text of a node in document order (what cheerio's .text() returns), iterative: .text() recurses and overflows the stack on a deeply
 * nested page. With `blocks` it also writes the line structure of extractPage: a newline around every block element and in place of
 * every <br>, a space after every table cell. cheerio's prepend()/append() for the same job cost seconds on 100,000 blocks.
 */
export function gatherText(root: any, blocks = false): string {
  const out: string[] = [];
  const stack: any[] = [];
  const open = (n: any) => {
    for (let i = n.children.length - 1; i >= 0; i--) stack.push(n.children[i]);
  };
  if (root.children) open(root);
  while (stack.length) {
    const x = stack.pop();
    if (typeof x === "string") out.push(x);
    else if (x.type === "text") out.push(x.data);
    else if (blocks && x.type === "tag" && x.name === "br") out.push("\n");
    else if (x.children && x.type !== "comment") {
      const mark = blocks && x.type === "tag" ? (BLOCK_TAGS.has(x.name) ? "\n" : x.name === "td" || x.name === "th" ? " " : "") : "";
      if (mark === "\n") out.push(mark);
      if (mark) stack.push(mark);
      open(x);
    }
  }
  return out.join("");
}

function collectLinks($: cheerio.CheerioAPI, base: string): Link[] {
  const seen = new Set<string>();
  const links: Link[] = [];
  for (const el of $("a[href]").toArray().slice(0, 5000)) {
    if (links.length >= MAX_LINKS) break;
    let u: URL;
    try {
      u = new URL($(el).attr("href")!.trim(), base);
    } catch {
      continue;
    }
    if (u.protocol !== "http:" && u.protocol !== "https:") continue;
    u.hash = "";
    const url = u.href;
    if (seen.has(url)) continue;
    const label = (gatherText(el) || $(el).attr("title") || "").replace(/\s+/g, " ").trim().slice(0, 150);
    const type = DOC_EXT.find(([re]) => re.test(u.pathname))?.[1] ?? (LINK_WORDS.test(`${label} ${u.pathname}`) ? "page" : null);
    if (!type) continue;
    seen.add(url);
    links.push({ url, label: label || decodeURIComponent(u.pathname.split("/").pop() || url), type });
  }
  return links;
}

/**
 * Main-content text (volatile bits removed, for hashing and diffing), captured links, and `raw`: the same visible text before any
 * removal or whitespace change. Config patterns run on `raw`, so a "last updated" line or a countdown never hides a date from them.
 */
export function extractPage(html: string, baseUrl: string): { text: string; links: Link[]; raw: string } {
  const $ = loadHtml(html.slice(0, MAX_PARSE_CHARS));
  detach($("script,style,noscript,template").toArray());
  const links = collectLinks($, baseUrl);
  detach($(DROP).toArray());
  detach($(COOKIE_BANNERS).toArray());
  const body = $("body").length ? $("body")[0] : $.root()[0];
  const main = $("main,[role=main]").first()[0];
  const mainLen = main ? gatherText(main).trim().length : 0;
  // a <main> holding under half of the remaining page text is a thin wrapper (content sits beside it): use the whole body
  const root = main && mainLen > 200 && mainLen >= gatherText(body).trim().length * 0.5 ? main : body;
  const raw = gatherText(root, true);
  return { text: normalizeText(raw), links, raw };
}

// ---------- dates ----------
const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
const MON = "(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sept?(?:ember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\\.?";
const DATE_FORMS: { re: RegExp; pick: (m: RegExpExecArray) => [string, string, string] }[] = [
  { re: new RegExp(`\\b${MON}\\s+(\\d{1,2})(?:st|nd|rd|th)?,?\\s+(\\d{4})\\b`, "gi"), pick: (m) => [m[3], m[1], m[2]] },
  { re: new RegExp(`\\b(\\d{1,2})(?:st|nd|rd|th)?\\s+(?:of\\s+)?${MON},?\\s+(\\d{4})\\b`, "gi"), pick: (m) => [m[3], m[2], m[1]] },
  { re: /\b(\d{4})-(\d{2})-(\d{2})(?!\d)/g, pick: (m) => [m[1], m[2], m[3]] },
  { re: /\b(\d{1,2})\/(\d{1,2})\/(\d{4}|\d{2})\b/g, pick: (m) => [m[3], m[1], m[2]] }, // US month/day/year
];
// explicit deadline phrasing only: "closed", "received by mail" etc. must not label a date
const LABEL_STRONG = /deadline|\bdue\s+(?:date|by|on)\b|\bclos(?:ing|e)\s+date\b|submission\s+date|apply\s+by|submit\s+by|letters?\s+of\s+intent|\bloi\b|\bproposals?\s+(?:are\s+)?due\b|\bapplications?\s+(?:are\s+)?(?:due|close)\b/i;
// weak words count only when the date follows immediately
const LABEL_WEAK = /(?:\bcloses?(?:\s+on)?|\bdue(?:\s+on)?|\breceived\s+by(?:\s+\d{1,2}(?::\d{2})?\s*(?:[ap]\.?m\.?)?(?:\s+(?:[ecmp][sd]?t|utc|gmt))?(?:\s+on)?)?)\s*[:\-–—]?\s*$/i;
const isLabel = (s: string) => LABEL_STRONG.test(s) || LABEL_WEAK.test(s);
const LABEL_AFTER = /^\s*[-–—(:,]?\s*\(?(?:application\s+|submission\s+|closing\s+)?(?:deadline|due|date)/i;
const HORIZON_MONTHS = 30;

function toIso(y: string, m: string, d: string): string | null {
  const month = /^\d+$/.test(m) ? Number(m) : MONTHS.indexOf(m.slice(0, 3).toLowerCase()) + 1;
  const year = y.length === 2 ? 2000 + Number(y) : Number(y);
  const day = Number(d);
  if (month < 1 || month > 12 || day < 1 || year < 2000 || year > 2100) return null;
  const dt = new Date(Date.UTC(year, month - 1, day));
  if (dt.getUTCMonth() !== month - 1) return null; // e.g. Feb 31
  return dt.toISOString().slice(0, 10);
}

// Spanish and French month words (full names and usual abbreviations, accents stripped), used only when no English date matches.
// Exact words only: a prefix match would read "12 marcha 2027" as a date.
const FOREIGN_MONTHS: Record<string, number> = {};
[
  "enero ene janvier janv", "febrero feb fevrier fevr", "marzo mar mars", "abril abr avril avr", "mayo may mai", "junio jun juin",
  "julio jul juillet juil", "agosto ago aout", "septiembre setiembre sep sept set septembre", "octubre oct octobre",
  "noviembre nov novembre", "diciembre dic decembre dec",
].forEach((names, i) => names.split(" ").forEach((n) => (FOREIGN_MONTHS[n] = i + 1)));
const FOREIGN_DATE = /\b(\d{1,2})\s+(de\s+)?([a-zÀ-ſ]{3,10})(\.)?,?\s+(?:de\s+)?(\d{4})\b/gi;
// "set" and "ago" are also English words ("phase 2 set 2027"): months only with a period after or "de" before
const NEEDS_MARK = new Set(["set", "ago"]);
/** 1-12 for a Spanish or French month word, else 0. */
function foreignMonth(word: string): number {
  return FOREIGN_MONTHS[word.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase()] ?? 0;
}

/** First recognizable date in a string (ISO, US m/d/y, 'March 15, 2027', ...) as YYYY-MM-DD. */
export function parseDate(s: string | null | undefined): string | null {
  if (!s) return null;
  let best: { at: number; iso: string } | null = null;
  for (const { re, pick } of DATE_FORMS) {
    for (const m of s.matchAll(re)) {
      const iso = toIso(...pick(m as RegExpExecArray));
      if (iso && (!best || m.index! < best.at)) best = { at: m.index!, iso };
    }
  }
  if (best) return best.iso;
  // English names failed: day, Spanish or French month word, four-digit year (accents stripped)
  for (const m of s.matchAll(FOREIGN_DATE)) {
    const month = NEEDS_MARK.has(m[3].toLowerCase()) && !m[2] && !m[4] ? 0 : foreignMonth(m[3]);
    const iso = month ? toIso(m[5], String(month), m[1]) : null;
    if (iso) return iso;
  }
  return null;
}

/** Every recognizable date in the text as YYYY-MM-DD, in order of appearance (overlapping matches skipped). */
export function allDates(text: string): string[] {
  const hits: { at: number; end: number; iso: string }[] = [];
  for (const { re, pick } of DATE_FORMS) {
    for (const m of text.matchAll(re)) {
      const iso = toIso(...pick(m as RegExpExecArray));
      if (iso) hits.push({ at: m.index!, end: m.index! + m[0].length, iso });
    }
  }
  hits.sort((a, b) => a.at - b.at);
  const out: string[] = [];
  let prevEnd = 0;
  for (const h of hits) {
    if (h.at < prevEnd) continue;
    out.push(h.iso);
    prevEnd = h.end;
  }
  return out;
}

/** Nearest date today or later; else the latest past date; null when empty. */
export function nearestOf(ds: string[], today: string): string | null {
  const future = ds.filter((d) => d >= today).sort()[0];
  if (future) return future;
  const past = ds.filter((d) => d < today).sort();
  return past.length ? past[past.length - 1] : null;
}

/** Numeric slash date order for regex captures: adapter_config date_order. */
export type DateOrder = "dmy" | "mdy";
const SLASH_DATE = /\b(\d{1,2})\/(\d{1,2})\/(\d{4}|\d{2})\b/;

/**
 * One regex capture as a date. A numeric slash date is read by the config's date_order; without one, a date whose
 * two parts are both 12 or less is ambiguous (05/03/2027 could be 5 March or 3 May) and gives null.
 */
function captureDate(s: string, order?: DateOrder): string | null {
  const m = SLASH_DATE.exec(s);
  if (!m) return parseDate(s);
  const a = Number(m[1]);
  const b = Number(m[2]);
  if (!order && a <= 12 && b <= 12) return null;
  return order === "dmy" ? toIso(m[3], m[2], m[1]) : toIso(m[3], m[1], m[2]);
}

const compiled = new Map<string, SafeRegex>();
/** A config pattern compiled once (throws Error(reason) for a refused pattern). */
export function configRegex(src: string): SafeRegex {
  let re = compiled.get(src);
  if (!re) {
    if (compiled.size >= 500) compiled.clear();
    compiled.set(src, (re = safeRegex(src)));
  }
  return re;
}

/** Last date a deadline may be (today + 30 months): later dates are placeholders or typos. */
function horizonOf(today: string): string {
  const h = new Date(`${today}T00:00:00Z`);
  h.setUTCMonth(h.getUTCMonth() + HORIZON_MONTHS);
  return h.toISOString().slice(0, 10);
}

/** A month-and-day capture with no year ("December 1") as its next occurrence on or after today (this year, else next); opt-in only. */
function nextOccurrence(s: string, today: string): string | null {
  const y = Number(today.slice(0, 4));
  for (const yr of [y, y + 1]) {
    const d = captureDate(`${s} ${yr}`);
    if (d && d >= today) return d;
  }
  return null;
}

/**
 * Config regex (adapter_config deadline_regex): group 1 of each match through captureDate, nearest rule, dates past the horizon ignored.
 * Never invents a date. A refused pattern gives null; a spent step budget throws RegexBudgetError (the caller ends the source with an error).
 */
export function regexDeadline(text: string, src: string, today: string, order?: DateOrder, budget?: RegexBudget, assumeNextYear = false): string | null {
  try {
    if (!src) return null;
    const horizon = horizonOf(today);
    const ds: string[] = [];
    for (const m of configRegex(src).matchAll(String(text ?? "").slice(0, MAX_PARSE_CHARS), budget)) {
      const cap = m.groups[1] ?? "";
      const d = captureDate(cap, order) ?? (assumeNextYear ? nextOccurrence(cap, today) : null);
      if (d && d <= horizon) ds.push(d);
    }
    return nearestOf(ds, today);
  } catch (e) {
    if (e instanceof RegexBudgetError) throw e;
    return null;
  }
}

export interface Deadlines {
  /** nearest labeled date that is today or later and within 30 months */
  future: string | null;
  /** future, else the latest labeled past date: stable value to compare snapshots */
  primary: string | null;
}

/** Start of the line holding `at`, for ascending `at` only: one forward scan in total (lastIndexOf per date is quadratic on a long line). */
function lineStartScan(text: string): (at: number) => number {
  let ls = 0;
  let nl = text.indexOf("\n");
  return (at) => {
    while (nl !== -1 && nl < at) nl = text.indexOf("\n", (ls = nl + 1));
    return ls;
  };
}

export function findDeadlines(text: string, today: string): Deadlines {
  const dates: { at: number; end: number; iso: string }[] = [];
  for (const { re, pick } of DATE_FORMS) {
    for (const m of text.matchAll(re)) {
      const iso = toIso(...pick(m as RegExpExecArray));
      if (iso) dates.push({ at: m.index!, end: m.index! + m[0].length, iso });
    }
  }
  dates.sort((a, b) => a.at - b.at);
  const labeled: string[] = [];
  let prevEnd = 0;
  const lineStartOf = lineStartScan(text);
  let prevLineAt = -1; // the line above is read once per line, not once per date
  let prevLineText = "";
  for (const d of dates) {
    if (d.at < prevEnd) continue; // overlapping match of another form
    const lineStart = lineStartOf(d.at);
    const before = text.slice(Math.max(prevEnd, lineStart, d.at - 80), d.at);
    // "Deadline" on its own line right above the date (definition lists, stacked table cells)
    let prevLine = "";
    if (before.trim() === "") {
      if (prevLineAt !== lineStart) {
        prevLineAt = lineStart;
        const end = Math.max(0, lineStart - 1);
        prevLineText = text.slice(Math.max(text.lastIndexOf("\n", end - 1) + 1, end - 60), end);
      }
      prevLine = prevLineText;
    }
    const after = text.slice(d.end, d.end + 25).split("\n")[0];
    if (isLabel(before) || isLabel(prevLine) || LABEL_AFTER.test(after)) labeled.push(d.iso);
    prevEnd = d.end;
  }
  const horizon = horizonOf(today);
  const inRange = labeled.filter((x) => x <= horizon).sort(); // dates past the horizon are placeholders/typos
  const future = inRange.find((x) => x >= today) ?? null; // nearest future labeled date
  return { future, primary: future ?? inRange[inRange.length - 1] ?? null };
}

// ---------- amounts ----------
export interface Amount {
  value: number;
  currency: "USD" | "EUR" | "GBP";
}
const NUM = "(\\d{1,3}(?:,\\d{3})+|\\d+)(\\.\\d+)?";
const SUFFIX = "(?:\\s?(k|mm|m|bn|b|million|billion|thousand)\\b)?";
const AMOUNT_RES = [
  new RegExp(`(\\$|USD\\s?|€|EUR\\s?|£|GBP\\s?)\\s?${NUM}${SUFFIX}`, "gi"),
  // (?<!\d,): no start inside a chain "1,234,567" (each start would re-read the rest of a long chain: quadratic)
  new RegExp(`(?<!\\d,)\\b${NUM}${SUFFIX}\\s?(USD|EUR|euros?|dollars)\\b`, "gi"),
];
const PER_AWARD = /up to|maximum|max\.?|ceiling|per (?:project|award|grant|applicant|year)|each|rang(?:e|es|ing)|awards?|individual grants?/i;
const GENERIC = /grants?|funding|budget|total|fund/i;
const MULT: Record<string, number> = { k: 1e3, thousand: 1e3, m: 1e6, mm: 1e6, million: 1e6, b: 1e9, bn: 1e9, billion: 1e9 };

/** Candidate maximum award: largest amount near per-award words, else near generic funding words. */
export function findAmount(text: string): Amount | null {
  let best: { tier: number; a: Amount } | null = null;
  for (const [i, re] of AMOUNT_RES.entries()) {
    const lineStartOf = lineStartScan(text); // matches of one regex come in ascending order
    for (const m of text.matchAll(re)) {
      const cur = i === 0 ? m[1].trim().toUpperCase() : m[4].toUpperCase();
      const [intPart, frac, suffix] = i === 0 ? [m[2], m[3], m[4]] : [m[1], m[2], m[3]];
      const value = Math.round(Number(intPart.replace(/,/g, "") + (frac ?? "")) * (MULT[suffix?.toLowerCase() ?? ""] ?? 1));
      const currency = cur.startsWith("€") || cur.startsWith("EUR") ? "EUR" : cur.startsWith("£") || cur.startsWith("GBP") ? "GBP" : "USD";
      const lineStart = lineStartOf(m.index!);
      const clause = (t: string) => t.split(/[;\n]/);
      const ctx = clause(text.slice(Math.max(lineStart, m.index! - 80), m.index!)).pop() + " " + clause(text.slice(m.index! + m[0].length, m.index! + m[0].length + 30))[0];
      const tier = PER_AWARD.test(ctx) ? 2 : GENERIC.test(ctx) ? 1 : 0;
      if (tier && value > 0 && (!best || tier > best.tier || (tier === best.tier && value > best.a.value))) best = { tier, a: { value, currency } };
    }
  }
  return best?.a ?? null;
}
