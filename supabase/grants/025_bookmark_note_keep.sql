-- 025_bookmark_note_keep.sql
-- grants.human_mark keeps the stored note when a 'set' patch has no "note" key.
--
-- Before: an omitted note stored null, so a browser tab whose bookmark index had no notes (one that
-- loaded before a teammate wrote the note, or one still on the public index right after unlock)
-- wiped that note by switching the bookmark. Now only an explicit "note" changes it ('' clears it);
-- 'clear' still drops the note together with the bookmark.
--
-- Also: define, retire and restore take one transaction-level advisory lock, so two concurrent
-- changes cannot both pass the 12-bookmark cap or the unique-label check.
--
-- Written as a patch on the live 024 definition under md5 guards (skill grants-sql-function-patch):
-- it refuses to run on any other definition and refuses to store any other result.
-- Tested 2026-11-20 in a rolled-back DO block on one real funder: old definition drops the note on
-- a switch; new one keeps it, clears it on '', writes no event on a repeated pick, does not bring a
-- cleared note back, and keeps the note of an item whose bookmark was retired.
-- Live since 2026-11-20 as migration 20261120182046 (live md5 checked; rollback dry-run gave the 024 md5).
-- Rollback: 025_bookmark_note_keep-rollback.sql. dashboard.html relies on this from the same
-- commit on (it sends "note" only when the note is edited): do not roll back while that is live.

do $mig$
declare
  o text := pg_get_functiondef('grants.human_mark(jsonb)'::regprocedure);
  n text;
  t_set constant text := $s$if v_action = 'set' then$s$;
  t_def constant text := $s$elsif v_action = 'define' then$s$;
  t_ret constant text := $s$elsif v_action in ('retire', 'restore') then$s$;
  a_set constant text := $s$      if not (p_patch ? 'note') then v_note := v_prev_note; end if; -- no note key: keep the stored note$s$;
  a_lock constant text := $s$    perform pg_advisory_xact_lock(hashtext('grants.marks')); -- one definition change at a time: the cap and label checks cannot race$s$;
begin
  if md5(o) <> '33d633a0e2a7d2a3c2400ce79ffa86c8' then
    raise exception 'grants.human_mark is not the 024 definition (md5 %)', md5(o);
  end if;
  if (length(o) - length(replace(o, t_set, ''))) / length(t_set) <> 1
     or (length(o) - length(replace(o, t_def, ''))) / length(t_def) <> 1
     or (length(o) - length(replace(o, t_ret, ''))) / length(t_ret) <> 1 then
    raise exception 'grants.human_mark: a patch target is missing or repeated';
  end if;
  n := replace(o, t_set, t_set || chr(10) || a_set);
  n := replace(n, t_def, t_def || chr(10) || a_lock);
  n := replace(n, t_ret, t_ret || chr(10) || a_lock);
  if md5(n) <> '0cd12001c798b0cc4f189ec49bdf79cc' then
    raise exception 'patched grants.human_mark differs from the tested text (md5 %)', md5(n);
  end if;
  execute n;
end $mig$;

-- Verify (read-only):
-- select md5(pg_get_functiondef('grants.human_mark(jsonb)'::regprocedure)) = '0cd12001c798b0cc4f189ec49bdf79cc' as live_is_025,
--        has_function_privilege('anon', 'grants.human_mark(jsonb)', 'execute') as anon_direct,
--        has_function_privilege('authenticated', 'grants.human_mark(jsonb)', 'execute') as auth_direct;
