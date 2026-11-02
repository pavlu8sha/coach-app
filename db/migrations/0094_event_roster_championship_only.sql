-- 0094: состав события = заявка на чемпионат (tournament_fees). Игроки, добавленные только в состав одного матча
-- (гости, ушедшие), больше не попадают в состав всего события и в другие матчи: они остаются в том матче, куда их добавили.
-- Отменяет объединение с match_players из 0060 и 0091. Данные не меняются, только чтение.
-- Статистика (match_stats) считает по match_players и не зависит от этого.
create or replace function event_list()
returns table (id uuid, team text, kind text, name text, starts_on date, players int, games int)
language plpgsql stable security definer set search_path = public as $$
begin
  perform event_assert_staff();
  return query
    select t.id, t.team, t.kind, t.name, t.starts_on,
           (select count(*)::int from tournament_fees f where f.tournament_id = t.id),
           (select count(*)::int from matches m where m.tournament_id = t.id)
      from tournaments t
     order by t.starts_on desc nulls last, t.name;
end $$;

drop function if exists event_roster(uuid);
create function event_roster(t uuid)
returns table (player_id uuid, full_name text, group_name text)
language plpgsql stable security definer set search_path = public as $$
begin
  perform event_assert_staff();
  return query
    select p.id, p.full_name, g.name
      from tournament_fees f join players p on p.id = f.player_id left join groups g on g.id = p.group_id
     where f.tournament_id = t
     order by p.full_name;
end $$;
revoke execute on function event_roster(uuid) from public, anon;
grant execute on function event_roster(uuid) to authenticated;
