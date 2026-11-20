-- 024_bookmarks.sql
-- Team bookmarks on funders, calls and leads, with labels the team defines.
-- One bookmark per item. A definition has a label, one of 8 hue slots and an effect:
--   none   = a plain label
--   follow = the discovery agent re-checks the item every run (brief key marks.follow)
--   hide   = hidden from the default lists and the agent stops proposing it (marks.ignore)
-- Browser RPCs: public.grants_marks (read, passcode optional), public.grants_mark (write, passcode).
-- Rollback: 024_bookmarks-rollback.sql
-- Applied 2026-11-20 as migration version 20261120170311 (grants_024_bookmarks).

do $guard$
begin
  if md5(pg_get_functiondef('grants.discovery_brief()'::regprocedure)) <> '730db8d4439ec1642f49b2be8613e0b9' then
    raise exception '024: grants.discovery_brief() is not the definition this patch was written against';
  end if;
  if to_regclass('grants.marks') is not null or to_regclass('grants.item_marks') is not null then
    raise exception '024: bookmark tables already exist';
  end if;
end $guard$;

create table grants.marks (
  id         text primary key,
  label      text not null,
  hue        smallint not null default 0,
  effect     text not null default 'none',
  sort       integer not null default 100,
  retired_at timestamptz,
  updated_at timestamptz not null default now(),
  updated_by text,
  constraint marks_id_fmt check (id ~ '^[a-z0-9][a-z0-9-]{0,39}$'),
  constraint marks_label_len check (char_length(label) between 1 and 32),
  constraint marks_hue_range check (hue between 0 and 7),
  constraint marks_effect_known check (effect in ('none', 'follow', 'hide'))
);
alter table grants.marks enable row level security;
revoke all on grants.marks from public, anon, authenticated, service_role;

-- A cleared bookmark keeps its row with mark_id null, so nothing here deletes.
create table grants.item_marks (
  kind    text not null,
  item_id uuid not null,
  mark_id text references grants.marks(id),
  note    text,
  actor   text not null,
  at      timestamptz not null default now(),
  primary key (kind, item_id),
  constraint item_marks_kind_known check (kind in ('funder', 'call', 'lead')),
  constraint item_marks_note_len check (note is null or char_length(note) between 1 and 280),
  constraint item_marks_actor_len check (char_length(actor) between 1 and 60)
);
create index item_marks_mark_idx on grants.item_marks (mark_id) where mark_id is not null;
alter table grants.item_marks enable row level security;
revoke all on grants.item_marks from public, anon, authenticated, service_role;

insert into grants.marks (id, label, hue, effect, sort, updated_by) values
  ('keep-an-eye', 'Keep an eye on', 7, 'follow', 10, 'system'),
  ('shortlist', 'Shortlist', 2, 'none', 20, 'system'),
  ('not-relevant', 'Not relevant', 4, 'hide', 30, 'system');

-- What the dashboard reads. Notes and who set a bookmark are team-only.
create or replace function grants.marks_payload(p_team boolean) returns jsonb
language sql stable set search_path to '' as $body$
  select jsonb_build_object(
    'team', coalesce(p_team, false),
    'defs', coalesce((
      select jsonb_agg(jsonb_build_object('id', d.id, 'label', d.label, 'hue', d.hue, 'effect', d.effect,
                                          'sort', d.sort, 'retired', d.retired_at is not null)
                       order by d.sort, d.label, d.id)
        from grants.marks d
       where coalesce(p_team, false) or d.retired_at is null), '[]'::jsonb),
    'items', coalesce((
      select jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
               'kind', m.kind, 'id', m.item_id, 'mark', m.mark_id, 'at', m.at,
               'name', case m.kind when 'call' then o.title when 'lead' then t.org else f.name end,
               'funder', case when m.kind <> 'funder' then f.id end,
               'note', case when coalesce(p_team, false) then m.note end,
               'by', case when coalesce(p_team, false) then m.actor end)) order by m.at desc, m.item_id)
        from grants.item_marks m
        join grants.marks d on d.id = m.mark_id and d.retired_at is null
        left join grants.opportunities o on m.kind = 'call' and o.id = m.item_id
        left join grants.targets t on m.kind = 'lead' and t.id = m.item_id
        left join grants.funders f
          on f.id = case m.kind when 'funder' then m.item_id when 'call' then o.funder_id else t.funder_id end
      ), '[]'::jsonb));
$body$;

-- What the discovery agent reads (key "marks" of grants.discovery_brief()).
create or replace function grants.marks_brief() returns jsonb
language sql stable set search_path to '' as $body$
  with x as (
    select d.effect, m.at,
           jsonb_strip_nulls(jsonb_build_object(
             'kind', m.kind, 'funder_id', f.id, 'org', coalesce(f.name, t.org),
             'program', case m.kind when 'call' then o.title when 'lead' then t.program_hint else f.program end,
             'url', case m.kind when 'call' then coalesce(o.url, f.url) when 'lead' then coalesce(t.url_hint, f.url) else f.url end,
             'status', f.status, 'label', d.label, 'note', m.note, 'by', m.actor, 'on', m.at::date)) as j,
           row_number() over (partition by d.effect order by m.at desc) as rn
      from grants.item_marks m
      join grants.marks d on d.id = m.mark_id and d.retired_at is null and d.effect in ('follow', 'hide')
      left join grants.opportunities o on m.kind = 'call' and o.id = m.item_id
      left join grants.targets t on m.kind = 'lead' and t.id = m.item_id
      left join grants.funders f
        on f.id = case m.kind when 'funder' then m.item_id when 'call' then o.funder_id else t.funder_id end)
  select jsonb_build_object(
    'ignore', coalesce((select jsonb_agg(x.j order by x.at desc) from x where x.effect = 'hide' and x.rn <= 60), '[]'::jsonb),
    'follow', coalesce((select jsonb_agg(x.j order by x.at desc) from x where x.effect = 'follow' and x.rn <= 40), '[]'::jsonb));
$body$;

-- The one writer. Actions: set, clear, define, retire, restore. Returns the team payload.
create or replace function grants.human_mark(p_patch jsonb) returns jsonb
language plpgsql set search_path to '' as $body$
declare
  v_action text := coalesce(p_patch->>'action', '');
  v_actor  text := left(btrim(coalesce(p_patch->>'actor', '')), 60);
  v_kind   text := coalesce(p_patch->>'kind', '');
  v_mark   text := nullif(btrim(coalesce(p_patch->>'mark', '')), '');
  v_note   text := nullif(left(btrim(coalesce(p_patch->>'note', '')), 280), '');
  v_label  text := left(btrim(regexp_replace(coalesce(p_patch->>'label', ''), '\s+', ' ', 'g')), 32);
  v_effect text := coalesce(nullif(p_patch->>'effect', ''), 'none');
  v_hue    integer;
  v_item   uuid;
  v_funder uuid;
  v_name   text;
  v_prev   text;
  v_prev_note text;
  v_base   text;
  v_n      integer := 1;
  d        grants.marks%rowtype;
begin
  if v_actor = '' then raise exception 'actor is required' using errcode = '22023'; end if;

  if v_action in ('set', 'clear') then
    if v_kind not in ('funder', 'call', 'lead') then raise exception 'unknown kind' using errcode = '22023'; end if;
    if coalesce(p_patch->>'id', '') !~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$' then
      raise exception 'unknown item' using errcode = '22023';
    end if;
    v_item := (p_patch->>'id')::uuid;
    if v_kind = 'funder' then
      select f.id, f.name into v_funder, v_name from grants.funders f where f.id = v_item;
    elsif v_kind = 'call' then
      select o.funder_id, o.title into v_funder, v_name from grants.opportunities o where o.id = v_item;
    else
      select t.funder_id, t.org into v_funder, v_name from grants.targets t where t.id = v_item;
    end if;
    if not found then raise exception 'unknown item' using errcode = '22023'; end if;
    select m.mark_id, m.note into v_prev, v_prev_note
      from grants.item_marks m where m.kind = v_kind and m.item_id = v_item for update;

    if v_action = 'set' then
      select * into d from grants.marks x where x.id = v_mark and x.retired_at is null;
      if not found then raise exception 'unknown bookmark' using errcode = '22023'; end if;
      if v_prev is distinct from d.id or v_prev_note is distinct from v_note then
        insert into grants.item_marks (kind, item_id, mark_id, note, actor)
        values (v_kind, v_item, d.id, v_note, v_actor)
        on conflict (kind, item_id) do update
          set mark_id = excluded.mark_id, note = excluded.note, actor = excluded.actor, at = now();
        insert into grants.team_events (funder_id, actor, kind, payload)
        values (v_funder, v_actor, 'mark_set', jsonb_strip_nulls(jsonb_build_object(
          'item_kind', v_kind, 'item_id', v_item, 'name', v_name, 'mark', d.id, 'label', d.label,
          'from', v_prev, 'note', v_note)));
      end if;
    elsif v_prev is not null then
      update grants.item_marks set mark_id = null, note = null, actor = v_actor, at = now()
       where kind = v_kind and item_id = v_item;
      insert into grants.team_events (funder_id, actor, kind, payload)
      values (v_funder, v_actor, 'mark_clear', jsonb_strip_nulls(jsonb_build_object(
        'item_kind', v_kind, 'item_id', v_item, 'name', v_name, 'from', v_prev)));
    end if;

  elsif v_action = 'define' then
    if v_label = '' then raise exception 'label is required' using errcode = '22023'; end if;
    if v_effect not in ('none', 'follow', 'hide') then raise exception 'unknown effect' using errcode = '22023'; end if;
    if coalesce(p_patch->>'hue', '0') !~ '^[0-7]$' then raise exception 'unknown hue' using errcode = '22023'; end if;
    v_hue := coalesce(p_patch->>'hue', '0')::integer;
    if exists (select 1 from grants.marks x
                where lower(x.label) = lower(v_label) and x.retired_at is null and x.id is distinct from v_mark) then
      raise exception 'a bookmark with that name already exists' using errcode = '22023';
    end if;
    if v_mark is null then
      if (select count(*) from grants.marks x where x.retired_at is null) >= 12 then
        raise exception 'at most 12 bookmarks' using errcode = '22023';
      end if;
      v_base := left(btrim(regexp_replace(lower(v_label), '[^a-z0-9]+', '-', 'g'), '-'), 32);
      if v_base = '' then v_base := 'bookmark'; end if;
      v_mark := v_base;
      while exists (select 1 from grants.marks x where x.id = v_mark) loop
        v_n := v_n + 1;
        v_mark := v_base || '-' || v_n;
      end loop;
      insert into grants.marks (id, label, hue, effect, sort, updated_by)
      values (v_mark, v_label, v_hue, v_effect, (select coalesce(max(x.sort), 0) + 10 from grants.marks x), v_actor);
    else
      update grants.marks set label = v_label, hue = v_hue, effect = v_effect, updated_at = now(), updated_by = v_actor
       where id = v_mark;
      if not found then raise exception 'unknown bookmark' using errcode = '22023'; end if;
    end if;

  elsif v_action in ('retire', 'restore') then
    select * into d from grants.marks x where x.id = v_mark for update;
    if not found then raise exception 'unknown bookmark' using errcode = '22023'; end if;
    if v_action = 'restore' and d.retired_at is not null then
      if (select count(*) from grants.marks x where x.retired_at is null) >= 12 then
        raise exception 'at most 12 bookmarks' using errcode = '22023';
      end if;
      if exists (select 1 from grants.marks x
                  where lower(x.label) = lower(d.label) and x.retired_at is null and x.id <> d.id) then
        raise exception 'a bookmark with that name already exists' using errcode = '22023';
      end if;
    end if;
    update grants.marks
       set retired_at = case when v_action = 'retire' then coalesce(retired_at, now()) end,
           updated_at = now(), updated_by = v_actor
     where id = d.id;

  else
    raise exception 'unknown action' using errcode = '22023';
  end if;

  return grants.marks_payload(true);
end $body$;

create or replace function public.grants_marks(p_pass text default null) returns jsonb
language plpgsql volatile security definer set search_path to '' as $body$
declare v_team boolean := false;
begin
  if p_pass is not null then v_team := grants.check_pass(p_pass); end if;
  return grants.marks_payload(v_team);
end $body$;

create or replace function public.grants_mark(p_pass text, p_patch jsonb) returns jsonb
language plpgsql security definer set search_path to '' as $body$
begin
  if not grants.check_pass(p_pass) then return grants.pass_denied(); end if;
  return grants.human_mark(coalesce(p_patch, '{}'::jsonb));
end $body$;

revoke all on function public.grants_marks(text) from public;
grant execute on function public.grants_marks(text) to anon, authenticated, service_role;
revoke all on function public.grants_mark(text, jsonb) from public;
grant execute on function public.grants_mark(text, jsonb) to anon, authenticated, service_role;
revoke all on function grants.human_mark(jsonb) from public, anon, authenticated;
revoke all on function grants.marks_payload(boolean) from public, anon, authenticated;
revoke all on function grants.marks_brief() from public, anon, authenticated;

-- One new key in the agent's brief. Patched in place so the rest of the live definition is untouched.
do $patch$
declare
  v_old  text := pg_get_functiondef('grants.discovery_brief()'::regprocedure);
  v_from text := $a$x.rn <= 8), '[]'::jsonb))$a$;
  v_to   text := $a$x.rn <= 8), '[]'::jsonb), 'marks', grants.marks_brief())$a$;
  v_new  text;
begin
  if (length(v_old) - length(replace(v_old, v_from, ''))) / length(v_from) <> 1 then
    raise exception '024: anchor not found exactly once in grants.discovery_brief()';
  end if;
  v_new := replace(v_old, v_from, v_to);
  if md5(v_new) <> '41bad1377046702c5a69429c12ce5982' then
    raise exception '024: patched grants.discovery_brief() md5 mismatch: %', md5(v_new);
  end if;
  execute v_new;
end $patch$;

notify pgrst, 'reload schema';
