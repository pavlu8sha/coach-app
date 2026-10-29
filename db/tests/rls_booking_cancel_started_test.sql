-- pgTAP: родитель не отменяет начавшееся занятие или запись с отметкой посещаемости (S-04, миграция 0069).
begin;
create extension if not exists pgtap;
select plan(8);

insert into clubs (id, name) values ('00000000-0000-0000-0000-00000000c001', 'Клуб');
insert into users (id, telegram_id, display_name, is_admin) values
  ('00000000-0000-0000-0000-0000000000a1', 9101, 'Админ', true),
  ('00000000-0000-0000-0000-0000000000b1', 9102, 'Родитель 1', false);
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

-- Занятия создаёт администратор; сегодняшняя дата по времени клуба
select as_user('00000000-0000-0000-0000-0000000000a1');
insert into ids select 'future', ind_create_session((now() at time zone 'Asia/Tbilisi')::date + 3, '19:00', false, 'Тест');
insert into ids select 'started', ind_create_session((now() at time zone 'Asia/Tbilisi')::date + 4, '19:00', false, 'Тест');
insert into ids select 'marked', ind_create_session((now() at time zone 'Asia/Tbilisi')::date + 5, '19:00', false, 'Тест');
insert into ids select 'xfuture', extra_create_session((now() at time zone 'Asia/Tbilisi')::date + 3, 20, 'Зал');
insert into ids select 'xtoday', extra_create_session((now() at time zone 'Asia/Tbilisi')::date, 20, 'Зал');
insert into ids select 'xmarked', extra_create_session((now() at time zone 'Asia/Tbilisi')::date + 6, 20, 'Зал');

-- Родитель записывает ребёнка на все занятия
select as_user('00000000-0000-0000-0000-0000000000b1');
select booking_signup('individual', (select id from ids where k = 'future'), '00000000-0000-0000-0000-00000000d001');
select booking_signup('individual', (select id from ids where k = 'started'), '00000000-0000-0000-0000-00000000d001');
select booking_signup('individual', (select id from ids where k = 'marked'), '00000000-0000-0000-0000-00000000d001');
select booking_signup('extra', (select id from ids where k = 'xfuture'), '00000000-0000-0000-0000-00000000d001');
select booking_signup('extra', (select id from ids where k = 'xtoday'), '00000000-0000-0000-0000-00000000d001');
select booking_signup('extra', (select id from ids where k = 'xmarked'), '00000000-0000-0000-0000-00000000d001');

-- Состояние после записи: занятие «started» уже прошло, у «marked» и «xmarked» отмечено «не пришёл»
reset role;
update individual_sessions set starts_at = (now() at time zone 'Asia/Tbilisi') - interval '1 hour' where id = (select id from ids where k = 'started');
update individual_bookings set attended = false where session_id = (select id from ids where k = 'marked');
update extra_bookings set attended = false where session_id = (select id from ids where k = 'xmarked');

select as_user('00000000-0000-0000-0000-0000000000b1');
select lives_ok($$select booking_cancel('individual', (select id from ids where k = 'future'), '00000000-0000-0000-0000-00000000d001')$$, 'будущую неоплаченную запись родитель отменяет');
select throws_ok($$select booking_cancel('individual', (select id from ids where k = 'started'), '00000000-0000-0000-0000-00000000d001')$$, '22023', 'session already started', 'начавшееся занятие родитель не отменяет');
select throws_ok($$select booking_cancel('individual', (select id from ids where k = 'marked'), '00000000-0000-0000-0000-00000000d001')$$, '22023', 'attendance marked', 'запись с отметкой посещаемости родитель не отменяет');

reset role;
select is((select count(*)::int from individual_bookings where session_id = (select id from ids where k = 'started')), 1, 'запись начавшегося занятия осталась');
select is((select attended from individual_bookings where session_id = (select id from ids where k = 'marked')), false, 'отметка посещаемости не потеряна');

select as_user('00000000-0000-0000-0000-0000000000b1');
select throws_ok($$select booking_cancel('extra', (select id from ids where k = 'xtoday'), '00000000-0000-0000-0000-00000000d001')$$, '22023', 'session already started', 'дополнительная тренировка сегодня уже началась');
select lives_ok($$select booking_cancel('extra', (select id from ids where k = 'xfuture'), '00000000-0000-0000-0000-00000000d001')$$, 'будущую дополнительную запись родитель отменяет');
select throws_ok($$select booking_cancel('extra', (select id from ids where k = 'xmarked'), '00000000-0000-0000-0000-00000000d001')$$, '22023', 'attendance marked', 'дополнительная запись с отметкой не отменяется');

select * from finish();
rollback;
