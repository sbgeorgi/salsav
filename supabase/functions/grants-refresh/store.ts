// Database access: thin wrappers over the grants.* SQL API (+ the few raw statements the API does not cover).
import type postgres from "postgres";
import type { HostRow } from "./politeness.ts";
import type { ResultPayload, RunRequest, RunStats, Source } from "./types.ts";

export type Sql = ReturnType<typeof postgres>;

export const SOURCE_COLS = `id, name, url, feed_url, adapter, adapter_config, etag, last_modified, content_hash,
  fetchability, consecutive_failures, cycle, next_deadline, page_type, shard`;

const DUE = `status = 'vetted' and adapter <> 'none' and next_check_at <= now()
  and (cooldown_until is null or cooldown_until <= now()) and (lease_until is null or lease_until < now())`;

export function makeStore(sql: Sql) {
  return {
    async checkToken(token: string): Promise<boolean> {
      const [r] = await sql`select grants.check_refresh_token(${token}) as ok`;
      return r.ok === true;
    },
    async startRun(r: RunRequest): Promise<string> {
      const [row] = await sql`select grants.start_run(${r.trigger}, ${r.shard}::int, ${r.shards}::int, ${r.parent_run ?? null}::uuid, ${r.budget_ms}::int) as id`;
      return row.id;
    },
    async finishRun(run: string, stats: RunStats): Promise<void> {
      await sql`select grants.finish_run(${run}::uuid, ${sql.json(stats as never)})`;
    },
    async claim(run: string, r: RunRequest, leaseS: number): Promise<Source[]> {
      if (r.only_ids?.length) {
        return await sql.unsafe(
          `update grants.funders set lease_until = now() + make_interval(secs => $3), lease_run = $1::uuid
            where id = any(string_to_array($2::text, ',')::uuid[]) and status = 'vetted' and adapter <> 'none'
              and (lease_until is null or lease_until < now())
          returning ${SOURCE_COLS}`, [run, r.only_ids.join(","), leaseS]) as unknown as Source[];
      }
      const [row] = await sql`select grants.claim_sources(${run}::uuid, ${r.shard}::int, ${r.shards}::int, ${r.max_sources}::int, ${leaseS}::int) as r`;
      return row.r;
    },
    /** dry_run: same selection as claim, no lease written. */
    async peek(r: RunRequest): Promise<Source[]> {
      if (r.only_ids?.length) {
        return await sql.unsafe(
          `select ${SOURCE_COLS} from grants.funders where id = any(string_to_array($1::text, ',')::uuid[])
             and status = 'vetted' and adapter <> 'none'`, [r.only_ids.join(",")]) as unknown as Source[];
      }
      return await sql.unsafe(
        `select ${SOURCE_COLS} from grants.funders where ${DUE} and (shard % $2::int) = $1::int order by next_check_at, id limit $3`,
        [r.shard, r.shards, r.max_sources]) as unknown as Source[];
    },
    async remainingDue(shard: number, shards: number): Promise<number> {
      const [r] = await sql`select grants.remaining_due(${shard}::int, ${shards}::int) as n`;
      return r.n;
    },
    async lastText(id: string): Promise<{ text: string | null; links: unknown[] | null; content_hash: string | null }> {
      const [r] = await sql`select grants.get_last_text(${id}::uuid) as r`;
      return r.r;
    },
    async apply(p: ResultPayload): Promise<void> {
      await sql`select grants.apply_fetch_result(${sql.json(p as never)})`;
    },
    async hostLoad(hosts: string[]): Promise<HostRow[]> {
      const [r] = await sql`select grants.host_load(${sql.array(hosts)}::text[]) as r`;
      return r.r;
    },
    async hostSave(rows: Record<string, unknown>[]): Promise<void> {
      if (rows.length) await sql`select grants.host_save(${sql.json(rows as never)})`;
    },
    /** Release this run's leases (all of them, or only `ids`). Processed sources already cleared theirs. */
    async release(run: string, ids?: string[]): Promise<void> {
      await sql.unsafe(
        `update grants.funders set lease_until = null, lease_run = null where lease_run = $1::uuid
           and ($2::text is null or id = any(string_to_array($2::text, ',')::uuid[]))`,
        [run, ids ? ids.join(",") : null]);
    },
    /** Host already cooling at start: hand the sources back without counting a failure, hidden until the cooldown ends. */
    async defer(run: string, ids: string[], untilMs: number): Promise<void> {
      await sql.unsafe(
        `update grants.funders set lease_until = null, lease_run = null, cooldown_until = greatest(coalesce(cooldown_until, to_timestamp(0)), to_timestamp($3::double precision / 1000))
           where lease_run = $1::uuid and id = any(string_to_array($2::text, ',')::uuid[])`,
        [run, ids.join(","), untilMs]);
    },
  };
}

export type Store = ReturnType<typeof makeStore>;
