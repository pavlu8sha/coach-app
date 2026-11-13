-- Winter Camp 2027: перевод сбора на Surami (презентация Winter_Camp_2027_SURAMI.pdf, решения Павла 11.11).
-- Условия приёмки: docs/CAMP_GUEST_SECTION_ACCEPTANCE.md, условие 10. НЕ ЗАПУСКАТЬ без слова владельца.
-- Миграции не нужны. Один оператор: либо всё применится, либо ничего. Ничего не меняется, если сбор не найден ровно один.
-- Сначала выполните блок «ПРОВЕРКА» (только чтение), посмотрите строки, потом блок «ПРИМЕНЕНИЕ».
--
-- Что меняется: даты 2027-01-02..2027-01-09, место «Hotel Surami», бронь 500 до 2026-12-05, полная оплата до 2026-12-20,
-- тариф «Футболист» 1350, тариф «Футболист + 2 родителя» 3100 (прежний «Ребёнок + 2 родителя» переименовывается), тариф «Ребёнок + 1 родитель» отключается (active=false, не удаляется). Названия сравниваются без учёта регистра, «ё»/«е» и лишних пробелов.
-- Записи на старых тарифах пересчитывает отдельный файл db/ops/camp-surami-2027-reprice.sql (после этого файла): «Футболист» остаётся «Футболистом» с новой ценой, любой другой тариф становится «Футболист + 2 родителя» (решение Павла 12.11).
-- Что НЕ меняется: суммы уже записанных участников (camp_participants.amount), платежи, прежние версии условий отмены (журнал только добавляется), вместимость, ссылка.

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

  -- Название сравнивается без учёта регистра, «е»/«ё» и лишних пробелов. Блок повторяемый: уже обновлённые тарифы подходят под условие тоже.
  update camp_tariffs set price = 1350 where camp_id = cid and regexp_replace(replace(lower(btrim(name)), 'ё', 'е'), '\s+', ' ', 'g') = 'футболист';
  get diagnostics t1 = row_count;
  update camp_tariffs set price = 3100, name = 'Футболист + 2 родителя' where camp_id = cid
     and regexp_replace(replace(lower(btrim(name)), 'ё', 'е'), '\s+', ' ', 'g') in ('ребенок + 2 родителя', 'футболист + 2 родителя');
  get diagnostics t2 = row_count;
  -- Тариф с одним родителем: «Ребёнок + 1 родитель» или «Ребёнок + родитель» (так он назван в базе); его может уже не быть или он уже отключён
  update camp_tariffs set active = false where camp_id = cid
     and regexp_replace(replace(lower(btrim(name)), 'ё', 'е'), '\s+', ' ', 'g') in ('ребенок + 1 родитель', 'ребенок + родитель');
  get diagnostics t3 = row_count;
  if t1 <> 1 or t2 <> 1 or t3 > 1 then
    raise exception 'тарифы не совпали с ожидаемыми (Футболист: %, семейный: %, с одним родителем: %): проверьте названия в блоке ПРОВЕРКА', t1, t2, t3;
  end if;
end $$;
commit;

-- Результат: те же две выборки из блока ПРОВЕРКА должны показать новые значения.
-- Условия отмены убирает второй блок ПРИМЕНЕНИЕ 2 (в презентации их нет).

-- ===== ПРИМЕНЕНИЕ 2: условия отмены =====
-- В новой презентации условий отмены нет (решение Павла 11.11: вся информация из PDF). Журнал версий только добавляется, поэтому
-- добавляется новая версия с пустым списком периодов: на экранах родителя и на публичной странице блок условий исчезает,
-- старые версии и снимки условий в истории записей остаются нетронутыми. Новые условия позже вносит администратор в карточке сбора.
-- Выполнять после блока ПРИМЕНЕНИЕ, отдельной командой; повторный запуск добавит ещё одну пустую версию, поэтому второй раз не выполнять.
insert into camp_cancel_terms (camp_id, version, periods)
select c.id, coalesce((select max(version) from camp_cancel_terms k where k.camp_id = c.id), 0) + 1, '[]'::jsonb
  from camps c where c.name ilike '%winter%camp%2027%'
   and (select count(*) from camps where name ilike '%winter%camp%2027%') = 1;
