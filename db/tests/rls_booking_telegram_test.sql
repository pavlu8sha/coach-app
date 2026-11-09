-- pgTAP: запись на тренировку из Telegram (Issue #274, миграция 0158). Условия: docs/TELEGRAM_BOOKING_ACCEPTANCE.md.
-- Даты занятий относительные (от сегодня по Тбилиси), потому что booking_board показывает только ближайшие 60 дней.
-- Идентификаторы детей начинаются с разных восьми знаков: по ним бот выбирает ребёнка (префикс id).
begin;
create extension if not exists pgtap;
select plan(36);

insert into clubs (id, name) values
  ('c0000000-0000-0000-0000-00000000c001', 'Клуб'),
  ('c0000000-0000-0000-0000-00000000c002', 'Чужой клуб');
insert into club_settings (club_id, key, value, scope) values
  ('c0000000-0000-0000-0000-00000000c001', 'ind.capIndividual', '1', '');
insert into users (id, telegram_id, display_name, is_admin) values
  ('a0000001-0000-0000-0000-000000000001', 9901, 'Админ', true),
  ('b1000001-0000-0000-0000-000000000001', 9902, 'Родитель 1 (Аня, Гриша, Ира)', false),
  ('b1000002-0000-0000-0000-000000000002', 9903, 'Родитель 2 (Боря)', false),
  ('b1000003-0000-0000-0000-000000000003', 9904, 'Родитель 3 (Вера, согласие отозвано)', false);
insert into players (id, club_id, full_name, status) values
  ('b0000001-0000-0000-0000-000000000001', 'c0000000-0000-0000-0000-00000000c001', 'Аня', 'active'),
  ('b0000002-0000-0000-0000-000000000002', 'c0000000-0000-0000-0000-00000000c001', 'Боря', 'active'),
  ('b0000003-0000-0000-0000-000000000003', 'c0000000-0000-0000-0000-00000000c001', 'Вера', 'active'),
  ('b0000004-0000-0000-0000-000000000004', 'c0000000-0000-0000-0000-00000000c001', 'Гриша', 'active'),
  ('b0000005-0000-0000-0000-000000000005', 'c0000000-0000-0000-0000-00000000c001', 'Ира', 'inactive'),
  ('b0000006-0000-0000-0000-000000000006', 'c0000000-0000-0000-0000-00000000c002', 'Чужая', 'active');
insert into player_guardians (player_id, user_id, consent_version, consent_given_at, consent_revoked_at) values
  ('b0000001-0000-0000-0000-000000000001', 'b1000001-0000-0000-0000-000000000001', 't', now(), null),
  ('b0000004-0000-0000-0000-000000000004', 'b1000001-0000-0000-0000-000000000001', 't', now(), null),
  ('b0000005-0000-0000-0000-000000000005', 'b1000001-0000-0000-0000-000000000001', 't', now(), null),
  ('b0000002-0000-0000-0000-000000000002', 'b1000002-0000-0000-0000-000000000002', 't', now(), null),
  ('b0000003-0000-0000-0000-000000000003', 'b1000003-0000-0000-0000-000000000003', 't', now(), now());

-- занятия: i1 будет заполнено (вместимость 1), i2 свободно, g1 — вратарская, p1 — прошедшее, e1 — отменённая дополнительная, e2 — дополнительная
insert into individual_sessions (id, club_id, external_id, starts_at, goalkeepers) values
  ('c1000001-0000-0000-0000-000000000001', 'c0000000-0000-0000-0000-00000000c001', 'T-I1', ((now() at time zone 'Asia/Tbilisi')::date + 2) + time '19:00', false),
  ('c1000001-0000-0000-0000-000000000002', 'c0000000-0000-0000-0000-00000000c001', 'T-I2', ((now() at time zone 'Asia/Tbilisi')::date + 3) + time '19:00', false),
  ('c1000001-0000-0000-0000-000000000003', 'c0000000-0000-0000-0000-00000000c001', 'T-G1', ((now() at time zone 'Asia/Tbilisi')::date + 4) + time '19:00', true),
  ('c1000001-0000-0000-0000-000000000004', 'c0000000-0000-0000-0000-00000000c001', 'T-P1', timestamp '2020-01-01 10:00', false);
insert into extra_sessions (id, club_id, starts_on, amount, place, cancelled_at) values
  ('c1000002-0000-0000-0000-000000000001', 'c0000000-0000-0000-0000-00000000c001', (now() at time zone 'Asia/Tbilisi')::date + 5, 20, 'Зал', now()),
  ('c1000002-0000-0000-0000-000000000002', 'c0000000-0000-0000-0000-00000000c001', (now() at time zone 'Asia/Tbilisi')::date + 6, 20, 'Зал', null);

create temp table res (k text primary key, v jsonb);
grant all on res to public;

-- 1. Список занятий: только свои дети, неактивный и чужой не видны, отменённые и прошедшие не показываются
insert into res select 'opts1', booking_options_by_telegram(9902);
select is((select v->>'ok' from res where k = 'opts1'), 'true', 'родитель с привязкой получает список');
select is((select jsonb_array_length(v->'sessions') from res where k = 'opts1'), 4, 'в списке четыре занятия: два индивидуальных, вратарская и дополнительная; отменённое и прошедшее не показаны');
select is((select jsonb_array_length(s->'children') from res, jsonb_array_elements(v->'sessions') s where k = 'opts1' and s->>'id' = 'c1000001-0000-0000-0000-000000000001'), 2, 'на занятии два подходящих ребёнка: Аня и Гриша (неактивная Ира не показана)');
select ok(not (select v::text like '%b0000005%' or v::text like '%Ира%' from res where k = 'opts1'), 'неактивный ребёнок не виден в списке');
insert into res select 'opts2', booking_options_by_telegram(9903);
select ok(not (select v::text like '%b0000001%' or v::text like '%Аня%' from res where k = 'opts2'), 'родитель 2 не видит детей родителя 1');
select is((select v->>'code' from (select booking_options_by_telegram(9999) as v) x), 'unknown_user', 'неизвестный Telegram ID ничего не видит');

-- 2. Запись: успех, повтор, отказы
insert into res select 'su1', booking_signup_by_telegram(9902, 'c1000001-0000-0000-0000-000000000001', 'b0000001');
select is((select v->>'code' from res where k = 'su1'), 'ok', 'родитель записывает ребёнка через Telegram');
select is((select v->>'player' from res where k = 'su1'), 'Аня', 'в ответе имя ребёнка');
select is((select count(*)::int from individual_bookings where session_id = 'c1000001-0000-0000-0000-000000000001' and player_id = 'b0000001-0000-0000-0000-000000000001'), 1, 'запись создана один раз');
insert into res select 'su2', booking_signup_by_telegram(9902, 'c1000001-0000-0000-0000-000000000001', 'b0000001');
select is((select v->>'code' from res where k = 'su2'), 'already', 'повторное нажатие: уже записан');
select is((select count(*)::int from individual_bookings where session_id = 'c1000001-0000-0000-0000-000000000001' and player_id = 'b0000001-0000-0000-0000-000000000001'), 1, 'повтор не создаёт вторую запись');
insert into res select 'su3', booking_signup_by_telegram(9902, 'c1000001-0000-0000-0000-000000000001', 'b0000004');
select is((select v->>'code' from res where k = 'su3'), 'full', 'мест нет: занятие с одним местом заполнено');
select is((select count(*)::int from individual_bookings where session_id = 'c1000001-0000-0000-0000-000000000001'), 1, 'при отказе места не добавлено');
insert into res select 'su4', booking_signup_by_telegram(9903, 'c1000001-0000-0000-0000-000000000002', 'b0000001');
select is((select v->>'code' from res where k = 'su4'), 'forbidden', 'чужой ребёнок: отказ');
select is((select count(*)::int from individual_bookings where player_id = 'b0000001-0000-0000-0000-000000000001' and session_id = 'c1000001-0000-0000-0000-000000000002'), 0, 'чужая запись не создана');
insert into res select 'su5', booking_signup_by_telegram(9902, 'c1000001-0000-0000-0000-000000000002', 'b0000005');
select is((select v->>'code' from res where k = 'su5'), 'not_allowed', 'неактивный ребёнок не записывается');
insert into res select 'su6', booking_signup_by_telegram(9904, 'c1000001-0000-0000-0000-000000000002', 'b0000003');
select is((select v->>'code' from res where k = 'su6'), 'forbidden', 'отозванное согласие: отказ');
insert into res select 'su7', booking_signup_by_telegram(9902, 'c1000001-0000-0000-0000-000000000002', 'b0000006');
select is((select v->>'code' from res where k = 'su7'), 'forbidden', 'ребёнок другого клуба: отказ');
insert into res select 'su8', booking_signup_by_telegram(9999, 'c1000001-0000-0000-0000-000000000002', 'b0000001');
select is((select v->>'code' from res where k = 'su8'), 'unknown_user', 'неизвестный Telegram ID: отказ');
insert into res select 'su9', booking_signup_by_telegram(9902, 'c1000001-0000-0000-0000-0000000000ff', 'b0000001');
select is((select v->>'code' from res where k = 'su9'), 'not_found', 'несуществующее занятие');
insert into res select 'su10', booking_signup_by_telegram(9902, 'c1000001-0000-0000-0000-000000000004', 'b0000001');
select is((select v->>'code' from res where k = 'su10'), 'closed', 'прошедшее занятие: закрыто');
insert into res select 'su11', booking_signup_by_telegram(9902, 'c1000002-0000-0000-0000-000000000001', 'b0000001');
select is((select v->>'code' from res where k = 'su11'), 'closed', 'отменённое дополнительное занятие: закрыто');
insert into res select 'su12', booking_signup_by_telegram(9902, 'c1000002-0000-0000-0000-000000000002', 'b0000001');
select is((select v->>'code' from res where k = 'su12'), 'ok', 'дополнительная тренировка: запись ребёнка');
select ok(exists (select 1 from extra_bookings where session_id = 'c1000002-0000-0000-0000-000000000002' and player_id = 'b0000001-0000-0000-0000-000000000001'), 'дополнительная запись создана');
insert into res select 'su13', booking_signup_by_telegram(9902, 'c1000001-0000-0000-0000-000000000003', 'b0000004');
select is((select v->>'code' from res where k = 'su13'), 'ok', 'вратарская тренировка: запись ребёнка');

-- 3. После записи список для родителя обновляется: Аня уже записана, занятие заполнено
insert into res select 'opts3', booking_options_by_telegram(9902);
select is((select string_agg(c->>'name', ',') from res, jsonb_array_elements(v->'sessions') s, jsonb_array_elements(s->'children') c where k = 'opts3' and s->>'id' = 'c1000001-0000-0000-0000-000000000001'), 'Гриша', 'записанная Аня больше не предлагается; Гриша может встать в очередь');
select is((select (s->>'free')::boolean from res, jsonb_array_elements(v->'sessions') s where k = 'opts3' and s->>'id' = 'c1000001-0000-0000-0000-000000000001'), false, 'занятие без мест отмечено как занятое');

-- 4. Очередь: только при полном занятии, отдельным действием, без чужих и неактивных
insert into res select 'wl1', waitlist_join_by_telegram(9902, 'c1000001-0000-0000-0000-000000000001', 'b0000004');
select is((select v->>'code' from res where k = 'wl1'), 'ok', 'мест нет: ребёнок встаёт в очередь по отдельному действию');
select is((select count(*)::int from booking_waitlist where session_id = 'c1000001-0000-0000-0000-000000000001' and player_id = 'b0000004-0000-0000-0000-000000000004'), 1, 'позиция в очереди создана один раз');
insert into res select 'wl2', waitlist_join_by_telegram(9903, 'c1000001-0000-0000-0000-000000000002', 'b0000002');
select is((select v->>'code' from res where k = 'wl2'), 'free', 'есть свободные места: в очередь не ставят');
insert into res select 'wl3', waitlist_join_by_telegram(9902, 'c1000001-0000-0000-0000-000000000001', 'b0000001');
select is((select v->>'code' from res where k = 'wl3'), 'already', 'записанный ребёнок в очередь не встаёт');
insert into res select 'wl4', waitlist_join_by_telegram(9904, 'c1000001-0000-0000-0000-000000000001', 'b0000003');
select is((select v->>'code' from res where k = 'wl4'), 'forbidden', 'ребёнок без согласия в очередь не встаёт');
insert into res select 'wl5', waitlist_join_by_telegram(9902, 'c1000001-0000-0000-0000-000000000001', 'b0000005');
select is((select v->>'code' from res where k = 'wl5'), 'not_allowed', 'неактивный ребёнок в очередь не встаёт');

-- 5. Права: клиенту (роль authenticated и anon) функции недоступны, сервису — да
select ok(not has_function_privilege('authenticated', 'booking_signup_by_telegram(bigint, uuid, text)', 'execute'), 'роль authenticated не вызывает booking_signup_by_telegram');
select ok(not has_function_privilege('anon', 'waitlist_join_by_telegram(bigint, uuid, text)', 'execute'), 'роль anon не вызывает waitlist_join_by_telegram');
select ok(not has_function_privilege('anon', 'booking_options_by_telegram(bigint)', 'execute'), 'роль anon не читает список занятий');

select * from finish();
rollback;
