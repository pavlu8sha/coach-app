-- pgTAP: #471 PR-2a (0188), журнал оплат экипировки и защита. Условия: docs/acceptance/eq-471-pr2a-payment-journal-2026-11-13.md (Ж1–Ж10).
begin;
create extension if not exists pgtap;
select plan(57);

insert into clubs (id, name) values ('00000000-0000-0000-0000-0000004721c1', 'Клуб');
insert into users (id, telegram_id, display_name, is_admin) values
  ('00000000-0000-0000-0000-0000004721a1', 947301, 'Админ', true),
  ('00000000-0000-0000-0000-0000004721b1', 947302, 'Гио', false),
  ('00000000-0000-0000-0000-0000004721b2', 947303, 'Родитель', false);
insert into players (id, club_id, full_name, status) values
  ('00000000-0000-0000-0000-0000004721d1', '00000000-0000-0000-0000-0000004721c1', 'Аня', 'active'),
  ('00000000-0000-0000-0000-0000004721d2', '00000000-0000-0000-0000-0000004721c1', 'Боря', 'active');
insert into player_guardians (player_id, user_id, consent_version, consent_given_at) values
  ('00000000-0000-0000-0000-0000004721d1', '00000000-0000-0000-0000-0000004721b2', 'v', now());
insert into location_admins (user_id, location) values ('00000000-0000-0000-0000-0000004721b1', 'Исани');
insert into equipment_catalog (club_id, kit, price, valid_from) values ('00000000-0000-0000-0000-0000004721c1', 'Форма', 300, '2026-09-01');

create or replace function as_user(uid uuid) returns void language plpgsql as $$
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
end $$;
create temp table ids (k text, id uuid);
grant all on ids to authenticated;

-- Ж1: структура
select col_not_null('service_payments', 'op', 'Ж1: op обязательна');
select has_column('service_payments', 'request_id', 'Ж1: request_id');
select has_column('service_payments', 'note', 'Ж1: note');

select as_user('00000000-0000-0000-0000-0000004721a1');
insert into ids select 'o1', eq_create_order('00000000-0000-0000-0000-0000004721d1', '[{"kit":"Форма"}]'::jsonb, null, '7', false, 'Исани', 300);
insert into ids select 'o2', eq_create_order('00000000-0000-0000-0000-0000004721d2', '[{"kit":"Форма"}]'::jsonb, null, '8', false, 'Квартал', 300);

-- Ж4: оплата
select is(eq_add_payment((select id from ids where k = 'o1'), 100, null, 'Наличные'), 100.00::numeric, 'Ж4: оплата 100, paid = 100');
select is((select op || '/' || amount from service_payments where ref_id = (select id from ids where k = 'o1')), 'payment/100.00', 'Ж2: оплата записана как payment');
select throws_ok($$select eq_add_payment((select id from ids where k = 'o1'), -10, null, 'Наличные')$$, '22023', 'use reversal or refund', 'Ж4: отрицательная сумма отклоняется');
select throws_ok($$select eq_add_payment((select id from ids where k = 'o1'), 250, null, 'Наличные')$$, '22023', 'paid above total', 'Ж4: оплата больше итога отклоняется');
select throws_ok($$select eq_add_payment((select id from ids where k = 'o1'), 0, null, 'Наличные')$$, '22023', 'bad amount', 'Ж4: нулевая сумма отклоняется');

-- Ж4: права
select as_user('00000000-0000-0000-0000-0000004721b1');
select lives_ok($$select eq_add_payment((select id from ids where k = 'o1'), 20, null, 'Перевод')$$, 'Ж4: локальный админ принимает оплату своей локации');
select throws_ok($$select eq_add_payment((select id from ids where k = 'o2'), 20, null, 'Перевод')$$, '42501', 'forbidden', 'Ж4: чужая локация недоступна');
select as_user('00000000-0000-0000-0000-0000004721b2');
select throws_ok($$select eq_add_payment((select id from ids where k = 'o1'), 20, null, 'Перевод')$$, '42501', 'forbidden', 'Ж4: родитель не принимает оплату');

-- Ж4: идемпотентность
select as_user('00000000-0000-0000-0000-0000004721a1');
select is(eq_add_payment((select id from ids where k = 'o2'), 50, null, 'Наличные', '00000000-0000-0000-0000-00000047a0a1'), 50.00::numeric, 'Ж4: оплата с ключом');
select is(eq_add_payment((select id from ids where k = 'o2'), 50, null, 'Наличные', '00000000-0000-0000-0000-00000047a0a1'), 50.00::numeric, 'Ж4: повтор с тем же ключом возвращает прежний результат');
select is((select count(*)::int from service_payments where ref_id = (select id from ids where k = 'o2')), 1, 'Ж4: повтор строку не добавляет');
select throws_ok($$select eq_add_payment((select id from ids where k = 'o2'), 60, null, 'Наличные', '00000000-0000-0000-0000-00000047a0a1')$$, '22023', 'request id reused', 'Ж4: тот же ключ с другой суммой отклоняется');
select is((select paid from equipment_orders where id = (select id from ids where k = 'o2')), 50.00::numeric, 'Ж3: paid = 50 после повтора');

-- Ж5: сторно
select as_user('00000000-0000-0000-0000-0000004721b1');
select throws_ok($$select eq_reverse_payment((select id from service_payments where ref_id = (select id from ids where k = 'o1') and amount = 100), 'ошибка', null)$$, '42501', 'forbidden', 'Ж5: локальный админ не сторнирует');
select as_user('00000000-0000-0000-0000-0000004721a1');
select lives_ok($$select eq_reverse_payment((select id from service_payments where ref_id = (select id from ids where k = 'o1') and amount = 100), 'ошибка кассира', null)$$, 'Ж5: админ сторнирует оплату');
select is((select op || '/' || amount || '/' || (cancels is not null) from service_payments where ref_id = (select id from ids where k = 'o1') and op = 'reversal'), 'reversal/-100.00/true', 'Ж5: строка reversal на минус сумму со ссылкой cancels');
select is((select paid from equipment_orders where id = (select id from ids where k = 'o1')), 20.00::numeric, 'Ж3/Ж5: paid уменьшился на сторно (осталась оплата 20)');
select throws_ok($$select eq_reverse_payment((select id from service_payments where ref_id = (select id from ids where k = 'o1') and amount = 100), 'ещё раз', null)$$, '22023', 'already reversed', 'Ж5: вторая отмена той же оплаты отклоняется');
select throws_ok($$select eq_reverse_payment((select id from service_payments where ref_id = (select id from ids where k = 'o1') and op = 'reversal'), 'x', null)$$, '22023', 'not a payment', 'Ж5: сторно сторно нельзя');
select throws_ok($$select eq_reverse_payment((select id from service_payments where ref_id = (select id from ids where k = 'o1') and amount = 20), null, null)$$, '22023', 'note required', 'Ж5: причина обязательна');

-- Ж6: возврат
select as_user('00000000-0000-0000-0000-0000004721b1');
select throws_ok($$select eq_refund((select id from ids where k = 'o1'), 5, null, 'Наличные', 'x', null)$$, '42501', 'forbidden', 'Ж6: локальный админ не делает возврат');
select as_user('00000000-0000-0000-0000-0000004721a1');
select throws_ok($$select eq_refund((select id from ids where k = 'o1'), 5, null, 'Наличные', '  ', null)$$, '22023', 'note required', 'Ж6: причина обязательна');
select throws_ok($$select eq_refund((select id from ids where k = 'o1'), 500, null, 'Наличные', 'много', null)$$, '22023', 'refund above paid', 'Ж6: возврат больше оплаченного отклоняется');
select throws_ok($$select eq_refund((select id from ids where k = 'o1'), -5, null, 'Наличные', 'минус', null)$$, '22023', 'bad amount', 'Ж6: сумма возврата положительная');
select is(eq_refund((select id from ids where k = 'o1'), 5, null, 'Наличные', 'часть вернули', null), 15.00::numeric, 'Ж6: возврат 5, paid = 15');
select is((select op || '/' || amount || '/' || (cancels is null) || '/' || note from service_payments where ref_id = (select id from ids where k = 'o1') and op = 'refund'), 'refund/-5.00/true/часть вернули', 'Ж6: строка refund без cancels с причиной');
select is((select total from equipment_orders where id = (select id from ids where k = 'o1')), 300.00::numeric, 'Ж6: итог не меняется возвратом');
-- возврат после отмены заказа
select eq_cancel_order((select id from ids where k = 'o2'), 'передумали');
select is(eq_refund((select id from ids where k = 'o2'), 50, null, 'Перевод', 'вернули всё', null), 0.00::numeric, 'Ж6: возврат по отменённому заказу');
select throws_ok($$select eq_add_payment((select id from ids where k = 'o2'), 10, null, 'Наличные')$$, '22023', 'order cancelled', 'Ж4: на отменённый заказ оплата не принимается');

-- Ж3: paid и прямая запись
select throws_ok($$update equipment_orders set paid = 1 where id = (select id from ids where k = 'o1')$$, '42501', null, 'Ж9: админ через API не меняет paid (нет права update)');
reset role;
select throws_ok($$update equipment_orders set paid = 1 where id = (select id from ids where k = 'o1')$$, '42501', 'paid is maintained by the journal', 'Ж3: даже владелец не меняет paid без отключения триггера');
select is((select paid from equipment_orders where id = (select id from ids where k = 'o1')), (select sum(amount) from service_payments where ref_id = (select id from ids where k = 'o1')), 'Ж3: инвариант paid = сумма журнала');

-- Ж2: ограничения по видам (вставка владельцем)
select throws_ok($$insert into service_payments (kind, ref_id, player_id, amount, paid_on, op) values ('equipment', (select id from ids where k = 'o1'), '00000000-0000-0000-0000-0000004721d1', -5, current_date, 'payment')$$, '23514', null, 'Ж2: payment с минусом отклоняется');
select throws_ok($$insert into service_payments (kind, ref_id, player_id, amount, paid_on) values ('equipment', (select id from ids where k = 'o1'), '00000000-0000-0000-0000-0000004721d1', -5, current_date)$$, '22023', 'negative payment needs cancels or eq_refund', 'Ж2: минус без cancels вне возврата отклоняется');
select throws_ok($$insert into service_payments (kind, ref_id, player_id, amount, paid_on, op) values ('individual', gen_random_uuid(), '00000000-0000-0000-0000-0000004721d1', -5, current_date, 'refund')$$, '23514', null, 'Ж2: refund только у экипировки');

-- Ж8 (до): отчёты без opening_balance
select as_user('00000000-0000-0000-0000-0000004721a1');
create temp table rep as select cash_report(current_date, current_date)::text as r, cash_day_service(current_date)::text as d;
grant select on rep to authenticated;
reset role;

-- Ж7: opening_balance
select throws_ok($$insert into service_payments (kind, ref_id, player_id, amount, paid_on, op) values ('equipment', (select id from ids where k = 'o1'), '00000000-0000-0000-0000-0000004721d1', 70, current_date, 'opening_balance')$$, '42501', null, 'Ж7 слой 2: без служебного признака opening_balance отклоняется даже у владельца');
select set_config('eq.backfill_gate', 'on', true);
select throws_ok($$insert into service_payments (kind, ref_id, player_id, amount, paid_on, op) values ('individual', gen_random_uuid(), '00000000-0000-0000-0000-0000004721d1', 70, current_date, 'opening_balance')$$, '23514', null, 'Ж7: opening_balance только у экипировки');
select throws_ok($$insert into service_payments (kind, ref_id, player_id, amount, paid_on, op, recorded_by) values ('equipment', (select id from ids where k = 'o1'), '00000000-0000-0000-0000-0000004721d1', 5, current_date, 'opening_balance', '00000000-0000-0000-0000-0000004721a1')$$, '42501', null, 'Ж7: opening_balance без автора');
select lives_ok($$insert into service_payments (kind, ref_id, player_id, amount, paid_on, op) values ('equipment', (select id from ids where k = 'o1'), '00000000-0000-0000-0000-0000004721d1', 70, current_date, 'opening_balance')$$, 'Ж7: со служебным признаком миграции строка создаётся');
select set_config('eq.backfill_gate', 'off', true);
select throws_ok($$insert into service_payments (kind, ref_id, player_id, amount, paid_on, op) values ('equipment', (select id from ids where k = 'o1'), '00000000-0000-0000-0000-0000004721d1', 70, current_date, 'opening_balance')$$, '42501', null, 'Ж7: после миграции признак снят, строка снова отклоняется');
select is((select paid from equipment_orders where id = (select id from ids where k = 'o1')), 15.00::numeric, 'Ж3: opening_balance в кэш paid не добавляется (он уже внутри paid)');
select ok(not has_table_privilege('anon', 'service_payments', 'insert') and not has_table_privilege('authenticated', 'service_payments', 'insert') and not has_table_privilege('service_role', 'service_payments', 'insert'), 'Ж7 слой 1: нет права insert у anon, authenticated и service_role');
select ok(not has_table_privilege('service_role', 'service_payments', 'update') and not has_table_privilege('service_role', 'service_payments', 'delete') and not has_table_privilege('service_role', 'service_payments', 'truncate'), 'Ж7 слой 1: нет update, delete, truncate у service_role');
select is((select count(*)::int from pg_proc p where p.pronamespace = 'public'::regnamespace and p.prosrc ~* 'insert[^;]*opening_balance'), 0, 'Ж7 слой 4: ни одна функция не вставляет opening_balance');
select is((select coalesce(string_agg(p.proname, ',' order by p.proname), '') from pg_proc p where p.pronamespace = 'public'::regnamespace and p.prosrc ilike '%backfill_gate%'), 'service_payments_insert_guard', 'Ж7 слой 4: признак eq.backfill_gate знает только триггер вставки');

-- Ж8 (после): строка opening_balance 70 в отчёты не попала
select as_user('00000000-0000-0000-0000-0000004721a1');
select is(cash_report(current_date, current_date)::text, (select r from rep), 'Ж8: cash_report не изменился от строки opening_balance');
select is(cash_day_service(current_date)::text, (select d from rep), 'Ж8: cash_day_service не изменился от строки opening_balance');
reset role;

-- Ж9: прямая запись закрыта
select as_user('00000000-0000-0000-0000-0000004721a1');
select ok(not has_table_privilege('authenticated', 'equipment_orders', 'update') and not has_table_privilege('authenticated', 'equipment_orders', 'insert') and not has_table_privilege('authenticated', 'equipment_orders', 'delete'), 'Ж9: у authenticated нет записи в equipment_orders');
select ok(not has_table_privilege('authenticated', 'equipment_order_lines', 'insert') and not has_table_privilege('authenticated', 'equipment_issues', 'insert') and not has_table_privilege('authenticated', 'equipment_issues', 'update'), 'Ж9: нет записи в строки и выдачу');
select ok((select count(*) from equipment_orders) >= 2 and (select count(*) from equipment_order_lines) >= 2, 'Ж9: админ по-прежнему читает заказы и строки');
select is((select count(*)::int from equipment_issues), 0, 'Ж9: админ читает выдачу (политика чтения)');

-- Ж10: права функций
select ok(has_function_privilege('authenticated', 'eq_reverse_payment(uuid,text,uuid)', 'execute') and has_function_privilege('authenticated', 'eq_refund(uuid,numeric,date,text,text,uuid)', 'execute'), 'Ж10: authenticated вызывает сторно и возврат');
select ok(not has_function_privilege('anon', 'eq_reverse_payment(uuid,text,uuid)', 'execute') and not has_function_privilege('anon', 'eq_refund(uuid,numeric,date,text,text,uuid)', 'execute') and not has_function_privilege('anon', 'eq_add_payment(uuid,numeric,date,text,uuid)', 'execute'), 'Ж10: anon не вызывает');
select ok(not has_function_privilege('authenticated', 'service_payments_insert_guard()', 'execute') and not has_function_privilege('authenticated', 'eq_paid_sync()', 'execute'), 'Ж10: триггерные функции закрыты');

select * from finish();
rollback;
