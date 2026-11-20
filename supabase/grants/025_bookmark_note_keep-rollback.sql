-- 025_bookmark_note_keep-rollback.sql
-- Puts grants.human_mark(jsonb) back to the exact 024 definition
-- (md5 of pg_get_functiondef = 33d633a0e2a7d2a3c2400ce79ffa86c8, 5918 characters, read 2026-11-20).
-- It removes the two lines 025 added and refuses to run unless the result has that md5.
-- Function rewrite only: no data changes, safe through the SQL connector.
--
-- Do not run while a dashboard.html from the 025 commit or later is live: that page sends "note"
-- only when the note is edited, and the 024 definition stores null for an omitted note, so every
-- bookmark switch would erase the item's note.

do $unpatch$
declare
  v_now text := pg_get_functiondef('grants.human_mark(jsonb)'::regprocedure);
  v_old text;
  a_set constant text := $s$      if not (p_patch ? 'note') then v_note := v_prev_note; end if; -- no note key: keep the stored note$s$;
  a_lock constant text := $s$    perform pg_advisory_xact_lock(hashtext('grants.marks')); -- one definition change at a time: the cap and label checks cannot race$s$;
begin
  if md5(v_now) <> '0cd12001c798b0cc4f189ec49bdf79cc' then
    raise exception 'grants.human_mark is not the 025 definition (md5 %)', md5(v_now);
  end if;
  v_old := replace(replace(v_now, chr(10) || a_set, ''), chr(10) || a_lock, '');
  if md5(v_old) <> '33d633a0e2a7d2a3c2400ce79ffa86c8' then
    raise exception 'rollback text is not the 024 definition (md5 %)', md5(v_old);
  end if;
  execute v_old;
end $unpatch$;
