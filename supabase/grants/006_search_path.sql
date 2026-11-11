-- Clears the advisor's function_search_path_mutable WARN for the grants.* helper functions (all SECURITY INVOKER, service-side only).
alter function grants.apply_fetch_result(jsonb) set search_path = grants, extensions, pg_temp;
alter function grants.claim_sources(uuid, integer, integer, integer, integer) set search_path = grants, extensions, pg_temp;
alter function grants.finish_run(uuid, jsonb) set search_path = grants, extensions, pg_temp;
alter function grants.get_last_text(uuid) set search_path = grants, extensions, pg_temp;
alter function grants.host_load(text[]) set search_path = grants, extensions, pg_temp;
alter function grants.host_save(jsonb) set search_path = grants, extensions, pg_temp;
alter function grants.name_key(text) set search_path = grants, extensions, pg_temp;
alter function grants.register_source(jsonb, text, text) set search_path = grants, extensions, pg_temp;
alter function grants.remaining_due(integer, integer) set search_path = grants, extensions, pg_temp;
alter function grants.start_run(text, integer, integer, uuid, integer) set search_path = grants, extensions, pg_temp;
alter function grants.touch_updated_at() set search_path = grants, extensions, pg_temp;
alter function grants.url_norm(text) set search_path = grants, extensions, pg_temp;
