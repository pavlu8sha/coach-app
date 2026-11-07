-- ЧЕРНОВИК, НЕ ЗАПУСКАТЬ до решения по сумме и проверки readonly-champ-guest-fees-2026-11-07.sql.
-- Назначает разовый взнос за матч тем, кто сыгран в матче чемпионата/фестиваля, но не входит в заявку события.
-- Взнос создаётся только в match_fees (за матч). Оплаты не создаются: их Павел или администратор запишут
-- через экран «Взносы» матча (как обычные оплаты матча).
-- Уже существующие строки match_fees не трогаются (on conflict do nothing).
--
-- Шаги:
--   1. Заменить 0 в select на согласованную сумму (₾).
--   2. Оставить в списке match_ids только матчи из readonly-проверки, у которых нужен взнос.
--   3. Выполнить блок до commit: посмотреть количество строк и список. Если неверно, выполнить rollback.
--   4. Выполнить commit.

begin;

with guests as (
  select distinct m.id as match_id, mp.player_id
    from match_players mp
    join matches m on m.id = mp.match_id
    join tournaments t on t.id = m.tournament_id
   where mp.played
     and t.kind in ('championship', 'festival')
     and m.kind is distinct from 'friendly'
     and m.id in (
       -- сюда вставить id матчей из readonly-проверки (запрос 1)
       '00000000-0000-0000-0000-000000000000'
     )
     and not exists (
       select 1 from tournament_fees f
        where f.tournament_id = m.tournament_id and f.player_id = mp.player_id
     )
)
insert into match_fees (match_id, player_id, amount)
select g.match_id, g.player_id, 0 -- СУММА ЗА МАТЧ, ₾ (заменить)
  from guests g
on conflict (match_id, player_id) do nothing;

-- Проверка перед commit: строки, которые появились (или уже были) для этих матчей
select mf.match_id, p.full_name, mf.amount, mf.paid
  from match_fees mf
  join players p on p.id = mf.player_id
 where mf.match_id = any (array['00000000-0000-0000-0000-000000000000'::uuid])
 order by p.full_name;

-- commit;
-- rollback;
