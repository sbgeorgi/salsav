CREATE OR REPLACE FUNCTION grants.check_pass(p_pass text)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_hash text; v_ok boolean; v_fail int; v_max int; v_min int;
begin
  select (value #>> '{}')::int into v_max from grants.settings where key = 'lockout_failures';
  select (value #>> '{}')::int into v_min from grants.settings where key = 'lockout_minutes';
  select count(*) into v_fail from grants.auth_attempts
    where purpose = 'passcode' and not ok and at > now() - make_interval(mins => coalesce(v_min, 15));
  if v_fail >= coalesce(v_max, 8) then
    raise exception 'locked' using errcode = 'P0001', hint = 'Too many wrong passcodes; wait and retry.';
  end if;
  select value #>> '{}' into v_hash from grants.settings where key = 'passcode_hash';
  v_ok := v_hash is not null and p_pass is not null and extensions.crypt(p_pass, v_hash) = v_hash;
  insert into grants.auth_attempts(ok) values (v_ok);
  if v_ok then delete from grants.auth_attempts where not ok and purpose = 'passcode'; end if;
  return v_ok;
end $function$
