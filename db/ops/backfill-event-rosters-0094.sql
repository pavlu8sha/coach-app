-- Для Павла, запускать вручную в Supabase SQL Editor ПОСЛЕ миграции 0094. Ничего само не запускается.
-- После 0094 состав события = заявка (tournament_fees). Раньше экран «Состав события» показывал ещё и всех, кто
-- хоть раз играл в матчах события. Если в каком-то чемпионате заявка неполная, этот скрипт показывает, кого не хватает,
-- и (по желанию) добавляет игравших в заявку со взносом 0 и без долга.

-- Шаг 1. Только просмотр: кто играл в матчах события, но не в заявке.
select t.name as event, t.team, p.full_name, count(*) filter (where mp.played) as games_played
  from tournaments t
  join matches m on m.tournament_id = t.id
  join match_players mp on mp.match_id = m.id and mp.played
  join players p on p.id = mp.player_id
 where not exists (select 1 from tournament_fees f where f.tournament_id = t.id and f.player_id = mp.player_id)
 group by t.name, t.team, p.full_name
 order by t.name, p.full_name;

-- Шаг 2. По желанию, после просмотра шага 1: добавить найденных в заявку. Взнос 0, поэтому долгов не появится.
-- begin;
-- insert into tournament_fees (tournament_id, player_id, amount)
--   select distinct m.tournament_id, mp.player_id, 0
--     from matches m join match_players mp on mp.match_id = m.id and mp.played
--    where m.tournament_id is not null
--   on conflict do nothing;
-- commit;
