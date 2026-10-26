-- 1) Состав события включает и тех, кто играл в играх события, даже если у них нет взноса (ушедшие и гости): статистика по ним остаётся видна.
create or replace function event_roster(t uuid)
returns table (player_id uuid, full_name text, group_name text)
language plpgsql stable security definer set search_path = public as $$
begin
  perform event_assert_staff();
  return query
    select p.id, p.full_name, g.name
      from players p left join groups g on g.id = p.group_id
     where p.id in (select f.player_id from tournament_fees f where f.tournament_id = t)
        or p.id in (select mp.player_id from match_players mp join matches m on m.id = mp.match_id where m.tournament_id = t)
     order by p.full_name;
end $$;

-- 2) Статистика матчей по виду: чемпионат, фестиваль, кубок, товарищеские (p_cat: championship, festival, cup, friendly; пусто — все).
drop function if exists match_stats(date, date);
create or replace function match_stats(p_from date, p_to date, p_cat text default null)
returns table (kind text, team text, name text, games int, wins int, draws int, losses int, goals_for int, goals_against int, played int, goals int)
language plpgsql stable set search_path = public as $$
begin
  if current_user_id() is null or not (is_admin() or exists (select 1 from coach_groups c where c.user_id = current_user_id())) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if p_from is null or p_to is null or p_from > p_to then raise exception 'bad period' using errcode = '22023'; end if;
  if p_to - p_from > 400 then raise exception 'period too large' using errcode = '22023'; end if;
  if p_cat is not null and p_cat not in ('championship', 'festival', 'cup', 'friendly') then raise exception 'bad category' using errcode = '22023'; end if;
  return query
  with m as (
    select x.id, x.team, x.goals_for gf, x.goals_against ga from matches x
    left join tournaments t on t.id = x.tournament_id
    where x.played_on between p_from and p_to and x.goals_for is not null and x.goals_against is not null
      and (p_cat is null or p_cat = case when x.kind = 'friendly' or t.id is null then 'friendly' else t.kind end)
  )
  select 'team'::text, m.team, null::text,
         count(*)::int, count(*) filter (where m.gf > m.ga)::int, count(*) filter (where m.gf = m.ga)::int, count(*) filter (where m.gf < m.ga)::int,
         sum(m.gf)::int, sum(m.ga)::int, null::int, null::int
  from m group by m.team
  union all
  select 'player'::text, m.team, p.full_name, null::int, null::int, null::int, null::int, null::int, null::int,
         count(*) filter (where mp.played)::int, coalesce(sum(mp.goals), 0)::int
  from m join match_players mp on mp.match_id = m.id join players p on p.id = mp.player_id
  where mp.played or mp.goals > 0
  group by m.team, p.id, p.full_name
  order by 1, 2, 3;
end $$;
revoke execute on function match_stats(date, date, text) from public, anon;
grant execute on function match_stats(date, date, text) to authenticated;
