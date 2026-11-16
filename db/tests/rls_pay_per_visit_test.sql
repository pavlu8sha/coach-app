-- pgTAP: оплата за визит, игрок без абонемента (миграция 0200). Условия: docs/PAY_PER_VISIT_ACCEPTANCE.md. Фикстуры вымышленные.
-- Номера «У…» в комментариях — номера условий приёмки.
begin;
create extension if not exists pgtap;
select plan(61);

insert into clubs (id, name) values ('00000000-0000-0000-0000-00000000c001', 'Клуб');
insert into users (id, telegram_id, display_name, is_admin) values
  ('00000000-0000-0000-0000-0000000000a1', 9901, 'Админ', true),
  ('00000000-0000-0000-0000-0000000000c1', 9902, 'Тренер U9-B', false),
  ('00000000-0000-0000-0000-0000000000b1', 9903, 'Родитель игрока за визит', false),
  ('00000000-0000-0000-0000-0000000000b3', 9904, 'Чужой родитель', false),
  ('00000000-0000-0000-0000-0000000000a2', 9905, 'Локальный админ Чиовани', false),
  ('00000000-0000-0000-0000-0000000000a3', 9906, 'Локальный админ Исани', false);
insert into groups (id, club_id, name, location) values
  ('00000000-0000-0000-0000-0000000000e1', '00000000-0000-0000-0000-00000000c001', 'U9-B', 'Чиовани');
insert into coach_groups (user_id, group_id) values ('00000000-0000-0000-0000-0000000000c1', '00000000-0000-0000-0000-0000000000e1');
insert into location_admins (user_id, location) values
  ('00000000-0000-0000-0000-0000000000a2', 'Чиовани'), ('00000000-0000-0000-0000-0000000000a3', 'Исани');
insert into players (id, club_id, group_id, full_name, status) values
  ('00000000-0000-0000-0000-00000000d001', '00000000-0000-0000-0000-00000000c001', '00000000-0000-0000-0000-0000000000e1', 'Аня (за визит)', 'active'),
  ('00000000-0000-0000-0000-00000000d002', '00000000-0000-0000-0000-00000000c001', '00000000-0000-0000-0000-0000000000e1', 'Боря (абонемент)', 'active'),
  ('00000000-0000-0000-0000-00000000d003', '00000000-0000-0000-0000-00000000c001', '00000000-0000-0000-0000-0000000000e1', 'Вера (абонемент, оплачен)', 'active');
insert into player_guardians (player_id, user_id, consent_version, consent_given_at) values
  ('00000000-0000-0000-0000-00000000d001', '00000000-0000-0000-0000-0000000000b1', 'test', now());
insert into prices (club_id, group_id, kind, amount, valid_from) values ('00000000-0000-0000-0000-00000000c001', null, 'subscription', 165, '2026-09-01');
insert into club_settings (club_id, key, value) values ('00000000-0000-0000-0000-00000000c001', 'parent_debt_enabled', 'true');
insert into rules (club_id, code, points, explanation, active_from) values ('00000000-0000-0000-0000-00000000c001', 'attendance_present', 1, 'Тренировка', date '2026-01-01');
insert into sessions (id, group_id, starts_at, kind, source_key, class) values
  ('00000000-0000-0000-0000-0000000005a1', '00000000-0000-0000-0000-0000000000e1', '2026-11-02 15:00+04', 'training', 'ATT|2026-11-02', 'regular'),
  ('00000000-0000-0000-0000-0000000005a2', '00000000-0000-0000-0000-0000000000e1', '2026-11-03 15:00+04', 'training', 'ATT|2026-11-03', 'regular'),
  ('00000000-0000-0000-0000-0000000005a3', '00000000-0000-0000-0000-0000000000e1', '2026-11-04 15:00+04', 'training', 'ATT|2026-11-04', 'regular'),
  ('00000000-0000-0000-0000-0000000005a0', '00000000-0000-0000-0000-0000000000e1', '2026-10-20 15:00+04', 'training', 'ATT|2026-10-20', 'regular');
-- Боря и Вера: строки абонемента на ноябрь (Вера оплатила, Боря нет)
insert into subscriptions (player_id, group_id, month, amount_due) values
  ('00000000-0000-0000-0000-00000000d002', '00000000-0000-0000-0000-0000000000e1', '2026-11-01', 165),
  ('00000000-0000-0000-0000-00000000d003', '00000000-0000-0000-0000-0000000000e1', '2026-11-01', 165);
insert into payments (player_id, amount, paid_on, method, for_month) values
  ('00000000-0000-0000-0000-00000000d003', 165, '2026-11-03', 'Наличные', '2026-11-01');

create or replace function as_user(uid uuid) returns void language plpgsql as $$
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
end $$;
create temp table snap (k text primary key, v text);
grant all on snap to authenticated;

-- до любых действий: долг игроков с абонементом (У5) и платежи/абонементы (У4)
select as_user('00000000-0000-0000-0000-0000000000a1');
insert into snap select 'debt_other', md5(coalesce((select string_agg(player_id::text || ':' || paid || ':' || debt, ',' order by player_id)
  from debtors('2026-11-01') where player_id <> '00000000-0000-0000-0000-00000000d001'), ''));
reset role;
insert into snap select 'payments', (select count(*) from payments)::text;
insert into snap select 'subs', (select count(*) from subscriptions)::text;

-- У1: тип игрока ставит только администратор
select as_user('00000000-0000-0000-0000-0000000000c1');
select throws_ok($$select player_set_pay_mode('00000000-0000-0000-0000-00000000d001', 'per_visit', '2026-11-01')$$, '42501', 'forbidden', 'У1: тренер тип игрока не меняет');
select as_user('00000000-0000-0000-0000-0000000000b1');
select throws_ok($$select player_set_pay_mode('00000000-0000-0000-0000-00000000d001', 'per_visit', '2026-11-01')$$, '42501', 'forbidden', 'У1: родитель тип игрока не меняет');
reset role;
set local role anon;
select throws_ok($$select player_set_pay_mode('00000000-0000-0000-0000-00000000d001', 'per_visit', '2026-11-01')$$, '42501', null, 'У9: anon не вызывает функцию');
reset role;
select as_user('00000000-0000-0000-0000-0000000000a1');
select throws_ok($$select player_set_pay_mode('00000000-0000-0000-0000-00000000d001', 'weekly', '2026-11-01')$$, '22023', 'bad pay mode', 'У1: неизвестный тип отклоняется');
select lives_ok($$select player_set_pay_mode('00000000-0000-0000-0000-00000000d001', 'per_visit', '2026-11-01')$$, 'У1: админ ставит «Платит за визит» с 01.11');
reset role;
select is((select pay_mode from players where id = '00000000-0000-0000-0000-00000000d001'), 'per_visit', 'У1: тип записан');
select is((select pay_mode from players where id = '00000000-0000-0000-0000-00000000d002'), 'subscription', 'У1: по умолчанию «Абонемент»');

-- У2: начисление визита по отметке «Был»
insert into attendance (session_id, player_id, status) values
  ('00000000-0000-0000-0000-0000000005a1', '00000000-0000-0000-0000-00000000d001', 'present'),
  ('00000000-0000-0000-0000-0000000005a1', '00000000-0000-0000-0000-00000000d002', 'present'),
  ('00000000-0000-0000-0000-0000000005a2', '00000000-0000-0000-0000-00000000d001', 'absent'),
  ('00000000-0000-0000-0000-0000000005a0', '00000000-0000-0000-0000-00000000d001', 'present');
select is((select count(*)::int from own_visits where player_id = '00000000-0000-0000-0000-00000000d001' and session_id = '00000000-0000-0000-0000-0000000005a1'), 1, 'У2: «Был» у игрока за визит создаёт визит');
select is((select amount from own_visits where session_id = '00000000-0000-0000-0000-0000000005a1'), 20.00::numeric, 'У2: сумма 20 по умолчанию');
select is((select paid from own_visits where session_id = '00000000-0000-0000-0000-0000000005a1'), false, 'У2: визит не оплачен (долг)');
select is((select count(*)::int from own_visits where player_id = '00000000-0000-0000-0000-00000000d002'), 0, 'У2: игрок с абонементом визит не получает');
select is((select count(*)::int from own_visits where session_id = '00000000-0000-0000-0000-0000000005a2'), 0, 'У2: «Не был» визит не создаёт');
select is((select count(*)::int from own_visits where session_id = '00000000-0000-0000-0000-0000000005a0'), 0, 'У2: занятие раньше даты начала визит не создаёт');
-- повторная отметка без дубля, смена настройки не меняет прошлые строки
update attendance set status = 'present' where session_id = '00000000-0000-0000-0000-0000000005a1';
select is((select count(*)::int from own_visits where session_id = '00000000-0000-0000-0000-0000000005a1'), 1, 'У2: повторная отметка не создаёт дубль');
insert into club_settings (club_id, key, value) values ('00000000-0000-0000-0000-00000000c001', 'own_visit.fee', '25');
update attendance set status = 'present' where session_id = '00000000-0000-0000-0000-0000000005a2' and player_id = '00000000-0000-0000-0000-00000000d001';
select is((select amount from own_visits where session_id = '00000000-0000-0000-0000-0000000005a2'), 25.00::numeric, 'У2: новая цена из настройки own_visit.fee');
select is((select amount from own_visits where session_id = '00000000-0000-0000-0000-0000000005a1'), 20.00::numeric, 'У2: прошлый визит остался по 20');
update club_settings set value = 'abc' where key = 'own_visit.fee';
select throws_ok($$update attendance set status = 'absent' where session_id = '00000000-0000-0000-0000-0000000005a2' and player_id = '00000000-0000-0000-0000-00000000d001';
  insert into attendance (session_id, player_id, status) values ('00000000-0000-0000-0000-0000000005a3', '00000000-0000-0000-0000-00000000d001', 'present')$$, '22023', 'invalid setting own_visit.fee: abc', 'У2: неверная настройка даёт ошибку');
delete from club_settings where key = 'own_visit.fee';
-- снятие «Был» удаляет неоплаченный визит
update attendance set status = 'absent' where session_id = '00000000-0000-0000-0000-0000000005a2' and player_id = '00000000-0000-0000-0000-00000000d001';
select is((select count(*)::int from own_visits where session_id = '00000000-0000-0000-0000-0000000005a2'), 0, 'У2: снятие «Был» удаляет неоплаченный визит');
-- отметка через рабочую функцию тренера
select as_user('00000000-0000-0000-0000-0000000000c1');
select lives_ok($$select mark_attendance('00000000-0000-0000-0000-0000000005a3', '[{"player_id":"00000000-0000-0000-0000-00000000d001","status":"present"},{"player_id":"00000000-0000-0000-0000-00000000d002","status":"present"},{"player_id":"00000000-0000-0000-0000-00000000d003","status":"absent"}]')$$, 'У2: тренер отмечает через mark_attendance');
reset role;
select is((select count(*)::int from own_visits where session_id = '00000000-0000-0000-0000-0000000005a3' and amount = 20), 1, 'У2: визит создан и через mark_attendance');

-- У3: оплата
select as_user('00000000-0000-0000-0000-0000000000b1');
select throws_ok($$select own_visit_set_paid('00000000-0000-0000-0000-0000000005a1', '00000000-0000-0000-0000-00000000d001', true, 'Наличные')$$, '42501', 'forbidden', 'У3: родитель оплату принять не может');
select as_user('00000000-0000-0000-0000-0000000000c1');
select throws_ok($$select own_visit_set_paid('00000000-0000-0000-0000-0000000005a1', '00000000-0000-0000-0000-00000000d001', true, null)$$, '22023', 'bad method', 'У3: способ обязателен');
select lives_ok($$select own_visit_set_paid('00000000-0000-0000-0000-0000000005a1', '00000000-0000-0000-0000-00000000d001', true, 'Наличные', null, '2026-11-02')$$, 'У3: тренер принимает оплату визита');
select lives_ok($$select own_visit_set_paid('00000000-0000-0000-0000-0000000005a1', '00000000-0000-0000-0000-00000000d001', true, 'Наличные', null, '2026-11-02')$$, 'У3: повторная оплата не падает');
reset role;
select is((select count(*)::int from service_payments where kind = 'own_visit' and ref_id = '00000000-0000-0000-0000-0000000005a1'), 1, 'У3: одна запись в журнале');
select is((select amount from service_payments where kind = 'own_visit' and ref_id = '00000000-0000-0000-0000-0000000005a1'), 20.00::numeric, 'У3: сумма по умолчанию 20');
select is((select recorded_by from service_payments where kind = 'own_visit' and ref_id = '00000000-0000-0000-0000-0000000005a1'), '00000000-0000-0000-0000-0000000000c1'::uuid, 'У3: автора ставит сервер');
-- оплаченный визит нельзя потерять
select throws_ok($$update attendance set status = 'absent' where session_id = '00000000-0000-0000-0000-0000000005a1' and player_id = '00000000-0000-0000-0000-00000000d001'$$, '22023', 'visit paid', 'У2: оплаченный визит не снять отметкой');
select as_user('00000000-0000-0000-0000-0000000000c1');
select throws_ok($$select own_visit_set_paid('00000000-0000-0000-0000-0000000005a1', '00000000-0000-0000-0000-00000000d001', false)$$, '42501', 'forbidden', 'У3: оплату снимает только администратор');
select as_user('00000000-0000-0000-0000-0000000000a1');
select lives_ok($$select own_visit_set_paid('00000000-0000-0000-0000-0000000005a1', '00000000-0000-0000-0000-00000000d001', false, null, null, '2026-11-02')$$, 'У3: администратор снимает оплату');
reset role;
select is((select sum(amount) from service_payments where kind = 'own_visit' and ref_id = '00000000-0000-0000-0000-0000000005a1'), 0.00::numeric, 'У3: отмена минусовой строкой, сумма журнала 0');
select is((select paid from own_visits where session_id = '00000000-0000-0000-0000-0000000005a1'), false, 'У3: визит снова не оплачен');
select as_user('00000000-0000-0000-0000-0000000000a1');
select lives_ok($$select own_visit_set_paid('00000000-0000-0000-0000-0000000005a1', '00000000-0000-0000-0000-00000000d001', true, 'Перевод', 20, '2026-11-02')$$, 'У3: оплата после отмены принимается заново');
reset role;

-- У4: абонемент не затронут
select is((select count(*)::text from payments), (select v from snap where k = 'payments'), 'У4: payments не изменились');
select is((select count(*)::text from subscriptions), (select v from snap where k = 'subs'), 'У4: subscriptions не изменились');

-- У5: долги
select as_user('00000000-0000-0000-0000-0000000000a1');
select is((select count(*)::int from debtors('2026-11-01') where player_id = '00000000-0000-0000-0000-00000000d001'), 0, 'У5: игрок за визит не в «Должниках» (нет ложных 165 - 40)');
select is(md5(coalesce((select string_agg(player_id::text || ':' || paid || ':' || debt, ',' order by player_id)
  from debtors('2026-11-01') where player_id <> '00000000-0000-0000-0000-00000000d001'), '')), (select v from snap where k = 'debt_other'), 'У5: у остальных игроков «Должники» прежние');
select is((select count(*)::int from debtors('2026-11-01') where player_id = '00000000-0000-0000-0000-00000000d002'), 1, 'У5: должник с абонементом остался в списке');
reset role;
select as_user('00000000-0000-0000-0000-0000000000b1');
select is((select count(*)::int from parent_debts() where player_id = '00000000-0000-0000-0000-00000000d001' and month >= '2026-11-01'), 0, 'У5: у родителя нет долга по абонементу за месяцы за визит');
select is((select count(*)::int from parent_dues() where kind = 'own_visit' and player_id = '00000000-0000-0000-0000-00000000d001'), 2, 'У5: родитель видит два визита (оплаченный и неоплаченный)');
select is((select sum(debt) from parent_dues() where kind = 'own_visit'), 20.00::numeric, 'У5: долг за визит 20 (визит 04.11)');
select is((select sum(paid) from parent_dues() where kind = 'own_visit'), 20.00::numeric, 'У5: внесено за визит 20');
select as_user('00000000-0000-0000-0000-0000000000b3');
select is((select count(*)::int from parent_dues() where kind = 'own_visit'), 0, 'У5: чужой родитель визитов не видит');
reset role;
-- автосоздание абонементов не создаёт строку игроку за визит
select is((select subscription_month_auto('2026-11-01')), 0, 'У4: автосоздание строк абонемента не трогает игрока за визит');
select is((select count(*)::int from subscriptions where player_id = '00000000-0000-0000-0000-00000000d001'), 0, 'У4: у игрока за визит нет строки абонемента');
-- месяц до даты начала считается как раньше
select is((select count(*)::int from subscriptions where month = '2026-11-01'), 2, 'У4: строки абонементов остальных на месте');

-- У6: итог за месяц
select as_user('00000000-0000-0000-0000-0000000000a1');
select is((player_visit_month('00000000-0000-0000-0000-00000000d001', '2026-11-01') ->> 'visits')::int, 2, 'У6: два визита за ноябрь');
select is((player_visit_month('00000000-0000-0000-0000-00000000d001', '2026-11-01') ->> 'accrued')::numeric, 40.00::numeric, 'У6: начислено 40');
select is((player_visit_month('00000000-0000-0000-0000-00000000d001', '2026-11-01') ->> 'paid')::numeric, 20.00::numeric, 'У6: оплачено 20');
select is((player_visit_month('00000000-0000-0000-0000-00000000d001', '2026-11-01') ->> 'subscription_price')::numeric, 165.00::numeric, 'У6: справочно цена абонемента 165');
reset role;

-- У8: касса
select as_user('00000000-0000-0000-0000-0000000000a1');
select is((select (r ->> 'kind') from jsonb_array_elements(cash_report('2026-11-01', '2026-11-30') -> 'rows') r where r ->> 'player' = 'Аня (за визит)' limit 1), 'Оплата за визит', 'У8: в кассе вид «Оплата за визит»');
select is((cash_report('2026-11-01', '2026-11-30') ->> 'total')::numeric, 185.00::numeric, 'У8: итог кассы: абонемент 165 + визит 20 (отменённая и повторная оплата сошлись)');
select is((select count(*)::int from jsonb_array_elements(cash_day_service('2026-11-02')) e where e ->> 'what' = 'Оплата за визит'), 3, 'У8: за день три записи (оплата, отмена, повторная)');
select as_user('00000000-0000-0000-0000-0000000000a3');
select is((select count(*)::int from jsonb_array_elements(cash_day_service('2026-11-02')) e where e ->> 'what' = 'Оплата за визит'), 0, 'У8: админ чужой локации оплату не видит');
select as_user('00000000-0000-0000-0000-0000000000a2');
select is((select count(*)::int from jsonb_array_elements(cash_day_service('2026-11-02')) e where e ->> 'what' = 'Оплата за визит'), 3, 'У8: админ локации Чиовани видит оплаты своей локации');
reset role;

-- У9: доступ
select as_user('00000000-0000-0000-0000-0000000000b1');
select throws_ok($$insert into own_visits (session_id, player_id, amount) values ('00000000-0000-0000-0000-0000000005a2', '00000000-0000-0000-0000-00000000d001', 1)$$, '42501', null, 'У9: прямая запись в own_visits закрыта');
select ok((select count(*) from own_visits) = 2, 'У9: родитель читает визиты только своего ребёнка');
select as_user('00000000-0000-0000-0000-0000000000b3');
select is((select count(*)::int from own_visits), 0, 'У9: чужой родитель не читает таблицу');
select as_user('00000000-0000-0000-0000-0000000000c1');
select ok((select count(*) from own_visits) > 0, 'У9: тренер читает таблицу');
reset role;
select ok(has_function_privilege('authenticated', 'own_visit_set_paid(uuid,uuid,boolean,text,numeric,date)', 'execute')
  and not has_function_privilege('anon', 'own_visit_set_paid(uuid,uuid,boolean,text,numeric,date)', 'execute')
  and not has_function_privilege('anon', 'player_set_pay_mode(uuid,text,date)', 'execute')
  and not has_function_privilege('authenticated', 'own_visit_fee(uuid)', 'execute')
  and not has_function_privilege('authenticated', 'player_per_visit_month(uuid,date)', 'execute'), 'У9: права функций: authenticated да, anon нет, служебные закрыты');

-- У10: платежи неизменяемы
select throws_ok($$delete from service_payments where kind = 'own_visit'$$, 'P0001', 'payment history is immutable', 'У10: платежи за визит не удаляются');

select * from finish();
rollback;
