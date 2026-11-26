-- 0225: remove_match_player не даёт менять матч чужого клуба.
-- Тело 0223 (последнее определение: grep -lEi "function +(public\.)?remove_match_player *\(" db/migrations/*.sql даёт 0192 и 0223),
-- единственное изменение: проверка клуба матча после проверки роли и существования матча.
-- Клуб пользователя: club_event_current_club() (users.club_id, иначе единственный клуб, иначе NULL).
-- Тренер с неопределимым клубом получает отказ; администратор с неопределимым клубом работает как раньше.
-- Условия: docs/REMOVE_MATCH_PLAYER_CLUB_ACCEPTANCE.md. Откат: db/ops/rollback-0225-remove-match-player-club.sql.
create or replace function remove_match_player(m uuid, p uuid) returns void
language plpgsql security definer set search_path = public as $$
declare was_best boolean; mclub uuid; uclub uuid;
begin
  if current_user_id() is null then raise exception 'not authenticated' using errcode = '42501'; end if;
  if not (is_admin() or is_any_coach()) then raise exception 'forbidden' using errcode = '42501'; end if;
  select club_id into mclub from matches where id = m;
  if not found then raise exception 'match not found'; end if;
  uclub := club_event_current_club();
  if uclub is distinct from mclub and (uclub is not null or not is_admin()) then raise exception 'forbidden' using errcode = '42501'; end if;
  if not exists (select 1 from match_players where match_id = m and player_id = p) then raise exception 'player not in match'; end if;
  select best into was_best from match_players where match_id = m and player_id = p;
  if coalesce(was_best, false) then perform set_config('app.match_best_removed', m::text, true); end if;
  update match_players set played = false, goals = 0, best = false, performance_rating = null where match_id = m and player_id = p;
  delete from match_players where match_id = m and player_id = p;
end $$;
revoke execute on function remove_match_player(uuid, uuid) from public, anon;
grant execute on function remove_match_player(uuid, uuid) to authenticated;
