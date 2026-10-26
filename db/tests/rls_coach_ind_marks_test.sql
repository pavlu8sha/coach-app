-- pgTAP: тренер отмечает индивидуальные и вратарские занятия и не видит денег (0056).
begin;
create extension if not exists pgtap;
select plan(9);

insert into clubs (id, name) values ('00000000-0000-0000-0000-00000000c001', 'Клуб');
insert into users (id, telegram_id, display_name, is_admin) values
  ('00000000-0000-0000-0000-0000000000a1', 9001, 'Админ', true),
  ('00000000-0000-0000-0000-0000000000c1', 9002, 'Тренер', false),
  ('00000000-0000-0000-0000-0000000000b1', 9003, 'Родитель', false);
insert into groups (id, club_id, name) values ('00000000-0000-0000-0000-0000000000e1', '00000000-0000-0000-0000-00000000c001', 'U9');
insert into coach_groups (user_id, group_id) values ('00000000-0000-0000-0000-0000000000c1', '00000000-0000-0000-0000-0000000000e1');
insert into players (id, club_id, full_name, status) values
  ('00000000-0000-0000-0000-00000000d001', '00000000-0000-0000-0000-00000000c001', 'Аня', 'active'),
  ('00000000-0000-0000-0000-00000000d002', '00000000-0000-0000-0000-00000000c001', 'Боря', 'active');
insert into individual_sessions (id, club_id, external_id, starts_at, topic, goalkeepers) values
  ('00000000-0000-0000-0000-0000000005e1', '00000000-0000-0000-0000-00000000c001', 'IND-A', (now() at time zone 'Asia/Tbilisi') - interval '2 hours', 'Ловля', true),
  ('00000000-0000-0000-0000-0000000005e2', '00000000-0000-0000-0000-00000000c001', 'IND-B', (now() at time zone 'Asia/Tbilisi') + interval '2 days', null, false),
  ('00000000-0000-0000-0000-0000000005e3', '00000000-0000-0000-0000-00000000c001', 'IND-C', (now() at time zone 'Asia/Tbilisi') - interval '300 days', null, false);
insert into individual_bookings (session_id, player_id, amount, paid) values
  ('00000000-0000-0000-0000-0000000005e1', '00000000-0000-0000-0000-00000000d001', 50, true),
  ('00000000-0000-0000-0000-0000000005e1', '00000000-0000-0000-0000-00000000d002', 50, false),
  ('00000000-0000-0000-0000-0000000005e2', '00000000-0000-0000-0000-00000000d001', 50, false);

create or replace function as_user(uid uuid) returns void language plpgsql as $$
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
end $$;

select as_user('00000000-0000-0000-0000-0000000000c1');
select is((select count(*)::int from ind_roster_list((now() at time zone 'Asia/Tbilisi')::date - 3, (now() at time zone 'Asia/Tbilisi')::date + 3)), 3, 'тренер видит занятия и записавшихся за период (2 + 1 строки)');
select is((select string_agg(full_name, ',' order by full_name) from ind_roster_list((now() at time zone 'Asia/Tbilisi')::date - 3, (now() at time zone 'Asia/Tbilisi')::date) where session_id = '00000000-0000-0000-0000-0000000005e1'), 'Аня,Боря', 'виден состав занятия');
select is((select count(*)::int from individual_bookings), 0, 'таблицы записей с деньгами тренер напрямую не читает');
select lives_ok($$select ind_set_attended('00000000-0000-0000-0000-0000000005e1', '00000000-0000-0000-0000-00000000d001', true)$$, 'тренер отмечает посещение прошедшего занятия');
select throws_ok($$select ind_set_attended('00000000-0000-0000-0000-0000000005e2', '00000000-0000-0000-0000-00000000d001', true)$$, '22023', 'date in the future', 'будущее занятие отметить нельзя');
select throws_ok($$select * from ind_roster_list('2020-01-01', '2026-12-31')$$, '22023', 'period too large', 'слишком большой период отклоняется');

select as_user('00000000-0000-0000-0000-0000000000b1');
select throws_ok($$select * from ind_roster_list('2026-10-01', '2026-10-05')$$, '42501', 'forbidden', 'родитель список занятий не получает');
select throws_ok($$select ind_set_attended('00000000-0000-0000-0000-0000000005e1', '00000000-0000-0000-0000-00000000d001', true)$$, '42501', 'forbidden', 'родитель посещение не отмечает');

select as_user('00000000-0000-0000-0000-0000000000a1');
select is((select attended from individual_bookings where session_id = '00000000-0000-0000-0000-0000000005e1' and player_id = '00000000-0000-0000-0000-00000000d001'), true, 'отметка тренера сохранилась (администратор видит)');

select * from finish();
rollback;
