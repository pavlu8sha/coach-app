-- Winter Camp 2027: перевод сбора на Surami (презентация Winter_Camp_2027_SURAMI.pdf, решения Павла 11.11).
-- Условия приёмки: docs/CAMP_GUEST_SECTION_ACCEPTANCE.md, условие 10. НЕ ЗАПУСКАТЬ без слова владельца.
-- Миграции не нужны. Один оператор: либо всё применится, либо ничего. Ничего не меняется, если сбор не найден ровно один.
-- Сначала выполните блок «ПРОВЕРКА» (только чтение), посмотрите строки, потом блок «ПРИМЕНЕНИЕ».
--
-- Что меняется: даты 2027-01-02..2027-01-09, место «Hotel Surami», бронь 500 до 2026-12-05, полная оплата до 2026-12-20,
-- тариф «Футболист» 1350, тариф «Футболист + 2 родителя» 3100 (прежний «Ребёнок + 2 родителя» переименовывается), тариф «Ребёнок + 1 родитель» отключается (active=false, не удаляется).
-- Что НЕ меняется: суммы уже записанных участников (camp_participants.amount), платежи, условия отмены, вместимость, ссылка.

-- ===== ПРОВЕРКА (только чтение) =====
select id, name, slug, starts_on, ends_on, location, booking_fee, booking_deadline, full_payment_deadline, active
  from camps where name ilike '%winter%camp%2027%';
select t.id, t.name, t.price, t.active, (select count(*) from camp_participants p where p.tariff_id = t.id and p.status = 'registered') as registered
  from camp_tariffs t where t.camp_id in (select id from camps where name ilike '%winter%camp%2027%') order by t.price;
select version, periods from camp_cancel_terms
 where camp_id in (select id from camps where name ilike '%winter%camp%2027%') order by version desc limit 1;

-- ===== ПРИМЕНЕНИЕ =====
begin;
do $$
declare cid uuid; n int; t1 int; t2 int; t3 int;
begin
  select count(*) into n from camps where name ilike '%winter%camp%2027%';
  if n <> 1 then raise exception 'ожидался ровно один сбор Winter Camp 2027, найдено %', n; end if;
  select id into cid from camps where name ilike '%winter%camp%2027%';

  update camps set starts_on = date '2027-01-02', ends_on = date '2027-01-09', location = 'Hotel Surami',
                   booking_fee = 500, booking_deadline = date '2026-12-05', full_payment_deadline = date '2026-12-20'
   where id = cid;

  update camp_tariffs set price = 1350 where camp_id = cid and name = 'Футболист';
  get diagnostics t1 = row_count;
  update camp_tariffs set price = 3100, name = 'Футболист + 2 родителя' where camp_id = cid and name = 'Ребёнок + 2 родителя';
  get diagnostics t2 = row_count;
  update camp_tariffs set active = false where camp_id = cid and name = 'Ребёнок + 1 родитель';
  get diagnostics t3 = row_count;
  if t1 <> 1 or t2 <> 1 or t3 <> 1 then
    raise exception 'тарифы не совпали с ожидаемыми (Футболист: %, Ребёнок + 2 родителя: %, Ребёнок + 1 родитель: %): проверьте названия в блоке ПРОВЕРКА', t1, t2, t3;
  end if;
end $$;
commit;

-- Результат: те же две выборки из блока ПРОВЕРКА должны показать новые значения.
-- Условия отмены в базе остаются прежними (в презентации их нет). Новые условия вносит администратор в карточке сбора («Условия отмены»).
