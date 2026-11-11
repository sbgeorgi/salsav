// HTML -> normalized main-content text + document links; deadline and award-amount heuristics.
import * as cheerio from "cheerio";
import type { Link } from "./types.ts";

export const MAX_PARSE_CHARS = 600_000;
export const MAX_LINKS = 60;

export async function sha256Hex(data: string | Uint8Array): Promise<string> {
  const bytes = typeof data === "string" ? new TextEncoder().encode(data) : data;
  const d = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes as BufferSource));
  return Array.from(d, (b) => b.toString(16).padStart(2, "0")).join("");
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
  ".cookiebanner", "#cookie-banner", "#cookie-notice", "#cookie-consent", "#cookieConsent", "#gdpr-cookie-notice", "[aria-label*='cookie' i]",
].join(",");
const BLOCKS = "p,div,li,tr,h1,h2,h3,h4,h5,h6,section,article,ul,ol,table,dt,dd,pre,blockquote,figure,caption";
// lines that change on every visit without the page content changing
const VOLATILE_LINE = /^((page|content|site)\s+)?(last\s+)?(updated|modified|reviewed|revised)\b.{0,40}$|\blast\s+(updated|modified|reviewed|revised)\b.{0,40}$|(©|\(c\)|copyright)\s*\d{0,4}|all rights reserved/i;
// countdowns / relative times: removed as phrases (not whole lines) so "Deadline: <date> (45 days left)" keeps its date
const VOLATILE_PHRASE = new RegExp(
  [
    String.raw`\(?\b(?:only\s+)?\d+\s+(?:days?|hours?|weeks?|minutes?)\s+(?:left|remaining|to\s+go)\b\)?`,
    String.raw`\b(?:days?|hours?)\s+(?:left|remaining)\s*:?\s*\d+\b`,
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
    const label = ($(el).text() || $(el).attr("title") || "").replace(/\s+/g, " ").trim().slice(0, 150);
    const type = DOC_EXT.find(([re]) => re.test(u.pathname))?.[1] ?? (LINK_WORDS.test(`${label} ${u.pathname}`) ? "page" : null);
    if (!type) continue;
    seen.add(url);
    links.push({ url, label: label || decodeURIComponent(u.pathname.split("/").pop() || url), type });
  }
  return links;
}

/** Main-content text (volatile bits removed) and captured links. */
export function extractPage(html: string, baseUrl: string): { text: string; links: Link[] } {
  const $ = cheerio.load(html.slice(0, MAX_PARSE_CHARS));
  $("script,style,noscript,template").remove();
  const links = collectLinks($, baseUrl);
  $(DROP).remove();
  $(COOKIE_BANNERS).remove();
  const main = $("main,[role=main]").first();
  const root: cheerio.Cheerio<any> = main.length && main.text().trim().length > 200 ? main : $("body").length ? $("body") : $.root();
  root.find("br").replaceWith("\n");
  root.find(BLOCKS).each((_, el) => void $(el).prepend("\n").append("\n"));
  root.find("td,th").append(" ");
  return { text: normalizeText(root.text()), links };
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
  return best?.iso ?? null;
}

export interface Deadlines {
  /** nearest labeled date that is today or later and within 30 months */
  future: string | null;
  /** future, else the latest labeled past date: stable value to compare snapshots */
  primary: string | null;
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
  for (const d of dates) {
    if (d.at < prevEnd) continue; // overlapping match of another form
    const lineStart = text.lastIndexOf("\n", d.at) + 1;
    const before = text.slice(Math.max(prevEnd, lineStart, d.at - 80), d.at);
    // "Deadline" on its own line right above the date (definition lists, stacked table cells)
    const prevLine = before.trim() === "" ? text.slice(0, Math.max(0, lineStart - 1)).split("\n").pop()!.slice(-60) : "";
    const after = text.slice(d.end, d.end + 25).split("\n")[0];
    if (isLabel(before) || isLabel(prevLine) || LABEL_AFTER.test(after)) labeled.push(d.iso);
    prevEnd = d.end;
  }
  const h = new Date(`${today}T00:00:00Z`);
  h.setUTCMonth(h.getUTCMonth() + HORIZON_MONTHS);
  const horizon = h.toISOString().slice(0, 10);
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
  new RegExp(`\\b${NUM}${SUFFIX}\\s?(USD|EUR|euros?|dollars)\\b`, "gi"),
];
const PER_AWARD = /up to|maximum|max\.?|ceiling|per (?:project|award|grant|applicant|year)|each|rang(?:e|es|ing)|awards?|individual grants?/i;
const GENERIC = /grants?|funding|budget|total|fund/i;
const MULT: Record<string, number> = { k: 1e3, thousand: 1e3, m: 1e6, mm: 1e6, million: 1e6, b: 1e9, bn: 1e9, billion: 1e9 };

/** Candidate maximum award: largest amount near per-award words, else near generic funding words. */
export function findAmount(text: string): Amount | null {
  let best: { tier: number; a: Amount } | null = null;
  for (const [i, re] of AMOUNT_RES.entries()) {
    for (const m of text.matchAll(re)) {
      const cur = i === 0 ? m[1].trim().toUpperCase() : m[4].toUpperCase();
      const [intPart, frac, suffix] = i === 0 ? [m[2], m[3], m[4]] : [m[1], m[2], m[3]];
      const value = Math.round(Number(intPart.replace(/,/g, "") + (frac ?? "")) * (MULT[suffix?.toLowerCase() ?? ""] ?? 1));
      const currency = cur.startsWith("€") || cur.startsWith("EUR") ? "EUR" : cur.startsWith("£") || cur.startsWith("GBP") ? "GBP" : "USD";
      const lineStart = text.lastIndexOf("\n", m.index!) + 1;
      const clause = (t: string) => t.split(/[;\n]/);
      const ctx = clause(text.slice(Math.max(lineStart, m.index! - 80), m.index!)).pop() + " " + clause(text.slice(m.index! + m[0].length, m.index! + m[0].length + 30))[0];
      const tier = PER_AWARD.test(ctx) ? 2 : GENERIC.test(ctx) ? 1 : 0;
      if (tier && value > 0 && (!best || tier > best.tier || (tier === best.tier && value > best.a.value))) best = { tier, a: { value, currency } };
    }
  }
  return best?.a ?? null;
}
