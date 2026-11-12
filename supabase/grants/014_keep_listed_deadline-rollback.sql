-- Undo 014_keep_listed_deadline.sql: put back the two lines of grants.apply_fetch_result as they were on 2026-11-12
-- (definition md5 aeab2d089d73b708347c5bd23806af80). Stored deadlines are not touched.

create or replace function pg_temp.patch1(d text, a text, r text) returns text language plpgsql as $fn$
begin
  if a = '' or (length(d) - length(replace(d, a, ''))) / length(a) <> 1 then
    raise exception 'patch anchor not found exactly once: %', left(a, 90);
  end if;
  return replace(d, a, r);
end $fn$;

do $mig$
declare d text;
begin
  d := pg_get_functiondef('grants.apply_fetch_result(jsonb)'::regprocedure);
  d := pg_temp.patch1(d, $a$open_date = excluded.open_date,
        deadline = case when f.adapter = 'html' then coalesce(excluded.deadline, opportunities.deadline) else excluded.deadline end,
        deadline_text = excluded.deadline_text,$a$,
                         $r$open_date = excluded.open_date, deadline = excluded.deadline, deadline_text = excluded.deadline_text,$r$);
  d := pg_temp.patch1(d, $a$award_max_usd = coalesce(excluded.award_max_usd, opportunities.award_max_usd),
        status = case when f.adapter = 'html' and excluded.deadline is null and opportunities.deadline < v_today then 'closed' else excluded.status end,$a$,
                         $r$award_max_usd = coalesce(excluded.award_max_usd, opportunities.award_max_usd), status = excluded.status,$r$);
  if md5(d) <> 'aeab2d089d73b708347c5bd23806af80' then
    raise warning 'restored definition differs from the 2026-11-12 one (a later change is present): md5 %', md5(d);
  end if;
  execute d;
end $mig$;
