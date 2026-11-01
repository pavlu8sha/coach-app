-- 0090: счётчик игроков события (event_list) совпадает с составом на экране (event_roster).
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
