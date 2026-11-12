-- Winter Camp 2027: пересчёт суммы у уже записанных игроков после смены тарифов (Surami).
-- Причина: camp_participants.amount — снимок тарифа на момент записи. Смена camp_tariffs.price его не меняет
-- (db/ops/camp-surami-2027-update.sql это подтверждает: «суммы уже записанных участников не меняются»).
-- Запускать ПОСЛЕ db/ops/camp-surami-2027-update.sql (тарифы уже новые).
-- НЕ ЗАПУСКАТЬ без слова владельца. Ничего не удаляется, платежи не трогаются.
--
-- Правило пересчёта: меняем только записи со статусом registered, у которых сумма равна ОДНОЙ ИЗ СТАРЫХ цен тарифа
-- (список старых цен ниже, в массиве old_prices), сумма не меньше уже внесённого. Ручные суммы (скидки, правки админа)
-- не трогаем, они попадают в блок «РАСХОЖДЕНИЯ» и решаются отдельно.

-- ===== ПРОВЕРКА (только чтение) =====
-- 1. Все записи с суммой, не равной текущей цене тарифа:
select p.id, p.player_id, p.guest_name, t.name as tariff, t.price as tariff_price, p.amount,
       coalesce((select sum(x.amount) from camp_payments x where x.participant_id = p.id), 0) as paid
  from camp_participants p
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
  old_prices numeric[] := array[1500]::numeric[];   -- ← дополните старыми ценами тарифов из ПРОВЕРКИ (сейчас видна 1500 у «Футболист»)
begin
  select count(*) into n from camps where name ilike '%winter%camp%2027%';
  if n <> 1 then raise exception 'ожидался ровно один сбор Winter Camp 2027, найдено %', n; end if;
  select id into cid from camps where name ilike '%winter%camp%2027%';

  -- Защита: записи, которые пересчитаем, не должны иметь сумму ниже уже внесённого
  if exists (
    select 1 from camp_participants p join camp_tariffs t on t.id = p.tariff_id
     where p.camp_id = cid and p.status = 'registered' and p.amount = any(old_prices) and p.amount <> t.price
       and t.price < coalesce((select sum(x.amount) from camp_payments x where x.participant_id = p.id), 0)
  ) then
    raise exception 'есть записи, где новая цена меньше уже внесённого; пересчёт отменён';
  end if;

  update camp_participants p set amount = t.price
    from camp_tariffs t
   where t.id = p.tariff_id and p.camp_id = cid and p.status = 'registered'
     and p.amount = any(old_prices) and p.amount <> t.price;
  get diagnostics upd = row_count;
  raise notice 'пересчитано записей: %', upd;
end $$;
commit;

-- Результат: повторите выборку из ПРОВЕРКИ. Должны остаться только записи с ручными суммами.
-- Журнал изменений суммы пишет триггер camp_participants_log (виден в истории записи).
