-- 0091: счётчик игроков события (event_list) совпадает с составом на экране (event_roster).
-- С 0060 event_roster берёт игроков из tournament_fees и из match_players матчей события, а event_list считал только tournament_fees:
-- карточка писала «Игроков: 4», внутри было 12. Данные не меняются, только чтение.
create or replace function event_list()
returns table (id uuid, team text, kind text, name text, starts_on date, players int, games int)
language plpgsql stable security definer set search_path = public as $$
begin
  perform event_assert_staff();
  return query
    select t.id, t.team, t.kind, t.name, t.starts_on,
           (select count(*)::int from (
              select f.player_id from tournament_fees f where f.tournament_id = t.id
              union
              select mp.player_id from match_players mp join matches m on m.id = mp.match_id where m.tournament_id = t.id
            ) u),
           (select count(*)::int from matches m where m.tournament_id = t.id)
      from tournaments t
     order by t.starts_on desc nulls last, t.name;
end $$;

-- Состав события: признак in_fees (игрок в списке события). У тех, кто попал в состав только через составы матчей (in_fees = false),
-- кнопка «Убрать» ничего не меняла (event_roster_remove удаляет только tournament_fees); теперь экран показывает им пометку вместо кнопки.
drop function if exists event_roster(uuid);
create function event_roster(t uuid)
returns table (player_id uuid, full_name text, group_name text, in_fees boolean)
language plpgsql stable security definer set search_path = public as $$
begin
  perform event_assert_staff();
  return query
    select p.id, p.full_name, g.name,
           exists (select 1 from tournament_fees f where f.tournament_id = t and f.player_id = p.id)
      from players p left join groups g on g.id = p.group_id
     where p.id in (select f.player_id from tournament_fees f where f.tournament_id = t)
        or p.id in (select mp.player_id from match_players mp join matches m on m.id = mp.match_id where m.tournament_id = t)
     order by p.full_name;
end $$;
revoke execute on function event_roster(uuid) from public, anon;
grant execute on function event_roster(uuid) to authenticated;
