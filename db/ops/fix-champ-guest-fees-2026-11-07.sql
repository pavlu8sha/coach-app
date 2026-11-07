-- Разовый взнос 25 ₾ гостям матчей Championship 2 (сезон осень 2026): 8 строк по результатам readonly-проверки от 07.11.
-- Создаёт только match_fees (за матч). Оплат не создаёт: их записываете через экран «Взносы» матча.
-- Одна команда (один оператор): либо всё вставится, либо ничего. Уже существующие строки не трогаются.
-- Защита: строка вставится, только если игрок отмечен «Играл» и не заявлен в этом чемпионате ни за одну команду (например, Liashenko из заявки U9-A Championship 2 взнос не получит).
-- Миграции 0153 и 0155 нужны для будущих матчей, для этого файла не обязательны.

insert into match_fees (match_id, player_id, amount)
select v.match_id::uuid, v.player_id::uuid, 25
  from (values
    ('f6100eb0-1541-4a96-9cfb-f67d39f5c8e2', '5d7908f2-f1ae-4b75-98af-ce2e3a6db8b9'), -- 07.11 U11 FC Morkinali: Kukhalashvili Misha
    ('6a6ed837-74f5-4010-8dea-dcdc2eac9754', 'fad36db9-a803-43b0-b786-0eaf99e492b1'), -- 29.10 U9-B FC Sanzona Gldani: Smirnov Timofey
    ('78e2fa8a-9723-4726-a395-520c6d37e07d', '13dc88ad-e00d-411c-9ffb-83470e9543ee'), -- 24.10 U9-B FC Tbilisi-2025: Goltsev Max
    ('78e2fa8a-9723-4726-a395-520c6d37e07d', '6f5464a4-444d-45b9-9771-a0a7831e2b3f'), -- 24.10 U9-B FC Tbilisi-2025: Kyral Dzhan
    ('78e2fa8a-9723-4726-a395-520c6d37e07d', 'bb3f6797-44b1-477c-a743-b304ed4b5e86'), -- 24.10 U9-B FC Tbilisi-2025: Liashenko Kyryl
    ('8e0292ef-fb94-4fc1-9b0d-2ca75f08073e', '033702cd-da6e-4fb1-995b-e5c95c69475e'), -- 17.10 U9-A FC Sansona-1: Stashkevich Vlad
    ('b92cb472-6d5f-4b53-b346-9b7016b7fef1', 'bb3f6797-44b1-477c-a743-b304ed4b5e86'), -- 27.09 U9-B FC Dinamo school: Liashenko Kyryl
    ('5e60d928-9dcd-499d-8f67-553e40df72eb', '468e8a6e-61aa-4ada-aa0d-797c03f951c2')  -- 19.09 U9-B FC Tbilisi-2025: Belich Luka
  ) as v(match_id, player_id)
  join matches m on m.id = v.match_id::uuid
  join match_players mp on mp.match_id = m.id and mp.player_id = v.player_id::uuid and mp.played
 where m.tournament_id is not null
   -- исключение (решение Павла 07.11): заявленный в этом чемпионате за любую команду (то же название и вид) взнос за игру не платит
   and not exists (
     select 1
       from tournaments e
       join tournaments x on x.club_id = e.club_id and x.kind = e.kind and x.name is not distinct from e.name
       join tournament_fees f on f.tournament_id = x.id
      where e.id = m.tournament_id and f.player_id = mp.player_id
   )
on conflict (match_id, player_id) do nothing
returning match_id, player_id, amount;
-- Вернётся от 0 до 8 строк: те, кто заявлен в этом чемпионате за другую команду, пропускаются. Сверьте со списком запроса 1.

-- Проверка после вставки:
-- select p.full_name, m.played_on, m.opponent, mf.amount, mf.paid
--   from match_fees mf join players p on p.id = mf.player_id join matches m on m.id = mf.match_id
--  where mf.amount = 25 and m.tournament_id in ('b4e65391-d5e4-4cd8-8537-4951de23d0ed', 'f3b7a401-6d27-475b-a788-4edf4a452ac0', 'cb19ca5f-9942-4a28-a73f-6a9cc41e4496')
--  order by m.played_on desc, p.full_name;

-- Отмена (только пока по этим строкам нет оплат): удалить те же 8 строк
-- delete from match_fees mf using (values
--     ('f6100eb0-1541-4a96-9cfb-f67d39f5c8e2','5d7908f2-f1ae-4b75-98af-ce2e3a6db8b9'), ('6a6ed837-74f5-4010-8dea-dcdc2eac9754','fad36db9-a803-43b0-b786-0eaf99e492b1'),
--     ('78e2fa8a-9723-4726-a395-520c6d37e07d','13dc88ad-e00d-411c-9ffb-83470e9543ee'), ('78e2fa8a-9723-4726-a395-520c6d37e07d','6f5464a4-444d-45b9-9771-a0a7831e2b3f'),
--     ('78e2fa8a-9723-4726-a395-520c6d37e07d','bb3f6797-44b1-477c-a743-b304ed4b5e86'), ('8e0292ef-fb94-4fc1-9b0d-2ca75f08073e','033702cd-da6e-4fb1-995b-e5c95c69475e'),
--     ('b92cb472-6d5f-4b53-b346-9b7016b7fef1','bb3f6797-44b1-477c-a743-b304ed4b5e86'), ('5e60d928-9dcd-499d-8f67-553e40df72eb','468e8a6e-61aa-4ada-aa0d-797c03f951c2')
--   ) as v(m, p)
--  where mf.match_id = v.m::uuid and mf.player_id = v.p::uuid and not mf.paid
--    and not exists (select 1 from match_payments x where x.match_id = mf.match_id and x.player_id = mf.player_id);
