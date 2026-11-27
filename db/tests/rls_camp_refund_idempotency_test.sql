-- pgTAP: идемпотентный возврат за сбор (#721, миграция 0231, docs/acceptance/camp-refund-idempotency-721-2026-11-27.md).
-- Условия 1-4, 6-12 проверяются здесь; параллельные запросы (п. 5, 7) проверяет db/tests/concurrency_camp_refund_idem.sh.
-- Права проверяются на базе с привилегиями по умолчанию Supabase: функция пересоздаётся после alter default privileges.
begin;
create extension if not exists pgtap;
select plan(50);

alter default privileges in schema public grant select, insert, update, delete on tables to anon, authenticated, service_role;
alter default privileges in schema public grant execute on functions to anon, authenticated, service_role;
drop function if exists camp_refund(uuid, numeric, date, text);
drop function if exists camp_refund(uuid, numeric, date, text, uuid);
\i db/migrations/0231_camp_refund_idempotency.sql

insert into clubs (id, name) values ('00000000-0000-0000-0000-00000000c001', 'Клуб');
insert into users (id, telegram_id, display_name, is_admin) values
  ('00000000-0000-0000-0000-0000000000a1', 7211, 'Админ', true),
  ('00000000-0000-0000-0000-0000000000a2', 7212, 'Админ 2', true),
  ('00000000-0000-0000-0000-0000000000b1', 7213, 'Родитель', false),
  ('00000000-0000-0000-0000-0000000000c1', 7214, 'Тренер', false),
  ('00000000-0000-0000-0000-0000000000d1', 7215, 'Локальный админ', false);
insert into location_admins (user_id, location) values ('00000000-0000-0000-0000-0000000000d1', 'Исани');
insert into camps (id, club_id, name, location, starts_on, ends_on) values
  ('00000000-0000-0000-0000-0000000000ca', '00000000-0000-0000-0000-00000000c001', 'Сбор', 'Исани', '2099-01-03', '2099-01-10');
insert into camp_tariffs (id, camp_id, name, price, active) values ('00000000-0000-0000-0000-0000000000e1', '00000000-0000-0000-0000-0000000000ca', 'Тариф', 1000, true);

create or replace function as_user(uid uuid) returns void language plpgsql as $$
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
end $$;
create temp table ids (k text primary key, id uuid);
grant all on ids to public;
create function paid(k text) returns numeric language sql as $$ select coalesce(sum(amount), 0) from camp_payments where participant_id = (select id from ids where k = $1) $$;
create function refunds(k text) returns int language sql as $$ select count(*)::int from camp_payments where kind = 'refund' and participant_id = (select id from ids where k = $1) $$;

select as_user('00000000-0000-0000-0000-0000000000a1');
-- три участника с оплатой 1000: g1, g2, g3
insert into ids select 'g' || i, camp_register_guest('00000000-0000-0000-0000-0000000000ca', 'Гость ' || i, null, '00000000-0000-0000-0000-0000000000e1', null, null, null) from generate_series(1, 3) i;
select camp_pay((select id from ids where k = 'g' || i), 1000, 'payment', current_date, 'Наличные', null) from generate_series(1, 3) i;

select has_column('camp_payments', 'request_id', 'в camp_payments есть request_id');
select ok(has_function_privilege('authenticated', 'camp_refund(uuid,numeric,date,text,uuid)', 'execute'), 'authenticated выполняет camp_refund (привилегии Supabase по умолчанию)');
select ok(not has_function_privilege('anon', 'camp_refund(uuid,numeric,date,text,uuid)', 'execute'), 'anon не выполняет camp_refund при привилегиях Supabase по умолчанию');
select ok((select p.prosecdef and p.proconfig @> array['search_path=public, pg_temp'] from pg_proc p where p.oid = to_regprocedure('public.camp_refund(uuid,numeric,date,text,uuid)')), 'security definer с search_path = public, pg_temp');
select is((select count(*)::int from pg_proc where proname = 'camp_refund' and pronamespace = 'public'::regnamespace), 1, 'перегрузка одна (старая 4-аргументная удалена)');

-- 1. обычный возврат
select is((camp_refund((select id from ids where k = 'g1'), 300, current_date, 'Возврат', '00000000-0000-0000-0000-000000000001')->>'duplicate')::boolean, false, '1: новый ключ: duplicate = false');
select is(refunds('g1'), 1, '1: одна строка возврата');
select results_eq($$select amount, kind, comment, recorded_by, request_id from camp_payments where kind = 'refund' and participant_id = (select id from ids where k = 'g1')$$,
  $$values (-300.00::numeric, 'refund'::text, 'Возврат'::text, '00000000-0000-0000-0000-0000000000a1'::uuid, '00000000-0000-0000-0000-000000000001'::uuid)$$, '1: сумма с минусом, автор из сессии, ключ записан');
select is(paid('g1'), 700.00::numeric, '1: оплачено уменьшилось на 300');

-- 2. 4. повтор того же запроса и потерянный ответ
select is((camp_refund((select id from ids where k = 'g1'), 300, current_date, 'Возврат', '00000000-0000-0000-0000-000000000001')->>'duplicate')::boolean, true, '2: повтор: duplicate = true, без ошибки');
select is((camp_refund((select id from ids where k = 'g1'), 300, current_date, 'Возврат', '00000000-0000-0000-0000-000000000001')->>'id')::uuid,
  (select id from camp_payments where request_id = '00000000-0000-0000-0000-000000000001'), '2: повтор возвращает id первой строки');
select is(refunds('g1'), 1, '2: после повторов строка возврата одна');
select is(paid('g1'), 700.00::numeric, '2: оплачено не уменьшилось второй раз');
-- повтор без даты и с тем же комментарием после смены суток: дата не сравнивается, если не передана
select is((camp_refund((select id from ids where k = 'g1'), 300, null, 'Возврат', '00000000-0000-0000-0000-000000000001')->>'duplicate')::boolean, true, '2: повтор без даты: duplicate = true');
select is((camp_refund((select id from ids where k = 'g1'), 300, current_date, '  Возврат  ', '00000000-0000-0000-0000-000000000001')->>'duplicate')::boolean, true, '2: комментарий сравнивается после обрезки пробелов');

-- 3. повтор после возврата всего остатка
select is((camp_refund((select id from ids where k = 'g2'), 1000, current_date, null, '00000000-0000-0000-0000-000000000002')->>'duplicate')::boolean, false, '3: возврат всего остатка записан');
select is(paid('g2'), 0.00::numeric, '3: оплачено 0');
select is((camp_refund((select id from ids where k = 'g2'), 1000, current_date, null, '00000000-0000-0000-0000-000000000002')->>'duplicate')::boolean, true, '3: повтор: duplicate = true, а не refund above paid');
select is(paid('g2'), 0.00::numeric, '3: оплачено осталось 0, не ушло в минус');
select throws_ok($$select camp_refund((select id from ids where k = 'g2'), 1, current_date, null, '00000000-0000-0000-0000-000000000099')$$, '22023', 'refund above paid', '3: другой ключ при нулевом остатке: старое правило «не больше оплаченного»');

-- 6. тот же ключ с другим содержимым
select throws_ok($$select camp_refund((select id from ids where k = 'g1'), 301, current_date, 'Возврат', '00000000-0000-0000-0000-000000000001')$$, '22023', 'request id reused', '6: другая сумма');
select throws_ok($$select camp_refund((select id from ids where k = 'g3'), 300, current_date, 'Возврат', '00000000-0000-0000-0000-000000000001')$$, '22023', 'request id reused', '6: другой участник');
select throws_ok($$select camp_refund((select id from ids where k = 'g1'), 300, current_date, 'Другой комментарий', '00000000-0000-0000-0000-000000000001')$$, '22023', 'request id reused', '6: другой комментарий');
select throws_ok($$select camp_refund((select id from ids where k = 'g1'), 300, current_date - 1, 'Возврат', '00000000-0000-0000-0000-000000000001')$$, '22023', 'request id reused', '6: другая дата');
select is(refunds('g1'), 1, '6: строк возврата по-прежнему одна');
select is(paid('g1'), 700.00::numeric, '6: оплачено не менялось');

-- 7. самостоятельные одинаковые возвраты: разные ключи
select is((camp_refund((select id from ids where k = 'g3'), 100, current_date, 'Одинаковый', '00000000-0000-0000-0000-000000000031')->>'duplicate')::boolean, false, '7: первый возврат с ключом A');
select is((camp_refund((select id from ids where k = 'g3'), 100, current_date, 'Одинаковый', '00000000-0000-0000-0000-000000000032')->>'duplicate')::boolean, false, '7: второй такой же возврат с ключом B не считается повтором');
select is(refunds('g3'), 2, '7: записаны оба возврата');
select is(paid('g3'), 800.00::numeric, '7: оплачено уменьшилось на 200');
-- без ключа: как до миграции, каждый вызов создаёт возврат
select is((camp_refund((select id from ids where k = 'g3'), 50, current_date, 'Без ключа')->>'duplicate')::boolean, false, '7: вызов без ключа записывает возврат (поведение до миграции)');
select is((camp_refund((select id from ids where k = 'g3'), 50, current_date, 'Без ключа')->>'duplicate')::boolean, false, '7: повтор без ключа записывает второй возврат (защиты нет, ключ не передан)');
select is(refunds('g3'), 4, '7: без ключа возвратов стало четыре');
select is((select count(*)::int from camp_payments where request_id is null and kind = 'refund'), 2, '7: у возвратов без ключа request_id = null');

-- 8. ключ принадлежит автору
select as_user('00000000-0000-0000-0000-0000000000a2');
select is((camp_refund((select id from ids where k = 'g1'), 300, current_date, 'Возврат', '00000000-0000-0000-0000-000000000001')->>'duplicate')::boolean, false, '8: другой администратор с тем же ключом создаёт свой возврат');
select is((select count(*)::int from camp_payments where request_id = '00000000-0000-0000-0000-000000000001'), 2, '8: две строки с ключом, по одной на автора');
select as_user('00000000-0000-0000-0000-0000000000a1');

-- 10. старые правила
select throws_ok($$select camp_refund((select id from ids where k = 'g1'), 0, current_date, null, '00000000-0000-0000-0000-000000000041')$$, '22023', 'bad amount', '10: нулевая сумма');
select throws_ok($$select camp_refund((select id from ids where k = 'g1'), 1, current_date + 400, null, '00000000-0000-0000-0000-000000000042')$$, '22023', 'bad date', '10: дата в будущем');
select throws_ok($$select camp_refund('00000000-0000-0000-0000-000000000000', 1, current_date, null, '00000000-0000-0000-0000-000000000043')$$, 'P0002', 'participant not found', '10: несуществующий участник');
select is((select count(*)::int from camp_payments where request_id in ('00000000-0000-0000-0000-000000000041', '00000000-0000-0000-0000-000000000042', '00000000-0000-0000-0000-000000000043')), 0, '10: отклонённые вызовы не оставили строк');
select as_user('00000000-0000-0000-0000-0000000000b1');
select throws_ok($$select camp_refund((select id from ids where k = 'g1'), 1, current_date, null, '00000000-0000-0000-0000-000000000044')$$, '42501', 'forbidden', '10: родитель возврат не делает');
select as_user('00000000-0000-0000-0000-0000000000c1');
select throws_ok($$select camp_refund((select id from ids where k = 'g1'), 1, current_date, null, '00000000-0000-0000-0000-000000000044')$$, '42501', 'forbidden', '10: тренер возврат не делает');
select as_user('00000000-0000-0000-0000-0000000000d1');
select throws_ok($$select camp_refund((select id from ids where k = 'g1'), 1, current_date, null, '00000000-0000-0000-0000-000000000044')$$, '42501', 'forbidden', '10: локальный администратор возврат не делает');
select throws_ok($$select camp_refund((select id from ids where k = 'g1'), 300, current_date, 'Возврат', '00000000-0000-0000-0000-000000000001')$$, '42501', 'forbidden', '10: повтор чужого ключа не обходит проверку прав');

-- 11. прямая запись и правка по-прежнему закрыты для authenticated
select as_user('00000000-0000-0000-0000-0000000000a1');
select throws_ok($$insert into camp_payments (camp_id, participant_id, player_id, amount, paid_on, kind, request_id) select camp_id, id, null, -1, current_date, 'refund', gen_random_uuid() from camp_participants limit 1$$, '42501', null, '11: прямой INSERT в camp_payments отклонён');
select throws_ok($$update camp_payments set request_id = gen_random_uuid() where kind = 'refund'$$, '42501', null, '11: прямой UPDATE camp_payments отклонён');

-- 13. подмена объектов через pg_temp: временная таблица с тем же именем не влияет на проверку «не больше оплаченного»
select as_user('00000000-0000-0000-0000-0000000000a1');
discard plans; -- планы plpgsql в сессии закешированы: без сброса подмена не была бы видна
create temp table camp_payments (participant_id uuid, amount numeric, kind text);
insert into pg_temp.camp_payments select id, 1000000, 'payment' from ids where k = 'g1';
select throws_ok($$select camp_refund((select id from ids where k = 'g1'), 800, current_date, null, '00000000-0000-0000-0000-000000000051')$$, '22023', 'refund above paid', '13: временная таблица camp_payments не подменяет настоящую (оплачено считается по public)');
drop table pg_temp.camp_payments;
select is((select count(*)::int from public.camp_payments where request_id = '00000000-0000-0000-0000-000000000051'), 0, '13: подменённый вызов не записал возврат');

-- 12. история неизменна (владелец таблицы: триггер 0165)
reset role;
select throws_ok($$update camp_payments set request_id = null where request_id = '00000000-0000-0000-0000-000000000001'$$, 'P0001', 'immutable', '12: request_id не меняется (триггер 0165)');
select is((select count(*)::int from camp_payments where kind = 'payment' and request_id is null), 3, '12: платежи, созданные без ключа, остались с request_id = null');

select * from finish();
rollback;
