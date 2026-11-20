-- pgTAP: идемпотентная запись платежей абонемента (#724, миграция 0214, docs/acceptance/payment-idempotency-724-2026-11-20.md).
-- Условия 1-10 проверяются здесь; параллельные запросы (п. 4) проверяет db/tests/concurrency_payment_add.sh.
-- Права проверяются на базе с привилегиями по умолчанию Supabase: функция пересоздаётся после alter default privileges.
begin;
create extension if not exists pgtap;
select plan(38);

alter default privileges in schema public grant select, insert, update, delete on tables to anon, authenticated, service_role;
alter default privileges in schema public grant execute on functions to anon, authenticated, service_role;
drop function if exists payment_add(uuid, uuid, numeric, date, text, date);
\i db/migrations/0214_payment_idempotency.sql

insert into clubs (id, name) values ('00000000-0000-0000-0000-00000000c001', 'Клуб');
insert into users (id, telegram_id, display_name, is_admin) values
  ('00000000-0000-0000-0000-0000000000a1', 7241, 'Админ', true),
  ('00000000-0000-0000-0000-0000000000a2', 7242, 'Админ 2', true),
  ('00000000-0000-0000-0000-0000000000b1', 7243, 'Родитель', false),
  ('00000000-0000-0000-0000-0000000000c1', 7244, 'Тренер', false);
insert into groups (id, club_id, name) values ('00000000-0000-0000-0000-0000000000e1', '00000000-0000-0000-0000-00000000c001', 'U9-A');
insert into players (id, club_id, group_id, full_name) values
  ('00000000-0000-0000-0000-00000000d001', '00000000-0000-0000-0000-00000000c001', '00000000-0000-0000-0000-0000000000e1', 'Аня'),
  ('00000000-0000-0000-0000-00000000d002', '00000000-0000-0000-0000-00000000c001', '00000000-0000-0000-0000-0000000000e1', 'Борис');
insert into player_guardians (player_id, user_id, consent_version, consent_given_at) values ('00000000-0000-0000-0000-00000000d001', '00000000-0000-0000-0000-0000000000b1', 'v1', now());
insert into prices (club_id, group_id, kind, amount, valid_from) values ('00000000-0000-0000-0000-00000000c001', null, 'subscription', 165, '2026-09-01');

-- старая строка без ключа (до 0214 все такие): остаётся как есть
insert into payments (id, player_id, amount, paid_on, method) values
  ('00000000-0000-0000-0000-0000000000f0', '00000000-0000-0000-0000-00000000d001', 100, '2026-10-05', 'Наличные');

create or replace function as_user(uid uuid) returns void language plpgsql as $$
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
end $$;

select is((select request_id from payments where id = '00000000-0000-0000-0000-0000000000f0'), null::uuid, 'старая строка без ключа: request_id = null');
select has_column('payments', 'request_id', 'в payments есть request_id');
select ok(has_function_privilege('authenticated', 'payment_add(uuid,uuid,numeric,date,text,date)', 'execute'), 'authenticated выполняет payment_add (привилегии Supabase по умолчанию)');
select ok(not has_function_privilege('anon', 'payment_add(uuid,uuid,numeric,date,text,date)', 'execute'), 'anon не выполняет payment_add при привилегиях Supabase по умолчанию');

select as_user('00000000-0000-0000-0000-0000000000a1');

-- 1. обычная запись
select is((payment_add('00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-00000000d001', 165, '2026-10-22', 'Перевод', '2026-11-01')->>'duplicate')::boolean, false, '1: новый ключ: duplicate = false');
select is((select count(*)::int from payments where request_id = '00000000-0000-0000-0000-000000000001'), 1, '1: создана одна строка');
select results_eq($$select player_id, amount, paid_on, for_month, method, pay_month, recorded_by from payments where request_id = '00000000-0000-0000-0000-000000000001'$$,
  $$values ('00000000-0000-0000-0000-00000000d001'::uuid, 165.00::numeric, '2026-10-22'::date, '2026-11-01'::date, 'Перевод'::text, '2026-11-01'::date, '00000000-0000-0000-0000-0000000000a1'::uuid)$$,
  '1: поля как у прямого INSERT, автор из сессии, pay_month от for_month');
select isnt((select recorded_at from payments where request_id = '00000000-0000-0000-0000-000000000001'), null::timestamptz, '1: время записи проставлено');

-- 2. повтор того же запроса; 3. потерянный ответ (ответ первого вызова клиент не видел)
select is((payment_add('00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-00000000d001', 165, '2026-10-22', 'Перевод', '2026-11-01')->>'duplicate')::boolean, true, '2-3: повтор того же запроса: duplicate = true, без ошибки');
select is((payment_add('00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-00000000d001', 165, '2026-10-22', 'Перевод', '2026-11-01')->>'id')::uuid,
  (select id from payments where request_id = '00000000-0000-0000-0000-000000000001'), '2-3: повтор возвращает id первой строки');
select is((select count(*)::int from payments where request_id = '00000000-0000-0000-0000-000000000001'), 1, '2-3: после повторов строка одна');
select is((select sum(amount) from payments where player_id = '00000000-0000-0000-0000-00000000d001' and pay_month = '2026-11-01'), 165.00::numeric, '2-3: в ноябрь засчитано 165, а не 330');

-- 5. тот же ключ с другим содержимым
select throws_ok($$select payment_add('00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-00000000d001', 166, '2026-10-22', 'Перевод', '2026-11-01')$$, '22023', 'request id reused', '5: другая сумма');
select throws_ok($$select payment_add('00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-00000000d002', 165, '2026-10-22', 'Перевод', '2026-11-01')$$, '22023', 'request id reused', '5: другой игрок');
select throws_ok($$select payment_add('00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-00000000d001', 165, '2026-10-23', 'Перевод', '2026-11-01')$$, '22023', 'request id reused', '5: другая дата');
select throws_ok($$select payment_add('00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-00000000d001', 165, '2026-10-22', 'Перевод', '2026-12-01')$$, '22023', 'request id reused', '5: другой месяц');
select throws_ok($$select payment_add('00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-00000000d001', 165, '2026-10-22', 'Наличные', '2026-11-01')$$, '22023', 'request id reused', '5: другой способ');
select throws_ok($$select payment_add('00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-00000000d001', 165, '2026-10-22', 'Перевод', null)$$, '22023', 'request id reused', '5: for_month отсутствует, а был задан');
select is((select count(*)::int from payments where player_id in ('00000000-0000-0000-0000-00000000d001', '00000000-0000-0000-0000-00000000d002') and request_id is not null), 1, '5: отказы не добавили строк');
select results_eq($$select amount, paid_on, method from payments where request_id = '00000000-0000-0000-0000-000000000001'$$,
  $$values (165.00::numeric, '2026-10-22'::date, 'Перевод'::text)$$, '5: исходная строка не изменилась');

-- 6. два одинаковых платежа с разными ключами записываются оба
select payment_add('00000000-0000-0000-0000-000000000011', '00000000-0000-0000-0000-00000000d002', 50, '2026-10-10', 'Наличные', null);
select payment_add('00000000-0000-0000-0000-000000000012', '00000000-0000-0000-0000-00000000d002', 50, '2026-10-10', 'Наличные', null);
select is((select count(*)::int from payments where player_id = '00000000-0000-0000-0000-00000000d002' and amount = 50), 2, '6: разные ключи: два одинаковых платежа записаны');
select is((select pay_month from payments where request_id = '00000000-0000-0000-0000-000000000011'), '2026-10-01'::date, '6: без for_month месяц берётся из даты');

-- исправление с минусом допустимо; ключ работает и для него
select is((payment_add('00000000-0000-0000-0000-000000000013', '00000000-0000-0000-0000-00000000d002', -50, '2026-10-11', 'Исправление', null)->>'duplicate')::boolean, false, 'исправление с минусом записывается');
select is((payment_add('00000000-0000-0000-0000-000000000013', '00000000-0000-0000-0000-00000000d002', -50, '2026-10-11', 'Исправление', null)->>'duplicate')::boolean, true, 'повтор исправления не создаёт вторую запись');

-- 10. ключ и сумма обязательны; месяц только первое число (проверка таблицы)
select throws_ok($$select payment_add(null, '00000000-0000-0000-0000-00000000d001', 10, '2026-10-10', 'Наличные', null)$$, '22023', 'request id required', '10: ключ обязателен');
select throws_ok($$select payment_add('00000000-0000-0000-0000-000000000021', '00000000-0000-0000-0000-00000000d001', 0, '2026-10-10', 'Наличные', null)$$, '22023', 'bad amount', 'ноль отклоняется');
select throws_ok($$select payment_add('00000000-0000-0000-0000-000000000022', '00000000-0000-0000-0000-00000000d001', null, '2026-10-10', 'Наличные', null)$$, '22023', 'bad amount', 'null отклоняется');
select throws_ok($$select payment_add('00000000-0000-0000-0000-000000000023', '00000000-0000-0000-0000-00000000d001', 10, null, 'Наличные', null)$$, '22023', 'bad date', 'дата обязательна');
select throws_ok($$select payment_add('00000000-0000-0000-0000-000000000024', '00000000-0000-0000-0000-00000000d001', 10, '2026-10-10', 'Наличные', '2026-11-15')$$, '23514', null, 'for_month только первое число месяца (как в таблице)');
select is((select count(*)::int from payments where request_id in ('00000000-0000-0000-0000-000000000021', '00000000-0000-0000-0000-000000000022', '00000000-0000-0000-0000-000000000023', '00000000-0000-0000-0000-000000000024')), 0, 'отклонённые вызовы строк не создали (ключ не «сгорел»)');

-- прямой INSERT администратора работает как раньше и без ключа
select lives_ok($$insert into payments (player_id, amount, paid_on, method) values ('00000000-0000-0000-0000-00000000d001', 10, '2026-10-12', 'Наличные'), ('00000000-0000-0000-0000-00000000d001', 10, '2026-10-12', 'Наличные')$$, 'прямой INSERT без ключа по-прежнему допустим (две одинаковые строки)');

-- 7. ключ принадлежит автору: другой администратор с тем же ключом получает свою строку
select as_user('00000000-0000-0000-0000-0000000000a2');
select is((payment_add('00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-00000000d002', 10, '2026-10-12', 'Наличные', null)->>'duplicate')::boolean, false, '7: другой автор с тем же ключом: новая строка');
select is((select count(*)::int from payments where request_id = '00000000-0000-0000-0000-000000000001'), 2, '7: две строки с одним ключом у разных авторов');

-- 8. права
reset role;
select as_user('00000000-0000-0000-0000-0000000000b1');
select throws_ok($$select payment_add('00000000-0000-0000-0000-000000000031', '00000000-0000-0000-0000-00000000d001', 10, '2026-10-12', 'Наличные', null)$$, '42501', null, '8: родитель платёж записать не может');
reset role;
select as_user('00000000-0000-0000-0000-0000000000c1');
select throws_ok($$select payment_add('00000000-0000-0000-0000-000000000032', '00000000-0000-0000-0000-00000000d001', 10, '2026-10-12', 'Наличные', null)$$, '42501', null, '8: тренер платёж записать не может');
reset role;
set local role anon;
select throws_ok($$select payment_add('00000000-0000-0000-0000-000000000033', '00000000-0000-0000-0000-00000000d001', 10, '2026-10-12', 'Наличные', null)$$, '42501', null, '8: гость функцию не выполняет');
reset role;

-- 9. история: ключ после записи не меняется, строки не удаляются
select throws_ok($$update payments set request_id = gen_random_uuid() where request_id = '00000000-0000-0000-0000-000000000011'$$, 'P0001', 'payment history is immutable', '9: request_id после записи не меняется');
select throws_ok($$delete from payments where request_id = '00000000-0000-0000-0000-000000000011'$$, 'P0001', 'payment history is immutable', '9: DELETE по-прежнему запрещён');

select * from finish();
rollback;
