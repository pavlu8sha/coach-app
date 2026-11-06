-- pgTAP: модель дополнительных тренировок (0142, #274): вместимость на занятие, отмена, несколько в день, журнал.
begin;
create extension if not exists pgtap;
select plan(24);

insert into clubs (id, name) values ('00000000-0000-0000-0000-00000000c001', 'Клуб');
insert into users (id, telegram_id, display_name, is_admin) values
  ('00000000-0000-0000-0000-0000000000a1', 9501, 'Админ', true),
  ('00000000-0000-0000-0000-0000000000b1', 9502, 'Родитель 1', false),
  ('00000000-0000-0000-0000-0000000000c1', 9503, 'Тренер', false);
insert into groups (id, club_id, name) values ('00000000-0000-0000-0000-0000000000e1', '00000000-0000-0000-0000-00000000c001', 'U9');
insert into coach_groups (user_id, group_id) values ('00000000-0000-0000-0000-0000000000c1', '00000000-0000-0000-0000-0000000000e1');
insert into players (id, club_id, group_id, full_name, status) values
  ('00000000-0000-0000-0000-00000000d001', '00000000-0000-0000-0000-00000000c001', '00000000-0000-0000-0000-0000000000e1', 'Аня', 'active'),
  ('00000000-0000-0000-0000-00000000d002', '00000000-0000-0000-0000-00000000c001', '00000000-0000-0000-0000-0000000000e1', 'Боря', 'active'),
  ('00000000-0000-0000-0000-00000000d003', '00000000-0000-0000-0000-00000000c001', '00000000-0000-0000-0000-0000000000e1', 'Вера', 'active');
insert into player_guardians (player_id, user_id, consent_version, consent_given_at) values
  ('00000000-0000-0000-0000-00000000d001', '00000000-0000-0000-0000-0000000000b1', 'test', now());
insert into club_settings (club_id, key, value, scope) values ('00000000-0000-0000-0000-00000000c001', 'extra.cap', '5', ''),
  ('00000000-0000-0000-0000-00000000c001', 'parent_debt_enabled', 'true', '');

create or replace function as_user(uid uuid) returns void language plpgsql as $$
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
end $$;
create temp table ids (k text primary key, id uuid);
grant all on ids to authenticated;

select as_user('00000000-0000-0000-0000-0000000000a1');
insert into ids select 'x1', extra_create_session((now() at time zone 'Asia/Tbilisi')::date + 3, 20, 'Зал 1');
insert into ids select 'x2', extra_create_session((now() at time zone 'Asia/Tbilisi')::date + 3, 25, 'Зал 2');
select is((select count(*)::int from extra_sessions where starts_on = (now() at time zone 'Asia/Tbilisi')::date + 3), 2, 'две тренировки в один день созданы');
select is((select count(*)::int from extra_activity where action = 'created'), 2, 'создание попало в журнал');

-- вместимость на занятие
select is((select extra_set_capacity((select id from ids where k = 'x1'), 2)), 0, 'вместимость 2 задана, записанных нет');
select is((select capacity from booking_board() where session_id = (select id from ids where k = 'x1')), 2, 'на доске вместимость занятия');
select is((select capacity from booking_board() where session_id = (select id from ids where k = 'x2')), 5, 'у второго занятия клубное значение 5');
select extra_add_player((select id from ids where k = 'x1'), '00000000-0000-0000-0000-00000000d001');
select extra_add_player((select id from ids where k = 'x1'), '00000000-0000-0000-0000-00000000d002');
select throws_ok($$select extra_add_player((select id from ids where k = 'x1'), '00000000-0000-0000-0000-00000000d003')$$, '22023', 'session full', 'третьего сверх вместимости занятия записать нельзя');
select is((select extra_set_capacity((select id from ids where k = 'x1'), 1)), 1, 'уменьшение ниже числа записанных возвращает превышение 1');
select is((select count(*)::int from extra_bookings where session_id = (select id from ids where k = 'x1')), 2, 'записи при уменьшении вместимости не удаляются');
select throws_ok($$select extra_set_capacity((select id from ids where k = 'x1'), 0)$$, '22023', 'bad capacity', 'вместимость меньше 1 отклоняется');
select extra_set_capacity((select id from ids where k = 'x1'), null);
select is((select capacity from booking_board() where session_id = (select id from ids where k = 'x1')), 5, 'null возвращает клубное значение');

-- родитель
select as_user('00000000-0000-0000-0000-0000000000b1');
select throws_ok($$select extra_set_capacity((select id from ids where k = 'x1'), 3)$$, '42501', 'forbidden', 'родитель вместимость не меняет');
select throws_ok($$select extra_cancel_session((select id from ids where k = 'x1'), 'тест')$$, '42501', 'forbidden', 'родитель занятие не отменяет');

-- тренер видит и отмечает на живом занятии
select as_user('00000000-0000-0000-0000-0000000000c1');
select throws_ok($$select extra_cancel_session((select id from ids where k = 'x1'), 'тест')$$, '42501', 'forbidden', 'тренер занятие не отменяет');

-- отмена
select as_user('00000000-0000-0000-0000-0000000000a1');
select extra_cancel_session((select id from ids where k = 'x1'), 'Нет зала');
select is((select cancel_reason from extra_sessions where id = (select id from ids where k = 'x1')), 'Нет зала', 'причина отмены сохранена');
select is((select count(*)::int from extra_bookings where session_id = (select id from ids where k = 'x1')), 0, 'записи отменённого занятия убраны из состава');
select is((select count(*)::int from booking_cancellations where session_id = (select id from ids where k = 'x1') and status = 'cancelled'), 2, 'и сохранены в истории отмен');
select is((select count(*)::int from booking_board() where session_id = (select id from ids where k = 'x1')), 0, 'отменённая пропала с доски записи');
select throws_ok($$select extra_add_player((select id from ids where k = 'x1'), '00000000-0000-0000-0000-00000000d003')$$, '55000', 'session cancelled', 'на отменённую записать нельзя');
select throws_ok($$select extra_set_attended((select id from ids where k = 'x1'), '00000000-0000-0000-0000-00000000d001', true)$$, '55000', 'session cancelled', 'на отменённой посещение не отмечается');
select throws_ok($$select extra_cancel_session((select id from ids where k = 'x1'), null)$$, '55000', 'session cancelled', 'повторная отмена отклоняется');
select is((select count(*)::int from extra_activity where action = 'cancelled'), 1, 'отмена попала в журнал');

-- долги и календарь родителя: отменённое занятие не показывается
reset role;
insert into extra_sessions (id, club_id, starts_on, amount, cancelled_at) values
  ('00000000-0000-0000-0000-0000000008a1', '00000000-0000-0000-0000-00000000c001', (now() at time zone 'Asia/Tbilisi')::date - 5, 20, now()),
  ('00000000-0000-0000-0000-0000000008a2', '00000000-0000-0000-0000-00000000c001', (now() at time zone 'Asia/Tbilisi')::date - 4, 20, null);
insert into extra_bookings (session_id, player_id) values
  ('00000000-0000-0000-0000-0000000008a1', '00000000-0000-0000-0000-00000000d001'),
  ('00000000-0000-0000-0000-0000000008a2', '00000000-0000-0000-0000-00000000d001');
select as_user('00000000-0000-0000-0000-0000000000b1');
select is((select count(*)::int from parent_dues() where kind = 'extra'), 1, 'долг только за неотменённое занятие');
reset role;
insert into extra_bookings (session_id, player_id) values ((select id from ids where k = 'x2'), '00000000-0000-0000-0000-00000000d001');
select as_user('00000000-0000-0000-0000-0000000000b1');
select is((select count(*)::int from parent_calendar('00000000-0000-0000-0000-00000000d001', (now() at time zone 'Asia/Tbilisi')::date, (now() at time zone 'Asia/Tbilisi')::date + 10) where event_id = 'extra:' || (select id from ids where k = 'x2')), 1, 'в календаре живое занятие');
select is((select count(*)::int from parent_calendar('00000000-0000-0000-0000-00000000d001', (now() at time zone 'Asia/Tbilisi')::date, (now() at time zone 'Asia/Tbilisi')::date + 10) where event_id = 'extra:' || (select id from ids where k = 'x1')), 0, 'отменённого занятия в календаре нет');

select * from finish();
rollback;
