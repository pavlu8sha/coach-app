-- Сужение чтения: матчи и расписание видят только те, кому они нужны (handoff, п. 7.4).
-- Было: любой вошедший пользователь читал все матчи и всё расписание клуба.
-- Стало:
--  * матчи — администратор; тренер и родитель игрока группы с названием = команде матча; а также родитель или тренер
--    игрока, который в этом матче участвовал (запись в match_players), даже если команда другая;
--  * расписание — администратор, тренер группы, родитель игрока группы.
-- Правила рейтинга (rules), цены (prices), клуб и сезоны остаются читаемыми для всех вошедших: это справочники без личных данных.

-- Видна ли команда матча (по названию группы клуба) пользователю как тренеру или родителю её игрока
create or replace function can_see_team(c uuid, t text) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from groups g
    where g.club_id = c and g.name = t and (is_coach_of_group(g.id) or is_guardian_in_group(g.id))
  )
$$;

drop policy matches_read on matches;
create policy matches_read on matches for select using (
  is_admin()
  or can_see_team(club_id, team)
  or exists (select 1 from match_players mp where mp.match_id = matches.id and (is_guardian_of(mp.player_id) or is_coach_of_player(mp.player_id)))
);

drop policy weekly_schedule_read on weekly_schedule;
create policy weekly_schedule_read on weekly_schedule for select using (
  is_admin() or is_coach_of_group(group_id) or is_guardian_in_group(group_id)
);

revoke execute on function can_see_team(uuid, text) from public;
grant execute on function can_see_team(uuid, text) to authenticated;
