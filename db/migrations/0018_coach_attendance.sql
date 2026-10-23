-- Роли тренеров, шаг 1 (docs/COACH_ROLE_PLAN.md): отметка посещаемости по расписанию группы и автоначисление баллов.
-- Тренер пишет только через функции ниже: прямая запись тренера в sessions/attendance закрывается, иначе через API
-- можно было бы отметить посещаемость без баллов или создать лишние занятия. Администратор по-прежнему пишет напрямую.

-- Календарный день по Тбилиси (как в импорте: scripts/import/rating.mjs)
create or replace function tbilisi_day(ts timestamptz) returns date
language sql immutable as $$ select (ts at time zone 'Asia/Tbilisi')::date $$;

drop policy attendance_coach_write on attendance;
create policy attendance_admin_write on attendance for all using (is_admin()) with check (is_admin());
drop policy sessions_coach_write on sessions;
create policy sessions_admin_write on sessions for all using (is_admin()) with check (is_admin());

-- Занятие группы за день по расписанию. Ключ ATT|<дата> тот же, что у импорта, поэтому дубликатов с историей нет.
create or replace function open_session(g uuid, d date) returns uuid
language plpgsql security definer set search_path = public as $$
declare slot time; sid uuid;
begin
  if current_user_id() is null then raise exception 'not authenticated' using errcode = '42501'; end if;
  if not (is_admin() or is_coach_of_group(g)) then raise exception 'forbidden' using errcode = '42501'; end if;
  if d > tbilisi_day(now()) then raise exception 'date in the future'; end if;
  select starts_at into slot from weekly_schedule
   where group_id = g and weekday = extract(isodow from d)::int and kind = 'Групповая'
   order by starts_at limit 1;
  if slot is null then raise exception 'no training scheduled'; end if;
  insert into sessions (group_id, starts_at, kind, source_key)
    values (g, (d + slot) at time zone 'Asia/Tbilisi', 'training', 'ATT|' || d)
    on conflict (group_id, source_key) do nothing;
  select id into sid from sessions where group_id = g and source_key = 'ATT|' || d;
  return sid;
end $$;

-- Отметки: [{"player_id": "...", "status": "present" | "absent" | "excused"}, ...]. Можно править задним числом.
-- Баллы по правилу attendance_present пересчитываются только для отмеченных игроков: «был» даёт начисление,
-- смена на «не был» убирает его (журнал меняет только эта функция и только автоначисления этого занятия).
create or replace function mark_attendance(s uuid, marks jsonb) returns void
language plpgsql security definer set search_path = public as $$
declare sess sessions; m jsonb; pid uuid; st text; rl rules; day date; club uuid;
begin
  if current_user_id() is null then raise exception 'not authenticated' using errcode = '42501'; end if;
  select * into sess from sessions where id = s;
  if sess.id is null then raise exception 'session not found'; end if;
  if not (is_admin() or is_coach_of_group(sess.group_id)) then raise exception 'forbidden' using errcode = '42501'; end if;
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
end $$;

revoke execute on function tbilisi_day(timestamptz), open_session(uuid, date), mark_attendance(uuid, jsonb) from public;
grant execute on function tbilisi_day(timestamptz), open_session(uuid, date), mark_attendance(uuid, jsonb) to authenticated;
