CREATE OR REPLACE FUNCTION grants.claim_sources(p_run uuid, p_shard integer, p_shards integer, p_limit integer, p_lease_s integer DEFAULT 240)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'grants', 'extensions', 'pg_temp'
AS $function$declare r jsonb;
begin
  if p_shards is null or p_shards < 1 or p_shard < 0 or p_shard >= p_shards then
    raise exception 'bad shard %/%', p_shard, p_shards;
  end if;
  with c as (
    select id from grants.funders
     where status = 'vetted' and adapter <> 'none'
       and next_check_at <= now()
       and (cooldown_until is null or cooldown_until <= now())
       and (lease_until is null or lease_until < now())
       and (shard % p_shards) = p_shard
     order by next_check_at, id
     limit greatest(p_limit, 0)
     for update skip locked
  ), u as (
    update grants.funders f
       set lease_until = now() + make_interval(secs => p_lease_s), lease_run = p_run
      from c where f.id = c.id
    returning f.id, f.name, f.url, f.feed_url, f.adapter, f.adapter_config, f.etag, f.last_modified, f.content_hash,
              f.fetchability, f.consecutive_failures, f.cycle, f.next_deadline, f.page_type, f.shard
  )
  select coalesce(jsonb_agg(to_jsonb(u)), '[]'::jsonb) into r from u;
  return r;
end $function$
