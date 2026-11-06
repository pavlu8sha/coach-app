-- Журнал статусов игрока читают все тренеры (как игроков, группы и занятия с миграции 0042).
-- Раньше только тренер группы игрока: тренер другой группы видел игрока в «Отметках», но журнал приходил пустым,
-- и фильтр «кто занимался в этот день» опирался на текущий статус (вернувшийся показывался за прошлые даты).
begin;
drop policy if exists player_status_log_read on player_status_log;
create policy player_status_log_read on player_status_log for select
  using (is_admin() or is_any_coach() or is_coach_of_player(player_id));
commit;
