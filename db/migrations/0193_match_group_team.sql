-- Матч именно группы (U13-B), а не всей команды U13 (условия: docs/MATCH_GROUP_TEAM_ACCEPTANCE.md).
-- С 0055 команда нового матча пишется без буквы группы. Эта функция по явному выбору тренера или администратора записывает
-- в matches.team название группы (exact = true) или возвращает название без буквы (exact = false). save_match и остальное не менялись.
-- Видимость: can_see_team (0048) уже понимает точное название группы. Откат: db/ops/rollback-0193-match-group-team.sql.

create or replace function set_match_team_group(m uuid, g uuid, exact boolean) returns void
language plpgsql security definer set search_path = public as $$
declare mt matches; grp groups;
begin
  if current_user_id() is null then raise exception 'not authenticated' using errcode = '42501'; end if;
  if not (is_admin() or is_any_coach()) then raise exception 'forbidden' using errcode = '42501'; end if;
  select * into mt from matches where id = m for update;
  if mt.id is null then raise exception 'match not found'; end if;
  select * into grp from groups where id = g;
  if grp.id is null then raise exception 'group not found'; end if;
  if mt.tournament_id is not null then raise exception 'tournament match'; end if;
  if grp.club_id <> mt.club_id or regexp_replace(grp.name, '-[A-Z]$', '') <> regexp_replace(mt.team, '-[A-Z]$', '')
     or (mt.team ~ '-[A-Z]$' and mt.team <> grp.name) then
    raise exception 'group not in match team';
  end if;
  update matches set team = case when exact then grp.name else regexp_replace(grp.name, '-[A-Z]$', '') end where id = m;
end $$;
revoke execute on function set_match_team_group(uuid, uuid, boolean) from public, anon;
grant execute on function set_match_team_group(uuid, uuid, boolean) to authenticated;
