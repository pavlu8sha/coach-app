-- 0106: товарищеский матч команды без своей группы (например, U12 из двух составов для турнира).
-- Создаёт только администратор: матч записывается с названием команды, состав собирается вручную из игроков клуба.
-- Существующие матчи правятся через save_match (администратор, g = null), как и раньше.
create or replace function save_match_team(tm text, d date, opp text, gf int, ga int, roster jsonb) returns uuid
language plpgsql security definer set search_path = public as $$
declare club uuid; mid uuid;
begin
  if current_user_id() is null then raise exception 'not authenticated' using errcode = '42501'; end if;
  if not is_admin() then raise exception 'forbidden' using errcode = '42501'; end if;
  if nullif(trim(tm), '') is null then raise exception 'team required'; end if;
  select c.id into club from clubs c order by c.id limit 1;
  insert into matches (club_id, played_on, team, opponent, goals_for, goals_against)
    values (club, d, trim(tm), nullif(trim(opp), ''), gf, ga) returning id into mid;
  -- проверки счёта, состава и баллов те же, что в save_match; при ошибке вся вставка откатится
  perform save_match(mid, null, d, opp, gf, ga, roster);
  return mid;
end $$;
revoke execute on function save_match_team(text, date, text, int, int, jsonb) from public, anon;
grant execute on function save_match_team(text, date, text, int, int, jsonb) to authenticated;
