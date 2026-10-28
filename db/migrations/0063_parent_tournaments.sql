-- Турниры, в которых участвует ребёнок родителя, даже если у турнира ещё/уже нет матчей.
-- Нужно для Newton cup: в источнике есть только состав и взносы, игр нет.
create or replace function my_tournaments()
returns table(id uuid, team text, kind text, name text, starts_on date, games int)
language sql stable security definer set search_path = public as $$
  select t.id, t.team, t.kind, t.name, t.starts_on,
    (select count(*)::int from matches m where m.tournament_id = t.id)
  from tournaments t
  where exists (
    select 1
    from tournament_fees f
    join player_guardians pg on pg.player_id = f.player_id
    where f.tournament_id = t.id
      and pg.user_id = auth.uid()
      and pg.consent_revoked_at is null
  )
  order by t.starts_on desc nulls last, t.name;
$$;

grant execute on function my_tournaments() to authenticated;
