// One shard invocation: claim -> fetch politely per host (parallel across hosts) -> detect changes -> record -> release.
import { fetchSource } from "./adapters/index.ts";
import { newBudget } from "./safe_regex.ts";
import { computeChange } from "./diff.ts";
import { findDeadlines } from "./extract.ts";
import { DEFAULT_POLITENESS, Politeness, type PolitenessOpts } from "./politeness.ts";
import type { Store } from "./store.ts";
import type { Clock, Env, Fetched, Link, ResultPayload, RunRequest, RunStats, Source } from "./types.ts";

export const TEXT_MAX = 60_000;
export const OK_NEXT_CHECK_S = 11.5 * 3600; // twice-daily cron fires ~12h apart: stay under it so a source is never skipped a cycle
export const DEADLINE_CYCLES = ["fixed_deadline", "annual_recurring", "closed_unknown"];

export interface EngineDeps {
  store: Store;
  clock: Clock;
  fetchImpl: typeof fetch;
  fetchH1?: typeof fetch;
  env: Env;
  requestTimeoutMs?: number;
  politeness?: Partial<PolitenessOpts>;
  maxTries?: number;
  leaseS?: number;
  canChain?: boolean;
}

export interface SourceReport {
  id: string;
  name: string;
  kind: string;
  http_status: number | null;
  change?: string;
  summary?: string;
  error?: string;
  next_deadline?: string | null;
  /** what the adapter extracted: calls collected (after the config's filter), how many open, page text length */
  opps?: number | null;
  open?: number | null;
  /** items the channel listed before the config's filter */
  raw?: number | null;
  text_len?: number;
  /** dry_run only: first collected calls, so a probe shows real content */
  sample?: { title: string; deadline: string | null; status: string | null }[];
}

export interface RunResult {
  run_id: string;
  stats: RunStats;
  remaining_due: number;
  results: SourceReport[];
}

const API_ADAPTER_NAMES = new Set(["grants_gov", "sam_gov", "eu_ft", "json_api"]);
const hostOf = (url: string) => {
  try {
    return new URL(url).host;
  } catch {
    return "invalid";
  }
};
// API adapters talk to their own endpoint, not to the funder's page host: group (and cool down) them apart from it
const groupOf = (s: Source) => (API_ADAPTER_NAMES.has(s.adapter) ? `api:${s.adapter}` : hostOf(s.url));

async function toPayload(deps: EngineDeps, src: Source, f: Fetched, run: string, today: string): Promise<ResultPayload> {
  const base = { id: src.id, run, kind: f.kind, http_status: f.http_status ?? null };
  if (f.kind === "not_modified") return { ...base, next_check_s: OK_NEXT_CHECK_S };
  if (f.kind === "robots_blocked") return { ...base, error: f.error, next_check_s: 86400 };
  if (f.kind === "error") {
    const p: ResultPayload = { ...base, error: f.error, fetchability: f.fetchability };
    if (f.cooldownMs) {
      p.cooldown_s = Math.ceil(f.cooldownMs / 1000);
      p.next_check_s = Math.max(p.cooldown_s, 900);
    }
    return p;
  }
  const text = (f.text ?? "").slice(0, TEXT_MAX);
  const p: ResultPayload = {
    ...base, etag: f.etag ?? null, last_modified: f.last_modified ?? null, content_hash: f.content_hash, text, links: f.links ?? [],
    opportunities: f.opportunities, fetchability: f.fetchability, next_check_s: OK_NEXT_CHECK_S,
  };
  if (f.content_hash !== src.content_hash) {
    const last = src.content_hash ? await deps.store.lastText(src.id) : null;
    const prev = last ? { text: (last.text ?? "").slice(0, TEXT_MAX), links: (last.links ?? []) as Link[] } : null;
    p.change = computeChange(prev, { text, links: p.links! }, today, !!f.isHtml);
    const due = f.isHtml && DEADLINE_CYCLES.includes(src.cycle) ? findDeadlines(text, today).future : null;
    if (due) p.next_deadline = due; // only a labeled future date, only for cycles that have fixed deadlines
  }
  return p;
}

export async function runShard(deps: EngineDeps, req: RunRequest): Promise<RunResult> {
  const { store, clock } = deps;
  const t0 = clock.now();
  const deadline = t0 + req.budget_ms;
  const softStop = deadline - Math.min(15_000, req.budget_ms * 0.3); // no new sources after this
  const today = new Date(t0).toISOString().slice(0, 10);
  const stats: RunStats = {
    planned: 0, fetched: 0, not_modified: 0, changed: 0, errors: 0, throttled: 0, robots_skipped: 0, bytes: 0, elapsed_ms: 0, chained: false, hosts: {},
  };
  const results: SourceReport[] = [];
  const done = new Set<string>();
  const run = await store.startRun(req);
  const pol = new Politeness(clock, { ...DEFAULT_POLITENESS, ...deps.politeness }, async (h) => (await store.hostLoad([h]))[0] ?? null);
  let crashed: unknown = null;
  let remaining = 0;
  try {
    // dry_run is a probe: drop validators so every source is fetched in full and shows what it extracts
    const claimed = req.dry_run
      ? (await store.peek(req)).map((s) => ({ ...s, etag: null, last_modified: null }))
      : await store.claim(run, req, deps.leaseS ?? 240);
    stats.planned = claimed.length;
    const byHost = new Map<string, Source[]>();
    for (const s of claimed) byHost.set(groupOf(s), [...(byHost.get(groupOf(s)) ?? []), s]);
    for (const row of await store.hostLoad([...byHost.keys()])) pol.seed(row);

    const http = { pol, fetchImpl: deps.fetchImpl, fetchH1: deps.fetchH1, env: deps.env, deadline, requestTimeoutMs: deps.requestTimeoutMs ?? 20_000, maxTries: deps.maxTries };
    const exhausted = new Map<string, number>(); // host -> cooldown ms set during this run
    let budgetHit = false;

    const record = async (src: Source, p: ResultPayload, f: Fetched) => {
      if (!req.dry_run) await store.apply(p);
      done.add(src.id);
      stats.bytes += f.bytes ?? 0;
      if (f.kind === "ok") stats.fetched++;
      else if (f.kind === "not_modified") stats.not_modified++;
      else if (f.kind === "robots_blocked") stats.robots_skipped++;
      else stats.errors++;
      if (p.change) stats.changed++;
      results.push({
        id: src.id, name: src.name, kind: f.kind, http_status: p.http_status ?? null, change: p.change?.kind, summary: p.change?.summary,
        error: p.error, next_deadline: p.next_deadline,
        opps: f.opportunities ? f.opportunities.length : null,
        open: f.opportunities ? f.opportunities.filter((o) => o.status !== "closed" && o.status !== "archived").length : null,
        raw: f.raw_count ?? null,
        text_len: f.text?.length ?? 0,
        ...(req.dry_run && f.opportunities?.length
          ? { sample: f.opportunities.slice(0, 3).map((o) => ({ title: String(o.title ?? "").slice(0, 120), deadline: o.deadline ?? null, status: o.status ?? null })) }
          : {}),
      });
    };

    const processOne = async (src: Source, host: string) => {
      const cool = exhausted.get(host);
      let f: Fetched | null;
      try {
        f = cool
          ? { kind: "error", error: "host cooling down after repeated throttling", cooldownMs: cool, host }
          : await fetchSource({ d: http, today, now: new Date(clock.now()), budget: newBudget() }, src);
        if (!f) {
          budgetHit = true;
          return;
        }
        if (f.cooldownMs && f.host) exhausted.set(f.host, f.cooldownMs);
        await record(src, await toPayload(deps, src, f, run, today), f);
      } catch (e) {
        f = { kind: "error", error: `unexpected: ${(e as Error).message}`.slice(0, 300) };
        await record(src, await toPayload(deps, src, f, run, today), f);
      }
    };

    await Promise.all([...byHost].map(async ([host, queue]) => {
      const left = pol.cooldownRemaining(host);
      if (left > 0 && !req.dry_run) { // cooling from an earlier run: hand back without penalty
        await store.defer(run, queue.map((s) => s.id), clock.now() + left);
        queue.forEach((s) => done.add(s.id));
        return;
      }
      const workers = Array.from({ length: pol.opts.maxPerHost }, async () => {
        for (;;) {
          const s = queue.shift();
          if (!s || budgetHit || (clock.now() > softStop && !exhausted.has(host))) return; // leftovers are released below
          await processOne(s, host);
        }
      });
      await Promise.all(workers);
    }));
  } catch (e) {
    crashed = e;
  } finally {
    try {
      await store.release(run); // sources claimed but not processed (budget exit, crash) go back to the queue
      const pending = req.dry_run ? 0 : await store.remainingDue(req.shard, req.shards);
      remaining = pending;
      stats.chained = !!deps.canChain && pending > 0 && req.chain_depth < 6;
      stats.hosts = pol.stats();
      stats.throttled = Object.values(stats.hosts).reduce((a, h) => a + h.throttles, 0);
      stats.elapsed_ms = Math.round(clock.now() - t0);
      if (!req.dry_run) await store.hostSave(pol.toSave());
      await store.finishRun(run, stats);
    } catch (e) {
      crashed ??= e;
    }
  }
  if (crashed) throw crashed;
  return { run_id: run, stats, remaining_due: remaining, results };
}
