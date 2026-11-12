-- Интеграционный сценарий: запись -> очередь -> отмена -> возврат -> посещение -> баллы -> уведомления.
-- Одна цепочка проходит через модули записи, очереди ожидания, финансов (service_payments, booking_cancellations),
-- журнала баллов и очереди уведомлений. Отдельные модули проверены в rls_booking_*_test.sql и rls_points_*_test.sql;
-- здесь проверяются стыки: что одна операция оставляет согласованное состояние во всех модулях сразу.
-- Данные вымышленные, занятия через 10 дней от текущей даты (доска записи показывает 60 дней вперёд), реальных отправок нет (только строки в notifications).
begin;
create extension if not exists pgtap;
select plan(38);

insert into clubs (id, name) values ('00000000-0000-0000-0000-00000000c001', 'Клуб');
insert into users (id, telegram_id, display_name, is_admin) values
  ('00000000-0000-0000-0000-0000000000a1', 9901, 'Админ', true),
  ('00000000-0000-0000-0000-0000000000c1', 9902, 'Тренер U9', false),
  ('00000000-0000-0000-0000-0000000000b1', 9903, 'Родитель 1 (двое детей в разных группах)', false),
  ('00000000-0000-0000-0000-0000000000b2', 9904, 'Родитель 2', false),
  ('00000000-0000-0000-0000-0000000000b3', 9905, 'Родитель 3 (уведомления выключены)', false);
update users set notifications_enabled = false where id = '00000000-0000-0000-0000-0000000000b3';
insert into groups (id, club_id, name) values
  ('00000000-0000-0000-0000-0000000000e1', '00000000-0000-0000-0000-00000000c001', 'U9'),
  ('00000000-0000-0000-0000-0000000000e2', '00000000-0000-0000-0000-00000000c001', 'U11');
insert into coach_groups (user_id, group_id) values ('00000000-0000-0000-0000-0000000000c1', '00000000-0000-0000-0000-0000000000e1');
insert into players (id, club_id, group_id, full_name, status) values
  ('00000000-0000-0000-0000-00000000d001', '00000000-0000-0000-0000-00000000c001', '00000000-0000-0000-0000-0000000000e1', 'Аня', 'active'),
  ('00000000-0000-0000-0000-00000000d002', '00000000-0000-0000-0000-00000000c001', '00000000-0000-0000-0000-0000000000e2', 'Гриша', 'active'),
  ('00000000-0000-0000-0000-00000000d003', '00000000-0000-0000-0000-00000000c001', '00000000-0000-0000-0000-0000000000e1', 'Боря', 'active'),
  ('00000000-0000-0000-0000-00000000d004', '00000000-0000-0000-0000-00000000c001', '00000000-0000-0000-0000-0000000000e1', 'Вера', 'active');
insert into player_guardians (player_id, user_id, consent_version, consent_given_at) values
  ('00000000-0000-0000-0000-00000000d001', '00000000-0000-0000-0000-0000000000b1', 'test', now()),
  ('00000000-0000-0000-0000-00000000d002', '00000000-0000-0000-0000-0000000000b1', 'test', now()),
  ('00000000-0000-0000-0000-00000000d003', '00000000-0000-0000-0000-0000000000b2', 'test', now()),
  ('00000000-0000-0000-0000-00000000d004', '00000000-0000-0000-0000-0000000000b3', 'test', now());
insert into club_settings (club_id, key, value, scope) values
  ('00000000-0000-0000-0000-00000000c001', 'booking.notify', 'on', ''),
  ('00000000-0000-0000-0000-00000000c001', 'ind.capIndividual', '1', ''),
  ('00000000-0000-0000-0000-00000000c001', 'ind.capGoalkeepers', '1', '');
insert into points_rule_versions (id, club_id, effective_from, params) values ('00000000-0000-0000-0000-0000000000f1', '00000000-0000-0000-0000-00000000c001', '2026-01-01', jsonb_build_object(
  'training', jsonb_build_object('group', 1, 'individual', 2, 'goalkeeper', 2, 'extra', 2, 'moved_group', 1),
  'match', jsonb_build_object('played', 1, 'draw', 1, 'win', 2, 'goal', 1, 'best', 2, 'cap', 5, 'technical', 0),
  'manual', jsonb_build_object('values', jsonb_build_array(1, 2, 3), 'limits', jsonb_build_object('1', 3, '2', 2, '3', 1), 'month_cap', 10),
  'series', jsonb_build_object('thresholds', jsonb_build_array()),
  'group_benchmark', jsonb_build_object('min_size', 5),
  'enabled', jsonb_build_object('training', true, 'match', true, 'series', true, 'manual', true, 'benchmark', true)));

create or replace function as_user(uid uuid) returns void language plpgsql as $$
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
end $$;
create temp table ids (k text primary key, id uuid);
grant all on ids to authenticated;
-- снимок очереди уведомлений до шага: «неуспешная операция ничего не ставит в очередь»
create temp table nsnap (n int);
grant all on nsnap to authenticated;
create or replace function n_mark() returns void language sql as $$ delete from nsnap; insert into nsnap select count(*)::int from notifications $$;
create or replace function n_new() returns int language sql as $$ select (select count(*)::int from notifications) - (select n from nsnap) $$;

select as_user('00000000-0000-0000-0000-0000000000a1');
insert into ids select 'i1', ind_create_session((now() at time zone 'Asia/Tbilisi')::date + 10, '19:00', false, 'Удар', '20:00');
insert into ids select 'g1', ind_create_session((now() at time zone 'Asia/Tbilisi')::date + 10, '19:00', true, 'Вратари', '20:00');

-- ===== 1. Несколько детей одной семьи, пересечение времени =====
select as_user('00000000-0000-0000-0000-0000000000b1');
select booking_signup('individual', (select id from ids where k = 'i1'), '00000000-0000-0000-0000-00000000d001');
select booking_signup('goalkeeper', (select id from ids where k = 'g1'), '00000000-0000-0000-0000-00000000d002');
select is((select count(*)::int from booking_conflicts('goalkeeper', (select id from ids where k = 'g1'), '00000000-0000-0000-0000-00000000d002')), 0,
  'брат и сестра в одно время на разных занятиях: у ребёнка нет пересечения из-за записи другого ребёнка семьи');
select is((select string_agg(kind, ',') from booking_conflicts('goalkeeper', (select id from ids where k = 'g1'), '00000000-0000-0000-0000-00000000d001')), 'individual',
  'тот же ребёнок на занятие в то же время: пересечение с его индивидуальной показывается');
select is((select count(*)::int from (select jsonb_array_elements(mine) from booking_board()) x), 2, 'родитель видит обе свои записи на доске');
reset role;
select is((select count(*)::int from notifications where kind = 'booking_confirm' and user_id = '00000000-0000-0000-0000-0000000000b1'), 2,
  'семья получила по подтверждению на каждую запись');
select is((select count(*)::int from notifications where kind = 'booking_confirm' and user_id <> '00000000-0000-0000-0000-0000000000b1'), 0,
  'подтверждения записи не ушли другим семьям');
select is((select string_agg(text, ' | ' order by text) from notifications where kind = 'booking' and user_id = '00000000-0000-0000-0000-0000000000a1'),
  'Запись на занятие: Аня. Откройте приложение: Ещё → Индивидуальные. | Запись на занятие: Гриша. Откройте приложение: Ещё → Индивидуальные.',
  'администратор получил по одному сообщению о каждой записи');

-- ===== 2. Неуспешные операции: состояние и очередь уведомлений не меняются =====
select n_mark();
select as_user('00000000-0000-0000-0000-0000000000b2');
select throws_ok($$select booking_signup('individual', (select id from ids where k = 'i1'), '00000000-0000-0000-0000-00000000d003')$$, '22023', 'session full', 'мест нет: запись отклонена');
select throws_ok($$select booking_cancel('individual', (select id from ids where k = 'i1'), '00000000-0000-0000-0000-00000000d001')$$, '42501', 'forbidden', 'чужую запись отменить нельзя');
select throws_ok($$select booking_signup('individual', (select id from ids where k = 'i1'), '00000000-0000-0000-0000-00000000d001')$$, '42501', 'forbidden', 'чужого ребёнка записать нельзя');
reset role;
select is(n_new(), 0, 'отклонённые запись и отмена не поставили ни одного уведомления');
select is((select count(*)::int from booking_cancellations), 0, 'отклонённая отмена не оставила записи в журнале отмен');
select ok(exists (select 1 from individual_bookings where session_id = (select id from ids where k = 'i1') and player_id = '00000000-0000-0000-0000-00000000d001'),
  'запись Ани на месте после чужой попытки отмены');

-- ===== 3. Очередь, оплата, отмена оплаченной записи =====
select as_user('00000000-0000-0000-0000-0000000000b2');
select waitlist_join('individual', (select id from ids where k = 'i1'), '00000000-0000-0000-0000-00000000d003');
select as_user('00000000-0000-0000-0000-0000000000b3');
select waitlist_join('individual', (select id from ids where k = 'i1'), '00000000-0000-0000-0000-00000000d004');
select as_user('00000000-0000-0000-0000-0000000000a1');
select ind_set_paid((select id from ids where k = 'i1'), '00000000-0000-0000-0000-00000000d001', true, 'Наличные', null);
select ind_set_paid((select id from ids where k = 'i1'), '00000000-0000-0000-0000-00000000d001', true, 'Наличные', null);
reset role;
select is((select count(*)::int || '/' || sum(amount)::int from service_payments where player_id = '00000000-0000-0000-0000-00000000d001'), '1/50',
  'повторная отметка «оплачено» не создаёт второй платёж');

select n_mark();
select as_user('00000000-0000-0000-0000-0000000000b1');
select booking_cancel('individual', (select id from ids where k = 'i1'), '00000000-0000-0000-0000-00000000d001');
reset role;
select is((select status || '/' || amount::int from booking_cancellations where player_id = '00000000-0000-0000-0000-00000000d001'), 'awaiting/50',
  'отмена оплаченной записи ждёт решения администратора с суммой оплаты');
select ok(not exists (select 1 from individual_bookings where player_id = '00000000-0000-0000-0000-00000000d001'), 'место освобождено');
select is((select count(*)::int || '/' || sum(amount)::int from service_payments where player_id = '00000000-0000-0000-0000-00000000d001'), '1/50',
  'отмена родителем не трогает историю платежей: платёж на месте, возврата ещё нет');
select is((select count(*)::int from notifications where kind = 'waitlist_offer' and user_id = '00000000-0000-0000-0000-0000000000b2'), 1, 'место предложено семье из очереди');
select is((select count(*)::int from notifications where kind = 'waitlist_offer' and user_id = '00000000-0000-0000-0000-0000000000b3'), 0, 'семья с выключенными уведомлениями предложение не получила');
select is((select count(*)::int from notifications where kind = 'booking' and user_id = '00000000-0000-0000-0000-0000000000a1' and text like 'Отмена записи%'), 1, 'администратор получил одно сообщение об отмене');
select is(n_new(), 2, 'отмена поставила ровно два уведомления: предложение очереди и сообщение администратору');
select as_user('00000000-0000-0000-0000-0000000000b1');
select throws_ok($$select booking_cancel('individual', (select id from ids where k = 'i1'), '00000000-0000-0000-0000-00000000d001')$$, 'P0002', 'booking not found', 'повторная отмена той же записи отклоняется');
reset role;
select is((select count(*)::int from booking_cancellations), 1, 'повтор отмены не создаёт второй строки в журнале отмен');

-- ===== 4. Очередь занимает место, посещение даёт баллы только посетившему =====
select as_user('00000000-0000-0000-0000-0000000000b3');
select waitlist_claim('individual', (select id from ids where k = 'i1'), '00000000-0000-0000-0000-00000000d004');
select as_user('00000000-0000-0000-0000-0000000000b2');
select throws_ok($$select waitlist_claim('individual', (select id from ids where k = 'i1'), '00000000-0000-0000-0000-00000000d003')$$, '22023', 'session full', 'второй из очереди места уже не получает');
reset role;
select is((select string_agg(player_id::text, ',') from individual_bookings where session_id = (select id from ids where k = 'i1')), '00000000-0000-0000-0000-00000000d004',
  'место заняла семья, подтвердившая первой (даже без уведомлений)');
select is((select count(*)::int from booking_waitlist where player_id = '00000000-0000-0000-0000-00000000d004'), 0, 'занявший вышел из очереди');
select is((select count(*)::int from booking_waitlist where player_id = '00000000-0000-0000-0000-00000000d003'), 1, 'не успевший остался в очереди');

select as_user('00000000-0000-0000-0000-0000000000a1');
select ind_set_attended((select id from ids where k = 'i1'), '00000000-0000-0000-0000-00000000d004', true);
select ind_set_attended((select id from ids where k = 'g1'), '00000000-0000-0000-0000-00000000d002', true);
reset role;
select is((select string_agg(pl.full_name || ':' || l.source_type || ':' || l.points, ',' order by pl.full_name) from points_ledger l join players pl on pl.id = l.player_id where l.status = 'active'),
  'Вера:individual:2,Гриша:goalkeeper:2', 'баллы за посещение начислены посетившим, у отменившей Ани баллов нет');
select is((select group_id from points_ledger where player_id = '00000000-0000-0000-0000-00000000d002' and status = 'active'), '00000000-0000-0000-0000-0000000000e2'::uuid,
  'баллы записаны в группу ребёнка на дату занятия');
select as_user('00000000-0000-0000-0000-0000000000b3');
select throws_ok($$select booking_cancel('individual', (select id from ids where k = 'i1'), '00000000-0000-0000-0000-00000000d004')$$, '22023', 'attendance marked', 'после отметки посещения родитель запись не отменяет');
select as_user('00000000-0000-0000-0000-0000000000a1');
select ind_set_attended((select id from ids where k = 'i1'), '00000000-0000-0000-0000-00000000d004', false);
select ind_set_attended((select id from ids where k = 'i1'), '00000000-0000-0000-0000-00000000d004', true);
reset role;
select is((select count(*)::int from points_ledger where player_id = '00000000-0000-0000-0000-00000000d004' and status = 'active'), 1,
  'снятие и повторная отметка посещения: одно активное начисление, без дублей');

-- ===== 5. Решение администратора по отмене: возврат и защита от повторов =====
select as_user('00000000-0000-0000-0000-0000000000a1');
select booking_cancel_refund((select id from booking_cancellations where player_id = '00000000-0000-0000-0000-00000000d001'), null, null, 'Вернули');
select throws_ok($$select booking_cancel_refund((select id from booking_cancellations where player_id = '00000000-0000-0000-0000-00000000d001'), null, null, 'Ещё раз')$$,
  '22023', 'already decided', 'повторный возврат по той же отмене отклоняется');
select throws_ok($$select booking_cancel_keep((select id from booking_cancellations where player_id = '00000000-0000-0000-0000-00000000d001'), 'Передумали')$$,
  '22023', 'already decided', 'после возврата решение по отмене не меняется');
reset role;
select is((select string_agg(amount::int::text || ':' || method || ':' || (cancels is not null)::text, ',' order by amount desc) from service_payments where player_id = '00000000-0000-0000-0000-00000000d001'),
  '50:Наличные:false,-50:Наличные:true', 'возврат добавлен отдельной строкой со ссылкой на исходный платёж, исходный платёж не изменён');
select is((select status from booking_cancellations where player_id = '00000000-0000-0000-0000-00000000d001'), 'refunded', 'отмена закрыта как возврат');
select as_user('00000000-0000-0000-0000-0000000000b1');
select throws_ok($$select booking_cancel_refund((select id from booking_cancellations limit 1), null, null, null)$$, '42501', 'forbidden', 'родитель решение по отмене принять не может');

-- ===== 6. Сквозные инварианты очереди уведомлений =====
reset role;
select is((select count(*)::int from notifications n
            where n.player_ids is not null and exists (select 1 from unnest(n.player_ids) x(pid)
              where not exists (select 1 from player_guardians g where g.user_id = n.user_id and g.player_id = x.pid))),
  0, 'ни одно уведомление о ребёнке не ушло пользователю, который не является его опекуном');
select is((select count(*)::int from notifications n join users u on u.id = n.user_id where not u.notifications_enabled), 0,
  'пользователь с выключенными уведомлениями не получил ни одного сообщения');
select is((select count(*)::int from (select user_id, kind, text from notifications group by 1, 2, 3 having count(*) > 1) d), 0,
  'нет одинаковых сообщений одному получателю');

select * from finish();
rollback;
