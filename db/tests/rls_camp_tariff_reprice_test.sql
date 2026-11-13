-- pgTAP: пересчёт записанных при смене цены тарифа (0182). Условия: docs/CAMP_TARIFF_REPRICE_ACCEPTANCE.md (1-14).
begin;
create extension if not exists pgtap;
select plan(30);

insert into clubs (id, name) values ('00000000-0000-0000-0000-00000000c001', 'Клуб');
insert into users (id, telegram_id, display_name, is_admin) values
  ('00000000-0000-0000-0000-0000000000a1', 9401, 'Админ', true),
  ('00000000-0000-0000-0000-0000000000b1', 9402, 'Родитель', false);
insert into players (id, club_id, full_name, status)
  select ('00000000-0000-0000-0000-00000000d00' || i)::uuid, '00000000-0000-0000-0000-00000000c001', 'Игрок ' || i, 'active' from generate_series(1, 8) i;

create or replace function as_user(uid uuid) returns void language plpgsql as $$
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
end $$;
create temp table ids (k text primary key, id uuid);
grant all on ids to authenticated;
create or replace function pid(n int) returns uuid language sql stable as $$ select id from ids where k = 'p' || n $$;
grant execute on function pid(int) to authenticated;

select as_user('00000000-0000-0000-0000-0000000000a1');
insert into ids select 'camp', camp_save(null, 'Лагерь', 'Бакуриани', '2027-01-02', '2027-01-09', 100, null, null, true);
insert into ids select 'camp2', camp_save(null, 'Другой лагерь', 'Уреки', '2027-02-02', '2027-02-09', 100, null, null, true);
select camp_tariff_save((select id from ids where k = 'camp'), 'Футболист', 1500, true);
select camp_tariff_save((select id from ids where k = 'camp'), 'Семья', 3500, true);
select camp_tariff_save((select id from ids where k = 'camp2'), 'Футболист', 1500, true);
insert into ids select 'tf', id from camp_tariffs where camp_id = (select id from ids where k = 'camp') and name = 'Футболист';
insert into ids select 'ts', id from camp_tariffs where camp_id = (select id from ids where k = 'camp') and name = 'Семья';
insert into ids select 'tf2', id from camp_tariffs where camp_id = (select id from ids where k = 'camp2') and name = 'Футболист';
-- p1: 1500 не платил; p2: 1500 внёс 500; p3: 1500 внёс 1400 (переплата при цене 1350); p4: скидка 1200;
-- p5: отменён 1500; p6: другой тариф 3500; p7: тот же тариф в другом сборе 1500; p8: отказ 1500
insert into ids select 'p1', camp_register((select id from ids where k = 'camp'), '00000000-0000-0000-0000-00000000d001', (select id from ids where k = 'tf'), 1500, null, null);
insert into ids select 'p2', camp_register((select id from ids where k = 'camp'), '00000000-0000-0000-0000-00000000d002', (select id from ids where k = 'tf'), 1500, null, null);
insert into ids select 'p3', camp_register((select id from ids where k = 'camp'), '00000000-0000-0000-0000-00000000d003', (select id from ids where k = 'tf'), 1500, null, null);
insert into ids select 'p4', camp_register((select id from ids where k = 'camp'), '00000000-0000-0000-0000-00000000d004', (select id from ids where k = 'tf'), 1200, null, null);
insert into ids select 'p5', camp_register((select id from ids where k = 'camp'), '00000000-0000-0000-0000-00000000d005', (select id from ids where k = 'tf'), 1500, null, null);
insert into ids select 'p6', camp_register((select id from ids where k = 'camp'), '00000000-0000-0000-0000-00000000d006', (select id from ids where k = 'ts'), 3500, null, null);
insert into ids select 'p7', camp_register((select id from ids where k = 'camp2'), '00000000-0000-0000-0000-00000000d007', (select id from ids where k = 'tf2'), 1500, null, null);
insert into ids select 'p8', camp_register((select id from ids where k = 'camp'), '00000000-0000-0000-0000-00000000d008', (select id from ids where k = 'tf'), 1500, null, null);
select camp_pay(pid(2), 500, 'payment', '2026-11-01', 'Наличные', null);
select camp_pay(pid(3), 1400, 'payment', '2026-11-01', 'Наличные', null);
reset role;
update camp_participants set status = 'cancelled' where id = pid(5);
select as_user('00000000-0000-0000-0000-0000000000a1');
select camp_update_participant(pid(8), null, 1500, null, null, 'declined');

reset role;
create temp table snap as select (select count(*) from camp_payments) pay_n, (select coalesce(sum(amount), 0) from camp_payments) pay_sum, (select count(*) from notifications) notif_n;
grant all on snap to authenticated;
select as_user('00000000-0000-0000-0000-0000000000a1');

-- ПРЕДПРОСМОТР (11): считает, ничего не меняет
select is(camp_tariff_reprice_preview((select id from ids where k = 'camp'), 'Футболист', 1350),
  '{"old_price": 1500, "new_price": 1350, "updated": 2, "overpaid": 1, "manual": 1}'::jsonb, 'предпросмотр: 2 пересчитать, 1 переплата, 1 ручная');
select is((select amount from camp_participants where id = pid(1)), 1500::numeric, 'предпросмотр ничего не меняет');
select is((select price from camp_tariffs where id = (select id from ids where k = 'tf')), 1500::numeric, 'предпросмотр не меняет цену тарифа');
select is(camp_tariff_reprice_preview((select id from ids where k = 'camp'), 'Футболист', 1500),
  '{"old_price": 1500, "new_price": 1500, "updated": 0, "overpaid": 0, "manual": 0}'::jsonb, 'предпросмотр с той же ценой: нули');
select is(camp_tariff_reprice_preview((select id from ids where k = 'camp'), 'Нет такого', 900),
  '{"old_price": 900, "new_price": 900, "updated": 0, "overpaid": 0, "manual": 0}'::jsonb, 'предпросмотр несуществующего тарифа: нули');

-- СОХРАНЕНИЕ (1-7)
select is(camp_tariff_save((select id from ids where k = 'camp'), '  Футболист ', 1350, true),
  '{"old_price": 1500, "new_price": 1350, "updated": 2, "overpaid": 1, "manual": 1}'::jsonb, 'сохранение возвращает итог (название с пробелами по краям)');
select is((select price from camp_tariffs where id = (select id from ids where k = 'tf')), 1350::numeric, 'цена тарифа сменилась');
select is((select amount from camp_participants where id = pid(1)), 1350::numeric, 'без оплат: сумма стала новой ценой');
select is((select amount from camp_participants where id = pid(2)), 1350::numeric, 'внесено 500: сумма стала новой ценой');
select is((select amount from camp_participants where id = pid(3)), 1500::numeric, 'внесено 1400 больше 1350: сумма не тронута');
select is((select amount from camp_participants where id = pid(4)), 1200::numeric, 'ручная сумма (скидка) не тронута');
select is((select amount from camp_participants where id = pid(5)), 1500::numeric, 'отменённая запись не тронута');
select is((select amount from camp_participants where id = pid(8)), 1500::numeric, 'запись с отказом не тронута');
select is((select amount from camp_participants where id = pid(6)), 3500::numeric, 'другой тариф того же сбора не тронут');
select is((select amount from camp_participants where id = pid(7)), 1500::numeric, 'тот же тариф в другом сборе не тронут');
select is((select count(*) from camp_payments)::int, (select pay_n from snap)::int, 'число платежей не изменилось');
select is((select coalesce(sum(amount), 0) from camp_payments), (select pay_sum from snap), 'сумма платежей не изменилась');
select is((select count(*) from camp_participant_events where participant_id = pid(1) and amount = 1350 and actor_id = '00000000-0000-0000-0000-0000000000a1')::int, 1, 'пересчёт записан в журнал, автор — администратор');
reset role;
select is((select count(*) from notifications)::int, (select notif_n from snap)::int, 'уведомлений пересчёт не создал (14)');
select as_user('00000000-0000-0000-0000-0000000000a1');

-- ПОВТОР и симметрия (9, 10)
select is(camp_tariff_save((select id from ids where k = 'camp'), 'Футболист', 1350, true),
  '{"old_price": 1350, "new_price": 1350, "updated": 0, "overpaid": 0, "manual": 0}'::jsonb, 'повторное сохранение той же цены: ничего не меняет');
select is((select amount from camp_participants where id = pid(1)), 1350::numeric, 'сумма после повтора прежняя');
select is(camp_tariff_save((select id from ids where k = 'camp'), 'Футболист', 1600, true),
  '{"old_price": 1350, "new_price": 1600, "updated": 2, "overpaid": 0, "manual": 2}'::jsonb, 'цена вверх: 2 записи пересчитаны, 3 и 4 — ручные');
select is((select amount from camp_participants where id = pid(2)), 1600::numeric, 'цена вверх: сумма выросла');

-- Только активность (1, 17): цена та же, счётчики 0
select is(camp_tariff_save((select id from ids where k = 'camp'), 'Футболист', 1600, false),
  '{"old_price": 1600, "new_price": 1600, "updated": 0, "overpaid": 0, "manual": 0}'::jsonb, 'смена только активности: нули');
-- Новый тариф (1)
select is(camp_tariff_save((select id from ids where k = 'camp'), 'Новый', 700, true),
  '{"old_price": 700, "new_price": 700, "updated": 0, "overpaid": 0, "manual": 0}'::jsonb, 'новый тариф: нули');

-- Ошибки (13) и атомарность (8)
select throws_ok($$select camp_tariff_save((select id from ids where k = 'camp'), 'Футболист', -5, true)$$, '22023', 'bad amount', 'отрицательная цена отклоняется');
select is((select price from camp_tariffs where id = (select id from ids where k = 'tf')), 1600::numeric, 'после ошибки цена прежняя');

-- Права (12)
select as_user('00000000-0000-0000-0000-0000000000b1');
select throws_ok($$select camp_tariff_save((select id from ids where k = 'camp'), 'Футболист', 1000, true)$$, '42501', 'forbidden', 'родитель не меняет тарифы');
select throws_ok($$select camp_tariff_reprice_preview((select id from ids where k = 'camp'), 'Футболист', 1000)$$, '42501', 'forbidden', 'родитель не видит предпросмотр');
select as_user('00000000-0000-0000-0000-0000000000a1');
select ok(not has_function_privilege('anon', 'camp_tariff_save(uuid,text,numeric,boolean)', 'execute') and not has_function_privilege('anon', 'camp_tariff_reprice_preview(uuid,text,numeric)', 'execute'), 'anon не может вызвать обе функции');

select * from finish();
rollback;
