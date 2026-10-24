-- Тренеры видят и ведут все группы (решение владельца 2026-10-24, как в старом приложении):
-- посещаемость любой группы (отметка), матчи всех команд с составами, участием и голами, расписание и статистика по всем группам.
-- Остаётся закрытым: взносы и платежи (только администратор), баллы чужих групп (начислять можно только своим),
-- контакты родителей (group_parents), отзыв согласий и прочее. Родителей и детей изменение не касается.
-- Добавляется просмотр журнала тренировок (кто из тренеров проводил занятия) без часов и денег: функция trainer_attendance.

create or replace function is_any_coach() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from coach_groups c where c.user_id = current_user_id())
$$;
revoke execute on function is_any_coach() from public, anon;
grant execute on function is_any_coach() to authenticated;

-- Чтение: игроки (имя, дата рождения, группа), группы, занятия, посещаемость, матчи, составы, расписание
drop policy if exists players_read on players;
create policy players_read on players for select
  using (is_admin() or is_any_coach() or is_coach_of_group(group_id) or is_guardian_of(id) or is_self_player(id));
drop policy if exists groups_read on groups;
create policy groups_read on groups for select
  using (is_admin() or is_any_coach() or is_coach_of_group(id) or is_guardian_in_group(id));
drop policy if exists sessions_read on sessions;
create policy sessions_read on sessions for select
  using (is_admin() or is_any_coach() or is_coach_of_group(group_id));
drop policy if exists attendance_read on attendance;
create policy attendance_read on attendance for select
  using (is_admin() or is_any_coach() or is_coach_of_player(player_id) or is_guardian_of(player_id));
drop policy if exists matches_read on matches;
create policy matches_read on matches for select using (
  is_admin()
  or is_any_coach()
  or can_see_team(club_id, team)
  or exists (select 1 from match_players mp where mp.match_id = matches.id and (is_guardian_of(mp.player_id) or is_coach_of_player(mp.player_id)))
);
drop policy if exists match_players_read on match_players;
create policy match_players_read on match_players for select
  using (is_admin() or is_any_coach() or is_guardian_of(player_id) or is_coach_of_player(player_id) or is_self_player(player_id));
drop policy if exists weekly_schedule_read on weekly_schedule;
create policy weekly_schedule_read on weekly_schedule for select using (
  is_admin() or is_any_coach() or is_coach_of_group(group_id) or is_guardian_in_group(group_id)
);

-- Запись: отметка посещаемости и матчи любой группы (только через функции, как и раньше)
create or replace function open_session(g uuid, d date) returns uuid
language plpgsql security definer set search_path = public as $$
declare slot time; sid uuid;
begin
  if current_user_id() is null then raise exception 'not authenticated' using errcode = '42501'; end if;
  if not (is_admin() or is_any_coach()) then raise exception 'forbidden' using errcode = '42501'; end if;
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
end $$;
create or replace function save_match(m uuid, g uuid, d date, opp text, gf int, ga int, roster jsonb) returns uuid
language plpgsql security definer set search_path = public as $$
declare grp groups; mt matches; el jsonb; pid uuid; v_played boolean; v_goals int; v_best boolean; bests int := 0;
        club uuid; adm boolean := is_admin();
begin
  if current_user_id() is null then raise exception 'not authenticated' using errcode = '42501'; end if;
  if g is not null then
    select * into grp from groups where id = g;
    if grp.id is null then raise exception 'group not found'; end if;
    club := grp.club_id;
  end if;
  if m is not null then
    select * into mt from matches where id = m;
    if mt.id is null then raise exception 'match not found'; end if;
    club := mt.club_id;
  elsif g is null then
    raise exception 'group required';
  end if;
  if not adm and not (g is not null and is_any_coach()) then raise exception 'forbidden' using errcode = '42501'; end if;
  if (gf is null) <> (ga is null) then raise exception 'score incomplete'; end if;
  if gf < 0 or ga < 0 then raise exception 'invalid score'; end if;
  if gf is not null and d > tbilisi_day(now()) then raise exception 'result for future match'; end if;
  if jsonb_typeof(roster) <> 'array' then raise exception 'roster must be an array'; end if;

  if m is null then
    insert into matches (club_id, played_on, team, opponent, goals_for, goals_against)
      values (club, d, grp.name, nullif(trim(opp), ''), gf, ga) returning * into mt;
  else
    if not adm and (mt.club_id <> grp.club_id or mt.team <> grp.name) then raise exception 'match is not of this group' using errcode = '42501'; end if;
    update matches set played_on = d, opponent = nullif(trim(opp), ''), goals_for = gf, goals_against = ga where id = m returning * into mt;
  end if;

  -- лучший игрок один: прежнего снимаем, если в составе назван новый
  if exists (select 1 from jsonb_array_elements(roster) e where coalesce((e->>'best')::boolean, false)) then
    update match_players set best = false where match_id = mt.id and best;
  end if;

  for el in select * from jsonb_array_elements(roster) loop
    pid := (el->>'player_id')::uuid;
    v_played := coalesce((el->>'played')::boolean, false);
    v_goals := coalesce((el->>'goals')::int, 0);
    v_best := coalesce((el->>'best')::boolean, false);
    if v_goals < 0 then raise exception 'invalid goals'; end if;
    if v_goals > 0 and not v_played then raise exception 'goals without playing'; end if;
    if v_best and not v_played then raise exception 'best player must have played'; end if;
    if v_best then bests := bests + 1; end if;
    if bests > 1 then raise exception 'only one best player'; end if;
    if adm then
      if not exists (select 1 from players where id = pid and club_id = club) then raise exception 'player not in club'; end if;
    elsif not (exists (select 1 from players where id = pid and group_id = g) or exists (select 1 from match_fees where match_id = mt.id and player_id = pid)) then
      raise exception 'player not in group';
    end if;
    insert into match_players (match_id, player_id, played, goals, best) values (mt.id, pid, v_played, v_goals, v_best)
      on conflict (match_id, player_id) do update set played = excluded.played, goals = excluded.goals, best = excluded.best;
  end loop;

  if gf is not null and (select coalesce(sum(goals), 0) from match_players where match_id = mt.id and played) > gf then
    raise exception 'goals exceed team score';
  end if;
  perform apply_match_points(mt.id);
  return mt.id;
end $$;

-- Журнал тренировок для тренеров: только просмотр, без часов (hours) и денег
create or replace function trainer_attendance(p_from date, p_to date)
returns table (held_on date, coach text, group_label text, kind text, starts_at time, ends_at time, location text, held boolean)
language plpgsql stable security definer set search_path = public as $$
begin
  if current_user_id() is null or not (is_admin() or is_any_coach()) then raise exception 'forbidden' using errcode = '42501'; end if;
  if p_from is null or p_to is null or p_from > p_to then raise exception 'bad period' using errcode = '22023'; end if;
  if p_to - p_from > 400 then raise exception 'period too large' using errcode = '22023'; end if;
  return query
  select l.held_on, l.coach, l.group_label, l.kind, l.starts_at, l.ends_at, l.location, l.held
  from training_log l where l.held_on between p_from and p_to
  order by l.held_on desc, l.starts_at nulls last, l.coach;
end $$;
revoke execute on function trainer_attendance(date, date) from public, anon;
grant execute on function trainer_attendance(date, date) to authenticated;
