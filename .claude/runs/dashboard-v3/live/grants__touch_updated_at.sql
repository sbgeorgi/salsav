CREATE OR REPLACE FUNCTION grants.touch_updated_at()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'grants', 'extensions', 'pg_temp'
AS $function$
begin new.updated_at := now(); return new; end $function$
