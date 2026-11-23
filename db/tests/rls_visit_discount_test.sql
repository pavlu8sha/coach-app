-- pgTAP: скидка на доп. посещение и закрытие без оплаты (миграция 0221). Условия: docs/VISIT_DISCOUNT_ACCEPTANCE.md. Фикстуры вымышленные.
begin;
create extension if not exists pgtap;
select plan(31);

insert into clubs (id, name) values ('00000000-0000-0000-0000-00000000c001', 'Клуб');
insert into users (id, telegram_id, display_name, is_admin) values
  ('00000000-0000-0000-0000-0000000000a1', 9901, 'Админ', true),
  ('00000000-0000-0000-0000-0000000000c1', 9902, 'Тренер U9-B', false),
  ('00000000-0000-0000-0000-0000000000b1', 9903, 'Родитель гостя', false);
insert into groups (id, club_id, name, location) values
  ('00000000-0000-0000-0000-0000000000e1', '00000000-0000-0000-0000-00000000c001', 'U9-B', 'Чиовани'),
  ('00000000-0000-0000-0000-0000000000e2', '00000000-0000-0000-0000-00000000c001', 'U9-A', 'Исани');
insert into coach_groups (user_id, group_id) values ('00000000-0000-0000-0000-0000000000c1', '00000000-0000-0000-0000-0000000000e1');
insert into players (id, club_id, group_id, full_name, status) values
  ('00000000-0000-0000-0000-00000000d001', '00000000-0000-0000-0000-00000000c001', '00000000-0000-0000-0000-0000000000e2', 'Тимофей (гость из U9-A)', 'active'),
  ('00000000-0000-0000-0000-00000000d002', '00000000-0000-0000-0000-00000000c001', '00000000-0000-0000-0000-0000000000e2', 'Вера (гость из U9-A)', 'active'),
  ('00000000-0000-0000-0000-00000000d003', '00000000-0000-0000-0000-00000000c001', '00000000-0000-0000-0000-0000000000e2', 'Лев (гость из U9-A)', 'active');
insert into player_guardians (player_id, user_id, consent_version, consent_given_at) values
  ('00000000-0000-0000-0000-00000000d001', '00000000-0000-0000-0000-0000000000b1', 'test', now());
insert into sessions (id, group_id, starts_at, kind, source_key, class) values
  ('00000000-0000-0000-0000-0000000005a1', '00000000-0000-0000-0000-0000000000e1', '2026-11-02 15:00+04', 'training', 'ATT|2026-11-02', 'regular'),
  ('00000000-0000-0000-0000-0000000005a2', '00000000-0000-0000-0000-0000000000e1', '2026-11-03 15:00+04', 'training', 'ATT|2026-11-03', 'regular');

create or replace function as_user(uid uuid) returns void language plpgsql as $$
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
end $$;

-- гости: Тимофей (a1, 15), Вера (a1, 15), Лев (a1, 15), Тимофей (a2, 15)
select as_user('00000000-0000-0000-0000-0000000000a1');
select session_guest_add('00000000-0000-0000-0000-0000000005a1', '00000000-0000-0000-0000-00000000d001');
select session_guest_add('00000000-0000-0000-0000-0000000005a1', '00000000-0000-0000-0000-00000000d002');
select session_guest_add('00000000-0000-0000-0000-0000000005a1', '00000000-0000-0000-0000-00000000d003');
select session_guest_add('00000000-0000-0000-0000-0000000005a2', '00000000-0000-0000-0000-00000000d001');
reset role;
create temp table snap (k text primary key, v text);
grant all on snap to authenticated;
insert into snap select 'svc', (select count(*) from service_payments)::text;

-- У1: права
select as_user('00000000-0000-0000-0000-0000000000c1');
select throws_ok($$select session_guest_discount('00000000-0000-0000-0000-0000000005a1', '00000000-0000-0000-0000-00000000d001', 0, 'тест причины')$$, '42501', 'forbidden', 'У1: тренер не ставит скидку');
select as_user('00000000-0000-0000-0000-0000000000b1');
select throws_ok($$select session_guest_discount('00000000-0000-0000-0000-0000000005a1', '00000000-0000-0000-0000-00000000d001', 0, 'тест причины')$$, '42501', 'forbidden', 'У1: родитель не ставит скидку');
reset role;
select set_config('role', 'anon', true);
select throws_ok($$select session_guest_discount('00000000-0000-0000-0000-0000000005a1', '00000000-0000-0000-0000-00000000d001', 0, 'тест причины')$$, '42501', null, 'У11: анону функция недоступна');
reset role;
select is((select paid from session_guests where session_id = '00000000-0000-0000-0000-0000000005a1' and player_id = '00000000-0000-0000-0000-00000000d001'), false, 'У1: после отказов посещение не тронуто');
select ok(not has_function_privilege('anon', 'session_guest_discount(uuid, uuid, numeric, text)', 'execute'), 'У11: anon без права execute');
select ok(has_function_privilege('authenticated', 'session_guest_discount(uuid, uuid, numeric, text)', 'execute'), 'У11: authenticated с правом execute (проверка администратора внутри)');
select as_user('00000000-0000-0000-0000-0000000000c1');
select throws_ok($$update session_guests set amount = 0, paid = true, paid_amount = 0 where session_id = '00000000-0000-0000-0000-0000000005a1'$$, '42501', null, 'У1: прямая запись в session_guests закрыта');
reset role;

-- У2, У3: причина, сумма, существование
select as_user('00000000-0000-0000-0000-0000000000a1');
select throws_ok($$select session_guest_discount('00000000-0000-0000-0000-0000000005a1', '00000000-0000-0000-0000-00000000d001', 0, '  ab ')$$, '22023', 'discount needs reason', 'У2: короткая причина');
select throws_ok($$select session_guest_discount('00000000-0000-0000-0000-0000000005a1', '00000000-0000-0000-0000-00000000d001', 0, null)$$, '22023', 'discount needs reason', 'У2: причина не задана');
select throws_ok($$select session_guest_discount('00000000-0000-0000-0000-0000000005a1', '00000000-0000-0000-0000-00000000d001', -1, 'тест причины')$$, '22023', 'bad amount', 'У2: отрицательная сумма');
select throws_ok($$select session_guest_discount('00000000-0000-0000-0000-0000000005a1', '00000000-0000-0000-0000-00000000d001', null, 'тест причины')$$, '22023', 'bad amount', 'У2: сумма не задана');
select throws_ok($$select session_guest_discount('00000000-0000-0000-0000-0000000005a2', '00000000-0000-0000-0000-00000000d002', 0, 'тест причины')$$, 'P0002', 'guest not found', 'У3: нет такого посещения');

-- У2: увеличить сумму скидкой нельзя
select throws_ok($$select session_guest_discount('00000000-0000-0000-0000-0000000005a1', '00000000-0000-0000-0000-00000000d002', 20, 'тест причины')$$, '22023', 'bad amount', 'У2: сумма больше текущей отклонена');
select is((select amount from session_guests where session_id = '00000000-0000-0000-0000-0000000005a1' and player_id = '00000000-0000-0000-0000-00000000d002'), 15.00::numeric, 'У2: после отказа сумма прежняя');
select is((select count(*) from fee_discount_log where kind = 'visit')::int, 0, 'У2: после отказа журнал пуст');

-- У4: скидка до 10
select lives_ok($$select session_guest_discount('00000000-0000-0000-0000-0000000005a1', '00000000-0000-0000-0000-00000000d002', 10, 'договорённость с тренером')$$, 'У4: админ ставит скидку до 10');
select is((select amount from session_guests where session_id = '00000000-0000-0000-0000-0000000005a1' and player_id = '00000000-0000-0000-0000-00000000d002'), 10.00::numeric, 'У4: сумма стала 10');
select is((select paid from session_guests where session_id = '00000000-0000-0000-0000-0000000005a1' and player_id = '00000000-0000-0000-0000-00000000d002'), false, 'У4: посещение осталось неоплаченным');

-- У5: закрытие без оплаты
select lives_ok($$select session_guest_discount('00000000-0000-0000-0000-0000000005a1', '00000000-0000-0000-0000-00000000d001', 0, 'тренерский обмен')$$, 'У5: админ закрывает без оплаты');
select is((select paid::text || '|' || paid_amount::text || '|' || coalesce(method, 'нет') || '|' || amount::text from session_guests where session_id = '00000000-0000-0000-0000-0000000005a1' and player_id = '00000000-0000-0000-0000-00000000d001'), 'true|0.00|нет|15.00', 'У5: оплачено, 0, способа нет, сумма посещения прежняя');
select is((select count(*) from service_payments)::text, (select v from snap where k = 'svc'), 'У5: журнал платежей не изменился, касса не меняется');

-- У7: журнал
select is((select old_amount::text || '>' || new_amount::text || '|' || reason || '|' || kind from fee_discount_log where ref_id = '00000000-0000-0000-0000-0000000005a1' and player_id = '00000000-0000-0000-0000-00000000d001'), '15.00>0.00|тренерский обмен|visit', 'У7: запись журнала: было, стало, причина, вид');
select is((select created_by from fee_discount_log where ref_id = '00000000-0000-0000-0000-0000000005a1' and player_id = '00000000-0000-0000-0000-00000000d001'), '00000000-0000-0000-0000-0000000000a1'::uuid, 'У7: автор сохранён');
select is((select count(*) from fee_discount_log where kind = 'visit')::int, 2, 'У7: две записи журнала (10 и 0)');

-- У3: оплаченное
select throws_ok($$select session_guest_discount('00000000-0000-0000-0000-0000000005a1', '00000000-0000-0000-0000-00000000d001', 5, 'тест причины')$$, '22023', 'visit paid', 'У3: закрытое без оплаты повторно не правится');
select session_guest_set_paid('00000000-0000-0000-0000-0000000005a1', '00000000-0000-0000-0000-00000000d003', true, 'Наличные', null, '2026-11-02');
insert into snap select 'svc_after_cash', (select count(*) from service_payments)::text;
select throws_ok($$select session_guest_discount('00000000-0000-0000-0000-0000000005a1', '00000000-0000-0000-0000-00000000d003', 5, 'тест причины')$$, '22023', 'visit paid', 'У3: оплаченное деньгами скидкой не правится');

-- У6: та же сумма
select lives_ok($$select session_guest_discount('00000000-0000-0000-0000-0000000005a2', '00000000-0000-0000-0000-00000000d001', 15, 'тест причины')$$, 'У6: та же сумма не падает');
select is((select count(*) from fee_discount_log where kind = 'visit')::int, 2, 'У6: журнал не пополнился');

-- У8: возврат закрытого в долг, затем возврат суммы
select lives_ok($$select session_guest_set_paid('00000000-0000-0000-0000-0000000005a1', '00000000-0000-0000-0000-00000000d001', false)$$, 'У8: админ отменяет закрытие без оплаты');
select is((select paid::text || '|' || amount::text from session_guests where session_id = '00000000-0000-0000-0000-0000000005a1' and player_id = '00000000-0000-0000-0000-00000000d001'), 'false|15.00', 'У8: посещение снова неоплачено в прежней сумме 15');
select is((select count(*) from service_payments)::text, (select v from snap where k = 'svc_after_cash'), 'У8: сторно не создано, платежей по-прежнему нет');
reset role;

select * from finish();
rollback;
