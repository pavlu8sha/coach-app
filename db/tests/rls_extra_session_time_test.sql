-- pgTAP: время дополнительной тренировки (начало и окончание) и отмена родителем по времени (миграция 0070).
begin;
create extension if not exists pgtap;
select plan(9);

insert into clubs (id, name) values ('00000000-0000-0000-0000-00000000c001', 'Клуб');
insert into users (id, telegram_id, display_name, is_admin) values
  ('00000000-0000-0000-0000-0000000000a1', 9701, 'Админ', true),
  ('00000000-0000-0000-0000-0000000000b1', 9702, 'Родитель', false);
insert into players (id, club_id, full_name, status) values
  ('00000000-0000-0000-0000-00000000d001', '00000000-0000-0000-0000-00000000c001', 'Аня Первая', 'active');
insert into player_guardians (player_id, user_id, consent_version, consent_given_at) values
  ('00000000-0000-0000-0000-00000000d001', '00000000-0000-0000-0000-0000000000b1', 'test', now());

create or replace function as_user(uid uuid) returns void language plpgsql as $$
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
end $$;
create temp table ids (k text primary key, id uuid);
grant all on ids to authenticated;

-- Администратор создаёт занятия: сегодня (без времени), через два дня, через три дня (оба без времени, кроме «later»)
select as_user('00000000-0000-0000-0000-0000000000a1');
insert into ids select 'today', extra_create_session((now() at time zone 'Asia/Tbilisi')::date, 20, 'Зал');
insert into ids select 'later', extra_create_session((now() at time zone 'Asia/Tbilisi')::date + 2, 20, 'Зал');
insert into ids select 'evening', extra_create_session((now() at time zone 'Asia/Tbilisi')::date + 3, 20, 'Зал');

select extra_set_time((select id from ids where k = 'later'), '19:00', '20:30');
reset role;
select is((select starts_time::text from extra_sessions where id = (select id from ids where k = 'later')), '19:00:00', 'время начала сохранено');
select is((select ends_time::text from extra_sessions where id = (select id from ids where k = 'later')), '20:30:00', 'время окончания сохранено');

select as_user('00000000-0000-0000-0000-0000000000a1');
select throws_ok($$select extra_set_time((select id from ids where k = 'later'), '20:00', '19:00')$$, '22023', 'end before start', 'окончание раньше начала не принимается');
select throws_ok($$select extra_set_time('00000000-0000-0000-0000-0000000000ff', '19:00', '20:00')$$, 'P0002', 'session not found', 'несуществующее занятие не меняется');

-- Родитель записывает ребёнка на все четыре занятия
select as_user('00000000-0000-0000-0000-0000000000b1');
select throws_ok($$select extra_set_time((select id from ids where k = 'later'), '18:00', '19:00')$$, '42501', 'forbidden', 'родитель не задаёт время занятия');
select booking_signup('extra', (select id from ids where k = 'today'), '00000000-0000-0000-0000-00000000d001');
select booking_signup('extra', (select id from ids where k = 'later'), '00000000-0000-0000-0000-00000000d001');
select booking_signup('extra', (select id from ids where k = 'evening'), '00000000-0000-0000-0000-00000000d001');

-- Без времени правило прежнее: в день занятия отмена запрещена
select as_user('00000000-0000-0000-0000-0000000000b1');
select throws_ok($$select booking_cancel('extra', (select id from ids where k = 'today'), '00000000-0000-0000-0000-00000000d001')$$, '22023', 'session already started', 'без времени в день занятия отмена запрещена');

-- Со временем 00:00 занятие сегодня уже началось: отмена отклоняется по времени
select as_user('00000000-0000-0000-0000-0000000000a1');
select extra_set_time((select id from ids where k = 'today'), '00:00', '23:00');

select as_user('00000000-0000-0000-0000-0000000000b1');
select throws_ok($$select booking_cancel('extra', (select id from ids where k = 'today'), '00000000-0000-0000-0000-00000000d001')$$, '22023', 'session already started', 'занятие, которое уже началось по времени, не отменяется');
select lives_ok($$select booking_cancel('extra', (select id from ids where k = 'later'), '00000000-0000-0000-0000-00000000d001')$$, 'будущее занятие со временем отменяется');
select lives_ok($$select booking_cancel('extra', (select id from ids where k = 'evening'), '00000000-0000-0000-0000-00000000d001')$$, 'занятие без времени через день отменяется');

select * from finish();
rollback;
