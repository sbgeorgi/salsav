// Shared types. Logic modules use only web APIs + `postgres` + `cheerio` so they run on Deno and Node 22.

export interface Clock {
  now(): number;
  sleep(ms: number): Promise<void>;
  random(): number;
}

export const realClock: Clock = {
  now: () => Date.now(),
  sleep: (ms) => new Promise((r) => setTimeout(r, Math.max(0, ms))),
  random: () => Math.random(),
};

export interface Env {
  allowLocal: boolean;
  grantsGovKey?: string;
  samKey?: string;
}

/** Row returned by grants.claim_sources. */
export interface Source {
  id: string;
  name: string;
  url: string;
  feed_url: string | null;
  adapter: "html" | "rss" | "grants_gov" | "sam_gov" | "eu_ft" | "json_api" | "none";
  adapter_config: Record<string, unknown>;
  etag: string | null;
  last_modified: string | null;
  content_hash: string | null;
  fetchability: string;
  consecutive_failures: number;
  cycle: string;
  next_deadline: string | null;
  page_type: string;
  shard: number;
}

export interface Link {
  url: string;
  label: string;
  type: "pdf" | "doc" | "xls" | "zip" | "page";
}

export interface Opportunity {
  external_id: string;
  title: string;
  url?: string | null;
  apply_url?: string | null;
  description?: string | null;
  open_date?: string | null;
  deadline?: string | null;
  deadline_text?: string | null;
  award_min_usd?: number | null;
  award_max_usd?: number | null;
  status?: "forecasted" | "open" | "closed" | "archived";
  doc_links?: Link[];
}

export interface RunRequest {
  shard: number;
  shards: number;
  trigger: string;
  budget_ms: number;
  max_sources: number;
  chain_depth: number;
  dry_run: boolean;
  only_ids?: string[];
  parent_run?: string | null;
}

export interface HostStats {
  requests: number;
  throttles: number;
  min_gap_ms: number | null;
  avg_gap_ms: number | null;
  max_concurrent: number;
}

export interface RunStats {
  planned: number;
  fetched: number;
  not_modified: number;
  changed: number;
  errors: number;
  throttled: number;
  robots_skipped: number;
  bytes: number;
  elapsed_ms: number;
  chained: boolean;
  hosts: Record<string, HostStats>;
}

/** Outcome of fetching one source, before change detection. */
export interface Fetched {
  kind: "ok" | "not_modified" | "error" | "robots_blocked";
  http_status?: number | null;
  error?: string;
  etag?: string | null;
  last_modified?: string | null;
  content_hash?: string;
  text?: string;
  links?: Link[];
  opportunities?: Opportunity[];
  fetchability?: string;
  /** set when the host asked us to slow down (429/503) or timed out repeatedly: persistent cooldown to apply */
  cooldownMs?: number;
  host?: string;
  /** 403/429/5xx/exception: eligible for html<->feed fallback */
  fallbackOk?: boolean;
  /** html adapter only: next_deadline is extracted from page text */
  isHtml?: boolean;
  bytes?: number;
  truncated?: boolean;
  /** items the channel listed before the config's filter and cap (probe report) */
  raw_count?: number;
}

export interface ResultPayload {
  id: string;
  run: string;
  kind: Fetched["kind"];
  http_status?: number | null;
  error?: string;
  etag?: string | null;
  last_modified?: string | null;
  content_hash?: string;
  text?: string;
  links?: Link[];
  change?: { kind: string; summary: string; diff: Record<string, unknown> };
  next_deadline?: string | null;
  fetchability?: string;
  next_check_s?: number;
  cooldown_s?: number;
  opportunities?: Opportunity[];
}
