-- pgTAP: #652 этап 2b, подготовка: db/ops/eq-freeze-2c-late.sql (заморозка заказов окна между 2c и 2b), проверка и откат.
-- Условия: docs/acceptance/eq-652-stage2c-late-freeze-2026-11-19.md (Л1–Л9).
\set late_all `sed -e 's/b8fbdf08-c24d-4df2-97de-da206c0a8dc3/00000000-0000-0000-0000-000000770012/' db/ops/eq-freeze-2c-late.sql`
\set late_two `sed -e "s/array\['b8fbdf08-c24d-4df2-97de-da206c0a8dc3'\]/array['00000000-0000-0000-0000-000000770012','00000000-0000-0000-0000-000000770022']/" db/ops/eq-freeze-2c-late.sql`
\set late_one `sed -e 's/b8fbdf08-c24d-4df2-97de-da206c0a8dc3/00000000-0000-0000-0000-000000770012/' db/ops/eq-freeze-2c-late.sql`
\set late_none `sed -e 's/b8fbdf08-c24d-4df2-97de-da206c0a8dc3/00000000-0000-0000-0000-000000779999/' db/ops/eq-freeze-2c-late.sql`
\set verify `sed -e '/^[[:space:]]*--/d' -e 's/;[[:space:]]*$//' db/ops/verify-eq-freeze-2c-late.sql`
\set rollback `cat db/ops/rollback-eq-freeze-2c-late.sql`
begin;
create extension if not exists pgtap;
select plan(26);

create or replace function u(n int) returns uuid language sql immutable as $$ select ('00000000-0000-0000-0000-00000077' || lpad(n::text, 4, '0'))::uuid $$;
create or replace function pu(n int) returns uuid language sql immutable as $$ select ('00000000-0000-0000-0000-0000007723' || lpad(n::text, 2, '0'))::uuid $$;
insert into clubs (id, name) values ('00000000-0000-0000-0000-0000007721c1', 'Клуб');
insert into players (id, club_id, full_name, status)
  select pu(n), '00000000-0000-0000-0000-0000007721c1', 'Игрок ' || n, 'active' from generate_series(1, 4) n;
insert into equipment_catalog (club_id, kit, price, valid_from) values
  ('00000000-0000-0000-0000-0000007721c1', 'Игровая форма', 150, '2026-09-01'),
  ('00000000-0000-0000-0000-0000007721c1', 'Тренировочная форма', 150, '2026-09-01'),
  ('00000000-0000-0000-0000-0000007721c1', 'Спортивный костюм', 210, '2026-09-01'),
  ('00000000-0000-0000-0000-0000007721c1', 'Дождевик', 110, '2026-09-01');
create or replace function mk(oid uuid, pid uuid, od date, inst boolean, adj numeric, items jsonb) returns void
language plpgsql security definer set search_path = public as $$
declare i jsonb;
begin
  insert into equipment_orders (id, club_id, player_id, ordered_on, installment, total, paid, created_at)
  values (oid, (select club_id from players where id = pid), pid, od, inst, 0, 0, od::timestamp at time zone 'Asia/Tbilisi');
  for i in select * from jsonb_array_elements(items) loop
    insert into equipment_order_lines (order_id, kit, size, quantity, unit_price) values (oid, i->>'kit', 'M', 1, (i->>'price')::numeric);
  end loop;
  update equipment_orders set total = eq_order_lines_sum(oid) + adj where id = oid;
end $$;
create or replace function lb(oid uuid) returns uuid language sql stable as $$ select legacy_bundle_id from equipment_orders where id = oid $$;

-- Состояние после 2c: отметка уже стоит (миграция на пустой базе её поставила), расчётов нет.
select ok(exists (select 1 from equipment_bundle_steps where step = 'freeze_2c'), 'Л0: отметка freeze_2c стоит');
select is((select count(*)::int from equipment_bundle_runs) + (select count(*)::int from equipment_bundles), 0, 'Л0: расчётов после 2c нет');

-- Данные. P1: полный комплект 620 -> 525, замыкающий u12 (скидка 95 в итоге), участник u11. P2: то же, но замыкающий в рассрочку (отказ уже стоит). P3: заказ без скидки.
select mk(u(11), pu(1), '2026-10-01', false, 0, '[{"kit":"Игровая форма","price":150},{"kit":"Тренировочная форма","price":150}]');
select mk(u(12), pu(1), '2026-10-05', false, -95, '[{"kit":"Спортивный костюм","price":210},{"kit":"Дождевик","price":110}]');
select mk(u(21), pu(2), '2026-10-01', false, 0, '[{"kit":"Игровая форма","price":150},{"kit":"Тренировочная форма","price":150}]');
select mk(u(22), pu(2), '2026-10-05', true, -95, '[{"kit":"Спортивный костюм","price":210},{"kit":"Дождевик","price":110}]');
select mk(u(31), pu(3), '2026-10-02', false, 0, '[{"kit":"Игровая форма","price":150}]');
select set_config('eq.op', 'forfeit_2c', true);
update equipment_orders set discount_forfeited = true where installment;
select set_config('eq.op', '', true);
create temp table snap0 as select eq_freeze_2c_fp() as fp, (select count(*) from equipment_orders) as n;

-- Л1: набор кандидатов не равен ожидаемому (кандидаты u12 и u22, ожидается только u12): остановка, ничего не меняется
select throws_ok(:'late_one', '55000', null, 'Л1: набор кандидатов отличается от списка expect_ids: остановка');
-- Л2: ожидаемый набор верный, но замыкающий заказ в рассрочке (P2): остановка целиком, P1 тоже не заморожен
select throws_ok(:'late_two', '55000', null, 'Л2: заказ в рассрочку не замораживается: остановка целиком');
select is((select count(*)::int from equipment_orders where legacy_bundle_id is not null), 0, 'Л2: после остановки ни один заказ не заморожен');
-- Л3: нет отметки freeze_2c: остановка
alter table equipment_bundle_steps disable trigger equipment_bundle_steps_guard;
delete from equipment_bundle_steps where step = 'freeze_2c';
alter table equipment_bundle_steps enable trigger equipment_bundle_steps_guard;
select throws_ok(:'late_one', '55000', null, 'Л3: без отметки freeze_2c скрипт не работает');
insert into equipment_bundle_steps (step, note) values ('freeze_2c', 'test');
-- Л4: расчёты уже были (запись запуска): остановка
insert into equipment_bundle_runs (player_id, mode, trigger_reason, input, output) values (pu(3), 'manual', 'test', '{}'::jsonb, '{}'::jsonb);
select throws_ok(:'late_one', '55000', null, 'Л4: после запуска расчёта скрипт не работает');
alter table equipment_bundle_runs disable trigger user;
delete from equipment_bundle_runs;
alter table equipment_bundle_runs enable trigger user;

-- P2 перестаёт быть кандидатом (скидка снята ручной правкой итога)
update equipment_orders set total = total + 95 where id = u(22);
select is((select manual_adjustment from equipment_orders where id = u(22)), 0::numeric, 'Л5: подготовка: у u22 корректировка снята');
create temp table snap1 as select eq_freeze_2c_fp() as fp;

-- Л6: ожидается пустой набор, а кандидат есть: остановка
select throws_ok(:'late_none', '55000', null, 'Л6: ожидалась другая заказ-цель: остановка');

-- Л6б: до заморозки самопроверка 0208 увидела бы активную скидку у P1 (миграция остановилась бы)
select is((eq_bundle_run(pu(1), 'manual', false, 'check'))->>'state', 'active', 'Л6б: до заморозки у P1 расчёт даёт активную скидку (0208 остановилась бы)');
-- Л7: основной запуск
select lives_ok(:'late_one', 'Л7: скрипт заморозки отработал');
select ok(lb(u(12)) is not null, 'Л7: замыкающий заказ заморожен');
select is(lb(u(11)), lb(u(12)), 'Л7: участник комплекта заморожен в той же записи');
select is((select count(*)::int from equipment_orders where legacy_bundle_id is not null), 2, 'Л7: заморожены ровно два заказа P1');
select is((select kind from equipment_legacy_bundles where id = lb(u(12))), 'confirmed', 'Л7: запись комплекта confirmed');
select is((select reason like '%(позднее окно 2c, db/ops)%' and created_by is null from equipment_legacy_bundles where id = lb(u(12))), true, 'Л7: пометка позднего окна');
select isnt((eq_bundle_run(pu(1), 'manual', false, 'check'))->>'state', 'active', 'Л8: после заморозки расчёт не даёт активной скидки (самопроверка 0208 проходит)');
select is(eq_freeze_2c_fp(), (select fp from snap1), 'Л8: отпечатки заказов, строк и журнала не изменились');
select is((select count(*)::int from equipment_orders where total <> eq_order_lines_sum(id) + manual_adjustment + bundle_adjustment or bundle_adjustment <> 0), 0, 'Л8: итог = строки + корректировки, скидки комплекта нет');
select is((select total from equipment_orders where id = u(12)), 225::numeric, 'Л8: итог замыкающего заказа прежний (320 − 95)');
-- Л9: повторный запуск безопасен: кандидатов больше нет
select throws_ok(:'late_one', '55000', null, 'Л9: повторный запуск останавливается (кандидатов нет), ничего не меняет');
select is((select count(*)::int from equipment_legacy_bundles), 1, 'Л9: записей комплекта по-прежнему одна');
-- Проверочный запрос
create temp table v as :verify;
select is((select unfrozen_with_discount::int from v), 0, 'Л9: verify: незамороженных заказов со скидкой нет');
select is((select late_bundles::int from v), 1, 'Л9: verify: одна запись позднего окна');
-- Откат
select lives_ok(:'rollback', 'Л9: откат отработал');
select is((select count(*)::int from equipment_orders where legacy_bundle_id is not null) + (select count(*)::int from equipment_legacy_bundles), 0, 'Л9: после отката заморозки и записей комплекта нет');

select * from finish();
rollback;
