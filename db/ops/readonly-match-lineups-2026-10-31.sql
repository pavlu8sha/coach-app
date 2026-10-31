-- Только чтение. Матчи, где «играли» отмечены только забившие (подозрение на неполный состав).
-- 1. Сводка по матчам: сколько отмечено игравших, сколько из них с голами, и сколько детей группы команды было в тот день отмечено на тренировках.
select m.played_on, m.team, m.kind, m.goals_for,
       count(*) filter (where mp.played) as сыграло,
       count(*) filter (where mp.played and mp.goals > 0) as из_них_с_голами,
       count(*) filter (where not mp.played) as строк_без_игры
from matches m
left join match_players mp on mp.match_id = m.id
where m.played_on <= current_date
group by m.id
having count(*) filter (where mp.played) > 0
   and count(*) filter (where mp.played) = count(*) filter (where mp.played and mp.goals > 0)
order by m.played_on desc, m.team;

-- 2. Сколько таких матчей по командам (для масштаба).
select m.team, count(*) as матчей
from matches m
where m.played_on <= current_date
  and exists (select 1 from match_players mp where mp.match_id = m.id and mp.played)
  and not exists (select 1 from match_players mp where mp.match_id = m.id and mp.played and mp.goals = 0)
group by m.team order by m.team;
