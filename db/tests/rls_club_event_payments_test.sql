-- pgTAP: раздел «Мероприятия», этап 3 (0210, Issue #677, docs/CLUB_EVENTS_ACCEPTANCE.md v6): платежи через service_payments (kind='event'),
-- страховочный триггер, kind_check, баланс, нижняя граница цены отменённой записи (PR11, PR12), касса (CASH1-CASH9), изоляция клубов.
-- Тесты написаны до миграции: на master без 0210 они красные. Права проверяются на базе с привилегиями по умолчанию Supabase.
begin;
create extension if not exists pgtap;
select plan(180);

drop table if exists club_event_participant_log, club_event_participants, club_event_price_log, club_event_log, club_event_groups, club_events cascade;
alter default privileges in schema public grant select, insert, update, delete on tables to anon, authenticated, service_role;
alter default privileges in schema public grant execute on functions to anon, authenticated, service_role;
\i db/migrations/0202_club_events.sql
\i db/migrations/0204_club_event_participants.sql
\i db/migrations/0210_club_event_payments.sql

insert into clubs (id, name) values ('00000000-0000-0000-0000-00000000c001', 'Клуб');
insert into users (id, telegram_id, display_name, is_admin) values
  ('00000000-0000-0000-0000-0000000000a1', 8901, 'Админ', true),
  ('00000000-0000-0000-0000-0000000000a2', 8902, 'Админ 2', true),
  ('00000000-0000-0000-0000-0000000000c1', 8903, 'Тренер', false),
  ('00000000-0000-0000-0000-0000000000b1', 8904, 'Родитель', false),
  ('00000000-0000-0000-0000-0000000000d1', 8905, 'Локальный админ', false),
  ('00000000-0000-0000-0000-0000000000e0', 8906, 'Без прав', false);
insert into location_admins (user_id, location) values ('00000000-0000-0000-0000-0000000000d1', 'Исани');
insert into groups (id, club_id, name) values ('00000000-0000-0000-0000-0000000000e1', '00000000-0000-0000-0000-00000000c001', 'U13-A');
insert into players (id, club_id, group_id, full_name, status) values
  ('00000000-0000-0000-0000-000000000d01', '00000000-0000-0000-0000-00000000c001', '00000000-0000-0000-0000-0000000000e1', 'Аня', 'active'),
  ('00000000-0000-0000-0000-000000000d02', '00000000-0000-0000-0000-00000000c001', '00000000-0000-0000-0000-0000000000e1', 'Боря', 'active'),
  ('00000000-0000-0000-0000-000000000d03', '00000000-0000-0000-0000-00000000c001', '00000000-0000-0000-0000-0000000000e1', 'Вера', 'active'),
  ('00000000-0000-0000-0000-000000000d04', '00000000-0000-0000-0000-00000000c001', '00000000-0000-0000-0000-0000000000e1', 'Гоша', 'active');
create or replace function as_user(uid uuid) returns void language plpgsql as $$
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
end $$;
create or replace function as_anon() returns void language plpgsql as $$
begin
  perform set_config('role', 'anon', true);
  perform set_config('request.jwt.claims', '', true);
end $$;
-- владелец базы с JWT админа: так работает функция внутри (проверка триггера в обход club_event_pay)
create or replace function as_owner_with_jwt(uid uuid) returns void language plpgsql as $$
begin
  perform set_config('role', 'postgres', true);
  perform set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
end $$;
create or replace function t_ev(n text) returns uuid language sql stable security definer set search_path = public as $$ select id from club_events where name = n $$;
create or replace function t_pt(n text, p uuid) returns uuid language sql stable security definer set search_path = public as $$
  select id from club_event_participants where event_id = (select id from club_events where name = n) and player_id = p $$;
create or replace function t_rows(n text, p uuid) returns int language sql stable security definer set search_path = public as $$
  select count(*)::int from service_payments where kind = 'event' and ref_id = (select id from club_events where name = n) and player_id = p $$;
create or replace function t_sum(n text, p uuid) returns numeric language sql stable security definer set search_path = public as $$
  select coalesce(sum(amount), 0) from service_payments where kind = 'event' and ref_id = (select id from club_events where name = n) and player_id = p $$;
create or replace function t_ev_rows() returns int language sql stable security definer set search_path = public as $$ select count(*)::int from service_payments where kind = 'event' $$;
create or replace function t_other_rows() returns text language sql stable security definer set search_path = public as $$
  select (select count(*) from payments) || '/' || (select count(*) from camp_payments) || '/' || (select count(*) from match_payments) || '/'
      || (select count(*) from tournament_payments) || '/' || (select count(*) from service_payments where kind <> 'event') $$;
create or replace function t_ev_today(c uuid) returns int language sql stable security definer set search_path = public as $$
  select count(*)::int from service_payments sp join club_events e on e.id = sp.ref_id where sp.kind = 'event' and sp.paid_on = tbilisi_day(now()) and e.club_id = c $$;
create or replace function t_list(n text, p uuid) returns jsonb language plpgsql stable security definer set search_path = public as $$
declare r jsonb;
begin
  perform set_config('request.jwt.claims', json_build_object('sub', '00000000-0000-0000-0000-0000000000a1', 'role', 'authenticated')::text, true);
  select x into r from jsonb_array_elements(club_event_participants_list(t_ev(n))) x where (x ->> 'player_id')::uuid = p;
  return r;
end $$;

-- ===== ACL. права на объекты (при умолчаниях Supabase) =====
select is((select count(*)::int from pg_proc p where p.proname = 'club_event_pay' and (has_function_privilege('anon', p.oid, 'execute') or has_function_privilege('public', p.oid, 'execute'))), 0, 'ACL4 club_event_pay недоступна anon и public');
select ok(has_function_privilege('authenticated', 'club_event_pay(uuid,uuid,numeric,text,date,uuid)', 'execute'), 'ACL4 club_event_pay доступна authenticated');
select is(has_function_privilege('authenticated', 'service_payments_event_guard()', 'execute') or has_function_privilege('anon', 'service_payments_event_guard()', 'execute'), false, 'ACL4 функция триггера недоступна authenticated и anon');
select is((select count(*)::int from pg_proc p where p.proname in ('club_event_pay', 'club_event_participant_set_price', 'club_event_participants_list', 'club_event_get')
            and (has_function_privilege('anon', p.oid, 'execute') or has_function_privilege('public', p.oid, 'execute'))), 0, 'ACL4 изменённые функции раздела недоступны anon и public');
select is((select count(*)::int from pg_proc where proname = 'club_event_pay' and prosrc like '%club_event_assert_admin%' and prosrc not like '%is_any_coach%'), 1, 'ACL7 club_event_pay проверяет админа и клуб через club_event_assert_admin, без is_any_coach');
select is((select pronargs::int from pg_proc where proname = 'club_event_pay'), 6, 'PAY21 у club_event_pay шесть параметров');
select is((select pronargdefaults::int from pg_proc where proname = 'club_event_pay'), 0, 'PAY21 значений по умолчанию нет: нет режима без подтверждения или черновика платежа');

-- ===== фикстуры =====
select as_user('00000000-0000-0000-0000-0000000000a1');
select lives_ok($$select club_event_create('Платный', null, '2026-12-05', null, null, 100, null, null, null, 'active')$$, 'фикстура: платное мероприятие 100');
select lives_ok($$select club_event_create('Бесплатный', null, '2026-12-06', null, null, 0, null, null, null, 'active')$$, 'фикстура: бесплатное мероприятие');
select lives_ok($$select club_event_create('Завершён', null, '2026-12-07', null, null, 50, null, null, null, 'active')$$, 'фикстура: будущее завершённое');
select lives_ok($$select club_event_create('Отменён', null, '2026-12-08', null, null, 50, null, null, null, 'active')$$, 'фикстура: будущее отменённое');
select lives_ok($$select club_event_create('Черновик', null, '2026-12-09', null, null, 50, null, null, null, 'draft')$$, 'фикстура: черновик');
select lives_ok($$select club_event_create('Цены', null, '2026-12-10', null, null, 100, null, null, null, 'active')$$, 'фикстура: цены');
select lives_ok($$select club_event_participant_add(t_ev('Платный'), '00000000-0000-0000-0000-000000000d01')$$, 'фикстура: Аня на Платный');
select lives_ok($$select club_event_participant_add(t_ev('Платный'), '00000000-0000-0000-0000-000000000d02')$$, 'фикстура: Боря на Платный');
select lives_ok($$select club_event_participant_add(t_ev('Платный'), '00000000-0000-0000-0000-000000000d03')$$, 'фикстура: Вера на Платный');
select lives_ok($$select club_event_participant_add(t_ev('Бесплатный'), '00000000-0000-0000-0000-000000000d01')$$, 'фикстура: Аня на Бесплатный');
select lives_ok($$select club_event_participant_add(t_ev('Завершён'), '00000000-0000-0000-0000-000000000d01')$$, 'фикстура: Аня на Завершён');
select lives_ok($$select club_event_participant_add(t_ev('Завершён'), '00000000-0000-0000-0000-000000000d02')$$, 'фикстура: Боря на Завершён');
select lives_ok($$select club_event_participant_add(t_ev('Отменён'), '00000000-0000-0000-0000-000000000d01')$$, 'фикстура: Аня на Отменён');
select lives_ok($$select club_event_participant_add(t_ev('Цены'), '00000000-0000-0000-0000-000000000d01')$$, 'фикстура: Аня на Цены');
select lives_ok($$select club_event_participant_add(t_ev('Цены'), '00000000-0000-0000-0000-000000000d02')$$, 'фикстура: Боря на Цены');
select lives_ok($$select club_event_participant_cancel(t_pt('Платный', '00000000-0000-0000-0000-000000000d03'))$$, 'фикстура: запись Веры на Платный отменена');
select lives_ok($$select club_event_set_status(t_ev('Завершён'), 'finished')$$, 'фикстура: Завершён переведён в finished');
select lives_ok($$select club_event_set_status(t_ev('Отменён'), 'cancelled')$$, 'фикстура: Отменён переведён в cancelled');
reset role;

-- ===== ACL1/ACL6. кто может принять платёж =====
select as_user('00000000-0000-0000-0000-0000000000c1');
select throws_ok($$select club_event_pay(t_ev('Платный'), '00000000-0000-0000-0000-000000000d01', 10, 'Наличные', null, gen_random_uuid())$$, '42501', 'forbidden', 'ACL1 тренер платёж принять не может');
select as_user('00000000-0000-0000-0000-0000000000b1');
select throws_ok($$select club_event_pay(t_ev('Платный'), '00000000-0000-0000-0000-000000000d01', 10, 'Наличные', null, gen_random_uuid())$$, '42501', 'forbidden', 'ACL1 родитель платёж принять не может');
select as_user('00000000-0000-0000-0000-0000000000d1');
select throws_ok($$select club_event_pay(t_ev('Платный'), '00000000-0000-0000-0000-000000000d01', 10, 'Наличные', null, gen_random_uuid())$$, '42501', 'forbidden', 'ACL1 локальный админ платёж мероприятия принять не может');
select as_user('00000000-0000-0000-0000-0000000000e0');
select throws_ok($$select club_event_pay(t_ev('Платный'), '00000000-0000-0000-0000-000000000d01', 10, 'Наличные', null, gen_random_uuid())$$, '42501', 'forbidden', 'ACL1 пользователь без прав платёж принять не может');
select as_anon();
select throws_ok($$select club_event_pay('00000000-0000-0000-0000-0000000000ff', '00000000-0000-0000-0000-000000000d01', 10, 'Наличные', null, gen_random_uuid())$$, '42501', null, 'ACL4 anon платёж принять не может');
reset role;
select set_config('request.jwt.claims', '{}', true);
select throws_ok($$select club_event_pay(t_ev('Платный'), '00000000-0000-0000-0000-000000000d01', 10, 'Наличные', null, gen_random_uuid())$$, '42501', 'not authenticated', 'ACL6 вызов без JWT: not authenticated');
select is(t_ev_rows(), 0, 'ACL1 отказы не записали ни одной строки');

-- ===== PAY11. связь платежа =====
select is(t_other_rows(), '0/0/0/0/0', 'PAY11 исходное состояние других журналов пусто');
select as_user('00000000-0000-0000-0000-0000000000a1');
select is((select club_event_pay(t_ev('Платный'), '00000000-0000-0000-0000-000000000d01', 40, 'Наличные', null, '00000000-0000-0000-0000-00000000f001') ->> 'applied')::boolean, true, 'PAY11 платёж 40 принят');
reset role;
select is(t_rows('Платный', '00000000-0000-0000-0000-000000000d01'), 1, 'PAY11 ровно одна строка service_payments');
select is((select kind || '/' || op || '/' || amount || '/' || method from service_payments where kind = 'event'), 'event/payment/40.00/Наличные', 'PAY11 вид, операция, сумма, способ');
select is((select ref_id = t_ev('Платный') and player_id = '00000000-0000-0000-0000-000000000d01' and request_id = '00000000-0000-0000-0000-00000000f001' and cancels is null and note is null from service_payments where kind = 'event'), true, 'PAY11 ref_id = мероприятие, игрок, request_id, cancels и note пусты');
select is((select paid_on = tbilisi_day(now()) from service_payments where kind = 'event'), true, 'PAY6 дата по умолчанию: сегодня по Тбилиси');
select is((select recorded_by = '00000000-0000-0000-0000-0000000000a1' and recorded_at is not null from service_payments where kind = 'event'), true, 'PAY9 автора и время ставит сервер');
select is(t_other_rows(), '0/0/0/0/0', 'PAY11 в других журналах строк не прибавилось (NOSIDE1, CASH8)');

-- ===== PAY2/PAY3. частичные платежи, долг, переплата =====
select as_user('00000000-0000-0000-0000-0000000000a1');
select is(club_event_pay(t_ev('Платный'), '00000000-0000-0000-0000-000000000d01', 25, 'Перевод', null, '00000000-0000-0000-0000-00000000f002') - 'payment_id',
          '{"applied": true, "price": 100.00, "counted": 65.00, "debt": 35.00, "overpay": 0, "overpay_added": 0}'::jsonb, 'PAY2 второй платёж суммируется: засчитано 65, долг 35');
select is(club_event_pay(t_ev('Платный'), '00000000-0000-0000-0000-000000000d01', 35, 'Наличные', null, '00000000-0000-0000-0000-00000000f003') - 'payment_id',
          '{"applied": true, "price": 100.00, "counted": 100.00, "debt": 0, "overpay": 0, "overpay_added": 0}'::jsonb, 'PAY3 платёж равен долгу: долг 0');
select is(t_list('Платный', '00000000-0000-0000-0000-000000000d01') ->> 'pay_state', 'paid', 'PAY3 статус «оплачено» вычисляется');
select is(club_event_pay(t_ev('Платный'), '00000000-0000-0000-0000-000000000d01', 10, 'Наличные', null, '00000000-0000-0000-0000-00000000f004') - 'payment_id',
          '{"applied": true, "price": 100.00, "counted": 110.00, "debt": 0, "overpay": 10.00, "overpay_added": 10.00}'::jsonb, 'PAY3 платёж сверх долга принят: переплата 10 показана отдельно');
select is(t_list('Платный', '00000000-0000-0000-0000-000000000d01') ->> 'pay_state', 'overpaid', 'PAY3 статус «переплата»');
select is((select club_event_pay(t_ev('Платный'), '00000000-0000-0000-0000-000000000d01', 5, 'Наличные', null, '00000000-0000-0000-0000-00000000f005') ->> 'overpay')::numeric, 15.00, 'PAY3 следующие операции не блокируются: ещё платёж, переплата 15');
reset role;
select is(t_sum('Платный', '00000000-0000-0000-0000-000000000d01'), 115.00, 'PAY2 сумма журнала 115');
select is(t_sum('Платный', '00000000-0000-0000-0000-000000000d02'), 0::numeric, 'PAY7 платёж Ани не влияет на запись Бори');

-- ===== PAY4/PAY5/PAY6/PAY12. отказы без записи строки =====
select is(t_ev_rows(), 5, 'PAY12 до отказов в журнале 5 строк мероприятий');
select as_user('00000000-0000-0000-0000-0000000000a1');
select throws_ok($$select club_event_pay(t_ev('Платный'), '00000000-0000-0000-0000-000000000d02', 0, 'Наличные', null, gen_random_uuid())$$, '22023', 'bad amount', 'PAY4 сумма 0');
select throws_ok($$select club_event_pay(t_ev('Платный'), '00000000-0000-0000-0000-000000000d02', -5, 'Наличные', null, gen_random_uuid())$$, '22023', 'bad amount', 'PAY4 отрицательная сумма');
select throws_ok($$select club_event_pay(t_ev('Платный'), '00000000-0000-0000-0000-000000000d02', null, 'Наличные', null, gen_random_uuid())$$, '22023', 'bad amount', 'PAY4 сумма NULL');
select throws_ok($$select club_event_pay(t_ev('Платный'), '00000000-0000-0000-0000-000000000d02', 10.123, 'Наличные', null, gen_random_uuid())$$, '22023', 'bad amount', 'PAY4 более двух знаков');
select throws_ok($$select club_event_pay(t_ev('Платный'), '00000000-0000-0000-0000-000000000d02', 10, null, null, gen_random_uuid())$$, '22023', 'bad method', 'PAY5 способ NULL');
select throws_ok($$select club_event_pay(t_ev('Платный'), '00000000-0000-0000-0000-000000000d02', 10, '', null, gen_random_uuid())$$, '22023', 'bad method', 'PAY5 пустой способ');
select throws_ok($$select club_event_pay(t_ev('Платный'), '00000000-0000-0000-0000-000000000d02', 10, 'Карта', null, gen_random_uuid())$$, '22023', 'bad method', 'PAY5 способ вне набора');
select throws_ok($$select club_event_pay(t_ev('Платный'), '00000000-0000-0000-0000-000000000d02', 10, 'Наличные', tbilisi_day(now()) + 1, gen_random_uuid())$$, '22023', 'bad date', 'PAY6 дата завтра по Тбилиси отклонена');
select throws_ok($$select club_event_pay(t_ev('Платный'), '00000000-0000-0000-0000-000000000d02', 10, 'Наличные', null, null)$$, '22023', 'request id required', 'IDEM3 request_id обязателен');
select throws_ok($$select club_event_pay('00000000-0000-0000-0000-0000000000ff', '00000000-0000-0000-0000-000000000d02', 10, 'Наличные', null, gen_random_uuid())$$, 'P0002', 'event not found', 'PAY12 мероприятие не найдено');
select throws_ok($$select club_event_pay(t_ev('Платный'), '00000000-0000-0000-0000-000000000d04', 10, 'Наличные', null, gen_random_uuid())$$, 'P0002', 'participant not found', 'PAY7 у игрока нет записи на мероприятие');
select throws_ok($$select club_event_pay(t_ev('Платный'), '00000000-0000-0000-0000-0000000000ff', 10, 'Наличные', null, gen_random_uuid())$$, 'P0002', 'participant not found', 'PAY7 несуществующий игрок');
select throws_ok($$select club_event_pay(t_ev('Платный'), '00000000-0000-0000-0000-000000000d03', 10, 'Наличные', null, gen_random_uuid())$$, '55000', 'participant cancelled', 'PAY10 запись отменена: платёж запрещён при любом долге');
select throws_ok($$select club_event_pay(t_ev('Черновик'), '00000000-0000-0000-0000-000000000d01', 10, 'Наличные', null, gen_random_uuid())$$, '55000', 'event not open for payments', 'PAY1 черновик: платёж нельзя');
select throws_ok($$select club_event_pay(t_ev('Отменён'), '00000000-0000-0000-0000-000000000d01', 10, 'Наличные', null, gen_random_uuid())$$, '55000', 'event not open for payments', 'PAY1 отменённое мероприятие: платёж нельзя');
reset role;
select is(t_ev_rows(), 5, 'PAY12 после всех отказов строк не прибавилось');

-- ===== PAY6. граница даты и прошлые даты =====
select as_user('00000000-0000-0000-0000-0000000000a1');
select is((club_event_pay(t_ev('Платный'), '00000000-0000-0000-0000-000000000d02', 10, 'Наличные', tbilisi_day(now()), gen_random_uuid()) ->> 'applied')::boolean, true, 'PAY6 сегодня по Тбилиси принимается');
select is((club_event_pay(t_ev('Платный'), '00000000-0000-0000-0000-000000000d02', 10, 'Перевод', date '2026-01-15', gen_random_uuid()) ->> 'applied')::boolean, true, 'PAY6 прошлая дата принимается');
reset role;
select is((select count(*)::int from service_payments where kind = 'event' and player_id = '00000000-0000-0000-0000-000000000d02' and paid_on = date '2026-01-15'), 1, 'PAY6 прошлая дата сохранена как есть');

-- ===== PAY1. завершённое мероприятие, бесплатное мероприятие =====
select as_user('00000000-0000-0000-0000-0000000000a1');
select is((club_event_pay(t_ev('Завершён'), '00000000-0000-0000-0000-000000000d01', 20, 'Наличные', null, gen_random_uuid()) ->> 'applied')::boolean, true, 'PAY1 завершённое мероприятие, активная запись: платёж можно');
select is((club_event_pay(t_ev('Бесплатный'), '00000000-0000-0000-0000-000000000d01', 7, 'Наличные', null, gen_random_uuid()) ->> 'overpay')::numeric, 7.00, 'PR13 платёж на цену 0 принят как переплата');
select lives_ok($$select club_event_participant_cancel(t_pt('Завершён', '00000000-0000-0000-0000-000000000d02'))$$, 'фикстура: запись Бори на Завершён отменена');
select throws_ok($$select club_event_pay(t_ev('Завершён'), '00000000-0000-0000-0000-000000000d02', 10, 'Наличные', null, gen_random_uuid())$$, '55000', 'participant cancelled', 'PAY1 завершённое мероприятие, отменённая запись: платёж нельзя');
reset role;

-- ===== PAY15/IDEM1. идемпотентность =====
select is(t_rows('Платный', '00000000-0000-0000-0000-000000000d01'), 5, 'IDEM1 до повторов у Ани 5 платежей');
select as_user('00000000-0000-0000-0000-0000000000a1');
select is((club_event_pay(t_ev('Платный'), '00000000-0000-0000-0000-000000000d01', 40, 'Наличные', null, '00000000-0000-0000-0000-00000000f001') ->> 'applied')::boolean, false, 'IDEM1 повтор того же запроса: applied=false');
select is((club_event_pay(t_ev('Платный'), '00000000-0000-0000-0000-000000000d01', 40, 'Наличные', null, '00000000-0000-0000-0000-00000000f001') ->> 'payment_id')::uuid,
          (select id from service_payments where request_id = '00000000-0000-0000-0000-00000000f001'), 'IDEM1 повтор возвращает id прежней строки');
select throws_ok($$select club_event_pay(t_ev('Платный'), '00000000-0000-0000-0000-000000000d01', 41, 'Наличные', null, '00000000-0000-0000-0000-00000000f001')$$, '22023', 'request id reused', 'IDEM1 тот же ключ с другой суммой: отказ');
select throws_ok($$select club_event_pay(t_ev('Платный'), '00000000-0000-0000-0000-000000000d01', 40, 'Перевод', null, '00000000-0000-0000-0000-00000000f001')$$, '22023', 'request id reused', 'IDEM1 тот же ключ с другим способом: отказ');
select throws_ok($$select club_event_pay(t_ev('Платный'), '00000000-0000-0000-0000-000000000d02', 40, 'Наличные', null, '00000000-0000-0000-0000-00000000f001')$$, '22023', 'request id reused', 'IDEM1 тот же ключ с другим игроком: отказ');
select throws_ok($$select club_event_pay(t_ev('Бесплатный'), '00000000-0000-0000-0000-000000000d01', 40, 'Наличные', null, '00000000-0000-0000-0000-00000000f001')$$, '22023', 'request id reused', 'IDEM1 тот же ключ с другим мероприятием: отказ');
reset role;
select is(t_rows('Платный', '00000000-0000-0000-0000-000000000d01'), 5, 'IDEM1 повторы строк не добавили');

-- ===== PAY17. баланс только из журнала =====
select as_user('00000000-0000-0000-0000-0000000000a1');
select is((t_list('Платный', '00000000-0000-0000-0000-000000000d01') ->> 'counted')::numeric, (select sum(amount) from service_payments where kind = 'event' and ref_id = t_ev('Платный') and player_id = '00000000-0000-0000-0000-000000000d01'), 'PAY17 засчитано в списке = сумма журнала');
select is((t_list('Платный', '00000000-0000-0000-0000-000000000d02') ->> 'counted')::numeric, 20.00, 'PAY17 у Бори 20 (две оплаты по 10)');
select is(t_list('Платный', '00000000-0000-0000-0000-000000000d02') ->> 'pay_state', 'debt', 'PAY17 у Бори долг');
select is((t_list('Платный', '00000000-0000-0000-0000-000000000d02') ->> 'debt')::numeric, 80.00, 'PAY17 долг Бори 80');
select is((t_list('Платный', '00000000-0000-0000-0000-000000000d03') ->> 'debt')::numeric, 100.00, 'PAY17 у отменённой записи долг сохраняется (U10)');
select is(club_event_get(t_ev('Платный')) -> 'finance', '{"counted": 135.00, "debt": 180.00, "overpay": 15.00}'::jsonb, 'PAY17 финансовая сводка карточки: засчитано 135, долг 180, переплата 15 отдельно');
reset role;
select is((select count(*)::int from information_schema.tables where table_schema = 'public' and table_name ~ '^club_event_(payment|refund|transfer)'), 0, 'PAY17/PAY18 таблиц платежей, возвратов и переносов мероприятий нет');

-- ===== PAY18. границы объёма =====
select is((select string_agg(column_name, ',' order by column_name) from information_schema.columns where table_schema = 'public' and table_name = 'service_payments'),
          'amount,cancels,created_at,id,kind,method,note,op,paid_on,player_id,recorded_at,recorded_by,ref_id,request_id', 'PAY18 в service_payments нет новых столбцов');
select is((select count(*)::int from pg_proc where proname like 'club\_event\_%' and proname ~ '(refund|transfer|reverse|storno|writeoff|write_off)|pay(ment)?_(cancel|edit|update|delete|remove|correct)'), 0, 'PAY18/RF/TR функций возврата, переноса, сторно, списания, отмены и правки платежа мероприятий нет');
select is((select pg_get_constraintdef(oid) ~ '^CHECK \(\(op = ANY \(ARRAY\[''payment''::text, ''reversal''::text, ''refund''::text, ''opening_balance''::text\]\)\)\)$' from pg_constraint where conname = 'service_payments_op_check'), true, 'PAY18 набор значений op не изменён');

-- ===== PAY19. kind_check =====
select ok((select pg_get_constraintdef(oid) like '%''event''%' from pg_constraint where conname = 'service_payments_kind_check'), 'PAY19 в kind_check есть event');
select lives_ok($$insert into service_payments (kind, ref_id, player_id, amount, paid_on, method, op) values ('extra', gen_random_uuid(), '00000000-0000-0000-0000-000000000d04', 11, '2026-11-10', 'Наличные', 'payment')$$, 'PAY19 прежний вид extra вставляется');
select lives_ok($$insert into service_payments (kind, ref_id, player_id, amount, paid_on, method, op) values ('individual', gen_random_uuid(), '00000000-0000-0000-0000-000000000d04', 12, '2026-11-10', 'Перевод', 'payment')$$, 'PAY19 прежний вид individual вставляется');
select lives_ok($$insert into service_payments (kind, ref_id, player_id, amount, paid_on, method, op) values ('visit', gen_random_uuid(), '00000000-0000-0000-0000-000000000d04', 13, '2026-11-10', 'Наличные', 'payment')$$, 'PAY19 прежний вид visit вставляется');
select lives_ok($$insert into service_payments (kind, ref_id, player_id, amount, paid_on, method, op) values ('own_visit', gen_random_uuid(), '00000000-0000-0000-0000-000000000d04', 14, '2026-11-10', 'Наличные', 'payment')$$, 'PAY19 прежний вид own_visit вставляется');
select throws_ok($$insert into service_payments (kind, ref_id, player_id, amount, paid_on, method, op) values ('bogus', gen_random_uuid(), '00000000-0000-0000-0000-000000000d04', 15, '2026-11-10', 'Наличные', 'payment')$$, '23514', null, 'PAY19 неизвестный вид отклонён');

-- ===== PAY13/PAY14. страховочный триггер на прямую вставку =====
select set_config('request.jwt.claims', '{}', true);
select throws_ok($$insert into service_payments (kind, ref_id, player_id, amount, paid_on, method, op, request_id) values ('event', t_ev('Платный'), '00000000-0000-0000-0000-000000000d01', 5, '2026-11-10', 'Наличные', 'payment', gen_random_uuid())$$, '42501', 'forbidden', 'PAY13 владелец без JWT: клуб не определён, вставка отклонена');
select as_owner_with_jwt('00000000-0000-0000-0000-0000000000a1');
select throws_ok($$insert into service_payments (kind, ref_id, player_id, amount, paid_on, method, op, request_id) values ('event', gen_random_uuid(), '00000000-0000-0000-0000-000000000d01', 5, '2026-11-10', 'Наличные', 'payment', gen_random_uuid())$$, 'P0002', 'event not found', 'PAY13 несуществующий ref_id');
select throws_ok($$insert into service_payments (kind, ref_id, player_id, amount, paid_on, method, op, request_id) values ('event', t_ev('Черновик'), '00000000-0000-0000-0000-000000000d01', 5, '2026-11-10', 'Наличные', 'payment', gen_random_uuid())$$, '55000', 'event not open for payments', 'PAY13 черновик');
select throws_ok($$insert into service_payments (kind, ref_id, player_id, amount, paid_on, method, op, request_id) values ('event', t_ev('Отменён'), '00000000-0000-0000-0000-000000000d01', 5, '2026-11-10', 'Наличные', 'payment', gen_random_uuid())$$, '55000', 'event not open for payments', 'PAY13 отменённое мероприятие');
select throws_ok($$insert into service_payments (kind, ref_id, player_id, amount, paid_on, method, op, request_id) values ('event', t_ev('Платный'), '00000000-0000-0000-0000-000000000d04', 5, '2026-11-10', 'Наличные', 'payment', gen_random_uuid())$$, 'P0002', 'participant not found', 'PAY13 игрок без записи');
select throws_ok($$insert into service_payments (kind, ref_id, player_id, amount, paid_on, method, op, request_id) values ('event', t_ev('Платный'), '00000000-0000-0000-0000-000000000d03', 5, '2026-11-10', 'Наличные', 'payment', gen_random_uuid())$$, '55000', 'participant cancelled', 'PAY13 отменённая запись');
select throws_ok($$insert into service_payments (kind, ref_id, player_id, amount, paid_on, method, op) values ('event', t_ev('Платный'), '00000000-0000-0000-0000-000000000d01', 5, '2026-11-10', 'Наличные', 'payment')$$, '22023', 'request id required', 'PAY13 без request_id');
select throws_ok($$insert into service_payments (kind, ref_id, player_id, amount, paid_on, method, op, request_id) values ('event', t_ev('Платный'), '00000000-0000-0000-0000-000000000d01', 5, '2026-11-10', 'Карта', 'payment', gen_random_uuid())$$, '22023', 'bad method', 'PAY13 способ вне набора');
select throws_ok($$insert into service_payments (kind, ref_id, player_id, amount, paid_on, method, op, request_id) values ('event', t_ev('Платный'), '00000000-0000-0000-0000-000000000d01', 5, tbilisi_day(now()) + 1, 'Наличные', 'payment', gen_random_uuid())$$, '22023', 'bad date', 'PAY13 будущая дата');
select throws_ok($$insert into service_payments (kind, ref_id, player_id, amount, paid_on, method, op, request_id) values ('event', t_ev('Платный'), '00000000-0000-0000-0000-000000000d01', -5, '2026-11-10', 'Наличные', 'refund', gen_random_uuid())$$, '22023', 'bad amount', 'PAY14 возврат (минус) для мероприятия отклонён');
select throws_ok($$insert into service_payments (kind, ref_id, player_id, amount, paid_on, method, op, request_id, cancels) values ('event', t_ev('Платный'), '00000000-0000-0000-0000-000000000d01', 5, '2026-11-10', 'Наличные', 'payment', gen_random_uuid(), (select id from service_payments where request_id = '00000000-0000-0000-0000-00000000f001'))$$, '23514', null, 'PAY14 платёж мероприятия с cancels отклонён ограничением');
select throws_ok($$insert into service_payments (kind, ref_id, player_id, amount, paid_on, method, op, request_id, note) values ('event', t_ev('Платный'), '00000000-0000-0000-0000-000000000d01', 5, '2026-11-10', 'Наличные', 'payment', gen_random_uuid(), 'заметка')$$, '23514', null, 'PAY14 платёж мероприятия с note отклонён ограничением');
select throws_ok($$insert into service_payments (kind, ref_id, player_id, amount, paid_on, method, op, request_id) values ('event', t_ev('Платный'), '00000000-0000-0000-0000-000000000d01', 5, '2026-11-10', 'Наличные', 'opening_balance', gen_random_uuid())$$, '42501', null, 'PAY14 opening_balance для мероприятия отклонён');
reset role;
select set_config('request.jwt.claims', '{}', true);
select is(t_ev_rows(), 9, 'PAY13/PAY14 после всех отказов строк мероприятий прежнее число (9)');
select as_user('00000000-0000-0000-0000-0000000000a1');
select throws_ok($$insert into service_payments (kind, ref_id, player_id, amount, paid_on, method, op, request_id) values ('event', t_ev('Платный'), '00000000-0000-0000-0000-000000000d01', 5, '2026-11-10', 'Наличные', 'payment', gen_random_uuid())$$, '42501', null, 'ACL3 прямая вставка из роли authenticated (админ) отклонена');
reset role;

-- ===== HIST1. неизменяемость журнала =====
select throws_ok($$update service_payments set amount = 1 where kind = 'event'$$, 'P0001', 'payment history is immutable', 'HIST1 сумма платежа мероприятия не правится');
select throws_ok($$update service_payments set player_id = '00000000-0000-0000-0000-000000000d02' where kind = 'event'$$, 'P0001', 'payment history is immutable', 'HIST1 игрок платежа не правится');
select throws_ok($$update service_payments set ref_id = t_ev('Цены') where kind = 'event'$$, 'P0001', 'payment history is immutable', 'HIST1 мероприятие платежа не правится');
select throws_ok($$update service_payments set kind = 'extra' where kind = 'event'$$, 'P0001', 'payment history is immutable', 'HIST1 вид платежа не правится');
select throws_ok($$update service_payments set request_id = gen_random_uuid() where kind = 'event'$$, 'P0001', 'payment history is immutable', 'HIST1 request_id не правится');
select throws_ok($$delete from service_payments where kind = 'event'$$, 'P0001', 'payment history is immutable', 'HIST1 платёж мероприятия не удаляется');
select throws_ok($$truncate service_payments$$, 'P0001', 'payment history is immutable', 'HIST1 TRUNCATE журнала отклонён');
select as_user('00000000-0000-0000-0000-0000000000a1');
select throws_ok($$update service_payments set method = 'Перевод' where kind = 'event'$$, '42501', null, 'HIST1 у админа приложения права UPDATE нет');
reset role;
select lives_ok($$update service_payments set method = 'Перевод' where request_id = '00000000-0000-0000-0000-00000000f003'$$, 'HIST1 владелец БД исправляет способ существующим механизмом 0179');
select is((select count(*)::int from audit_log where action = 'payment_correct' and entity = 'service_payments' and (after ->> 'method') = 'Перевод' and (before ->> 'method') = 'Наличные'), 1, 'HIST1 исправление записано в audit_log (payment_correct)');
select is((select count(*)::int from pg_trigger where tgrelid = 'public.service_payments'::regclass and tgname in ('service_payments_history_guard', 'service_payments_history_audit', 'service_payments_event_guard') and tgenabled = 'O'), 3, 'HIST1 триггеры защиты журнала и страховка мероприятий включены');
select throws_ok($$delete from players where id = '00000000-0000-0000-0000-000000000d01'$$, null, null, 'PAY20/HIST3 удаление игрока с платежами и записями мероприятий отклонено');

-- ===== PR11/PR12. нижняя граница цены отменённой записи =====
select as_user('00000000-0000-0000-0000-0000000000a1');
select lives_ok($$select club_event_pay(t_ev('Цены'), '00000000-0000-0000-0000-000000000d01', 60, 'Наличные', null, gen_random_uuid())$$, 'PR11 фикстура: Аня платит 60 из 100');
select lives_ok($$select club_event_pay(t_ev('Цены'), '00000000-0000-0000-0000-000000000d02', 100, 'Наличные', null, gen_random_uuid())$$, 'PR11 фикстура: Боря платит 100 из 100');
select is(club_event_participant_set_price(t_pt('Цены', '00000000-0000-0000-0000-000000000d01'), 40, 'скидка') ->> 'overpay', '20.00', 'PR11 активная запись: цена ниже засчитанного допускается, в ответе переплата 20 (UI16)');
select is((t_list('Цены', '00000000-0000-0000-0000-000000000d01') ->> 'overpay')::numeric, 20.00, 'PR11 переплата 20 в списке, долг 0');
select is((t_list('Цены', '00000000-0000-0000-0000-000000000d01') ->> 'debt')::numeric, 0::numeric, 'PR11 долг 0');
reset role;
select is(t_rows('Цены', '00000000-0000-0000-0000-000000000d01'), 1, 'PR11 платёжных строк не прибавилось');
select as_user('00000000-0000-0000-0000-0000000000a1');
select lives_ok($$select club_event_participant_cancel(t_pt('Цены', '00000000-0000-0000-0000-000000000d02'))$$, 'PR12 запись Бори отменена (засчитано 100)');
select lives_ok($$select club_event_participant_set_price(t_pt('Цены', '00000000-0000-0000-0000-000000000d02'), 150, 'повышение')$$, 'PR12 отменённая запись: цена выше засчитанного допускается, возникает долг 50');
select is((t_list('Цены', '00000000-0000-0000-0000-000000000d02') ->> 'debt')::numeric, 50.00, 'PR12 долг отменённой записи 50');
select throws_ok($$select club_event_pay(t_ev('Цены'), '00000000-0000-0000-0000-000000000d02', 50, 'Наличные', null, gen_random_uuid())$$, '55000', 'participant cancelled', 'PR12 долг отменённой записи платежом не закрывается');
select throws_ok($$select club_event_participant_set_price(t_pt('Цены', '00000000-0000-0000-0000-000000000d02'), 99, 'ниже засчитанного')$$, '22023', 'price below counted', 'PR11 отменённая запись: цена ниже засчитанного (99 < 100) отклонена');
select is((select individual_price from club_event_participants where id = t_pt('Цены', '00000000-0000-0000-0000-000000000d02')), 150.00, 'PR11 цена после отказа не изменилась');
select is(club_event_participant_set_price(t_pt('Цены', '00000000-0000-0000-0000-000000000d02'), 100, 'закрыть долг') ->> 'applied', 'true', 'PR11 цена равна засчитанному: принято');
select is((t_list('Цены', '00000000-0000-0000-0000-000000000d02') ->> 'debt')::numeric, 0::numeric, 'PR12 долг отменённой записи закрыт изменением цены с причиной, долг 0');
select is(t_list('Цены', '00000000-0000-0000-0000-000000000d02') ->> 'pay_state', 'paid', 'PR12 статус «оплачено»');
select lives_ok($$select club_event_participant_restore(t_pt('Цены', '00000000-0000-0000-0000-000000000d02'))$$, 'PR12 восстановление отменённой записи после снижения цены');
select is((select individual_price from club_event_participants where id = t_pt('Цены', '00000000-0000-0000-0000-000000000d02')), 100.00, 'PR12 цена после восстановления сохранена как есть');
reset role;
select is((select count(*)::int from pg_proc where proname like 'club\_event\_%' and (prosrc ~* 'writeoff|write_off|списан')), 0, 'PR12 функции или операции списания долга нет');

-- ===== CASH. касса =====
select set_config('request.jwt.claims', '{}', true);
insert into payments (player_id, amount, paid_on, method) values ('00000000-0000-0000-0000-000000000d04', 70, tbilisi_day(now()), 'Наличные');
insert into service_payments (kind, ref_id, player_id, amount, paid_on, method, op) values
  ('extra', gen_random_uuid(), '00000000-0000-0000-0000-000000000d04', 12, tbilisi_day(now()), 'Наличные', 'payment'),
  ('individual', gen_random_uuid(), '00000000-0000-0000-0000-000000000d04', 13, tbilisi_day(now()), 'Перевод', 'payment'),
  ('visit', gen_random_uuid(), '00000000-0000-0000-0000-000000000d04', 14, tbilisi_day(now()), 'Наличные', 'payment'),
  ('own_visit', gen_random_uuid(), '00000000-0000-0000-0000-000000000d04', 15, tbilisi_day(now()), 'Наличные', 'payment');
select as_user('00000000-0000-0000-0000-0000000000a1');
select lives_ok($$select club_event_pay(t_ev('Платный'), '00000000-0000-0000-0000-000000000d02', 30, 'Перевод', tbilisi_day(now()), gen_random_uuid())$$, 'CASH фикстура: Боря платит ещё 30 сегодня');
reset role;
create or replace function t_cash(uid uuid) returns jsonb language plpgsql as $$
begin
  perform as_user(uid);
  return cash_report(tbilisi_day(now()), tbilisi_day(now()));
end $$;
create or replace function t_day(uid uuid) returns jsonb language plpgsql as $$
begin
  perform as_user(uid);
  return cash_day_service(tbilisi_day(now()));
end $$;
create temp table cash_a1 as select t_cash('00000000-0000-0000-0000-0000000000a1') as r, t_day('00000000-0000-0000-0000-0000000000a1') as d;
reset role;
grant select on cash_a1 to public;

select is((select jsonb_array_length(r -> 'rows') from cash_a1), 5 + (select count(*)::int from service_payments where kind = 'event' and paid_on = tbilisi_day(now())), 'CASH1 касса за день: 5 прежних строк (абонемент и 4 вида) и все платежи мероприятий за день');
select is((select count(*)::int from cash_a1, jsonb_array_elements(r -> 'rows') x where x ->> 'kind' = 'Мероприятие'), (select count(*)::int from service_payments where kind = 'event' and paid_on = tbilisi_day(now())), 'CASH1 строк «Мероприятие» ровно по числу платежей за день');
select is((select sum((x ->> 'amount')::numeric) from cash_a1, jsonb_array_elements(r -> 'rows') x where x ->> 'kind' = 'Мероприятие'),
          (select sum(amount) from service_payments where kind = 'event' and paid_on = tbilisi_day(now())), 'CASH1 сумма строк мероприятий = сумма платежей в журнале (нет двойного учёта)');
select is((select (r ->> 'total')::numeric from cash_a1), 70 + 12 + 13 + 14 + 15 + (select sum(amount) from service_payments where kind = 'event' and paid_on = tbilisi_day(now())), 'CASH1 итог периода = прежние виды + платежи мероприятий');
select is((select jsonb_agg(x ->> 'kind' order by x ->> 'kind') from cash_a1, jsonb_array_elements(r -> 'rows') x where x ->> 'kind' <> 'Мероприятие'),
          '["Абонемент", "Доп. занятие", "Доп. посещение", "Индивидуальное", "Оплата за визит"]'::jsonb, 'CASH6 прежние виды в кассе с прежними подписями, без изменений');
select is((select (x ->> 'amount')::numeric from cash_a1, jsonb_array_elements(r -> 'rows') x where x ->> 'kind' = 'Абонемент'), 70.00, 'CASH6 сумма абонемента не изменилась');
select is((select sum((x ->> 'sum')::numeric) from cash_a1, jsonb_array_elements(r -> 'by_method') x), (select (r ->> 'total')::numeric from cash_a1), 'CASH1 разбивка по способу сходится с итогом');
select is((select sum((x ->> 'sum')::numeric) from cash_a1, jsonb_array_elements(r -> 'by_staff') x where x ->> 'name' = 'Админ'),
          (select sum(amount) from service_payments where kind = 'event' and paid_on = tbilisi_day(now())), 'CASH1 разбивка по принявшему: платежи мероприятий записаны на админа');
select is((select count(*)::int from cash_a1, jsonb_array_elements(d) x where x ->> 'what' = 'Мероприятие'), (select count(*)::int from service_payments where kind = 'event' and paid_on = tbilisi_day(now())), 'CASH1 касса дня: строк «Мероприятие» столько же, сколько платежей');
select is((select jsonb_agg(distinct x ->> 'detail' order by x ->> 'detail') from cash_a1, jsonb_array_elements(d) x where x ->> 'what' = 'Мероприятие'),
          '["Бесплатный", "Завершён", "Платный", "Цены"]'::jsonb, 'CASH2 в детали название мероприятия');
select is((select count(*)::int from cash_a1, jsonb_array_elements(d) x where x ->> 'what' = 'Мероприятие' and x ->> 'full_name' = 'Аня' and x ->> 'detail' = 'Платный'), 5, 'CASH3 пять платежей Ани на одно мероприятие за день: пять строк');
select is((select count(distinct x ->> 'detail')::int from cash_a1, jsonb_array_elements(d) x where x ->> 'what' = 'Мероприятие' and x ->> 'full_name' = 'Аня'), 4, 'CASH3 платежи Ани по четырём мероприятиям: четыре названия');
select is((select count(*)::int from cash_a1, jsonb_array_elements(d) x where x ->> 'what' = 'Доп. занятие' and x ->> 'detail' is null), 1, 'CASH2 платёж другого вида показывается как раньше, без названия мероприятия');
select is((select count(*)::int from cash_a1, jsonb_array_elements(d) x where (x ->> 'what') in ('Доп. занятие', 'Индивидуальное', 'Доп. посещение', 'Оплата за визит', 'Мероприятие')), 4 + (select count(*)::int from service_payments where kind = 'event' and paid_on = tbilisi_day(now())), 'CASH6 касса дня: все виды на месте (4 прежних вида и платежи мероприятий)');
select is((select count(*)::int from cash_a1, jsonb_array_elements(r -> 'rows') x where x ->> 'kind' = 'Мероприятие' and (x ->> 'amount')::numeric < 0), 0, 'CASH9 минусовых строк мероприятий нет');
select is((select count(*)::int from pg_proc where proname in ('cash_report', 'cash_day_service') and prosrc like '%tournament_payments%' and prosrc like '%match_payments%' and prosrc like '%service_payments%' and prosrc like '%own_visit%' and prosrc like '%Мероприятие%'), 2, 'CASH7 в телах обеих кассовых функций сохранены ветки прежних видов и добавлена ветка мероприятий');
select is((select count(*)::int from pg_proc where proname = 'cash_report' and prosrc like '%camp_payments%' and prosrc like '%location_admins%' and prosrc like '%opening_balance%'), 1, 'CASH7 cash_report: сборы, локальные админы и opening_balance на месте');

-- CASH4. локальный админ мероприятий не видит
select is((select count(*)::int from jsonb_array_elements(t_cash('00000000-0000-0000-0000-0000000000d1') -> 'rows') x where x ->> 'kind' = 'Мероприятие'), 0, 'CASH4 локальный админ: строк мероприятий в кассе нет');
select is((select (t_cash('00000000-0000-0000-0000-0000000000d1') ->> 'total')::numeric), 0::numeric, 'CASH4 локальный админ: итог без мероприятий');
select is((select count(*)::int from jsonb_array_elements(t_day('00000000-0000-0000-0000-0000000000d1')) x where x ->> 'what' = 'Мероприятие'), 0, 'CASH4 локальный админ: в кассе дня мероприятий нет');
select as_user('00000000-0000-0000-0000-0000000000c1');
select throws_ok($$select cash_report(tbilisi_day(now()), tbilisi_day(now()))$$, '42501', 'forbidden', 'CASH4 тренер: касса закрыта');
select throws_ok($$select cash_day_service(tbilisi_day(now()))$$, '42501', 'forbidden', 'CASH4 тренер: касса дня закрыта');
select as_user('00000000-0000-0000-0000-0000000000b1');
select throws_ok($$select cash_report(tbilisi_day(now()), tbilisi_day(now()))$$, '42501', 'forbidden', 'CASH4 родитель: касса закрыта');
select as_anon();
select throws_ok($$select cash_report(tbilisi_day(now()), tbilisi_day(now()))$$, '42501', null, 'CASH4 anon: касса закрыта');
reset role;
-- as_anon оставляет claims = '': триггер профиля игрока (0209) зовёт current_user_id() при вставке игрока, поэтому как выше (стр. 111) сбрасываем на '{}'.
select set_config('request.jwt.claims', '{}', true);

-- ISO/CASH5. клубная изоляция платежей и кассы
insert into clubs (id, name) values ('00000000-0000-0000-0000-00000000c002', 'Другой клуб');
insert into players (id, club_id, full_name, status) values ('00000000-0000-0000-0000-000000000d99', '00000000-0000-0000-0000-00000000c002', 'Чужой', 'active');
select as_user('00000000-0000-0000-0000-0000000000a1');
select throws_ok($$select club_event_pay(t_ev('Платный'), '00000000-0000-0000-0000-000000000d01', 5, 'Наличные', null, gen_random_uuid())$$, '42501', 'club not determined', 'ISO5 два клуба без users.club_id: платёж закрыт');
select is((select count(*)::int from jsonb_array_elements(cash_report(tbilisi_day(now()), tbilisi_day(now())) -> 'rows') x where x ->> 'kind' = 'Мероприятие'), 0, 'CASH5 два клуба и пустой club_id: платежи мероприятий в кассе не показываются');
select is((select count(*)::int from jsonb_array_elements(cash_day_service(tbilisi_day(now()))) x where x ->> 'what' = 'Мероприятие'), 0, 'CASH5 два клуба и пустой club_id: в кассе дня мероприятий нет');
reset role;
update users set club_id = '00000000-0000-0000-0000-00000000c001' where id = '00000000-0000-0000-0000-0000000000a1';
update users set club_id = '00000000-0000-0000-0000-00000000c002' where id = '00000000-0000-0000-0000-0000000000a2';
select as_user('00000000-0000-0000-0000-0000000000a2');
select lives_ok($$select club_event_create('Клуб 2', null, '2026-12-20', null, null, 30, null, null, null, 'active')$$, 'ISO фикстура: мероприятие клуба 2');
select lives_ok($$select club_event_participant_add(t_ev('Клуб 2'), '00000000-0000-0000-0000-000000000d99')$$, 'ISO фикстура: игрок клуба 2 записан');
select is((club_event_pay(t_ev('Клуб 2'), '00000000-0000-0000-0000-000000000d99', 30, 'Наличные', null, gen_random_uuid()) ->> 'applied')::boolean, true, 'ISO А2 принимает платёж по мероприятию своего клуба');
select throws_ok($$select club_event_pay(t_ev('Платный'), '00000000-0000-0000-0000-000000000d01', 5, 'Наличные', null, gen_random_uuid())$$, '42501', 'forbidden', 'ISO4 А2: платёж по мероприятию клуба 1 отклонён');
select is((select count(*)::int from jsonb_array_elements(cash_report(tbilisi_day(now()), tbilisi_day(now())) -> 'rows') x where x ->> 'kind' = 'Мероприятие'), 1, 'CASH5 А2 видит в кассе только платёж своего клуба');
select is((select count(*)::int from jsonb_array_elements(cash_day_service(tbilisi_day(now()))) x where x ->> 'what' = 'Мероприятие' and x ->> 'detail' = 'Платный'), 0, 'CASH5 А2: мероприятий клуба 1 в кассе дня нет');
select is((select count(*)::int from jsonb_array_elements(club_event_participants_list(t_ev('Клуб 2'))) x where (x ->> 'counted')::numeric = 30), 1, 'ISO А2 видит баланс записи своего мероприятия');
select throws_ok($$select club_event_participants_list(t_ev('Платный'))$$, '42501', 'forbidden', 'ISO4 А2: баланс чужого мероприятия закрыт');
select as_user('00000000-0000-0000-0000-0000000000a1');
select is((select count(*)::int from jsonb_array_elements(cash_report(tbilisi_day(now()), tbilisi_day(now())) -> 'rows') x where x ->> 'kind' = 'Мероприятие'), t_ev_today('00000000-0000-0000-0000-00000000c001'), 'CASH5 А1 видит платежи только своего клуба (платеж клуба 2 не виден)');
select throws_ok($$select club_event_pay(t_ev('Клуб 2'), '00000000-0000-0000-0000-000000000d99', 5, 'Наличные', null, gen_random_uuid())$$, '42501', 'forbidden', 'ISO4 А1: платёж по мероприятию клуба 2 отклонён');
reset role;
select as_owner_with_jwt('00000000-0000-0000-0000-0000000000a2');
select throws_ok($$insert into service_payments (kind, ref_id, player_id, amount, paid_on, method, op, request_id) values ('event', t_ev('Платный'), '00000000-0000-0000-0000-000000000d01', 5, '2026-11-10', 'Наличные', 'payment', gen_random_uuid())$$, '42501', 'forbidden', 'ISO2 триггер: прямая вставка платежа по мероприятию чужого клуба отклонена');
reset role;
select set_config('request.jwt.claims', '', true);

select * from finish();
rollback;
