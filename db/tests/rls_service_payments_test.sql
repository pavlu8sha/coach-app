-- pgTAP: журнал оплат экипировки, индивидуальных и доп. занятий (0083) и их попадание в кассовый отчёт (0084).
begin;
create extension if not exists pgtap;
select plan(13);

insert into clubs (id, name) values ('00000000-0000-0000-0000-00000000c001', 'Клуб');
insert into users (id, telegram_id, display_name, is_admin) values
  ('00000000-0000-0000-0000-0000000000a1', 8801, 'Гил', true),
  ('00000000-0000-0000-0000-0000000000c1', 8802, 'Тренер', false);
insert into players (id, club_id, full_name, status) values
  ('00000000-0000-0000-0000-00000000d001', '00000000-0000-0000-0000-00000000c001', 'Аня', 'active'),
  ('00000000-0000-0000-0000-00000000d002', '00000000-0000-0000-0000-00000000c001', 'Боря', 'active');
insert into equipment_catalog (club_id, kit, price, valid_from) values ('00000000-0000-0000-0000-00000000c001', 'Форма', 300, '2026-09-01');

create or replace function as_user(uid uuid) returns void language plpgsql as $$
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
end $$;
create temp table ids (k text, id uuid);
grant all on ids to authenticated;

select as_user('00000000-0000-0000-0000-0000000000a1');
insert into ids select 'eq', eq_create_order('00000000-0000-0000-0000-00000000d001', '[{"kit":"Форма"}]'::jsonb, null, '7', false, 'Исани', 300);
insert into ids select 'ind', ind_create_session('2026-11-07', '12:00', false, 'Дриблинг');
select ind_add_player((select id from ids where k = 'ind'), '00000000-0000-0000-0000-00000000d002');
insert into ids select 'ex', extra_create_session('2026-11-08', 25, 'Исани');
select extra_add_player((select id from ids where k = 'ex'), '00000000-0000-0000-0000-00000000d001');

-- экипировка: оплата 100 наличными — строка журнала с автором и датой
select eq_add_payment((select id from ids where k = 'eq'), 100, '2026-11-03', 'Наличные');
select is(
  (select count(*)::int from service_payments where kind = 'equipment' and amount = 100 and method = 'Наличные' and paid_on = '2026-11-03' and recorded_by = '00000000-0000-0000-0000-0000000000a1'),
  1, 'оплата экипировки записана с датой, способом и автором');

-- без способа оплата не принимается
select throws_ok($$select eq_add_payment((select id from ids where k = 'eq'), 50, '2026-11-03', null)$$, '22023', 'bad method', 'оплата без способа отклоняется');

-- возврат суммой минус — строка с минусом
select eq_add_payment((select id from ids where k = 'eq'), -100, '2026-11-04', 'Наличные');
select is(
  (select count(*)::int from service_payments where kind = 'equipment' and amount = -100 and paid_on = '2026-11-04'),
  1, 'исправление экипировки — строка с минусом');

-- индивидуальное: оплата записи пишет строку на сумму записи
select ind_set_paid((select id from ids where k = 'ind'), '00000000-0000-0000-0000-00000000d002', true, 'Перевод', '2026-11-07');
select is(
  (select count(*)::int from service_payments sp join individual_bookings b on b.session_id = sp.ref_id and b.player_id = sp.player_id
    where sp.kind = 'individual' and sp.amount = b.amount and sp.method = 'Перевод' and sp.paid_on = '2026-11-07'),
  1, 'оплата индивидуального пишет строку на сумму записи с способом');

-- повторная отметка оплаты не задваивает журнал
select ind_set_paid((select id from ids where k = 'ind'), '00000000-0000-0000-0000-00000000d002', true, 'Перевод', '2026-11-07');
select is((select count(*)::int from service_payments where kind = 'individual'), 1, 'повторная оплата индивидуального не добавляет строку');

-- отмена индивидуального: минус от исходной оплаты (способ и связь с исходной строкой)
select ind_set_paid((select id from ids where k = 'ind'), '00000000-0000-0000-0000-00000000d002', false, null, '2026-11-08');
select is(
  (select count(*)::int from service_payments neg join service_payments pos on pos.id = neg.cancels
    where neg.kind = 'individual' and neg.amount = -pos.amount and neg.method = 'Перевод' and pos.method = 'Перевод'),
  1, 'отмена индивидуального — минус со способом исходной оплаты, связан с ней');
select ind_set_paid((select id from ids where k = 'ind'), '00000000-0000-0000-0000-00000000d002', false, null, '2026-11-08');
select is((select count(*)::int from service_payments where kind = 'individual'), 2, 'повторная отмена не добавляет вторую строку');

-- доп. занятие: оплата по цене 25 наличными, отмена — минус 25
select extra_set_paid((select id from ids where k = 'ex'), '00000000-0000-0000-0000-00000000d001', true, 'Наличные', null, '2026-11-08');
select is((select count(*)::int from service_payments where kind = 'extra' and amount = 25 and method = 'Наличные'), 1, 'оплата доп. занятия пишет строку по цене');
select extra_set_paid((select id from ids where k = 'ex'), '00000000-0000-0000-0000-00000000d001', false, null, null, '2026-11-09');
select is((select count(*)::int from service_payments where kind = 'extra' and amount = -25 and method = 'Наличные'), 1, 'отмена доп. занятия — минус 25 со способом исходной оплаты');

-- тренер не принимает оплату экипировки
select as_user('00000000-0000-0000-0000-0000000000c1');
select throws_ok($$select eq_add_payment((select id from ids where k = 'eq'), 10, '2026-11-03', 'Наличные')$$, '42501', 'forbidden', 'тренер не принимает оплату');

-- журнал нельзя писать напрямую
select as_user('00000000-0000-0000-0000-0000000000a1');
select throws_ok($$insert into service_payments (kind, ref_id, player_id, amount, paid_on, method) values ('extra', '00000000-0000-0000-0000-000000000000', '00000000-0000-0000-0000-00000000d001', 1, '2026-11-03', 'Наличные')$$,
  '42501', null, 'прямая запись в журнал закрыта');

-- отчёт: строки всех трёх типов с локацией, итог сходится
select is(
  (select count(*)::int from jsonb_array_elements(cash_report('2026-11-01', '2026-11-30')->'rows') x where x->>'kind' in ('Экипировка', 'Индивидуальное', 'Доп. занятие')),
  6, 'отчёт учитывает журнал экипировки, индивидуальных и доп. занятий');
select is(
  (select sum((x->>'amount')::numeric) from jsonb_array_elements(cash_report('2026-11-01', '2026-11-30', 'Исани')->'rows') x where x->>'kind' = 'Экипировка'),
  0::numeric, 'локация заказа попадает в отчёт: возврат сходится с оплатой');

select * from finish();
rollback;
