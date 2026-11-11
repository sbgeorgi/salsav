// JSON API adapters: build the request, parse the response. Pure functions, unit-tested against recorded fixtures.
import { parseDate } from "../extract.ts";
import type { Env, Opportunity, Source } from "../types.ts";

export interface ApiRequest {
  url: string;
  method: "GET" | "POST";
  headers?: Record<string, string>;
  body?: string | FormData;
}
export interface ApiAdapter {
  request(src: Source, env: Env, now: Date): ApiRequest;
  parse(json: unknown, src: Source): Opportunity[];
}

type Json = Record<string, any>;
const cfg = (s: Source): Json => s.adapter_config ?? {};
const str = (v: unknown): string | null => (v === null || v === undefined || v === "" ? null : String(v));

/** Dotted path lookup: 'data.items.0.id'. */
export function getPath(obj: unknown, path: string | undefined): any {
  if (!path) return obj;
  return path.split(".").reduce<any>((o, k) => (o === null || o === undefined ? undefined : o[k]), obj);
}

const GG_STATUS: Record<string, Opportunity["status"]> = { posted: "open", forecasted: "forecasted", closed: "closed", archived: "archived" };

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
        description: str(o.summary?.summary_description), open_date: parseDate(o.summary?.post_date), deadline: parseDate(o.summary?.close_date),
        status: GG_STATUS[String(o.opportunity_status)] ?? "open",
      })).filter((o: Opportunity) => o.title);
    }
    const hits: Json[] = (j?.data ?? j)?.oppHits ?? [];
    return hits.map((o): Opportunity => ({
      external_id: String(o.number ?? o.id), title: String(o.title ?? ""), url: o.id ? `https://www.grants.gov/search-results-detail/${o.id}` : null,
      description: str(o.agency), open_date: parseDate(o.openDate), deadline: parseDate(o.closeDate),
      status: GG_STATUS[String(o.oppStatus)] ?? "open",
    })).filter((o) => o.title && o.external_id !== "undefined");
  },
};

const EU_STATUS: Record<string, Opportunity["status"]> = { "31094501": "open", "31094502": "forecasted", "31094503": "closed" };
const EU_DEFAULT_QUERY = { bool: { must: [{ terms: { type: ["1", "2", "8"] } }, { terms: { status: ["31094501", "31094502"] } }] } };

export const euFt: ApiAdapter = {
  request(src) {
    // shortcut: multipart `query` part as used by the public portal; not verified against official docs (none found), fixture-tested only.
    const form = new FormData();
    form.append("query", new Blob([JSON.stringify(cfg(src).query ?? EU_DEFAULT_QUERY)], { type: "application/json" }));
    form.append("languages", new Blob([JSON.stringify(["en"])], { type: "application/json" }));
    return { url: "https://api.tech.ec.europa.eu/search-api/prod/rest/search?apiKey=SEDIA&text=*&pageSize=50&pageNumber=1", method: "POST", body: form };
  },
  parse(json) {
    const results: Json[] = (json as Json)?.results ?? [];
    return results.map((r): Opportunity => {
      const m: Json = r.metadata ?? {};
      const id = str(m.identifier?.[0]) ?? str(r.reference) ?? "";
      return {
        external_id: id, title: str(m.title?.[0]) ?? str(r.title) ?? str(r.summary) ?? "",
        url: id ? `https://ec.europa.eu/info/funding-tenders/opportunities/portal/screen/opportunities/topic-details/${id}` : str(r.url),
        description: str(r.summary)?.slice(0, 2000) ?? null, deadline: parseDate(m.deadlineDate?.[0]), open_date: parseDate(m.startDate?.[0]),
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
  parse(json, src) {
    const c = cfg(src);
    const map: Json = c.map ?? {};
    const items = getPath(json, c.items_path);
    if (!Array.isArray(items)) return [];
    return items.slice(0, 100).map((it): Opportunity => ({
      external_id: str(getPath(it, map.external_id ?? "id")) ?? str(getPath(it, map.url)) ?? "", title: str(getPath(it, map.title ?? "title")) ?? "",
      url: str(getPath(it, map.url)), description: str(getPath(it, map.description))?.slice(0, 2000) ?? null,
      deadline: parseDate(str(getPath(it, map.deadline))), status: "open",
    })).filter((o) => o.external_id && o.title);
  },
};

export const API_ADAPTERS: Record<string, ApiAdapter> = { grants_gov: grantsGov, eu_ft: euFt, sam_gov: samGov, json_api: jsonApi };
