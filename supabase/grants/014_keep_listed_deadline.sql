-- 014_keep_listed_deadline.sql (2026-11-12). Live as migration grants_014_keep_listed_deadline, version 20261112023503.
-- Dry run before applying (DO block that raised on purpose): dated call kept its date when it arrived undated; a call past its
-- stored date stayed closed; a new date replaced the old one; a Grants.gov call still cleared its date; reverse patch = old text.
-- Web-page sources (adapter html) often show a call's deadline only on the call's own page. The crawler reads at most
-- 5 of those pages per run, so on the next run the same call can arrive without a date. Until now that erased the stored
-- date and a closed call could read as open again.
-- Change (grants.apply_fetch_result, html sources only):
--   * a call that arrives without a deadline keeps the deadline already stored;
--   * a call whose stored deadline has passed stays closed until a new date arrives.
-- API sources (Grants.gov, EU portal, JSON, feeds) are unchanged: they report their own dates and status every run.
-- Reversible: 014_keep_listed_deadline-rollback.sql. Definition before this change: md5 aeab2d089d73b708347c5bd23806af80.

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
  d := pg_temp.patch1(d, $a$open_date = excluded.open_date, deadline = excluded.deadline, deadline_text = excluded.deadline_text,$a$,
                         $r$open_date = excluded.open_date,
        deadline = case when f.adapter = 'html' then coalesce(excluded.deadline, opportunities.deadline) else excluded.deadline end,
        deadline_text = excluded.deadline_text,$r$);
  d := pg_temp.patch1(d, $a$award_max_usd = coalesce(excluded.award_max_usd, opportunities.award_max_usd), status = excluded.status,$a$,
                         $r$award_max_usd = coalesce(excluded.award_max_usd, opportunities.award_max_usd),
        status = case when f.adapter = 'html' and excluded.deadline is null and opportunities.deadline < v_today then 'closed' else excluded.status end,$r$);
  execute d;
end $mig$;

-- Read-only checks after applying:
--   select has_function_privilege('anon', 'grants.apply_fetch_result(jsonb)', 'execute') as anon,
--          has_function_privilege('authenticated', 'grants.apply_fetch_result(jsonb)', 'execute') as authenticated;  -- both false
--   select position('coalesce(excluded.deadline, opportunities.deadline)' in pg_get_functiondef('grants.apply_fetch_result(jsonb)'::regprocedure)) > 0;  -- true
