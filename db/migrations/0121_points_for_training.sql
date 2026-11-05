-- 0121: баллы за тренировки в новом журнале (#18, этап 5).
--  * Групповые занятия: +1 за «Был» на обычном занятии, +1 на перенесённом, +2 на внеплановом (значения из версии правил на дату занятия).
--  * Индивидуальные и вратарские: +2 за attended = true. Дополнительные: +2 за attended = true. Запись и оплата баллов не дают.
--  * Начисление пересчитывается триггерами на attendance, individual_bookings, extra_bookings (и на смену типа или даты занятия),
--    поэтому исправление отметки, а также правка из SQL Editor сразу согласуют журнал. Повтор ничего не меняет (points_ledger_apply).
--  * До вступления в силу первой версии правил (стартовая версия 0117 действует с 2026-12-01) начислений нет: пересчёт возвращает пустой набор.
--  * mark_attendance: с даты вступления правил занятие сохраняется только если отмечены все игроки группы со статусом «Занимается»
--    (решение владельца 2026-11-05). До этой даты поведение прежнее. Старые баллы point_events и points_start не затронуты.
-- Применять в SQL Editor целиком, сначала db/ops/preflight.sql.
begin;

-- Групповое занятие
create or replace function points_reconcile_group_session(sid uuid) returns void
language plpgsql security definer set search_path = public as $$
declare s sessions; club uuid; day date; rv points_rule_versions; pts int; exp jsonb := '[]'::jsonb;
begin
  select * into s from sessions where id = sid;
  if s.id is null then
    select l.club_id into club from points_ledger l where l.source_type = 'group_session' and l.source_id = sid limit 1;
    if club is not null then perform points_ledger_apply(club, 'group_session', sid, '[]'::jsonb, 'source_deleted'); end if;
    return;
  end if;
  select g.club_id into club from groups g where g.id = s.group_id;
  day := tbilisi_day(s.starts_at);
  rv := points_rules_for(club, day);
  if rv.id is not null and coalesce((rv.params #>> '{enabled,training}')::boolean, false) then
    pts := case s.class when 'regular' then (rv.params #>> '{training,group}')::int
                        when 'moved' then (rv.params #>> '{training,moved_group}')::int
                        else (rv.params #>> '{training,extra}')::int end;
    if pts > 0 then
      select coalesce(jsonb_agg(jsonb_build_object('player_id', a.player_id, 'group_id', s.group_id, 'event_date', day, 'reason_code', 'attended',
               'points', pts, 'components', jsonb_build_object('class', s.class, 'base', pts), 'rule_version_id', rv.id)), '[]'::jsonb)
        into exp from attendance a where a.session_id = sid and a.status = 'present';
    end if;
  end if;
  perform points_ledger_apply(club, 'group_session', sid, exp, 'attendance_changed');
end $$;

-- Индивидуальное или вратарское занятие: тип источника определяет флаг goalkeepers; прежний тип закрывается, если флаг сменили
create or replace function points_reconcile_individual(sid uuid) returns void
language plpgsql security definer set search_path = public as $$
declare s individual_sessions; club uuid; day date; rv points_rule_versions; pts int; exp jsonb := '[]'::jsonb; st text; other text;
begin
  select * into s from individual_sessions where id = sid;
  if s.id is null then
    select l.club_id into club from points_ledger l where l.source_type in ('individual', 'goalkeeper') and l.source_id = sid limit 1;
    if club is not null then
      perform points_ledger_apply(club, 'individual', sid, '[]'::jsonb, 'source_deleted');
      perform points_ledger_apply(club, 'goalkeeper', sid, '[]'::jsonb, 'source_deleted');
    end if;
    return;
  end if;
  club := s.club_id;
  day := s.starts_at::date;
  st := case when s.goalkeepers then 'goalkeeper' else 'individual' end;
  other := case when s.goalkeepers then 'individual' else 'goalkeeper' end;
  rv := points_rules_for(club, day);
  if rv.id is not null and coalesce((rv.params #>> '{enabled,training}')::boolean, false) then
    pts := (rv.params #>> array['training', st])::int;
    if pts > 0 then
      select coalesce(jsonb_agg(jsonb_build_object('player_id', b.player_id, 'group_id', points_group_at(b.player_id, day), 'event_date', day,
               'reason_code', 'attended', 'points', pts, 'components', jsonb_build_object('kind', st, 'base', pts), 'rule_version_id', rv.id)), '[]'::jsonb)
        into exp from individual_bookings b where b.session_id = sid and b.attended is true;
    end if;
  end if;
  perform points_ledger_apply(club, st, sid, exp, 'attendance_changed');
  perform points_ledger_apply(club, other, sid, '[]'::jsonb, 'type_changed');
end $$;

-- Дополнительная тренировка
create or replace function points_reconcile_extra(sid uuid) returns void
language plpgsql security definer set search_path = public as $$
declare s extra_sessions; club uuid; day date; rv points_rule_versions; pts int; exp jsonb := '[]'::jsonb;
begin
  select * into s from extra_sessions where id = sid;
  if s.id is null then
    select l.club_id into club from points_ledger l where l.source_type = 'extra' and l.source_id = sid limit 1;
    if club is not null then perform points_ledger_apply(club, 'extra', sid, '[]'::jsonb, 'source_deleted'); end if;
    return;
  end if;
  club := s.club_id;
  day := s.starts_on;
  rv := points_rules_for(club, day);
  if rv.id is not null and coalesce((rv.params #>> '{enabled,training}')::boolean, false) then
    pts := (rv.params #>> '{training,extra}')::int;
    if pts > 0 then
      select coalesce(jsonb_agg(jsonb_build_object('player_id', b.player_id, 'group_id', points_group_at(b.player_id, day), 'event_date', day,
               'reason_code', 'attended', 'points', pts, 'components', jsonb_build_object('kind', 'extra', 'base', pts), 'rule_version_id', rv.id)), '[]'::jsonb)
        into exp from extra_bookings b where b.session_id = sid and b.attended is true;
    end if;
  end if;
  perform points_ledger_apply(club, 'extra', sid, exp, 'attendance_changed');
end $$;

revoke execute on function points_reconcile_group_session(uuid), points_reconcile_individual(uuid), points_reconcile_extra(uuid) from public, anon, authenticated;

-- Триггеры
create or replace function points_trg_group_session() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  perform points_reconcile_group_session(case when tg_op = 'DELETE' then old.session_id else new.session_id end);
  return null;
end $$;
create or replace function points_trg_group_session_row() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  perform points_reconcile_group_session(new.id);
  return null;
end $$;
create or replace function points_trg_individual() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  perform points_reconcile_individual(case when tg_op = 'DELETE' then old.session_id else new.session_id end);
  return null;
end $$;
create or replace function points_trg_individual_row() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  perform points_reconcile_individual(new.id);
  return null;
end $$;
create or replace function points_trg_extra() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  perform points_reconcile_extra(case when tg_op = 'DELETE' then old.session_id else new.session_id end);
  return null;
end $$;
create or replace function points_trg_extra_row() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  perform points_reconcile_extra(new.id);
  return null;
end $$;
revoke execute on function points_trg_group_session(), points_trg_group_session_row(), points_trg_individual(), points_trg_individual_row(),
  points_trg_extra(), points_trg_extra_row() from public, anon, authenticated;

create trigger points_attendance_sync after insert or update of status, session_id or delete on attendance
  for each row execute function points_trg_group_session();
create trigger points_session_class_sync after update of class, starts_at, group_id on sessions
  for each row execute function points_trg_group_session_row();
create trigger points_individual_bookings_sync after insert or update of attended, session_id or delete on individual_bookings
  for each row execute function points_trg_individual();
create trigger points_individual_sessions_sync after update of starts_at, goalkeepers on individual_sessions
  for each row execute function points_trg_individual_row();
create trigger points_extra_bookings_sync after insert or update of attended, session_id or delete on extra_bookings
  for each row execute function points_trg_extra();
create trigger points_extra_sessions_sync after update of starts_on on extra_sessions
  for each row execute function points_trg_extra_row();

-- mark_attendance из 0042 + проверка полного списка с даты вступления правил в силу
create or replace function mark_attendance(s uuid, marks jsonb) returns void
language plpgsql security definer set search_path = public as $$
declare sess sessions; m jsonb; pid uuid; st text; rl rules; day date; club uuid;
begin
  if current_user_id() is null then raise exception 'not authenticated' using errcode = '42501'; end if;
  select * into sess from sessions where id = s;
  if sess.id is null then raise exception 'session not found'; end if;
  if not (is_admin() or is_any_coach()) then raise exception 'forbidden' using errcode = '42501'; end if;
  if jsonb_typeof(marks) <> 'array' then raise exception 'marks must be an array'; end if;
  day := tbilisi_day(sess.starts_at);
  select club_id into club from groups where id = sess.group_id;
  select * into rl from rules
   where club_id = club and code = 'attendance_present' and active_from <= day and (active_to is null or active_to >= day)
   order by version desc limit 1;
  if rl.id is null then raise exception 'rule attendance_present not found'; end if;

  for m in select * from jsonb_array_elements(marks) loop
    pid := (m->>'player_id')::uuid;
    st := m->>'status';
    if st not in ('present', 'absent', 'excused') then raise exception 'invalid status'; end if;
    if not exists (select 1 from players where id = pid and group_id = sess.group_id) then raise exception 'player not in group'; end if;
    insert into attendance (session_id, player_id, status, marked_by, marked_at)
      values (s, pid, st, current_user_id(), now())
      on conflict (session_id, player_id) do update set status = excluded.status, marked_by = excluded.marked_by, marked_at = excluded.marked_at;
    if st = 'present' then
      if rl.points <> 0 then
        insert into point_events (player_id, rule_id, points, source_type, source_id, occurred_on, explanation)
          values (pid, rl.id, rl.points, 'session', s, day, rl.explanation)
          on conflict (player_id, rule_id, source_type, source_id) do nothing;
      end if;
    else
      delete from point_events where player_id = pid and rule_id = rl.id and source_type = 'session' and source_id = s;
    end if;
  end loop;

  -- с даты вступления правил баллов должны быть отмечены все игроки группы со статусом «Занимается»; при ошибке сохранение откатывается
  if (points_rules_for(club, day)).id is not null and exists (
       select 1 from players p where p.group_id = sess.group_id and p.status = 'active'
          and not exists (select 1 from attendance a where a.session_id = s and a.player_id = p.id)) then
    raise exception 'roster incomplete' using errcode = '22023';
  end if;
end $$;

commit;
