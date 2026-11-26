-- Откат 0225: remove_match_player возвращается к телу 0223 (без проверки клуба). Данные не затрагиваются.
begin;
create or replace function remove_match_player(m uuid, p uuid) returns void
language plpgsql security definer set search_path = public as $$
declare was_best boolean;
begin
  if current_user_id() is null then raise exception 'not authenticated' using errcode = '42501'; end if;
  if not (is_admin() or is_any_coach()) then raise exception 'forbidden' using errcode = '42501'; end if;
  if not exists (select 1 from matches where id = m) then raise exception 'match not found'; end if;
  if not exists (select 1 from match_players where match_id = m and player_id = p) then raise exception 'player not in match'; end if;
  select best into was_best from match_players where match_id = m and player_id = p;
  if coalesce(was_best, false) then perform set_config('app.match_best_removed', m::text, true); end if;
  update match_players set played = false, goals = 0, best = false, performance_rating = null where match_id = m and player_id = p;
  delete from match_players where match_id = m and player_id = p;
end $$;
revoke execute on function remove_match_player(uuid, uuid) from public, anon;
grant execute on function remove_match_player(uuid, uuid) to authenticated;
commit;
