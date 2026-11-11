// Retry delays: Retry-After wins (capped), otherwise full-jitter exponential.

export const BACKOFF_BASE_MS = 2000;
export const BACKOFF_CAP_MS = 300_000;
export const RETRY_AFTER_CAP_MS = 300_000;

/** Full jitter: uniform in [0, min(cap, base * 2^attempt)], attempt counted from 0. */
export function fullJitter(attempt: number, random: () => number, base = BACKOFF_BASE_MS, cap = BACKOFF_CAP_MS): number {
  return Math.floor(random() * Math.min(cap, base * 2 ** attempt));
}

/** Retry-After header: delta-seconds or HTTP date. Returns ms capped at 300s, or null. */
export function parseRetryAfter(v: string | null | undefined, nowMs: number): number | null {
  if (!v) return null;
  const s = v.trim();
  let ms: number;
  if (/^\d+(\.\d+)?$/.test(s)) ms = Number(s) * 1000;
  else {
    const t = Date.parse(s);
    if (Number.isNaN(t)) return null;
    ms = t - nowMs;
  }
  return Math.min(Math.max(ms, 0), RETRY_AFTER_CAP_MS);
}
