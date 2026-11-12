-- Winter Camp 2027: пересчёт суммы у уже записанных игроков после смены тарифов (Surami).
-- Причина: camp_participants.amount — снимок тарифа на момент записи. Смена camp_tariffs.price его не меняет
-- (db/ops/camp-surami-2027-update.sql это подтверждает: «суммы уже записанных участников не меняются»).
-- Запускать ПОСЛЕ db/ops/camp-surami-2027-update.sql (тарифы уже новые).
-- НЕ ЗАПУСКАТЬ без слова владельца. Ничего не удаляется, платежи не трогаются.
--
-- Правило пересчёта: меняем только записи со статусом registered, у которых сумма равна ОДНОЙ ИЗ СТАРЫХ цен тарифа
-- (список старых цен ниже, в массиве old_prices). Ручные суммы (скидки, правки админа) не трогаем.
-- Если уже внесено больше новой цены, запись НЕ пересчитывается (сумма не может быть ниже оплаченного): она видна
-- в ПРОВЕРКЕ с колонкой overpaid, по ней нужен возврат разницы вручную, затем повторный запуск.
-- Записи на отключённом тарифе «Ребёнок + 1 родитель» скрипт не трогает (цена тарифа не менялась), см. блок 3.

-- ===== ПРОВЕРКА (только чтение) =====
-- Название тарифа: в базе может быть «Ребенок» через «е», а update.sql ищет «Ребёнок» через «ё».
select t.id, t.name, t.price, t.active from camp_tariffs t join camps c on c.id = t.camp_id
 where c.name ilike '%winter%camp%2027%' order by t.price;
-- 1. Все записи с суммой, не равной текущей цене тарифа:
select p.id, p.player_id, p.guest_name, t.name as tariff, t.active, t.price as tariff_price, p.amount, q.paid,
       greatest(q.paid - t.price, 0) as overpaid
  from camp_participants p
  cross join lateral (select coalesce(sum(x.amount), 0) as paid from camp_payments x where x.participant_id = p.id) q
  join camp_tariffs t on t.id = p.tariff_id
  join camps c on c.id = p.camp_id
 where c.name ilike '%winter%camp%2027%' and p.status = 'registered' and p.amount <> t.price
 order by t.name, p.amount;

-- ===== ПРИМЕНЕНИЕ =====
-- Перед запуском: посмотрите вывод ПРОВЕРКИ. Если там есть суммы, которых нет в old_prices и которые не ручные,
-- добавьте их в массив old_prices. Записи с ручной суммой не добавляйте.
begin;
do $$
declare cid uuid; n int; upd int;
  old_prices numeric[] := array[1500, 3500]::numeric[];   -- старые цены: «Футболист» 1500, «Ребёнок + 2 родителя» 3500; сверить с ПРОВЕРКОЙ
begin
  select count(*) into n from camps where name ilike '%winter%camp%2027%';
  if n <> 1 then raise exception 'ожидался ровно один сбор Winter Camp 2027, найдено %', n; end if;
  select id into cid from camps where name ilike '%winter%camp%2027%';

  update camp_participants p set amount = t.price
    from camp_tariffs t
   where t.id = p.tariff_id and p.camp_id = cid and p.status = 'registered'
     and p.amount = any(old_prices) and p.amount <> t.price
     and t.price >= coalesce((select sum(x.amount) from camp_payments x where x.participant_id = p.id), 0);
  get diagnostics upd = row_count;
  select count(*) into n from camp_participants p join camp_tariffs t on t.id = p.tariff_id
   where p.camp_id = cid and p.status = 'registered' and p.amount = any(old_prices) and p.amount <> t.price;
  raise notice 'пересчитано записей: %, пропущено из-за переплаты (нужен возврат): %', upd, n;
end $$;
commit;

-- Результат: повторите выборку из ПРОВЕРКИ. Должны остаться только записи с ручными суммами.
-- Журнал изменений суммы пишет триггер camp_participants_log (виден в истории записи).

-- ===== БЛОК 3: записи на отключённом тарифе «Ребёнок + 1 родитель» (ЖДЁТ РЕШЕНИЯ ВЛАДЕЛЬЦА, по умолчанию закомментирован) =====
-- Вариант «перевести на Футболист + 2 родителя»: раскомментировать. Перевод только если внесено не больше новой цены.
-- update camp_participants p set tariff_id = n.id, amount = n.price
--   from camp_tariffs o, camp_tariffs n, camps c
--  where c.name ilike '%winter%camp%2027%' and o.camp_id = c.id and n.camp_id = c.id
--    and o.name in ('Ребёнок + 1 родитель', 'Ребенок + 1 родитель') and n.name = 'Футболист + 2 родителя'
--    and p.tariff_id = o.id and p.status = 'registered'
--    and n.price >= coalesce((select sum(x.amount) from camp_payments x where x.participant_id = p.id), 0);
