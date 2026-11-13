-- Тренер правит состав матча: убрать игрока из матча (условия: docs/COACH_REMOVE_MATCH_PLAYER_ACCEPTANCE.md).
-- Удалять строки match_players может только администратор (политика match_players_admin_write), поэтому у тренера не было
-- «Править состав». Тренеры уже сохраняют состав и счёт любого матча через save_match, поэтому отдельная функция даёт им
-- ровно то, что экран делал администратору: снять отметку, голы и «лучший», затем удалить строку состава. Политики таблицы не меняются.
-- Откат: db/ops/rollback-0192-coach-remove-match-player.sql.

create or replace function remove_match_player(m uuid, p uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if current_user_id() is null then raise exception 'not authenticated' using errcode = '42501'; end if;
  if not (is_admin() or is_any_coach()) then raise exception 'forbidden' using errcode = '42501'; end if;
  if not exists (select 1 from matches where id = m) then raise exception 'match not found'; end if;
  if not exists (select 1 from match_players where match_id = m and player_id = p) then raise exception 'player not in match'; end if;
  -- сначала снимаем отметку (баллы пересчитываются триггерами), затем удаляем строку
  update match_players set played = false, goals = 0, best = false where match_id = m and player_id = p;
  delete from match_players where match_id = m and player_id = p;
end $$;
revoke execute on function remove_match_player(uuid, uuid) from public, anon;
grant execute on function remove_match_player(uuid, uuid) to authenticated;
