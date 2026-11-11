-- pgTAP: разовые посещения тренировок другой группы (миграция 0178). Условия: docs/GUEST_VISIT_ACCEPTANCE.md. Фикстуры вымышленные.
-- Номера «У…» в комментариях — номера условий приёмки.
begin;
create extension if not exists pgtap;
select plan(69);

insert into clubs (id, name) values ('00000000-0000-0000-0000-00000000c001', 'Клуб');
insert into users (id, telegram_id, display_name, is_admin) values
  ('00000000-0000-0000-0000-0000000000a1', 9801, 'Админ', true),
  ('00000000-0000-0000-0000-0000000000c1', 9802, 'Тренер U9-B', false),
  ('00000000-0000-0000-0000-0000000000b1', 9803, 'Родитель гостя', false),
  ('00000000-0000-0000-0000-0000000000b2', 9804, 'Родитель хозяев', false),
  ('00000000-0000-0000-0000-0000000000b3', 9805, 'Чужой родитель', false),
  ('00000000-0000-0000-0000-0000000000a2', 9806, 'Локальный админ', false);
insert into groups (id, club_id, name, location) values
  ('00000000-0000-0000-0000-0000000000e1', '00000000-0000-0000-0000-00000000c001', 'U9-B', 'Чиовани'),
  ('00000000-0000-0000-0000-0000000000e2', '00000000-0000-0000-0000-00000000c001', 'U9-A', 'Исани');
insert into coach_groups (user_id, group_id) values ('00000000-0000-0000-0000-0000000000c1', '00000000-0000-0000-0000-0000000000e1');
insert into location_admins (user_id, location) values ('00000000-0000-0000-0000-0000000000a2', 'Чиовани');
insert into players (id, club_id, group_id, full_name, status) values
  ('00000000-0000-0000-0000-00000000d001', '00000000-0000-0000-0000-00000000c001', '00000000-0000-0000-0000-0000000000e1', 'Аня (U9-B)', 'active'),
  ('00000000-0000-0000-0000-00000000d002', '00000000-0000-0000-0000-00000000c001', '00000000-0000-0000-0000-0000000000e2', 'Тимофей (гость из U9-A)', 'active'),
  ('00000000-0000-0000-0000-00000000d003', '00000000-0000-0000-0000-00000000c001', '00000000-0000-0000-0000-0000000000e2', 'Вера (пауза)', 'paused'),
  ('00000000-0000-0000-0000-00000000d004', '00000000-0000-0000-0000-00000000c001', '00000000-0000-0000-0000-0000000000e1', 'Боря (U9-B)', 'active');
insert into player_guardians (player_id, user_id, consent_version, consent_given_at) values
  ('00000000-0000-0000-0000-00000000d002', '00000000-0000-0000-0000-0000000000b1', 'test', now()),
  ('00000000-0000-0000-0000-00000000d001', '00000000-0000-0000-0000-0000000000b2', 'test', now());
insert into prices (club_id, group_id, kind, amount, valid_from) values ('00000000-0000-0000-0000-00000000c001', null, 'subscription', 165, '2026-09-01');
insert into club_settings (club_id, key, value) values ('00000000-0000-0000-0000-00000000c001', 'parent_debt_enabled', 'true');
-- правила баллов действуют с 01.11.2026 (тестовый запуск), как на проде
insert into rules (club_id, code, points, explanation, active_from) values ('00000000-0000-0000-0000-00000000c001', 'attendance_present', 1, 'Тренировка', date '2026-01-01');
insert into points_rule_versions (id, club_id, effective_from, params) values ('00000000-0000-0000-0000-0000000000f1', '00000000-0000-0000-0000-00000000c001', '2026-11-01', jsonb_build_object(
  'training', jsonb_build_object('group', 1, 'individual', 2, 'goalkeeper', 2, 'extra', 2, 'moved_group', 1),
  'match', jsonb_build_object('played', 1, 'draw', 1, 'win', 2, 'goal', 1, 'best', 2, 'cap', 5, 'technical', 0),
  'manual', jsonb_build_object('values', jsonb_build_array(1, 2, 3), 'limits', jsonb_build_object('1', 3, '2', 2, '3', 1), 'month_cap', 10),
  'series', jsonb_build_object('thresholds', jsonb_build_array()),
  'group_benchmark', jsonb_build_object('min_size', 5),
  'enabled', jsonb_build_object('training', true, 'match', true, 'series', true, 'manual', true, 'benchmark', true)));
-- занятия U9-B: обычное, перенесённое, внеплановое, ещё два обычных и одно в будущем
insert into sessions (id, group_id, starts_at, kind, source_key, class) values
  ('00000000-0000-0000-0000-0000000005a1', '00000000-0000-0000-0000-0000000000e1', '2026-11-02 15:00+04', 'training', 'ATT|2026-11-02', 'regular'),
  ('00000000-0000-0000-0000-0000000005a2', '00000000-0000-0000-0000-0000000000e1', '2026-11-03 15:00+04', 'training', 'ATT|2026-11-03|m', 'moved'),
  ('00000000-0000-0000-0000-0000000005a3', '00000000-0000-0000-0000-0000000000e1', '2026-11-04 12:00+04', 'training', 'ATT|2026-11-04|u', 'unscheduled'),
  ('00000000-0000-0000-0000-0000000005a4', '00000000-0000-0000-0000-0000000000e1', '2026-11-05 15:00+04', 'training', 'ATT|2026-11-05', 'regular'),
  ('00000000-0000-0000-0000-0000000005a5', '00000000-0000-0000-0000-0000000000e1', '2026-11-06 15:00+04', 'training', 'ATT|2026-11-06', 'regular');
insert into sessions (id, group_id, starts_at, kind, source_key, class)
  values ('00000000-0000-0000-0000-0000000005af', '00000000-0000-0000-0000-0000000000e1', ((now() at time zone 'Asia/Tbilisi')::date + 3 + time '15:00') at time zone 'Asia/Tbilisi', 'training', 'ATT|future', 'regular');

create or replace function as_user(uid uuid) returns void language plpgsql as $$
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
end $$;
create temp table snap (k text primary key, v text);
grant all on snap to authenticated;

-- снимок долга и платежей до любых посещений (У6)
select as_user('00000000-0000-0000-0000-0000000000a1');
insert into snap select 'debt', md5(coalesce((select string_agg(player_id::text || ':' || paid || ':' || debt, ',' order by player_id) from debtors('2026-11-01')), ''));
insert into snap select 'debt_rows', (select count(*) from debtors('2026-11-01'))::text;
reset role;
insert into snap select 'payments', (select count(*) from payments)::text;
insert into snap select 'subs', (select count(*) from subscriptions)::text;

-- У1: добавление гостя
select as_user('00000000-0000-0000-0000-0000000000c1');
select lives_ok($$select session_guest_add('00000000-0000-0000-0000-0000000005a1', '00000000-0000-0000-0000-00000000d002')$$, 'У1: тренер добавляет гостя из другой группы');
select lives_ok($$select session_guest_add('00000000-0000-0000-0000-0000000005a1', '00000000-0000-0000-0000-00000000d002')$$, 'У1: повторное добавление не падает');
select is((select count(*)::int from session_guests where session_id = '00000000-0000-0000-0000-0000000005a1'), 1, 'У1: повтор не создаёт дубля');
select is((select amount from session_guests where session_id = '00000000-0000-0000-0000-0000000005a1' and player_id = '00000000-0000-0000-0000-00000000d002'), 15.00::numeric, 'У4: сумма посещения по умолчанию 15');
select is((select added_by from session_guests where session_id = '00000000-0000-0000-0000-0000000005a1'), '00000000-0000-0000-0000-0000000000c1'::uuid, 'У1: автора ставит сервер');
select throws_ok($$select session_guest_add('00000000-0000-0000-0000-0000000005a1', '00000000-0000-0000-0000-00000000d004')$$, '22023', 'same group', 'У1: игрока той же группы гостем не сделать');
select throws_ok($$select session_guest_add('00000000-0000-0000-0000-0000000005a1', '00000000-0000-0000-0000-00000000d003')$$, '22023', 'player not active', 'У1: игрока не в статусе «Занимается» нельзя');
select throws_ok($$select session_guest_add('00000000-0000-0000-0000-0000000005af', '00000000-0000-0000-0000-00000000d002')$$, '22023', 'date in the future', 'У1: занятие в будущем нельзя');
select throws_ok($$select session_guest_add('00000000-0000-0000-0000-00000000dead', '00000000-0000-0000-0000-00000000d002')$$, 'P0002', 'session not found', 'У1: нет такого занятия');
select throws_ok($$select session_guest_add('00000000-0000-0000-0000-0000000005a1', '00000000-0000-0000-0000-00000000dead')$$, 'P0002', 'player not found', 'У1: нет такого игрока');
select as_user('00000000-0000-0000-0000-0000000000b1');
select throws_ok($$select session_guest_add('00000000-0000-0000-0000-0000000005a2', '00000000-0000-0000-0000-00000000d002')$$, '42501', 'forbidden', 'У1: родитель гостя добавить не может');
reset role;
set local role anon;
select throws_ok($$select session_guest_add('00000000-0000-0000-0000-0000000005a2', '00000000-0000-0000-0000-00000000d002')$$, '42501', null, 'У10: гость без роли (anon) не может вызвать функцию');
reset role;

-- У2: учёт группы не затронут. Рабочее правило баллов: все активные игроки группы должны быть отмечены (Аня и Боря), гостя в списке нет
select is((select count(*)::int from attendance where session_id = '00000000-0000-0000-0000-0000000005a1'), 0, 'У2: гость не попадает в attendance');
select as_user('00000000-0000-0000-0000-0000000000c1');
select lives_ok($$select mark_attendance('00000000-0000-0000-0000-0000000005a1', '[{"player_id":"00000000-0000-0000-0000-00000000d001","status":"present"},{"player_id":"00000000-0000-0000-0000-00000000d004","status":"absent"}]')$$, 'У2: список группы без гостя считается полным');
reset role;
select is((select count(*)::int from attendance where session_id = '00000000-0000-0000-0000-0000000005a1'), 2, 'У2: в attendance только игроки группы');

-- У3: баллы
select is((select points from points_ledger where source_id = '00000000-0000-0000-0000-0000000005a1' and player_id = '00000000-0000-0000-0000-00000000d002' and status = 'active'), 1, 'У3: гость на обычном занятии +1');
select is((select group_id from points_ledger where source_id = '00000000-0000-0000-0000-0000000005a1' and player_id = '00000000-0000-0000-0000-00000000d002' and status = 'active'), '00000000-0000-0000-0000-0000000000e2'::uuid, 'У3: группа в журнале — собственная группа гостя');
select is((select components ->> 'guest' from points_ledger where source_id = '00000000-0000-0000-0000-0000000005a1' and player_id = '00000000-0000-0000-0000-00000000d002' and status = 'active'), 'true', 'У3: в компонентах guest = true');
select is((select reason_code from points_ledger where source_id = '00000000-0000-0000-0000-0000000005a1' and player_id = '00000000-0000-0000-0000-00000000d002' and status = 'active'), 'attended', 'У3: причина attended');
select is((select count(*)::int from points_ledger where source_id = '00000000-0000-0000-0000-0000000005a1' and status = 'active'), 2, 'У3: у занятия две строки: игрок группы и гость, они не мешают друг другу');
select is((select points from points_ledger where source_id = '00000000-0000-0000-0000-0000000005a1' and player_id = '00000000-0000-0000-0000-00000000d001' and status = 'active'), 1, 'У3: баллы игрока группы прежние');
-- перенесённое +1, внеплановое +2
select as_user('00000000-0000-0000-0000-0000000000a1');
select session_guest_add('00000000-0000-0000-0000-0000000005a2', '00000000-0000-0000-0000-00000000d002');
select session_guest_add('00000000-0000-0000-0000-0000000005a3', '00000000-0000-0000-0000-00000000d002');
reset role;
select is((select points from points_ledger where source_id = '00000000-0000-0000-0000-0000000005a2' and player_id = '00000000-0000-0000-0000-00000000d002' and status = 'active'), 1, 'У3: перенесённое занятие +1');
select is((select points from points_ledger where source_id = '00000000-0000-0000-0000-0000000005a3' and player_id = '00000000-0000-0000-0000-00000000d002' and status = 'active'), 2, 'У3: внеплановое занятие +2');
select is((select count(*)::int from points_series_scan('00000000-0000-0000-0000-00000000d002')), 0, 'У2: серии гостя не считаются по занятиям других групп');
select is((points_consistency_run(false) -> 'drift'), '[]'::jsonb, 'У3: сверка баллов не находит расхождений');
select is((points_consistency_run(true) ->> 'changes')::int, 0, 'У3: повторный пересчёт ничего не меняет');
-- до даты старта подсчёта баллов нет
insert into sessions (id, group_id, starts_at, kind, source_key, class)
  values ('00000000-0000-0000-0000-0000000005b0', '00000000-0000-0000-0000-0000000000e1', '2026-10-20 15:00+04', 'training', 'ATT|2026-10-20', 'regular');
select as_user('00000000-0000-0000-0000-0000000000a1');
select session_guest_add('00000000-0000-0000-0000-0000000005b0', '00000000-0000-0000-0000-00000000d002');
reset role;
select is((select count(*)::int from points_ledger where source_id = '00000000-0000-0000-0000-0000000005b0'), 0, 'У3: до вступления правил баллов нет');

-- У3: родитель видит баллы гостя, чужой нет
select as_user('00000000-0000-0000-0000-0000000000b1');
select is((select count(*)::int from points_ledger where player_id = '00000000-0000-0000-0000-00000000d002' and status = 'active'), 3, 'У3: родитель гостя видит три начисления');
select as_user('00000000-0000-0000-0000-0000000000b3');
select is((select count(*)::int from points_ledger where player_id = '00000000-0000-0000-0000-00000000d002'), 0, 'У3: чужой родитель баллов не видит');
reset role;

-- У4: сумма фиксируется при добавлении; неверная настройка — ошибка
insert into club_settings (club_id, key, value) values ('00000000-0000-0000-0000-00000000c001', 'visit.fee', '20');
select as_user('00000000-0000-0000-0000-0000000000a1');
select session_guest_add('00000000-0000-0000-0000-0000000005a4', '00000000-0000-0000-0000-00000000d002');
reset role;
select is((select amount from session_guests where session_id = '00000000-0000-0000-0000-0000000005a4'), 20.00::numeric, 'У4: сумма из настройки visit.fee');
select is((select amount from session_guests where session_id = '00000000-0000-0000-0000-0000000005a1'), 15.00::numeric, 'У4: прежнее посещение сохранило свою сумму');
update club_settings set value = 'abc' where key = 'visit.fee';
select as_user('00000000-0000-0000-0000-0000000000a1');
select throws_ok($$select session_guest_add('00000000-0000-0000-0000-0000000005a5', '00000000-0000-0000-0000-00000000d002')$$, '22023', 'invalid setting visit.fee: abc', 'У4: неверная настройка — ошибка, не дефолт');
reset role;
delete from club_settings where key = 'visit.fee';

-- У5: оплата
select as_user('00000000-0000-0000-0000-0000000000c1');
select throws_ok($$select session_guest_set_paid('00000000-0000-0000-0000-0000000005a1', '00000000-0000-0000-0000-00000000d002', true, null)$$, '22023', 'bad method', 'У5: без способа оплаты нельзя');
select lives_ok($$select session_guest_set_paid('00000000-0000-0000-0000-0000000005a1', '00000000-0000-0000-0000-00000000d002', true, 'Наличные', null, '2026-11-02')$$, 'У5: тренер принимает оплату');
select lives_ok($$select session_guest_set_paid('00000000-0000-0000-0000-0000000005a1', '00000000-0000-0000-0000-00000000d002', true, 'Наличные', null, '2026-11-02')$$, 'У5: повторная оплата не падает');
reset role;
select is((select count(*)::int from service_payments where kind = 'visit' and ref_id = '00000000-0000-0000-0000-0000000005a1' and player_id = '00000000-0000-0000-0000-00000000d002'), 1, 'У5: одна строка оплаты вида visit');
select is((select amount from service_payments where kind = 'visit' and ref_id = '00000000-0000-0000-0000-0000000005a1'), 15.00::numeric, 'У5: сумма оплаты 15');
select is((select method || '/' || recorded_by::text from service_payments where kind = 'visit' and ref_id = '00000000-0000-0000-0000-0000000005a1'), 'Наличные/00000000-0000-0000-0000-0000000000c1', 'У5: способ и автор (тренер) записаны');
select is((select paid from session_guests where session_id = '00000000-0000-0000-0000-0000000005a1'), true, 'У5: гость отмечен оплаченным');

-- У6: абонемент и долг не затронуты
select is((select count(*)::text from payments), (select v from snap where k = 'payments'), 'У6: таблица payments не менялась');
select is((select count(*)::text from subscriptions), (select v from snap where k = 'subs'), 'У6: абонементы не менялись');
select as_user('00000000-0000-0000-0000-0000000000a1');
select is((select md5(coalesce(string_agg(player_id::text || ':' || paid || ':' || debt, ',' order by player_id), '')) from debtors('2026-11-01')), (select v from snap where k = 'debt'), 'У6: список должников и суммы не изменились');

-- У5: снятие оплаты только администратором
select as_user('00000000-0000-0000-0000-0000000000c1');
select throws_ok($$select session_guest_set_paid('00000000-0000-0000-0000-0000000005a1', '00000000-0000-0000-0000-00000000d002', false)$$, '42501', 'forbidden', 'У5: тренер оплату не снимает');
-- У7: оплаченного гостя убрать нельзя
select throws_ok($$select session_guest_remove('00000000-0000-0000-0000-0000000005a1', '00000000-0000-0000-0000-00000000d002')$$, '22023', 'visit paid', 'У7: оплаченного гостя убрать нельзя');
select as_user('00000000-0000-0000-0000-0000000000a1');
select lives_ok($$select session_guest_set_paid('00000000-0000-0000-0000-0000000005a1', '00000000-0000-0000-0000-00000000d002', false, null, null, '2026-11-02')$$, 'У5: администратор снимает оплату');
reset role;
select is((select string_agg(amount::text, ',' order by amount) from service_payments where kind = 'visit' and ref_id = '00000000-0000-0000-0000-0000000005a1'), '-15.00,15.00', 'У5: отмена — строка с минусом, история сохранена');
select is((select count(*)::int from service_payments c join service_payments o on o.id = c.cancels where c.kind = 'visit' and c.amount = -15 and o.amount = 15), 1, 'У5: минус привязан к исходной оплате');
select is((select paid from session_guests where session_id = '00000000-0000-0000-0000-0000000005a1'), false, 'У5: статус вернулся в «не оплачено»');
-- У7: неоплаченного убрать можно, баллы снимаются
select as_user('00000000-0000-0000-0000-0000000000c1');
select lives_ok($$select session_guest_remove('00000000-0000-0000-0000-0000000005a1', '00000000-0000-0000-0000-00000000d002')$$, 'У7: неоплаченного гостя убирают');
reset role;
select is((select count(*)::int from points_ledger where source_id = '00000000-0000-0000-0000-0000000005a1' and player_id = '00000000-0000-0000-0000-00000000d002' and status = 'active'), 0, 'У7: баллы гостя сняты');
select is((select count(*)::int from points_ledger where source_id = '00000000-0000-0000-0000-0000000005a1' and player_id = '00000000-0000-0000-0000-00000000d002' and status = 'cancelled'), 1, 'У7: в журнале строка «отменено», история сохранена');

-- У8: касса. Оплачиваем занятие 02.11 заново на 15, занятие 03.11 на 15 (после этого сумма по гостям 30)
select as_user('00000000-0000-0000-0000-0000000000a1');
select session_guest_add('00000000-0000-0000-0000-0000000005a1', '00000000-0000-0000-0000-00000000d002');
select session_guest_set_paid('00000000-0000-0000-0000-0000000005a1', '00000000-0000-0000-0000-00000000d002', true, 'Перевод', null, '2026-11-02');
select is((select count(*)::int from jsonb_array_elements(cash_report('2026-11-02', '2026-11-02') -> 'rows') r where r ->> 'kind' = 'Разовое посещение'), 3, 'У8: в кассовом отчёте три строки (оплата, минус, новая оплата)');
select is((cash_report('2026-11-02', '2026-11-02', 'Чиовани') ->> 'total')::numeric, 15.00::numeric, 'У8: итог за день: 15 − 15 + 15 = 15, локация из группы занятия');
select is((select r ->> 'location' from jsonb_array_elements(cash_report('2026-11-02', '2026-11-02') -> 'rows') r where r ->> 'kind' = 'Разовое посещение' limit 1), 'Чиовани', 'У8: локация посещения — локация группы занятия');
select is((select count(*)::int from jsonb_array_elements(cash_day_service('2026-11-02')) r where r ->> 'what' = 'Разовое посещение'), 3, 'У8: «Внесено за день» показывает разовое посещение');
select as_user('00000000-0000-0000-0000-0000000000a2');
select is((select count(*)::int from jsonb_array_elements(cash_report('2026-11-02', '2026-11-02') -> 'rows') r where r ->> 'kind' = 'Разовое посещение'), 0, 'У8: локальный админ чужие (не им принятые) оплаты не видит');
reset role;

-- У9: родитель
select as_user('00000000-0000-0000-0000-0000000000b1');
select is((select title from parent_calendar('00000000-0000-0000-0000-00000000d002', '2026-11-01', '2026-11-10') where event_id = 'guest:00000000-0000-0000-0000-0000000005a1'), 'Разовое посещение: U9-B', 'У9: календарь гостя показывает разовое посещение с группой');
select is((select attendance_status from parent_calendar('00000000-0000-0000-0000-00000000d002', '2026-11-01', '2026-11-10') where event_id = 'guest:00000000-0000-0000-0000-0000000005a1'), 'present', 'У9: отметка «был»');
select ok(exists (select 1 from parent_dues() where kind = 'visit' and on_date = '2026-11-02' and due = 15 and paid = 15 and debt = 0 and player_id = '00000000-0000-0000-0000-00000000d002'), 'У9: в оплатах родителя строка visit: к оплате 15, внесено 15, долга нет');
select ok(exists (select 1 from parent_dues() where kind = 'visit' and on_date = '2026-11-05' and due = 20 and paid = 0 and debt = 20), 'У9: неоплаченное посещение — долг 20');
select as_user('00000000-0000-0000-0000-0000000000b2');
select is((select count(*)::int from parent_calendar('00000000-0000-0000-0000-00000000d001', '2026-11-01', '2026-11-10') where event_id like 'guest:%'), 0, 'У9: родитель принимающей группы гостя в календаре своего ребёнка не видит');
select throws_ok($$select * from parent_calendar('00000000-0000-0000-0000-00000000d002', '2026-11-01', '2026-11-10')$$, '42501', 'forbidden', 'У9: чужого ребёнка календарь закрыт');
select is((select count(*)::int from parent_dues() where kind = 'visit'), 0, 'У9: родитель принимающей группы посещений гостя в оплатах не видит');
select as_user('00000000-0000-0000-0000-0000000000b3');
select is((select count(*)::int from parent_dues() where kind = 'visit'), 0, 'У9: чужой родитель в оплатах ничего не видит');

-- У10: доступ
select as_user('00000000-0000-0000-0000-0000000000b1');
select throws_ok($$insert into session_guests (session_id, player_id, amount) values ('00000000-0000-0000-0000-0000000005a2', '00000000-0000-0000-0000-00000000d002', 1)$$, '42501', null, 'У10: прямая запись в session_guests закрыта');
select is((select count(*)::int from session_guests), 5, 'У10: родитель гостя читает записи только своего ребёнка (пять посещений)');
select as_user('00000000-0000-0000-0000-0000000000b3');
select is((select count(*)::int from session_guests), 0, 'У10: чужой родитель не читает таблицу');
select as_user('00000000-0000-0000-0000-0000000000c1');
select ok((select count(*) from session_guests) > 0, 'У10: тренер читает таблицу');
reset role;
select ok(has_function_privilege('authenticated', 'session_guest_add(uuid,uuid)', 'execute') and not has_function_privilege('anon', 'session_guest_add(uuid,uuid)', 'execute') and not has_function_privilege('anon', 'session_guest_set_paid(uuid,uuid,boolean,text,numeric,date)', 'execute') and not has_function_privilege('authenticated', 'guest_visit_fee(uuid)', 'execute'), 'У10: права функций: authenticated да, anon нет, служебная закрыта');

select * from finish();
rollback;
