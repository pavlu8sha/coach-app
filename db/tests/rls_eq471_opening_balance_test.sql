-- pgTAP: #471 PR-2b (0189), перенос исторических остатков оплат экипировки в журнал.
-- Условия: docs/acceptance/eq-471-pr2b-opening-balance-2026-11-13.md (О1–О8).
\set body `cat db/migrations/0189_equipment_opening_balance.sql`
\set rb `cat db/ops/rollback-0189-equipment-opening-balance.sql`
begin;
create extension if not exists pgtap;
select plan(20);

insert into clubs (id, name) values ('00000000-0000-0000-0000-0000004713c1', 'Клуб');
insert into players (id, club_id, full_name, status) values
  ('00000000-0000-0000-0000-0000004713d1', '00000000-0000-0000-0000-0000004713c1', 'Аня', 'active');
insert into equipment_orders (id, club_id, player_id, ordered_on, installment, total, paid, location, created_at) values
  ('00000000-0000-0000-0000-000000471301', '00000000-0000-0000-0000-0000004713c1', '00000000-0000-0000-0000-0000004713d1', '2026-09-01', false, 300, 300, 'Isani', '2026-09-20 10:00+04'),
  ('00000000-0000-0000-0000-000000471302', '00000000-0000-0000-0000-0000004713c1', '00000000-0000-0000-0000-0000004713d1', null, false, 100, 50, 'Isani', '2026-09-15 23:30+04'),
  ('00000000-0000-0000-0000-000000471303', '00000000-0000-0000-0000-0000004713c1', '00000000-0000-0000-0000-0000004713d1', null, false, 100, 70, 'Isani', '2026-09-20 10:00+04'),
  ('00000000-0000-0000-0000-000000471304', '00000000-0000-0000-0000-0000004713c1', '00000000-0000-0000-0000-0000004713d1', '2026-09-02', false, 100, 100, 'Isani', '2026-09-20 10:00+04'),
  ('00000000-0000-0000-0000-000000471305', '00000000-0000-0000-0000-0000004713c1', '00000000-0000-0000-0000-0000004713d1', '2026-09-03', false, 100, 0, 'Isani', '2026-09-20 10:00+04');
-- Журнал истории до 0188: paid и журнал могли расходиться, кэш триггером не пересчитывается.
alter table service_payments disable trigger service_payments_paid_sync;
insert into service_payments (kind, ref_id, player_id, amount, paid_on, method, op) values
  ('equipment', '00000000-0000-0000-0000-000000471301', '00000000-0000-0000-0000-0000004713d1', 100, '2026-09-05', 'Наличные', 'payment'),
  ('equipment', '00000000-0000-0000-0000-000000471303', '00000000-0000-0000-0000-0000004713d1', 20, '2026-09-07', 'Перевод', 'payment'),
  ('equipment', '00000000-0000-0000-0000-000000471304', '00000000-0000-0000-0000-0000004713d1', 100, '2026-09-08', 'Наличные', 'payment');
alter table service_payments enable trigger service_payments_paid_sync;

create temp table before_s as select
  (select sum(paid) from equipment_orders) as paid, (select sum(total) from equipment_orders) as total,
  (select sum(amount) from service_payments where op <> 'opening_balance') as cash;

-- О1–О3, О5: основной запуск
select lives_ok(:'body', 'О5: миграция проходит, самопроверка зелёная');
select is((select count(*)::int from service_payments where op = 'opening_balance'), 3, 'О2: строка только у заказов с дельтой > 0, у равных и нулевых нет (О3)');
select is((select amount from service_payments where op = 'opening_balance' and ref_id = '00000000-0000-0000-0000-000000471301'), 200.00, 'О1: дельта = paid − журнал (300 − 100)');
select is((select paid_on from service_payments where op = 'opening_balance' and ref_id = '00000000-0000-0000-0000-000000471301'), '2026-09-01'::date, 'О2/T9: дата заказа');
select is((select paid_on from service_payments where op = 'opening_balance' and ref_id = '00000000-0000-0000-0000-000000471303'), '2026-09-07'::date, 'О2/T9: без даты заказа берётся первая дата журнала');
select is((select paid_on from service_payments where op = 'opening_balance' and ref_id = '00000000-0000-0000-0000-000000471302'), '2026-09-15'::date, 'О2/T9: иначе дата создания заказа по Тбилиси');
select ok((select bool_and(recorded_by is null and method is null and kind = 'equipment' and note = 'Внесено до начала учёта в приложении') from service_payments where op = 'opening_balance'), 'О2: без автора и способа, подпись');
select is((select count(*)::int from equipment_orders o where o.paid <> coalesce((select sum(amount) from service_payments sp where sp.kind = 'equipment' and sp.ref_id = o.id), 0)), 0, 'О5: у каждого заказа paid = сумма журнала');
select ok((select (select sum(paid) from equipment_orders) = paid and (select sum(total) from equipment_orders) = total from before_s), 'О5: суммы paid и total заказов не изменились');
select is((select sum(amount) from service_payments where op <> 'opening_balance'), (select cash from before_s), 'О5/О8: касса без opening_balance не изменилась');
select is(coalesce(current_setting('eq.backfill_gate', true), ''), '', 'О6: служебный признак не остался');
select lives_ok(:'body', 'О7: повторный запуск проходит');
select is((select count(*)::int from service_payments where op = 'opening_balance'), 3, 'О7: повторный запуск строк не добавляет');
select is((select sum(amount) from service_payments where op = 'opening_balance'), 300.00, 'О1: сумма остатков равна сумме положительных дельт');
-- О4: отрицательная дельта останавливает миграцию, ничего не меняется
insert into equipment_orders (id, club_id, player_id, ordered_on, installment, total, paid) values
  ('00000000-0000-0000-0000-000000471399', '00000000-0000-0000-0000-0000004713c1', '00000000-0000-0000-0000-0000004713d1', '2026-09-04', false, 100, 10);
alter table service_payments disable trigger service_payments_paid_sync;
insert into service_payments (kind, ref_id, player_id, amount, paid_on, op) values
  ('equipment', '00000000-0000-0000-0000-000000471399', '00000000-0000-0000-0000-0000004713d1', 30, '2026-09-04', 'payment');
alter table service_payments enable trigger service_payments_paid_sync;
select throws_like(:'body', '%journal exceeds paid%000000471399 paid=10.00 journal=30.00%', 'О4: журнал больше paid: миграция останавливается со списком заказов');
select is((select count(*)::int from service_payments where op = 'opening_balance'), 3, 'О4: после отказа новых строк opening_balance нет');

-- откат: строки убраны, защита журнала включена, paid не тронут
select lives_ok(:'rb', 'откат 0189 выполняется');
select is((select count(*)::int from service_payments where op = 'opening_balance'), 0, 'откат: строк opening_balance нет');
select is((select count(*)::int from pg_trigger where tgrelid = 'public.service_payments'::regclass and tgname in ('service_payments_history_guard', 'service_payments_history_audit') and tgenabled = 'O'), 2, 'откат: триггеры защиты журнала включены');
select is((select paid from equipment_orders where id = '00000000-0000-0000-0000-000000471301'), 300.00, 'откат: paid заказа не менялся');

select * from finish();
rollback;
