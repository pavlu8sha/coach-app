-- 0048: команда матча совпадает с группой не только по точному названию, но и по названию группы без суффикса -A/-B/-C.
-- В играх команда записана как «U10», «U9», «U7», а группы называются «U10-A», «U10-B» и т.д. (решение владельца, Issue #172).
-- Суффикс строго в конце названия, одна буква: «Ortachala U9» (без суффикса) с «U9-A»/«U9-B» не склеивается.
-- Данные (matches.team) не меняются, права не расширяются: по-прежнему нужна связь с группой (тренер группы или родитель её игрока).
create or replace function can_see_team(c uuid, t text) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from groups g
    where g.club_id = c
      and (g.name = t or (g.name ~ '-[ABC]$' and left(g.name, length(g.name) - 2) = t))
      and (is_coach_of_group(g.id) or is_guardian_in_group(g.id))
  )
$$;

revoke execute on function can_see_team(uuid, text) from public;
grant execute on function can_see_team(uuid, text) to authenticated;
