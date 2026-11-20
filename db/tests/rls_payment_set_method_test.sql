-- pgTAP: смена способа оплаты абонемента через payment_set_method (миграция 0216). Условия: docs/acceptance/payment-set-method-0216-2026-11-20.md. Фикстуры вымышленные.
begin;
create extension if not exists pgtap;
select plan(20);

insert into clubs (id, name) values ('00000000-0000-0000-0000-00000000c016', 'Клуб');
insert into users (id, telegram_id, display_name, is_admin) values
  ('00000000-0000-0000-0000-0000000016a1', 991601, 'Админ', true),
  ('00000000-0000-0000-0000-0000000016c1', 991602, 'Тренер', false);
insert into groups (id, club_id, name, location) values ('00000000-0000-0000-0000-0000000016e1', '00000000-0000-0000-0000-00000000c016', 'U9-B', 'Чиовани');
insert into players (id, club_id, group_id, full_name, status) values
  ('00000000-0000-0000-0000-00000016d001', '00000000-0000-0000-0000-00000000c016', '00000000-0000-0000-0000-0000000016e1', 'Аня', 'active');
insert into payments (id, player_id, amount, paid_on, for_month, method) values
  ('00000000-0000-0000-0000-0000001600a1', '00000000-0000-0000-0000-00000016d001', 165, '2026-11-20', '2026-12-01', 'Перевод'),
  ('00000000-0000-0000-0000-0000001600a2', '00000000-0000-0000-0000-00000016d001', 100, '2026-11-20', '2026-12-01', 'Перевод'),
  ('00000000-0000-0000-0000-0000001600a3', '00000000-0000-0000-0000-00000016d001', 50, '2026-11-19', '2026-11-01', 'Наличные');
-- а2 отменена записью с минусом
insert into payments (id, player_id, amount, paid_on, for_month, method, cancels) values
  ('00000000-0000-0000-0000-0000001600b2', '00000000-0000-0000-0000-00000016d001', -100, '2026-11-20', '2026-12-01', 'Перевод', '00000000-0000-0000-0000-0000001600a2');

create or replace function as_user(uid uuid) returns void language plpgsql as $$
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
end $$;
create temp table snap (k text primary key, v text);
grant all on snap to authenticated;
insert into snap select 'audit', (select count(*) from audit_log where action = 'payment_correct')::text;

-- У2: прямой UPDATE от администратора по-прежнему закрыт правами таблицы
select as_user('00000000-0000-0000-0000-0000000016a1');
select throws_ok($$update payments set method = 'Наличные' where id = '00000000-0000-0000-0000-0000001600a1'$$, '42501', null, 'У2: прямой UPDATE payments от authenticated запрещён');
reset role;
select is((select method from payments where id = '00000000-0000-0000-0000-0000001600a1'), 'Перевод', 'У2: способ после отклонённого UPDATE не изменился');

-- У1: доступ
select is(has_function_privilege('authenticated', 'public.payment_set_method(uuid,text,text)', 'execute'), true, 'У1: authenticated вызывает функцию');
select is(has_function_privilege('anon', 'public.payment_set_method(uuid,text,text)', 'execute'), false, 'У1: anon не вызывает');
select as_user('00000000-0000-0000-0000-0000000016c1');
select throws_ok($$select payment_set_method('00000000-0000-0000-0000-0000001600a1', 'Наличные', 'Перевод')$$, '42501', 'forbidden', 'У1: тренер получает forbidden');
reset role;
select is((select method from payments where id = '00000000-0000-0000-0000-0000001600a1'), 'Перевод', 'У1: после отказа тренеру способ не изменился');

-- У3: проверки значений и состояния
select as_user('00000000-0000-0000-0000-0000000016a1');
select throws_ok($$select payment_set_method('00000000-0000-0000-0000-0000001600a1', 'Бартер', 'Перевод')$$, '22023', 'bad method', 'У3: недопустимый новый способ');
select throws_ok($$select payment_set_method('00000000-0000-0000-0000-0000001600a1', 'Наличные', 'Исправление')$$, '22023', 'bad method', 'У3: недопустимый прежний способ');
select throws_ok($$select payment_set_method('00000000-0000-0000-0000-0000001600ff', 'Наличные', 'Перевод')$$, 'P0002', 'payment not found', 'У3: платежа нет');
select throws_ok($$select payment_set_method('00000000-0000-0000-0000-0000001600b2', 'Наличные', 'Перевод')$$, '22023', 'not a payment', 'У3: минусовая строка не правится');
select throws_ok($$select payment_set_method('00000000-0000-0000-0000-0000001600a2', 'Наличные', 'Перевод')$$, '22023', 'payment cancelled', 'У3: отменённый платёж не правится');

-- У4: защита от параллельной правки
select throws_ok($$select payment_set_method('00000000-0000-0000-0000-0000001600a1', 'Перевод', 'Наличные')$$, '40001', 'payment changed', 'У4: прежний способ не совпал с текущим');

-- У5/У6/У7: успешная правка
select is((select payment_set_method('00000000-0000-0000-0000-0000001600a1', 'Наличные', 'Перевод')), jsonb_build_object('id', '00000000-0000-0000-0000-0000001600a1'::uuid, 'changed', true), 'У5: ответ changed=true');
reset role;
select is((select method from payments where id = '00000000-0000-0000-0000-0000001600a1'), 'Наличные', 'У5: способ изменился');
select is((select amount::text || '|' || paid_on::text || '|' || for_month::text from payments where id = '00000000-0000-0000-0000-0000001600a1'), '165.00|2026-11-20|2026-12-01', 'У5: сумма, дата и месяц те же');
select is((select count(*) from payments where id <> '00000000-0000-0000-0000-0000001600a1' and method <> case id when '00000000-0000-0000-0000-0000001600a3' then 'Наличные' else 'Перевод' end)::int, 0, 'У5: другие платежи не тронуты');
select is((select count(*) from audit_log where action = 'payment_correct')::int, (select v::int + 1 from snap where k = 'audit'), 'У6: правка записана в audit_log');
select as_user('00000000-0000-0000-0000-0000000016a1');
select is((select payment_set_method('00000000-0000-0000-0000-0000001600a1', 'Наличные', 'Наличные')->>'changed'), 'false', 'У7: повтор на тот же способ ничего не меняет');
reset role;
select is((select count(*) from audit_log where action = 'payment_correct')::int, (select v::int + 1 from snap where k = 'audit'), 'У7: повтор не пишет второй раз в журнал');

-- У6: без триггера журнала функция отказывает, а не правит молча
alter table payments disable trigger payments_history_audit;
select as_user('00000000-0000-0000-0000-0000000016a1');
select throws_ok($$select payment_set_method('00000000-0000-0000-0000-0000001600a3', 'Перевод', 'Наличные')$$, '55000', 'payment history audit not installed', 'У6: без триггера журнала функция отказывает');
reset role;
alter table payments enable trigger payments_history_audit;

select * from finish();
rollback;
