-- 0082: фильтр по виду матчей (p_cat) у тренера. Таблица tournaments закрыта для всех, кроме администратора, поэтому при обычном соединении
-- у тренера вид турнира не находился и все матчи считались товарищескими: фильтр «Чемпионат» показывал «Нет матчей».
-- Вид берём из узкой функции tournament_label (0041): она отдаёт только название и вид турнира, остальное в match_stats без изменений (0080).
-- Новых security definer нет, сигнатура прежняя.

create or replace function match_stats(p_from date, p_to date, p_cat text default null)
returns table (kind text, team text, name text, games int, wins int, draws int, losses int, goals_for int, goals_against int, played int, goals int)
language plpgsql stable set search_path = public as $$
declare adm boolean := is_admin();
begin
  if current_user_id() is null or not (adm or exists (select 1 from coach_groups c where c.user_id = current_user_id())) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if p_from is null or p_to is null or p_from > p_to then raise exception 'bad period' using errcode = '22023'; end if;
  if p_to - p_from > 400 then raise exception 'period too large' using errcode = '22023'; end if;
  if p_cat is not null and p_cat not in ('championship', 'festival', 'cup', 'friendly') then raise exception 'bad category' using errcode = '22023'; end if;
  return query
  with mine as (
    -- команды групп тренера: название группы без суффикса -A/-B/-C, как при записи матча (save_match, 0055)
    select distinct regexp_replace(g.name, '-[A-Z]$', '') as team
    from coach_groups c join groups g on g.id = c.group_id
    where c.user_id = current_user_id()
  ), m as (
    select x.id, x.team, x.goals_for gf, x.goals_against ga from matches x
    left join lateral tournament_label(x.tournament_id) t on x.tournament_id is not null
    where x.played_on between p_from and p_to and x.goals_for is not null and x.goals_against is not null
      and (p_cat is null or p_cat = case when x.kind = 'friendly' or t.kind is null then 'friendly' else t.kind end)
      and (adm or regexp_replace(x.team, '-[A-Z]$', '') in (select mine.team from mine))
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
