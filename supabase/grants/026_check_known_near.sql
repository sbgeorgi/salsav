-- 026_check_known_near.sql
-- grants.check_known also reports a funder that is already stored under another name.
--
-- Before: a hit needed the same name+program key, the same URL, or a stored key that starts with the
-- candidate's name. The discovery run "Pass 2 2026-11-20" therefore registered three rows that were
-- already listed and had to demote them:
--   NYSERDA (New York State ...)   vs  New York State ... (NYSERDA)            name written the other way round, other path on the same site
--   IDRC (International ...)       vs  International ... (IDRC)                same, and the new URL sits under the stored funding page
--   NOAA Climate Program Office    vs  NOAA Climate Adaptation Partnerships    program stored as its own funder, grants.gov link; only NOAA and RISA connect them
--
-- Now: the exact hit is unchanged, and near matches carry their evidence. New keys per match: id, url,
-- match (exact | likely | related) and why (list of reasons). "exact" keeps its meaning. Nothing is
-- blocked: register_source is untouched, the agent judges a near match (discovery-task.md steps 6 and 7).
-- Matches are ordered exact, likely, related, best 8 per element (was an unordered 5, which could drop the exact row).
--
-- Whole-body rewrite under md5 guards (skill grants-sql-function-patch): it refuses to run on any other
-- definition than the pre-026 one and refuses to store any other text than the tested one.
-- Tested 2026-11-20 in a rolled-back DO block on real rows, old definition against this text:
--   the three demoted rows above and four older demoted duplicates, each sent as a candidate: the row it
--   duplicates comes back "likely" in all seven (the old definition found one of the four, none of the three);
--   the 113 vetted funders against each other: 0 exact, 1 likely pair (6df99f2d NOAA Climate Adaptation
--   Partnerships and 9110afb8 NOAA Inflation Reduction Act climate data, both name RISA), 75 related pairs
--   (rows of one organisation or site: NSF, USDA, DOE, Reclamation, BARD; 7 pairs where one row's program
--   text names NSF or DOE); 30 rows are in a pair; the 14 pairs the old definition linked are all kept;
--   48 invented aliases of 24 stored funders: 8 likely, 33 related, 7 without a match (program-only names on
--   third-party sites); 12 funders not on record: no match; 10 new programs of stored organisations: the
--   organisation's row is "related" in all 10, one is also "likely" against a sibling row (parent page).
-- Live since 2026-11-20 as migration 20261120193406 (live md5 checked; rollback dry-run gave the pre-026 md5).
-- Rollback: 026_check_known_near-rollback.sql.

do $mig$
declare
  o text := pg_get_functiondef('grants.check_known(jsonb)'::regprocedure);
  n constant text := $new$CREATE OR REPLACE FUNCTION grants.check_known(p jsonb)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO 'grants', 'extensions', 'pg_temp'
AS $function$
  -- Known-funder check for the discovery run. The exact hit is the same name+program key or the same URL.
  -- Near matches carry their evidence in "why", so a funder stored under another name is seen before it is registered:
  --   who:  same name words in any order, one name starts with the other, the names share an acronym or initials, same site
  --   what: an acronym or number the two name+program texts share that is not the organisation's own, the same program text,
  --         or this URL sitting under the stored page (a stored page under this URL counts only with name evidence)
  -- match = exact | likely (who and what) | related (only one of the two). Best 8 per element.
  with k as (
    select '{and,of,the,for,in,on,at,to,a,an,de,la,le,les,du,des,del,el,los,las,y,e,da,do,dos,das,und,der,die,fur,et,pour,en,van}'::text[] as stop,
           -- shortcut: hand lists of generic all-caps tokens and of sites many funders post on, extend them when a run reports noise
           '{USA,USD,CAD,EUR,GBP,AUD,RFP,RFA,RFI,RFQ,FOA,NOFO,NOFA,PON,GFO,BAA,LOI,FAQ,SBIR,STTR,LLC,INC,LTD,NGO,AND,THE,FOR,TBD,PDF,III}'::text[] as generic,
           '{grants.gov,sam.gov,challenge.gov,federalregister.gov,ec.europa.eu,halo.science,herox.com,submittable.com,smapply.org,smapply.io,fluxx.io,devex.com,fundsforngos.org,linkedin.com,google.com,youtube.com,facebook.com,x.com,twitter.com,wikipedia.org}'::text[] as portal
  ), src as (
    select null::bigint as ord, f.id, f.name, f.program, f.status, f.reject_reason, f.url, f.url_norm, f.name_key
      from grants.funders f
    union all
    select e.ord, null, e.x->>'name', e.x->>'program', null, null, e.x->>'url', grants.url_norm(e.x->>'url'),
           grants.name_key((e.x->>'name') || ' ' || coalesce(e.x->>'program', ''))
      from jsonb_array_elements(p) with ordinality e(x, ord)
  ), t as materialized (
    select s.*, grants.name_key(s.name) as nk, coalesce(grants.name_key(s.program), '') as pk,
           -- registrable domain: three labels for country second levels (org.il, gov.co, gc.ca), ec.europa.eu and US state sites (ca.gov), else two
           substring(split_part(s.url_norm, '/', 1) from '[^.]+\.(?:(?:com?|org|gov|gob|go|gc|gouv|govt|ac|edu|net|or|ne|europa)\.[a-z]{2}|[a-z]{2}\.gov|[a-z0-9-]+)$') as dom,
           array(select distinct lower(m[1]) from regexp_matches(coalesce(s.name, ''), '[[:alnum:]]+', 'g') m
                  where lower(m[1]) <> all (k.stop) order by 1) as words,
           array(select distinct lower(m[1]) from regexp_matches(coalesce(s.program, ''), '[[:alnum:]]+', 'g') m
                  where lower(m[1]) <> all (k.stop)) as pw,
           array(select distinct m[1] from regexp_matches(coalesce(s.name, ''), '\m(?:[A-Z][A-Z0-9]{2,}|[0-9]{4,})\M', 'g') m
                  where m[1] <> all (k.generic) and m[1] !~ '^(FY[0-9]*|(19|20)[0-9]{2}|[0-9]*000)$') as an,
           array(select distinct m[1] from regexp_matches(coalesce(s.name, '') || ' ' || coalesce(s.program, ''), '\m(?:[A-Z][A-Z0-9]{2,}|[0-9]{4,})\M', 'g') m
                  where m[1] <> all (k.generic) and m[1] !~ '^(FY[0-9]*|(19|20)[0-9]{2}|[0-9]*000)$') as aa,
           -- initials per name part: with and without small words, all-caps words spelled out or skipped, a leading US dropped (NYSERDA, DOE, USDA + NIFA, NSF)
           array(select distinct v
                   from (select string_agg(case when w.m[1] ~ '^[A-Z]{2,}$' then w.m[1] else upper(left(w.m[1], 1)) end, '' order by w.j)
                                  filter (where lower(w.m[1]) <> all (k.stop)) as a1,
                                string_agg(case when w.m[1] ~ '^[A-Z]{2,}$' then w.m[1] else upper(left(w.m[1], 1)) end, '' order by w.j) as a2,
                                string_agg(upper(left(w.m[1], 1)), '' order by w.j)
                                  filter (where w.m[1] !~ '^[A-Z]{2,}$' and lower(w.m[1]) <> all (k.stop)) as b1,
                                string_agg(upper(left(w.m[1], 1)), '' order by w.j) filter (where w.m[1] !~ '^[A-Z]{2,}$') as b2
                           from regexp_split_to_table(coalesce(s.name, ''), '[^[:alnum:][:space:].&''-]|\s-\s') with ordinality seg(txt, i),
                                regexp_matches(regexp_replace(seg.txt, '''s\M', '', 'g'), '[[:alpha:]]+', 'g') with ordinality w(m, j)
                          group by seg.i) q, unnest(array[q.a1, q.a2, q.b1, q.b2]) iv, unnest(array[iv, substring(iv from '^US([A-Z]{3,})$')]) v
                  where length(v) >= 3 and v <> all (k.generic)) as ini
      from src s, k
  )
  select coalesce(jsonb_agg(jsonb_build_object('name', c.name, 'program', c.program, 'matches', coalesce(m.hits, '[]'::jsonb)) order by c.ord), '[]'::jsonb)
    from t c
    left join lateral (
      select jsonb_agg(jsonb_build_object('id', r.id, 'name', r.name, 'program', r.program, 'url', r.url, 'status', r.status,
               'reason', r.reject_reason, 'exact', r.exact, 'match', r.match, 'why', to_jsonb(r.why)) order by r.rn) as hits
        from (
          select f.id, f.name, f.program, f.url, f.status, f.reject_reason, e.exact, g.match, g.why,
                 -- equal scores: the row sharing more program words first, so the cut at 8 drops the least similar programs
                 row_number() over (order by case g.match when 'exact' then 0 when 'likely' then 1 else 2 end, g.score desc, e.pw_n desc, f.name, f.program, f.id) as rn
            from t f
           cross join k
           cross join lateral (
             select coalesce(f.name_key = c.name_key or f.url_norm = c.url_norm, false) as exact,
                    cardinality(c.words) > 0 and f.words = c.words as same_words,
                    coalesce((length(c.nk) >= 6 and starts_with(f.name_key, c.nk)) or (length(f.nk) >= 6 and starts_with(c.nk, f.nk)), false) as prefix,
                    coalesce(c.dom = f.dom and c.dom <> all (k.portal), false) as site,
                    coalesce(left(c.url_norm, length(f.url_norm) + 1) in (f.url_norm || '/', f.url_norm || '?') and f.url_norm like '%/%', false) as kid,
                    coalesce(left(f.url_norm, length(c.url_norm) + 1) in (c.url_norm || '/', c.url_norm || '?') and c.url_norm like '%/%', false) as dad,
                    -- the same program text; two empty programs count only when the name words are the same
                    c.pk = f.pk and (c.pk <> '' or (cardinality(c.words) > 0 and f.words = c.words)) as same_prog,
                    -- an acronym written in one name against the other name's acronyms or initials
                    array(select a from (select unnest(c.an) intersect select unnest(f.an || f.ini)
                                         union select unnest(c.ini) intersect select unnest(f.an)) u(a) order by 1) as acr,
                    -- failing that, the shortest initials both names spell
                    (select a from (select unnest(c.ini) intersect select unnest(f.ini)) u(a) order by length(a), a limit 1) as ini,
                    -- a token both names carry (as a word, an acronym or initials) names the organisation, not a program
                    array(select a from (select unnest(c.aa) intersect select unnest(f.aa)) u(a)
                           where not ((a = any (c.an || c.ini) or lower(a) = any (c.words)) and (a = any (f.an || f.ini) or lower(a) = any (f.words)))
                           order by 1) as ids,
                    (select count(*) from (select unnest(c.pw) intersect select unnest(f.pw)) u(a)) as pw_n
           ) e
           cross join lateral (
             select e.same_words or e.prefix or cardinality(e.acr) > 0 or e.ini is not null as named
           ) w
           cross join lateral (
             select case when e.exact then 'exact'
                         -- a page under the stored page counts with the site alone, a stored page under this URL only with the name
                         when ((cardinality(e.ids) > 0 or e.same_prog or e.kid) and (w.named or e.site)) or (e.dad and w.named) then 'likely'
                         else 'related' end as match,
                    -- who evidence counts double, so a row that only shares a token sorts after the organisation's own rows
                    ((e.same_words or e.prefix)::int + e.site::int + (cardinality(e.acr) > 0 or e.ini is not null)::int + (e.kid or e.dad)::int) * 2
                      + cardinality(e.ids) + cardinality(e.acr) + e.same_prog::int as score,
                    array_remove(array[
                      case when f.name_key = c.name_key then 'same name and program' end,
                      case when f.url_norm = c.url_norm then 'same URL' end,
                      case when e.same_words then 'same name words' when e.prefix then 'name starts the same' end,
                      case when cardinality(e.acr) > 0 then 'acronym ' || array_to_string(e.acr, ', ') else 'same initials ' || e.ini end,
                      case when e.site then 'same site ' || c.dom end,
                      case when e.kid then 'stored page is a parent of this URL' when e.dad then 'stored page is under this URL' end,
                      case when e.same_prog and c.pk <> '' then 'same program' end,
                      case when cardinality(e.ids) > 0 then 'shares ' || array_to_string(e.ids, ', ') end], null) as why
           ) g
           where f.ord is null
             and (e.exact or w.named or e.site or e.kid or e.dad or cardinality(e.ids) > 0)
        ) r
       where r.rn <= 8
    ) m on true
   where c.ord is not null
$function$
$new$;
begin
  if md5(o) <> '65e4039feb9a7aab46ae84f996649e5e' then
    raise exception 'grants.check_known is not the pre-026 definition (md5 %)', md5(o);
  end if;
  if md5(n) <> 'd7d5a849a2bf43fc646de1656f23b716' then
    raise exception 'new grants.check_known differs from the tested text (md5 %)', md5(n);
  end if;
  execute n;
  if md5(pg_get_functiondef('grants.check_known(jsonb)'::regprocedure)) <> md5(n) then
    raise exception 'stored grants.check_known differs from the tested text (md5 %)',
      md5(pg_get_functiondef('grants.check_known(jsonb)'::regprocedure));
  end if;
end $mig$;

-- Verify (read-only):
-- select md5(pg_get_functiondef('grants.check_known(jsonb)'::regprocedure)) = 'd7d5a849a2bf43fc646de1656f23b716' as live_is_026,
--        has_function_privilege('anon', 'grants.check_known(jsonb)', 'execute') as anon_direct,
--        has_function_privilege('authenticated', 'grants.check_known(jsonb)', 'execute') as auth_direct;
--
-- The three 2026-11-20 cases, each demoted row sent as a candidate (read-only). Seen live 2026-11-20:
-- 4af6c750 -> 0fe468ef, 54f1d698 -> 6df99f2d and 9110afb8, e3a4dea5 -> eb906c5c, all "likely".
-- select left(d.id::text, 8) as demoted, left(h->>'id', 8) as hit, h->>'match' as match, h->'why' as why
--   from grants.funders d
--  cross join lateral jsonb_array_elements(grants.check_known(jsonb_build_array(
--         jsonb_build_object('name', d.name, 'program', d.program, 'url', d.url)))->0->'matches') h
--  where left(d.id::text, 8) in ('e3a4dea5', '4af6c750', '54f1d698') and h->>'match' = 'likely'
--  order by 1, 2;
