-- pgTAP: уведомление администратору после отмены записи родителем (issue #556, миграция 0174).
-- Условия: docs/BOOKING_CANCEL_NOTICE_ACCEPTANCE.md. Даты относительные, от текущего дня по Тбилиси.
begin;
create extension if not exists pgtap;
select plan(26);

insert into clubs (id, name) values ('00000000-0000-0000-0000-00000000c001', 'Клуб');
insert into users (id, telegram_id, display_name, is_admin) values
  ('00000000-0000-0000-0000-0000000000a1', 9701, 'Админ', true),
  ('00000000-0000-0000-0000-0000000000b1', 9702, 'Родитель 1 (двое детей)', false),
  ('00000000-0000-0000-0000-0000000000b2', 9703, 'Родитель 2 (вратарь)', false);
insert into groups (id, club_id, name) values ('00000000-0000-0000-0000-0000000000e1', '00000000-0000-0000-0000-00000000c001', 'U9');
insert into players (id, club_id, group_id, full_name, status) values
  ('00000000-0000-0000-0000-00000000d001', '00000000-0000-0000-0000-00000000c001', '00000000-0000-0000-0000-0000000000e1', 'Аня', 'active'),
  ('00000000-0000-0000-0000-00000000d002', '00000000-0000-0000-0000-00000000c001', '00000000-0000-0000-0000-0000000000e1', 'Гриша', 'active'),
  ('00000000-0000-0000-0000-00000000d003', '00000000-0000-0000-0000-00000000c001', '00000000-0000-0000-0000-0000000000e1', 'Вера', 'active');
insert into player_guardians (player_id, user_id, consent_version, consent_given_at) values
  ('00000000-0000-0000-0000-00000000d001', '00000000-0000-0000-0000-0000000000b1', 'test', now()),
  ('00000000-0000-0000-0000-00000000d002', '00000000-0000-0000-0000-0000000000b1', 'test', now()),
  ('00000000-0000-0000-0000-00000000d003', '00000000-0000-0000-0000-0000000000b2', 'test', now());

create or replace function as_user(uid uuid) returns void language plpgsql as $$
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
end $$;
create or replace function tb_day(n int) returns date language sql stable as $$ select (now() at time zone 'Asia/Tbilisi')::date + n $$;
create temp table ids (k text primary key, id uuid);
grant all on ids to authenticated;
grant execute on function tb_day(int) to authenticated;

-- занятия: i1 индивидуальная (Аня, оплачена), i2 индивидуальная (Гриша и Аня), g1 вратарская (Вера),
-- x1 дополнительная без времени (Аня), x2 дополнительная со временем 18:30 (Гриша)
select as_user('00000000-0000-0000-0000-0000000000a1');
insert into ids select 'i1', ind_create_session((now() at time zone 'Asia/Tbilisi')::date + 3, '19:00', false, 'Тема 1');
insert into ids select 'i2', ind_create_session((now() at time zone 'Asia/Tbilisi')::date + 4, '19:00', false, 'Тема 2');
insert into ids select 'g1', ind_create_session((now() at time zone 'Asia/Tbilisi')::date + 5, '19:00', true, 'Вратари');
insert into ids select 'x1', extra_create_session((now() at time zone 'Asia/Tbilisi')::date + 3, 20, 'Зал');
insert into ids select 'x2', extra_create_session((now() at time zone 'Asia/Tbilisi')::date + 6, 10, 'Поле');
select extra_set_time((select id from ids where k = 'x2'), '18:30', '19:30');
select extra_add_player((select id from ids where k = 'x2'), '00000000-0000-0000-0000-00000000d002');
select ind_add_player((select id from ids where k = 'i1'), '00000000-0000-0000-0000-00000000d001');
select ind_add_player((select id from ids where k = 'i2'), '00000000-0000-0000-0000-00000000d001');
select ind_add_player((select id from ids where k = 'g1'), '00000000-0000-0000-0000-00000000d003');
select extra_add_player((select id from ids where k = 'x1'), '00000000-0000-0000-0000-00000000d001');
select ind_set_paid((select id from ids where k = 'i1'), '00000000-0000-0000-0000-00000000d001', true, 'Наличные');
reset role;

-- выключатель booking.notify выключен: отмена проходит, уведомления админу нет
select as_user('00000000-0000-0000-0000-0000000000b1');
select lives_ok($$select booking_cancel('individual', (select id from ids where k = 'i2'), '00000000-0000-0000-0000-00000000d001')$$, 'при выключенном booking.notify отмена проходит');
reset role;
select is((select count(*)::int from notifications where kind = 'booking' and text like 'Отмена записи%'), 0, 'при выключенном booking.notify уведомления об отмене нет');

-- включаем выключатель: запись Гриши на i2, затем её отмена родителем
insert into club_settings (club_id, key, value, scope) values ('00000000-0000-0000-0000-00000000c001', 'booking.notify', 'on', '');
select as_user('00000000-0000-0000-0000-0000000000b1');
select lives_ok($$select booking_signup('individual', (select id from ids where k = 'i2'), '00000000-0000-0000-0000-00000000d002')$$, 'родитель записывает Гришу');
reset role;
select is((select text from notifications where kind = 'booking' and text like 'Запись на занятие: Гриша%'), 'Запись на занятие: Гриша. Откройте приложение: Ещё → Индивидуальные.', 'текст уведомления о новой записи: раздел «Индивидуальные», без устаревшего названия');

select as_user('00000000-0000-0000-0000-0000000000b1');
select lives_ok($$select booking_cancel('individual', (select id from ids where k = 'i2'), '00000000-0000-0000-0000-00000000d002')$$, 'родитель отменяет запись Гриши');
reset role;
select is((select count(*)::int from notifications where kind = 'booking' and text like 'Отмена записи%'), 1, 'после отмены администратору одно уведомление');
select is((select text from notifications where kind = 'booking' and text like 'Отмена записи%' and text like '%Гриша%'), 'Отмена записи на занятие: Гриша, Индивидуальная тренировка, ' || booking_when((tb_day(4))::timestamp + time '19:00') || '. Откройте приложение: Ещё → Индивидуальные.', 'индивидуальная: текст с именем ребёнка, видом, датой и временем');
select is((select count(*)::int from notifications where user_id = '00000000-0000-0000-0000-0000000000b1' and text like '%Отмена%'), 0, 'родителю при отмене уведомления нет');

-- оплаченная индивидуальная запись Ани: статус «ждёт решения», журнал оплат не меняется
create temp table snap as select (select count(*) from service_payments)::int as n;
select as_user('00000000-0000-0000-0000-0000000000b1');
select lives_ok($$select booking_cancel('individual', (select id from ids where k = 'i1'), '00000000-0000-0000-0000-00000000d001')$$, 'отмена оплаченной записи Ани');
reset role;
select is((select status from booking_cancellations where session_id = (select id from ids where k = 'i1') and player_id = '00000000-0000-0000-0000-00000000d001'), 'awaiting', 'оплаченная отмена ждёт решения администратора');
select is((select count(*)::int from notifications where kind = 'booking' and text like 'Отмена записи%'), 2, 'оплаченная отмена: ещё одно уведомление админу');
select is((select count(*)::int from service_payments), (select n from snap), 'уведомление не меняет журнал оплат');

-- вратарская запись Веры (родитель другой семьи)
select as_user('00000000-0000-0000-0000-0000000000b2');
select lives_ok($$select booking_cancel('goalkeeper', (select id from ids where k = 'g1'), '00000000-0000-0000-0000-00000000d003')$$, 'отмена вратарской записи');
reset role;
select is((select count(*)::int from notifications where kind = 'booking' and text = 'Отмена записи на занятие: Вера, Вратарская тренировка, ' || booking_when((tb_day(5))::timestamp + time '19:00') || '. Откройте приложение: Ещё → Индивидуальные.'), 1, 'вратарская: имя, вид, дата и время');

-- дополнительная тренировка: та же отмена через общий механизм
select as_user('00000000-0000-0000-0000-0000000000b1');
select lives_ok($$select booking_cancel('extra', (select id from ids where k = 'x1'), '00000000-0000-0000-0000-00000000d001')$$, 'отмена дополнительной тренировки');
reset role;
select is((select count(*)::int from notifications where kind = 'booking' and text = 'Отмена записи на занятие: Аня, Дополнительная тренировка, ' || to_char(tb_day(3), 'DD.MM') || ', Зал, время не задано. Откройте приложение: Ещё → Индивидуальные.'), 1, 'дополнительная без времени: дата, место и явное «время не задано», время не придумано');
select as_user('00000000-0000-0000-0000-0000000000b1');
select lives_ok($$select booking_cancel('extra', (select id from ids where k = 'x2'), '00000000-0000-0000-0000-00000000d002')$$, 'отмена дополнительной тренировки со временем');
reset role;
select is((select count(*)::int from notifications where kind = 'booking' and text = 'Отмена записи на занятие: Гриша, Дополнительная тренировка, ' || booking_when((tb_day(6))::timestamp + time '18:30') || ', Поле. Откройте приложение: Ещё → Индивидуальные.'), 1, 'дополнительная со временем: фактические дата и время 18:30');
select is((select count(*)::int from notifications where kind = 'booking' and text like 'Отмена записи%'), 5, 'всего пять отмен — пять уведомлений, без дублей');
-- адресат: все уведомления об отмене только у администратора, у остальных ни одного
select is((select array_agg(distinct user_id) from notifications where kind = 'booking' and text like 'Отмена записи%'), array['00000000-0000-0000-0000-0000000000a1']::uuid[], 'все уведомления об отмене адресованы администратору (user_id админа)');
select is((select count(*)::int from notifications where kind = 'booking' and text like 'Отмена записи%' and user_id <> '00000000-0000-0000-0000-0000000000a1'), 0, 'ни одного уведомления об отмене не у родителя и не у другого пользователя');
select is((select count(*)::int from notifications where kind = 'booking' and text like 'Отмена записи%Аня%'), 2, 'две отмены Ани (индивидуальная и дополнительная) — два уведомления с её именем');

-- ошибка отмены: повторная отмена той же записи, уведомление не создаётся
select as_user('00000000-0000-0000-0000-0000000000b1');
select throws_ok($$select booking_cancel('individual', (select id from ids where k = 'i1'), '00000000-0000-0000-0000-00000000d001')$$, 'P0002', 'booking not found', 'повторная отмена отказывает');
reset role;
select is((select count(*)::int from notifications where kind = 'booking' and text like 'Отмена записи%'), 5, 'после ошибки отмены уведомлений не прибавилось');

-- ошибка отмены: поздно (настройка booking.cancelHours), уведомления нет
insert into club_settings (club_id, key, value, scope) values ('00000000-0000-0000-0000-00000000c001', 'booking.cancelHours', '48', '');
select as_user('00000000-0000-0000-0000-0000000000a1');
insert into ids select 't1', ind_create_session((now() at time zone 'Asia/Tbilisi')::date + 1, '19:00', false, 'Завтра');
select ind_add_player((select id from ids where k = 't1'), '00000000-0000-0000-0000-00000000d001');
select as_user('00000000-0000-0000-0000-0000000000b1');
select throws_ok($$select booking_cancel('individual', (select id from ids where k = 't1'), '00000000-0000-0000-0000-00000000d001')$$, '22023', 'too late', 'поздняя отмена отказывает');
reset role;
select is((select count(*)::int from notifications where kind = 'booking' and text like 'Отмена записи%'), 5, 'после поздней отмены уведомлений не прибавилось');

select * from finish();
rollback;
