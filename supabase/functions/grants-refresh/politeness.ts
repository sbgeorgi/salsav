// Per-host limiter (concurrency + spacing + shared cooldown) and a global concurrency cap.
import type { Clock, HostStats } from "./types.ts";
import type { Robots } from "./robots.ts";

export interface PolitenessOpts {
  minIntervalMs: number; // floor for spacing between request starts to one host
  jitterMs: number; // random 0..jitterMs added to every spacing
  maxPerHost: number; // 1, max 2
  globalMax: number; // concurrency across hosts
  crawlDelayCapMs: number;
}

export const DEFAULT_POLITENESS: PolitenessOpts = { minIntervalMs: 2000, jitterMs: 1000, maxPerHost: 1, globalMax: 4, crawlDelayCapMs: 30_000 };

/** Row shape of grants.host_load / host_save (epoch ms). */
export interface HostRow {
  host: string;
  min_interval_ms?: number;
  cooldown_until_ms?: number | null;
  last_request_at_ms?: number | null;
  consecutive_throttles?: number;
  robots_txt?: string | null;
  robots_fetched_at_ms?: number | null;
}

export class HostState {
  active = 0;
  maxConcurrent = 0;
  nextAt = 0;
  cooldownUntil = 0;
  crawlDelayMs = 0;
  consecutiveThrottles = 0;
  requests = 0;
  throttles = 0;
  lastStart: number | null = null;
  gaps: number[] = [];
  robots: Robots | null = null;
  robotsText: string | null = null;
  robotsFetchedAt: number | null = null;
  robotsDirty = false;
  profile: { ua: string; accept: string; lang: string } | null = null;
  tail: Promise<void> = Promise.resolve();
  freed: (() => void) | null = null;
  readonly host: string;
  constructor(host: string) {
    this.host = host;
  }
}

export class Politeness {
  readonly hosts = new Map<string, HostState>();
  private globalActive = 0;
  private globalWaiters: (() => void)[] = [];
  readonly clock: Clock;
  readonly opts: PolitenessOpts;
  private loader?: (host: string) => Promise<HostRow | null>;
  constructor(clock: Clock, opts: PolitenessOpts = DEFAULT_POLITENESS, loader?: (host: string) => Promise<HostRow | null>) {
    this.clock = clock;
    this.opts = opts;
    this.loader = loader;
  }

  /** Seed persisted state (from grants.host_load). */
  seed(row: HostRow): HostState {
    const h = this.get(row.host);
    h.cooldownUntil = row.cooldown_until_ms ?? 0;
    h.consecutiveThrottles = row.consecutive_throttles ?? 0;
    if (row.last_request_at_ms) h.nextAt = Math.max(h.nextAt, row.last_request_at_ms + this.interval(h));
    h.robotsText = row.robots_txt ?? null;
    h.robotsFetchedAt = row.robots_fetched_at_ms ?? null;
    return h;
  }

  get(host: string): HostState {
    let h = this.hosts.get(host);
    if (!h) this.hosts.set(host, h = new HostState(host));
    return h;
  }

  /** Get state, lazily loading persisted rows for hosts first seen mid-run (e.g. redirect targets). */
  async ensure(host: string): Promise<HostState> {
    if (this.hosts.has(host) || !this.loader) return this.get(host);
    const h = this.get(host);
    const row = await this.loader(host);
    if (row) this.seed(row);
    return h;
  }

  interval(h: HostState): number {
    return Math.max(this.opts.minIntervalMs, Math.min(h.crawlDelayMs, this.opts.crawlDelayCapMs));
  }

  cooldownRemaining(host: string): number {
    return Math.max(0, (this.hosts.get(host)?.cooldownUntil ?? 0) - this.clock.now());
  }

  /** Wait for a request slot. Resolves to a release function, or null if the wait would pass `deadline` (epoch ms). */
  async acquire(host: string, deadline: number): Promise<(() => void) | null> {
    const h = await this.ensure(host);
    const prev = h.tail;
    let done!: () => void;
    h.tail = new Promise<void>((r) => (done = r)); // FIFO admission per host
    await prev;
    try {
      while (h.active >= this.opts.maxPerHost) await new Promise<void>((r) => (h.freed = r));
      for (;;) {
        const wait = Math.max(h.nextAt, h.cooldownUntil) - this.clock.now();
        if (wait <= 0) break;
        if (this.clock.now() + wait > deadline) return null;
        await this.clock.sleep(wait);
      }
      await this.takeGlobal();
      const start = this.clock.now();
      if (h.lastStart !== null) h.gaps.push(start - h.lastStart);
      h.lastStart = start;
      h.nextAt = start + this.interval(h) + Math.floor(this.clock.random() * (this.opts.jitterMs + 1));
      h.active++;
      h.requests++;
      h.maxConcurrent = Math.max(h.maxConcurrent, h.active);
    } finally {
      done();
    }
    return () => {
      h.active--;
      this.giveGlobal();
      const f = h.freed;
      h.freed = null;
      f?.();
    };
  }

  private async takeGlobal(): Promise<void> {
    if (this.globalActive >= this.opts.globalMax) await new Promise<void>((r) => this.globalWaiters.push(r));
    else this.globalActive++;
  }

  private giveGlobal(): void {
    const w = this.globalWaiters.shift();
    if (w) w(); // slot handed over, count unchanged
    else this.globalActive--;
  }

  /** Record a 429/503: cooldown until now+delayMs. */
  throttle(host: string, delayMs: number): void {
    const h = this.get(host);
    h.throttles++;
    h.consecutiveThrottles++;
    h.cooldownUntil = Math.max(h.cooldownUntil, this.clock.now() + delayMs);
  }

  /** Persistent cooldown after a request exhausted its tries: 5 min, doubling per repeated exhaustion, cap 1 h. */
  exhaust(host: string, retryAfterMs: number | null): number {
    const h = this.get(host);
    const ms = Math.max(retryAfterMs ?? 0, Math.min(3_600_000, 300_000 * 2 ** Math.max(0, h.consecutiveThrottles - 3)));
    h.cooldownUntil = Math.max(h.cooldownUntil, this.clock.now() + ms);
    return ms;
  }

  ok(host: string): void {
    this.get(host).consecutiveThrottles = 0;
  }

  profileFor(host: string, pick: () => { ua: string; accept: string; lang: string }) {
    const h = this.get(host);
    return h.profile ??= pick();
  }

  stats(): Record<string, HostStats> {
    const out: Record<string, HostStats> = {};
    for (const [k, h] of this.hosts) {
      if (!h.requests && !h.throttles) continue;
      out[k] = {
        requests: h.requests, throttles: h.throttles, max_concurrent: h.maxConcurrent,
        min_gap_ms: h.gaps.length ? Math.round(Math.min(...h.gaps)) : null,
        avg_gap_ms: h.gaps.length ? Math.round(h.gaps.reduce((a, b) => a + b, 0) / h.gaps.length) : null,
      };
    }
    return out;
  }

  /** Rows for grants.host_save (hosts we touched). */
  toSave(): Record<string, unknown>[] {
    return [...this.hosts.values()].filter((h) => h.requests || h.throttles || h.robotsDirty).map((h) => ({
      host: h.host,
      min_interval_ms: this.interval(h),
      cooldown_until_ms: h.cooldownUntil > this.clock.now() ? h.cooldownUntil : null,
      last_request_at_ms: h.lastStart,
      consecutive_throttles: h.consecutiveThrottles,
      requests_inc: h.requests,
      throttles_inc: h.throttles,
      robots_txt: h.robotsDirty ? h.robotsText : null,
      robots_fetched_at_ms: h.robotsDirty ? h.robotsFetchedAt : null,
    }));
  }
}
