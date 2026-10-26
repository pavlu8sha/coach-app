-- pgTAP: тренер отмечает дополнительные тренировки и не видит денег (0057).
begin;
create extension if not exists pgtap;
select plan(8);

insert into clubs (id, name) values ('00000000-0000-0000-0000-00000000c001', 'Клуб');
insert into users (id, telegram_id, display_name, is_admin) values
  ('00000000-0000-0000-0000-0000000000a1', 9101, 'Админ', true),
  ('00000000-0000-0000-0000-0000000000c1', 9102, 'Тренер', false),
  ('00000000-0000-0000-0000-0000000000b1', 9103, 'Родитель', false);
insert into groups (id, club_id, name) values ('00000000-0000-0000-0000-0000000000e1', '00000000-0000-0000-0000-00000000c001', 'U9');
insert into coach_groups (user_id, group_id) values ('00000000-0000-0000-0000-0000000000c1', '00000000-0000-0000-0000-0000000000e1');
insert into players (id, club_id, full_name, status) values
  ('00000000-0000-0000-0000-00000000d001', '00000000-0000-0000-0000-00000000c001', 'Аня', 'active'),
  ('00000000-0000-0000-0000-00000000d002', '00000000-0000-0000-0000-00000000c001', 'Боря', 'active');
insert into extra_sessions (id, club_id, starts_on, amount, place) values
  ('00000000-0000-0000-0000-0000000005e1', '00000000-0000-0000-0000-00000000c001', (now() at time zone 'Asia/Tbilisi')::date - 1, 20, 'Зал'),
  ('00000000-0000-0000-0000-0000000005e2', '00000000-0000-0000-0000-00000000c001', (now() at time zone 'Asia/Tbilisi')::date + 3, 20, null);
insert into extra_bookings (session_id, player_id, paid, paid_amount) values
  ('00000000-0000-0000-0000-0000000005e1', '00000000-0000-0000-0000-00000000d001', true, 20),
  ('00000000-0000-0000-0000-0000000005e1', '00000000-0000-0000-0000-00000000d002', false, null),
  ('00000000-0000-0000-0000-0000000005e2', '00000000-0000-0000-0000-00000000d001', false, null);

create or replace function as_user(uid uuid) returns void language plpgsql as $$
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
end $$;

select as_user('00000000-0000-0000-0000-0000000000c1');
select is((select count(*)::int from extra_roster_list((now() at time zone 'Asia/Tbilisi')::date - 5, (now() at time zone 'Asia/Tbilisi')::date + 5)), 3, 'тренер видит тренировки и записавшихся');
select is((select count(*)::int from extra_bookings), 0, 'таблицу записей с деньгами тренер напрямую не читает');
select lives_ok($$select extra_set_attended('00000000-0000-0000-0000-0000000005e1', '00000000-0000-0000-0000-00000000d002', true)$$, 'тренер отмечает посещение состоявшейся тренировки');
select throws_ok($$select extra_set_attended('00000000-0000-0000-0000-0000000005e2', '00000000-0000-0000-0000-00000000d001', true)$$, '22023', 'date in the future', 'будущую тренировку отметить нельзя');
select throws_ok($$select * from extra_roster_list('2020-01-01', '2026-12-31')$$, '22023', 'period too large', 'слишком большой период отклоняется');

select as_user('00000000-0000-0000-0000-0000000000b1');
select throws_ok($$select * from extra_roster_list('2026-10-01', '2026-10-05')$$, '42501', 'forbidden', 'родитель список не получает');

select as_user('00000000-0000-0000-0000-0000000000a1');
select lives_ok($$select extra_set_attended('00000000-0000-0000-0000-0000000005e2', '00000000-0000-0000-0000-00000000d001', true)$$, 'администратор может отметить и будущую');
select is((select attended from extra_bookings where session_id = '00000000-0000-0000-0000-0000000005e1' and player_id = '00000000-0000-0000-0000-00000000d002'), true, 'отметка тренера сохранилась');

select * from finish();
rollback;
