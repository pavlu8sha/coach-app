-- pgTAP: доска записи показывает время дополнительной тренировки, если оно указано (миграция 0075).
begin;
create extension if not exists pgtap;
select plan(2);

insert into clubs (id, name) values ('00000000-0000-0000-0000-00000000c001', 'Клуб');
insert into users (id, telegram_id, display_name, is_admin) values
  ('00000000-0000-0000-0000-0000000000a1', 9801, 'Админ', true),
  ('00000000-0000-0000-0000-0000000000b1', 9802, 'Родитель', false);
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

select as_user('00000000-0000-0000-0000-0000000000a1');
insert into ids select 'timed', extra_create_session((now() at time zone 'Asia/Tbilisi')::date + 2, 20, 'Зал');
insert into ids select 'untimed', extra_create_session((now() at time zone 'Asia/Tbilisi')::date + 3, 20, 'Зал');
select extra_set_time((select id from ids where k = 'timed'), '19:00', '20:30');

select as_user('00000000-0000-0000-0000-0000000000b1');
select is((select starts_at::text from booking_board() where session_id = (select id from ids where k = 'timed')),
  (((now() at time zone 'Asia/Tbilisi')::date + 2)::text || ' 19:00:00'), 'занятие со временем: в доске дата и время начала');
select is((select starts_at::text from booking_board() where session_id = (select id from ids where k = 'untimed')),
  (((now() at time zone 'Asia/Tbilisi')::date + 3)::text || ' 00:00:00'), 'занятие без времени: как раньше, полночь дня');

select * from finish();
rollback;
