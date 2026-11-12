-- Полнота состава при правке отметки задним числом (PTS-03). Условия: docs/ROSTER_ON_DATE_ACCEPTANCE.md.
-- Раньше mark_attendance требовал отметить всех игроков со статусом «active» на сегодня, а экран показывает
-- игроков, занимавшихся в дату занятия. Игрок, вернувшийся позже, блокировал правку прошлого занятия.
-- Теперь состав считается на дату занятия по тому же правилу, что wasActiveOn в web/src/lib/playerStatus.ts.
begin;

-- активен ли игрок на дату d: последняя запись журнала с on_date <= d; если таких нет, первая запись не «active»
-- (до неё игрок был активен); если журнала нет, текущий статус
create or replace function points_player_on_roster(pid uuid, d date) returns boolean
language plpgsql stable security definer set search_path = public as $$
declare st text; cur text;
begin
  select l.status into st from player_status_log l
   where l.player_id = pid and l.on_date <= d
   order by l.on_date desc, l.created_at desc limit 1;
  if found then return st = 'active'; end if;
  select l.status into st from player_status_log l
   where l.player_id = pid
   order by l.on_date, l.created_at limit 1;
  if found then return st <> 'active'; end if;
  select p.status into cur from players p where p.id = pid;
  return coalesce(cur, 'active') = 'active';
end $$;
revoke execute on function points_player_on_roster(uuid, date) from public, anon, authenticated;

-- mark_attendance из 0121, проверка полного состава — на дату занятия
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

  -- с даты вступления правил баллов должны быть отмечены все игроки группы, которые были активны в дату занятия
  -- (как на экране «Занятия»); игроки, вступившие или вернувшиеся позже, не требуются; при ошибке сохранение откатывается
  if (points_rules_for(club, day)).id is not null and exists (
       select 1 from players p where p.group_id = sess.group_id and points_player_on_roster(p.id, day)
          and not exists (select 1 from attendance a where a.session_id = s and a.player_id = p.id)) then
    raise exception 'roster incomplete' using errcode = '22023';
  end if;
end $$;

commit;
