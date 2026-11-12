-- Интеграционный сценарий: семья, несколько детей, второй опекун, смена группы, отзыв доступа.
-- Сквозная проверка: каждый источник данных, который читает родитель (таблицы под RLS и RPC для родителя),
-- отдаёт только его детей; смена группы согласованно меняет тренера, целевые занятия и группу баллов,
-- не переписывая историю; отзыв доступа закрывает все модули сразу, включая уведомления.
-- Данные вымышленные. Реальных отправок нет (только строки в notifications).
begin;
create extension if not exists pgtap;
select plan(35);

insert into clubs (id, name) values ('00000000-0000-0000-0000-00000000c001', 'Клуб');
insert into users (id, telegram_id, display_name, is_admin) values
  ('00000000-0000-0000-0000-0000000000a1', 9911, 'Админ', true),
  ('00000000-0000-0000-0000-0000000000c1', 9912, 'Тренер U9', false),
  ('00000000-0000-0000-0000-0000000000c2', 9913, 'Тренер U11', false),
  ('00000000-0000-0000-0000-0000000000b1', 9914, 'Родитель 1 (Аня и Гриша)', false),
  ('00000000-0000-0000-0000-0000000000b2', 9915, 'Родитель 2 (Боря)', false),
  ('00000000-0000-0000-0000-0000000000b4', 9916, 'Второй родитель Ани', false);
insert into groups (id, club_id, name) values
  ('00000000-0000-0000-0000-0000000000e1', '00000000-0000-0000-0000-00000000c001', 'U9'),
  ('00000000-0000-0000-0000-0000000000e2', '00000000-0000-0000-0000-00000000c001', 'U11');
insert into coach_groups (user_id, group_id) values
  ('00000000-0000-0000-0000-0000000000c1', '00000000-0000-0000-0000-0000000000e1'),
  ('00000000-0000-0000-0000-0000000000c2', '00000000-0000-0000-0000-0000000000e2');
insert into players (id, club_id, group_id, full_name, status) values
  ('00000000-0000-0000-0000-00000000d001', '00000000-0000-0000-0000-00000000c001', '00000000-0000-0000-0000-0000000000e1', 'Аня', 'active'),
  ('00000000-0000-0000-0000-00000000d002', '00000000-0000-0000-0000-00000000c001', '00000000-0000-0000-0000-0000000000e2', 'Гриша', 'active'),
  ('00000000-0000-0000-0000-00000000d003', '00000000-0000-0000-0000-00000000c001', '00000000-0000-0000-0000-0000000000e1', 'Боря', 'active');
insert into player_guardians (player_id, user_id, consent_version, consent_given_at) values
  ('00000000-0000-0000-0000-00000000d001', '00000000-0000-0000-0000-0000000000b1', 'test', now()),
  ('00000000-0000-0000-0000-00000000d002', '00000000-0000-0000-0000-0000000000b1', 'test', now()),
  ('00000000-0000-0000-0000-00000000d003', '00000000-0000-0000-0000-0000000000b2', 'test', now()),
  ('00000000-0000-0000-0000-00000000d001', '00000000-0000-0000-0000-0000000000b4', 'test', now());
insert into club_settings (club_id, key, value, scope) values
  ('00000000-0000-0000-0000-00000000c001', 'booking.notify', 'on', ''),
  ('00000000-0000-0000-0000-00000000c001', 'parent_debt_enabled', 'true', '');
insert into prices (club_id, group_id, kind, amount, valid_from) values ('00000000-0000-0000-0000-00000000c001', null, 'subscription', 100, '2020-01-01');
insert into points_rule_versions (id, club_id, effective_from, params) values ('00000000-0000-0000-0000-0000000000f1', '00000000-0000-0000-0000-00000000c001', '2020-01-01', jsonb_build_object(
  'training', jsonb_build_object('group', 1, 'individual', 2, 'goalkeeper', 2, 'extra', 2, 'moved_group', 1),
  'match', jsonb_build_object('played', 1, 'draw', 1, 'win', 2, 'goal', 1, 'best', 2, 'cap', 5, 'technical', 0),
  'manual', jsonb_build_object('values', jsonb_build_array(1, 2, 3), 'limits', jsonb_build_object('1', 3, '2', 2, '3', 1), 'month_cap', 10),
  'series', jsonb_build_object('thresholds', jsonb_build_array()),
  'group_benchmark', jsonb_build_object('min_size', 5),
  'enabled', jsonb_build_object('training', true, 'match', true, 'series', true, 'manual', true, 'benchmark', true)));

-- у каждого ребёнка есть данные в каждом модуле: тренировка с отметкой (и баллами), абонемент с платежом,
-- сбор с частичной оплатой, приглашение на матч, индивидуальная с записью
create temp table d (k text primary key, v date);
grant all on d to authenticated;
insert into d values ('past', (now() at time zone 'Asia/Tbilisi')::date - 3), ('fut', (now() at time zone 'Asia/Tbilisi')::date + 5),
  ('mon', date_trunc('month', (now() at time zone 'Asia/Tbilisi')::date)::date);
insert into sessions (id, group_id, starts_at, kind, source_key, class) values
  ('00000000-0000-0000-0000-0000000005a1', '00000000-0000-0000-0000-0000000000e1', ((select v from d where k = 'past') + time '15:00') at time zone 'Asia/Tbilisi', 'training', 'INT|U9', 'regular'),
  ('00000000-0000-0000-0000-0000000005a2', '00000000-0000-0000-0000-0000000000e2', ((select v from d where k = 'past') + time '17:00') at time zone 'Asia/Tbilisi', 'training', 'INT|U11', 'regular');
insert into attendance (session_id, player_id, status) values
  ('00000000-0000-0000-0000-0000000005a1', '00000000-0000-0000-0000-00000000d001', 'present'),
  ('00000000-0000-0000-0000-0000000005a1', '00000000-0000-0000-0000-00000000d003', 'present'),
  ('00000000-0000-0000-0000-0000000005a2', '00000000-0000-0000-0000-00000000d002', 'present');
insert into subscriptions (id, player_id, group_id, month) values
  ('00000000-0000-0000-0000-0000000007a1', '00000000-0000-0000-0000-00000000d001', '00000000-0000-0000-0000-0000000000e1', (select v from d where k = 'mon')),
  ('00000000-0000-0000-0000-0000000007a2', '00000000-0000-0000-0000-00000000d002', '00000000-0000-0000-0000-0000000000e2', (select v from d where k = 'mon')),
  ('00000000-0000-0000-0000-0000000007a3', '00000000-0000-0000-0000-00000000d003', '00000000-0000-0000-0000-0000000000e1', (select v from d where k = 'mon'));
insert into payments (player_id, subscription_id, amount, paid_on, method, for_month) values
  ('00000000-0000-0000-0000-00000000d001', '00000000-0000-0000-0000-0000000007a1', 40, (select v from d where k = 'past'), 'Наличные', (select v from d where k = 'mon')),
  ('00000000-0000-0000-0000-00000000d003', '00000000-0000-0000-0000-0000000007a3', 100, (select v from d where k = 'past'), 'Наличные', (select v from d where k = 'mon'));
insert into camps (id, club_id, name, starts_on, ends_on) values
  ('00000000-0000-0000-0000-0000000008a1', '00000000-0000-0000-0000-00000000c001', 'Летний сбор', (select v from d where k = 'fut') + 30, (select v from d where k = 'fut') + 37);
insert into camp_tariffs (id, camp_id, name, price) values ('00000000-0000-0000-0000-0000000008b1', '00000000-0000-0000-0000-0000000008a1', 'Полный', 300);
insert into camp_participants (id, camp_id, player_id, tariff_id, amount, status) values
  ('00000000-0000-0000-0000-0000000008c1', '00000000-0000-0000-0000-0000000008a1', '00000000-0000-0000-0000-00000000d001', '00000000-0000-0000-0000-0000000008b1', 300, 'registered'),
  ('00000000-0000-0000-0000-0000000008c3', '00000000-0000-0000-0000-0000000008a1', '00000000-0000-0000-0000-00000000d003', '00000000-0000-0000-0000-0000000008b1', 300, 'registered');
insert into camp_payments (camp_id, participant_id, player_id, amount, paid_on, kind, method) values
  ('00000000-0000-0000-0000-0000000008a1', '00000000-0000-0000-0000-0000000008c1', '00000000-0000-0000-0000-00000000d001', 100, (select v from d where k = 'past'), 'payment', 'Наличные'),
  ('00000000-0000-0000-0000-0000000008a1', '00000000-0000-0000-0000-0000000008c3', '00000000-0000-0000-0000-00000000d003', 300, (select v from d where k = 'past'), 'payment', 'Наличные');

create or replace function as_user(uid uuid) returns void language plpgsql as $$
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
end $$;
create temp table ids (k text primary key, id uuid);
grant all on ids to authenticated;

-- матч U9 и U11 с приглашениями через штатный жизненный цикл
select as_user('00000000-0000-0000-0000-0000000000a1');
insert into ids select 'm9', match_rsvp_create_draft('00000000-0000-0000-0000-00000000c001', 'friendly', 'U9', 'Соперник', ((select v from d where k = 'fut') + time '12:00') at time zone 'Asia/Tbilisi', 'Поле', null, null, null);
select match_rsvp_seed((select id from ids where k = 'm9'), '00000000-0000-0000-0000-0000000000e1');
select match_rsvp_publish((select id from ids where k = 'm9'));
insert into ids select 'm11', match_rsvp_create_draft('00000000-0000-0000-0000-00000000c001', 'friendly', 'U11', 'Соперник', ((select v from d where k = 'fut') + time '15:00') at time zone 'Asia/Tbilisi', 'Поле', null, null, null);
select match_rsvp_seed((select id from ids where k = 'm11'), '00000000-0000-0000-0000-0000000000e2');
select match_rsvp_publish((select id from ids where k = 'm11'));
insert into ids select 'i1', ind_create_session((select v from d where k = 'fut'), '19:00', false, 'Удар', '20:00');
select ind_add_player((select id from ids where k = 'i1'), '00000000-0000-0000-0000-00000000d001');
select ind_add_player((select id from ids where k = 'i1'), '00000000-0000-0000-0000-00000000d003');
reset role;

-- «чужие строки»: для каждого источника считаем строки не своих детей и проверяем, что свои строки вообще есть
create temp table mine (pid uuid);
grant all on mine to authenticated;
insert into mine values ('00000000-0000-0000-0000-00000000d001'), ('00000000-0000-0000-0000-00000000d002');

-- ===== 1. Родитель с двумя детьми видит только своих детей во всех модулях =====
select as_user('00000000-0000-0000-0000-0000000000b1');
select is((select count(*) filter (where id not in (select pid from mine))::int || '/' || count(*)::int from players), '0/2', 'players: только свои дети, оба');
select is((select count(*) filter (where player_id not in (select pid from mine))::int || '/' || count(*)::int from attendance), '0/2', 'attendance: только свои дети');
select is((select count(*) filter (where player_id not in (select pid from mine))::int || '/' || count(*)::int from subscriptions), '0/2', 'subscriptions: только свои дети');
select is((select count(*) filter (where player_id not in (select pid from mine))::int || '/' || count(*)::int from payments), '0/1', 'payments: только свои платежи');
select is((select count(*) filter (where player_id not in (select pid from mine))::int || '/' || count(*)::int from points_ledger), '0/2', 'points_ledger: только баллы своих детей');
select is((select count(*) filter (where player_id not in (select pid from mine))::int || '/' || count(*)::int from camp_participants), '0/1', 'camp_participants: только свои участники сбора');
select is((select count(*) filter (where player_id not in (select pid from mine))::int || '/' || count(*)::int from match_invitations), '0/2', 'match_invitations: только приглашения своих детей');
select is((select count(*) filter (where player_id not in (select pid from mine))::int || '/' || count(*)::int from match_rsvp_my_matches()), '0/2', 'match_rsvp_my_matches: оба своих матча, чужих нет');
select is((select count(*) filter (where player_id not in (select pid from mine))::int from parent_dues()), 0, 'parent_dues: только свои дети');
select is((select string_agg(kind || ':' || debt::int, ',' order by kind) from parent_dues()), 'camp:200', 'parent_dues: долг по сбору своего ребёнка (будущая индивидуальная ещё не долг)');
select is((select count(*) filter (where player_id not in (select pid from mine))::int || '/' || count(*)::int from parent_debts()), '0/2', 'parent_debts: абонементы только своих детей');
select is((select string_agg(x->>'name', ',') from booking_board() b, jsonb_array_elements(b.mine) x), 'Аня', 'booking_board: в «моих записях» только свой ребёнок, хотя Боря записан туда же');
select throws_ok($$select * from parent_calendar('00000000-0000-0000-0000-00000000d003', (now() at time zone 'Asia/Tbilisi')::date - 10, (now() at time zone 'Asia/Tbilisi')::date)$$,
  '42501', 'forbidden', 'parent_calendar чужого ребёнка: отказ');
select is((select string_agg(event_id || ':' || coalesce(attendance_status, '-'), ',' order by event_id) from parent_calendar('00000000-0000-0000-0000-00000000d002', (now() at time zone 'Asia/Tbilisi')::date - 10, (now() at time zone 'Asia/Tbilisi')::date) where event_type = 'training'),
  'session:00000000-0000-0000-0000-0000000005a2:present', 'parent_calendar своего ребёнка: его посещённая тренировка группы с отметкой (положительный сценарий до смены группы)');
select ok(position('Боря' in export_my_data()::text) = 0 and position('Аня' in export_my_data()::text) > 0, 'export_my_data: в выгрузке нет чужого ребёнка, свой есть');

-- ===== 2. Второй опекун одного ребёнка: видит общего ребёнка, но не других детей первого родителя =====
select as_user('00000000-0000-0000-0000-0000000000b4');
select is((select string_agg(full_name, ',') from players), 'Аня', 'второй опекун видит только общего ребёнка');
select is((select count(*)::int from match_rsvp_my_matches()), 1, 'второй опекун видит приглашение общего ребёнка');
select match_rsvp_answer((select id from ids where k = 'm9'), '00000000-0000-0000-0000-00000000d001', 'yes');
select throws_ok($$select match_rsvp_answer((select id from ids where k = 'm11'), '00000000-0000-0000-0000-00000000d002', 'yes')$$, '42501', null, 'второй опекун не отвечает за другого ребёнка первого родителя');
select as_user('00000000-0000-0000-0000-0000000000b1');
select is((select response || '/' || responded_by_name from match_rsvp_my_matches() where player_id = '00000000-0000-0000-0000-00000000d001'), 'yes/Второй родитель Ани',
  'первый родитель видит ответ второго опекуна и кто ответил');
select as_user('00000000-0000-0000-0000-0000000000c1');
select is((select response || '/' || responded_by_name from match_rsvp_roster((select id from ids where k = 'm9')) where player_id = '00000000-0000-0000-0000-00000000d001'),
  'yes/Второй родитель Ани', 'тренер видит в составе ответ родителя и кто ответил');

-- ===== 3. Смена группы: тренер, целевые занятия, баллы, история =====
select as_user('00000000-0000-0000-0000-0000000000a1');
insert into ids select 'x9', extra_create_session((select v from d where k = 'fut'), 10, 'Зал', array['00000000-0000-0000-0000-0000000000e1']::uuid[], null);
select as_user('00000000-0000-0000-0000-0000000000b1');
select throws_ok($$select booking_signup('extra', (select id from ids where k = 'x9'), '00000000-0000-0000-0000-00000000d002')$$, '22023', 'not eligible', 'до перевода Гриша (U11) не записывается на занятие для U9');
reset role;
update players set group_id = '00000000-0000-0000-0000-0000000000e1' where id = '00000000-0000-0000-0000-00000000d002';
select is(points_group_at('00000000-0000-0000-0000-00000000d002', (select v from d where k = 'past')), '00000000-0000-0000-0000-0000000000e2'::uuid, 'история групп: на дату прошлой тренировки Гриша в U11');
select is(points_group_at('00000000-0000-0000-0000-00000000d002', (select v from d where k = 'fut')), '00000000-0000-0000-0000-0000000000e1'::uuid, 'история групп: с сегодняшнего дня Гриша в U9');
select is((select group_id from points_ledger where player_id = '00000000-0000-0000-0000-00000000d002' and status = 'active'), '00000000-0000-0000-0000-0000000000e2'::uuid,
  'баллы за прошлую тренировку остались в группе U11 (история не переписана)');
select is((select status from attendance where player_id = '00000000-0000-0000-0000-00000000d002'), 'present', 'отметка посещения в старой группе сохранилась');
select as_user('00000000-0000-0000-0000-0000000000b1');
select lives_ok($$select booking_signup('extra', (select id from ids where k = 'x9'), '00000000-0000-0000-0000-00000000d002')$$, 'после перевода Гриша записывается на занятие для U9');
select is((select count(*)::int from players), 2, 'после перевода родитель по-прежнему видит обоих детей');
select as_user('00000000-0000-0000-0000-0000000000c1');
select ok(is_coach_of_player('00000000-0000-0000-0000-00000000d002'), 'тренер новой группы стал тренером ребёнка');
select as_user('00000000-0000-0000-0000-0000000000c2');
select ok(not is_coach_of_player('00000000-0000-0000-0000-00000000d002'), 'тренер старой группы больше не тренер ребёнка');
select as_user('00000000-0000-0000-0000-0000000000a1');
select is(match_rsvp_invite((select id from ids where k = 'm9'), array['00000000-0000-0000-0000-00000000d002']::uuid[]), 1, 'переведённого игрока можно пригласить в опубликованный матч новой группы');

-- ===== 4. Отзыв доступа родителя к ребёнку закрывает все модули и уведомления =====
reset role;
update player_guardians set consent_revoked_at = now() where user_id = '00000000-0000-0000-0000-0000000000b1' and player_id = '00000000-0000-0000-0000-00000000d001';
delete from notifications;
select as_user('00000000-0000-0000-0000-0000000000b1');
select is((select string_agg(full_name, ',') from players), 'Гриша', 'после отзыва Аня пропала из списка детей');
select is((select count(*)::int from parent_dues() where player_id = '00000000-0000-0000-0000-00000000d001') + (select count(*)::int from match_rsvp_my_matches() where player_id = '00000000-0000-0000-0000-00000000d001')
        + (select count(*)::int from camp_participants where player_id = '00000000-0000-0000-0000-00000000d001') + (select count(*)::int from payments where player_id = '00000000-0000-0000-0000-00000000d001'), 0,
  'после отзыва Ани нет ни в долгах, ни в матчах, ни в сборах, ни в платежах');
select throws_ok($$select booking_cancel('individual', (select id from ids where k = 'i1'), '00000000-0000-0000-0000-00000000d001')$$, '42501', 'forbidden', 'после отзыва запись Ани отменить нельзя');
select as_user('00000000-0000-0000-0000-0000000000a1');
select ind_remove_player((select id from ids where k = 'i1'), '00000000-0000-0000-0000-00000000d001');
select ind_add_player((select id from ids where k = 'i1'), '00000000-0000-0000-0000-00000000d001');
reset role;
select is((select string_agg(distinct u.display_name, ',') from notifications n join users u on u.id = n.user_id where '00000000-0000-0000-0000-00000000d001' = any(n.player_ids)),
  'Второй родитель Ани', 'уведомления об Ане получает только опекун с действующим доступом');
select is((select count(*)::int from notifications n
            where n.player_ids is not null and exists (select 1 from unnest(n.player_ids) x(pid) where not parent_access_ok(n.user_id, x.pid))),
  0, 'ни одно уведомление о ребёнке не ушло пользователю без доступа к нему');

select * from finish();
rollback;
