// JSON API adapters: build the request, parse the response. Pure functions, unit-tested against recorded fixtures.
import { loadHtml, parseDate, regexDeadline } from "../extract.ts";
import type { RegexBudget } from "../safe_regex.ts";
import type { Env, Opportunity, Source } from "../types.ts";

export interface ApiRequest {
  url: string;
  method: "GET" | "POST";
  headers?: Record<string, string>;
  body?: string | FormData;
}
export interface ApiAdapter {
  request(src: Source, env: Env, now: Date): ApiRequest;
  parse(json: unknown, src: Source, today?: string, budget?: RegexBudget): Opportunity[];
  /** Optional per-opportunity detail fetch (grants_gov): fills award range and description. */
  detail?: {
    limit(src: Source): number;
    request(o: Opportunity, src: Source, env: Env): ApiRequest | null;
    apply(o: Opportunity, json: unknown): void;
  };
}

type Json = Record<string, any>;
const cfg = (s: Source): Json => s.adapter_config ?? {};
const str = (v: unknown): string | null => (v === null || v === undefined || v === "" ? null : String(v));
const utcToday = () => new Date().toISOString().slice(0, 10);

/** Dotted path lookup: 'data.items.0.id'. */
export function getPath(obj: unknown, path: string | undefined): any {
  if (!path) return obj;
  return path.split(".").reduce<any>((o, k) => (o === null || o === undefined ? undefined : o[k]), obj);
}

/** HTML (or plain) to single-line plain text; entities decoded. */
export function plainText(v: unknown): string | null {
  const s = str(v);
  if (s === null) return null;
  // block-level tags become spaces so adjacent list items or paragraphs do not run together
  const t = loadHtml(s.replace(/<\/?(p|li|ul|ol|div|br|h[1-6]|tr|td|th|blockquote)\b[^<>]*>/gi, " ")).text().replace(/\s+/g, " ").trim();
  return t || null;
}

/** Award amount: a number or numeric string ("$1,000,000" ok). "none", blanks, 0 and junk give null. */
export function money(v: unknown): number | null {
  const n = typeof v === "number" ? v : typeof v === "string" && /^\$?\s*[\d,]+(\.\d+)?$/.test(v.trim()) ? Number(v.replace(/[$,\s]/g, "")) : NaN;
  return Number.isFinite(n) && n > 0 ? n : null;
}

const clampInt = (v: unknown, dflt: number, lo: number, hi: number): number => {
  if (v === undefined || v === null) return dflt;
  const n = Number(v);
  return Number.isFinite(n) ? Math.min(hi, Math.max(lo, Math.floor(n))) : dflt;
};

const GG_STATUS: Record<string, Opportunity["status"]> = { posted: "open", forecasted: "forecasted", closed: "closed", archived: "archived" };
const GG_DETAIL_ID = /\/search-results-detail\/(\d+)/;
/** Grants.gov shows a rolling call as a closeDate in 2076 or later: a placeholder, so no deadline. */
const GG_SENTINEL_YEAR = 2070;
const ggDeadline = (v: unknown): string | null => {
  const d = parseDate(str(v));
  return d && Number(d.slice(0, 4)) >= GG_SENTINEL_YEAR ? null : d;
};

export const grantsGov: ApiAdapter = {
  request(src: Source, env: Env): ApiRequest {
    const c = cfg(src);
    const rows = c.rows ?? 25;
    if (env.grantsGovKey) {
      // HHS Simpler Grants API (needs a key). shortcut: shape taken from public docs, no live key available to verify.
      const statuses = String(c.oppStatuses ?? "forecasted|posted").split("|");
      return {
        url: "https://api.simpler.grants.gov/v1/opportunities/search", method: "POST",
        headers: { "Content-Type": "application/json", "X-Auth": env.grantsGovKey },
        body: JSON.stringify({
          query: c.keyword, filters: { opportunity_status: { one_of: statuses } },
          pagination: { page_offset: 1, page_size: rows, sort_order: [{ order_by: "post_date", sort_direction: "descending" }] },
        }),
      };
    }
    const body: Json = { rows, oppStatuses: c.oppStatuses ?? "forecasted|posted" };
    for (const k of ["keyword", "agencies", "fundingCategories", "eligibilities", "aln", "oppNum"]) if (c[k]) body[k] = c[k];
    return { url: "https://api.grants.gov/v1/api/search2", method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) };
  },
  parse(json) {
    const j = json as Json;
    if (Array.isArray(j?.data)) { // Simpler API
      return j.data.map((o: Json): Opportunity => ({
        external_id: String(o.opportunity_number ?? o.opportunity_id), title: String(o.opportunity_title ?? ""),
        url: o.opportunity_id ? `https://simpler.grants.gov/opportunity/${o.opportunity_id}` : null,
        description: str(o.summary?.summary_description), open_date: parseDate(o.summary?.post_date), deadline: ggDeadline(o.summary?.close_date),
        status: GG_STATUS[String(o.opportunity_status)] ?? "open",
      })).filter((o: Opportunity) => o.title);
    }
    const hits: Json[] = (j?.data ?? j)?.oppHits ?? [];
    return hits.map((o): Opportunity => ({
      external_id: String(o.number ?? o.id), title: String(o.title ?? ""), url: o.id ? `https://www.grants.gov/search-results-detail/${o.id}` : null,
      description: str(o.agency), open_date: parseDate(o.openDate), deadline: ggDeadline(o.closeDate),
      status: GG_STATUS[String(o.oppStatus)] ?? "open",
    })).filter((o) => o.title && o.external_id !== "undefined");
  },
  detail: {
    // shortcut: a detail call per item is costly, so the count is capped at 5 per run.
    limit(src) {
      const d = cfg(src).detail;
      if (d === true) return 3;
      if (typeof d === "number" && Number.isFinite(d)) return Math.max(0, Math.min(Math.floor(d), 5));
      return 0;
    },
    request(o) {
      const id = GG_DETAIL_ID.exec(o.url ?? "")?.[1];
      if (!id) return null;
      return { url: "https://api.grants.gov/v1/api/fetchOpportunity", method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ opportunityId: Number(id) }) };
    },
    apply(o, json) {
      try {
        // posted calls carry data.synopsis, forecasted calls carry data.forecast (verified against live responses 2026-11-12)
        const d: Json = (json as Json)?.data ?? {};
        o.award_max_usd = money((d.synopsis ?? d.forecast)?.awardCeiling);
        o.award_min_usd = money((d.synopsis ?? d.forecast)?.awardFloor);
        const desc = plainText(d.synopsis?.synopsisDesc ?? d.forecast?.forecastDesc);
        if (desc) o.description = desc.slice(0, 2000);
      } catch {
        // detail is best effort: a malformed detail response leaves the search fields as they were
      }
    },
  },
};

const EU_STATUS: Record<string, Opportunity["status"]> = { "31094501": "open", "31094502": "forecasted", "31094503": "closed" };
const EU_BOUNDARY = "----SalsavGrantWatch7f3a91c2";
const EU_DEFAULT_QUERY = { bool: { must: [{ terms: { type: ["1", "2", "8"] } }, { terms: { status: ["31094501", "31094502"] } }] } };

/** Nearest deadline on or after today; else the latest deadline. */
function pickDeadline(raw: unknown, today: string): string | null {
  const list: unknown[] = Array.isArray(raw) ? raw : raw === null || raw === undefined ? [] : [raw];
  const dates = [...new Set(list.map((d) => parseDate(str(d))).filter((d): d is string => d !== null))].sort();
  return dates.find((d) => d >= today) ?? dates[dates.length - 1] ?? null;
}

export const euFt: ApiAdapter = {
  request(src) {
    // shortcut: multipart `query` part as used by the public portal; not verified against official docs (none found), fixture-tested only.
    // The multipart body is written out by hand: FormData with Blob parts is encoded by the runtime, and the deployed one is not the one tested.
    const c = cfg(src);
    const part = (name: string, json: unknown) =>
      `--${EU_BOUNDARY}\r\nContent-Disposition: form-data; name="${name}"; filename="blob"\r\nContent-Type: application/json\r\n\r\n${JSON.stringify(json)}\r\n`;
    const body = part("query", c.query ?? EU_DEFAULT_QUERY) + part("languages", ["en"]) + `--${EU_BOUNDARY}--\r\n`;
    const pageSize = clampInt(c.pageSize, 50, 1, 100);
    const text = encodeURIComponent(String(c.text ?? "*"));
    return {
      url: `https://api.tech.ec.europa.eu/search-api/prod/rest/search?apiKey=SEDIA&text=${text}&pageSize=${pageSize}&pageNumber=1`, method: "POST",
      // identity: the deployed runtime failed reading this API's gzip body ("error reading a body from connection")
      headers: { "Content-Type": `multipart/form-data; boundary=${EU_BOUNDARY}`, "Accept-Encoding": "identity" }, body,
    };
  },
  parse(json, _src, today = utcToday()) {
    const results: Json[] = (json as Json)?.results ?? [];
    return results.map((r): Opportunity => {
      const m: Json = r.metadata ?? {};
      const id = str(m.identifier?.[0]) ?? str(r.reference) ?? "";
      return {
        external_id: id, title: str(m.title?.[0]) ?? str(r.title) ?? str(r.summary) ?? "",
        url: id ? `https://ec.europa.eu/info/funding-tenders/opportunities/portal/screen/opportunities/topic-details/${id}` : str(r.url),
        description: str(r.summary)?.slice(0, 2000) ?? null, deadline: pickDeadline(m.deadlineDate, today), open_date: parseDate(m.startDate?.[0]),
        status: EU_STATUS[String(m.status?.[0])] ?? "open",
      };
    }).filter((o) => o.external_id && o.title);
  },
};

export const samGov: ApiAdapter = {
  request(src, env, now) {
    const c = cfg(src);
    const fmt = (d: Date) => `${String(d.getUTCMonth() + 1).padStart(2, "0")}/${String(d.getUTCDate()).padStart(2, "0")}/${d.getUTCFullYear()}`;
    const from = new Date(now.getTime() - (c.postedDays ?? 30) * 86400_000);
    const q = new URLSearchParams({ api_key: env.samKey ?? "", postedFrom: fmt(from), postedTo: fmt(now), limit: String(c.limit ?? 25), offset: "0" });
    for (const k of ["title", "ptype", "ncode", "organizationName"]) if (c[k]) q.set(k, String(c[k]));
    return { url: `https://api.sam.gov/opportunities/v2/search?${q}`, method: "GET" };
  },
  parse(json) {
    const rows: Json[] = (json as Json)?.opportunitiesData ?? [];
    return rows.map((o): Opportunity => ({
      external_id: String(o.noticeId ?? o.solicitationNumber ?? ""), title: String(o.title ?? ""), url: str(o.uiLink),
      deadline: parseDate(o.responseDeadLine ?? o.reponseDeadLine), open_date: parseDate(o.postedDate), status: "open",
    })).filter((o) => o.external_id && o.title);
  },
};

export function getItems(json: unknown, itemsPath: unknown): unknown {
  return itemsPath === undefined || itemsPath === null || itemsPath === "" || itemsPath === "$" ? json : getPath(json, String(itemsPath));
}

export const jsonApi: ApiAdapter = {
  request(src) {
    const c = cfg(src);
    const method = String(c.method ?? "GET").toUpperCase() === "POST" ? "POST" : "GET";
    return {
      url: String(c.url ?? src.url), method,
      headers: method === "POST" ? { "Content-Type": "application/json" } : undefined,
      body: method === "POST" && c.body !== undefined ? JSON.stringify(c.body) : undefined,
    };
  },
  parse(json, src, today = utcToday(), budget) {
    const c = cfg(src);
    const map: Json = c.map ?? {};
    const rx = typeof c.deadline_regex === "string" ? c.deadline_regex : "";
    const order = c.date_order === "dmy" || c.date_order === "mdy" ? c.date_order : undefined;
    const items = getItems(json, c.items_path);
    if (!Array.isArray(items)) return [];
    // a mapping key that is not configured reads nothing (getPath(x, undefined) would return the whole item)
    const at = (it: unknown, key: unknown) => (typeof key === "string" && key ? getPath(it, key) : undefined);
    return items.slice(0, 100).map((it): Opportunity => ({
      external_id: str(at(it, map.external_id ?? "id")) ?? str(at(it, map.url)) ?? "",
      title: plainText(at(it, map.title ?? "title")) ?? "",
      url: str(at(it, map.url)),
      description: plainText(at(it, map.description))?.slice(0, 2000) ?? null,
      // deadline_regex reads the plain-text description only when map.deadline gives no date
      deadline: parseDate(str(at(it, map.deadline))) ?? (rx ? regexDeadline(plainText(at(it, map.description)) ?? "", rx, today, order, budget) : null),
      open_date: parseDate(str(at(it, map.open_date))),
      award_max_usd: money(at(it, map.award_max)),
      status: "open",
    })).filter((o) => o.external_id && o.title);
  },
};

export const API_ADAPTERS: Record<string, ApiAdapter> = { grants_gov: grantsGov, eu_ft: euFt, sam_gov: samGov, json_api: jsonApi };
